# runner/java — 常駐 Dispatcher（Java 側）

Local Runner の**実行バックエンド**です。
JVM を 1 つ起動しっぱなしにして、TS デーモン（`runner/src/daemon`）から標準入出力経由でコマンドを受け、**インプロセス javac でのコンパイル**と**コンパイル済みクラスの実行**を代行します。
毎回 `javac`/`java` を起動するコストを無くすのが目的です。

通信プロトコルの正典は [`src/PROTOCOL.md`](./src/PROTOCOL.md) です（ワイヤ形式・各メッセージ・メモリ/隔離フラグの意味）。

## クラス構成（責務）

責務ごとに分割し、依存は下向き（`protocol` が最下層で何にも依存しない）に揃えています。

| 層   | クラス                    | 役割                                                                                                              |
|-----|------------------------|-----------------------------------------------------------------------------------------------------------------|
| app | `Dispatcher`           | エントリポイント。`受信→解析→（必要なら受理通知）→実行→応答` の配線のみ                                                                         |
| 通信  | `MessageChannel`       | 行 IO ＋ 型付きメッセージ ⇄ 行 の変換（`ProtocolCodec` へ委譲）。`send(Response)` / `receive():ParseOutcome`                        |
| 変換  | `ProtocolCodec`        | 文字列・Base64・タブ・コマンド名を扱う唯一の場所。`parse` / `encode`（`ParseOutcome`/`ValidRequest`/`ProtocolError` を含む）               |
| 実行  | `Executor`             | 要求をサービスへ振り分ける薄いルーター（`handle(Request):Response`）                                                                 |
| 実行  | `JavaCompilerService`  | `ToolProvider` 経由のインプロセス・コンパイル専任                                                                                |
| 実行  | `ProgramRunner`        | 使い捨て `URLClassLoader` で隔離ロード＋リフレクションで `main` 実行。時間・出力・メモリ近似を収集                                                  |
| 実行  | `StandardStreamsGuard` | `System.in/out/err`・uncaught ハンドラ・CCL の退避/差し替え/復元を 1 か所に隔離する RAII                                               |
| 実行  | `BoundedCapture`       | 上限付きバイトバッファ（大量出力でメモリを食い潰さない）                                                                                    |
| 実行  | `IsolationAnalyzer`    | コンパイル済み `.class` の定数プールを走査し、隔離実行が要る危険 API 参照を検出（`requiresIsolation`）                                            |
| API | `Request`              | 受信メッセージ（sealed: `Ping`/`Run`/`Compile`）                                                                         |
| API | `Response`             | 送信メッセージ（sealed: `Ready`/`Pong`/`RunAck`/`Result`/`Compiled`/`ErrorResponse`）＋ `ExecutionResult`/`CompileResult` |
| —   | `WarmUp`               | 起動時に代表処理を走らせ JIT を温める専用クラス（`src/PROTOCOL.md` 対象外）                                                               |

## 設計上の要点

- **1 プロセス・1 スレッド・逐次**: 受信ループは次のコマンドが来るまでブロックし、1 件を最後まで処理してから次へ。提出コードの `main` はディスパッチャのメインスレッド上で**同期**実行されます。無限ループはこのスレッドごと止まるため、タイムアウト時は TS 側が JVM ごと SIGKILL します。
- **隔離（`requiresIsolation`）**: `System.exit`/`Runtime.halt`/`FileDescriptor.in,out,err`/`System.setIn,setOut,setErr`/グローバル状態変更/シャットダウンフック/外部プロセス起動を参照するコードは、共有 JVM を壊す/汚すため TS 側で使い捨て外部 JVM に振り分けます。**スレッド生成は除外**（競プロの大スタック再帰イディオムは join 済みで安全なため）。詳細は `src/PROTOCOL.md` 6.2。
- **メモリは近似**: `RESULT` の `memory` は実行スレッドの累積アロケーション量（`com.sun.management.ThreadMXBean`）で、ピーク RSS ではありません。詳細は `src/PROTOCOL.md` 6.1。
- **出力上限**: 既定 2 MiB（`LOCAL_RUNNER_CAPTURE_LIMIT_BYTES`）。超過分は破棄し切り詰めフラグを立てます。

## ビルド

このディレクトリの Java は **TS デーモンが起動時にまとめてコンパイル**します（`src/daemon/compiler.ts` の `compileDispatcher`、`src` 配下の `*.java` を対象に外部 `javac` で 1 回ビルドし、ソース未変更ならキャッシュ再利用）。手動で確認する場合:

```bash
javac -d /tmp/out "src/"*.java
```

Java 24 前提です（sealed interface・record パターン・`java.lang` の最新 API を使用）。
