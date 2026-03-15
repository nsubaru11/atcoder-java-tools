import http from "node:http";
import {spawn, spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import readline from "node:readline";
import {fileURLToPath} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.LOCAL_RUNNER_PORT || 8080);
const MAX_BODY_SIZE = 4 * 1024 * 1024;
const MAX_LOG_FILE_SIZE = Number(process.env.LOCAL_RUNNER_MAX_LOG_FILE_SIZE_BYTES || (8 * 1024 * 1024));
const MAX_CACHE_SIZE = 10;
const COMPILE_TIMEOUT_MS = 30000;
const RUN_TIMEOUT_MS = 10000;
const DISPATCHER_STARTUP_TIMEOUT_MS = 10000;
const DEFAULT_DISPATCHER_CAPTURE_LIMIT_BYTES = 2 << 20;
const DISPATCHER_CAPTURE_LIMIT_BYTES = Number(
	process.env.LOCAL_RUNNER_CAPTURE_LIMIT_BYTES || DEFAULT_DISPATCHER_CAPTURE_LIMIT_BYTES,
);
const RUNNER_MODE = (process.env.LOCAL_RUNNER_MODE || "daemon").toLowerCase();
const IS_LEGACY_MODE = RUNNER_MODE === "legacy";
const DEFAULT_BASE_DIR = process.platform === "linux"
	? "/dev/shm/atcoder-local-runner"
	: path.join(os.tmpdir(), "atcoder-local-runner");
const BASE_DIR = process.env.LOCAL_RUNNER_BASE_DIR || DEFAULT_BASE_DIR;
const LOG_FILE_PATH = path.join(BASE_DIR, "local-runner.log");
const COMPILE_ROOT_DIR = path.join(BASE_DIR, "compiled");
const DISPATCHER_BUILD_DIR = path.join(BASE_DIR, "dispatcher");
const DISPATCHER_SOURCE_FILE = resolveDispatcherSourceFile();
const DISPATCHER_CLASS_FILE = path.join(DISPATCHER_BUILD_DIR, "Dispatcher.class");
const WARMUP_SOURCE_FILE = path.join(__dirname, "src", "WarmUp.java");
const WARMUP_SOURCE_CLASS_NAME = "WarmUp";
const WARMUP_TARGET_CLASS_NAME = "Main";
const WARMUP_STDIN = "";
const WARMUP_PROFILE = (process.env.LOCAL_RUNNER_WARMUP_PROFILE || "full").toLowerCase();
const WARMUP_REPEAT_COUNT = parseWarmUpRepeatCount(
	process.env.LOCAL_RUNNER_WARMUP_REPEAT,
	WARMUP_PROFILE === "quick" ? 1 : 2,
);
const WARMUP_RUN_TIMEOUT_MS = Number(process.env.LOCAL_RUNNER_WARMUP_TIMEOUT_MS || 30000);
let hasDispatcherWarmedUp = false;

const ANSI = {
	RESET: "\x1b[0m",
	GREEN: "\x1b[32m",
	RED: "\x1b[31m",
	YELLOW: "\x1b[33m",
	ORANGE: "\x1b[38;5;208m",
	CYAN: "\x1b[36m",
};

function formatLogLine(level, message) {
	return `[${new Date().toISOString()}] [${level}] ${message}`;
}

function appendLogLine(line) {
	try {
		fs.mkdirSync(BASE_DIR, {recursive: true});
		rotateLogFileIfNeeded();
		fs.appendFileSync(LOG_FILE_PATH, `${stripAnsi(line)}\n`, "utf8");
	} catch {
	}
}

