import type {Command} from "./Command";
import {TestCommand} from "./TestCommand";
import {SubmitCommand} from "./SubmitCommand";
import {TomainCommand} from "./TomainCommand";
import {ToclipCommand} from "./ToclipCommand";
import {LocalTestCommand} from "./LocalTestCommand";
import {RunCommand} from "./RunCommand";
import {ServeCommand} from "./ServeCommand";
import {StopCommand} from "./StopCommand";
import {StatusCommand} from "./StatusCommand";
import {CacheClearCommand} from "./CacheClearCommand";
import {CrossCheck} from "./CrossCheck";

/**
 * 登録済みコマンド一覧。
 * 新しいコマンドを追加するときは、Command を実装したクラスを作ってこの配列に1行足すだけでよい。
 * 表示順は usage の出力順を兼ねる。
 */
const COMMAND_LIST: readonly Command[] = [
	new TestCommand(),
	new SubmitCommand(),
	new TomainCommand(),
	new ToclipCommand(),
	new LocalTestCommand(),
	new RunCommand(),
	new ServeCommand(),
	new StopCommand(),
	new StatusCommand(),
	new CacheClearCommand(),
	new CrossCheck(),
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
	console.error("  --full                     test/localtest/submit/crosscheck: WA 差分を折りたたまず全行表示");
	console.error("  --wa-only                  test/localtest/submit/crosscheck: WA 差分のうち不一致行だけ抽出（行番号は保持）");
	console.error("  --max-lines=N              test/localtest/submit/crosscheck: WA 差分の折りたたみ行数を変更（既定: 20）");
	console.error("  --time-limit=N             localtest/run/crosscheck: 実行時間警告のしきい値に使う制限(ms)。80%超=黄/制限以上=赤（既定: 2000。表示のみで実行は打ち切らない）");
}
