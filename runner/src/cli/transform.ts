import fs from "node:fs";
import path from "node:path";
import {modifyJavaCode} from "@atcoder-tools/shared";

export function resolveSourceFilePath(sourceFilePath: string) {
	const direct = path.resolve(sourceFilePath);
	if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
	throw new Error(`Source file not found from current directory: ${sourceFilePath}`);
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
