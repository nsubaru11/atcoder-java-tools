import java.io.*;
import java.util.concurrent.atomic.*;

/**
 * 1 回の実行で差し替える JVM グローバル状態の退避・差し替え・確実な復元を 1 か所に隔離する RAII です。
 * <p>
 * 常駐 JVM で最も壊れやすい部分（{@code System.in/out/err}・デフォルト uncaught ハンドラ・
 * コンテキストクラスローダの差し替え）をこのクラスだけに閉じ込め、try-with-resources で
 * 例外時も必ず元に戻します。
 * </p>
 */
final class StandardStreamsGuard implements AutoCloseable {
	private final InputStream originalIn = System.in;
	private final PrintStream originalOut = System.out;
	private final PrintStream originalErr = System.err;
	private final Thread.UncaughtExceptionHandler originalHandler = Thread.getDefaultUncaughtExceptionHandler();
	private final Thread currentThread = Thread.currentThread();
	private final ClassLoader originalContextClassLoader = currentThread.getContextClassLoader();

	/**
	 * グローバル状態を退避し、標準入出力と uncaught ハンドラを差し替えます。
	 *
	 * @param standardInput 差し替える標準入力の内容
	 * @param out           差し替える標準出力（捕捉用）
	 * @param err           差し替える標準エラー（捕捉用）
	 * @param uncaughtSink  実行対象スレッドが投げた未捕捉例外の格納先
	 */
	StandardStreamsGuard(final byte[] standardInput, final PrintStream out, final PrintStream err,
	                     final AtomicReference<Throwable> uncaughtSink) {
		Thread.setDefaultUncaughtExceptionHandler((ignoredThread, throwable) -> uncaughtSink.compareAndSet(null, throwable));
		System.setIn(new ByteArrayInputStream(standardInput));
		System.setOut(out);
		System.setErr(err);
	}

	/**
	 * コンテキストクラスローダーを実行用に差し替えます（復元時に元へ戻します）。
	 *
	 * @param classLoader 実行用クラスローダー
	 */
	void setContextClassLoader(final ClassLoader classLoader) {
		currentThread.setContextClassLoader(classLoader);
	}

	@Override
	public void close() {
		System.setIn(originalIn);
		System.setOut(originalOut);
		System.setErr(originalErr);
		Thread.setDefaultUncaughtExceptionHandler(originalHandler);
		currentThread.setContextClassLoader(originalContextClassLoader);
	}
}
