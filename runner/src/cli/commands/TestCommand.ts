import {TaskCommand, type TaskRunContext} from "./TaskCommand";

/** サンプルをローカル実行して AC 判定だけ行う（提出はしない）。DEBUG は既定で有効。 */
export class TestCommand extends TaskCommand {
	readonly name = "test";
	readonly usageLines = [
		"  test [-d|--debug[=true|false]] [--full] [--wa-only] [--max-lines=N] <taskScreenName> <sourceFile>",
		"  test [...options] <task>                (短縮: フォルダからコンテスト推定。例: test d → abc463_d D.java)",
	];
	protected readonly allowForce = false;
	protected readonly debug = true;
	protected readonly supportsDebugOption = true;
	protected readonly supportsDisplayOptions = true;

	protected onSamplesComplete({allAccepted}: TaskRunContext): number {
		return allAccepted ? 0 : 5;
	}
}
