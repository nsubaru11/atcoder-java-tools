# ローカルランナー通信プロトコル（現行仕様）

daemon（Bun/Node 側、`runner/src/daemon/dispatcher.ts`）と常駐 JVM（`runner/java/src/Dispatcher.java`）の間で交わされる、子プロセスの標準入出力を介したテキストプロトコルの取り決めです。
Java と TypeScript の 2 実装が同じ約束に従う必要があり、両者の整合を保証するコンパイラは存在しないため、本書をその契約の正典とします。

## 1. トランスポート

通信は、daemon が起動した Java 子プロセス（`Dispatcher`）の標準ストリーム上で行われます。

| ストリーム          | 向き           | 用途                                                  |
|----------------|--------------|-----------------------------------------------------|
| 標準入力 (stdin)   | daemon → JVM | 要求（Request）                                         |
| 標準出力 (stdout)  | JVM → daemon | 応答（Response）                                        |
| 標準エラー (stderr) | JVM → daemon | ログのみ。daemon は `[Dispatcher]` を付けて素通しする。プロトコルの一部ではない |

要求と応答はこの 1 本の双方向チャネルを共有します。
**同時に処理される要求は常に 1 件だけ**で、daemon 側が直列化します（次の要求は前の応答を受け取ってから送る）。

## 2. 行とフィールドの規則

- **1 メッセージ = 1 行**。行区切りは LF（`\n`）。daemon は `"<command>\n"` を書き込み、JVM 側は行単位で読む。
- **フィールド区切りはタブ（`\t`）**。受信側は `split("\t")` で分解する。
- 先頭フィールドが**コマンド名**（すべて大文字）。
- 文字コードは **UTF-8**。
- 可変長・任意内容のデータ（ファイルパス、ソース、標準入出力、診断、エラーメッセージ）は、各フィールドを **Base64（標準アルファベット、UTF-8 バイト列）** で符号化する。
  タブ・改行・任意バイトが行構造を壊さないための措置。本書では `b64(x)` と表記する。
- 数値フィールド（`exitCode` / `timeMillis` / 切り詰めフラグ）は **Base64 化せず**、素の ASCII 十進で書く。

### 相関 ID

要求と応答は `id` で突き合わせる。

- daemon は要求ごとに**単調増加の整数を文字列化**して採番する（`"1"`, `"2"`, …）。
- 応答には対応する要求と同じ `id` が載る。daemon は `id` 不一致を検出するとその要求を失敗扱いにする。
- プロトコル違反（不正・未知コマンド）に対する `ERROR` 応答だけは、JVM 側が固定値 `protocol` を `id` として用いる。

## 3. メッセージ一覧

### 3.1 ハンドシェイク：`READY`

JVM は起動して準備が完了すると、要求を待たずに次の 1 行を出力する。

```
READY
```

daemon はこの `READY` を受け取ってから要求の送信を開始する。
起動が既定 10 秒以内に `READY` に至らなければ、daemon は JVM を強制終了して起動失敗とみなす。

### 3.2 `PING` / `PONG`

死活確認。

要求:

```
PING
```

応答:

```
PONG
```

### 3.3 `RUN`：コンパイル済みクラスの実行

要求:

```
RUN \t <id> \t b64(classDir) \t b64(mainClass) \t b64(stdin)
```

| フィールド       | 内容                         |
|-------------|----------------------------|
| `classDir`  | `.class` を含むクラスディレクトリの絶対パス |
| `mainClass` | 実行する完全修飾クラス名（例: `Main`）    |
| `stdin`     | 実行対象へ与える標準入力の全内容           |

JVM はまず**受理通知**として次の 1 行を即座に返す（daemon はこの行を無視する）。

```
RUN
```

実行が完了すると**結果**を返す。

```
RESULT \t <id> \t <exitCode> \t <timeMillis> \t b64(stdout) \t b64(stderr) \t <stdoutTruncated> \t <stderrTruncated> \t <memory>
```

| フィールド                                 | 内容                                                         |
|---------------------------------------|------------------------------------------------------------|
| `exitCode`                            | `0` = 正常終了 / `1` = 実行中に捕捉されない例外が発生                         |
| `timeMillis`                          | 実行に要した時間（ミリ秒）                                              |
| `stdout` / `stderr`                   | 実行対象が出力した標準出力・標準エラー                                        |
| `stdoutTruncated` / `stderrTruncated` | 出力が上限超過で切り詰められたら `1`、そうでなければ `0`                           |
| `memory`                              | 実行スレッドの累積アロケーション量（バイト・十進）。**ピークではなく近似値**。計測不可なら `-1`（§6.1） |

