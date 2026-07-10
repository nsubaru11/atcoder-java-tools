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
	private static final String TRANSFORM = "TRANSFORM";

	private static final int RUN_PARTS_MIN_SIZE = 5;
	private static final int COMPILE_PARTS_MIN_SIZE = 4;
	private static final int TRANSFORM_PARTS_MIN_SIZE = 6;

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
			case TRANSFORM -> parseTransform(parts);
			default -> new ProtocolError(PROTOCOL_ERROR_ID, "Unknown command: " + parts[0]);
		};
	}

	private static ParseOutcome parseTransform(final String[] parts) {
		if (parts.length < TRANSFORM_PARTS_MIN_SIZE) {
			return new ProtocolError(PROTOCOL_ERROR_ID, "Malformed TRANSFORM command.");
		}
		try {
			return new ValidRequest(new Transform(
					parts[1],
					decode(parts[2]),
					Paths.get(decode(parts[3])),
					"1".equals(parts[4]),
					"1".equals(parts[5]),
					parts.length < 7 || "1".equals(parts[6])
			));
		} catch (final RuntimeException exception) {
			return new ProtocolError(PROTOCOL_ERROR_ID, "Malformed TRANSFORM command.");
		}
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
					b64(compiled.result().diagnostics()),
					b64(diagnosticsJson(compiled.result().diagnosticItems())));
			case Transformed transformed -> encodeTransformed(transformed);
			case ErrorResponse error -> String.join(SEPARATOR,
					"ERROR",
					error.requestId(),
					b64(error.message()));
		};
	}

	private static String encodeTransformed(final Transformed response) {
		final SourceTransformResult result = response.result();
		return new StringJoiner(SEPARATOR)
				.add("TRANSFORMED")
				.add(response.requestId())
				.add(Integer.toString(result.exitCode()))
				.add(b64(result.sourceCode()))
				.add(b64(result.diagnostics()))
				.add(b64(String.join("\n", result.inlinedClasses())))
				.add(b64(String.join("\n", result.addedImports())))
				.add(b64(diagnosticsJson(result.diagnosticItems())))
				.toString();
	}

	private static String diagnosticsJson(final List<CompilerDiagnostic> diagnostics) {
		return diagnostics.stream().map(diagnostic -> "{" +
				"\"kind\":\"" + jsonEscape(diagnostic.kind()) + "\"," +
				"\"line\":" + diagnostic.line() + "," +
				"\"column\":" + diagnostic.column() + "," +
				"\"code\":\"" + jsonEscape(diagnostic.code()) + "\"," +
				"\"message\":\"" + jsonEscape(diagnostic.message()) + "\"}")
				.collect(java.util.stream.Collectors.joining(",", "[", "]"));
	}

	private static String jsonEscape(final String value) {
		final StringBuilder result = new StringBuilder(value.length() + 16);
		for (int i = 0; i < value.length(); i++) {
			final char c = value.charAt(i);
			switch (c) {
				case '\\' -> result.append("\\\\");
				case '"' -> result.append("\\\"");
				case '\n' -> result.append("\\n");
				case '\r' -> result.append("\\r");
				case '\t' -> result.append("\\t");
				default -> {
					if (c < 0x20) result.append(String.format("\\u%04x", (int) c));
					else result.append(c);
				}
			}
		}
		return result.toString();
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
