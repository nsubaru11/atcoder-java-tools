// Build AtCoder UserScripts: <Name>/src/main.ts -> <Name>/dist/<Name>.user.js.
// Run with Bun so TypeScript bundling does not need npm or a separate bundler.

import {access, mkdir, readdir, readFile, stat, watch as fsWatch, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {format} from "prettier";

type MetaPair = {
	key: string;
	value: string;
};

type MetaFile = {
	pairs: MetaPair[];
};

type BuildOptions = {
	watch: boolean;
	names: string[];
};

const scriptDir = getScriptDir();
const watchDebounceMs = 100;
const ignoredDirectoryNames = ["node_modules"];

function getScriptDir(): string {
	if (typeof Bun !== "undefined" && Bun.main) return dirname(Bun.main);
	const entry = process.argv[1];
	if (!entry) return process.cwd();
	return dirname(isAbsolute(entry) ? entry : resolve(process.cwd(), entry));
}

function assertBunRuntime(): void {
	if (typeof Bun === "undefined") {
		throw new Error("This build script must be run with Bun. Use `bun run build`.");
	}
}

function printUsage(): void {
	console.log(`Usage:
  bun ./build.ts [--watch] [ScriptName ...]

Examples:
  bun ./build.ts
  bun ./build.ts --watch
  bun ./build.ts AtCoderHighlighter`);
}

function parseArgs(args: string[]): BuildOptions {
	const names: string[] = [];
	let watch = false;

	for (const arg of args) {
		if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		}
		if (arg === "--watch" || arg === "-w") {
			watch = true;
			continue;
		}
		if (arg.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		}
		names.push(arg);
	}

	return {watch, names};
}

function unique(values: string[]): string[] {
	const result: string[] = [];

	for (const value of values) {
		if (result.indexOf(value) === -1) result.push(value);
	}

	return result;
}

function isMetaPair(value: unknown): value is MetaPair {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<MetaPair>;
	return typeof candidate.key === "string" && candidate.key.length > 0 && typeof candidate.value === "string";
}

function parseMetaFile(raw: string, name: string): MetaFile {
	let json: unknown;
	try {
		json = JSON.parse(raw) as unknown;
	} catch (error: unknown) {
		throw new Error(`meta.json for ${name} is not valid JSON: ${errorMessage(error)}`);
	}

	if (!json || typeof json !== "object" || !Array.isArray((json as { pairs?: unknown }).pairs)) {
		throw new Error(`meta.json for ${name} must contain a "pairs" array.`);
	}

	const pairs = (json as { pairs: unknown[] }).pairs;
	if (pairs.length === 0 || !pairs.every(isMetaPair)) {
		throw new Error(`meta.json for ${name} contains invalid metadata pairs.`);
	}

	return {pairs};
}

function buildBanner(pairs: MetaPair[]): string {
	const width = Math.max(...pairs.map((pair) => pair.key.length));
	const lines = ["// ==UserScript=="];

	for (const {key, value} of pairs) {
		lines.push(`// @${key.padEnd(width)} ${value}`);
	}

	lines.push("// ==/UserScript==");
	return `${lines.join("\n")}\n`;
}

