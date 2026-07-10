# runner

AtCoder 向けの **ローカル Java 実行** と **CLI**（`test` / `submit` / `toclip` / `localtest` / `run` / `tomain` / `serve` / `stop`）です。
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

| コマンド                                                           | 説明                                                                                                  |
|----------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `test <taskScreenName> <sourceFile>`                           | AtCoder のサンプルをローカル実行し AC/WA 判定（**DEBUG 既定 true**）                                                   |
| `test <task>` / `submit [-f] <task>`                           | **短縮表記**。フォルダからコンテストを推定（例: `test d` → `abc463_d D.java`）                                            |
| `submit [-f] <taskScreenName> <sourceFile>`                    | 全サンプル AC 後に提出（`-f` で強制提出。提出は **DEBUG=false**）                                                       |
| `localtest <sourceFile> [testDir]`                             | `.in`/`.out` を自動検出しオフライン実行・判定（**DEBUG 既定 true**）                                                    |
| `run <sourceFile> [inputFile]`                                 | 1 回だけ実行して出力表示（期待出力なし・`inputFile` 省略可・**DEBUG 既定 true**）                                             |
| `crosscheck <actualSourceFile> <expectedSourceFile> [testDir]` | `.in` を入力に2つのコードを実行し標準出力を突き合わせ（`.out` は不要。testDir は actual 側から自動探索。expected 側が異常終了したケースは比較せずそのまま報告） |
| `tomain <sourceFile> [outFile]`                                | 提出用 `Main.java` に変換して書き出し（**DEBUG=false**。`-f` で上書き）                                                |
| `toclip <sourceFile>` / `toclip <task>`                        | 提出用ソースをクリップボードへコピー（**DEBUG=false**。短縮例: `toclip d` → `D.java`）                                  |
| `serve`                                                        | Local Runner サーバーだけ先に起動して ready まで待つ                                                                |
| `stop`                                                         | Local Runner サーバーを停止（graceful shutdown）                                                             |
| `status`                                                       | Local Runner サーバーの稼働状況を表示（uptime・Java・dispatcher・キャッシュ等。稼働中=0/停止中=1。auto-start はしない）                |

`taskScreenName` は URL の `/tasks/` 以降そのまま（例: `abc448_d`）。`contestId` は最後の `_` より前から自動解決します。

### `lib.*` の自動バンドル

提出前処理はTSの正規表現ではなく、常駐JVM内のJava Compiler API（`JavacTask` / `Trees` / `SourcePositions`）を使います。型解決、Main対象、コンストラクタ・自己参照、DEBUGフィールド、package/import範囲をjavacの構文木とシンボルから決定し、生成後の単一ソースも再解析します。

解答では通常のJavaコードとして競プロライブラリをimportできます。

```java
import lib.ds.UnionFind;
import lib.io.FastPrinter;
import lib.io.FastScanner;
```

`run` / `localtest` / `test` / `crosscheck` / `tomain` / `toclip` / `submit` は、実行前に`import lib.*`を検出し、`library/src/lib`から必要なクラスと推移的依存を単一ソースへ展開します。ログには`Bundled library classes: ...`として展開対象が表示されます。`patterns.*`は読む・写経する資料なので自動展開しません。

ライブラリは次の順で検索します。

1. `ATCODER_LIB_SRC`で指定された`src`ディレクトリ
2. 解答ファイルから上位へ探索した`library/src`

AtCoderリポジトリ直下にlibrary submoduleがあれば、通常は環境変数の設定は不要です。`import static lib...`、本文中の`lib.ds.UnionFind`のような完全修飾参照、バンドル後に単純名が衝突する型はエラーになります。

`import lib.io.*;`のようなワイルドカードimportでも、解答本文で実際に参照しているトップレベル型だけをインラインします。提出コードでは元のlibrary importを削除せず、`// import lib.io.*;`のようにコメントアウトして展開元を残します。

