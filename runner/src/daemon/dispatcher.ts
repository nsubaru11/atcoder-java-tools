import {type ChildProcessWithoutNullStreams, spawn} from "node:child_process";
import readline from "node:readline";
import type {CompileEntry, DispatcherRunResult} from "../types";
import {RUNNER_CONFIG, WARMUP_REPEAT_COUNT,} from "../config";
import {firstLine, logInfo, logWarn, trimForLog,} from "../utils";
import {compileDispatcher, getCompiledEntry, JAVA_ENV, JAVA_PATH,} from "./compiler";
import fs from "node:fs";

export interface DispatcherCompileResult {
	exitCode: number;
	diagnostics: string;
	timedOut?: boolean;
}

interface PendingRequest {
	id: string;
	resolve: (value: any) => void;
	reject: (error: Error) => void;
}

const dispatcherState: {
	proc: ChildProcessWithoutNullStreams | null;
	readline: readline.Interface | null;
	startupPromise: Promise<void> | null;
	currentRequest: PendingRequest | null;
	requestQueue: Promise<unknown>;
	nextRequestId: number;
} = {
	proc: null,
	readline: null,
	startupPromise: null,
	currentRequest: null,
	requestQueue: Promise.resolve(null),
	nextRequestId: 0,
};

let hasDispatcherWarmedUp = false;

function encodeField(value: string) {
	return Buffer.from(value ?? "", "utf8").toString("base64");
}

function decodeField(value: string) {
	return Buffer.from(value, "base64").toString("utf8");
}

