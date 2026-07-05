import fs from "node:fs";
import type {RunnerStatusInfo} from "../../types";
import {CLI_CONFIG} from "../../config";
import {ANSI, supportsCliColor} from "../../utils";
import {getSampleCacheDir} from "../sampleCache";
import type {Command} from "./Command";

/** ミリ秒を "1h 23m 45s" のような短い表記にする。 */
function formatUptime(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

/** CLI 側で持っているサンプルキャッシュ（~/.atcoder/cache/samples）のエントリ数。 */
function countSampleCacheEntries(): number {
	const dir = getSampleCacheDir();
	if (!dir) return 0;
	try {
		return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).length;
	} catch {
		return 0;
	}
}

/**
 * Local Runner サーバーの稼働状況を表示する。auto-start はせず、
 * 停止中ならその旨だけを表示する（終了コード: 稼働中=0 / 停止中=1）。
 */
export class StatusCommand implements Command {
	readonly name = "status";
	readonly usageLines = [
		"  status                                  (Local Runner サーバーの稼働状況を表示。稼働中=0/停止中=1)",
	];

	async execute(): Promise<number> {
		const color = supportsCliColor();
		let info: RunnerStatusInfo | null = null;
		try {
			const res = await fetch(CLI_CONFIG.defaultLocalRunnerUrl, {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({mode: "status"}),
				signal: AbortSignal.timeout(3000),
			});
			if (res.ok) info = await res.json() as RunnerStatusInfo;
		} catch {
			// 接続失敗＝停止中として扱う
		}

		const sampleCacheCount = countSampleCacheEntries();
		if (!info) {
			const label = color ? `${ANSI.RED}stopped${ANSI.RESET}` : "stopped";
			console.log(`Local Runner: ${label} (${CLI_CONFIG.defaultLocalRunnerUrl})`);
			console.log(`  sample cache:  ${sampleCacheCount} task(s) (${getSampleCacheDir() || "-"})`);
			console.log(`  起動するには: serve（または test/localtest/run で自動起動）`);
			return 1;
		}

		const label = color ? `${ANSI.GREEN}running${ANSI.RESET}` : "running";
		const dispatcher = info.dispatcherRunning
			? (color ? `${ANSI.GREEN}running${ANSI.RESET}` : "running")
			: (color ? `${ANSI.YELLOW}stopped${ANSI.RESET}` : "stopped");
		console.log(`Local Runner: ${label} (${CLI_CONFIG.defaultLocalRunnerUrl})`);
		console.log(`  pid:           ${info.pid}`);
		console.log(`  uptime:        ${formatUptime(info.uptimeMs)}`);
		console.log(`  java:          ${info.javaVersion}`);
		console.log(`  label:         ${info.runnerLabel}`);
		console.log(`  dispatcher:    ${dispatcher}`);
		console.log(`  compile cache: ${info.compileCacheSize}/${info.compileCacheMax} entries`);
		console.log(`  warmup:        ${info.warmUpProfile}`);
		console.log(`  base dir:      ${info.baseDir}`);
		console.log(`  log file:      ${info.logFile}`);
		console.log(`  sample cache:  ${sampleCacheCount} task(s) (${getSampleCacheDir() || "-"})`);
		return 0;
	}
}
