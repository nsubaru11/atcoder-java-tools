import type {Command} from "./Command";
import {TestCommand} from "./TestCommand";
import {SubmitCommand} from "./SubmitCommand";
import {TomainCommand} from "./TomainCommand";
import {LocalTestCommand} from "./LocalTestCommand";
import {RunCommand} from "./RunCommand";
import {ServeCommand} from "./ServeCommand";
import {StopCommand} from "./StopCommand";
import {CacheClearCommand} from "./CacheClearCommand";

/**
 * 登録済みコマンド一覧。
 * 新しいコマンドを追加するときは、Command を実装したクラスを作ってこの配列に1行足すだけでよい。
 * 表示順は usage の出力順を兼ねる。
 */
const COMMAND_LIST: readonly Command[] = [
	new TestCommand(),
	new SubmitCommand(),
	new TomainCommand(),
	new LocalTestCommand(),
	new RunCommand(),
	new ServeCommand(),
	new StopCommand(),
	new CacheClearCommand(),
];

/** 名前 → コマンドの索引。 */
const REGISTRY: ReadonlyMap<string, Command> = new Map(COMMAND_LIST.map((c) => [c.name, c]));

/** コマンド名から該当コマンドを引く（無ければ undefined）。 */
export function getCommand(name: string): Command | undefined {
	return REGISTRY.get(name);
}

/** 全コマンドの usage 行と共通オプションを stderr に出力する。 */
export function printUsage(): void {
	console.error("Usage:");
	for (const command of COMMAND_LIST) {
		for (const line of command.usageLines) console.error(line);
	}
	console.error("Options:");
	console.error("  -f, --force                submit: 非 AC でも提出 / tomain: 既存 outFile を上書き");
	console.error("  -d, --debug[=true|false]   test/localtest/run: DEBUG ブロックの有効/無効を上書き（既定: 有効）");
	console.error("  --full                     test/localtest: WA 差分を折りたたまず全行表示");
	console.error("  --wa-only                  test/localtest: WA 差分のうち不一致行だけ抽出（行番号は保持）");
}
