import fs from "node:fs";

export function ensureDirectory(targetDir: string) {
	fs.mkdirSync(targetDir, {recursive: true});
}

export function removeDirectory(targetDir: string) {
	try {
		fs.rmSync(targetDir, {recursive: true, force: true});
	} catch {
	}
}
