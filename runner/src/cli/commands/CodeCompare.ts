import {CliUsageError, Command} from "./Command";
import {parseBoolFlag, parseIntFlag} from "./options";
import {evaluateRun, printSampleResult, printSampleSummary, type SampleDisplayOptions} from "../sampleJudge";
import {prepareSource} from "./source";
import {ensureLocalRunnerReady} from "../ensureServer";
import {loadLocalSamples} from "../localSamples";
import type {SampleResult} from "../../types";

/**
 * 2つのソースを同じ入力（.in）で実行し、標準出力を比較します。
 * expected 側の出力を「正解」扱いにして、既存の test/localtest と同じ判定・表示ロジック
 * （evaluateRun / printSampleResult / printSampleSummary）をそのまま再利用します。
 */
export class CodeCompare implements Command {
	readonly name = "codecompare";
	readonly usageLines = [
		"  codecompare  [--full] [--wa-only] [--max-lines=N] <expectedSourceFile> <actualSourceFile> [testDir]",
		"                                          (2つのコードの実行結果を比較します。expected側が異常終了したケースは比較せずそのまま報告)",
	];

	/** ローカルの .in を入力として与え、2つのコードの実行結果を比較します。 **/
	async execute(args: readonly string[]): Promise<number> {
		const positionals: string[] = [];
		const display: SampleDisplayOptions = {};
		for (const arg of args) {
			const full = parseBoolFlag(arg, "--full");
			if (full !== undefined) {
				display.full = full;
				continue;
			}
			const waOnly = parseBoolFlag(arg, "--wa-only");
			if (waOnly !== undefined) {
				display.waOnly = waOnly;
				continue;
			}
			const maxLines = parseIntFlag(arg, "--max-lines");
			if (maxLines !== undefined) {
				display.maxLines = maxLines;
				continue;
			}
			if (arg.startsWith("-")) throw new CliUsageError(`Unknown option: ${arg}`);
			positionals.push(arg);
		}
		const [expectedSourceFile, actualSourceFile, testDir] = positionals;
		if (!expectedSourceFile || !actualSourceFile) throw new CliUsageError();

		const expected = prepareSource(expectedSourceFile);
		const actual = prepareSource(actualSourceFile);
		await ensureLocalRunnerReady();
		// テストケース（.in）は expected 側のソースの近傍/指定 testDir から探す。
		// .out は無視する（あっても比較対象は「もう一方の実行結果」であって .out ではない）。
		const samples = loadLocalSamples(expected.resolvedSourcePath, testDir);

		console.log(`[codecompare] expected=${expected.originalFileName}  actual=${actual.originalFileName}  cases=${samples.length}`);

		const results: SampleResult[] = [];
		for (const sample of samples) {
			// まず expected 側を「判定なし」で実行し、その標準出力を今回の正解とする。
			const expectedRun = await evaluateRun(expected.transformed, sample.index, sample.input);
			if (expectedRun.status !== "OK") {
				// expected 側が正常終了しなかった場合は比較のしようがないので、
				// そのケースはスキップし、expected 側の異常終了自体を結果として報告する。
				printSampleResult(expectedRun, expected.originalClassName, expected.originalFileName, display);
				results.push(expectedRun);
				continue;
			}
			// actual 側を、expected の出力を expectedOutput として渡して実行・判定する。
			// これにより AC = 出力一致 / WA = 出力不一致 として test/localtest と同じ表示が使える。
			const compared = await evaluateRun(actual.transformed, sample.index, sample.input, expectedRun.actualOutput);
			printSampleResult(compared, actual.originalClassName, actual.originalFileName, display);
			results.push(compared);
		}
		const allMatched = printSampleSummary(results);
		return allMatched ? 0 : 5;
	}
}
