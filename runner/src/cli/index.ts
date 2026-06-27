import {pathToFileURL} from "node:url";
import {CliUsageError} from "./commands/Command";
import {getCommand, printUsage} from "./commands/registry";

/**
 * エントリポイント。
 * コマンド名でレジストリを引き、見つかったコマンドの execute() に残り引数を渡すだけ。
 * 引数の検証・実行は各コマンドクラスの内部に閉じている。
 */
export async function main(rawArgs = process.argv.slice(2)): Promise<number> {
	const [name, ...rest] = rawArgs;
	const command = name ? getCommand(name) : undefined;
	if (!command) {
		printUsage();
		return 1;
	}

	try {
		return await command.execute(rest);
	} catch (error) {
		if (error instanceof CliUsageError) {
			if (error.message) console.error(error.message);
			printUsage();
			return 1;
		}
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		return 1;
	}
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
const isBunEntry = Boolean(import.meta.main);

if (isDirectRun || isBunEntry) process.exit(await main());
