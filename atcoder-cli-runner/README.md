# AtCoder CLI Runner

`test` / `submit` CLI と WSL 常駐ローカルランナーを 1 つにまとめた実行ツールです。

## Commands

- `test <taskScreenName> <sourceFile>`
	- 問題ページのサンプルを取得し、`AtCoderEasyTestForJava` と同じ比較ロジック（trim + split）で判定します。
- `submit <taskScreenName> <sourceFile>`
	- `test` を先に実行し、全サンプル AC の場合のみ提出します。
	- 提出後は最終結果（AC/WA/RE/TLE/MLE/CE など）までポーリングします。

実行エントリは `bin/test.cmd` / `bin/submit.cmd` です。
両者は `bin/run-atcoder-cli.cmd` を経由して `cli/atcoder-submit-cli.mjs` を呼び出します。

`taskScreenName` は `/tasks/` の後ろそのまま（例: `abc448_d`, `masters2026_qual_b`）を指定してください。
`contestId` は `taskScreenName` の最後の `_` より前で解決します。

## Environment Variables

- `LOCAL_RUNNER_URL`
	- Local Runner API URL。既定値: `http://localhost:8080`
- `ATCODER_COOKIE`
	- 提出時に使う Cookie ヘッダー全体（例: `REVEL_SESSION=...;`）
- `ATCODER_SESSION`
	- `REVEL_SESSION` の値のみを入れる簡易指定
- `ATCODER_SESSION_FILE`
	- セッションファイルのパス。未指定時は `~/.atcoder/session.txt` を自動で読みます。
	- ファイル内容は `REVEL_SESSION=...` 形式または値のみのどちらでも可。

## Quick Start

```powershell
# 1) Local Runner を起動
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "C:\Users\20051\Projects\IntelliJ IDEA\AtCoder\tools\atcoder-cli-runner\bin\start-local-runner.ps1" 24

# 2) テスト
"C:\Users\20051\Projects\IntelliJ IDEA\AtCoder\tools\atcoder-cli-runner\bin\test.cmd" abc448_d D.java

# 3) 提出（ATCODER_SESSION か ATCODER_COOKIE が必要）
"C:\Users\20051\Projects\IntelliJ IDEA\AtCoder\tools\atcoder-cli-runner\bin\submit.cmd" abc448_d D.java
```

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

`D.java` のような短いファイル名は、まずカレントディレクトリ相対で解決し、見つからない場合はカレントディレクトリ配下を再帰探索して一意に見つかったときのみ採用します。
複数候補が見つかった場合は、曖昧エラーとして候補一覧を表示します。

## Notes

- カスタム入力は非対応です。
- 色表示は ANSI を使います。`NO_COLOR=1` で無効化できます。

## 最小構成（運用に必要なファイル）

- `tools/atcoder-cli-runner/cli/atcoder-submit-cli.mjs`
- `tools/atcoder-cli-runner/runner/local-runner-server.js`
- `tools/atcoder-cli-runner/runner/src/Dispatcher.java`
- `tools/atcoder-cli-runner/bin/test.cmd`
- `tools/atcoder-cli-runner/bin/submit.cmd`
- `tools/atcoder-cli-runner/bin/start-local-runner.ps1`
- `tools/atcoder-cli-runner/bin/start-local-runner.sh`
- `tools/atcoder-cli-runner/bin/set-atcoder-session.ps1`
- `tools/atcoder-cli-runner/bin/install-submit-test-path.ps1`

## Session File Example

```powershell
New-Item -ItemType Directory -Force "$HOME\.atcoder" | Out-Null
Set-Content -Path "$HOME\.atcoder\session.txt" -Value "<REVEL_SESSIONの値>" -Encoding UTF8
```

この設定があると、`submit` 実行時に自動で読み込みます。
