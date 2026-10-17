import fs from "node:fs";
import path from "node:path";
import * as shared from "@atcoder-tools/shared";
import {CLI_CONFIG} from "../../config";
import * as ensureServer from "../ensureServer";
import * as transform from "../transform";

/** prepareSource の戻り値（複数コマンドで共有する整形済みソース情報）。 */
export type PreparedSource = {
	resolvedSourcePath: string;
	transformed: string;
	originalFileName: string;
	originalClassName: string;
	/** コンパイル済みプログラムを参照するID。実行系コマンドでのみ設定される。 */
	programId?: string;
	/** ライブラリ展開でインラインされた FQCN 一覧（展開なしなら空）。 */
	inlinedClasses: string[];
};

/**
 * ソースファイルを解決して読み込み、ライブラリ展開（lib import があれば）→
 * Main クラス化 + （任意で）DEBUG 有効化した文字列を返す。
 * run / localtest / tomain / test / submit が共通で使う前処理。
 * すべての経路がバンドル後のソースを使うため、ローカル実行と提出物が常に一致する。
 */
export async function prepareSource(
	sourceFilePath: string,
	debug = false,
	options: {compile?: boolean; validate?: boolean} = {},
): Promise<PreparedSource> {
	const resolvedSourcePath = transform.resolveSourceFilePath(sourceFilePath);
	const sourceText = shared.normalizeNewlines(fs.readFileSync(resolvedSourcePath, "utf8"));
	await ensureServer.ensureLocalRunnerReady();
	const compile = options.compile === true;
	const validate = options.validate ?? !compile;
	let preparedByServer = compile;
	let response = await fetch(CLI_CONFIG.defaultLocalRunnerUrl, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(compile
			? shared.buildLocalRunnerPrepareRequest(sourceText, debug, true, validate)
			: shared.buildLocalRunnerTransformRequest(sourceText, debug, true, validate)),
	});
	// 更新前の常駐daemonが残っている場合も、そのコマンドだけ従来経路で動作させる。
	if (compile && response.status === 400) {
		preparedByServer = false;
		response = await fetch(CLI_CONFIG.defaultLocalRunnerUrl, {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify(shared.buildLocalRunnerTransformRequest(sourceText, debug, true, validate)),
		});
	}
	if (!response.ok) throw new Error(`Local runner transform failed: ${response.status}`);
	const transformedResult = await response.json() as shared.LocalRunnerTransformResponse | shared.LocalRunnerPrepareResponse;
	if (transformedResult.status !== "success") {
		throw new Error(transformedResult.diagnostics || "Java source transformation failed.");
	}
	if (preparedByServer && !("programId" in transformedResult && transformedResult.programId)) {
		throw new Error("Local runner did not return a prepared program ID.");
	}
	if (transformedResult.addedImports.length > 0) {
		console.log(`Added library imports: ${transformedResult.addedImports.join(", ")}`);
	}
	if (transformedResult.inlinedClasses.length > 0) {
		console.log(`Bundled library classes: ${transformedResult.inlinedClasses.join(", ")}`);
	}
	const originalFileName = path.basename(resolvedSourcePath);
	const originalClassName = originalFileName.replace(/\.java$/i, "");
	return {
		resolvedSourcePath,
		transformed: transformedResult.sourceCode,
		originalFileName,
		originalClassName,
		programId: "programId" in transformedResult ? transformedResult.programId : undefined,
		inlinedClasses: transformedResult.inlinedClasses,
	};
}