function scriptPaths(name: string): {
	entry: string;
	meta: string;
	outdir: string;
	outfile: string;
} {
	const root = join(scriptDir, name);

	return {
		entry: join(root, "src", "main.ts"),
		meta: join(root, "meta.json"),
		outdir: join(root, "dist"),
		outfile: join(root, "dist", `${name}.user.js`),
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function isUserscriptDirectory(name: string): Promise<boolean> {
	const paths = scriptPaths(name);
	return (await pathExists(paths.meta)) && (await pathExists(paths.entry));
}

async function discoverScripts(explicitNames: string[]): Promise<string[]> {
	if (explicitNames.length > 0) {
		const uniqueNames = unique(explicitNames);

		for (const name of uniqueNames) {
			if (!(await isUserscriptDirectory(name))) {
				throw new Error(`Unknown userscript: ${name}`);
			}
		}

		return uniqueNames;
	}

	const entries = await readdir(scriptDir, {withFileTypes: true});
	const names: string[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (ignoredDirectoryNames.indexOf(entry.name) !== -1 || entry.name.startsWith(".")) continue;
		if (await isUserscriptDirectory(entry.name)) names.push(entry.name);
	}

	return names.sort();
}

async function loadMeta(name: string): Promise<MetaPair[]> {
	const raw = await readFile(join(scriptDir, name, "meta.json"), "utf8");
	return parseMetaFile(raw, name).pairs;
}

async function formatUserscriptOutput(outfile: string, banner: string): Promise<void> {
	const raw = await readFile(outfile, "utf8");

	if (!raw.startsWith(banner)) {
		throw new Error(`Generated output does not start with the expected UserScript metadata: ${outfile}`);
	}

	const body = raw.slice(banner.length).trimStart();
	const formattedBody = await format(body, {
		parser: "babel",
		useTabs: true,
		tabWidth: 4,
		printWidth: 120,
		endOfLine: "lf",
		embeddedLanguageFormatting: "off",
	});

	await writeFile(outfile, `${banner}\n${formattedBody}`, "utf8");
}

async function buildOne(name: string): Promise<void> {
	const {entry, outdir, outfile} = scriptPaths(name);
	const banner = buildBanner(await loadMeta(name));
	await mkdir(outdir, {recursive: true});

	const result = await Bun.build({
		entrypoints: [entry],
		outdir,
		root: scriptDir,
		format: "iife",
		target: "browser",
		naming: `${name}.user.js`,
		minify: false,
		banner,
	});

	if (!result.success) {
		for (const log of result.logs) {
			console.error(log.message);
		}
		throw new Error(`Build failed: ${name}`);
	}

	await formatUserscriptOutput(outfile, banner);

	const output = await stat(outfile);
	console.log(`  -> ${name}/dist/${name}.user.js (${output.size} bytes)`);
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

async function buildAll(names: string[]): Promise<void> {
	await Promise.all(names.map(buildOne));
}

function createQueuedBuild(names: string[]): () => Promise<void> {
	let buildRunning = false;
	let buildPending = false;

	return async function buildQueued(): Promise<void> {
		if (buildRunning) {
			buildPending = true;
			return;
		}

		buildRunning = true;
		try {
			do {
				buildPending = false;
				await buildAll(names);
			} while (buildPending);
		} finally {
			buildRunning = false;
		}
	};
}

async function watchAndBuild(buildQueued: () => Promise<void>): Promise<void> {
	console.log("Watching for changes...");
	const watcher = fsWatch(scriptDir, {recursive: true});
	let timer: ReturnType<typeof setTimeout> | undefined;

	for await (const event of watcher) {
		const fileName = event.filename ? String(event.filename) : "";
		if (!fileName.endsWith(".ts") && !fileName.endsWith("meta.json")) continue;
		if (fileName.includes("dist\\") || fileName.includes("dist/")) continue;
		if (timer) clearTimeout(timer);

		timer = setTimeout(() => {
			buildQueued().catch((error: unknown) => {
				console.error(errorMessage(error));
			});
		}, watchDebounceMs);
	}
}

async function main(): Promise<void> {
	assertBunRuntime();
	process.chdir(scriptDir);

	const options = parseArgs(process.argv.slice(2));
	const names = await discoverScripts(options.names);

	if (names.length === 0) {
		throw new Error("No userscript entries found.");
	}

	console.log(`Building ${names.length} userscript(s)${options.watch ? " (watch)" : ""}:`);
	for (const name of names) console.log(`  - ${name}`);

	const buildQueued = createQueuedBuild(names);
	await buildQueued();

	if (options.watch) {
		await watchAndBuild(buildQueued);
	} else {
		console.log("Done.");
	}
}

main().catch((error: unknown) => {
	console.error(errorMessage(error));
	process.exit(1);
});
