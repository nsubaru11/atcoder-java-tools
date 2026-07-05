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
		"  submit [-f|--force] [--full] [--wa-only] [--max-lines=N] <taskScreenName> <sourceFile>",
		"  submit [...options] <task>              (短縮: 同上。例: submit d)",
	];
	protected readonly allowForce = true;
	protected readonly debug = false;
	// 提出前のサンプル表示は test と同じ表示オプションを使える（DEBUG は本番固定なので -d は不可）。
	protected readonly supportsDisplayOptions = true;

	protected async onSamplesComplete({task, transformed, allAccepted, force}: TaskRunContext): Promise<number> {
		if (!allAccepted) {
			if (!force) {
				console.log("Not submitting because at least one sample test is not AC.");
				return 5;
			}
			console.log("Warning: forcing submit despite non-AC sample results (-f/--force).");
		}

		const cookieHeader = toCookieHeader();
		const submitResult = await submitToAtCoder(task, transformed, cookieHeader);

		let submissionId = submitResult.submissionId;
		let submissionUrl = submitResult.submissionUrl;
		if (submitResult.trackingUnavailable) {
			const latestId = await fetchLatestSubmissionId(task, cookieHeader);
			if (!latestId) {
				throw new Error("Submission tracking failed: could not resolve latest submission ID.");
			}
			submissionId = latestId;
			submissionUrl = buildAtCoderSubmissionUrl(task.contestId, latestId);
		}

		// ここまで来れば提出自体は成功している。以降の結果ポーリングが失敗しても
		// 「提出は成功」を明示し、提出 ID/URL を必ず表示して専用終了コードで返す。
		try {
			const finalResult = await pollSubmissionFinal(task.contestId, submissionId, cookieHeader);
			console.log(
				`Result: ${colorizeStatus(finalResult.status)} | ID: ${submissionId} | Exec: ${formatMetricValue(finalResult.execTime)} | Memory: ${formatMetricValue(finalResult.memory)} | URL: ${submissionUrl}`,
			);
			return finalResult.status === "AC" ? 0 : 8;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.log(`Submitted successfully (ID: ${submissionId} | URL: ${submissionUrl}), but result tracking failed: ${message}`);
			return 9;
		}
	}
}
