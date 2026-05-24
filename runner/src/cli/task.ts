import type {Task} from "../types";
import {
	buildAtCoderSubmitPostUrl,
	buildAtCoderSubmitUrl,
	buildAtCoderTaskUrl,
	parseAtCoderTaskScreenName,
} from "@shared/atcoder-url";

export function parseTask(taskScreenName: string): Task {
	const task = parseAtCoderTaskScreenName(taskScreenName);
	if (!task) {
		throw new Error(`Invalid taskScreenName: ${taskScreenName}`);
	}
	return {
		contestId: task.contestId,
		taskScreenName: task.taskId,
		taskUrl: buildAtCoderTaskUrl(task),
		submitUrl: buildAtCoderSubmitUrl(task),
		submitPostUrl: buildAtCoderSubmitPostUrl(task.contestId),
	};
}