function buildWarmUpSourceCode() {
	let sourceCode: string;
	try {
		sourceCode = fs.readFileSync(RUNNER_CONFIG.warmUpSourceFile, "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`failed to load ${RUNNER_CONFIG.warmUpSourceFile}: ${message}`);
	}

	const classDeclarationPattern = new RegExp(
		`public\\s+final\\s+class\\s+${RUNNER_CONFIG.warmUpSourceClassName}\\b`,
	);
	if (!classDeclarationPattern.test(sourceCode)) {
		throw new Error(`class declaration not found in ${RUNNER_CONFIG.warmUpSourceFile}`);
	}
	return sourceCode.replace(
		classDeclarationPattern,
		`public final class ${RUNNER_CONFIG.warmUpTargetClassName}`,
	);
}

export function stopDispatcher() {
	if (dispatcherState.readline) {
		dispatcherState.readline.close();
		dispatcherState.readline = null;
	}
	if (dispatcherState.proc) {
		dispatcherState.proc.kill("SIGKILL");
		dispatcherState.proc = null;
	}
	if (dispatcherState.currentRequest) {
		dispatcherState.currentRequest.reject(new Error("Dispatcher stopped while a request was running."));
		dispatcherState.currentRequest = null;
	}
}

function handleDispatcherResponse(line: string) {
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
	if (responseType === "COMPILED") {
		pendingRequest.resolve({
			exitCode: Number(parts[2]),
			diagnostics: decodeField(parts[3] || ""),
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
	await new Promise<void>((resolve, reject) => {
		const proc = spawn(JAVA_PATH, ["-cp", RUNNER_CONFIG.dispatcherBuildDir, "Dispatcher"], {
			cwd: RUNNER_CONFIG.dispatcherBuildDir,
			env: JAVA_ENV,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const lineReader = readline.createInterface({
			input: proc.stdout,
			crlfDelay: Infinity,
		});
		let settled = false;
		let readyTimer: NodeJS.Timeout | null = null;
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
		const settleReject = (error: Error) => {
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
			proc.kill("SIGKILL");
			settleReject(new Error("Dispatcher startup timed out."));
		}, RUNNER_CONFIG.dispatcherStartupTimeoutMs);
	});
}

export async function ensureDispatcherReady() {
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

export async function warmUpDispatcher() {
	if (hasDispatcherWarmedUp) {
		return;
	}
	logInfo(
		`Warm up dispatcher... profile=${RUNNER_CONFIG.warmUpProfile} repeat=${WARMUP_REPEAT_COUNT} timeout=${RUNNER_CONFIG.warmUpRunTimeoutMs}ms`,
	);
	const warmupSourceCode = buildWarmUpSourceCode();
	const warmupEntry = await getCompiledEntry(warmupSourceCode);
	if (warmupEntry.status !== "compiled") {
		throw new Error(`[WarmUp] compile failed: ${firstLine(warmupEntry.error) || "unknown error"}`);
	}
	for (let i = 1; i <= WARMUP_REPEAT_COUNT; i++) {
		const result = await queueDispatcherRun(warmupEntry, RUNNER_CONFIG.warmUpStdin, RUNNER_CONFIG.warmUpRunTimeoutMs);
		if (result.timedOut) {
			throw new Error(`[WarmUp] run ${i}/${WARMUP_REPEAT_COUNT} timeout ${RUNNER_CONFIG.warmUpRunTimeoutMs}ms`);
		}
		if (result.exitCode !== 0) {
			const err = firstLine(result.stderr);
			throw new Error(`[WarmUp] run ${i}/${WARMUP_REPEAT_COUNT} runtime error${err ? `: ${trimForLog(err)}` : ""}`);
		}
		logInfo(`[WarmUp] run ${i}/${WARMUP_REPEAT_COUNT} done ${result.time}ms`);
	}
	hasDispatcherWarmedUp = true;
}

export function logCaptureAndBodySizeBalance() {
	if (RUNNER_CONFIG.maxBodySize < RUNNER_CONFIG.dispatcherCaptureLimitBytes) {
		logWarn(
			`[Config] MAX_BODY_SIZE (${RUNNER_CONFIG.maxBodySize}) is smaller than LOCAL_RUNNER_CAPTURE_LIMIT_BYTES (${RUNNER_CONFIG.dispatcherCaptureLimitBytes}).`,
		);
	}
}

export function queueDispatcherRun(
	entry: CompileEntry,
	standardInput: string,
	timeoutMs = RUNNER_CONFIG.runTimeoutMs,
) {
	dispatcherState.requestQueue = dispatcherState.requestQueue
		.catch(() => null)
		.then(async () => {
			await ensureDispatcherReady();
			return new Promise<DispatcherRunResult>((resolve, reject) => {
				const requestId = String(++dispatcherState.nextRequestId);
				let settled = false;
				let timeoutHandle: NodeJS.Timeout | null = null;
				const finishResolve = (value: DispatcherRunResult) => {
					if (settled) {
						return;
					}
					settled = true;
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}
					resolve(value);
				};
				const finishReject = (error: Error) => {
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
				dispatcherState.proc!.stdin.write(`${command}\n`, "utf8", (error) => {
					if (error) {
						if (dispatcherState.currentRequest && dispatcherState.currentRequest.id === requestId) {
							dispatcherState.currentRequest = null;
						}
						finishReject(error);
					}
				});
			});
		});
	return dispatcherState.requestQueue as Promise<DispatcherRunResult>;
}

export function queueDispatcherCompile(
	sourceFile: string,
	classDir: string,
	timeoutMs = RUNNER_CONFIG.compileTimeoutMs,
): Promise<DispatcherCompileResult> {
	dispatcherState.requestQueue = dispatcherState.requestQueue
		.catch(() => null)
		.then(async () => {
			await ensureDispatcherReady();
			return new Promise<DispatcherCompileResult>((resolve, reject) => {
				const requestId = String(++dispatcherState.nextRequestId);
				let settled = false;
				let timeoutHandle: NodeJS.Timeout | null = null;
				const finishResolve = (value: DispatcherCompileResult) => {
					if (settled) {
						return;
					}
					settled = true;
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}
					resolve(value);
				};
				const finishReject = (error: Error) => {
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
					if (dispatcherState.currentRequest && dispatcherState.currentRequest.id === requestId) {
						dispatcherState.currentRequest = null;
					}
					stopDispatcher();
					finishResolve({
						exitCode: 1,
						diagnostics: `Compilation timed out after ${timeoutMs}ms.`,
						timedOut: true
					});
				}, timeoutMs);

				const command = ["COMPILE", requestId, encodeField(sourceFile), encodeField(classDir)].join("\t");
				dispatcherState.proc!.stdin.write(`${command}\n`, "utf8", (error) => {
					if (error) {
						if (dispatcherState.currentRequest && dispatcherState.currentRequest.id === requestId) {
							dispatcherState.currentRequest = null;
						}
						finishReject(error);
					}
				});
			});
		});
	return dispatcherState.requestQueue as Promise<DispatcherCompileResult>;
}
