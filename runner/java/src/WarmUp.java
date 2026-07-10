import lib.io.FastPrinter;
import lib.io.FastScanner;

/**
 * LocalRunner起動時に、標準入出力ライブラリの変換・コンパイル経路を温めます。
 */
public final class WarmUp {
	private WarmUp() {
	}

	public static void main(final String[] args) {
		final Class<?>[] commonTypes = {FastScanner.class, FastPrinter.class};
		if (commonTypes.length != 2) throw new AssertionError();
	}
}
