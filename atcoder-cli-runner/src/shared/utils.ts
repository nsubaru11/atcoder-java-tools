import fs from "node:fs";
import {LOG_FILE_PATH, RUNNER_CONFIG} from "./config";

export const ANSI = {
	RESET: "\x1b[0m",
	GREEN: "\x1b[32m",
	RED: "\x1b[31m",
	YELLOW: "\x1b[33m",
	ORANGE: "\x1b[38;5;208m",
	CYAN: "\x1b[36m",
};

export function normalizeNewlines(text: string) {
	return text.replace(/\r\n?/g, "\n");
}

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function supportsCliColor() {
	return process.stdout.isTTY && !process.env.NO_COLOR;
}

export function supportsRunnerColor() {
	if (process.env.NO_COLOR) return false;
	return process.env.LOCAL_RUNNER_FORCE_COLOR !== "0";
}

export function colorizeStatus(status: string, mode: "cli" | "runner" = "cli") {
	const supportsColor = mode === "runner" ? supportsRunnerColor() : supportsCliColor();
	if (!supportsColor) return status;
	if (status === "AC") return `${ANSI.GREEN}${status}${ANSI.RESET}`;
	if (status === "WA") return `${ANSI.RED}${status}${ANSI.RESET}`;
	if (status === "CE") return `${ANSI.YELLOW}${status}${ANSI.RESET}`;
	if (["RE", "TLE", "MLE", "OLE", "IE"].includes(status)) return `${ANSI.ORANGE}${status}${ANSI.RESET}`;
	if (["WJ", "WR"].includes(status)) return `${ANSI.CYAN}${status}${ANSI.RESET}`;
	return status;
}

export function stripAnsi(text: string) {
	return String(text || "").replace(/\x1B\[[0-9;]*m/g, "");
}

export function ensureDirectory(targetDir: string) {
	fs.mkdirSync(targetDir, {recursive: true});
}

export function removeDirectory(targetDir: string) {
	try {
		fs.rmSync(targetDir, {recursive: true, force: true});
	} catch {
	}
}

export function firstLine(text: string | null | undefined) {
	if (!text) return "";
	return String(text).replace(/\r\n?/g, "\n").split("\n")[0].trim();
}

export function trimForLog(text: string | null | undefined, maxLen = 72) {
	if (!text) return "";
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen - 3)}...`;
}

export function shortHash(hash: string) {
	if (!hash) return "";
	return hash.length <= 16 ? hash : `${hash.slice(0, 16)}...`;
}

function formatLogLine(level: string, message: string) {
	return `[${new Date().toISOString()}] [${level}] ${message}`;
}

function rotateLogFileIfNeeded() {
	if (RUNNER_CONFIG.maxLogFileSize <= 0 || !fs.existsSync(LOG_FILE_PATH)) {
		return;
	}
	const currentSize = fs.statSync(LOG_FILE_PATH).size;
	if (currentSize < RUNNER_CONFIG.maxLogFileSize) {
		return;
	}
	const backupPath = `${LOG_FILE_PATH}.1`;
	try {
		if (fs.existsSync(backupPath)) {
			fs.rmSync(backupPath, {force: true});
		}
		fs.renameSync(LOG_FILE_PATH, backupPath);
	} catch {
	}
}

function appendLogLine(line: string) {
	try {
		fs.mkdirSync(RUNNER_CONFIG.baseDir, {recursive: true});
		rotateLogFileIfNeeded();
		fs.appendFileSync(LOG_FILE_PATH, `${stripAnsi(line)}\n`, "utf8");
	} catch {
	}
}

export function logInfo(message: string) {
	const line = formatLogLine("INFO", message);
	process.stdout.write(`${line}\n`);
	appendLogLine(line);
}

export function logWarn(message: string) {
	const line = formatLogLine("WARN", message);
	process.stderr.write(`${line}\n`);
	appendLogLine(line);
}

export function logError(message: string) {
	const line = formatLogLine("ERROR", message);
	process.stderr.write(`${line}\n`);
	appendLogLine(line);
}

export function toRunLabel(status: string) {
	switch (status) {
		case "success":
			return "AC";
		case "compileError":
			return "CE";
		case "timeLimitExceeded":
			return "TLE";
		case "runtimeError":
			return "RE";
		case "internalError":
			return "IE";
		default:
			return String(status || "UNKNOWN").toUpperCase();
	}
}

export function formatRunSummary(result: {
	status: string;
	time?: number;
	exitCode?: number;
	memory?: number;
	stdoutTruncated?: boolean;
	stderrTruncated?: boolean;
	stderr?: string;
}, waitMs: number, totalMs: number, modeTag: string) {
	const status = toRunLabel(result.status);
	const parts = [
		`[Run]`,
		`Mode=${modeTag}`,
		`Status=${colorizeStatus(status, "runner")}`,
		`Wait=${waitMs}ms`,
		`Exec=${result.time}ms`,
		`Total=${totalMs}ms`,
		`Exit=${result.exitCode}`,
	];
	if ((result.memory || 0) > 0) {
		parts.push(`Memory=${result.memory}KB`);
	}
	if (result.stdoutTruncated || result.stderrTruncated) {
		const flags = [];
		if (result.stdoutTruncated) flags.push("stdout");
		if (result.stderrTruncated) flags.push("stderr");
		parts.push(`Truncated=${flags.join(",")}`);
	}
	let summary = parts.join(" ");

	if (result.stderr && result.status !== "success") {
		const maxLines = 10;
		const lines = result.stderr.trim().split(/\r?\n/);
		const visibleLines = lines.slice(0, maxLines);
		summary += `\nError= ` + visibleLines.join("\n  ");
		if (lines.length > maxLines) {
			summary += `\n  ... (and ${lines.length - maxLines} more lines)`;
		}
	}

	return summary;
}
