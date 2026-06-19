import {buildAtCoderSubmissionUrl} from "@atcoder-tools/shared";
import fs from "node:fs";
import path from "node:path";
import type {CliCommand} from "../types";
import {CLI_CONFIG} from "../config";
import {colorizeStatus, formatExecTime, normalizeNewlines} from "../utils";
import {
	fetchLatestSubmissionId,
	formatMetricValue,
	httpGetText,
	pollSubmissionFinal,
	submitToAtCoder,
	toCookieHeader,
} from "./atcoder";
import {extractSamples} from "./parser";
import {parseTask} from "./task";
import {forceMainAndDebug, resolveSourceFilePath} from "./transform";
import {postLocalRunner, printSampleResults, runSampleTests} from "./sampleJudge";
import {loadLocalSamples} from "./localSamples";
import {ensureLocalRunnerReady} from "./ensureServer";

export function printUsage() {
	console.error("Usage:");
	console.error("  test <taskScreenName> <sourceFile>");
	console.error("  submit [-f|--force] <taskScreenName> <sourceFile>");
	console.error("  tomain [-f|--force] <sourceFile> [outFile]");
	console.error("  localtest <sourceFile> [testDir]        (.in/.out をローカル実行。DEBUG有効)");
	console.error("  run <sourceFile> [inputFile]            (1回実行して出力表示。inputFile省略可。DEBUG有効)");
	console.error("  serve                                   (Local Runner サーバーだけ先に起動)");
	console.error("  stop                                    (Local Runner サーバーを停止)");
	console.error("Options:");
	console.error("  -f, --force    submit even if sample tests are not all AC / tomain: overwrite existing outFile");
}

/** Local Runner サーバーだけを先に起動して ready まで待つ（先回り起動）。 */
export async function runServe(): Promise<number> {
	await ensureLocalRunnerReady();
	console.log("Local Runner is up. これ以降の test / submit / localtest は即実行されます。");
	return 0;
}

/** Local Runner サーバーを停止する（mode:shutdown を投げて graceful 終了させる）。 */
export async function runStop(): Promise<number> {
	try {
		const res = await fetch(CLI_CONFIG.defaultLocalRunnerUrl, {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({mode: "shutdown"}),
			signal: AbortSignal.timeout(3000),
		});
		if (res.ok) {
			console.log("Local Runner を停止しました。");
			return 0;
		}
		console.error(`Local Runner の停止要求が失敗しました (status=${res.status})。`);
		return 1;
	} catch {
		console.log("Local Runner は起動していません（既に停止済み）。");
		return 0;
	}
}

/** ソースを1回だけ実行して出力を表示する（期待出力なし・DEBUG有効・入力ファイル省略可）。 */
export async function runRun(sourceFilePath: string, inputFile: string | undefined): Promise<number> {
	const {transformed, originalFileName, originalClassName} = prepareSource(sourceFilePath, true);
	await ensureLocalRunnerReady();
	const stdin = inputFile
		? normalizeNewlines(fs.readFileSync(path.resolve(inputFile), "utf8"))
		: "";
	const result = await postLocalRunner(transformed, stdin);

	console.log(`[run] status=${result.status} exit=${result.exitCode} time=${formatExecTime(result.time || 0)}`);
	const stdout = (result.stdout || "").replace(/\s+$/, "");
	console.log("[output]");
	console.log(stdout.length > 0 ? stdout.split(/\r?\n/).map((line) => `  ${line}`).join("\n") : "  (empty)");
	const stderr = (result.stderr || "").trim();
	if (stderr.length > 0) {
		console.log("[stderr]");
		const display = originalClassName
			? stderr.replace(/Main\.java/g, originalFileName).replace(/\bMain\b/g, originalClassName)
			: stderr;
		console.log(display.split(/\r?\n/).map((line) => `  ${line}`).join("\n"));
	}
	return result.exitCode === 0 ? 0 : 1;
}

