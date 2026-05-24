import {pathToFileURL} from "node:url";
import type {CliCommand} from "../types";
import {printUsage, runCommand} from "./commands";

export async function main(rawArgs = process.argv.slice(2)) {
	const positionalArgs: string[] = [];
	let force = false;

	for (const arg of rawArgs) {
		if (arg === "-f" || arg === "--force") {
			force = true;
			continue;
		}
		if (arg.startsWith("-")) {
			console.error(`Unknown option: ${arg}`);
			printUsage();
			return 1;
		}
		positionalArgs.push(arg);
	}

	const [command, taskScreenName, sourceFilePath] = positionalArgs;
	if (!["test", "submit"].includes(command) || !taskScreenName || !sourceFilePath) {
		printUsage();
		return 1;
	}
	if (force && command !== "submit") {
		console.error("-f/--force is only supported with the submit command.");
		printUsage();
		return 1;
	}

	try {
		return await runCommand(command as CliCommand, taskScreenName, sourceFilePath, {force});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		return 1;
	}
}

const isDirectRun = process.argv[1]
	? import.meta.url === pathToFileURL(process.argv[1]).href
	: false;
const isBunEntry = Boolean(import.meta.main);

if (isDirectRun || isBunEntry) {
	process.exit(await main());
}