importを書かずに`FastScanner`や`UnionFind`を使用した場合も、単純名がlibrary内で一意ならCompiler APIがimportを補完してバンドルします。同名候補ではパッケージ階層が最短の標準APIを優先し、同順位が複数なら曖昧エラーで停止します。

ブラウザへ手動で貼り付ける提出コードは、クリップボードへ直接コピーできます。

```powershell
toclip d       # 短縮表記: カレントディレクトリの D.java
toclip D.java  # ファイルを明示
```

#### 短縮表記（フォルダからコンテスト推定）

`test` / `submit` / `toclip` に**引数を 1 つだけ**渡すと短縮表記になります。
`test d` は、カレントの上位階層にある `ABC463` のようなフォルダ名からコンテスト（小文字化して `abc463`）を、引数の記号からタスク（`abc463_d`）とソース（`D.java`）を解決し、`test abc463_d D.java` と同等に動きます。

- 記号は**大小無視**（`d` = `D`）。コンテスト名は URL に合わせ**小文字化**。
- 末尾の数字は**ファイル変種**扱い: `test d1` → `D1.java` を、問題 `d`（`abc463_d`）のサンプルでテスト（AtCoder のタスク記号は A〜H と Ex のみで数字付きは無いため）。
- コンテストフォルダは `ABC463` / `typical90` のような「英字＋数字」を採用。範囲フォルダ `ABC451~475` や `src` は無視。当てはまらない場合はフル指定（2 引数）で。
- ソースは**カレントディレクトリ**から探します（例の構成では `ABC463/src` で実行）。
- `toclip`はコンテストIDを必要とせず、短縮記号からソースだけを解決します（`toclip d1` → `D1.java`）。

`test` / `submit` / `localtest` / `run` は、Local Runnerサーバーが未起動ならWSL上へ自動起動します。起動時にライブラリソースを`/dev/shm`へ同期して一度だけclass化し、解答のCompiler API解析はそのclasspathを使用します。提出用本文だけを同期済みsourceから取得するため、コンパイル・実行環境をWSLへ統一したままNTFS境界の反復コストを避けます。`serve`で事前に温めておくと初回が速くなります。ライブラリを編集した場合は`stop`→`serve`で同期し直してください。

ほぼすべての解答で使う`lib.io.FastScanner`と`lib.io.FastPrinter`は、起動時の提出変換ウォームアップでclass解決・依存解析・インライン処理まで先に実行します。`WarmUp.java`はJVMの実行系ウォームアップに専念させ、ライブラリ変換のウォームアップとは分離しています。

EasyTestの`precompile`要求は即座に`accepted`を返し、最後のエディタ変更から1.5秒のアイドル後に非同期実行します。連続変更はデバウンスされるため、JavaCodeSubmitterの貼り付け変換を常駐Dispatcherキュー上でブロックしません。

### オプション

オプションは位置引数の前後どちらに置いても構いません（各コマンドが自前で解釈します）。

| オプション                         | 対象コマンド                                         | 説明                                                               |
|-------------------------------|------------------------------------------------|------------------------------------------------------------------|
| `-f`, `--force`               | `submit` / `tomain`                            | submit: サンプルが非 AC でも提出する / tomain: 既存の出力ファイルを上書きする               |
| `-d`, `--debug[=true\|false]` | `test` / `localtest` / `run`                   | ソースの DEBUG ブロックの有効/無効を上書き（既定は有効）。`-d` だけなら有効、`--debug=false` で無効 |
| `--full`                      | `test` / `localtest` / `submit` / `crosscheck` | WA 差分を行数で折りたたまず**全行表示**する（`--max-lines` より優先）                    |
| `--wa-only`                   | `test` / `localtest` / `submit` / `crosscheck` | WA 差分のうち**不一致行（×）だけ**を抽出して表示する（行番号は元のまま保持）                       |
| `--max-lines=N`               | `test` / `localtest` / `submit` / `crosscheck` | WA 差分の折りたたみ行数を `N` に変更する（既定 20）                                  |
| `--time-limit=N`              | `localtest` / `run` / `crosscheck`             | 実行時間警告のしきい値に使う制限(ms)。80%超で黄、制限以上で赤（既定 2000。表示のみで実行は打ち切らない）       |

