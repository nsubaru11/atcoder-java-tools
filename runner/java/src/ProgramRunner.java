import com.sun.management.ThreadMXBean;

import java.io.*;
import java.lang.management.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.util.*;
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
	 * 提出コードを実行する専用スレッドのスタックサイズ（バイト）。既定 256 MiB。
	 * 競プロで多い深い再帰が、ユーザーが大スタックスレッドのイディオムを書かなくても通るようにする。
	 * {@code LOCAL_RUNNER_RUN_STACK_BYTES} で上書き可能。
	 */
	private static final long RUN_THREAD_STACK_BYTES = resolveRunThreadStackBytes();

	private static long resolveRunThreadStackBytes() {
		final long defaultBytes = 256L * 1024 * 1024;
		final String raw = System.getenv("LOCAL_RUNNER_RUN_STACK_BYTES");
		if (raw == null || raw.isBlank()) return defaultBytes;
		try {
			final long parsed = Long.parseLong(raw.trim());
			return parsed > 0 ? parsed : defaultBytes;
		} catch (final NumberFormatException ignored) {
			return defaultBytes;
		}
	}

	/**
	 * 直近の実行で「join されずに残った非デーモンスレッド」が常駐 JVM に生き残ったか。
	 * {@link Dispatcher} がこれを見て JVM の再生成（halt→再起動）を判断する。
	 */
	private static volatile boolean lastRunLeftoverThreads = false;

	/** 直近実行の残存スレッド有無を読み取り、フラグをクリアする（Dispatcher から実行後に一度だけ呼ぶ）。 */
	static boolean consumeLeftoverThreadFlag() {
		final boolean value = lastRunLeftoverThreads;
		lastRunLeftoverThreads = false;
		return value;
	}

	/** 実行前スナップショットに無い、生存中の非デーモンスレッドがあれば true（＝残存スレッド）。 */
	private static boolean hasLeftoverNonDaemonThreads(final Set<Thread> baseline) {
		for (final Thread thread : Thread.getAllStackTraces().keySet()) {
			if (thread.isAlive() && !thread.isDaemon() && !baseline.contains(thread)) {
				return true;
			}
		}
		return false;
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

		// 実行前に生存していたスレッド集合。実行後にここに無い非デーモンスレッドが残っていれば
		// 「join されなかった残存スレッド」とみなし、汚染防止に JVM を再生成する（Dispatcher が halt）。
		final Set<Thread> baselineThreads = Thread.getAllStackTraces().keySet();
		// アロケーション量は実行スレッド自身の上で測る（従来は main スレッドで測っていたため
		// プロトコル処理分が混ざっていた）。[0]=開始前 / [1]=終了後、計測不可なら -1。
		final long[] allocSnapshot = {-1L, -1L};

		final long startTime = System.nanoTime();
		try (StandardStreamsGuard guard = new StandardStreamsGuard(standardInput, redirectedOut, redirectedErr, uncaughtError);
		     URLClassLoader classLoader = new URLClassLoader(
				     new URL[]{classDirectory.toUri().toURL()},
				     ClassLoader.getSystemClassLoader()
		     )) {
			guard.setContextClassLoader(classLoader);
			final Runnable body = () -> {
				allocSnapshot[0] = currentThreadAllocatedBytes();
				try {
					invokeMain(classLoader, mainClassName);
				} catch (final Throwable throwable) {
					uncaughtError.compareAndSet(null, throwable);
				} finally {
					allocSnapshot[1] = currentThreadAllocatedBytes();
				}
			};
			// 大きめのスタックを持つ専用スレッドで実行する。これにより
			// (1) 競プロで多い深い再帰が StackOverflow になりにくく（大スタックスレッドのイディオム不要）、
			// (2) StackOverflow がディスパッチャ本体スレッドではなく実行スレッド側に閉じる。
			final Thread runThread = new Thread(null, body, "atcoder-run", RUN_THREAD_STACK_BYTES);
			runThread.setDaemon(true);
			runThread.setContextClassLoader(classLoader);
			runThread.start();
			runThread.join();
		} catch (final Throwable throwable) {
			uncaughtError.compareAndSet(null, throwable);
		}
		final long timeMillis = (System.nanoTime() - startTime) / NANOS_PER_MILLI;
		final long allocBefore = allocSnapshot[0];
		final long allocAfter = allocSnapshot[1];
		final long memoryBytes = (allocBefore >= 0 && allocAfter >= 0) ? Math.max(0L, allocAfter - allocBefore) : -1L;

		lastRunLeftoverThreads = hasLeftoverNonDaemonThreads(baselineThreads);

		int exitCode = 0;
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