function prepareSource(sourceFilePath: string, debug = false) {
	const resolvedSourcePath = resolveSourceFilePath(sourceFilePath);
	const source = normalizeNewlines(fs.readFileSync(resolvedSourcePath, "utf8"));
	const transformed = forceMainAndDebug(source, debug);
	const originalFileName = path.basename(resolvedSourcePath);
	const originalClassName = originalFileName.replace(/\.java$/i, "");
	return {resolvedSourcePath, transformed, originalFileName, originalClassName};
}

export async function runLocalTest(sourceFilePath: string, testDir: string | undefined): Promise<number> {
	const {resolvedSourcePath, transformed, originalFileName, originalClassName} = prepareSource(sourceFilePath, true);
	await ensureLocalRunnerReady();
	const samples = loadLocalSamples(resolvedSourcePath, testDir);
	const sampleResults = await runSampleTests(transformed, samples);
	const allAccepted = printSampleResults(sampleResults, originalClassName, originalFileName);
	return allAccepted ? 0 : 5;
}

export function runTomain(sourceFilePath: string, outFilePath: string | undefined, options: {
	force?: boolean
} = {}): number {
	const {resolvedSourcePath, transformed} = prepareSource(sourceFilePath);

	const outPath = outFilePath
		? path.resolve(outFilePath)
		: path.join(path.dirname(resolvedSourcePath), "Main.java");

	if (fs.existsSync(outPath) && !options.force) {
		throw new Error(`Output already exists: ${outPath} (use -f/--force to overwrite)`);
	}

	fs.mkdirSync(path.dirname(outPath), {recursive: true});
	fs.writeFileSync(outPath, transformed, "utf8");
	console.log(`Converted: ${resolvedSourcePath} -> ${outPath}`);
	return 0;
}

export async function runCommand(command: CliCommand, taskScreenName: string, sourceFilePath: string, options: {
	force?: boolean
} = {}): Promise<number> {
	const forceSubmit = !!options.force;
	const task = parseTask(taskScreenName);
	const {transformed, originalFileName, originalClassName} = prepareSource(sourceFilePath, command === "test");

	const cookieHeader = toCookieHeader();
	const taskHtml = await httpGetText(task.taskUrl, cookieHeader);
	const samples = extractSamples(taskHtml);
	await ensureLocalRunnerReady();
	const sampleResults = await runSampleTests(transformed, samples);
	const allAccepted = printSampleResults(sampleResults, originalClassName, originalFileName);

	if (command === "test") return allAccepted ? 0 : 5;

	if (!allAccepted) {
		if (!forceSubmit) {
			console.log("Not submitting because at least one sample test is not AC.");
			return 5;
		}
		console.log("Warning: forcing submit despite non-AC sample results (-f/--force).");
	}

	const submitCookieHeader = toCookieHeader();
	const submitResult = await submitToAtCoder(task, transformed, submitCookieHeader);
	if (submitResult.trackingUnavailable) {
		const latestId = await fetchLatestSubmissionId(task, toCookieHeader());
		if (!latestId) {
			throw new Error("Submission tracking failed: could not resolve latest submission ID.");
		}
		const trackedSubmissionUrl = buildAtCoderSubmissionUrl(task.contestId, latestId);
		const trackedResult = await pollSubmissionFinal(trackedSubmissionUrl, toCookieHeader());
		console.log(
			`Result: ${colorizeStatus(trackedResult.status)} | ID: ${latestId} | Exec: ${formatMetricValue(trackedResult.execTime)} | Memory: ${formatMetricValue(trackedResult.memory)} | URL: ${trackedSubmissionUrl}`,
		);
		return trackedResult.status === "AC" ? 0 : 8;
	}
	const finalResult = await pollSubmissionFinal(submitResult.submissionUrl, toCookieHeader());
	console.log(
		`Result: ${colorizeStatus(finalResult.status)} | ID: ${submitResult.submissionId} | Exec: ${formatMetricValue(finalResult.execTime)} | Memory: ${formatMetricValue(finalResult.memory)} | URL: ${submitResult.submissionUrl}`,
	);
	return finalResult.status === "AC" ? 0 : 8;
}
