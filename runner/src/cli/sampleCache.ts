import fs from "node:fs";
import path from "node:path";
import type {SamplePair, Task} from "../types";
import {CLI_CONFIG} from "../config";

/**
 * AtCoder のサンプルケース（パース済み SamplePair[]）を永続キャッシュする。
 *
 * 設計方針:
 * - 生 HTML ではなく抽出後のサンプルのみを保存する（1件あたり概ね数 KB）。
 * - サンプルは問題確定後ほぼ不変なので TTL は設けない。
 * - キーは taskScreenName（例: abc463_d）をファイル名に使う。AtCoder の screen name は
 *   英数字とアンダースコアのみだが、安全のため不正文字は "_" に正規化する（sha256 は不要）。
 * - 保存先は ~/.atcoder/cache/samples/。Local Runner サーバー（HTTP デーモン）とは独立した
 *   CLI 側データなので、`stop` でサーバーを止めても削除しない。明示的な `cache clear` で消す。
 */

const CACHE_FORMAT_VERSION = 1;

type SampleCacheFile = {
	version: number;
	taskScreenName: string;
	fetchedAt: number;
	samples: SamplePair[];
};

function isCacheEnabled(): boolean {
	return process.env.ATCODER_NO_CACHE !== "1";
}

function resolveHomeDir(): string {
	return process.env.USERPROFILE || process.env.HOME || "";
}

/** サンプルキャッシュのディレクトリ（~/.atcoder/cache/samples）。home 不明時は空文字。 */
export function getSampleCacheDir(): string {
	const home = resolveHomeDir();
	return home ? path.join(home, CLI_CONFIG.sampleCacheDirRelative) : "";
}

/** taskScreenName をファイル名として安全な形に正規化する。 */
function safeKey(taskScreenName: string): string {
	return taskScreenName.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function cacheFilePath(taskScreenName: string): string {
	const dir = getSampleCacheDir();
	return dir ? path.join(dir, `${safeKey(taskScreenName)}.json`) : "";
}

/** キャッシュからサンプルを読む。無効・不在・壊れている場合は null。 */
export function readCachedSamples(task: Task): SamplePair[] | null {
	if (!isCacheEnabled()) return null;
	const file = cacheFilePath(task.taskScreenName);
	if (!file) return null;
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SampleCacheFile;
		if (parsed.version !== CACHE_FORMAT_VERSION) return null;
		if (!Array.isArray(parsed.samples)) return null;
		return parsed.samples;
	} catch {
		return null;
	}
}

/** サンプルをキャッシュへ保存する。失敗しても致命的ではないので握り潰す。 */
export function writeCachedSamples(task: Task, samples: SamplePair[]): void {
	if (!isCacheEnabled()) return;
	if (!samples.length) return; // 空サンプルはキャッシュしない（取得失敗時の取りこぼし防止）
	const dir = getSampleCacheDir();
	const file = cacheFilePath(task.taskScreenName);
	if (!dir || !file) return;
	const payload: SampleCacheFile = {
		version: CACHE_FORMAT_VERSION,
		taskScreenName: task.taskScreenName,
		fetchedAt: Date.now(),
		samples,
	};
	try {
		fs.mkdirSync(dir, {recursive: true});
		fs.writeFileSync(file, JSON.stringify(payload), "utf8");
		pruneIfNeeded(dir);
	} catch {
		// キャッシュ書き込み失敗は無視（本処理には影響させない）
	}
}

/** エントリ数が上限を超えたら、古いもの（mtime 昇順）から削除して上限に収める。 */
function pruneIfNeeded(dir: string): void {
	const max = CLI_CONFIG.sampleCacheMaxEntries;
	if (!Number.isFinite(max) || max <= 0) return;
	let entries: Array<{ file: string; mtimeMs: number }>;
	try {
		entries = fs.readdirSync(dir)
			.filter((name) => name.endsWith(".json"))
			.map((name) => {
				const full = path.join(dir, name);
				return {file: full, mtimeMs: fs.statSync(full).mtimeMs};
			});
	} catch {
		return;
	}
	if (entries.length <= max) return;
	entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
	for (const {file} of entries.slice(0, entries.length - max)) {
		try {
			fs.rmSync(file, {force: true});
		} catch {
			// 個別削除失敗は無視
		}
	}
}

/** 指定タスクのキャッシュ1件を削除する。削除できたら true、対象が無ければ false。 */
export function clearSampleCacheForTask(taskScreenName: string): boolean {
	const file = cacheFilePath(taskScreenName);
	if (!file || !fs.existsSync(file)) return false;
	try {
		fs.rmSync(file, {force: true});
		return true;
	} catch {
		return false;
	}
}

/** キャッシュを全削除する。削除した件数を返す。 */
export function clearSampleCache(): number {
	const dir = getSampleCacheDir();
	if (!dir || !fs.existsSync(dir)) return 0;
	let removed = 0;
	try {
		for (const name of fs.readdirSync(dir)) {
			if (!name.endsWith(".json")) continue;
			try {
				fs.rmSync(path.join(dir, name), {force: true});
				removed++;
			} catch {
				// 個別削除失敗は無視
			}
		}
	} catch {
		// ディレクトリ読み取り失敗は 0 件扱い
	}
	return removed;
}
