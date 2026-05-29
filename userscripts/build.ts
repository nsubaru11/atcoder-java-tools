// Build AtCoder UserScripts: <Name>/src/main.ts -> <Name>/dist/<Name>.user.js.
// Run with Bun so TypeScript bundling does not need npm or a separate bundler.

import {access, mkdir, readdir, readFile, stat, watch as fsWatch, writeFile} from "node:fs/promises";
import {basename, dirname, isAbsolute, join, resolve} from "node:path";
import {format} from "prettier";

// region UserScript メタデータの型定義
/** @match / @exclude / @grant など複数値を取れるキー */
type MetaMultiKey = | "match" | "exclude" | "include" | "grant" | "require" | "resource" | "connect";

/** 単一値しか持てないキー */
type MetaSingleKey =
	| "name"
	| "name:en"
	| "name:ja"
	| "namespace"
	| "version"
	| "description"
	| "description:en"
	| "description:ja"
	| "author"
	| "license"
	| "homepageURL"
	| "supportURL"
	| "updateURL"
	| "downloadURL"
	| "run-at"
	| "icon"
	| "icon64"
	| "noframes"
	| "unwrap"
	| "antifeature";

type MetaKey = MetaSingleKey | MetaMultiKey;

/**
 * 各スクリプト固有の meta.json フォーマット。
 *
 * - 単一値キー: string
 * - 複数値キー: string[]
 * - 共通フィールド (namespace / license / homepageURL / supportURL) は省略可能
 *   → build.ts が自動で補完する
 */
type ScriptMeta = { [K in MetaSingleKey]?: string; } & { [K in MetaMultiKey]?: string[]; };
// endregion

// region 共通メタ（全スクリプト共通で自動補完されるフィールド）
const REPO_ROOT = "https://github.com/nsubaru11/AtCoder";

function buildCommonMeta(scriptName: string): Partial<ScriptMeta> {
	return {
		namespace: `${REPO_ROOT}/tools/userscripts`,
		icon: "https://atcoder.jp/favicon.ico",
		license: "MIT",
		homepageURL: `${REPO_ROOT}/tree/main/tools/userscripts/${scriptName}`,
		supportURL: `${REPO_ROOT}/issues`,
		downloadURL: `https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/${scriptName}/dist/${scriptName}.user.js`,
		updateURL: `https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/${scriptName}/dist/${scriptName}.user.js`,
	};
}

// endregion

// region バリデーション
const VALID_KEYS = new Set<string>([
	// single
	"name", "name:en", "name:ja",
	"namespace",
	"version",
	"description", "description:en", "description:ja",
	"author",
	"license",
	"homepageURL", "supportURL", "updateURL", "downloadURL",
	"run-at",
	"icon", "icon64",
	"noframes", "unwrap",
	"antifeature",
	// multi
	"match", "exclude", "include",
	"grant", "require", "resource", "connect",
]);

const MULTI_KEYS = new Set<string>([
	"match", "exclude", "include", "grant", "require", "resource", "connect",
]);

const REQUIRED_KEYS: (keyof ScriptMeta)[] = ["name", "version", "description", "author"];

function validateMeta(raw: unknown, scriptName: string): ScriptMeta {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`meta.json for ${scriptName}: must be a JSON object`);
	}
	const obj = raw as Record<string, unknown>;

	// 不明なキーを検出
	for (const key of Object.keys(obj)) {
		if (!VALID_KEYS.has(key)) {
			throw new Error(
				`meta.json for ${scriptName}: unknown key "${key}". Valid keys: ${[...VALID_KEYS].join(", ")}`,
			);
		}
	}

	// 必須キーチェック
	for (const key of REQUIRED_KEYS) {
		if (!(key in obj)) {
			throw new Error(`meta.json for ${scriptName}: required key "${key}" is missing`);
		}
	}

	// 型チェック: 複数値キーは string[], 単一値キーは string
	for (const [key, value] of Object.entries(obj)) {
		if (MULTI_KEYS.has(key)) {
			if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
				throw new Error(
					`meta.json for ${scriptName}: "${key}" must be a string array (e.g. ["https://..."])`,
				);
			}
		} else {
			if (typeof value !== "string") {
				throw new Error(
					`meta.json for ${scriptName}: "${key}" must be a string`,
				);
			}
		}
	}

	return obj as ScriptMeta;
}

// endregion

