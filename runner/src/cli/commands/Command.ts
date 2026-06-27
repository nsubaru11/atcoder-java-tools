/**
 * CLI コマンドの共通インターフェース。
 *
 * 各コマンドは {@link Command} を実装したクラスとして commands/ 配下に1ファイルずつ置く。
 * index.ts はレジストリ（registry.ts）から名前で引いて execute() を呼ぶだけにする。
 * 引数解析・バリデーション・実行はすべて各コマンドクラスの内部に閉じ込める。
 * （オプションはコマンドごとに異なるので共通の解析処理は設けず、各 execute() 内で自前で扱う）
 */

/**
 * 引数が不正なときに投げる例外。
 * index.ts がこれを捕捉し、（メッセージがあれば表示した上で）usage を出して終了コード 1 を返す。
 * メッセージ無し＝「引数不足なので usage だけ出す」ケースに使う。
 */
export class CliUsageError extends Error {
	constructor(message = "") {
		super(message);
		this.name = "CliUsageError";
	}
}

/** すべての CLI サブコマンドが実装する共通インターフェース。 */
export interface Command {
	/** サブコマンド名（rawArgs[0] と一致する文字列）。 */
	readonly name: string;
	/** printUsage で表示する usage 行（"  test <taskScreenName> <sourceFile>" 等）。 */
	readonly usageLines: readonly string[];

	/**
	 * コマンド本体。args はコマンド名を除いた残りの引数。
	 * バリデーション失敗時は {@link CliUsageError} を投げる。戻り値はプロセス終了コード。
	 */
	execute(args: readonly string[]): Promise<number> | number;
}
