import {pathToFileURL} from "node:url";
import {CLI_COMMANDS, type CliCommand} from "../types";
import {
	expandShortTaskArg,
	printUsage,
	runCommand,
	runLocalTest,
	runRun,
	runServe,
	runStop,
	runTomain
} from "./commands";

function isCliCommand(value: string): value is CliCommand {
	return (CLI_COMMANDS as readonly string[]).includes(value);
}

function assertNever(command: never): never {
	throw new Error(`Unhandled command: ${String(command)}`);
}

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

	const [command, ...rest] = positionalArgs;
	if (!command || !isCliCommand(command)) {
		printUsage();
		return 1;
	}

	try {
		if (command === "serve") return await runServe();
		if (command === "stop") return await runStop();

		if (command === "run") {
			const [sourceFilePath, inputFile] = rest;
			if (!sourceFilePath) {
				printUsage();
				return 1;
			}
			return await runRun(sourceFilePath, inputFile);
		}

		if (command === "localtest") {
			const [sourceFilePath, testDir] = rest;
			if (!sourceFilePath) {
				printUsage();
				return 1;
			}
			return await runLocalTest(sourceFilePath, testDir);
		}

		if (command === "tomain") {
			const [sourceFilePath, outFilePath] = rest;
			if (!sourceFilePath) {
				printUsage();
				return 1;
			}
			return runTomain(sourceFilePath, outFilePath, {force});
		}

		if (command === "test" || command === "submit") {
			let taskScreenName: string | undefined;
			let sourceFilePath: string | undefined;
			if (rest.length === 1) {
				// 短縮表記: test d → フォルダからコンテストを推定し test abc463_d D.java 相当へ展開
				({taskScreenName, sourceFilePath} = expandShortTaskArg(rest[0]));
			} else {
				[taskScreenName, sourceFilePath] = rest;
			}
			if (!taskScreenName || !sourceFilePath) {
				printUsage();
				return 1;
			}
			if (force && command !== "submit") {
				console.error("-f/--force is only supported with the submit and tomain commands.");
				printUsage();
				return 1;
			}
			return await runCommand(command, taskScreenName, sourceFilePath, {force});
		}

		return assertNever(command);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		return 1;
	}
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
const isBunEntry = Boolean(import.meta.main);

if (isDirectRun || isBunEntry) process.exit(await main());
