import fs from "node:fs";
import path from "node:path";
import {
	ANSI,
	colorizeStatus,
	formatExecTime,
	normalizeNewlines,
	supportsCliColor,
	thresholdsFromTimeLimit,
} from "../../utils";
import {ensureLocalRunnerReady} from "../ensureServer";
import {postLocalRunner} from "../sampleJudge";
import {CliUsageError, type Command} from "./Command";
import {parseBoolFlag, parseIntFlag} from "./options";
import {prepareSource} from "./source";

/** Local Runner の実行ステータスを短いラベルに変換する。 */
function runStatusLabel(status: string): string {
	switch (status) {
		case "success":
			return "OK";
		case "runtimeError":
			return "RE";
		case "compileError":
			return "CE";
		case "timeLimitExceeded":
			return "TLE";
		case "internalError":
			return "IE";
		default:
			return status;
	}
}

/** ソースを1回だけ実行して出力を表示する（期待出力なし・DEBUG は既定で有効・入力ファイル省略可）。 */
export class RunCommand implements Command {
	readonly name = "run";
	readonly usageLines = [
		"  run [-d|--debug[=true|false]] [--time-limit=N] <sourceFile> [inputFile]",
		"                                          (1回実行して出力表示。inputFile省略可。DEBUG は既定で有効)",
	];

	async execute(args: readonly string[]): Promise<number> {
		const positionals: string[] = [];
		let debug = true; // 既定で DEBUG 有効。-d/--debug で上書き。
		let timeLimitMs: number | undefined;
		for (const arg of args) {
			const d = parseBoolFlag(arg, "--debug", "-d");
			if (d !== undefined) {
				debug = d;
				continue;
			}
			const timeLimit = parseIntFlag(arg, "--time-limit");
			if (timeLimit !== undefined) {
				timeLimitMs = timeLimit;
				continue;
			}
			if (arg.startsWith("-")) throw new CliUsageError(`Unknown option: ${arg}`);
			positionals.push(arg);
		}
		const [sourceFilePath, inputFile] = positionals;
		if (!sourceFilePath) throw new CliUsageError();

		const {transformed, originalFileName, originalClassName} = await prepareSource(sourceFilePath, debug);
		await ensureLocalRunnerReady();
		const stdin = inputFile
			? normalizeNewlines(fs.readFileSync(path.resolve(inputFile), "utf8"))
			: "";
		const result = await postLocalRunner(transformed, stdin);

		// ステータスは「OK / RE / CE / TLE / IE」に集約。OK=緑、エラー=色付き。遅い実行は time が黄色。
		const label = runStatusLabel(result.status);
		const coloredLabel = label === "OK" && supportsCliColor() ? `${ANSI.GREEN}OK${ANSI.RESET}` : colorizeStatus(label);
		console.log(`[run] ${coloredLabel}  time=${formatExecTime(result.time || 0, thresholdsFromTimeLimit(timeLimitMs))}`);

		// 標準出力は既定色（白）。
		const stdout = (result.stdout || "").replace(/\s+$/, "");
		console.log("[output]");
		console.log(stdout.length > 0 ? stdout.split(/\r?\n/).map((line) => `  ${line}`).join("\n") : "  (empty)");

		// 標準エラー出力は赤。
		const stderr = (result.stderr || "").trim();
		if (stderr.length > 0) {
			console.log("[stderr]");
			const display = originalClassName
				? stderr.replace(/Main\.java/g, originalFileName).replace(/\bMain\b/g, originalClassName)
				: stderr;
			const body = display.split(/\r?\n/).map((line) => `  ${line}`).join("\n");
			console.log(supportsCliColor() ? `${ANSI.RED}${body}${ANSI.RESET}` : body);
		}
		return result.exitCode === 0 ? 0 : 1;
	}
}
