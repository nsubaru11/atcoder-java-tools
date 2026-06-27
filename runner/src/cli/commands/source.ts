import fs from "node:fs";
import path from "node:path";
import {normalizeNewlines} from "../../utils";
import {forceMainAndDebug, resolveSourceFilePath} from "../transform";

/** prepareSource の戻り値（複数コマンドで共有する整形済みソース情報）。 */
export type PreparedSource = {
	resolvedSourcePath: string;
	transformed: string;
	originalFileName: string;
	originalClassName: string;
};

/**
 * ソースファイルを解決して読み込み、Main クラス化 + （任意で）DEBUG 有効化した文字列を返す。
 * run / localtest / tomain / test / submit が共通で使う前処理。
 */
export function prepareSource(sourceFilePath: string, debug = false): PreparedSource {
	const resolvedSourcePath = resolveSourceFilePath(sourceFilePath);
	const source = normalizeNewlines(fs.readFileSync(resolvedSourcePath, "utf8"));
	const transformed = forceMainAndDebug(source, debug);
	const originalFileName = path.basename(resolvedSourcePath);
	const originalClassName = originalFileName.replace(/\.java$/i, "");
	return {resolvedSourcePath, transformed, originalFileName, originalClassName};
}
