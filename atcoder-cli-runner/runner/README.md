# AtCoder Easy Test for Java Local Runner

WSL (Linux) 上で `AtCoderEasyTestForJava.user.js` のローカル実行 API を提供する補助サーバーです。

## 構成

- `../bin/start-local-runner.sh`
	- WSL ネイティブの起動スクリプトです。
- `../bin/start-local-runner.ps1`
	- Windows 側の実起動スクリプトです。WSL 起動と Windows legacy fallback を担当し、IDE 端末で `Ctrl+C` しやすい入口です。
- `local-runner-server.js`
	- HTTP API (`list` / `precompile` / `run`) を提供する Node.js サーバーです。
- `src/Dispatcher.java`
	- 常駐 JVM として動作し、最新の `Main.class` を動的ロードして `main` を実行します。

## 目的

従来の「毎回 `java Main` を起動する」方式では、JVM 起動コストがテスト体験のボトルネックになっていました。
この構成では以下を行います。

1. 実行環境を WSL に寄せ、Linux 側でプロセス・ファイル I/O を完結させる。
2. コンパイル成果物の配置先を `/dev/shm` に寄せ、ディスク待ちを極小化する。
3. `Dispatcher.java` を常駐させ、Node.js から stdin/stdout パイプで実行命令を送る。

## 前提条件

WSL 側に以下が必要です。

- `node`
- `java`
- `javac`

AtCoder の Java 24.0.2 に合わせる場合は、WSL 側の `~/.bashrc` などで `JAVA_HOME_24` を設定しておくと確実です。
`start-local-runner.sh` は `JAVA_HOME_<version>` → `JAVA_HOME` → `PATH` の順に使用します。
Linux 上で `JAVA_HOME` が Windows 形式のパスだった場合は自動的に無視し、WSL 側の `PATH` を優先します。
`SDKMAN!` を使っている場合は、起動時に `sdkman-init.sh` も自動で読み込みます。

## 起動方法

WSL から直接起動する場合:

```bash
bash ../bin/start-local-runner.sh 24
```

Windows から起動する場合:

```powershell
.\..\bin\start-local-runner.ps1 24
```

WSL が使えない、または WSL 側の `node` / `java` / `javac` が見つからない場合でも、`start-local-runner.ps1` は Windows 側の
`LOCAL_RUNNER_MODE=legacy` でサーバー起動を試みます。

## 主要な環境変数

- `LOCAL_RUNNER_DISPATCHER_SOURCE`
	- `Dispatcher.java` のソースパスを明示指定します。
	- 未指定時は `local-runner-server.js` と同じディレクトリの `Dispatcher.java`、次に `src/Dispatcher.java` の順で探索します。
- `LOCAL_RUNNER_MAX_LOG_FILE_SIZE_BYTES`
	- `local-runner.log` のローテーション閾値（バイト）です。既定値は `8388608`（8MiB）です。
- `LOCAL_RUNNER_CAPTURE_LIMIT_BYTES`
	- `Dispatcher` 側で保持する標準出力/標準エラーの上限（バイト）です。既定値は `2097152`（2MiB）です。

## 動作概要

- `precompile`
	- ソースコードを MD5 でハッシュし、`/dev/shm/atcoder-local-runner/compiled/<hash>` にコンパイルします。
- `run`
	- 既存のコンパイル結果を再利用し、常駐 `Dispatcher` に対して `RUN` コマンドを送ります。
- Windows legacy フォールバック
	- `start-local-runner.ps1` から起動した WSL ランナーが開始できなかった場合は、Windows
	  側で従来どおり「コンパイルキャッシュ + 毎回 `java` 起動」のモードに切り替わります。
- 互換性フォールバック
	- `FileDescriptor.in/out/err`、`System.exit(...)`、`Runtime.getRuntime().halt(...)` を含むコードは、常駐 JVM
	  と競合するため自動的に別 JVM 実行へ切り替えます。
- タイムアウト時
	- ハングした `Dispatcher` を破棄して自動再起動し、次回実行へ影響を残しません。

## 既知の注意点

- `System.exit()` を呼ぶコードは `Dispatcher` ごと終了させるため、その実行は失敗扱いになり、次回アクセス時に自動再起動されます。
- スレッドを自前で増やす特殊なコードは、常駐 JVM 方式と相性が悪い場合があります。
- AtCoder 向けの通常的な単一ファイル `Main.java` を前提に最適化しています。
