# AtCoder CLI Runner

`test` / `submit` CLI と常駐ローカルランナーをまとめた Bun + TypeScript 製の実行ツールです。

## 構成

```text
AtCoder/
└── tools/atcoder-cli-runner/
    ├── package.json
    ├── bun.lock
    ├── tsconfig.json
    ├── src/
    │   ├── types/index.ts
    │   ├── cli/
    │   │   ├── index.ts
    │   │   ├── commands.ts
    │   │   ├── atcoder.ts
    │   │   └── parser.ts
    │   ├── runner/
    │   │   ├── server.ts
    │   │   ├── compiler.ts
    │   │   └── dispatcher.ts
    │   └── shared/
    │       ├── config.ts
    │       └── utils.ts
    └── runner/src/
        ├── Dispatcher.java
        └── WarmUp.java
```

- `src/types/index.ts`: CLI と runner で共有する型定義。
- `src/cli`: `test` / `submit` のコマンド処理、AtCoder 通信、HTML パース。
- `src/runner`: ローカル HTTP API、javac コンパイルキャッシュ、`Dispatcher.java` との通信。
- `src/shared`: 環境変数、パス、ログ、色表示などの共通処理。
- `runner/src`: Java 側の常駐 dispatcher と warmup コード。既存 Java 実装は維持しています。

## 前提条件

- Bun
- Java / javac
- WSL runner のため、WSL 側にも Bun と JDK が必要です。

## Commands

- `test <taskScreenName> <sourceFile>`
	- 問題ページのサンプルを取得し、`AtCoderEasyTestForJava` と同じ比較ロジック（trim + split）で判定します。
- `submit [-f|--force] <taskScreenName> <sourceFile>`
	- `test` を先に実行し、全サンプル AC の場合のみ提出します。
	- `-f` / `--force` を付けるとサンプル非 AC でも提出します。
	- 提出後は最終結果（AC/WA/RE/TLE/MLE/CE など）までポーリングします。

実行エントリは `bin/test.cmd` / `bin/submit.cmd` です。
これらは直接 `src/cli/index.ts` を Bun で起動します。

`taskScreenName` は `/tasks/` の後ろそのまま（例: `abc448_d`, `masters2026_qual_b`）を指定してください。
`contestId` は `taskScreenName` の最後の `_` より前で解決します。

## Environment Variables

- `LOCAL_RUNNER_URL`
	- Local Runner API URL。既定値: `http://localhost:8080`
- `LOCAL_RUNNER_PORT`
	- Local Runner の待受ポート。既定値: `8080`
- `ATCODER_COOKIE`
	- 提出時に使う Cookie ヘッダー全体（例: `REVEL_SESSION=...;`）
- `ATCODER_SESSION`
	- `REVEL_SESSION` の値のみを入れる簡易指定
- `ATCODER_SESSION_FILE`
	- セッションファイルのパス。未指定時は `~/.atcoder/session.txt` を自動で読みます。
	- ファイル内容は `REVEL_SESSION=...` 形式または値のみのどちらでも可。

## Quick Start

```powershell
cd "C:\Users\20051\Projects\IntelliJ IDEA\AtCoder\tools\atcoder-cli-runner"
bun install

# 1) Local Runner を起動
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\bin\start-local-runner.ps1" 24

# 2) テスト
".\bin\test.cmd" abc448_d D.java

# 3) 提出（ATCODER_SESSION か ATCODER_COOKIE が必要）
".\bin\submit.cmd" abc448_d D.java
```

`package.json` の scripts から直接実行する場合:

```powershell
bun run runner
bun run test abc448_d D.java
bun run submit abc448_d D.java
```

## 単一バイナリ化 (CLI / Runner)

このツールは Bun の `--compile` で単一バイナリ化できます。CLI は Windows、Runner は WSL/Linux で別ビルドが必要です。
なお、JDK とセッション情報は引き続き外部で必要です（バイナリに埋め込みません）。

### CLI (Windows)

```powershell
bun run build:cli:win
```

`bin/atcoder-cli-runner.exe` が生成され、`bin/test.cmd` / `bin/submit.cmd` はこの exe を優先して実行します。

### Local Runner (WSL / Linux)

WSL 上で次を実行します。

```bash
bun run build:runner:linux
```

`bin/atcoder-local-runner` が生成され、`start-local-runner.sh` はこのバイナリを優先して起動します。
Bun を WSL に入れていない場合でも、Runner バイナリがあれば起動できます。
Runner バイナリは `tools/atcoder-cli-runner/bin` に置いたまま使ってください。
別の場所に移動する場合は `LOCAL_RUNNER_PROJECT_ROOT` で `tools/atcoder-cli-runner` のパスを指定してください。

## Run From Anywhere

`submit.cmd` / `test.cmd` をどこからでも呼ぶには、次を1回実行して `tools/atcoder-cli-runner/bin` を PATH に追加してください。

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "C:\Users\20051\Projects\IntelliJ IDEA\AtCoder\tools\atcoder-cli-runner\bin\install-submit-test-path.ps1"
```

以後は任意ディレクトリから実行できます。

```powershell
test abc448_d D.java
submit masters2026_qual_b B.java
```

## Session File Example

```powershell
New-Item -ItemType Directory -Force "$HOME\.atcoder" | Out-Null
Set-Content -Path "$HOME\.atcoder\session.txt" -Value "<REVEL_SESSIONの値>" -Encoding UTF8
```

この設定があると、`submit` 実行時に自動で読み込みます。

## Notes

- カスタム入力は非対応です。
- 色表示は ANSI を使います。`NO_COLOR=1` で無効化できます。
- 旧 `cli/atcoder-submit-cli.mjs` と `runner/local-runner-server.js` は TypeScript 分割に移行済みです。