function stripAnsi(text) {
	return String(text || "").replace(/\x1B\[[0-9;]*m/g, "");
}

function rotateLogFileIfNeeded() {
	if (MAX_LOG_FILE_SIZE <= 0 || !fs.existsSync(LOG_FILE_PATH)) {
		return;
	}
	const currentSize = fs.statSync(LOG_FILE_PATH).size;
	if (currentSize < MAX_LOG_FILE_SIZE) {
		return;
	}
	const backupPath = `${LOG_FILE_PATH}.1`;
	try {
		if (fs.existsSync(backupPath)) {
			fs.rmSync(backupPath, {force: true});
		}
		fs.renameSync(LOG_FILE_PATH, backupPath);
	} catch {
	}
}

function logInfo(message) {
	const line = formatLogLine("INFO", message);
	process.stdout.write(`${line}\n`);
	appendLogLine(line);
}

function logWarn(message) {
	const line = formatLogLine("WARN", message);
	process.stderr.write(`${line}\n`);
	appendLogLine(line);
}

function logError(message) {
	const line = formatLogLine("ERROR", message);
	process.stderr.write(`${line}\n`);
	appendLogLine(line);
}

function supportsColor() {
	if (process.env.NO_COLOR) {
		return false;
	}
	if (process.env.LOCAL_RUNNER_FORCE_COLOR === "0") {
		return false;
	}
	// PowerShell -> WSL 経由では isTTY が false になることがあるため、既定で色を有効化。
	return true;
}

function colorizeStatus(status) {
	if (!supportsColor()) return status;
	if (status === "AC") return `${ANSI.GREEN}${status}${ANSI.RESET}`;
	if (status === "WA") return `${ANSI.RED}${status}${ANSI.RESET}`;
	if (status === "CE") return `${ANSI.YELLOW}${status}${ANSI.RESET}`;
	if (["RE", "TLE", "MLE", "OLE", "IE"].includes(status)) return `${ANSI.ORANGE}${status}${ANSI.RESET}`;
	if (["WJ", "WR"].includes(status)) return `${ANSI.CYAN}${status}${ANSI.RESET}`;
	return status;
}

function toRunLabel(status) {
	switch (status) {
		case "success":
			return "AC";
		case "compileError":
			return "CE";
		case "timeLimitExceeded":
			return "TLE";
		case "runtimeError":
			return "RE";
		case "internalError":
			return "IE";
		default:
			return String(status || "UNKNOWN").toUpperCase();
	}
}

function firstLine(text) {
	if (!text) return "";
	return String(text).replace(/\r\n?/g, "\n").split("\n")[0].trim();
}

function trimForLog(text, maxLen = 72) {
	if (!text) return "";
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen - 3)}...`;
}

function shortHash(hash) {
	if (!hash) return "";
	return hash.length <= 16 ? hash : `${hash.slice(0, 16)}...`;
}

function parseWarmUpRepeatCount(rawValue, fallbackValue) {
	if (rawValue == null) {
		return fallbackValue;
	}
	const parsed = Number(rawValue);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return fallbackValue;
	}
	return Math.floor(parsed);
}

function buildWarmUpSourceCode() {
	let sourceCode;
	try {
		sourceCode = fs.readFileSync(WARMUP_SOURCE_FILE, "utf8");
	} catch (error) {
		throw new Error(`failed to load ${WARMUP_SOURCE_FILE}: ${error.message}`);
	}

	const classDeclarationPattern = new RegExp(
		`public\\s+final\\s+class\\s+${WARMUP_SOURCE_CLASS_NAME}\\b`,
	);
	if (!classDeclarationPattern.test(sourceCode)) {
		throw new Error(`class declaration not found in ${WARMUP_SOURCE_FILE}`);
	}
	return sourceCode.replace(
		classDeclarationPattern,
		`public final class ${WARMUP_TARGET_CLASS_NAME}`,
	);
}

function formatRunSummary(result, waitMs, totalMs, modeTag) {
	const status = toRunLabel(result.status);
	const parts = [
		`[Run]`,
		`Mode=${modeTag}`,
		`Status=${colorizeStatus(status)}`,
		`Wait=${waitMs}ms`,
		`Exec=${result.time}ms`,
		`Total=${totalMs}ms`,
		`Exit=${result.exitCode}`,
	];
	if (result.memory > 0) {
		parts.push(`Memory=${result.memory}KB`);
	}
	if (result.stdoutTruncated || result.stderrTruncated) {
		const flags = [];
		if (result.stdoutTruncated) flags.push("stdout");
		if (result.stderrTruncated) flags.push("stderr");
		parts.push(`Truncated=${flags.join(",")}`);
	}
	const err = firstLine(result.stderr);
	if (err && result.status !== "success") {
		parts.push(`Error=${trimForLog(err)}`);
	}
	return parts.join(" ");
}

function isWindowsStylePath(targetPath) {
	return /^[A-Za-z]:\\/.test(targetPath);
}

function resolveJavaHome() {
	const javaHome = process.env.JAVA_HOME;
	if (!javaHome) {
		return "";
	}
	if (process.platform === "linux" && isWindowsStylePath(javaHome)) {
		logInfo(`Ignoring Windows-style JAVA_HOME on Linux: ${javaHome}`);
		return "";
	}
	return javaHome;
}

function getJavaEnv() {
	const resolvedJavaHome = resolveJavaHome();
	if (!resolvedJavaHome) {
		logInfo("JAVA_HOME is not set. Using java/javac from PATH.");
		return process.env;
	}
	logInfo(`Using Java from: ${resolvedJavaHome}`);
	return {
		...process.env,
		JAVA_HOME: resolvedJavaHome,
		PATH: path.join(resolvedJavaHome, "bin") + path.delimiter + process.env.PATH,
	};
}

const JAVA_ENV = getJavaEnv();
const RESOLVED_JAVA_HOME = resolveJavaHome();
const JAVA_PATH = RESOLVED_JAVA_HOME ? path.join(RESOLVED_JAVA_HOME, "bin", "java") : "java";
const JAVAC_PATH = RESOLVED_JAVA_HOME ? path.join(RESOLVED_JAVA_HOME, "bin", "javac") : "javac";

const compileCache = new Map();
const dispatcherState = {
	proc: null,
	readline: null,
	startupPromise: null,
	currentRequest: null,
	requestQueue: Promise.resolve(),
	nextRequestId: 0,
};

function ensureDirectory(targetDir) {
	fs.mkdirSync(targetDir, {recursive: true});
}

function removeDirectory(targetDir) {
	try {
		fs.rmSync(targetDir, {recursive: true, force: true});
	} catch {
	}
}

function hashCode(sourceCode) {
	const digest = crypto.createHash("md5").update(sourceCode).digest("hex");
	return `${sourceCode.length.toString(16)}-${digest}`;
}

function resolveDispatcherSourceFile() {
	const envPath = process.env.LOCAL_RUNNER_DISPATCHER_SOURCE;
	const candidates = [
		envPath,
		path.join(__dirname, "Dispatcher.java"),
		path.join(__dirname, "src", "Dispatcher.java"),
	].filter(Boolean);
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(`Dispatcher source not found. Tried: ${candidates.join(", ")}`);
}

function encodeField(value) {
	return Buffer.from(value ?? "", "utf8").toString("base64");
}

function decodeField(value) {
	return Buffer.from(value, "base64").toString("utf8");
}

function requiresIsolatedProcess(sourceCode) {
	return /FileDescriptor\.(?:in|out|err)\b/.test(sourceCode)
		|| /Runtime\.getRuntime\(\)\.halt\s*\(/.test(sourceCode)
		|| /System\.exit\s*\(/.test(sourceCode);
}

function warmUpJavaTools() {
	logInfo("Warm up javac/java...");
	spawnSync(JAVA_PATH, ["-version"], {env: JAVA_ENV, stdio: "ignore"});
	spawnSync(JAVAC_PATH, ["-version"], {env: JAVA_ENV, stdio: "ignore"});
}

function getJavaVersion() {
	try {
		const result = spawnSync(JAVA_PATH, ["-version"], {
			env: JAVA_ENV,
			encoding: "utf8",
		});
		const output = result.stderr || result.stdout || "";
		const match = output.match(/version "([^"]+)"/);
		if (!match) {
			return "Unknown";
		}
		const rawVersion = match[1];
		if (rawVersion.startsWith("1.")) {
			const legacyMatch = rawVersion.match(/^1\.(\d+)/);
			return legacyMatch ? legacyMatch[1] : rawVersion;
		}
		const modernMatch = rawVersion.match(/^(\d+)/);
		return modernMatch ? modernMatch[1] : rawVersion;
	} catch {
		return "Unknown";
	}
}

const JAVA_VERSION = getJavaVersion();
const RUNNER_LABEL = IS_LEGACY_MODE
	? `Java ${JAVA_VERSION} (Windows Legacy Local)`
	: (process.platform === "linux"
		? `Java ${JAVA_VERSION} (WSL Daemon Local)`
		: `Java ${JAVA_VERSION} (Daemon Local)`);

function cleanupOldCache() {
	if (compileCache.size <= MAX_CACHE_SIZE) {
		return;
	}
	const oldestHash = compileCache.keys().next().value;
	const oldestEntryPromise = compileCache.get(oldestHash);
	compileCache.delete(oldestHash);
	if (!oldestEntryPromise) {
		return;
	}
	oldestEntryPromise.then((entry) => {
		if (entry && entry.rootDir) {
			removeDirectory(entry.rootDir);
		}
		return null;
	});
}

function runCommand(command, args, options = {}) {
	return new Promise((resolve) => {
		const proc = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		let killTimer = null;
		const finish = (result) => {
			if (settled) {
				return;
			}
			settled = true;
			if (killTimer) {
				clearTimeout(killTimer);
			}
			resolve(result);
		};

		if (proc.stdout) {
			proc.stdout.on("data", (data) => {
				stdout += data.toString();
			});
		}
		if (proc.stderr) {
			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});
		}
		if (options.input !== undefined && proc.stdin) {
			proc.stdin.end(options.input, "utf8");
		} else if (proc.stdin) {
			proc.stdin.end();
		}

		proc.on("close", (code, signal) => {
			finish({code: code ?? -1, signal, stdout, stderr, timedOut});
		});

		proc.on("error", (error) => {
			finish({
				code: -1,
				signal: null,
				stdout,
				stderr: stderr ? `${stderr}\n${error.message}` : error.message,
				timedOut,
			});
		});

		if (options.timeoutMs) {
			killTimer = setTimeout(() => {
				timedOut = true;
				proc.kill('SIGKILL');
			}, options.timeoutMs);
		}
	});
}

async function compileDispatcher() {
	ensureDirectory(DISPATCHER_BUILD_DIR);
	const result = await runCommand(
		JAVAC_PATH,
		["-encoding", "UTF-8", "-g:none", "-d", DISPATCHER_BUILD_DIR, DISPATCHER_SOURCE_FILE],
		{env: JAVA_ENV, timeoutMs: COMPILE_TIMEOUT_MS},
	);
	if (result.code !== 0 || result.timedOut || !fs.existsSync(DISPATCHER_CLASS_FILE)) {
		throw new Error(result.stderr || "Failed to compile Dispatcher.java.");
	}
}

function stopDispatcher() {
	if (dispatcherState.readline) {
		dispatcherState.readline.close();
		dispatcherState.readline = null;
	}
	if (dispatcherState.proc) {
		dispatcherState.proc.kill('SIGKILL');
		dispatcherState.proc = null;
	}
	if (dispatcherState.currentRequest) {
		dispatcherState.currentRequest.reject(new Error("Dispatcher stopped while a request was running."));
		dispatcherState.currentRequest = null;
	}
}

function handleDispatcherResponse(line) {
	const parts = line.split("\t");
	const responseType = parts[0];
	if (responseType === "PONG" || responseType === "RUN") {
		return;
	}
	const pendingRequest = dispatcherState.currentRequest;
	if (!pendingRequest) {
		logWarn(`[Dispatcher] Unexpected response without a pending request: ${line}`);
		return;
	}
	if (parts[1] !== pendingRequest.id) {
		pendingRequest.reject(new Error(`Dispatcher response ID mismatch: ${line}`));
		dispatcherState.currentRequest = null;
		return;
	}
	if (responseType === "RESULT") {
		const stdoutTruncated = Number(parts[6] || "0") !== 0;
		const stderrTruncated = Number(parts[7] || "0") !== 0;
		pendingRequest.resolve({
			exitCode: Number(parts[2]),
			time: Number(parts[3]),
			stdout: decodeField(parts[4] || ""),
			stderr: decodeField(parts[5] || ""),
			stdoutTruncated,
			stderrTruncated,
		});
		dispatcherState.currentRequest = null;
		return;
	}
	if (responseType === "ERROR") {
		pendingRequest.reject(new Error(decodeField(parts[2] || "")));
		dispatcherState.currentRequest = null;
		return;
	}
	pendingRequest.reject(new Error(`Unknown dispatcher response: ${line}`));
	dispatcherState.currentRequest = null;
}

async function startDispatcher() {
	await compileDispatcher();
	await new Promise((resolve, reject) => {
		const proc = spawn(JAVA_PATH, ["-cp", DISPATCHER_BUILD_DIR, "Dispatcher"], {
			cwd: DISPATCHER_BUILD_DIR,
			env: JAVA_ENV,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const lineReader = readline.createInterface({
			input: proc.stdout,
			crlfDelay: Infinity,
		});
		let settled = false;
		let readyTimer = null;
		const settleResolve = () => {
			if (settled) {
				return;
			}
			settled = true;
			if (readyTimer) {
				clearTimeout(readyTimer);
			}
			resolve();
		};
		const settleReject = (error) => {
			if (settled) {
				return;
			}
			settled = true;
			if (readyTimer) {
				clearTimeout(readyTimer);
			}
			reject(error);
		};

		dispatcherState.proc = proc;
		dispatcherState.readline = lineReader;

		proc.stderr.on("data", (data) => {
			process.stderr.write(`[Dispatcher] ${data}`);
		});

		lineReader.on("line", (line) => {
			if (!settled) {
				if (line === "READY") {
					settleResolve();
					return;
				}
				settleReject(new Error(`Unexpected dispatcher startup response: ${line}`));
				return;
			}
			handleDispatcherResponse(line);
		});

		proc.on("error", (error) => {
			settleReject(error);
			if (dispatcherState.currentRequest) {
				dispatcherState.currentRequest.reject(error);
				dispatcherState.currentRequest = null;
			}
		});

		proc.on("exit", (code, signal) => {
			if (!settled) {
				settleReject(new Error(`Dispatcher exited before READY (code=${code}, signal=${signal}).`));
			}
			if (dispatcherState.currentRequest) {
				dispatcherState.currentRequest.reject(
					new Error(`Dispatcher exited during execution (code=${code}, signal=${signal}).`),
				);
				dispatcherState.currentRequest = null;
			}
			dispatcherState.proc = null;
			if (dispatcherState.readline === lineReader) {
				dispatcherState.readline = null;
			}
		});

		readyTimer = setTimeout(() => {
			proc.kill('SIGKILL');
			settleReject(new Error("Dispatcher startup timed out."));
		}, DISPATCHER_STARTUP_TIMEOUT_MS);
	});
}

async function ensureDispatcherReady() {
	if (dispatcherState.proc && !dispatcherState.proc.killed) {
		return;
	}
	if (!dispatcherState.startupPromise) {
		dispatcherState.startupPromise = startDispatcher().finally(() => {
			dispatcherState.startupPromise = null;
		});
	}
	await dispatcherState.startupPromise;
}

async function warmUpDispatcher() {
	if (IS_LEGACY_MODE || hasDispatcherWarmedUp) {
		return;
	}
	logInfo(
		`Warm up dispatcher... profile=${WARMUP_PROFILE} repeat=${WARMUP_REPEAT_COUNT} timeout=${WARMUP_RUN_TIMEOUT_MS}ms`,
	);
	const warmupSourceCode = buildWarmUpSourceCode();
	const warmupEntry = await getCompiledEntry(warmupSourceCode);
	if (warmupEntry.status !== "compiled") {
		throw new Error(`[WarmUp] compile failed: ${firstLine(warmupEntry.error) || "unknown error"}`);
	}
	for (let i = 1; i <= WARMUP_REPEAT_COUNT; i++) {
		const result = await queueDispatcherRun(warmupEntry, WARMUP_STDIN, WARMUP_RUN_TIMEOUT_MS);
		if (result.timedOut) {
			throw new Error(`[WarmUp] run ${i}/${WARMUP_REPEAT_COUNT} timeout ${WARMUP_RUN_TIMEOUT_MS}ms`);
		}
		if (result.exitCode !== 0) {
			const err = firstLine(result.stderr);
			throw new Error(`[WarmUp] run ${i}/${WARMUP_REPEAT_COUNT} runtime error${err ? `: ${trimForLog(err)}` : ""}`);
		}
		logInfo(`[WarmUp] run ${i}/${WARMUP_REPEAT_COUNT} done ${result.time}ms`);
	}
	hasDispatcherWarmedUp = true;
}

function logCaptureAndBodySizeBalance() {
	if (MAX_BODY_SIZE < DISPATCHER_CAPTURE_LIMIT_BYTES) {
		logWarn(
			`[Config] MAX_BODY_SIZE (${MAX_BODY_SIZE}) is smaller than LOCAL_RUNNER_CAPTURE_LIMIT_BYTES (${DISPATCHER_CAPTURE_LIMIT_BYTES}).`,
		);
	}
}

function queueDispatcherRun(entry, standardInput, timeoutMs = RUN_TIMEOUT_MS) {
	dispatcherState.requestQueue = dispatcherState.requestQueue
		.catch(() => null)
		.then(async () => {
			await ensureDispatcherReady();
			return new Promise((resolve, reject) => {
				const requestId = String(++dispatcherState.nextRequestId);
				let settled = false;
				let timeoutHandle = null;
				const finishResolve = (value) => {
					if (settled) {
						return;
					}
					settled = true;
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}
					resolve(value);
				};
				const finishReject = (error) => {
					if (settled) {
						return;
					}
					settled = true;
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}
					reject(error);
				};

				dispatcherState.currentRequest = {
					id: requestId,
					resolve: finishResolve,
					reject: finishReject,
				};

				timeoutHandle = setTimeout(() => {
					const timeoutError = new Error(`Execution timed out after ${timeoutMs}ms.`);
					if (dispatcherState.currentRequest && dispatcherState.currentRequest.id === requestId) {
						dispatcherState.currentRequest = null;
					}
					stopDispatcher();
					finishResolve({timedOut: true, error: timeoutError.message});
				}, timeoutMs);

				const command = [
					"RUN",
					requestId,
					encodeField(entry.classDir),
					encodeField(entry.mainClass),
					Buffer.from(standardInput ?? "", "utf8").toString("base64"),
				].join("\t");
				dispatcherState.proc.stdin.write(`${command}\n`, "utf8", (error) => {
					if (error) {
						if (dispatcherState.currentRequest && dispatcherState.currentRequest.id === requestId) {
							dispatcherState.currentRequest = null;
						}
						finishReject(error);
					}
				});
			});
		});
	return dispatcherState.requestQueue;
}

async function compileSource(sourceCode, hash) {
	ensureDirectory(COMPILE_ROOT_DIR);
	const rootDir = path.join(COMPILE_ROOT_DIR, hash);
	const classDir = path.join(rootDir, "classes");
	const sourceFile = path.join(rootDir, "Main.java");
	const classFile = path.join(classDir, "Main.class");

	if (fs.existsSync(sourceFile) && fs.existsSync(classFile)) {
		const existingSource = fs.readFileSync(sourceFile, "utf8");
		if (existingSource === sourceCode) {
			return {
				rootDir,
				classDir,
				mainClass: "Main",
				requiresIsolatedProcess: requiresIsolatedProcess(sourceCode),
				status: "compiled",
				error: null,
			};
		}
	}

	removeDirectory(rootDir);
	ensureDirectory(classDir);
	fs.writeFileSync(sourceFile, sourceCode, "utf8");

	const compileStart = Date.now();
	const result = await runCommand(
		JAVAC_PATH,
		["-encoding", "UTF-8", "-g:none", "-d", "classes", "Main.java"],
		{cwd: rootDir, env: JAVA_ENV, timeoutMs: COMPILE_TIMEOUT_MS},
	);
	const compileTime = Date.now() - compileStart;

	if (result.code === 0 && !result.timedOut) {
		logInfo(`[Compile] OK ${compileTime}ms -> ${shortHash(hash)}`);
		return {
			rootDir,
			classDir,
			mainClass: "Main",
			requiresIsolatedProcess: requiresIsolatedProcess(sourceCode),
			status: "compiled",
			error: null,
		};
	}

	logWarn(`[Compile] NG ${compileTime}ms -> ${shortHash(hash)}`);
	return {
		rootDir,
		classDir,
		mainClass: "Main",
		requiresIsolatedProcess: requiresIsolatedProcess(sourceCode),
		status: "error",
		error: result.timedOut
			? `Compilation timed out after ${COMPILE_TIMEOUT_MS}ms.\n${result.stderr}`.trim()
			: (result.stderr || "Compilation failed."),
	};
}

function getCompiledEntry(sourceCode) {
	const hash = hashCode(sourceCode);
	if (compileCache.has(hash)) {
		return compileCache.get(hash);
	}
	const entryPromise = compileSource(sourceCode, hash);
	compileCache.set(hash, entryPromise);
	cleanupOldCache();
	return entryPromise;
}

async function runCodeInIsolatedJvm(entry, standardInput) {
	const execStart = Date.now();
	const result = await runCommand(
		JAVA_PATH,
		[
			"-XX:+TieredCompilation",
			"-XX:TieredStopAtLevel=1",
			"-cp",
			entry.classDir,
			entry.mainClass,
		],
		{
			cwd: entry.rootDir,
			env: JAVA_ENV,
			input: standardInput,
			timeoutMs: RUN_TIMEOUT_MS,
		},
	);
	return {
		status: result.timedOut ? "timeLimitExceeded" : (result.code === 0 ? "success" : "runtimeError"),
		exitCode: result.timedOut ? 124 : result.code,
		stdout: result.stdout,
		stderr: result.timedOut ? (`Execution timed out after ${RUN_TIMEOUT_MS}ms.\n${result.stderr}`).trim() : result.stderr,
		time: result.timedOut ? RUN_TIMEOUT_MS : (Date.now() - execStart),
		stdoutTruncated: false,
		stderrTruncated: false,
		memory: 0,
	};
}

async function runCode({sourceCode, stdin}) {
	const overallStart = Date.now();
	const entry = await getCompiledEntry(sourceCode);
	const waitTime = Date.now() - overallStart;

	if (entry.status === "error") {
		const response = {
			status: "compileError",
			exitCode: 1,
			stdout: "",
			stderr: entry.error,
			time: waitTime,
			stdoutTruncated: false,
			stderrTruncated: false,
			memory: 0,
		};
		logWarn(formatRunSummary(response, waitTime, Date.now() - overallStart, "compile"));
		return response;
	}

	if (IS_LEGACY_MODE) {
		const result = await runCodeInIsolatedJvm(entry, stdin || "");
		const totalTime = Date.now() - overallStart;
		logInfo(formatRunSummary(result, waitTime, totalTime, "legacy"));
		return result;
	}

	if (entry.requiresIsolatedProcess) {
		logInfo("[Run] Falling back to isolated JVM mode due to FileDescriptor/System.exit/Runtime.halt usage.");
		const result = await runCodeInIsolatedJvm(entry, stdin || "");
		const totalTime = Date.now() - overallStart;
		logInfo(formatRunSummary(result, waitTime, totalTime, "isolated"));
		return result;
	}

	try {
		const result = await queueDispatcherRun(entry, stdin || "");
		if (result.timedOut) {
			const response = {
				status: "timeLimitExceeded",
				exitCode: 124,
				stdout: "",
				stderr: result.error,
				time: RUN_TIMEOUT_MS,
				stdoutTruncated: false,
				stderrTruncated: false,
				memory: 0,
			};
			logWarn(formatRunSummary(response, waitTime, Date.now() - overallStart, "daemon"));
			return response;
		}
		const totalTime = Date.now() - overallStart;
		if (result.stdoutTruncated || result.stderrTruncated) {
			logWarn(
				`[Run] Output truncated by dispatcher (stdout=${result.stdoutTruncated}, stderr=${result.stderrTruncated}).`,
			);
		}
		const response = {
			status: result.exitCode === 0 ? "success" : "runtimeError",
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			time: result.time,
			stdoutTruncated: !!result.stdoutTruncated,
			stderrTruncated: !!result.stderrTruncated,
			memory: 0,
		};
		const logger = response.status === "success" ? logInfo : logWarn;
		logger(formatRunSummary(response, waitTime, totalTime, "daemon"));
		return response;
	} catch (error) {
		logError(`[Run] Internal error: ${error.message}`);
		const response = {
			status: "internalError",
			exitCode: -1,
			stdout: "",
			stderr: error.message,
			time: 0,
			stdoutTruncated: false,
			stderrTruncated: false,
			memory: 0,
		};
		logError(formatRunSummary(response, waitTime, Date.now() - overallStart, "daemon"));
		return response;
	}
}

const server = http.createServer(async (req, res) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");

	if (req.method === "OPTIONS") {
		res.writeHead(200);
		res.end();
		return;
	}

	if (req.method !== "POST") {
		res.writeHead(405);
		res.end("Method Not Allowed");
		return;
	}

	let body = "";
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_SIZE) {
			res.writeHead(413, {"Content-Type": "text/plain"});
			res.end("Request Entity Too Large");
			return;
		}
		body += chunk;
	}

	try {
		const request = JSON.parse(body);
		let response;
		if (request.mode === "list") {
			response = [
				{
					language: "Java",
					compilerName: `java${JAVA_VERSION}`,
					label: RUNNER_LABEL,
				},
			];
		} else if (request.mode === "precompile") {
			getCompiledEntry(request.sourceCode);
			response = {status: "accepted"};
		} else if (request.mode === "run") {
			response = await runCode(request);
		} else {
			res.writeHead(400, {"Content-Type": "application/json"});
			res.end(JSON.stringify({status: "badRequest", stderr: `Unknown mode: ${request.mode}`}));
			return;
		}

		res.writeHead(200, {"Content-Type": "application/json"});
		res.end(JSON.stringify(response));
	} catch (error) {
		res.writeHead(500, {"Content-Type": "application/json"});
		res.end(JSON.stringify({status: "internalError", stderr: error.message}));
	}
});

async function bootstrap() {
	ensureDirectory(BASE_DIR);
	ensureDirectory(COMPILE_ROOT_DIR);
	logInfo(`Local runner base directory: ${BASE_DIR}`);
	logInfo(`Runner mode: ${RUNNER_MODE}`);
	logInfo(`Log file: ${LOG_FILE_PATH}`);
	logInfo(`Log rotation size: ${MAX_LOG_FILE_SIZE} bytes`);
	logInfo(`Dispatcher capture limit: ${DISPATCHER_CAPTURE_LIMIT_BYTES} bytes`);
	logInfo(`WarmUp profile: ${WARMUP_PROFILE} (repeat=${WARMUP_REPEAT_COUNT}, timeout=${WARMUP_RUN_TIMEOUT_MS}ms)`);
	logCaptureAndBodySizeBalance();
	if (process.platform === "linux" && BASE_DIR.startsWith("/dev/shm")) {
		logInfo("Using /dev/shm for low-latency compile cache.");
	}
	warmUpJavaTools();
	if (!IS_LEGACY_MODE) {
		ensureDirectory(DISPATCHER_BUILD_DIR);
		await ensureDispatcherReady();
		await warmUpDispatcher();
	}
	server.listen(PORT, () => {
		logInfo(`LocalRunner server listening on http://localhost:${PORT}`);
		logInfo(`Runner label: ${RUNNER_LABEL}`);
	});
}

function shutdown(signal) {
	logInfo(`Shutting down LocalRunner server (${signal})...`);
	stopDispatcher();
	server.close(() => {
		process.exit(0);
	});
}

server.on("error", (error) => {
	logError(`[Server] ${error.message}`);
	process.exit(1);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("exit", () => {
	stopDispatcher();
});

try {
	await bootstrap();
} catch (error) {
	logError(`[Bootstrap] ${error.message}`);
	process.exit(1);
}
