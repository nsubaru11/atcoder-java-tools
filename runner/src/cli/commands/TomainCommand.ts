import fs from "node:fs";
import path from "node:path";
import {CliUsageError, type Command} from "./Command";
import {prepareSource} from "./source";

/** ソースを Main クラス化して Main.java（または指定パス）に書き出す。DEBUG は無効（本番想定）。 */
export class TomainCommand implements Command {
	readonly name = "tomain";
	readonly usageLines = [
		"  tomain [-f|--force] <sourceFile> [outFile]",
	];

	execute(args: readonly string[]): number {
		const positionals: string[] = [];
		let force = false;
		for (const arg of args) {
			if (arg === "-f" || arg === "--force") {
				force = true;
				continue;
			}
			if (arg.startsWith("-")) throw new CliUsageError(`Unknown option: ${arg}`);
			positionals.push(arg);
		}
		const [sourceFilePath, outFilePath] = positionals;
		if (!sourceFilePath) throw new CliUsageError();

		const {resolvedSourcePath, transformed} = prepareSource(sourceFilePath);
		const outPath = outFilePath
			? path.resolve(outFilePath)
			: path.join(path.dirname(resolvedSourcePath), "Main.java");

		if (fs.existsSync(outPath) && !force) {
			throw new Error(`Output already exists: ${outPath} (use -f/--force to overwrite)`);
		}

		fs.mkdirSync(path.dirname(outPath), {recursive: true});
		fs.writeFileSync(outPath, transformed, "utf8");
		console.log(`Converted: ${resolvedSourcePath} -> ${outPath}`);
		return 0;
	}
}
