import java.io.*;

/**
 * サイズ上限付きのバイト出力バッファです。
 * <p>
 * 上限を超えた書き込みは破棄し、{@link #isTruncated()} を {@code true} にします。
 * 無限ループ等による大量出力でメモリを食い潰さないための防御です。
 * </p>
 */
final class BoundedCapture extends ByteArrayOutputStream {
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
	BoundedCapture(final int limit) {
		super(Math.clamp(limit, 1, 8192));
		this.limit = Math.max(1, limit);
		this.truncated = false;
	}

	/**
	 * バッファが切り詰められたかを返します。
	 *
	 * @return 切り詰め済みなら true
	 */
	boolean isTruncated() {
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
