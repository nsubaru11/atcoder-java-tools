import com.sun.management.ThreadMXBean;

import java.io.*;
import java.lang.management.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.util.concurrent.atomic.*;

/**
 * コンパイル済みクラスを実行する専任クラスです。
 * <p>
 * 使い捨ての {@link URLClassLoader} でクラスを隔離ロードし、リフレクションで {@code main} を呼び、
 * 出力捕捉（{@link BoundedCapture}）と JVM グローバル状態の差し替え（{@link StandardStreamsGuard}）を
 * 用いて実行時間・標準出力・標準エラーを収集します。
 * </p>
 */
final class ProgramRunner {
	private static final long NANOS_PER_MILLI = 1_000_000L;
	private static final int DEFAULT_CAPTURE_LIMIT_BYTES = 2 << 20;
	/**
	 * 出力バッファの環境変数名
	 */
	private static final String CAPTURE_LIMIT_ENV = "LOCAL_RUNNER_CAPTURE_LIMIT_BYTES";
	/**
	 * 標準出力/標準エラーで保持する最大バイト数
	 */
	private static final int MAX_CAPTURE_BYTES = resolveCaptureLimitBytes();

	/**
	 * 実行スレッドの累積アロケーション量を測る MXBean（HotSpot 拡張）。計測不可なら null（改善2）。
	 */
	private static final ThreadMXBean THREAD_MX = resolveThreadMx();

	private static ThreadMXBean resolveThreadMx() {
		final java.lang.management.ThreadMXBean bean = ManagementFactory.getThreadMXBean();
		if (bean instanceof ThreadMXBean sun && sun.isThreadAllocatedMemorySupported()) {
			sun.setThreadAllocatedMemoryEnabled(true);
			return sun;
		}
		return null;
	}

	private static long currentThreadAllocatedBytes() {
		return THREAD_MX != null ? THREAD_MX.getCurrentThreadAllocatedBytes() : -1L;
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

	/**
	 * 指定クラスを実行します。
	 *
	 * @param classDirectory クラスファイルを含むディレクトリ
	 * @param mainClassName  実行対象クラス名
	 * @param standardInput  標準入力の内容
	 * @return 実行結果
	 */
	ExecutionResult run(final Path classDirectory, final String mainClassName, final byte[] standardInput) {
		final AtomicReference<Throwable> uncaughtError = new AtomicReference<>();
		final BoundedCapture stdoutBuffer = new BoundedCapture(MAX_CAPTURE_BYTES);
		final BoundedCapture stderrBuffer = new BoundedCapture(MAX_CAPTURE_BYTES);
		final PrintStream redirectedOut = new PrintStream(stdoutBuffer, true, StandardCharsets.UTF_8);
		final PrintStream redirectedErr = new PrintStream(stderrBuffer, true, StandardCharsets.UTF_8);

		final long startTime = System.nanoTime();
		final long allocBefore = currentThreadAllocatedBytes();
		int exitCode = 0;
		try (StandardStreamsGuard guard = new StandardStreamsGuard(standardInput, redirectedOut, redirectedErr, uncaughtError);
		     URLClassLoader classLoader = new URLClassLoader(
				     new URL[]{classDirectory.toUri().toURL()},
				     ClassLoader.getSystemClassLoader()
		     )) {
			guard.setContextClassLoader(classLoader);
			invokeMain(classLoader, mainClassName);
		} catch (final Throwable throwable) {
			uncaughtError.compareAndSet(null, throwable);
		}
		final long timeMillis = (System.nanoTime() - startTime) / NANOS_PER_MILLI;
		final long allocAfter = currentThreadAllocatedBytes();
		final long memoryBytes = (allocBefore >= 0 && allocAfter >= 0) ? Math.max(0L, allocAfter - allocBefore) : -1L;

		final Throwable error = uncaughtError.get();
		if (error != null) {
			exitCode = 1;
			redirectedErr.print(filterMainStackTrace(error, mainClassName));
		}
		redirectedOut.flush();
		redirectedErr.flush();

		return new ExecutionResult(
				exitCode,
				timeMillis,
				stdoutBuffer.toByteArray(),
				stderrBuffer.toByteArray(),
				stdoutBuffer.isTruncated(),
				stderrBuffer.isTruncated(),
				memoryBytes
		);
	}
}
