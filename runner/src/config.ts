import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const importMetaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolveProjectRoot() {
	const envRoot = process.env.LOCAL_RUNNER_PROJECT_ROOT;
	// コンパイル済みバイナリでは import.meta.url / argv[0] が bunfs(例: B:\~BUN\...) を指すため、
	// 実ファイル位置は process.execPath を使う。bin/ 配置なら execPath の 2つ上が tools。
	const execDir = process.execPath ? path.dirname(process.execPath) : "";
	const argvDir = process.argv[0] ? path.dirname(process.argv[0]) : "";
	const roots = [execDir, argvDir]
		.filter(Boolean)
		.flatMap((d) => [path.resolve(d, ".."), path.resolve(d, "../..")]);
	const candidates = [envRoot, importMetaRoot, ...roots].filter(Boolean) as string[];
	for (const candidate of candidates) {
		if (fs.existsSync(path.join(candidate, "runner", "java", "src", "Dispatcher.java"))) {
			return candidate;
		}
	}
	return importMetaRoot;
}

export const PROJECT_ROOT = resolveProjectRoot();

let preparedLibrarySourceRoot: string | null = null;

function findLibrarySourceRoot(): string {
	const candidates = [
		process.env.ATCODER_LIB_SRC,
		path.resolve(PROJECT_ROOT, "../library/src"),
		path.resolve(PROJECT_ROOT, "library/src"),
	].filter(Boolean) as string[];
	for (const candidate of candidates) {
		if (fs.existsSync(path.join(candidate, "lib"))) return path.resolve(candidate);
	}
	throw new Error(`Library source root not found. Tried: ${candidates.join(", ")}`);
}

export function resolveLibrarySourceRoot(): string {
	return preparedLibrarySourceRoot || findLibrarySourceRoot();
}

export const CLI_CONFIG = {
	defaultLocalRunnerUrl: process.env.LOCAL_RUNNER_URL || "http://localhost:8080",
	submissionPollIntervalMs: 1000,
	// 提出→確定まで（混雑時は数分かかることがある）。既定5分、ATCODER_SUBMISSION_POLL_TIMEOUT_MS で上書き可。
	submissionPollTimeoutMs: Number(process.env.ATCODER_SUBMISSION_POLL_TIMEOUT_MS || 300000),
	submissionIdDetectTimeoutMs: 45000,
	submissionIdDetectIntervalMs: 800,
	submitPostRetryMax: Number(process.env.ATCODER_SUBMIT_RETRY_MAX || 5),
	submitPostRetryBaseMs: Number(process.env.ATCODER_SUBMIT_RETRY_BASE_MS || 1200),
	defaultSessionFileRelative: path.join(".atcoder", "session.txt"),
	defaultLanguageId: "6056",
	userAgent: "AtCoder-JavaCodeSubmitter-CLI/1.0",
	// サンプルキャッシュ: パース済みサンプルを ~/.atcoder/cache/samples/<task>.json に保存する。
	// サンプルは確定後不変なので TTL なし。ATCODER_NO_CACHE=1 で無効化。
	sampleCacheDirRelative: path.join(".atcoder", "cache", "samples"),
	// 上限超過時は古いものから削除（1件あたり概ね数KB なので既定 2000 件 ≒ 最大十数MB 程度）。
	sampleCacheMaxEntries: Number(process.env.ATCODER_SAMPLE_CACHE_MAX || 2000),
};

const defaultRunnerBaseDir = process.platform === "linux"
	? "/dev/shm/atcoder-local-runner"
	: path.join(os.tmpdir(), "atcoder-local-runner");

export function resolveDispatcherSourceFile() {
	const envPath = process.env.LOCAL_RUNNER_DISPATCHER_SOURCE;
	const candidates = [
		envPath,
		path.join(PROJECT_ROOT, "runner", "java", "src", "Dispatcher.java")
	].filter(Boolean) as string[];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(`Dispatcher source not found. Tried: ${candidates.join(", ")}`);
}

export const RUNNER_CONFIG = {
	port: Number(process.env.LOCAL_RUNNER_PORT || 8080),
	maxBodySize: 4 * 1024 * 1024,
	maxLogFileSize: Number(process.env.LOCAL_RUNNER_MAX_LOG_FILE_SIZE_BYTES || (8 * 1024 * 1024)),
	maxCacheSize: 10,
	compileTimeoutMs: 30000,
	runTimeoutMs: 10000,
	dispatcherStartupTimeoutMs: 10000,
	dispatcherCaptureLimitBytes: Number(process.env.LOCAL_RUNNER_CAPTURE_LIMIT_BYTES || (2 << 20)),
	baseDir: process.env.LOCAL_RUNNER_BASE_DIR || defaultRunnerBaseDir,
	compileRootDir: path.join(process.env.LOCAL_RUNNER_BASE_DIR || defaultRunnerBaseDir, "compiled"),
	dispatcherBuildDir: path.join(process.env.LOCAL_RUNNER_BASE_DIR || defaultRunnerBaseDir, "dispatcher"),
	warmUpSourceFile: path.join(PROJECT_ROOT, "runner", "java", "src", "WarmUp.java"),
	warmUpSourceClassName: "WarmUp",
	warmUpTargetClassName: "Main",
	warmUpStdin: "",
	warmUpProfile: (process.env.LOCAL_RUNNER_WARMUP_PROFILE || "full").toLowerCase(),
	warmUpRunTimeoutMs: Number(process.env.LOCAL_RUNNER_WARMUP_TIMEOUT_MS || 30000),
};

export function prepareLibrarySourceRoot(): {source: string; prepared: string} {
	const source = findLibrarySourceRoot();
	if (process.platform !== "linux") {
		preparedLibrarySourceRoot = source;
		return {source, prepared: source};
	}
	const prepared = path.join(RUNNER_CONFIG.baseDir, "library-source");
	fs.rmSync(prepared, {recursive: true, force: true});
	fs.mkdirSync(prepared, {recursive: true});
	fs.cpSync(path.join(source, "lib"), path.join(prepared, "lib"), {recursive: true, force: true});
	preparedLibrarySourceRoot = prepared;
	return {source, prepared};
}

export const LOG_FILE_PATH = path.join(RUNNER_CONFIG.baseDir, "local-runner.log");
export const DISPATCHER_CLASS_FILE = path.join(RUNNER_CONFIG.dispatcherBuildDir, "Dispatcher.class");

export function parseWarmUpRepeatCount(rawValue: string | undefined, fallbackValue: number) {
	if (rawValue == null) {
		return fallbackValue;
	}
	const parsed = Number(rawValue);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return fallbackValue;
	}
	return Math.floor(parsed);
}

export const WARMUP_REPEAT_COUNT = parseWarmUpRepeatCount(
	process.env.LOCAL_RUNNER_WARMUP_REPEAT,
	RUNNER_CONFIG.warmUpProfile === "quick" ? 1 : 2,
);
