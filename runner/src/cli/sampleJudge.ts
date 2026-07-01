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

/**
 * ソースコードを1回実行し、（expectedOutput を渡せば）判定まで行って SampleResult を返す。
 * 「1件実行して判定する」という最小単位で、test/localtest/submit のサンプル判定（evaluateSample）と
 * crosscheck の2コード比較（一方の出力をもう一方の expectedOutput として渡す）の両方がこれを共有する。
 * expectedOutput 省略時は判定せず、実行結果（ステータス・出力）だけを返す。
 */
export async function evaluateRun(
	sourceCode: string,
	index: number,
	input: string,
	expectedOutput?: string,
): Promise<SampleResult> {
	const runnerRaw = await postLocalRunner(sourceCode, input);
	const easyLikeRun: EasyTestRunResult = {
		status: toEasyTestStatus(runnerRaw.status, runnerRaw.exitCode),
		output: runnerRaw.stdout || "",
		error: runnerRaw.stderr || "",
		execTime: runnerRaw.time || 0,
	};
	const judged = expectedOutput === undefined
		? {status: easyLikeRun.status, output: easyLikeRun.output, expectedOutput: ""}
		: evaluateEasyTestOutput(easyLikeRun, expectedOutput, {trim: true, split: true});
	return {
		index,
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
	};
}

/** サンプル1件をローカル実行してジャッジし、1件分の結果を返す（test/localtest/submit 用の薄いラッパー）。 */
async function evaluateSample(sourceCode: string, sample: SamplePair): Promise<SampleResult> {
	return evaluateRun(sourceCode, sample.index, sample.input, sample.expectedOutput);
}

/** test / localtest / submit の表示制御オプション。 */
export type SampleDisplayOptions = {
	/** WA 差分を行数で折りたたまず全行表示する（maxLines より優先）。 */
	full?: boolean;
	/** WA 差分のうち不一致行だけを抽出して表示する（行番号は元のまま保持）。 */
	waOnly?: boolean;
	/** WA 差分の折りたたみ行数を上書きする（--max-lines=N）。未指定なら既定値。 */
	maxLines?: number;
};

/** WA 差分表示の既定の折りたたみ行数（--full でこの上限を解除 / --max-lines で変更）。 */
const WA_DIFF_DEFAULT_MAX_LINES = 20;

function formatWaDiff(expected: string, actual: string, options: SampleDisplayOptions = {}): string {
	const {full = false, waOnly = false, maxLines} = options;
	const toLines = (s: string) => s.replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n").map(l => l.replace(/\s+$/, ""));
	const exp = toLines(expected);
	const act = toLines(actual);
	const total = Math.max(exp.length, act.length);
	const color = supportsCliColor();

	// 表示対象の行インデックス。waOnly のときは不一致行のみ（行番号 i は元のまま保持する）。
	const indices: number[] = [];
	for (let i = 0; i < total; i++) {
		const differ = (i < exp.length ? exp[i] : null) !== (i < act.length ? act[i] : null);
		if (!waOnly || differ) indices.push(i);
	}

	// --full なら全件、そうでなければ上限（--max-lines があればその値、無ければ既定）で折りたたむ。
	const cap = maxLines ?? WA_DIFF_DEFAULT_MAX_LINES;
	const limit = full ? indices.length : Math.min(indices.length, cap);
	const shownIdx = indices.slice(0, limit);

	const numW = String(total).length;
	const w = Math.min(30, Math.max(8, ...shownIdx.map(i => (i < exp.length ? exp[i].length : 0))));
	const fit = (s: string) => (s.length > w ? s.slice(0, w - 1) + "~" : s.padEnd(w));
	const NONE = "(none)";

	const header = waOnly
		? `  expected vs actual  (× = mismatch のみ抽出 / 行番号は保持)`
		: `  expected vs actual  (○ = match, × = mismatch)`;
	const out: string[] = [header];
	if (shownIdx.length === 0) {
		out.push(`  (行単位の不一致なし — 空白や出力形式の差を確認してください)`);
	}
	for (const i of shownIdx) {
		const hasE = i < exp.length, hasA = i < act.length;
		const differ = (hasE ? exp[i] : null) !== (hasA ? act[i] : null);
		const ln = String(i + 1).padStart(numW);
		const marker = differ ? "×" : "○";
		let row = `  ${marker} ${ln} | ${fit(hasE ? exp[i] : NONE)} | ${hasA ? act[i] : NONE}`;
		if (color) row = `${differ ? ANSI.RED : ANSI.GREEN}${row}${ANSI.RESET}`;
		out.push(row);
	}
	const hidden = indices.length - shownIdx.length;
	if (hidden > 0) out.push(`  ... +${hidden} more line(s)  (--full で全行表示)`);
	return out.join("\n");
}

/** WA の不一致行数と全行数を返す。formatWaDiff と同じ行整形ルールで判定する。 */
function getWaMismatchStats(expected: string, actual: string): { mismatch: number; total: number } {
	const toLines = (s: string) => s.replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n").map(l => l.replace(/\s+$/, ""));
	const exp = toLines(expected);
	const act = toLines(actual);
	const total = Math.max(exp.length, act.length);
	let mismatch = 0;
	for (let i = 0; i < total; i++) {
		const differ = (i < exp.length ? exp[i] : null) !== (i < act.length ? act[i] : null);
		if (differ) mismatch++;
	}
	return {mismatch, total};
}

/** サンプル1件分の結果（ステータス・出力・差分・stderr）を表示する。crosscheck からも直接呼ばれる。 */
export function printSampleResult(
	r: SampleResult,
	originalClassName: string,
	originalFileName: string,
	display: SampleDisplayOptions,
): void {
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
	if (r.status === "WA") {
		const {mismatch, total} = getWaMismatchStats(r.expectedOutput, r.actualOutput);
		if (total > 0) details.push(`NG/TOTAL=${mismatch}/${total}`);
	}
	console.log(`[${r.index}] ${colorizeStatus(r.status)} ${details.join(" ")}`);
	if (r.status === "OK" && r.actualOutput.trim().length > 0) {
		console.log(`  [output]`);
		console.log(r.actualOutput.replace(/\s+$/, "").split(/\r?\n/).map(line => `    ${line}`).join("\n"));
	}
	if (r.status === "WA") {
		console.log(formatWaDiff(r.expectedOutput, r.actualOutput, display));
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

/** 全サンプルの集計（AC 数・内訳・実行時間）を1行で表示し、全 AC/OK かどうかを返す。crosscheck からも直接呼ばれる。 */
export function printSampleSummary(results: SampleResult[]): boolean {
	const acCount = results.filter(r => r.status === "AC").length;
	const totalExecTime = results.reduce((sum, r) => sum + Number(r.execTime || 0), 0);
	const statusCounts = new Map<string, number>();
	for (const r of results) statusCounts.set(r.status, (statusCounts.get(r.status) || 0) + 1);
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

/**
 * サンプルを1件ずつ「実行 → 即表示」しながら進め、最後に集計を表示する。
 * 全件まとめてからではなく逐次表示するので、ケースが多い/遅いときも経過が分かる。
 * 戻り値は全件 AC/OK かどうか。
 */
export async function runAndReportSamples(
	sourceCode: string,
	samplePairs: SamplePair[],
	originalClassName: string,
	originalFileName: string,
	display: SampleDisplayOptions = {},
): Promise<boolean> {
	const results: SampleResult[] = [];
	for (const sample of samplePairs) {
		const result = await evaluateSample(sourceCode, sample);
		printSampleResult(result, originalClassName, originalFileName, display);
		results.push(result);
	}
	return printSampleSummary(results);
}
