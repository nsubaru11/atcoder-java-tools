import * as color from "./color";

/** 実行時間を整形。warnMs 超は黄色、dangerMs 以上は赤で警告表示する。 */
export function formatExecTime(timeMs: number, thresholds: ExecTimeThresholds = thresholdsFromTimeLimit()) {
	const text = `${timeMs}ms`;
	if (timeMs >= thresholds.dangerMs) {
		const warned = `${text} (>=${thresholds.dangerMs}ms!)`;
		return color.supportsCliColor() ? `${color.ANSI.RED}${warned}${color.ANSI.RESET}` : warned;
	}
	if (timeMs > thresholds.warnMs) {
		const warned = `${text} (>${thresholds.warnMs}ms!)`;
		return color.supportsCliColor() ? `${color.ANSI.YELLOW}${warned}${color.ANSI.RESET}` : warned;
	}
	return text;
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
		`Status=${color.colorizeStatus(status, "runner")}`,
		`Wait=${waitMs}ms`,
		`Exec=${result.time}ms`,
		`Total=${totalMs}ms`,
		`Exit=${result.exitCode}`,
	];
	if ((result.memory || 0) > 0) {
		// 累積アロケーション量（ピーク RSS ではない）であることを示すため Alloc と表記する。
		parts.push(`Alloc=${result.memory}KB`);
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

/** 実行時間の表示しきい値。warnMs 超で黄色、dangerMs 以上で赤。 */
type ExecTimeThresholds = {
	warnMs: number;
	dangerMs: number;
};

/**
 * 実行時間制限(ms)から表示しきい値を作る（警告=制限の80%超、赤=制限以上）。
 * 制限が不明なローカル実行（localtest/run/crosscheck）は AtCoder で最も一般的な
 * 2000ms を仮の制限として warn=1600ms / danger=2000ms とする。
 * ローカルはウォームアップ済み JVM のため本番より速く出やすく、あくまで目安の警告。
 */
export function thresholdsFromTimeLimit(timeLimitMs?: number): ExecTimeThresholds {
	const limit = timeLimitMs && timeLimitMs > 0 ? timeLimitMs : 2000;
	return {warnMs: Math.round(limit * 0.8), dangerMs: limit};
}


function toRunLabel(status: string) {
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