```powershell
# DEBUG を切って（提出と同じ条件で）ローカル実行
.\bin\test.cmd --debug=false abc448_d D.java
.\bin\run.cmd -d=false D.java

# WA 差分を全行表示 / 不一致行だけ抽出 / 行数指定
.\bin\localtest.cmd --full D.java
.\bin\test.cmd --wa-only abc448_d D.java
.\bin\test.cmd --max-lines=50 abc448_d D.java
```

各サンプルは**実行が終わるたびに逐次表示**され、最後に集計（`Summary:`）を出します。

### DEBUG の扱い

ソース中の `DEBUG = true` は、`submit` / `tomain` / `toclip`（提出物）では `false` に固定し、`test` / `localtest` / `run`（ローカル実行）では既定で `true` のまま実行します。デバッグ出力を `System.err` に出しておけば、判定（stdout 比較）に影響せず確認できます。

`test` / `localtest` / `run` は `-d/--debug=false` で DEBUG を切って実行でき、提出と同じ条件での確認に使えます。`submit` / `tomain` / `toclip` は提出物のため常に `false`（上書き不可）。

### 実行時間の警告

`test` / `submit` は問題ページから**実行時間制限**を取得し（サンプルと一緒にキャッシュ）、exec 表示を**制限の 80% 超で黄色、制限以上で赤**にします（例: 2 sec の問題 → 1600ms 超で黄、2000ms 以上で赤）。実行前に `Time limit: 2000ms` のように制限も表示します。

制限が分からない `localtest` / `run` / `crosscheck` は、AtCoder で最も一般的な 2 sec を仮の制限として**1600ms 超で黄色、2000ms 以上で赤**です。`--time-limit=3000` のように制限(ms)を指定すれば、その値を基準に test/submit と同じしきい値（80%で黄、100%で赤）になります。

いずれも表示上の警告で、実行自体は従来どおり最大 10 秒まで走ります（TLE 判定の打ち切りは変えません）。ローカルはウォームアップ済み JVM で本番より速く出やすいため、あくまで目安です（`NO_COLOR=1` で色無効）。

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

PATH 登録済みなら任意ディレクトリから `test` / `localtest` / `run` / `serve` / `stop` / `status` を実行できます（下記「PATH に登録」）。

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
| `LOCAL_RUNNER_BACKEND`           | Windowsで`native`を明示する診断用上書き        | `wsl`                    |
| `LOCAL_RUNNER_BUN`               | native起動に使うBunコマンド                  | `bun`                    |
| `ATCODER_RUNNER_AUTOSTART`       | `0` で auto-start を無効化（常駐運用に切替時）  | 有効                       |
| `ATCODER_JAVA_VER`               | auto-start で渡す Java バージョン        | `24`                     |
| `ATCODER_WSL_DISTRO`             | auto-start で使う WSL ディストリ         | 既定ディストリ                  |
| `ATCODER_RUNNER_DIR_WSL`         | WSL内の `tools/runner` パス（明示時）     | wslpath で自動導出            |
| `ATCODER_LIB_SRC`                | 競プロライブラリの`src`ディレクトリ          | 上位階層の`library/src`を探索    |
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

Local Runner（サーバー）は単一バイナリ化しません。通常は`bin/start-local-runner.sh`経由でWSL上の`bun ./src/daemon/server.ts`を実行します（`serve`や`test`等のauto-startから自動起動）。
Java のコンパイルは外部 `javac` を都度起動せず **常駐Dispatcher 内の javac（インプロセス）** で行うため高速です。`Dispatcher.class` はソース未変更ならキャッシュを再利用します。

## PATH に登録（任意）

```powershell
powershell -File ".\bin\install-path.ps1"
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
