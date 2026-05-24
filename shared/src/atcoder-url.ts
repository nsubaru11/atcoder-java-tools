import type {AtCoderTaskId} from "./types";

const ATCODER_TASK_URL_PATTERN =
	/^https:\/\/atcoder\.jp\/contests\/([^/?#]+)\/tasks\/([^/?#]+)/;

const ATCODER_TASK_SCREEN_NAME_PATTERN = /^[a-z0-9_]+$/;

export function parseAtCoderTaskUrl(url: string): AtCoderTaskId | null {
	const match = url.match(ATCODER_TASK_URL_PATTERN);
	if (!match) return null;
	return {
		contestId: match[1],
		taskId: match[2],
	};
}

export function parseAtCoderTaskScreenName(taskScreenName: string): AtCoderTaskId | null {
	if (!ATCODER_TASK_SCREEN_NAME_PATTERN.test(taskScreenName)) return null;
	const separatorIndex = taskScreenName.lastIndexOf("_");
	if (separatorIndex <= 0 || separatorIndex === taskScreenName.length - 1) return null;
	return {
		contestId: taskScreenName.slice(0, separatorIndex),
		taskId: taskScreenName,
	};
}

export function buildAtCoderTaskUrl(task: AtCoderTaskId): string {
	return `https://atcoder.jp/contests/${task.contestId}/tasks/${task.taskId}`;
}

export function buildAtCoderSubmitUrl(task: AtCoderTaskId): string {
	return `https://atcoder.jp/contests/${task.contestId}/submit?taskScreenName=${task.taskId}`;
}

export function buildAtCoderSubmitPostUrl(contestId: string): string {
	return `https://atcoder.jp/contests/${contestId}/submit`;
}
