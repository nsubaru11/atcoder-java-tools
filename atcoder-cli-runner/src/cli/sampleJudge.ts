import type {EasyTestJudgeResult, EasyTestRunResult, LocalRunnerResult, SamplePair, SampleResult} from "../types";
import {CLI_CONFIG} from "../shared/config";
import {colorizeStatus} from "../shared/utils";

export async function postLocalRunner(sourceCode: string, stdinText: string): Promise<LocalRunnerResult> {
	const res = await fetch(CLI_CONFIG.defaultLocalRunnerUrl, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({mode: "run", sourceCode, stdin: stdinText}),
	});
	if (!res.ok) {
		throw new Error(`Local runner request failed: ${res.status}`);
	}
	return await res.json() as LocalRunnerResult;
}

export function evaluateByEasyTest(
	runResult: EasyTestRunResult,
	expectedOutput: string,
	options: { trim?: boolean; split?: boolean; allowableError?: number } = {trim: true, split: true},
): EasyTestJudgeResult {
	const status = runResult.status;
	if (status !== "OK" || typeof expectedOutput !== "string") {
		return {status, output: runResult.output || "", expectedOutput};
	}
	let output = runResult.output || "";
	let expected = expectedOutput;
	if (options.trim) {
		expected = expected.trim();
		output = output.trim();
	}
	let equals = (x: string, y: string) => x === y;
	if (options.allowableError) {
		const floatPattern = /^[-+]?[0-9]*\.[0-9]+([eE][-+]?[0-9]+)?$/;
		const superEquals = equals;
		equals = (x, y) => {
			if (floatPattern.test(x) || floatPattern.test(y)) {
				const a = Number.parseFloat(x);
				const b = Number.parseFloat(y);
				return Math.abs(a - b) <= Math.max(options.allowableError!, Math.abs(b) * options.allowableError!);
			}
			return superEquals(x, y);
		};
	}
	if (options.split) {
		const superEquals = equals;
		equals = (x, y) => {
			const xs = x.split(/\s+/);
			const ys = y.split(/\s+/);
			if (xs.length !== ys.length) return false;
			for (let i = 0; i < xs.length; i++) {
				if (!superEquals(xs[i], ys[i])) return false;
			}
			return true;
		};
	}
	return {status: equals(output, expected) ? "AC" : "WA", output, expectedOutput: expected};
}

export function mapRunnerStatusToEasyTestStatus(localRunnerResult: LocalRunnerResult) {
	switch (localRunnerResult.status) {
		case "success":
			return "OK";
		case "compileError":
			return "CE";
		case "timeLimitExceeded":
			return "TLE";
		case "runtimeError":
		case "internalError":
		default:
			return "RE";
	}
}

export async function runSampleTests(sourceCode: string, samplePairs: SamplePair[]) {
	const results: SampleResult[] = [];
	for (const sample of samplePairs) {
		const runnerRaw = await postLocalRunner(sourceCode, sample.input);
		const easyLikeRun: EasyTestRunResult = {
			status: mapRunnerStatusToEasyTestStatus(runnerRaw),
			output: runnerRaw.stdout || "",
			error: runnerRaw.stderr || "",
			execTime: runnerRaw.time || 0,
		};
		const judged = evaluateByEasyTest(easyLikeRun, sample.expectedOutput, {trim: true, split: true});
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
