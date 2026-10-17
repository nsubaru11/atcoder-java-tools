import type {Task} from "../types";
import * as shared from "@atcoder-tools/shared";

export function parseTask(taskScreenName: string): Task {
	const task = shared.parseAtCoderTaskScreenName(taskScreenName);
	if (!task) {
		throw new Error(`Invalid taskScreenName: ${taskScreenName}`);
	}
	return createTask(task.contestId, task.taskId);
}

/** コンテストIDと問題IDが異なる別名コンテスト向けに、両者を明示して Task を作る。 */
export function createTask(contestId: string, taskScreenName: string): Task {
	if (!/^[a-z0-9-]+$/.test(contestId) || !/^[a-z0-9_]+$/.test(taskScreenName)) {
		throw new Error(`Invalid AtCoder task: contest=${contestId}, task=${taskScreenName}`);
	}
	const task = {contestId, taskId: taskScreenName};
	return {
		contestId: task.contestId,
		taskScreenName: task.taskId,
		taskUrl: shared.buildAtCoderTaskUrl(task),
		submitUrl: shared.buildAtCoderSubmitUrl(task),
		submitPostUrl: shared.buildAtCoderSubmitPostUrl(task.contestId),
	};
}
