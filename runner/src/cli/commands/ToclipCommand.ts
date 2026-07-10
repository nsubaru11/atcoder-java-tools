import {CliUsageError, type Command} from "./Command";
import {copyToClipboard} from "../clipboard";
import {resolveShortSourceArg} from "./TaskCommand";
import {prepareSource} from "./source";

/** 提出用に変換したソースを、ファイルを介さずクリップボードへコピーする。 */
export class ToclipCommand implements Command {
	readonly name = "toclip";
	readonly usageLines = [
		"  toclip <sourceFile>",
		"  toclip <task>              (短縮: 例: toclip d → D.java)",
	];

	async execute(args: readonly string[]): Promise<number> {
		if (args.length !== 1 || args[0].startsWith("-")) throw new CliUsageError();
		const sourceArg = /^(ex|[a-z])\d*$/i.test(args[0])
			? resolveShortSourceArg(args[0])
			: args[0];
		const {resolvedSourcePath, transformed} = await prepareSource(sourceArg);
		copyToClipboard(transformed);
		console.log(`Copied submission source to clipboard: ${resolvedSourcePath}`);
		return 0;
	}
}
