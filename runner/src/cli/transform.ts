import fs from "node:fs";
import path from "node:path";
import {modifyJavaCode} from "@atcoder-tools/shared";
import {type BundleResult, bundleJavaSource, hasLibImports} from "./java-bundle";

export function resolveSourceFilePath(sourceFilePath: string) {
	if (!sourceFilePath.endsWith(".java")) sourceFilePath += ".java";
	const direct = path.resolve(sourceFilePath);
	if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
	throw new Error(`Source file not found from current directory: ${sourceFilePath}`);
}

/**
 * ライブラリの src ルート（library/src。直下に lib/ を含む）を探す。
 * 1. 環境変数 ATCODER_LIB_SRC（src ルートを直接指定）
 * 2. ソースファイルの位置から上方向に library/src/lib を探索（AtCoder リポジトリの submodule 配置）
 */
export function findLibrarySrcRoot(sourceFilePath: string): string | null {
	const envRoot = process.env.ATCODER_LIB_SRC;
	if (envRoot) {
		if (fs.existsSync(path.join(envRoot, "lib"))) return path.resolve(envRoot);
		throw new Error(`ATCODER_LIB_SRC が不正です（lib/ がありません）: ${envRoot}`);
	}
	let dir = path.dirname(path.resolve(sourceFilePath));
	for (; ;) {
		const candidate = path.join(dir, "library", "src");
		if (fs.existsSync(path.join(candidate, "lib"))) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/**
 * ソースが lib.* を import していればライブラリを解決してバンドルする。
 * import が無ければ何もしない（従来の手貼りソースはそのまま通る）。
 * lib import があるのにライブラリが見つからない場合は、未解決コードを提出しないよう明確に失敗させる。
 */
export function bundleIfNeeded(sourceCode: string, resolvedSourcePath: string): BundleResult {
	if (!hasLibImports(sourceCode)) {
		return {bundled: sourceCode, usedLibrary: false, inlined: []};
	}
	const libSrcRoot = findLibrarySrcRoot(resolvedSourcePath);
	if (!libSrcRoot) {
		throw new Error(
			"lib.* の import がありますが、ライブラリが見つかりません。\n" +
			"  リポジトリ直下に library submodule があるか確認するか（git submodule update --init）、\n" +
			"  環境変数 ATCODER_LIB_SRC で library/src を指定してください。",
		);
	}
	return bundleJavaSource(sourceCode, {libSrcRoot});
}

export function forceMainAndDebug(sourceCode: string, debug = false) {
	const result = modifyJavaCode(sourceCode, {
		removePackage: true,
		renameClass: true,
		fixDebug: !debug,
		enableDebug: debug,
	});
	return result.modified;
}
