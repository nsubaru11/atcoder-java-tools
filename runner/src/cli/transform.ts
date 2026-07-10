import fs from "node:fs";
import path from "node:path";

export function resolveSourceFilePath(sourceFilePath: string) {
	if (!sourceFilePath.endsWith(".java")) sourceFilePath += ".java";
	const direct = path.resolve(sourceFilePath);
	if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
	throw new Error(`Source file not found from current directory: ${sourceFilePath}`);
}
