import http from "node:http";
import {pathToFileURL} from "node:url";
import type {LocalRunnerCompilerInfo, LocalRunnerRunResponse} from "@atcoder-tools/shared";
import type {LocalRunnerTransformResponse} from "@atcoder-tools/shared";
import type {RunnerStatusInfo} from "../types";
import {LOG_FILE_PATH, prepareLibrarySourceRoot, resolveLibrarySourceRoot, RUNNER_CONFIG, WARMUP_REPEAT_COUNT} from "../config";
import {ensureDirectory, formatRunSummary, logError, logInfo, logWarn,} from "../utils";
import {
	getCompileCacheSize,
	getCompiledEntry,
	JAVA_VERSION,
	runCodeInIsolatedJvm,
	RUNNER_LABEL,
	warmUpJavaTools,
} from "./compiler";
import {
	ensureDispatcherReady,
	isDispatcherRunning,
	logCaptureAndBodySizeBalance,
	queueDispatcherRun,
	queueDispatcherTransform,
	stopDispatcher,
	warmUpDispatcher,
	warmUpSourceTransformer,
} from "./dispatcher";

const serverStartedAt = Date.now();
const PRECOMPILE_IDLE_DELAY_MS = 1500;
let precompileTimer: NodeJS.Timeout | null = null;

// ローカルランナーを利用するユーザースクリプトが動作するジャッジサイト（EasyTest の @match と一致）。
// これらのホスト（およびサブドメイン）からのブラウザ要求のみ許可する。
const DEFAULT_ALLOWED_ORIGIN_HOSTS = [
	"atcoder.jp", "yukicoder.me", "codeforces.com", "onlinejudge.u-aizu.ac.jp", "judge.yosupo.jp", "paiza.jp",
];

