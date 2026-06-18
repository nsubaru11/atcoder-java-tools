# runner

AtCoder 向けの **ローカル Java 実行** と **CLI**（`test` / `submit`）です。Bun + TypeScript で実装し、Java 側は常駐
`Dispatcher` と連携します。

## 構成

```text
tools/runner/
├── package.json
├── src/
│   ├── cli/           # test / submit、AtCoder HTTP、サンプルジャッジ
│   ├── daemon/        # Local Runner HTTP API (server.ts)
│   ├── compiler/      # javac キャッシュ・実行
│   └── shared/        # runner 専用の設定・ログ（@atcoder-tools/shared とは別）
├── bin/               # test.cmd / submit.cmd、起動スクリプト
└── java/src/          # Dispatcher.java, WarmUp.java
```

`@atcoder-tools/shared` から URL 生成・Local Runner リクエスト・Easy Test ジャッジを利用しています。CLI のサンプル判定は
userscript の AtCoder Easy Test for Java と同じ `evaluateEasyTestOutput` です。

## 前提条件

- Bun
- Java / javac
- WSL で runner を使う場合は WSL 側にも Bun と JDK

## コマンド

| コマンド                                        | 説明                                             |
|---------------------------------------------|------------------------------------------------|
| `test <taskScreenName> <sourceFile>`        | サンプルを Local Runner で実行し、Easy Test 互換で AC/WA 判定 |
| `submit [-f] <taskScreenName> <sourceFile>` | 全サンプル AC 後に提出（`-f` で強制提出）                      |

`taskScreenName` は URL の `/tasks/` 以降そのまま（例: `abc448_d`）。`contestId` は最後の `_` より前から自動解決します。

### 実行例

```powershell
cd tools/runner
bun install

# Local Runner 起動 (Windows / PowerShell 7)
pwsh -File .\bin\start-local-runner.ps1 24

# テスト
.\bin\test.cmd abc448_d D.java

# 提出（要セッション）
.\bin\submit.cmd abc448_d D.java
```

`package.json` から:

```powershell
cd tools
bun --cwd runner run runner
bun --cwd runner run test abc448_d D.java
bun --cwd runner run submit abc448_d D.java
```

## 環境変数

| 変数                     | 説明                   | 既定値                      |
|------------------------|----------------------|--------------------------|
| `LOCAL_RUNNER_URL`     | Local Runner API     | `http://localhost:8080`  |
| `LOCAL_RUNNER_PORT`    | 待受ポート                | `8080`                   |
| `ATCODER_COOKIE`       | 提出用 Cookie 全体        | —                        |
| `ATCODER_SESSION`      | `REVEL_SESSION` の値のみ | —                        |
| `ATCODER_SESSION_FILE` | セッションファイル            | `~/.atcoder/session.txt` |

## セッションファイル例

```powershell
New-Item -ItemType Directory -Force "$HOME\.atcoder" | Out-Null
Set-Content -Path "$HOME\.atcoder\session.txt" -Value "<REVEL_SESSIONの値>" -Encoding UTF8
```

## 単一バイナリ化（CLI のみ）

CLI だけ高速起動用に単一 exe 化します（任意）。`bin/_runner.cmd` はこの exe があれば使い、無ければ `bun src` にフォールバックします。

```powershell
# CLI (Windows)
bun run build:cli:win
```

Local Runner（サーバー）は単一バイナリ化しません。`bin/start-local-runner.sh` 経由で WSL 上の `bun ./src/daemon/server.ts`
を実行します（`serve` コマンドや `test` 等の auto-start から自動起動）。

## PATH に登録（任意）

```powershell
powershell -File ".\bin\install-submit-test-path.ps1"
```

以後、任意ディレクトリから `test` / `submit` を実行できます。

## 注意

- カスタム入力テストは非対応（サンプルのみ）
- 色付きログは ANSI。`NO_COLOR=1` で無効化
- `java/README.md` は Java 常駐側の補足（本 README の対象外）

## 関連ドキュメント

- [tools/README.md](../README.md)
- [shared/README.md](../shared/README.md)
- [userscripts/README.md](../userscripts/README.md)（ブラウザ側 Easy Test）
