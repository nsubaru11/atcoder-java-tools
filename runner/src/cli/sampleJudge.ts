import {
	buildLocalRunnerRunRequest,
	type EasyTestRunResult,
	evaluateEasyTestOutput,
	type LocalRunnerRunResponse,
	toEasyTestStatus,
} from "@atcoder-tools/shared";
import type {SamplePair, SampleResult} from "../types";
import {CLI_CONFIG} from "../config";
import {colorizeStatus} from "../utils";

export async function postLocalRunner(sourceCode: string, stdinText: string): Promise<LocalRunnerRunResponse> {
	const res = await fetch(CLI_CONFIG.defaultLocalRunnerUrl, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(buildLocalRunnerRunRequest(sourceCode, stdinText)),
	});
	if (!res.ok) {
		throw new Error(`Local runner request failed: ${res.status}`);
	}
	return await res.json() as LocalRunnerRunResponse;
}

export async function runSampleTests(sourceCode: string, samplePairs: SamplePair[]) {
	const results: SampleResult[] = [];
	for (const sample of samplePairs) {
		const runnerRaw = await postLocalRunner(sourceCode, sample.input);
		const easyLikeRun: EasyTestRunResult = {
			status: toEasyTestStatus(runnerRaw.status, runnerRaw.exitCode),
			output: runnerRaw.stdout || "",
			error: runnerRaw.stderr || "",
			execTime: runnerRaw.time || 0,
		};
		const judged = evaluateEasyTestOutput(easyLikeRun, sample.expectedOutput, {trim: true, split: true});
		results.push({
			index: sample.index,
			status: judged.status,
			execTime: easyLikeRun.execTime || 0,
			memoryKb: Number(runnerRaw.memory || 0),
			runnerStatus: runnerRaw.status || "",
			exitCode: Number(runnerRaw.exitCode ?? 0),
			stdoutTruncated: !!runnerRaw.stdoutTruncated,
			stderrTruncated: !!runnerRaw.stderrTruncated,
			stderr: easyLikeRun.error || "",
			actualOutput: judged.output,
			expectedOutput: judged.expectedOutput,
		});
	}
	return results;
}

export function printSampleResults(results: SampleResult[], originalClassName: string, originalFileName: string) {
	let acCount = 0;
	let totalExecTime = 0;
	const statusCounts = new Map<string, number>();
	for (const r of results) {
		if (r.status === "AC") acCount++;
		totalExecTime += Number(r.execTime || 0);
		statusCounts.set(r.status, (statusCounts.get(r.status) || 0) + 1);
		const details = [`exec=${r.execTime}ms`];
		if (r.memoryKb > 0) details.push(`mem=${r.memoryKb}KB`);
		if (r.runnerStatus && r.runnerStatus !== "success") details.push(`runner=${r.runnerStatus}`);
		if (r.exitCode !== 0) details.push(`exit=${r.exitCode}`);
		if (r.stdoutTruncated || r.stderrTruncated) {
			const flags = [];
			if (r.stdoutTruncated) flags.push("stdout");
			if (r.stderrTruncated) flags.push("stderr");
			details.push(`trunc=${flags.join(",")}`);
		}
		console.log(`[${r.index}] ${colorizeStatus(r.status)} ${details.join(" ")}`);
		if (r.stderr && r.stderr.trim().length > 0) {
			console.log(`  [stderr]`);
			let displayStderr = r.stderr.trim();
			if (originalClassName) {
				displayStderr = displayStderr
					.replace(/Main\.java/g, originalFileName)
					.replace(/\bMain\b/g, originalClassName);
			}
			console.log(displayStderr.split(/\r?\n/).map(line => `    ${line}`).join("\n"));
		}
	}
	const breakdown = Array.from(statusCounts.entries())
		.sort((a, b) => {
			if (a[0] === "AC") return -1;
			if (b[0] === "AC") return 1;
			return a[0].localeCompare(b[0]);
		})
		.map(([status, count]) => `${status}:${count}`)
		.join(" ");
	const avgExecTime = results.length ? (totalExecTime / results.length).toFixed(1) : "0.0";
	console.log(`Summary: ${acCount}/${results.length} AC | ${breakdown} | total=${totalExecTime}ms avg=${avgExecTime}ms`);
	return acCount === results.length;
}
