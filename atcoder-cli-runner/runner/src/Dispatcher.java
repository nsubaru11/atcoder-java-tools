import java.io.*;
import java.lang.Thread.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.*;

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
	private static final Charset UTF_8 = StandardCharsets.UTF_8;
	private static final String SEPARATOR = "\t";
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
		final BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, UTF_8));
		final ProtocolWriter protocolWriter = new ProtocolWriter(new BufferedWriter(new OutputStreamWriter(System.out, UTF_8)));
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
			case PING -> protocolWriter.writePong();
			case RUN -> handleRunCommand(parsedCommand, protocolWriter);
			default -> protocolWriter.writeError(PROTOCOL_ERROR_REQUEST_ID, parsedCommand.protocolErrorMessage());
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
			protocolWriter.writeError(runRequest.requestId(), throwable.toString());
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
		final AtomicReference<Throwable> uncaughtError = new AtomicReference<>();
		final ExecutionContext executionContext = ExecutionContext.setup(standardInput, uncaughtError);
		final long startTime = System.nanoTime();
		int exitCode = 0;
		try (executionContext; URLClassLoader classLoader = new URLClassLoader(
				new URL[]{classDirectory.toUri().toURL()},
				ClassLoader.getSystemClassLoader()
		)) {
			executionContext.setContextClassLoader(classLoader);
			invokeMain(classLoader, mainClassName);
		} catch (final Throwable throwable) {
			uncaughtError.compareAndSet(null, throwable);
		}
		final long timeMillis = (System.nanoTime() - startTime) / NANOS_PER_MILLI;

		Throwable error = uncaughtError.get();
		if (error != null) {
			exitCode = 1;
			executionContext.redirectedErr().print(filterMainStackTrace(error, mainClassName));
			executionContext.redirectedErr().flush();
		}

		return new ExecutionResult(
				exitCode,
				timeMillis,
				executionContext.stdoutBytes(),
				executionContext.stderrBytes(),
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
		StringJoiner res = new StringJoiner(SEPARATOR);
		return res.add(Command.RESULT.name())
				.add(requestId)
				.add(String.valueOf(result.exitCode()))
				.add(String.valueOf(result.timeMillis()))
				.add(BASE64_ENCODER.encodeToString(result.stdout()))
				.add(BASE64_ENCODER.encodeToString(result.stderr()))
				.add(result.stdoutTruncated() ? "1" : "0")
				.add(result.stderrTruncated() ? "1" : "0")
				.toString();
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
		Thread.setDefaultUncaughtExceptionHandler(runtimeState.defaultUncaughtExceptionHandler());
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

	/**
	 * 例外から実行対象クラスおよびその内部クラスに関連するスタックトレースのみを抽出します。
	 *
	 * @param throwable     例外
	 * @param mainClassName 実行対象クラス名
	 * @return 抽出済みスタックトレース
	 */
	private static String filterMainStackTrace(final Throwable throwable, final String mainClassName) {
		Throwable cause = throwable instanceof InvocationTargetException targetException ? targetException.getTargetException() : throwable;

		StringBuilder sb = new StringBuilder();
		sb.append(cause.toString()).append("\n");
		for (StackTraceElement element : cause.getStackTrace()) {
			String className = element.getClassName();
			if (className.equals(mainClassName) || className.startsWith(mainClassName + "$"))
				sb.append("\tat ").append(element).append("\n");
		}
		return sb.toString();
	}

	private enum Command {
		READY, RUN, PING, PONG, RESULT, ERROR;

		public static Command fromString(final String command) {
			try {
				return Command.valueOf(command);
			} catch (IllegalArgumentException e) {
				return ERROR;
			}
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
			final String[] parts = line.split(SEPARATOR, -1);
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
						Paths.get(new String(BASE64_DECODER.decode(parts[RUN_CLASS_DIRECTORY_INDEX]), UTF_8)),
						new String(BASE64_DECODER.decode(parts[RUN_MAIN_CLASS_INDEX]), UTF_8),
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
	 * @param writer 出力先
	 */
	private record ProtocolWriter(BufferedWriter writer) {
		/**
		 * READY を出力します。
		 *
		 * @throws IOException 書き込みに失敗した場合
		 */
		private void writeReady() throws IOException {
			writeLine(writer, Command.READY.name());
		}

		/**
		 * PONG を出力します。
		 *
		 * @throws IOException 書き込みに失敗した場合
		 */
		private void writePong() throws IOException {
			writeLine(writer, Command.PONG.name());
		}

		/**
		 * RUN 受理通知を出力します。
		 *
		 * @throws IOException 書き込みに失敗した場合
		 */
		private void writeRunAck() throws IOException {
			writeLine(writer, Command.RUN.name());
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
			writeLine(writer, Command.ERROR.name() + SEPARATOR + requestId + SEPARATOR + BASE64_ENCODER.encodeToString(errorMessage.getBytes(UTF_8)));
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
		private static ExecutionContext setup(final byte[] standardInput, final AtomicReference<Throwable> uncaughtError) {
			final RuntimeState runtimeState = new RuntimeState(System.in, System.out, System.err, Thread.currentThread().getContextClassLoader(), Thread.getDefaultUncaughtExceptionHandler());
			final LimitedByteArrayOutputStream stdoutBuffer = new LimitedByteArrayOutputStream(MAX_CAPTURE_BYTES);
			final LimitedByteArrayOutputStream stderrBuffer = new LimitedByteArrayOutputStream(MAX_CAPTURE_BYTES);
			final PrintStream redirectedOut = new PrintStream(stdoutBuffer, true, UTF_8);
			final PrintStream redirectedErr = new PrintStream(stderrBuffer, true, UTF_8);
			final Thread currentThread = Thread.currentThread();
			Thread.setDefaultUncaughtExceptionHandler((_, e) -> uncaughtError.compareAndSet(null, e));
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
		private byte[] stdoutBytes() {
			return stdoutBuffer.toByteArray();
		}

		/**
		 * 標準エラーを返します。
		 *
		 * @return 標準エラー
		 */
		private byte[] stderrBytes() {
			return stderrBuffer.toByteArray();
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
	private record ExecutionResult(int exitCode, long timeMillis, byte[] stdout, byte[] stderr, boolean stdoutTruncated,
	                               boolean stderrTruncated) {
	}

	/**
	 * パース済みコマンドを保持する値オブジェクトです。
	 *
	 * @param command              コマンド種別
	 * @param runRequest           RUN 用リクエスト（RUN 以外は null）
	 * @param protocolErrorMessage プロトコルエラーメッセージ
	 */
	private record ParsedCommand(Command command, RunRequest runRequest, String protocolErrorMessage) {
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
	                            ClassLoader contextClassLoader, UncaughtExceptionHandler defaultUncaughtExceptionHandler) {
	}
}
