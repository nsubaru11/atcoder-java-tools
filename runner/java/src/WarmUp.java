import java.io.*;
import java.nio.charset.*;

import lib.io.FastPrinter;
import lib.io.FastScanner;

/**
 * LocalRunner起動時に、標準入出力ライブラリの変換・コンパイル経路を温めます。
 */
public final class WarmUp {
	private static final int REPEAT = 20_000;

	private WarmUp() {
	}

	public static void main(final String[] args) {
		final byte[] input = "123 -4567890123 ".repeat(REPEAT).getBytes(StandardCharsets.US_ASCII);
		final FastScanner scanner = new FastScanner(new ByteArrayInputStream(input));
		try (FastPrinter printer = new FastPrinter(OutputStream.nullOutputStream(), 1 << 12)) {
			long checksum = 0;
			for (int i = 0; i < REPEAT; i++) {
				checksum += scanner.nextInt();
				checksum ^= scanner.nextLong();
				printer.println(checksum);
			}
		}
	}
}
