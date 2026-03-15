import java.util.*;

/**
 * ローカルランナー起動時に実行するウォームアップ専用エントリです。
 * 入力不要で、代表的な計算パスを短時間で実行します。
 */
public final class WarmUp {

	private static final int MOD = 998_244_353;
	private static final int GRAPH_N = 1 << 12;
	private static final int GRAPH_M = GRAPH_N * 3;
	private static final int ARRAY_SIZE = 1 << 17;
	private static final int MATH_ITERATIONS = 220_000;

	/**
	 * ウォームアップ処理を実行します。
	 *
	 * @param args コマンドライン引数（未使用）
	 */
	public static void main(final String[] args) {
		System.out.println(runWarmUp());
	}

	/**
	 * グラフ・数値・配列処理を順に実行し、チェックサムを返します。
	 *
	 * @return 実行経路の最適化を促すためのチェックサム
	 */
	private static long runWarmUp() {
		long checksum = 0;
		checksum ^= warmUpGraph();
		checksum ^= warmUpMath();
		checksum ^= warmUpArray();
		return checksum;
	}

	/**
	 * 1次元配列で圧縮した無向グラフを構築し、BFSを実行します。
	 *
	 * @return グラフ処理のチェックサム
	 */
	private static long warmUpGraph() {
		final int edgeCapacity = GRAPH_M << 1;
		final int[] head = new int[GRAPH_N];
		final int[] to = new int[edgeCapacity];
		final int[] next = new int[edgeCapacity];
		Arrays.fill(head, -1);

		int edgeIndex = 0;
		for (int u = 0; u < GRAPH_N; u++) {
			edgeIndex = addUndirectedEdge(head, to, next, edgeIndex, u, (u + 1) & (GRAPH_N - 1));
			edgeIndex = addUndirectedEdge(head, to, next, edgeIndex, u, (u + 97) & (GRAPH_N - 1));
			edgeIndex = addUndirectedEdge(head, to, next, edgeIndex, u, (u + 257) & (GRAPH_N - 1));
		}

		final int[] dist = new int[GRAPH_N];
		Arrays.fill(dist, -1);
		final int[] queue = new int[GRAPH_N];
		int qh = 0;
		int qt = 0;
		dist[0] = 0;
		queue[qt++] = 0;
		long sum = 0;

		while (qh < qt) {
			final int u = queue[qh++];
			sum += ((long) (u + 1)) * (dist[u] + 1);
			for (int e = head[u]; e != -1; e = next[e]) {
				final int v = to[e];
				if (dist[v] != -1) {
					continue;
				}
				dist[v] = dist[u] + 1;
				queue[qt++] = v;
			}
		}
		return sum;
	}

	/**
	 * 圧縮隣接リストへ無向辺を追加します。
	 *
	 * @param head      頂点ごとの先頭辺インデックス
	 * @param to        行き先配列
	 * @param next      次辺配列
	 * @param edgeIndex 次に使う辺インデックス
	 * @param u         頂点u
	 * @param v         頂点v
	 * @return 更新後の辺インデックス
	 */
	private static int addUndirectedEdge(
			final int[] head,
			final int[] to,
			final int[] next,
			int edgeIndex,
			final int u,
			final int v
	) {
		to[edgeIndex] = v;
		next[edgeIndex] = head[u];
		head[u] = edgeIndex++;
		to[edgeIndex] = u;
		next[edgeIndex] = head[v];
		head[v] = edgeIndex++;
		return edgeIndex;
	}

	/**
	 * gcdと累乗剰余演算を繰り返して、整数演算パスを温めます。
	 *
	 * @return 数値処理のチェックサム
	 */
	private static long warmUpMath() {
		long acc = 1;
		for (int i = 1; i <= MATH_ITERATIONS; i++) {
			final int a = (i << 1) ^ 0x5A5A5A5A;
			final int b = (i << 2) ^ 0x12345678;
			acc += gcd(a, b);
			acc += modPow(i, 5, MOD);
			acc += modPow((long) i * 37 + 11, 3, 1_000_000_007L);
		}
		return acc;
	}

	/**
	 * int版の二進累乗法です。
	 *
	 * @param base 底
	 * @param exp  指数
	 * @param mod  法
	 * @return {@code base^exp mod mod}
	 */
	private static int modPow(int base, int exp, final int mod) {
		long x = base % mod;
		long result = 1;
		while (exp > 0) {
			if ((exp & 1) != 0) {
				result = (result * x) % mod;
			}
			x = (x * x) % mod;
			exp >>= 1;
		}
		return (int) result;
	}

	/**
	 * long版の二進累乗法です。
	 *
	 * @param base 底
	 * @param exp  指数
	 * @param mod  法
	 * @return {@code base^exp mod mod}
	 */
	private static long modPow(long base, long exp, final long mod) {
		long x = base % mod;
		long result = 1;
		while (exp > 0) {
			if ((exp & 1L) != 0L) {
				result = (result * x) % mod;
			}
			x = (x * x) % mod;
			exp >>= 1;
		}
		return result;
	}

	/**
	 * Steinのアルゴリズムで最大公約数を計算します。
	 *
	 * @param a 値a
	 * @param b 値b
	 * @return gcd(a, b)
	 */
	private static int gcd(int a, int b) {
		a = Math.abs(a);
		b = Math.abs(b);
		if (a == 0) {
			return b;
		}
		if (b == 0) {
			return a;
		}
		final int shift = Integer.numberOfTrailingZeros(a | b);
		a >>= Integer.numberOfTrailingZeros(a);
		while (b != 0) {
			b >>= Integer.numberOfTrailingZeros(b);
			if (a > b) {
				final int tmp = a;
				a = b;
				b = tmp;
			}
			b -= a;
		}
		return a << shift;
	}

	/**
	 * 擬似乱数配列の生成とソートを行い、配列アクセスと標準ライブラリを温めます。
	 *
	 * @return 配列処理のチェックサム
	 */
	private static long warmUpArray() {
		final int[] values = new int[ARRAY_SIZE];
		long x = 0x9E3779B97F4A7C15L;
		for (int i = 0; i < values.length; i++) {
			x ^= x << 7;
			x ^= x >>> 9;
			x ^= x << 8;
			values[i] = (int) (x ^ (x >>> 32) ^ i);
		}
		Arrays.sort(values);
		long sum = 0;
		for (int i = 0; i < values.length; i += 257) {
			sum += (long) values[i] * (i + 1);
		}
		return sum;
	}
}

