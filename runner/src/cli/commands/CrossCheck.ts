import {CliUsageError, Command} from "./Command";
import {parseBoolFlag, parseIntFlag} from "./options";
import {evaluateRun, printSampleResult, printSampleSummary, type SampleDisplayOptions} from "../sampleJudge";
import {prepareSource} from "./source";
import {ensureLocalRunnerReady} from "../ensureServer";
import {loadLocalSamples} from "../localSamples";
import type {SampleResult} from "../../types";

/**
 * テスト対象（actual）と参照実装（expected）を同じ入力（.in）で実行し、標準出力を比較します。
 * expected 側の出力を「正解」扱いにして、既存の test/localtest と同じ判定・表示ロジック
 * （evaluateRun / printSampleResult / printSampleSummary）をそのまま再利用します。
 *
 * 引数順は sourceFile を先頭に置く他コマンド（test/localtest/run）に合わせ、
 * テスト対象である actualSourceFile を先頭にします。testDir の自動探索も actual 側の
 * ソース位置を基準に行います（サンプルは actual と同じ場所に置かれているのが通常のため）。
 * 一方、比較結果の表示（expected vs actual）は既存の WA 差分表示と同じ並びのまま変えません。
 */
export class CrossCheck implements Command {
	readonly name = "crosscheck";
	readonly usageLines = [
		"  crosscheck  [--full] [--wa-only] [--max-lines=N] [--time-limit=N] <actualSourceFile> <expectedSourceFile> [testDir]",
		"                                          (actual と expected を同じ入力で実行し出力を突き合わせます。expected側が異常終了したケースは比較せずそのまま報告)",
	];

	/** ローカルの .in を入力として与え、2つのコードの実行結果を突き合わせます。 **/
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
			const timeLimit = parseIntFlag(arg, "--time-limit");
			if (timeLimit !== undefined) {
				display.timeLimitMs = timeLimit;
				continue;
			}
			if (arg.startsWith("-")) throw new CliUsageError(`Unknown option: ${arg}`);
			positionals.push(arg);
		}
		const [actualSourceFile, expectedSourceFile, testDir] = positionals;
		if (!actualSourceFile || !expectedSourceFile) throw new CliUsageError();

		const actual = prepareSource(actualSourceFile);
		const expected = prepareSource(expectedSourceFile);
		await ensureLocalRunnerReady();
		// テストケース（.in）はテスト対象である actual 側のソースの近傍/指定 testDir から探す。
		// .out は無視する（あっても比較対象は「もう一方の実行結果」であって .out ではない）。
		const samples = loadLocalSamples(actual.resolvedSourcePath, testDir);

		console.log(`[crosscheck] actual=${actual.originalFileName}  expected=${expected.originalFileName}  cases=${samples.length}`);

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
