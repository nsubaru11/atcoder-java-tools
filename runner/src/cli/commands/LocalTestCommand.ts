import {ensureLocalRunnerReady} from "../ensureServer";
import {loadLocalSamples} from "../localSamples";
import {runAndReportSamples, type SampleDisplayOptions} from "../sampleJudge";
import {CliUsageError, type Command} from "./Command";
import {parseBoolFlag, parseIntFlag} from "./options";
import {prepareSource} from "./source";

/** ローカルの .in/.out をサンプルとして実行・判定する（AtCoder へはアクセスしない）。DEBUG は既定で有効。 */
export class LocalTestCommand implements Command {
	readonly name = "localtest";
	readonly usageLines = [
		"  localtest [-d|--debug[=true|false]] [--full] [--wa-only] [--max-lines=N] [--time-limit=N] <sourceFile> [testDir]",
		"                                          (.in/.out をローカル実行。DEBUG は既定で有効)",
	];

	async execute(args: readonly string[]): Promise<number> {
		const positionals: string[] = [];
		let debug = true; // 既定で DEBUG 有効。-d/--debug で上書き。
		const display: SampleDisplayOptions = {};
		for (const arg of args) {
			const d = parseBoolFlag(arg, "--debug", "-d");
			if (d !== undefined) {
				debug = d;
				continue;
			}
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
		const [sourceFilePath, testDir] = positionals;
		if (!sourceFilePath) throw new CliUsageError();

		const {
			resolvedSourcePath,
			transformed,
			originalFileName,
			originalClassName
		} = prepareSource(sourceFilePath, debug);
		await ensureLocalRunnerReady();
		const samples = loadLocalSamples(resolvedSourcePath, testDir);
		const allAccepted = await runAndReportSamples(transformed, samples, originalClassName, originalFileName, display);
		return allAccepted ? 0 : 5;
	}
}
