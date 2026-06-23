# runner

AtCoder 向けの **ローカル Java 実行** と **CLI**（`test` / `submit` / `localtest` / `run` / `tomain` / `serve` / `stop`）です。
Bun + TypeScript で実装し、Java 側は常駐 `Dispatcher`（インプロセス javac ＋ 実行）と連携します。

## 構成

```text
tools/runner/
├── package.json
├── src/
│   ├── cli/           # test / submit / 短縮表記、AtCoder HTTP、サンプルジャッジ
│   ├── daemon/        # server.ts(HTTP API) / dispatcher.ts(常駐JVM連携) / compiler.ts(javac キャッシュ)
│   ├── config.ts      # 設定
│   ├── utils.ts       # ログ・整形
│   └── types/         # 型定義
├── bin/               # test.cmd / submit.cmd、起動スクリプト
└── java/              # README + src/（Dispatcher ほか常駐 JVM のクラス群・PROTOCOL.md・WarmUp.java）
```

`@atcoder-tools/shared` から URL 生成・Local Runner リクエスト・Easy Test ジャッジを利用しています。CLI のサンプル判定は
userscript の AtCoder Easy Test for Java と同じ `evaluateEasyTestOutput` です。

## 前提条件

- Bun
- Java / javac
- WSL で runner を使う場合は WSL 側にも Bun と JDK

## コマンド

| コマンド                                        | 説明                                                       |
|---------------------------------------------|----------------------------------------------------------|
| `test <taskScreenName> <sourceFile>`        | AtCoder のサンプルをローカル実行し AC/WA 判定（**DEBUG=true**）           |
| `test <task>` / `submit [-f] <task>`        | **短縮表記**。フォルダからコンテストを推定（例: `test d` → `abc463_d D.java`） |
| `submit [-f] <taskScreenName> <sourceFile>` | 全サンプル AC 後に提出（`-f` で強制提出。提出は **DEBUG=false**）            |
| `localtest <sourceFile> [testDir]`          | `.in`/`.out` を自動検出しオフライン実行・判定（**DEBUG=true**）            |
| `run <sourceFile> [inputFile]`              | 1 回だけ実行して出力表示（期待出力なし・`inputFile` 省略可・**DEBUG=true**）     |
| `tomain <sourceFile> [outFile]`             | 提出用 `Main.java` に変換して書き出し（**DEBUG=false**。`-f` で上書き）     |
| `serve`                                     | Local Runner サーバーだけ先に起動して ready まで待つ                     |
| `stop`                                      | Local Runner サーバーを停止（graceful shutdown）                  |

`taskScreenName` は URL の `/tasks/` 以降そのまま（例: `abc448_d`）。`contestId` は最後の `_` より前から自動解決します。

#### 短縮表記（フォルダからコンテスト推定）

`test` / `submit` に**引数を 1 つだけ**渡すと短縮表記になります。
`test d` は、カレントの上位階層にある `ABC463` のようなフォルダ名からコンテスト（小文字化して `abc463`）を、引数の記号からタスク（`abc463_d`）とソース（`D.java`）を解決し、`test abc463_d D.java` と同等に動きます。

- 記号は**大小無視**（`d` = `D`）。コンテスト名は URL に合わせ**小文字化**。
- 末尾の数字は**ファイル変種**扱い: `test d1` → `D1.java` を、問題 `d`（`abc463_d`）のサンプルでテスト（AtCoder のタスク記号は A〜H と Ex のみで数字付きは無いため）。
- コンテストフォルダは `ABC463` / `typical90` のような「英字＋数字」を採用。範囲フォルダ `ABC451~475` や `src` は無視。当てはまらない場合はフル指定（2 引数）で。
- ソースは**カレントディレクトリ**から探します（例の構成では `ABC463/src` で実行）。

`test` / `submit` / `localtest` / `run` は、Local Runner サーバーが未起動なら自動起動します（新しい「Local Runner」コンソール窓が開き、サーバーログがリアルタイム表示）。`serve` で事前に温めておくと初回が速くなります。

### DEBUG の扱い

ソース中の `DEBUG = true` は、`submit` / `tomain`（提出物）では `false` に固定し、`test` / `localtest` / `run`（ローカル実行）では `true` のまま実行します。デバッグ出力を `System.err` に出しておけば、判定（stdout 比較）に影響せず確認できます。

### 実行時間の警告

