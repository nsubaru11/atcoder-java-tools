import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const importMetaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolveProjectRoot() {
	const envRoot = process.env.LOCAL_RUNNER_PROJECT_ROOT;
	const argvRoot = process.argv[0]
		? path.resolve(path.dirname(process.argv[0]), "..")
		: "";
	const candidates = [envRoot, importMetaRoot, argvRoot].filter(Boolean) as string[];
	for (const candidate of candidates) {
		if (
			fs.existsSync(path.join(candidate, "runner", "src", "Dispatcher.java"))
			|| fs.existsSync(path.join(candidate, "runner", "Dispatcher.java"))
		) {
			return candidate;
		}
	}
	return importMetaRoot;
}

export const PROJECT_ROOT = resolveProjectRoot();

export const CLI_CONFIG = {
	defaultLocalRunnerUrl: process.env.LOCAL_RUNNER_URL || "http://localhost:8080",
	submissionPollIntervalMs: 1000,
	submissionPollTimeoutMs: 180000,
	submissionIdDetectTimeoutMs: 45000,
	submissionIdDetectIntervalMs: 800,
	submissionTerminalExtraFetchRetry: 10,
	submissionTerminalExtraFetchIntervalMs: 1000,
	submissionTerminalExtraFetchMaxWaitMs: Number(process.env.ATCODER_SUBMISSION_METRIC_WAIT_MS || 30000),
	submissionExecTimeLabels: ["Execution Time", "Exec Time", "実行時間"],
	submissionMemoryLabels: ["Memory", "メモリ"],
	submitPostRetryMax: Number(process.env.ATCODER_SUBMIT_RETRY_MAX || 5),
	submitPostRetryBaseMs: Number(process.env.ATCODER_SUBMIT_RETRY_BASE_MS || 1200),
	defaultSessionFileRelative: path.join(".atcoder", "session.txt"),
	defaultLanguageId: "6056",
	userAgent: "AtCoder-JavaCodeSubmitter-CLI/1.0",
};

const defaultRunnerBaseDir = process.platform === "linux"
	? "/dev/shm/atcoder-local-runner"
	: path.join(os.tmpdir(), "atcoder-local-runner");

export function resolveDispatcherSourceFile() {
	const envPath = process.env.LOCAL_RUNNER_DISPATCHER_SOURCE;
	const candidates = [
		envPath,
		path.join(PROJECT_ROOT, "runner", "Dispatcher.java"),
		path.join(PROJECT_ROOT, "runner", "src", "Dispatcher.java"),
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
	warmUpSourceFile: path.join(PROJECT_ROOT, "runner", "src", "WarmUp.java"),
	warmUpSourceClassName: "WarmUp",
	warmUpTargetClassName: "Main",
	warmUpStdin: "",
	warmUpProfile: (process.env.LOCAL_RUNNER_WARMUP_PROFILE || "full").toLowerCase(),
	warmUpRunTimeoutMs: Number(process.env.LOCAL_RUNNER_WARMUP_TIMEOUT_MS || 30000),
};

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
