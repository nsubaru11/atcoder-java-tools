import fs from "node:fs";
import path from "node:path";
import type {SamplePair} from "../types";
import {normalizeNewlines} from "../utils";

const INPUT_EXTS = [".in", ".txt", ".input"];
const OUTPUT_EXTS = [".out", ".output", ".ans", ".expected"];
const TEST_DIR_NAMES = ["tests", "test", "testcases", "sample", "samples", "judgedata"];

/** ソースの近傍から .in/.out ペアを探し、SamplePair[] を返す。 */
export function loadLocalSamples(sourceFilePath: string, testDir?: string): SamplePair[] {
	const resolved = path.resolve(sourceFilePath);
	const stem = path.basename(resolved, path.extname(resolved));

	const candidateDirs = testDir
		? [path.resolve(testDir), path.join(path.resolve(testDir), stem)] // 直接指定（中の <stem>/ も見る）
		: buildAutoDirs(path.dirname(resolved), stem);

	const tried: string[] = [];
	for (const dir of candidateDirs) {
		tried.push(dir);
		if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
		const pairs = collectPairs(dir);
		if (pairs.length > 0) return pairs;
	}
	throw new Error(`No local sample (.in/.out) pairs found. Looked in:\n  ${tried.join("\n  ")}`);
}

function buildAutoDirs(sourceDir: string, stem: string): string[] {
	const root = path.dirname(sourceDir); // 例: .../Prelim2025
	const dirs: string[] = [path.join(root, stem)]; // <root>/A（問題フォルダが src と並列のとき）
	for (const name of TEST_DIR_NAMES) {
		dirs.push(path.join(root, name));        // <root>/judgedata
		dirs.push(path.join(root, name, stem));  // <root>/judgedata/A
	}
	return [...new Set(dirs)];
}

function collectPairs(dir: string): SamplePair[] {
	const inputs = new Map<string, string>();
	const outputs = new Map<string, string>();

	for (const name of fs.readdirSync(dir)) {
		const ext = path.extname(name).toLowerCase();
		const key = name.slice(0, name.length - ext.length);
		if (INPUT_EXTS.includes(ext)) inputs.set(key, name);
		else if (OUTPUT_EXTS.includes(ext)) outputs.set(key, name);
	}

	// 入力・出力どちらか一方しか無いケースも含める
	const keys = [...new Set([...inputs.keys(), ...outputs.keys()])].sort((a, b) =>
		a.localeCompare(b, undefined, {numeric: true, sensitivity: "base"}),
	);

	const read = (name: string) => normalizeNewlines(fs.readFileSync(path.join(dir, name), "utf8"));
	const pairs: SamplePair[] = [];
	for (const key of keys) {
		const inName = inputs.get(key);
		const outName = outputs.get(key);
		pairs.push({
			index: pairs.length + 1,
			input: inName ? read(inName) : "",                    // 入力なし → 空標準入力
			expectedOutput: outName ? read(outName) : undefined,  // 出力なし → 判定せず実行のみ
		});
	}
	return pairs;
}
