import {spawn, spawnSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {LocalRunnerRunResponse} from "@atcoder-tools/shared";
import type {CompileEntry, ProcessResult} from "../types";
import {DISPATCHER_CLASS_FILE, resolveDispatcherSourceFile, RUNNER_CONFIG,} from "../config";
import {ensureDirectory, logInfo, logWarn, removeDirectory, shortHash,} from "../utils";
import {queueDispatcherCompile} from "./dispatcher";

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
const DISPATCHER_SOURCE_DIR = path.dirname(DISPATCHER_SOURCE_FILE);

/**
 * Dispatcher ソースディレクトリ配下の *.java をすべて列挙する。
 * Dispatcher は複数ファイル（Request/Response/ProtocolCodec/MessageChannel/Executor 等）で構成されるため、
 * 単一ファイルではなくディレクトリ全体をコンパイル対象・鮮度判定対象とする。
 */
function listDispatcherSources(): string[] {
	return fs
		.readdirSync(DISPATCHER_SOURCE_DIR)
		.filter((name) => name.endsWith(".java") && name !== "WarmUp.java")
		.map((name) => path.join(DISPATCHER_SOURCE_DIR, name));
}

/** 与えたソース群の最新 mtime（ミリ秒）を返す。 */
function newestSourceMtime(sources: string[]): number {
	return sources.reduce((max, file) => Math.max(max, fs.statSync(file).mtimeMs), 0);
}

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
	const digest = crypto.createHash("md5").update(`java=${JAVA_VERSION}\nencoding=UTF-8\n${sourceCode}`).digest("hex");
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
		// 出力はチャンクごとに toString せず Buffer のまま蓄積し、最後に一括デコードする。
		// これによりマルチバイト文字がチャンク境界で分断されて文字化けするのを防ぐ。
		// さらに上限（常駐経路と同じ CAPTURE_LIMIT）で切り詰め、隔離実行や巨大診断で
		// daemon 側メモリが際限なく膨らむのを防ぐ。
		const captureLimit = Math.max(1, RUNNER_CONFIG.dispatcherCaptureLimitBytes);
		type OutputSink = { chunks: Buffer[]; length: number; truncated: boolean };
		const createSink = (): OutputSink => ({chunks: [], length: 0, truncated: false});
		const stdoutSink = createSink();
		const stderrSink = createSink();
		const appendChunk = (sink: OutputSink, data: unknown) => {
			const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
			if (sink.length >= captureLimit) {
				sink.truncated = true;
				return;
			}
			const writable = Math.min(buffer.length, captureLimit - sink.length);
			sink.chunks.push(writable === buffer.length ? buffer : buffer.subarray(0, writable));
			sink.length += writable;
			if (writable < buffer.length) sink.truncated = true;
		};
		const decodeSink = (sink: OutputSink) => Buffer.concat(sink.chunks).toString("utf8");
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
			proc.stdout.on("data", (data) => appendChunk(stdoutSink, data));
		}
		if (proc.stderr) {
			proc.stderr.on("data", (data) => appendChunk(stderrSink, data));
		}
		if (options.input !== undefined && proc.stdin) {
			proc.stdin.end(options.input, "utf8");
		} else if (proc.stdin) {
			proc.stdin.end();
		}

		proc.on("close", (code, signal) => {
			finish({
				code: code ?? -1,
				signal,
				stdout: decodeSink(stdoutSink),
				stderr: decodeSink(stderrSink),
				timedOut,
				stdoutTruncated: stdoutSink.truncated,
				stderrTruncated: stderrSink.truncated,
			});
		});

		proc.on("error", (error) => {
			const stderrText = decodeSink(stderrSink);
			finish({
				code: -1,
				signal: null,
				stdout: decodeSink(stdoutSink),
				stderr: stderrText ? `${stderrText}\n${error.message}` : error.message,
				timedOut,
				stdoutTruncated: stdoutSink.truncated,
				stderrTruncated: stderrSink.truncated,
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
	const sources = listDispatcherSources();
	// ソース未変更ならキャッシュ済み Dispatcher.class を再利用し、毎起動の javac を省く。
	// （複数ファイル構成なので src 配下 *.java の最新 mtime で判定する。
	//   TLE で dispatcher が SIGKILL→再起動する際の回復も速くなる）
	try {
		if (fs.existsSync(DISPATCHER_CLASS_FILE)) {
			const sourceMtime = newestSourceMtime(sources);
			const classMtime = fs.statSync(DISPATCHER_CLASS_FILE).mtimeMs;
			if (classMtime >= sourceMtime) {
				return;
			}
		}
	} catch {
		// stat 失敗時は通常コンパイルにフォールバック
	}
	const result = await runProcessCommand(
		JAVAC_PATH,
		["-encoding", "UTF-8", "-g", "-d", RUNNER_CONFIG.dispatcherBuildDir, ...sources],
		{env: JAVA_ENV, timeoutMs: RUNNER_CONFIG.compileTimeoutMs},
	);
	if (result.code !== 0 || result.timedOut || !fs.existsSync(DISPATCHER_CLASS_FILE)) {
		throw new Error(result.stderr || "Failed to compile Dispatcher.java.");
	}
}

// 外部 javac 経路・マーカー欠落時のフォールバック検出（ソース正規表現）。
// 既定の常駐内コンパイル経路では Java 側のバイトコード検査（COMPILED.requiresIsolation）を使う。
// バイトコード検査(IsolationAnalyzer.DANGEROUS_MEMBERS)と検出範囲を揃えるため、
// System.setOut/setErr/setIn・setProperty 系・Locale/TimeZone.setDefault・
// addShutdownHook/removeShutdownHook・Runtime.exec・ProcessBuilder も対象に含める。
// 正規表現なのでコメント/文字列に一致して過検出しうるが、その場合は隔離（安全側）へ倒れるだけで問題ない。
const ISOLATION_SOURCE_PATTERNS: readonly RegExp[] = [
	/\bSystem\s*\.\s*exit\s*\(/,
	/\bSystem\s*\.\s*(?:setOut|setErr|setIn)\s*\(/,
	/\bSystem\s*\.\s*(?:setProperty|setProperties|clearProperty|setSecurityManager)\s*\(/,
	/\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*(?:exit|halt|addShutdownHook|removeShutdownHook|exec)\s*\(/,
	/\bnew\s+ProcessBuilder\b/,
	/\bFileDescriptor\s*\.\s*(?:in|out|err)\b/,
	/\bLocale\s*\.\s*setDefault\s*\(/,
	/\bTimeZone\s*\.\s*setDefault\s*\(/,
];

function requiresIsolatedProcess(sourceCode: string) {
	return ISOLATION_SOURCE_PATTERNS.some((pattern) => pattern.test(sourceCode));
}

function isolationMarkerPath(rootDir: string) {
	return path.join(rootDir, ".isolation");
}

// バイトコード検査の結果をディスクに残し、再起動後のキャッシュヒットでも一貫して使えるようにする。
function writeIsolationMarker(rootDir: string, requiresIsolation: boolean) {
	try {
		fs.writeFileSync(isolationMarkerPath(rootDir), requiresIsolation ? "1" : "0", "utf8");
	} catch {
	}
}

function readIsolationMarker(rootDir: string, sourceCode: string): boolean {
	try {
		const raw = fs.readFileSync(isolationMarkerPath(rootDir), "utf8").trim();
		if (raw === "1") return true;
		if (raw === "0") return false;
	} catch {
	}
	return requiresIsolatedProcess(sourceCode);
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
				requiresIsolatedProcess: readIsolationMarker(rootDir, sourceCode),
				status: "compiled",
				error: null,
			};
		}
	}

	removeDirectory(rootDir);
	ensureDirectory(classDir);
	fs.writeFileSync(sourceFile, sourceCode, "utf8");

	// 既定では常駐 Dispatcher 内の javac でコンパイルし、外部 javac の JVM 起動コストを回避する。
	// LOCAL_RUNNER_INPROCESS_COMPILE=0 で従来の外部 javac にフォールバックできる。
	const useInProcessCompile = process.env.LOCAL_RUNNER_INPROCESS_COMPILE !== "0";
	const compileStart = Date.now();
	let compiled: boolean;
	let timedOut;
	let errorText;
	let requiresIsolation: boolean;
	if (useInProcessCompile) {
		const compileResult = await queueDispatcherCompile(sourceFile, classDir);
		timedOut = !!compileResult.timedOut;
		compiled = compileResult.exitCode === 0 && fs.existsSync(classFile);
		errorText = compileResult.diagnostics;
		requiresIsolation = !!compileResult.requiresIsolation;
	} else {
		const result = await runProcessCommand(
			JAVAC_PATH,
			["-encoding", "UTF-8", "-g", "-d", "classes", "Main.java"],
			{cwd: rootDir, env: JAVA_ENV, timeoutMs: RUNNER_CONFIG.compileTimeoutMs},
		);
		timedOut = result.timedOut;
		compiled = result.code === 0 && !result.timedOut && fs.existsSync(classFile);
		errorText = result.stderr;
		requiresIsolation = requiresIsolatedProcess(sourceCode);
	}
	const compileTime = Date.now() - compileStart;

	if (compiled) {
		logInfo(`[Compile] OK ${compileTime}ms -> ${shortHash(hash)}`);
		writeIsolationMarker(rootDir, requiresIsolation);
		return {
			rootDir,
			classDir,
			mainClass: "Main",
			requiresIsolatedProcess: requiresIsolation,
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
		error: timedOut
			? `Compilation timed out after ${RUNNER_CONFIG.compileTimeoutMs}ms.\n${errorText}`.trim()
			: (errorText || "Compilation failed."),
	};
}

/** コンパイルキャッシュの現在のエントリ数（status 表示用）。 */
export function getCompileCacheSize() {
	return compileCache.size;
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

export async function runCodeInIsolatedJvm(entry: CompileEntry, standardInput: string): Promise<LocalRunnerRunResponse> {
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
		stdoutTruncated: result.stdoutTruncated,
		stderrTruncated: result.stderrTruncated,
		memory: 0,
	};
}
