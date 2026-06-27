import {buildAtCoderSubmissionUrl} from "@atcoder-tools/shared";
import {colorizeStatus} from "../../utils";
import {
	fetchLatestSubmissionId,
	formatMetricValue,
	pollSubmissionFinal,
	submitToAtCoder,
	toCookieHeader,
} from "../atcoder";
import {TaskCommand, type TaskRunContext} from "./TaskCommand";

/** サンプルが全 AC なら（-f 指定時は非 AC でも）AtCoder へ提出し、結果をポーリング表示する。 */
export class SubmitCommand extends TaskCommand {
	readonly name = "submit";
	readonly usageLines = [
		"  submit [-f|--force] <taskScreenName> <sourceFile>",
		"  submit [-f|--force] <task>              (短縮: 同上。例: submit d)",
	];
	protected readonly allowForce = true;
	protected readonly debug = false;

	protected async onSamplesComplete({task, transformed, allAccepted, force}: TaskRunContext): Promise<number> {
		if (!allAccepted) {
			if (!force) {
				console.log("Not submitting because at least one sample test is not AC.");
				return 5;
			}
			console.log("Warning: forcing submit despite non-AC sample results (-f/--force).");
		}

		const submitResult = await submitToAtCoder(task, transformed, toCookieHeader());
		if (submitResult.trackingUnavailable) {
			const latestId = await fetchLatestSubmissionId(task, toCookieHeader());
			if (!latestId) {
				throw new Error("Submission tracking failed: could not resolve latest submission ID.");
			}
			const trackedSubmissionUrl = buildAtCoderSubmissionUrl(task.contestId, latestId);
			const trackedResult = await pollSubmissionFinal(trackedSubmissionUrl, toCookieHeader());
			console.log(
				`Result: ${colorizeStatus(trackedResult.status)} | ID: ${latestId} | Exec: ${formatMetricValue(trackedResult.execTime)} | Memory: ${formatMetricValue(trackedResult.memory)} | URL: ${trackedSubmissionUrl}`,
			);
			return trackedResult.status === "AC" ? 0 : 8;
		}

		const finalResult = await pollSubmissionFinal(submitResult.submissionUrl, toCookieHeader());
		console.log(
			`Result: ${colorizeStatus(finalResult.status)} | ID: ${submitResult.submissionId} | Exec: ${formatMetricValue(finalResult.execTime)} | Memory: ${formatMetricValue(finalResult.memory)} | URL: ${submitResult.submissionUrl}`,
		);
		return finalResult.status === "AC" ? 0 : 8;
	}
}
