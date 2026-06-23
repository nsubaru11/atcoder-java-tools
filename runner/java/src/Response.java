/**
 * daemon へ送信する応答メッセージです。
 * <p>
 * 実装はこのファイル内に限定（sealed）。各メッセージのワイヤ形式は {@code PROTOCOL.md} を参照してください。
 * </p>
 *
 * @see PROTOCOL.md 「3. メッセージ一覧」
 */
sealed interface Response {
}

/**
 * 起動完了通知です（PROTOCOL.md 3.1）。
 */
record Ready() implements Response {
}

/**
 * PING への応答です（PROTOCOL.md 3.2）。
 */
record Pong() implements Response {
}

/**
 * RUN の受理通知です。ワイヤ上は {@code "RUN"} の 1 行（PROTOCOL.md 3.3）。
 */
record RunAck() implements Response {
}

/**
 * 実行結果です（PROTOCOL.md 3.3 RESULT）。
 *
 * @param requestId 要求ID
 * @param result    実行結果の値オブジェクト
 */
record Result(String requestId, ExecutionResult result) implements Response {
}

/**
 * コンパイル結果です（PROTOCOL.md 3.4 COMPILED）。
 *
 * @param requestId 要求ID
 * @param result    コンパイル結果の値オブジェクト
 */
record Compiled(String requestId, CompileResult result) implements Response {
}

/**
 * エラー応答です（PROTOCOL.md 3.5 ERROR）。
 *
 * @param requestId 要求ID（プロトコル違反時は {@code "protocol"}）
 * @param message   エラーメッセージ
 */
record ErrorResponse(String requestId, String message) implements Response {
}

/**
 * 実行結果を保持する値オブジェクトです。
 *
 * @param exitCode        プロセス終了コード相当です。
 * @param timeMillis      実行時間です。
 * @param stdout          標準出力です。
 * @param stderr          標準エラー出力です。
 * @param stdoutTruncated 標準出力が切り詰められたかどうかです。
 * @param stderrTruncated 標準エラー出力が切り詰められたかどうかです。
 * @param memoryBytes     実行スレッドの累積アロケーション量（バイト）。近似値。計測不可なら {@code -1}。
 */
record ExecutionResult(int exitCode, long timeMillis, byte[] stdout, byte[] stderr, boolean stdoutTruncated,
                       boolean stderrTruncated, long memoryBytes) {
}

/**
 * コンパイル結果を保持する値オブジェクトです。
 *
 * @param exitCode          0 で成功、それ以外は失敗
 * @param diagnostics       診断メッセージ
 * @param requiresIsolation 常駐 JVM 内で実行すると危険な API を参照しており、隔離実行が必要なら true
 */
record CompileResult(int exitCode, String diagnostics, boolean requiresIsolation) {
}
