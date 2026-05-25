# shared

`runner` と `userscripts` の両方から使う TypeScript 共通ライブラリです。ワークスペース名は `@atcoder-tools/shared` です。

## モジュール一覧

| ファイル | 内容 |
|----------|------|
| `atcoder-url.ts` | 問題 URL の解析・生成、提出一覧 URL、提出詳細 URL |
| `local-runner.ts` | Local Runner HTTP API の型、リクエストビルダー、`toEasyTestStatus` |
| `easy-test-judge.ts` | Easy Test 互換の出力比較（trim / split / 誤差許容） |
| `java-transform.ts` | Java ソースの Main 化・DEBUG 無効化など |
| `json.ts` | `safeJsonParse`、`parseStoredObject`、`mergeWithDefaults` |
| `query.ts` | `buildQueryString` |
| `utils.ts` | `normalizeNewlines` |
| `async.ts` | `sleep` |
| `types.ts` | `AtCoderTaskId` など |

## 利用例

```ts
import {
	parseAtCoderTaskUrl,
	buildAtCoderSubmissionsQuery,
	buildLocalRunnerRunRequest,
	evaluateEasyTestOutput,
	modifyJavaCode,
	mergeWithDefaults,
} from "@atcoder-tools/shared";
```

## 設計方針

- **ここに置くもの**: runner と userscript の両方が必要とするロジック（URL、ジャッジ、Local Runner プロトコル、Java 変換、設定 JSON）
- **ここに置かないもの**: DOM 操作、Tampermonkey UI、CLI のログ表示、JVM 常駐プロセスなど環境依存の処理

`userscripts` のビルドでは Bun の alias `@shared` でこのパッケージをバンドルします。`runner` は workspace 依存として import します。