// region バナー生成
/** メタオブジェクトを ==UserScript== バナー文字列に変換する */
function buildBanner(meta: ScriptMeta, scriptName: string): string {
	// 共通フィールドを補完（スクリプト側に書かれていれば上書きしない）
	const common = buildCommonMeta(scriptName);
	const merged: ScriptMeta = {...common, ...meta};

	// キーの表示順を制御（name 系 → namespace → version → ... → grant → match → run-at → URL 系）
	const ORDER: MetaKey[] = [
		"name", "name:en", "name:ja",
		"namespace",
		"version",
		"description", "description:en", "description:ja",
		"author",
		"license",
		"homepageURL", "supportURL",
		"include",
		"match", "exclude",
		"grant",
		"require", "resource", "connect",
		"run-at",
		"icon", "icon64",
		"noframes", "unwrap",
		"antifeature",
		"updateURL", "downloadURL",
	];

	const lines: string[] = ["// ==UserScript=="];
	const keyWidth = Math.max(
		...ORDER.filter((k) => k in merged).map((k) => k.length),
	);

	const appendLine = (key: string, value: string) => {
		lines.push(`// @${key.padEnd(keyWidth)} ${value}`);
	};

	for (const key of ORDER) {
		const value = merged[key as keyof ScriptMeta];
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const v of value) appendLine(key, v);
		} else {
			appendLine(key, value);
		}
	}

	lines.push("// ==/UserScript==");
	return `${lines.join("\n")}\n`;
}

// endregion

// region ファイルパス
const scriptDir = getScriptDir();
const watchDebounceMs = 100;
const ignoredDirectoryNames = ["node_modules"];

function getScriptDir(): string {
	if (typeof Bun !== "undefined" && Bun.main) return dirname(Bun.main);
	const entry = process.argv[1];
	if (!entry) return process.cwd();
	return dirname(isAbsolute(entry) ? entry : resolve(process.cwd(), entry));
}

function scriptPaths(name: string) {
	const root = join(scriptDir, name);
	return {
		entry: join(root, "src", "main.ts"),
		meta: join(root, `meta.json`),
		outdir: join(root, "dist"),
		outfile: join(root, "dist", `${name}.user.js`),
	};
}

// endregion

// region ビルドオプション
type BuildOptions = { watch: boolean; names: string[] };

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
		if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
		names.push(arg);
	}
	return {watch, names};
}

function unique(values: string[]): string[] {
	const result: string[] = [];
	for (const v of values) if (!result.includes(v)) result.push(v);
	return result;
}

// endregion

// region スクリプト探索
async function pathExists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

async function isUserscriptDirectory(name: string): Promise<boolean> {
	const {meta, entry} = scriptPaths(name);
	return (await pathExists(meta)) && (await pathExists(entry));
}

async function discoverScripts(explicitNames: string[]): Promise<string[]> {
	if (explicitNames.length > 0) {
		const names = unique(explicitNames);
		for (const name of names) {
			if (!(await isUserscriptDirectory(name))) {
				throw new Error(`Unknown userscript: ${name}`);
			}
		}
		return names;
	}
	const entries = await readdir(scriptDir, {withFileTypes: true});
	const names: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (ignoredDirectoryNames.includes(entry.name) || entry.name.startsWith(".")) continue;
		if (await isUserscriptDirectory(entry.name)) names.push(entry.name);
	}
	return names.sort();
}

// endregion

// region メタ読み込み
async function loadMeta(name: string): Promise<ScriptMeta> {
	const {meta: metaPath} = scriptPaths(name);
	const raw = await readFile(metaPath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		throw new Error(`${basename(metaPath)} for ${name}: invalid JSON — ${errorMessage(e)}`);
	}
	return validateMeta(parsed, name);
}

// endregion

// region ビルド
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
	const meta = await loadMeta(name);
	const banner = buildBanner(meta, name);
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
		alias: {"@shared": join(scriptDir, "../shared/src")},
	} as Parameters<typeof Bun.build>[0]);

	if (!result.success) {
		for (const log of result.logs) console.error(log.message);
		throw new Error(`Build failed: ${name}`);
	}

	await formatUserscriptOutput(outfile, banner);

	const output = await stat(outfile);
	console.log(`  -> ${name}/dist/${name}.user.js (${output.size} bytes)`);
}

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

async function buildAll(names: string[]): Promise<void> {
	await Promise.all(names.map(buildOne));
}

function createQueuedBuild(names: string[]): () => Promise<void> {
	let running = false;
	let pending = false;
	return async function buildQueued(): Promise<void> {
		if (running) {
			pending = true;
			return;
		}
		running = true;
		try {
			do {
				pending = false;
				await buildAll(names);
			} while (pending);
		} finally {
			running = false;
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
			buildQueued().catch((e: unknown) => console.error(errorMessage(e)));
		}, watchDebounceMs);
	}
}

// endregion

// region エントリポイント
async function main(): Promise<void> {
	assertBunRuntime();
	process.chdir(scriptDir);

	const options = parseArgs(process.argv.slice(2));
	const names = await discoverScripts(options.names);
	if (names.length === 0) throw new Error("No userscript entries found.");

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

main().catch((e: unknown) => {
	console.error(errorMessage(e));
	process.exit(1);
});
// endregion
