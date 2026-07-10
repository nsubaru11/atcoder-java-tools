import fs from "node:fs";
import path from "node:path";
import {normalizeNewlines} from "../../utils";
import {bundleIfNeeded, forceMainAndDebug, resolveSourceFilePath} from "../transform";

/** prepareSource の戻り値（複数コマンドで共有する整形済みソース情報）。 */
export type PreparedSource = {
	resolvedSourcePath: string;
	transformed: string;
	originalFileName: string;
	originalClassName: string;
	/** ライブラリ展開でインラインされた FQCN 一覧（展開なしなら空）。 */
	inlinedClasses: string[];
};

/**
 * ソースファイルを解決して読み込み、ライブラリ展開（lib import があれば）→
 * Main クラス化 + （任意で）DEBUG 有効化した文字列を返す。
 * run / localtest / tomain / test / submit が共通で使う前処理。
 * すべての経路がバンドル後のソースを使うため、ローカル実行と提出物が常に一致する。
 */
export function prepareSource(sourceFilePath: string, debug = false): PreparedSource {
	const resolvedSourcePath = resolveSourceFilePath(sourceFilePath);
	const source = normalizeNewlines(fs.readFileSync(resolvedSourcePath, "utf8"));
	const bundleResult = bundleIfNeeded(source, resolvedSourcePath);
	if (bundleResult.usedLibrary) {
		console.log(`Bundled library classes: ${bundleResult.inlined.join(", ")}`);
	}
	const transformed = forceMainAndDebug(bundleResult.bundled, debug);
	const originalFileName = path.basename(resolvedSourcePath);
	const originalClassName = originalFileName.replace(/\.java$/i, "");
	return {resolvedSourcePath, transformed, originalFileName, originalClassName, inlinedClasses: bundleResult.inlined};
}
