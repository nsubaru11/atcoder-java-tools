import java.io.*;

/**
 * ローカルランナー用の常駐ディスパッチャです。
 * <p>
 * 標準入力から 1 行 1 コマンドの簡易プロトコル（PROTOCOL.md 参照）を受け取り、配線のみを行います。
 * 通信は型付きの {@link MessageChannel}、実行は {@link Executor} に委譲し、符号化・復号は一切扱いません。
 * </p>
 */
public final class Dispatcher {
	private Dispatcher() {
	}

	/**
	 * ディスパッチャのエントリポイントです。
	 *
	 * @param args コマンドライン引数（未使用）
	 * @throws IOException プロトコルの入出力に失敗した場合
	 */
	public static void main(final String[] args) throws IOException {
		final Executor executor = new Executor();
		try (MessageChannel channel = new MessageChannel(System.in, System.out)) {
			channel.send(new Ready());
			ParseOutcome incoming;
			while ((incoming = channel.receive()) != null) {
				dispatch(incoming, executor, channel);
			}
		}
	}

	/**
	 * 解析済みの受信メッセージに応じて応答を書き戻します。
	 *
	 * @param incoming 解析結果（正しい要求かプロトコル違反）
	 * @param executor 実行本体
	 * @param channel  型付きチャネル
	 * @throws IOException 応答の書き込みに失敗した場合
	 */
	private static void dispatch(final ParseOutcome incoming, final Executor executor, final MessageChannel channel) throws IOException {
		switch (incoming) {
			case ProtocolError(var requestId, var reason) -> channel.send(new ErrorResponse(requestId, reason));
			case ValidRequest(var request) -> {
				if (request instanceof Run) {
					channel.send(new RunAck());
				}
				channel.send(executor.handle(request));
			}
		}
	}
}
