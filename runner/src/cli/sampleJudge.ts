import {
	buildLocalRunnerRunRequest,
	type EasyTestRunResult,
	evaluateEasyTestOutput,
	type LocalRunnerRunResponse,
	toEasyTestStatus,
} from "@atcoder-tools/shared";
import type {SamplePair, SampleResult} from "../types";
import {CLI_CONFIG} from "../config";
import {ANSI, colorizeStatus, formatExecTime, supportsCliColor} from "../utils";

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
		const judged = sample.expectedOutput === undefined
			? {status: easyLikeRun.status, output: easyLikeRun.output, expectedOutput: ""}
			: evaluateEasyTestOutput(easyLikeRun, sample.expectedOutput, {trim: true, split: true});
		results.push({
			index: sample.index,
			status: judged.status,
			execTime: easyLikeRun.execTime || 0,
			memoryKb: Number(runnerRaw.memory || 0),
			runnerStatus: runnerRaw.status || "",
			exitCode: Number(runnerRaw.exitCode ?? 0),
			stdoutTruncated: runnerRaw.stdoutTruncated,
			stderrTruncated: runnerRaw.stderrTruncated,
			stderr: easyLikeRun.error || "",
			actualOutput: judged.output,
			expectedOutput: judged.expectedOutput,
		});
	}
	return results;
}

function formatWaDiff(expected: string, actual: string, maxLines = 20): string {
	const toLines = (s: string) => s.replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n").map(l => l.replace(/\s+$/, ""));
	const exp = toLines(expected);
	const act = toLines(actual);
	const total = Math.max(exp.length, act.length);
	const shown = Math.min(total, maxLines);
	const color = supportsCliColor();
	const w = Math.min(30, Math.max(8, ...exp.slice(0, shown).map(s => s.length)));
	const fit = (s: string) => (s.length > w ? s.slice(0, w - 1) + "~" : s.padEnd(w));
	const numW = String(shown).length;
	const NONE = "(none)";

	const out: string[] = [`  expected vs actual  (○ = match, × = mismatch)`];
	for (let i = 0; i < shown; i++) {
		const hasE = i < exp.length, hasA = i < act.length;
		const differ = (hasE ? exp[i] : null) !== (hasA ? act[i] : null);
		const ln = String(i + 1).padStart(numW);
		const marker = differ ? "×" : "○";
		let row = `  ${marker} ${ln} | ${fit(hasE ? exp[i] : NONE)} | ${hasA ? act[i] : NONE}`;
		if (color) row = `${differ ? ANSI.RED : ANSI.GREEN}${row}${ANSI.RESET}`;
		out.push(row);
	}
	if (total > shown) out.push(`  ... +${total - shown} more line(s)`);
	return out.join("\n");
}

export function printSampleResults(results: SampleResult[], originalClassName: string, originalFileName: string) {
	let acCount = 0;
	let totalExecTime = 0;
	const statusCounts = new Map<string, number>();
	for (const r of results) {
		if (r.status === "AC") acCount++;
		totalExecTime += Number(r.execTime || 0);
		statusCounts.set(r.status, (statusCounts.get(r.status) || 0) + 1);
		const details = [`exec=${formatExecTime(r.execTime)}`];
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
		if (r.status === "OK" && r.actualOutput.trim().length > 0) {
			console.log(`  [output]`);
			console.log(r.actualOutput.replace(/\s+$/, "").split(/\r?\n/).map(line => `    ${line}`).join("\n"));
		}
		if (r.status === "WA") {
			console.log(formatWaDiff(r.expectedOutput, r.actualOutput));
		}
		if (r.status !== "AC" && r.stderr && r.stderr.trim().length > 0) {
			console.log(`  [stderr]`);
			let displayStderr = r.stderr.trim();
			if (originalClassName) {
				displayStderr = displayStderr
					.replace(/Main\.java/g, originalFileName)
					.replace(/\bMain\b/g, originalClassName);
			}
			const body = displayStderr.split(/\r?\n/).map(line => `    ${line}`).join("\n");
			console.log(supportsCliColor() ? `${ANSI.RED}${body}${ANSI.RESET}` : body);
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
	return results.every(r => r.status === "AC" || r.status === "OK");
}