### 3.4 `COMPILE`：ソースのコンパイル

常駐 JVM 内の Java コンパイラ（`ToolProvider` 経由）でコンパイルする。

要求:

```
COMPILE \t <id> \t b64(sourceFile) \t b64(outDir)
```

| フィールド        | 内容                             |
|--------------|--------------------------------|
| `sourceFile` | コンパイル対象 `.java` の絶対パス          |
| `outDir`     | `.class` の出力先ディレクトリ（無ければ作成される） |

応答:

```
COMPILED \t <id> \t <exitCode> \t <requiresIsolation> \t b64(diagnostics)
```

| フィールド               | 内容                                                    |
|---------------------|-------------------------------------------------------|
| `exitCode`          | `0` = 成功 / `1` = 失敗                                   |
| `requiresIsolation` | 危険 API を参照し隔離実行が必要なら `1`、そうでなければ `0`（成功時のみ意味を持つ。§6.2） |
| `diagnostics`       | コンパイラ診断（エラー・警告）を連結したテキスト。成功時は空のこともある                  |

### 3.5 `ERROR`：エラー応答

不正・未知の要求、または要求処理中に例外が起きた場合に返る。

```
ERROR \t <id> \t b64(message)
```

- `id` は対象要求の `id`。要求の体裁が壊れている等のプロトコル違反では `protocol`。
- daemon はこれを受けて当該要求を失敗（reject）にする。

## 4. 文法（BNF 風）

```
message      = request | response
request      = ping | run-req | compile-req
response     = ready | pong | run-ack | result | compiled | error

ping         = "PING"
run-req      = "RUN"     TAB id TAB b64 TAB b64 TAB b64       ; classDir, mainClass, stdin
compile-req  = "COMPILE" TAB id TAB b64 TAB b64               ; sourceFile, outDir

ready        = "READY"
pong         = "PONG"
run-ack      = "RUN"
result       = "RESULT"   TAB id TAB int TAB int TAB b64 TAB b64 TAB flag TAB flag TAB int
compiled     = "COMPILED" TAB id TAB int TAB flag TAB b64
error        = "ERROR"    TAB id TAB b64

id           = ("protocol" | 1*DIGIT)
int          = 1*DIGIT
flag         = "0" | "1"
b64          = <RFC 4648 標準 Base64, UTF-8 バイト列>
TAB          = %x09
行区切り      = LF (%x0A)
```

## 5. 有効な要求と境界ケース

- daemon → JVM へ送ってよい要求コマンドは **`PING` / `RUN` / `COMPILE` のみ**。応答系トークン（`RESULT` 等）を要求として送ってはならない。
- `RUN` のフィールドが 5 未満 → `ERROR  protocol  b64("Malformed RUN command.")`
- `COMPILE` のフィールドが 4 未満 → `ERROR  protocol  b64("Malformed COMPILE command.")`
- 先頭トークンが未知 → `ERROR  protocol  b64("Unknown command: <token>")`

## 6. 出力上限・メモリ・隔離判定

### 6.1 出力の上限（切り詰め）とメモリ

実行対象の標準出力・標準エラーは、それぞれ環境変数 `LOCAL_RUNNER_CAPTURE_LIMIT_BYTES`（既定 `2097152` バイト = 2 MiB）を上限として JVM 内バッファに保持する。
上限を超えた分は破棄し、`RESULT` の対応する切り詰めフラグを `1` にする。

`RESULT` の `memory` は、常駐 JVM 内で実行スレッドが確保した**累積アロケーション量（バイト）** で、`com.sun.management.ThreadMXBean#getCurrentThreadAllocatedBytes` の差分で測る近似値である。
**ピーク使用メモリ（RSS）ではない**点に注意。正確なピークは別プロセス実行（将来のプロセスプール）でしか得られない。計測できない環境では `-1`。
なお、競プロのメモリ使用制限は基本的に 1024 MiB だが、本ランナーはこの値の判定・強制は行わない（計測値の参考提供のみ）。

