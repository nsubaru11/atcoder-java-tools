import {spawn, spawnSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {CompileEntry, ProcessResult} from "../types";
import {DISPATCHER_CLASS_FILE, resolveDispatcherSourceFile, RUNNER_CONFIG,} from "../shared/config";
import {ensureDirectory, logInfo, logWarn, removeDirectory, shortHash,} from "../shared/utils";

function isWindowsStylePath(targetPath: string) {
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

const RESOLVED_JAVA_HOME = resolveJavaHome();

function getJavaEnv() {
	if (!RESOLVED_JAVA_HOME) {
		logInfo("JAVA_HOME is not set. Using java/javac from PATH.");
		return process.env;
	}
	logInfo(`Using Java from: ${RESOLVED_JAVA_HOME}`);
	return {
		...process.env,
		JAVA_HOME: RESOLVED_JAVA_HOME,
		PATH: path.join(RESOLVED_JAVA_HOME, "bin") + path.delimiter + process.env.PATH,
	};
}

export const JAVA_ENV = getJavaEnv();
export const JAVA_PATH = RESOLVED_JAVA_HOME ? path.join(RESOLVED_JAVA_HOME, "bin", "java") : "java";
export const JAVAC_PATH = RESOLVED_JAVA_HOME ? path.join(RESOLVED_JAVA_HOME, "bin", "javac") : "javac";
const DISPATCHER_SOURCE_FILE = resolveDispatcherSourceFile();

const compileCache = new Map<string, Promise<CompileEntry>>();

export function warmUpJavaTools() {
	logInfo("Warm up javac/java...");
	spawnSync(JAVA_PATH, ["-version"], {env: JAVA_ENV, stdio: "ignore"});
	spawnSync(JAVAC_PATH, ["-version"], {env: JAVA_ENV, stdio: "ignore"});
}

export function getJavaVersion() {
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

export const JAVA_VERSION = getJavaVersion();
export const RUNNER_LABEL = process.platform === "linux"
	? `Java ${JAVA_VERSION} (WSL Daemon Local)`
	: `Java ${JAVA_VERSION} (Daemon Local)`;

function hashCode(sourceCode: string) {
	const digest = crypto.createHash("md5").update(sourceCode).digest("hex");
	return `${sourceCode.length.toString(16)}-${digest}`;
}

function cleanupOldCache() {
	if (compileCache.size <= RUNNER_CONFIG.maxCacheSize) {
		return;
	}
	const oldestHash = compileCache.keys().next().value;
	if (!oldestHash) return;
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

export function runProcessCommand(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {},
) {
	return new Promise<ProcessResult>((resolve) => {
		const proc = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		let killTimer: NodeJS.Timeout | null = null;
		const finish = (result: ProcessResult) => {
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
				proc.kill("SIGKILL");
			}, options.timeoutMs);
		}
	});
}

export async function compileDispatcher() {
	ensureDirectory(RUNNER_CONFIG.dispatcherBuildDir);
	const result = await runProcessCommand(
		JAVAC_PATH,
		["-encoding", "UTF-8", "-g", "-d", RUNNER_CONFIG.dispatcherBuildDir, DISPATCHER_SOURCE_FILE],
		{env: JAVA_ENV, timeoutMs: RUNNER_CONFIG.compileTimeoutMs},
	);
	if (result.code !== 0 || result.timedOut || !fs.existsSync(DISPATCHER_CLASS_FILE)) {
		throw new Error(result.stderr || "Failed to compile Dispatcher.java.");
	}
}

function requiresIsolatedProcess(sourceCode: string) {
	return /FileDescriptor\.(?:in|out|err)\b/.test(sourceCode)
		|| /Runtime\.getRuntime\(\)\.halt\s*\(/.test(sourceCode)
		|| /System\.exit\s*\(/.test(sourceCode);
}

async function compileSource(sourceCode: string, hash: string): Promise<CompileEntry> {
	ensureDirectory(RUNNER_CONFIG.compileRootDir);
	const rootDir = path.join(RUNNER_CONFIG.compileRootDir, hash);
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
	const result = await runProcessCommand(
		JAVAC_PATH,
		["-encoding", "UTF-8", "-g", "-d", "classes", "Main.java"],
		{cwd: rootDir, env: JAVA_ENV, timeoutMs: RUNNER_CONFIG.compileTimeoutMs},
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
			? `Compilation timed out after ${RUNNER_CONFIG.compileTimeoutMs}ms.\n${result.stderr}`.trim()
			: (result.stderr || "Compilation failed."),
	};
}

export function getCompiledEntry(sourceCode: string) {
	const hash = hashCode(sourceCode);
	if (compileCache.has(hash)) {
		return compileCache.get(hash)!;
	}
	const entryPromise = compileSource(sourceCode, hash);
	compileCache.set(hash, entryPromise);
	cleanupOldCache();
	return entryPromise;
}

export async function runCodeInIsolatedJvm(entry: CompileEntry, standardInput: string) {
	const execStart = Date.now();
	const result = await runProcessCommand(
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
			timeoutMs: RUNNER_CONFIG.runTimeoutMs,
		},
	);
	return {
		status: result.timedOut ? "timeLimitExceeded" : (result.code === 0 ? "success" : "runtimeError"),
		exitCode: result.timedOut ? 124 : result.code,
		stdout: result.stdout,
		stderr: result.timedOut ? (`Execution timed out after ${RUNNER_CONFIG.runTimeoutMs}ms.\n${result.stderr}`).trim() : result.stderr,
		time: result.timedOut ? RUNNER_CONFIG.runTimeoutMs : (Date.now() - execStart),
		stdoutTruncated: false,
		stderrTruncated: false,
		memory: 0,
	};
}
