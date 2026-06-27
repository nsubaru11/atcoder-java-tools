import {ensureLocalRunnerReady} from "../ensureServer";
import type {Command} from "./Command";

/** Local Runner サーバーだけを先に起動して ready まで待つ（先回り起動）。 */
export class ServeCommand implements Command {
	readonly name = "serve";
	readonly usageLines = [
		"  serve                                   (Local Runner サーバーだけ先に起動)",
	];

	async execute(): Promise<number> {
		await ensureLocalRunnerReady();
		console.log("Local Runner is up. これ以降の test / submit / localtest は即実行されます。");
		return 0;
	}
}