// LOCAL_RUNNER_ALLOWED_ORIGINS で完全一致のオリジン許可リストに差し替え可能（カンマ区切り）。
const ALLOWED_ORIGINS_OVERRIDE = (process.env.LOCAL_RUNNER_ALLOWED_ORIGINS || "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

/** ブラウザ Origin を検査する。Origin 無し（非ブラウザ＝CLI 等）は許可。 */
function isAllowedOrigin(origin: string | undefined): boolean {
	if (!origin) return true;
	if (ALLOWED_ORIGINS_OVERRIDE.length > 0) return ALLOWED_ORIGINS_OVERRIDE.includes(origin);
	let host: string;
	try {
		host = new URL(origin).hostname;
	} catch {
		return false;
	}
	return DEFAULT_ALLOWED_ORIGIN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

async function transformCode(sourceCode: string, debug: boolean, autoImport = true,
	validate = true): Promise<LocalRunnerTransformResponse> {
	const result = await queueDispatcherTransform(sourceCode, resolveLibrarySourceRoot(), debug, autoImport, validate);
	return {
		status: result.exitCode === 0 ? "success" : "compileError",
		sourceCode: result.sourceCode,
		diagnostics: result.diagnostics,
		inlinedClasses: result.inlinedClasses,
		addedImports: result.addedImports,
		diagnosticItems: result.diagnosticItems,
	};
}

async function runCode({sourceCode, stdin, prepared}: { sourceCode: string; stdin?: string; prepared?: boolean }): Promise<LocalRunnerRunResponse> {
	const overallStart = Date.now();
	if (!prepared) {
		const transformed = await transformCode(sourceCode, true, true);
		if (transformed.status !== "success") {
			return {
				status: "compileError", exitCode: 1, stdout: "", stderr: transformed.diagnostics,
				time: Date.now() - overallStart, stdoutTruncated: false, stderrTruncated: false, memory: 0,
			};
		}
		sourceCode = transformed.sourceCode;
	}
	const entry = await getCompiledEntry(sourceCode);
	const waitTime = Date.now() - overallStart;

	if (entry.status === "error") {
		const response: LocalRunnerRunResponse = {
			status: "compileError",
			exitCode: 1,
			stdout: "",
			stderr: entry.error || "",
			time: waitTime,
			stdoutTruncated: false,
			stderrTruncated: false,
			memory: 0,
		};
		logWarn(formatRunSummary(response, waitTime, Date.now() - overallStart, "compile"));
		return response;
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
			const response: LocalRunnerRunResponse = {
				status: "timeLimitExceeded",
				exitCode: 124,
				stdout: "",
				stderr: result.error || "",
				time: RUNNER_CONFIG.runTimeoutMs,
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
		const response: LocalRunnerRunResponse = {
			status: result.exitCode === 0 ? "success" : "runtimeError",
			exitCode: result.exitCode ?? -1,
			stdout: result.stdout || "",
			stderr: result.stderr || "",
			time: result.time || 0,
			stdoutTruncated: !!result.stdoutTruncated,
			stderrTruncated: !!result.stderrTruncated,
			// Java は累積アロケーション量をバイトで返す（-1=計測不可）。表示系は KB 想定なので KB に変換。
			memory: result.memory && result.memory > 0 ? Math.round(result.memory / 1024) : 0,
		};
		const logger = response.status === "success" ? logInfo : logWarn;
		logger(formatRunSummary(response, waitTime, totalTime, "daemon"));
		return response;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logError(`[Run] Internal error: ${message}`);
		const response: LocalRunnerRunResponse = {
			status: "internalError",
			exitCode: -1,
			stdout: "",
			stderr: message,
			time: 0,
			stdoutTruncated: false,
			stderrTruncated: false,
			memory: 0,
		};
		logError(formatRunSummary(response, waitTime, Date.now() - overallStart, "daemon"));
		return response;
	}
}

function schedulePrecompile(sourceCode: string): void {
	if (precompileTimer) clearTimeout(precompileTimer);
	precompileTimer = setTimeout(() => {
		precompileTimer = null;
		void (async () => {
			try {
				const transformed = await transformCode(sourceCode, true, true);
				if (transformed.status === "success") await getCompiledEntry(transformed.sourceCode);
			} catch (error) {
				logWarn(`[Precompile] ${error instanceof Error ? error.message : String(error)}`);
			}
		})();
	}, PRECOMPILE_IDLE_DELAY_MS);
}

const server = http.createServer(async (req, res) => {
	// CORS/Origin ゲート。ブラウザからの要求は Origin ヘッダを必ず伴うため、
	// 許可した競プロジャッジのサイト以外からの実行を「実処理の前に」拒否する。
	// （悪意あるサイトの単純 POST は応答を読めないだけで副作用＝任意コード実行は起きてしまうため、
	//   CORS 応答ヘッダだけでなくサーバ側で 403 を返して実行そのものを止める必要がある。）
	// Origin ヘッダの無い要求（CLI/bun の fetch 等、非ブラウザ）は従来どおり許可する。
	const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
	const originAllowed = isAllowedOrigin(origin);
	if (origin && originAllowed) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Vary", "Origin");
	}
	res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");

	if (!originAllowed) {
		logWarn(`[Server] Rejected request from disallowed origin: ${origin}`);
		res.writeHead(403, {"Content-Type": "text/plain"});
		res.end("Forbidden origin");
		return;
	}

	if (req.method === "OPTIONS") {
		res.writeHead(204);
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
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > RUNNER_CONFIG.maxBodySize) {
			res.writeHead(413, {"Content-Type": "text/plain"});
			res.end("Request Entity Too Large");
			return;
		}
		body += buffer.toString("utf8");
	}

	let request: { mode?: string; sourceCode?: string; stdin?: string; prepared?: boolean; debug?: boolean;
		autoImport?: boolean; validate?: boolean };
	try {
		request = JSON.parse(body) as { mode?: string; sourceCode?: string; stdin?: string };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		res.writeHead(400, {"Content-Type": "application/json"});
		res.end(JSON.stringify({status: "badRequest", stderr: `Invalid JSON: ${message}`}));
		return;
	}

	if (!request || typeof request !== "object" || Array.isArray(request)) {
		res.writeHead(400, {"Content-Type": "application/json"});
		res.end(JSON.stringify({status: "badRequest", stderr: "Request body must be a JSON object."}));
		return;
	}

	try {
		let response;
		if (request.mode === "list") {
			response = [
				{
					language: "Java",
					compilerName: `java${JAVA_VERSION}`,
					label: RUNNER_LABEL,
				},
			] satisfies LocalRunnerCompilerInfo[];
		} else if (request.mode === "precompile" && typeof request.sourceCode === "string") {
			schedulePrecompile(request.sourceCode);
			response = {status: "accepted"};
		} else if (request.mode === "transform" && typeof request.sourceCode === "string") {
			response = await transformCode(request.sourceCode, !!request.debug, request.autoImport !== false,
				request.validate !== false);
		} else if (request.mode === "run" && typeof request.sourceCode === "string") {
			response = await runCode({
				sourceCode: request.sourceCode,
				stdin: request.stdin,
				prepared: request.prepared,
			});
		} else if (request.mode === "status") {
			response = {
				status: "running",
				pid: process.pid,
				uptimeMs: Date.now() - serverStartedAt,
				javaVersion: JAVA_VERSION,
				runnerLabel: RUNNER_LABEL,
				dispatcherRunning: isDispatcherRunning(),
				compileCacheSize: getCompileCacheSize(),
				compileCacheMax: RUNNER_CONFIG.maxCacheSize,
				warmUpProfile: RUNNER_CONFIG.warmUpProfile,
				baseDir: RUNNER_CONFIG.baseDir,
				logFile: LOG_FILE_PATH,
			} satisfies RunnerStatusInfo;
		} else if (request.mode === "shutdown") {
			res.writeHead(200, {"Content-Type": "application/json", "Connection": "close"});
			res.end(JSON.stringify({status: "accepted"}));
			logInfo("Shutdown requested via API.");
			setTimeout(() => shutdown("api"), 50);
			return;
		} else {
			res.writeHead(400, {"Content-Type": "application/json"});
			res.end(JSON.stringify({status: "badRequest", stderr: `Unknown mode: ${String(request.mode)}`}));
			return;
		}

		res.writeHead(200, {"Content-Type": "application/json"});
		res.end(JSON.stringify(response));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		res.writeHead(500, {"Content-Type": "application/json"});
		res.end(JSON.stringify({status: "internalError", stderr: message}));
	}
});

async function bootstrap() {
	ensureDirectory(RUNNER_CONFIG.baseDir);
	ensureDirectory(RUNNER_CONFIG.compileRootDir);
	const libraryRoots = prepareLibrarySourceRoot();
	logInfo(`Local runner base directory: ${RUNNER_CONFIG.baseDir}`);
	logInfo(`Library source: ${libraryRoots.source}`);
	logInfo(`Prepared library source: ${libraryRoots.prepared}`);
	logInfo(`Log file: ${LOG_FILE_PATH}`);
	logInfo(`Log rotation size: ${RUNNER_CONFIG.maxLogFileSize} bytes`);
	logInfo(`Dispatcher capture limit: ${RUNNER_CONFIG.dispatcherCaptureLimitBytes} bytes`);
	logInfo(`WarmUp profile: ${RUNNER_CONFIG.warmUpProfile} (repeat=${WARMUP_REPEAT_COUNT}, timeout=${RUNNER_CONFIG.warmUpRunTimeoutMs}ms)`);
	logCaptureAndBodySizeBalance();
	if (process.platform === "linux" && RUNNER_CONFIG.baseDir.startsWith("/dev/shm")) {
		logInfo("Using /dev/shm for low-latency compile cache.");
	}
	warmUpJavaTools();
	ensureDirectory(RUNNER_CONFIG.dispatcherBuildDir);
	await ensureDispatcherReady();
	await warmUpDispatcher();
	await warmUpSourceTransformer(resolveLibrarySourceRoot());
	// 既定でループバック(127.0.0.1)にのみバインドし、LAN/リモートからの無認証アクセスを遮断する。
	// どうしても外部公開が必要な場合のみ LOCAL_RUNNER_HOST で上書き可能（非推奨）。
	const host = process.env.LOCAL_RUNNER_HOST || "127.0.0.1";
	server.listen(RUNNER_CONFIG.port, host, () => {
		logInfo(`LocalRunner server listening on http://${host}:${RUNNER_CONFIG.port}`);
		logInfo(`Allowed browser origins: ${ALLOWED_ORIGINS_OVERRIDE.length > 0 ? ALLOWED_ORIGINS_OVERRIDE.join(", ") : DEFAULT_ALLOWED_ORIGIN_HOSTS.map((h) => `*.${h}`).join(", ")}`);
		logInfo(`Runner label: ${RUNNER_LABEL}`);
	});
}

function shutdown(signal: string) {
	logInfo(`Shutting down LocalRunner server (${signal})...`);
	if (precompileTimer) clearTimeout(precompileTimer);
	stopDispatcher();
	server.close(() => {
		process.exit(0);
	});
	// 接続が残っていても確実にプロセスを終了させる保険。
	setTimeout(() => process.exit(0), 1500).unref();
}

server.on("error", (error) => {
	logError(`[Server] ${error.message}`);
	process.exit(1);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("exit", () => stopDispatcher());

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectRun) {
	try {
		await bootstrap();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logError(`[Bootstrap] ${message}`);
		process.exit(1);
	}
}
