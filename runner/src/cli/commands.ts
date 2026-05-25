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

export function printUsage() {
	console.error("Usage:");
	console.error("  test <taskScreenName> <sourceFile>");
	console.error("  submit [-f|--force] <taskScreenName> <sourceFile>");
	console.error("Options:");
	console.error("  -f, --force    submit even if sample tests are not all AC");
}

export async function runCommand(command: CliCommand, taskScreenName: string, sourceFilePath: string, options: {
	force?: boolean
} = {}) {
	const forceSubmit = !!options.force;
	const task = parseTask(taskScreenName);
	const resolvedSourcePath = resolveSourceFilePath(sourceFilePath);
	const source = normalizeNewlines(fs.readFileSync(resolvedSourcePath, "utf8"));
	const transformed = forceMainAndDebug(source);
	const originalFileName = path.basename(resolvedSourcePath);
	const originalClassName = originalFileName.replace(/\.java$/i, "");

	const cookieHeader = toCookieHeader();
	const taskHtml = await httpGetText(task.taskUrl, cookieHeader);
	const samples = extractSamples(taskHtml);
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