各サンプルや `run` の実行時間が **500ms** を超えると黄色で警告します（`NO_COLOR=1` で色無効）。

### 実行例

```powershell
cd tools/runner
bun install

# （任意）サーバーを先に起動。test 等を打てば自動起動するので必須ではない
.\bin\serve.cmd

# AtCoder サンプルでテスト
.\bin\test.cmd abc448_d D.java

# ローカルの .in/.out でテスト（オフライン）
.\bin\localtest.cmd D.java

# 1 回だけ実行（入力ファイルあり / なし）
.\bin\run.cmd D.java sample-1.in
.\bin\run.cmd D.java

# 提出（要セッション）
.\bin\submit.cmd abc448_d D.java

# サーバー停止
.\bin\stop.cmd
```

PATH 登録済みなら任意ディレクトリから `test` / `localtest` / `run` / `serve` / `stop` を実行できます（下記「PATH に登録」）。

`package.json` から:

```powershell
cd tools
bun --cwd runner run serve
bun --cwd runner run test abc448_d D.java
bun --cwd runner run localtest D.java
```

## 環境変数

| 変数                               | 説明                               | 既定値                      |
|----------------------------------|----------------------------------|--------------------------|
| `LOCAL_RUNNER_URL`               | Local Runner API                 | `http://localhost:8080`  |
| `LOCAL_RUNNER_PORT`              | 待受ポート                            | `8080`                   |
| `LOCAL_RUNNER_INPROCESS_COMPILE` | `0` で常駐javacを無効化し外部javacにフォールバック | 有効                       |
| `LOCAL_RUNNER_START_TIMEOUT_MS`  | auto-start の ready 待ちタイムアウト(ms)  | `60000`                  |
| `ATCODER_RUNNER_AUTOSTART`       | `0` で auto-start を無効化（常駐運用に切替時）  | 有効                       |
| `ATCODER_JAVA_VER`               | auto-start で渡す Java バージョン        | `24`                     |
| `ATCODER_WSL_DISTRO`             | auto-start で使う WSL ディストリ         | 既定ディストリ                  |
| `ATCODER_RUNNER_DIR_WSL`         | WSL内の `tools/runner` パス（明示時）     | wslpath で自動導出            |
| `ATCODER_COOKIE`                 | 提出用 Cookie 全体                    | —                        |
| `ATCODER_SESSION`                | `REVEL_SESSION` の値のみ             | —                        |
| `ATCODER_SESSION_FILE`           | セッションファイル                        | `~/.atcoder/session.txt` |

## セッションファイル例

```powershell
New-Item -ItemType Directory -Force "$HOME\.atcoder" | Out-Null
Set-Content -Path "$HOME\.atcoder\session.txt" -Value "<REVEL_SESSIONの値>" -Encoding UTF8
```

## ビルド

CLI のソースを変更したら **`bun run build`**（typecheck ＋ CLI の exe 化）を実行してください。`bin/_runner.cmd` はこの exe があれば使い、無ければ `bun src` にフォールバックします。

```powershell
cd tools/runner
bun run build        # = typecheck + build:cli:win
```

Local Runner（サーバー）は単一バイナリ化しません。`bin/start-local-runner.sh` 経由で WSL 上の `bun ./src/daemon/server.ts`を実行します（`serve` や `test` 等の auto-start から自動起動）。
Java のコンパイルは外部 `javac` を都度起動せず **常駐Dispatcher 内の javac（インプロセス）** で行うため高速です。`Dispatcher.class` はソース未変更ならキャッシュを再利用します。

## PATH に登録（任意）

```powershell
powershell -File ".\bin\install-submit-test-path.ps1"
```

以後、任意ディレクトリから `test` / `submit` を実行できます。短縮表記は**問題フォルダ**で実行します（コンテストをフォルダから推定するため）。

```powershell
cd "C:\...\AtCoder\ABC\ABC451~475\ABC463\src"
test d            # = test abc463_d D.java
submit d          # = submit abc463_d D.java
```

## 注意

- カスタム入力は `run <sourceFile> [inputFile]` で実行可能（`inputFile` 省略で空標準入力）
- 色付きログは ANSI。`NO_COLOR=1` で無効化
- `java/README.md` は Java 常駐側の補足（本 README の対象外）

## 関連ドキュメント

- [tools/README.md](../README.md)
- [shared/README.md](../shared/README.md)
- [userscripts/README.md](../userscripts/README.md)（ブラウザ側 Easy Test）
