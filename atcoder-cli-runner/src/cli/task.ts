import type {Task} from "../types";

export function parseTask(taskScreenName: string): Task {
	if (!/^[a-z0-9_]+$/.test(taskScreenName)) {
		throw new Error(`Invalid taskScreenName: ${taskScreenName}`);
	}
	const idx = taskScreenName.lastIndexOf("_");
	if (idx <= 0 || idx === taskScreenName.length - 1) {
		throw new Error(`Invalid taskScreenName format: ${taskScreenName}`);
	}
	const contestId = taskScreenName.slice(0, idx);
	return {
		contestId,
		taskScreenName,
		taskUrl: `https://atcoder.jp/contests/${contestId}/tasks/${taskScreenName}`,
		submitUrl: `https://atcoder.jp/contests/${contestId}/submit?taskScreenName=${taskScreenName}`,
		submitPostUrl: `https://atcoder.jp/contests/${contestId}/submit`,
	};
}
