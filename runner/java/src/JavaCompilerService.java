import java.io.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.util.*;

import javax.tools.*;

/**
 * 常駐 JVM 内の Java コンパイラ（{@link ToolProvider} 経由）でコンパイルする専任クラスです。
 * <p>
 * 外部 {@code javac} プロセスの JVM 起動コストを無くすのが目的です。
 * </p>
 */
final class JavaCompilerService {
	private static final Charset UTF_8 = StandardCharsets.UTF_8;
	private final JavaCompiler compiler;

	public JavaCompilerService() {
		compiler = ToolProvider.getSystemJavaCompiler();
		if (compiler == null) {
			throw new IllegalStateException("No system Java compiler is available (JDK required).");
		}
	}

	/**
	 * 指定ソースをコンパイルします。
	 *
	 * @param sourceFile      コンパイル対象の .java
	 * @param outputDirectory .class 出力先
	 * @return コンパイル結果（exitCode と診断メッセージ）
	 */
	CompileResult compile(final Path sourceFile, final Path outputDirectory) {
		final DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
		final StringWriter additionalOutput = new StringWriter();
		try (StandardJavaFileManager fileManager = compiler.getStandardFileManager(diagnostics, null, UTF_8)) {
			Files.createDirectories(outputDirectory);
			final Iterable<? extends JavaFileObject> units = fileManager.getJavaFileObjects(sourceFile.toFile());
			final List<String> options = List.of(
					"-encoding", "UTF-8", "-g:lines,source", "-proc:none", "-implicit:none",
					"-d", outputDirectory.toString()
			);
			final boolean ok = compiler.getTask(additionalOutput, fileManager, diagnostics, options, null, units).call();
			final StringBuilder message = new StringBuilder();
			for (final Diagnostic<? extends JavaFileObject> diagnostic : diagnostics.getDiagnostics()) {
				message.append(diagnostic).append("\n");
			}
			final String extra = additionalOutput.toString();
			if (!extra.isBlank()) message.append(extra);
			// 成功時のみ、危険 API を参照していて隔離実行が要るかをバイトコードから判定する（改善1）。
			final boolean requiresIsolation = ok && IsolationAnalyzer.requiresIsolation(outputDirectory);
			return new CompileResult(ok ? 0 : 1, message.toString(), requiresIsolation);
		} catch (final Exception exception) {
			return new CompileResult(1, exception.toString(), false);
		}
	}
}
