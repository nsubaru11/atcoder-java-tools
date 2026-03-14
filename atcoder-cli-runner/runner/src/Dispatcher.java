import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.util.*;

/**
 * ローカルランナー用の常駐ディスパッチャです。
 * <p>
 * 標準入力から 1 行 1 コマンドの簡易プロトコルを受け取り、
 * 指定されたクラスディレクトリから {@code Main} クラスを動的ロードして実行します。
 * </p>
 */
public final class Dispatcher {
	private static final Base64.Decoder BASE64_DECODER = Base64.getDecoder();
	private static final Base64.Encoder BASE64_ENCODER = Base64.getEncoder();
	private static final int DEFAULT_CAPTURE_LIMIT_BYTES = 2 << 20;
	private static final String PROTOCOL_ERROR_REQUEST_ID = "protocol";
	private static final long NANOS_PER_MILLI = 1_000_000L;
	/**
	 * 出力バッファの環境変数名
	 */
	private static final String CAPTURE_LIMIT_ENV = "LOCAL_RUNNER_CAPTURE_LIMIT_BYTES";
	/**
	 * 標準出力/標準エラーで保持する最大バイト数
	 */
	private static final int MAX_CAPTURE_BYTES = resolveCaptureLimitBytes();

	private Dispatcher() {
	}

