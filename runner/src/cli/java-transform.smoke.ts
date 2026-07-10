import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const runnerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDir = path.join(runnerRoot, "java", "src");
const testFile = path.join(runnerRoot, "java", "test", "JavaSourceTransformerTest.java");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "java-source-transformer-smoke-"));

try {
	const javaSources = fs.readdirSync(sourceDir)
		.filter((name) => name.endsWith(".java") && name !== "WarmUp.java")
		.map((name) => path.join(sourceDir, name));
	const compile = spawnSync("javac", ["--release", "24", "-encoding", "UTF-8", "-d", output, ...javaSources, testFile], {
		encoding: "utf8",
		stdio: "inherit",
	});
	if (compile.status !== 0) process.exit(compile.status ?? 1);
	const run = spawnSync("java", ["-cp", output, "JavaSourceTransformerTest"], {encoding: "utf8", stdio: "inherit"});
	if (run.status !== 0) process.exit(run.status ?? 1);
} finally {
	fs.rmSync(output, {recursive: true, force: true});
}
