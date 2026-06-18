import {buildAtCoderSubmissionUrl} from "@atcoder-tools/shared";
import fs from "node:fs";
import path from "node:path";
import type {CliCommand} from "../types";
import {colorizeStatus, normalizeNewlines} from "../utils";
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
import {printSampleResults, runSampleTests} from "./sampleJudge";
import {loadLocalSamples} from "./localSamples";
import {ensureLocalRunnerReady} from "./ensureServer";

export function printUsage() {
	console.error("Usage:");
	console.error("  test <taskScreenName> <sourceFile>");
	console.error("  submit [-f|--force] <taskScreenName> <sourceFile>");
	console.error("  tomain [-f|--force] <sourceFile> [outFile]");
	console.error("  localtest <sourceFile> [testDir]");
	console.error("  serve                                  (Local Runner サーバーだけ先に起動して待機)");
	console.error("Options:");
	console.error("  -f, --force    submit even if sample tests are not all AC / tomain: overwrite existing outFile");
}

/** Local Runner サーバーだけを先に起動して ready まで待つ（先回り起動）。 */
export async function runServe(): Promise<number> {
	await ensureLocalRunnerReady();
	console.log("Local Runner is up. これ以降の test / submit / localtest は即実行されます。");
	return 0;
}

function prepareSource(sourceFilePath: string) {
	const resolvedSourcePath = resolveSourceFilePath(sourceFilePath);
	const source = normalizeNewlines(fs.readFileSync(resolvedSourcePath, "utf8"));
	const transformed = forceMainAndDebug(source);
	const originalFileName = path.basename(resolvedSourcePath);
	const originalClassName = originalFileName.replace(/\.java$/i, "");
	return {resolvedSourcePath, transformed, originalFileName, originalClassName};
}

export async function runLocalTest(sourceFilePath: string, testDir: string | undefined): Promise<number> {
	const {resolvedSourcePath, transformed, originalFileName, originalClassName} = prepareSource(sourceFilePath);
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
	const {transformed, originalFileName, originalClassName} = prepareSource(sourceFilePath);

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
