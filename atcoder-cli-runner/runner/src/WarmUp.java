import java.util.*;
import java.util.function.*;

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
	 * テンプレートの UndirectedGraph を使用し、最も多用する adj および adjEdgeIds の
	 * バイトコードとアロケーション処理をJVMに最適化させます。
	 *
	 * @return グラフ処理のチェックサム
	 */
	private static long warmUpGraph() {
		final UndirectedGraph g = new UndirectedGraph(GRAPH_N, GRAPH_M);
		for (int u = 0; u < GRAPH_N; u++) {
			g.add(u, (u + 1) & (GRAPH_N - 1));
			g.add(u, (u + 97) & (GRAPH_N - 1));
			g.add(u, (u + 257) & (GRAPH_N - 1));
		}
		long sum = 0;
		for (int iter = 0; iter < 50; iter++) {
			for (int u = 0; u < GRAPH_N; u++) {
				final int[] adj = g.adj(u);
				for (final int v : adj) sum += v;
				final int[] edgeIds = g.adjEdgeIds(u);
				for (final int id : edgeIds) sum ^= id;
			}
		}
		return sum;
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
		if (exp == 0) return 1;
		int ans = 1;
		for (base %= mod; exp > 1; exp >>= 1) {
			if ((exp & 1) == 1) ans = (int) ((long) ans * base % mod);
			base = (int) ((long) base * base % mod);
		}
		return (int) ((long) ans * base % mod);
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
		if (exp == 0) return 1;
		long ans = 1;
		for (base %= mod; exp > 1; exp >>= 1) {
			if ((exp & 1) == 1) ans = ans * base % mod;
			base = base * base % mod;
		}
		return ans * base % mod;
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
		if (a == 0) return b;
		if (b == 0) return a;
		int commonShift = Integer.numberOfTrailingZeros(a | b);
		a >>= Integer.numberOfTrailingZeros(a);
		while (b != 0) {
			b >>= Integer.numberOfTrailingZeros(b);
			if (a > b) {
				int tmp = a;
				a = b;
				b = tmp;
			}
			b -= a;
		}
		return a << commonShift;
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

	/**
	 * 自己ループを含まない無向グラフ管理用ライブラリ
	 * <p>
	 * 無向辺は追加順に0始まりの辺IDが割り当てられます。
	 * 内部表現では1本の無向辺を2本の内部辺として保持しますが、
	 * 外部には無向辺IDとして公開します。
	 * <p>
	 * {@link #adjEdgeIds(int)} で取得した辺IDは {@link #to(int, int)} と
	 * {@link #cost(int)} にそのまま渡せます。
	 * {@link #to(int, int)} は「頂点 {@code u} から見た接続先頂点」を返します。
	 */
	@SuppressWarnings("unused")
	private static final class UndirectedGraph {
		private final int[] dest, next, first, degree;
		private final long[] cost;
		private final int n;
		private int edgeCount = 0;

		public UndirectedGraph(final int n, final int m) {
			this.n = n;
			final int m2 = m << 1;
			dest = new int[m2];
			next = new int[m2];
			first = new int[n];
			Arrays.fill(first, -1);
			degree = new int[n];
			cost = new long[m2];
		}

		public void add(final int i, final int j) {
			add(i, j, 1);
		}

		public void add(final int i, final int j, final long c) {
			dest[edgeCount] = j;
			next[edgeCount] = first[i];
			cost[edgeCount] = c;
			first[i] = edgeCount++;
			degree[i]++;

			dest[edgeCount] = i;
			next[edgeCount] = first[j];
			cost[edgeCount] = c;
			first[j] = edgeCount++;
			degree[j]++;
		}

		public void addAll(int m, final IntSupplier u, final IntSupplier v) {
			while (m-- > 0) add(u.getAsInt(), v.getAsInt());
		}

		public void addAll(int m, final IntSupplier u, final IntSupplier v, final LongSupplier cost) {
			while (m-- > 0) add(u.getAsInt(), v.getAsInt(), cost.getAsLong());
		}

		public int degree(final int i) {
			return degree[i];
		}

		public boolean isBipartite() {
			final int[] color = new int[n];
			final int[] q = new int[n];
			color[0] = 1;
			for (int head = 0, tail = 1; head < tail; head++) {
				final int u = q[head];
				for (int e = first[u]; e != -1; e = next[e]) {
					final int v = dest[e];
					if (color[v] == color[u]) return false;
					if (color[v] != 0) continue;
					color[v] = -color[u];
					q[tail++] = v;
				}
			}
			return true;
		}

		public int to(final int u, final int e) {
			final int v1 = dest[e << 1];
			final int v2 = dest[e << 1 | 1];
			return u != v1 ? v1 : v2;
		}

		public long cost(final int e) {
			return cost[e << 1];
		}

		public int[] adj(final int u) {
			final int[] adj = new int[degree[u]];
			for (int e = first[u], i = 0; e != -1; e = next[e], i++) {
				adj[i] = dest[e];
			}
			return adj;
		}

		public int[] adjEdgeIds(final int u) {
			final int[] ids = new int[degree[u]];
			for (int e = first[u], i = 0; e != -1; e = next[e], i++) {
				ids[i] = e >> 1;
			}
			return ids;
		}

		public int[] bfs(final int s) {
			final boolean[] visited = new boolean[n];
			visited[s] = true;
			final int[] bfs = new int[n];
			Arrays.fill(bfs, 1, n, -1);
			bfs[0] = s;
			for (int head = 0, tail = 1; head < tail; head++) {
				final int u = bfs[head];
				for (int e = first[u]; e != -1; e = next[e]) {
					final int v = dest[e];
					if (visited[v]) continue;
					bfs[tail++] = v;
					visited[v] = true;
				}
			}
			return bfs;
		}

		public int[] bfs(final int... s) {
			final boolean[] visited = new boolean[n];
			final int[] bfs = new int[n];
			int tail = 0;
			for (final int si : s) {
				bfs[tail++] = si;
				visited[si] = true;
			}
			Arrays.fill(bfs, tail, n, -1);
			for (int head = 0; head < tail; head++) {
				final int u = bfs[head];
				for (int e = first[u]; e != -1; e = next[e]) {
					final int v = dest[e];
					if (visited[v]) continue;
					bfs[tail++] = v;
					visited[v] = true;
				}
			}
			return bfs;
		}

		public int[] dist(final int s) {
			final int[] dist = new int[n];
			Arrays.fill(dist, -1);
			dist[s] = 0;
			final int[] q = new int[n];
			q[0] = s;
			for (int head = 0, tail = 1; head < tail; head++) {
				final int u = q[head];
				for (int e = first[u]; e != -1; e = next[e]) {
					final int v = dest[e];
					if (dist[v] != -1) continue;
					dist[v] = dist[u] + 1;
					q[tail++] = v;
				}
			}
			return dist;
		}

		public int[] dist(final int... s) {
			final int[] dist = new int[n];
			Arrays.fill(dist, -1);
			final int[] q = new int[n];
			int tail = 0;
			for (final int s1 : s) {
				dist[s1] = 0;
				q[tail++] = s1;
			}
			for (int head = 0; head < tail; head++) {
				final int u = q[head];
				for (int e = first[u]; e != -1; e = next[e]) {
					final int v = dest[e];
					if (dist[v] != -1) continue;
					dist[v] = dist[u] + 1;
					q[tail++] = v;
				}
			}
			return dist;
		}

	}

}