### 6.2 隔離実行の判定（`requiresIsolation`）

`COMPILED` の `requiresIsolation` は、**コンパイル済みクラス（内部クラス・ラムダ含む全 `.class`）の定数プールを走査**し、常駐 JVM 内で実行すると共有 JVM を壊す/汚す/状態を残す API を参照している場合に `1` になる。
daemon はこのフラグが立った提出を、使い捨ての外部 JVM 経路へ振り分ける。
検出はソースの正規表現ではなくバイトコードに基づく（コメントや文字列中の誤検出が無い）。
直接参照のみを対象とし、リフレクション経由は対象外。検出対象（競プロ前提）:

- JVM 終了: `System.exit` / `Runtime.exit` / `Runtime.halt`
- 捕捉用に差し替えた標準ストリームの迂回: `FileDescriptor.in/out/err`
- 標準ストリーム自体の差し替え: `System.setIn/setOut/setErr`
- 次回実行へ漏れる JVM グローバル状態: `System.setProperty` 系 / `Locale.setDefault` / `TimeZone.setDefault` / `System.setSecurityManager`
- シャットダウンフック・外部プロセス: `Runtime.addShutdownHook` / `removeShutdownHook` / `Runtime.exec` / `ProcessBuilder`

なお、**スレッド生成（`Thread` / `Executors` 等）は検出対象から除外**している。
競プロで多用される大スタック再帰イディオム（`new Thread(..., 1<<26).start()` + `join()`）は join 済みで安全であり、これを隔離の遅い経路へ送らないための判断。
join しない残存スレッドという稀なリスクは受容する。

## 7. タイムアウトとプロセス寿命（プロトコル外・daemon 側の挙動）

以下はワイヤ上のメッセージではなく、daemon 側の運用ルール。

| 対象             | 既定タイムアウト | 超過時の挙動                                                       |
|----------------|----------|--------------------------------------------------------------|
| 起動（`READY` まで） | 10 秒     | JVM を SIGKILL し起動失敗                                          |
| `RUN`          | 10 秒     | JVM を SIGKILL し、当該要求を `timeLimitExceeded` 扱い。次の要求時に JVM を再起動 |
| `COMPILE`      | 30 秒     | 同上（コンパイルのタイムアウト）                                             |

無限ループ等で停止しない実行対象は、同一 JVM 内のスレッドとして動くため、daemon がプロセスごと強制終了する。

## 8. 往復の具体例

クラスディレクトリ `classes`、メインクラス `Main`、標準入力 `3 5\n` で実行する例（`id = 7`）。

要求:

```
RUN	7	Y2xhc3Nlcw==	TWFpbg==	MyA1Cg==
```

応答（受理通知）:

```
RUN
```

応答（結果。終了コード 0、12 ms、標準出力 `8\n`、標準エラー空、切り詰めなし、メモリ約 256 KiB）:

```
RESULT	7	0	12	OAo=		0	0	262144
```

---

ソース `Main.java` を `classes` へコンパイルする例（`id = 1`、成功・診断なし・隔離不要）。

要求:

```
COMPILE	1	TWFpbi5qYXZh	Y2xhc3Nlcw==
```

応答（`requiresIsolation = 0`、診断は空）:

```
COMPILED	1	0	0	
```

> 補足: 上記の Base64 は `b64("classes") = Y2xhc3Nlcw==`、`b64("Main") = TWFpbg==`、`b64("3 5\n") = MyA1Cg==`、
`b64("8\n") = OAo=`、`b64("Main.java") = TWFpbi5qYXZh`。空文字列の Base64 は空文字列。

## 9. 実装上の対応箇所

| 役割      | Java（`Dispatcher.java`）                   | TypeScript（`dispatcher.ts`） |
|---------|-------------------------------------------|-----------------------------|
| 起動通知    | `writeReady`（`READY` 出力）                  | 起動時に `READY` 行を待機           |
| 要求の符号化  | —                                         | `encodeField`（Base64）＋タブ連結  |
| 要求の解析   | `ProtocolParser` / `handleCompileCommand` | —                           |
| 応答の組み立て | `ProtocolWriter`（`writeResult` 等）         | —                           |
| 応答の解析   | —                                         | `handleDispatcherResponse`  |
| 相関 ID   | 受信した `id` をそのまま応答へ                        | `nextRequestId` を採番         |
