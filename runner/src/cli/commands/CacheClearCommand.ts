import {clearSampleCache, clearSampleCacheForTask} from "../sampleCache";
import type {Command} from "./Command";

/**
 * サンプルキャッシュを削除する。独自フラグ（-a / -t）を自前で解釈する。
 *   cacheclear -a                  … 全削除
 *   cacheclear -t <taskScreenName> … 指定タスクのみ削除
 */
export class CacheClearCommand implements Command {
	readonly name = "cacheclear";
	readonly usageLines = [
		"  cacheclear -a                           (サンプルキャッシュを全削除)",
		"  cacheclear -t <taskScreenName>          (指定タスクのキャッシュのみ削除。例: cacheclear -t abc456_a)",
	];

	execute(args: readonly string[]): number {
		const flag = args[0];
		if (flag === "-a") {
			const removed = clearSampleCache();
			console.log(`サンプルキャッシュを全削除しました（${removed} 件）。`);
			return 0;
		}
		if (flag === "-t") {
			const taskScreenName = args[1];
			if (!taskScreenName) {
				console.error("Usage: cacheclear -t <taskScreenName>");
				return 1;
			}
			const removed = clearSampleCacheForTask(taskScreenName);
			console.log(removed
				? `サンプルキャッシュを削除しました: ${taskScreenName}`
				: `対象のサンプルキャッシュは見つかりませんでした: ${taskScreenName}`);
			return 0;
		}
		console.error("Usage:");
		console.error("  cacheclear -a                  (全削除)");
		console.error("  cacheclear -t <taskScreenName> (指定タスクのみ削除)");
		return 1;
	}
}