	/**
	 * ディスパッチャのエントリポイント
	 *
	 * @param args コマンドライン引数
	 * @throws IOException プロトコルの入出力に失敗した場合
	 */
	public static void main(final String[] args) throws IOException {
		final BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
		final ProtocolWriter protocolWriter = new ProtocolWriter(new BufferedWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8)));
		protocolWriter.writeReady();
		String line;
		while ((line = reader.readLine()) != null) {
			if (line.isEmpty()) continue;
			handleCommand(line, protocolWriter);
		}
	}

	/**
	 * 受信コマンドを処理します。
	 *
	 * @param line           受信した 1 行のコマンド
	 * @param protocolWriter 応答ライター
	 * @throws IOException 応答の書き込みに失敗した場合
	 */
	private static void handleCommand(final String line, final ProtocolWriter protocolWriter) throws IOException {
		final ParsedCommand parsedCommand = ProtocolParser.parse(line);
		switch (parsedCommand.command()) {
			case PING:
				protocolWriter.writePong();
				return;
			case RUN:
				handleRunCommand(parsedCommand, protocolWriter);
				return;
			default:
				protocolWriter.writeError(PROTOCOL_ERROR_REQUEST_ID, parsedCommand.protocolErrorMessage());
		}
	}

	/**
	 * RUN コマンドを処理します。
	 *
	 * @param parsedCommand  パース済みコマンド
	 * @param protocolWriter 応答ライター
	 * @throws IOException 応答の書き込みに失敗した場合
	 */
	private static void handleRunCommand(final ParsedCommand parsedCommand, final ProtocolWriter protocolWriter) throws IOException {
		if (parsedCommand.runRequest() == null) {
			protocolWriter.writeError(PROTOCOL_ERROR_REQUEST_ID, parsedCommand.protocolErrorMessage());
			return;
		}
		final RunRequest runRequest = parsedCommand.runRequest();
		protocolWriter.writeRunAck();
		try {
			final ExecutionResult result = execute(
					runRequest.classDirectory(),
					runRequest.mainClassName(),
					runRequest.standardInput()
			);
			protocolWriter.writeResult(runRequest.requestId(), result);
		} catch (final Throwable throwable) {
			protocolWriter.writeError(runRequest.requestId(), stackTraceOf(throwable));
		}
	}

	/**
	 * 指定クラスを実行します。
	 *
	 * @param classDirectory クラスファイルを含むディレクトリ
	 * @param mainClassName  実行対象クラス名
	 * @param standardInput  標準入力の内容
	 * @return 実行結果
	 */
	private static ExecutionResult execute(final Path classDirectory, final String mainClassName, final byte[] standardInput) {
		final ExecutionContext executionContext = ExecutionContext.setup(standardInput);
		final long startTime = System.nanoTime();
		int exitCode = 0;
		try (executionContext; URLClassLoader classLoader = new URLClassLoader(
				new URL[]{classDirectory.toUri().toURL()},
				ClassLoader.getSystemClassLoader()
		)) {
			executionContext.setContextClassLoader(classLoader);
			invokeMain(classLoader, mainClassName);
		} catch (final InvocationTargetException exception) {
			exitCode = 1;
			exception.getTargetException().printStackTrace();
		} catch (final Throwable throwable) {
			exitCode = 1;
			throwable.printStackTrace();
		}
		final long timeMillis = (System.nanoTime() - startTime) / NANOS_PER_MILLI;
		return new ExecutionResult(
				exitCode,
				timeMillis,
				executionContext.stdout(),
				executionContext.stderr(),
				executionContext.stdoutTruncated(),
				executionContext.stderrTruncated()
		);
	}

	/**
	 * 出力保持上限を決定します。
	 *
	 * @return 上限バイト数
	 */
	private static int resolveCaptureLimitBytes() {
		final String raw = System.getenv(CAPTURE_LIMIT_ENV);
		if (raw == null || raw.isBlank()) return DEFAULT_CAPTURE_LIMIT_BYTES;
		try {
			final int parsed = Integer.parseInt(raw.trim());
			if (parsed <= 0) return DEFAULT_CAPTURE_LIMIT_BYTES;
			return parsed;
		} catch (final NumberFormatException ignored) {
			return DEFAULT_CAPTURE_LIMIT_BYTES;
		}
	}

	/**
	 * RESULT 応答行を構築します。
	 *
	 * @param requestId 要求ID
	 * @param result    実行結果
	 * @return プロトコル形式の 1 行
	 */
	private static String buildResultLine(final String requestId, final ExecutionResult result) {
		StringJoiner res = new StringJoiner(Protocol.SEPARATOR);
		return res.add(Command.RESULT.toString())
				.add(requestId)
				.add(String.valueOf(result.exitCode()))
				.add(String.valueOf(result.timeMillis()))
				.add(encodeStr(result.stdout()))
				.add(encodeStr(result.stderr()))
				.add(toProtocolFlag(result.stdoutTruncated()))
				.add(toProtocolFlag(result.stderrTruncated()))
				.toString();
	}

	/**
	 * ERROR 応答行を書き込みます。
	 *
	 * @param writer       応答先
	 * @param requestId    要求ID
	 * @param errorMessage エラーメッセージ
	 * @throws IOException 書き込みに失敗した場合
	 */
	private static void writeErrorLine(final BufferedWriter writer, final String requestId, final String errorMessage) throws IOException {
		writeLine(writer, Command.ERROR + Protocol.SEPARATOR + requestId + Protocol.SEPARATOR + encodeStr(errorMessage));
	}

	/**
	 * 真偽値をプロトコル互換のフラグ文字列へ変換します。
	 *
	 * @param value 真偽値
	 * @return true なら "1"、false なら "0"
	 */
	private static String toProtocolFlag(final boolean value) {
		return value ? Protocol.TRUE_FLAG : Protocol.FALSE_FLAG;
	}

	/**
	 * 実行前のグローバルランタイム状態を保存します。
	 *
	 * @return 保存した状態
	 */
	private static RuntimeState snapshotRuntimeState() {
		return new RuntimeState(System.in, System.out, System.err, Thread.currentThread().getContextClassLoader());
	}

	/**
	 * 実行前のグローバルランタイム状態を復元します。
	 * <p>
	 * 常駐プロセスなので、例外時も必ず元の入出力へ戻します。
	 * </p>
	 *
	 * @param runtimeState  復元対象の状態
	 * @param currentThread 現在スレッド
	 */
	private static void restoreRuntimeState(final RuntimeState runtimeState, final Thread currentThread) {
		currentThread.setContextClassLoader(runtimeState.contextClassLoader());
		System.setIn(runtimeState.standardIn());
		System.setOut(runtimeState.standardOut());
		System.setErr(runtimeState.standardErr());
	}

	/**
	 * 指定クラスの {@code main} メソッドを呼び出します。
	 *
	 * @param classLoader   実行対象のクラスローダー
	 * @param mainClassName 実行対象クラス名
	 * @throws ReflectiveOperationException リフレクションに失敗した場合
	 */
	private static void invokeMain(final URLClassLoader classLoader, final String mainClassName) throws ReflectiveOperationException {
		final Class<?> mainClass = Class.forName(mainClassName, true, classLoader);
		final Method mainMethod = mainClass.getMethod("main", String[].class);
		final int modifiers = mainMethod.getModifiers();
		if (!Modifier.isPublic(modifiers) || !Modifier.isStatic(modifiers)) {
			throw new NoSuchMethodException(mainClassName + ".main(String[]) must be public static.");
		}
		mainMethod.invoke(null, (Object) new String[0]);
	}

	/**
	 * 文字列を Base64 エンコードします。
	 *
	 * @param value 対象文字列
	 * @return Base64 文字列
	 */
	private static String encodeStr(final String value) {
		return BASE64_ENCODER.encodeToString(value.getBytes(StandardCharsets.UTF_8));
	}

	/**
	 * Base64 文字列をデコードします。
	 *
	 * @param value Base64 文字列
	 * @return 復元後の文字列
	 */
	private static String decodeStr(final String value) {
		return new String(BASE64_DECODER.decode(value), StandardCharsets.UTF_8);
	}

	/**
	 * 例外のスタックトレースを文字列化します。
	 *
	 * @param throwable 対象例外
	 * @return スタックトレース文字列
	 */
	private static String stackTraceOf(final Throwable throwable) {
		final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
		try (PrintStream printStream = createUtf8PrintStream(buffer)) {
			throwable.printStackTrace(printStream);
		}
		return buffer.toString(StandardCharsets.UTF_8);
	}

	/**
	 * UTF-8 固定の {@link PrintStream} を生成します。
	 *
	 * @param buffer 出力先バッファ
	 * @return 生成した PrintStream
	 */
	private static PrintStream createUtf8PrintStream(final OutputStream buffer) {
		return new PrintStream(buffer, true, StandardCharsets.UTF_8);
	}

	/**
	 * 1 行の応答を書き込みます。
	 *
	 * @param writer 出力先ライター
	 * @param line   出力する 1 行
	 * @throws IOException 書き込みに失敗した場合
	 */
	private static void writeLine(final BufferedWriter writer, final String line) throws IOException {
		writer.write(line);
		writer.newLine();
		writer.flush();
	}

	private enum Command {
		READY("READY"),
		RUN("RUN"),
		PING("PING"),
		PONG("PONG"),
		RESULT("RESULT"),
		ERROR("ERROR");
		private final String command;

		Command(String command) {
			this.command = command;
		}

		public static Command fromString(final String command) {
			for (final Command value : Command.values()) {
				if (value.command.equals(command)) return value;
			}
			return ERROR;
		}

		public String toString() {
			return command;
		}
	}

	/**
	 * プロトコル定数を管理する内部クラスです。
	 */
	private static final class Protocol {
		private static final String SEPARATOR = "\t";
		private static final String TRUE_FLAG = "1";
		private static final String FALSE_FLAG = "0";

		private Protocol() {
		}
	}

	/**
	 * プロトコル文字列を解析する内部ユーティリティです。
	 */
	private static final class ProtocolParser {
		private static final int RUN_PARTS_MIN_SIZE = 5;
		private static final int RUN_REQUEST_ID_INDEX = 1;
		private static final int RUN_CLASS_DIRECTORY_INDEX = 2;
		private static final int RUN_MAIN_CLASS_INDEX = 3;
		private static final int RUN_STANDARD_INPUT_INDEX = 4;
		private static final String MALFORMED_RUN_MESSAGE = "Malformed RUN command.";

		private ProtocolParser() {
		}

		/**
		 * 1 行コマンドを解析します。
		 *
		 * @param line 受信したコマンド行
		 * @return 解析結果
		 */
		private static ParsedCommand parse(final String line) {
			final String[] parts = line.split(Protocol.SEPARATOR, -1);
			final Command command = Command.fromString(parts[0]);
			if (command == Command.RUN) return parseRun(parts);
			if (command == Command.ERROR) return new ParsedCommand(Command.ERROR, null, "Unknown command: " + parts[0]);
			return new ParsedCommand(command, null, null);
		}

		/**
		 * RUN コマンドを解析します。
		 *
		 * @param parts 分割済みトークン
		 * @return 解析結果
		 */
		private static ParsedCommand parseRun(final String[] parts) {
			if (parts.length < RUN_PARTS_MIN_SIZE) {
				return new ParsedCommand(Command.RUN, null, MALFORMED_RUN_MESSAGE);
			}
			try {
				final RunRequest runRequest = new RunRequest(
						parts[RUN_REQUEST_ID_INDEX],
						Paths.get(decodeStr(parts[RUN_CLASS_DIRECTORY_INDEX])),
						decodeStr(parts[RUN_MAIN_CLASS_INDEX]),
						BASE64_DECODER.decode(parts[RUN_STANDARD_INPUT_INDEX])
				);
				return new ParsedCommand(Command.RUN, runRequest, null);
			} catch (final RuntimeException exception) {
				return new ParsedCommand(Command.RUN, null, MALFORMED_RUN_MESSAGE);
			}
		}
	}

	/**
	 * プロトコル応答を出力する内部ユーティリティです。
	 */
	private record ProtocolWriter(BufferedWriter writer) {
		/**
		 * 応答ライターを構築します。
		 *
		 * @param writer 出力先
		 */
		private ProtocolWriter {
		}

		/**
		 * READY を出力します。
		 *
		 * @throws IOException 書き込みに失敗した場合
		 */
		private void writeReady() throws IOException {
			writeLine(writer, Command.READY.toString());
		}

		/**
		 * PONG を出力します。
		 *
		 * @throws IOException 書き込みに失敗した場合
		 */
		private void writePong() throws IOException {
			writeLine(writer, Command.PONG.toString());
		}

		/**
		 * RUN 受理通知を出力します。
		 *
		 * @throws IOException 書き込みに失敗した場合
		 */
		private void writeRunAck() throws IOException {
			writeLine(writer, Command.RUN.toString());
		}

		/**
		 * RESULT を出力します。
		 *
		 * @param requestId 要求ID
		 * @param result    実行結果
		 * @throws IOException 書き込みに失敗した場合
		 */
		private void writeResult(final String requestId, final ExecutionResult result) throws IOException {
			writeLine(writer, buildResultLine(requestId, result));
		}

		/**
		 * ERROR を出力します。
		 *
		 * @param requestId    要求ID
		 * @param errorMessage エラーメッセージ
		 * @throws IOException 書き込みに失敗した場合
		 */
		private void writeError(final String requestId, final String errorMessage) throws IOException {
			writeErrorLine(writer, requestId, errorMessage);
		}
	}

	/**
	 * 1 回の実行で差し替える JVM グローバル状態を管理する実行コンテキストです。
	 */
	private record ExecutionContext(RuntimeState runtimeState, Thread currentThread,
	                                LimitedByteArrayOutputStream stdoutBuffer,
	                                LimitedByteArrayOutputStream stderrBuffer, PrintStream redirectedOut,
	                                PrintStream redirectedErr) implements AutoCloseable {

		/**
		 * 実行前状態の退避と標準入出力の差し替えを行います。
		 *
		 * @param standardInput 標準入力
		 * @return 実行コンテキスト
		 */
		private static ExecutionContext setup(final byte[] standardInput) {
			final RuntimeState runtimeState = snapshotRuntimeState();
			final LimitedByteArrayOutputStream stdoutBuffer = new LimitedByteArrayOutputStream(MAX_CAPTURE_BYTES);
			final LimitedByteArrayOutputStream stderrBuffer = new LimitedByteArrayOutputStream(MAX_CAPTURE_BYTES);
			final PrintStream redirectedOut = createUtf8PrintStream(stdoutBuffer);
			final PrintStream redirectedErr = createUtf8PrintStream(stderrBuffer);
			final Thread currentThread = Thread.currentThread();
			System.setIn(new ByteArrayInputStream(standardInput));
			System.setOut(redirectedOut);
			System.setErr(redirectedErr);
			return new ExecutionContext(runtimeState, currentThread, stdoutBuffer, stderrBuffer, redirectedOut, redirectedErr);
		}

		/**
		 * コンテキストクラスローダーを更新します。
		 *
		 * @param classLoader 実行用クラスローダー
		 */
		private void setContextClassLoader(final ClassLoader classLoader) {
			currentThread.setContextClassLoader(classLoader);
		}

		/**
		 * 標準出力を返します。
		 *
		 * @return 標準出力
		 */
		private String stdout() {
			return stdoutBuffer.toUtf8String();
		}

		/**
		 * 標準エラーを返します。
		 *
		 * @return 標準エラー
		 */
		private String stderr() {
			return stderrBuffer.toUtf8String();
		}

		/**
		 * 標準出力の切り詰め有無を返します。
		 *
		 * @return 切り詰め済みなら true
		 */
		private boolean stdoutTruncated() {
			return stdoutBuffer.isTruncated();
		}

		/**
		 * 標準エラーの切り詰め有無を返します。
		 *
		 * @return 切り詰め済みなら true
		 */
		private boolean stderrTruncated() {
			return stderrBuffer.isTruncated();
		}

		@Override
		public void close() {
			redirectedOut.flush();
			redirectedErr.flush();
			restoreRuntimeState(runtimeState, currentThread);
			redirectedOut.close();
			redirectedErr.close();
		}
	}

	/**
	 * サイズ上限付きのバイト出力バッファです。
	 */
	private static final class LimitedByteArrayOutputStream extends ByteArrayOutputStream {
		/**
		 * 最大保持サイズです。
		 */
		private final int limit;
		/**
		 * 上限超過が発生したかどうかです。
		 */
		private boolean truncated;

		/**
		 * インスタンスを構築します。
		 *
		 * @param limit 最大保持サイズ
		 */
		private LimitedByteArrayOutputStream(final int limit) {
			super(Math.min(8192, Math.max(1, limit)));
			this.limit = Math.max(1, limit);
			this.truncated = false;
		}

		/**
		 * バッファが切り詰められたかを返します。
		 *
		 * @return 切り詰め済みなら true
		 */
		private boolean isTruncated() {
			return truncated;
		}

		/**
		 * バッファ内容を UTF-8 文字列で返します。
		 *
		 * @return UTF-8 文字列
		 */
		private String toUtf8String() {
			return new String(toByteArray(), StandardCharsets.UTF_8);
		}

		@Override
		public synchronized void write(final int value) {
			if (count >= limit) {
				truncated = true;
				return;
			}
			super.write(value);
		}

		@Override
		public synchronized void write(final byte[] bytes, final int offset, final int length) {
			if (length <= 0) return;
			if (count >= limit) {
				truncated = true;
				return;
			}
			final int writable = Math.min(length, limit - count);
			super.write(bytes, offset, writable);
			if (writable < length) truncated = true;
		}
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
	 */
	private record ExecutionResult(int exitCode, long timeMillis, String stdout, String stderr, boolean stdoutTruncated,
	                               boolean stderrTruncated) {
		/**
		 * 実行結果を構築します。
		 *
		 * @param exitCode        終了コード相当
		 * @param timeMillis      実行時間
		 * @param stdout          標準出力
		 * @param stderr          標準エラー出力
		 * @param stdoutTruncated 標準出力が切り詰められたかどうか
		 * @param stderrTruncated 標準エラー出力が切り詰められたかどうか
		 */
		private ExecutionResult {
		}
	}

	/**
	 * パース済みコマンドを保持する値オブジェクトです。
	 *
	 * @param command              コマンド種別
	 * @param runRequest           RUN 用リクエスト（RUN 以外は null）
	 * @param protocolErrorMessage プロトコルエラーメッセージ
	 */
	private record ParsedCommand(Command command, RunRequest runRequest, String protocolErrorMessage) {
		/**
		 * パース結果を構築します。
		 *
		 * @param command              コマンド種別
		 * @param runRequest           RUN 用リクエスト
		 * @param protocolErrorMessage プロトコルエラーメッセージ
		 */
		private ParsedCommand {
		}
	}

	/**
	 * RUN コマンドの実行リクエストです。
	 *
	 * @param requestId      要求ID
	 * @param classDirectory クラスディレクトリ
	 * @param mainClassName  実行クラス名
	 * @param standardInput  標準入力
	 */
	private record RunRequest(String requestId, Path classDirectory, String mainClassName, byte[] standardInput) {
		/**
		 * 実行リクエストを構築します。
		 *
		 * @param requestId      要求ID
		 * @param classDirectory クラスディレクトリ
		 * @param mainClassName  実行クラス名
		 * @param standardInput  標準入力
		 */
		private RunRequest {
		}
	}

	/**
	 * 実行前に退避した JVM グローバル状態です。
	 *
	 * @param standardIn         標準入力
	 * @param standardOut        標準出力
	 * @param standardErr        標準エラー
	 * @param contextClassLoader コンテキストクラスローダー
	 */
	private record RuntimeState(InputStream standardIn, PrintStream standardOut, PrintStream standardErr,
	                            ClassLoader contextClassLoader) {
		/**
		 * 状態を構築します。
		 *
		 * @param standardIn         標準入力
		 * @param standardOut        標準出力
		 * @param standardErr        標準エラー
		 * @param contextClassLoader コンテキストクラスローダー
		 */
		private RuntimeState {
		}
	}
}
