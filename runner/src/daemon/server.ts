import http from "node:http";
import {pathToFileURL} from "node:url";
import type {LocalRunnerCompilerInfo, LocalRunnerRunResponse} from "@atcoder-tools/shared";
import {LOG_FILE_PATH, RUNNER_CONFIG, WARMUP_REPEAT_COUNT} from "../config";
import {ensureDirectory, formatRunSummary, logError, logInfo, logWarn,} from "../utils";
import {getCompiledEntry, JAVA_VERSION, runCodeInIsolatedJvm, RUNNER_LABEL, warmUpJavaTools,} from "./compiler";
import {
	ensureDispatcherReady,
	logCaptureAndBodySizeBalance,
	queueDispatcherRun,
	stopDispatcher,
	warmUpDispatcher,
} from "./dispatcher";

async function runCode({sourceCode, stdin}: { sourceCode: string; stdin?: string }): Promise<LocalRunnerRunResponse> {
	const overallStart = Date.now();
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
			memory: 0,
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
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > RUNNER_CONFIG.maxBodySize) {
			res.writeHead(413, {"Content-Type": "text/plain"});
			res.end("Request Entity Too Large");
			return;
		}
		body += buffer.toString("utf8");
	}

	let request: { mode?: string; sourceCode?: string; stdin?: string };
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
			await getCompiledEntry(request.sourceCode);
			response = {status: "accepted"};
		} else if (request.mode === "run" && typeof request.sourceCode === "string") {
			response = await runCode({
				sourceCode: request.sourceCode,
				stdin: request.stdin,
			});
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
	logInfo(`Local runner base directory: ${RUNNER_CONFIG.baseDir}`);
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
	server.listen(RUNNER_CONFIG.port, () => {
		logInfo(`LocalRunner server listening on http://localhost:${RUNNER_CONFIG.port}`);
		logInfo(`Runner label: ${RUNNER_LABEL}`);
	});
}

function shutdown(signal: string) {
	logInfo(`Shutting down LocalRunner server (${signal})...`);
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
