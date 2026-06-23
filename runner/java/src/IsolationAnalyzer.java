import java.io.*;
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

	private static final int MAGIC = 0xCAFEBABE;
	private static final int TAG_UTF8 = 1;
	private static final int TAG_FIELDREF = 9;
	private static final int TAG_METHODREF = 10;
	private static final int TAG_INTERFACE_METHODREF = 11;

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
			return scan(Files.readAllBytes(classFile));
		} catch (final IOException exception) {
			return true;
		}
	}

	/**
	 * 1 つの {@code .class} の定数プールだけを読み、危険 API 参照の有無を返します。
	 * クラスファイルの定数プール形式は安定なので、Class-File API に依存せず手で読みます。
	 *
	 * @param bytes クラスファイルのバイト列
	 * @return 危険 API を参照していれば true
	 * @throws IOException 読み込みに失敗した場合
	 */
	private static boolean scan(final byte[] bytes) throws IOException {
		try (DataInputStream in = new DataInputStream(new ByteArrayInputStream(bytes))) {
			if (in.readInt() != MAGIC) return false;
			in.readUnsignedShort(); // minor version
			in.readUnsignedShort(); // major version
			final int count = in.readUnsignedShort();
			final int[] tag = new int[count];
			final String[] utf8 = new String[count];
			final int[] ref1 = new int[count];
			final int[] ref2 = new int[count];

			for (int i = 1; i < count; i++) {
				final int t = in.readUnsignedByte();
				tag[i] = t;
				switch (t) {
					case TAG_UTF8 -> utf8[i] = in.readUTF();
					case 7, 8, 16, 19, 20 -> ref1[i] = in.readUnsignedShort(); // Class/String/MethodType/Module/Package
					case 15 -> { // MethodHandle: u1 + u2
						in.readUnsignedByte();
						ref1[i] = in.readUnsignedShort();
					}
					case 3, 4 -> in.readInt(); // Integer/Float
					case 5, 6 -> { // Long/Double は 2 スロット占有
						in.readLong();
						i++;
					}
					case TAG_FIELDREF, TAG_METHODREF, TAG_INTERFACE_METHODREF, 12, 17, 18 -> {
						ref1[i] = in.readUnsignedShort();
						ref2[i] = in.readUnsignedShort();
					}
					default -> {
						return true; // 未知タグ：解釈できないので安全側へ
					}
				}
			}

			for (int i = 1; i < count; i++) {
				if (tag[i] != TAG_FIELDREF && tag[i] != TAG_METHODREF && tag[i] != TAG_INTERFACE_METHODREF) {
					continue;
				}
				final String owner = utf8[ref1[ref1[i]]]; // ref -> Class -> Utf8(owner internal name)
				final String member = utf8[ref1[ref2[i]]]; // ref -> NameAndType -> Utf8(member name)
				if (owner == null || member == null) continue;
				if (DANGEROUS_MEMBERS.contains(owner + "." + member)) return true;
			}
			return false;
		}
	}
}
