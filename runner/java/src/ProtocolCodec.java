import java.nio.charset.*;
import java.nio.file.*;
import java.util.*;

/**
 * {@link ProtocolCodec#parse(String)} の結果です。正しい要求か、プロトコル違反かのいずれか。
 */
sealed interface ParseOutcome permits ValidRequest, ProtocolError {
}

/**
 * ワイヤ形式（PROTOCOL.md 2, 4）と型の相互変換を担います。
 * <p>
 * 文字列・Base64・タブ・コマンド名を扱う唯一の場所で、実行ロジック（{@link Executor}）とは独立しています。
 * </p>
 */
final class ProtocolCodec {
	/**
	 * フィールド区切り（タブ）。
	 */
	static final String SEPARATOR = "\t";
	/**
	 * プロトコル違反時の固定要求ID。
	 */
	static final String PROTOCOL_ERROR_ID = "protocol";

	private static final Charset UTF_8 = StandardCharsets.UTF_8;
	private static final Base64.Decoder DECODER = Base64.getDecoder();
	private static final Base64.Encoder ENCODER = Base64.getEncoder();

	// コマンド名（switch のため compile-time 定数にしている）
	private static final String PING = "PING";
	private static final String RUN = "RUN";
	private static final String COMPILE = "COMPILE";

	private static final int RUN_PARTS_MIN_SIZE = 5;
	private static final int COMPILE_PARTS_MIN_SIZE = 4;

	private ProtocolCodec() {
	}

	/**
	 * 受信した 1 行を解析します。失敗は例外ではなく {@link ProtocolError} として返します。
	 *
	 * @param line 受信したコマンド行
	 * @return 解析結果
	 */
	static ParseOutcome parse(final String line) {
		final String[] parts = line.split(SEPARATOR, -1);
		return switch (parts[0]) {
			case PING -> new ValidRequest(new Ping());
			case RUN -> parseRun(parts);
			case COMPILE -> parseCompile(parts);
			default -> new ProtocolError(PROTOCOL_ERROR_ID, "Unknown command: " + parts[0]);
		};
	}

	private static ParseOutcome parseRun(final String[] parts) {
		if (parts.length < RUN_PARTS_MIN_SIZE) {
			return new ProtocolError(PROTOCOL_ERROR_ID, "Malformed RUN command.");
		}
		try {
			return new ValidRequest(new Run(
					parts[1],
					Paths.get(decode(parts[2])),
					decode(parts[3]),
					DECODER.decode(parts[4])
			));
		} catch (final RuntimeException exception) {
			return new ProtocolError(PROTOCOL_ERROR_ID, "Malformed RUN command.");
		}
	}

	private static ParseOutcome parseCompile(final String[] parts) {
		if (parts.length < COMPILE_PARTS_MIN_SIZE) {
			return new ProtocolError(PROTOCOL_ERROR_ID, "Malformed COMPILE command.");
		}
		try {
			return new ValidRequest(new Compile(
					parts[1],
					Paths.get(decode(parts[2])),
					Paths.get(decode(parts[3]))
			));
		} catch (final RuntimeException exception) {
			return new ProtocolError(PROTOCOL_ERROR_ID, "Malformed COMPILE command.");
		}
	}

	/**
	 * 応答を 1 行へ符号化します。{@link Response} は sealed なので網羅がコンパイラ保証されます。
	 *
	 * @param response 応答
	 * @return プロトコル形式の 1 行
	 */
	static String encode(final Response response) {
		return switch (response) {
			case Ready ignored -> "READY";
			case Pong ignored -> "PONG";
			case RunAck ignored -> "RUN";
			case Result result -> encodeResult(result);
			case Compiled compiled -> String.join(SEPARATOR,
					"COMPILED",
					compiled.requestId(),
					Integer.toString(compiled.result().exitCode()),
					compiled.result().requiresIsolation() ? "1" : "0",
					b64(compiled.result().diagnostics()));
			case ErrorResponse error -> String.join(SEPARATOR,
					"ERROR",
					error.requestId(),
					b64(error.message()));
		};
	}

	private static String encodeResult(final Result response) {
		final ExecutionResult result = response.result();
		return new StringJoiner(SEPARATOR)
				.add("RESULT")
				.add(response.requestId())
				.add(Integer.toString(result.exitCode()))
				.add(Long.toString(result.timeMillis()))
				.add(ENCODER.encodeToString(result.stdout()))
				.add(ENCODER.encodeToString(result.stderr()))
				.add(result.stdoutTruncated() ? "1" : "0")
				.add(result.stderrTruncated() ? "1" : "0")
				.add(Long.toString(result.memoryBytes()))
				.toString();
	}

	private static String decode(final String base64) {
		return new String(DECODER.decode(base64), UTF_8);
	}

	private static String b64(final String text) {
		return ENCODER.encodeToString(text.getBytes(UTF_8));
	}
}

/**
 * 正しく受理できた要求です。
 *
 * @param request 受理した要求
 */
record ValidRequest(Request request) implements ParseOutcome {
}

/**
 * プロトコル違反です。{@link ErrorResponse} に変換されます。
 *
 * @param requestId 対象の要求ID（通常 {@code "protocol"}）
 * @param reason    違反理由
 */
record ProtocolError(String requestId, String reason) implements ParseOutcome {
}
