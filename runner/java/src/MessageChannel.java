import java.io.*;
import java.nio.charset.*;

/**
 * 通信の最下層。バイト/行の入出力に加え、型付きメッセージ ⇄ 行 の変換（{@link ProtocolCodec} への委譲）を
 * ここで完結させます。
 * <p>
 * これより上の層は文字列・Base64・タブを一切意識せず、{@link Response} を選んで {@link #send(Response)} する
 * だけでよく、「書く前に必ず符号化する」という暗黙の制約がシグネチャの制約に変わります。変換ロジック自体は
 * {@link ProtocolCodec} に置き、本クラスはその呼び出しと行 IO だけを担います。
 * </p>
 */
final class MessageChannel implements AutoCloseable {
	private final BufferedReader reader;
	private final BufferedWriter writer;

	MessageChannel(final InputStream in, final OutputStream out) {
		this.reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
		this.writer = new BufferedWriter(new OutputStreamWriter(out, StandardCharsets.UTF_8));
	}

	/**
	 * 次の要求を受信して解析します。空行は読み飛ばし、ストリーム終端なら {@code null} を返します。
	 *
	 * @return 解析結果。終端なら {@code null}
	 * @throws IOException 読み込みに失敗した場合
	 */
	ParseOutcome receive() throws IOException {
		String line;
		while ((line = reader.readLine()) != null) {
			if (!line.isEmpty()) return ProtocolCodec.parse(line);
		}
		return null;
	}

	/**
	 * 応答を 1 つ送ります。符号化はここで行うので、呼び出し側は型を選ぶだけです。
	 * 行区切りは PROTOCOL.md 2 に従い LF 固定です。
	 *
	 * @param response 送信する応答
	 * @throws IOException 書き込みに失敗した場合
	 */
	void send(final Response response) throws IOException {
		writer.write(ProtocolCodec.encode(response));
		writer.write('\n');
		writer.flush();
	}

	@Override
	public void close() throws IOException {
		writer.flush();
	}
}
