import java.io.*;
import java.lang.classfile.*;
import java.lang.classfile.constantpool.*;
import java.nio.file.*;
import java.util.*;
import java.util.stream.*;

/**
 * コンパイル済み {@code .class} の定数プールを走査し、「常駐 JVM 内で実行すると危険な API」を
 * 参照しているかを判定します（改善1）。
 * <p>
 * ここでの「危険」とは、共有された常駐 JVM を<strong>壊す・汚す・状態を残す</strong>ことを指します
 * （競プロ環境前提）。該当するコードは TS 側が使い捨ての外部 JVM へ振り分けます。検出はソースの
 * 正規表現ではなくバイトコード（定数プールの Methodref/Fieldref）に基づくため、コメントや文字列中の
 * 誤検出がありません。検出できるのは「提出クラスが直接参照する」API で、リフレクション経由は対象外です
 * （これは正規表現でも同じで、競プロでは直接参照が普通なので実用上十分です）。
 * </p>
 */
final class IsolationAnalyzer {
	/**
	 * (owner.member) の完全一致で危険とみなす参照。
	 * <ul>
	 *   <li>JVM の終了: System.exit / Runtime.exit / Runtime.halt</li>
	 *   <li>捕捉用に差し替えた標準ストリームを迂回: FileDescriptor.in/out/err</li>
	 *   <li>標準ストリーム自体の差し替え: System.setIn/setOut/setErr</li>
	 *   <li>次回実行へ漏れる JVM グローバル状態: System.setProperty 系 / Locale.setDefault / TimeZone.setDefault / setSecurityManager</li>
	 *   <li>シャットダウンフック・外部プロセス: Runtime.addShutdownHook / removeShutdownHook / exec / ProcessBuilder.&lt;init&gt;</li>
	 * </ul>
	 * <p>
	 * スレッド生成（{@code Thread} / {@code Executors} 等）は、競プロで多用される大スタック再帰イディオム
	 * （{@code new Thread(...,1<<26).start()} + {@code join()}）が join 済みで安全なため、あえて検出対象から
	 * 外している（隔離の遅い経路へ送らない）。join しない残存スレッドという稀なリスクは受容する。
	 * </p>
	 */
	private static final Set<String> DANGEROUS_MEMBERS = Set.of(
			"java/lang/System.exit",
			"java/lang/System.setOut",
			"java/lang/System.setErr",
			"java/lang/System.setIn",
			"java/lang/System.setProperty",
			"java/lang/System.setProperties",
			"java/lang/System.clearProperty",
			"java/lang/System.setSecurityManager",
			"java/lang/Runtime.exit",
			"java/lang/Runtime.halt",
			"java/lang/Runtime.addShutdownHook",
			"java/lang/Runtime.removeShutdownHook",
			"java/lang/Runtime.exec",
			"java/lang/ProcessBuilder.<init>",
			"java/util/Locale.setDefault",
			"java/util/TimeZone.setDefault",
			"java/io/FileDescriptor.in",
			"java/io/FileDescriptor.out",
			"java/io/FileDescriptor.err"
	);

	private IsolationAnalyzer() {
	}

	/**
	 * 出力ディレクトリ配下の全 {@code .class}（内部クラス・ラムダ含む）を走査し、
	 * 1 つでも危険 API を参照していれば隔離が必要と判定します。
	 *
	 * @param outputDirectory {@code .class} 出力先
	 * @return 隔離実行が必要なら true
	 */
	static boolean requiresIsolation(final Path outputDirectory) {
		try (Stream<Path> files = Files.walk(outputDirectory)) {
			return files
					.filter(path -> path.toString().endsWith(".class"))
					.anyMatch(IsolationAnalyzer::classReferencesDangerousApi);
		} catch (final IOException exception) {
			return true;
		}
	}

	private static boolean classReferencesDangerousApi(final Path classFile) {
		try {
			for (final PoolEntry entry : ClassFile.of().parse(classFile).constantPool()) {
				if (!(entry instanceof MemberRefEntry member)) continue;
				final String key = member.owner().asInternalName() + "." + member.name().stringValue();
				if (DANGEROUS_MEMBERS.contains(key)) return true;
			}
			return false;
		} catch (final Exception exception) {
			return true;
		}
	}
}
