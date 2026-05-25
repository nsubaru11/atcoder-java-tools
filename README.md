# tools

AtCoder 向けの補助ツールを Bun ワークスペースで管理しています。

## ワークスペース構成

```text
tools/
├── package.json          # workspaces: shared, runner, userscripts
├── bun.lock
├── tsconfig.base.json
├── shared/               # @atcoder-tools/shared
├── userscripts/          # @atcoder-tools/userscripts
└── runner/               # @atcoder-tools/runner
```

## shared

runner と userscripts の両方が使うコードです。詳細は [shared/README.md](./shared/README.md) を参照してください。

主なモジュール:

- AtCoder URL・提出一覧クエリ (`atcoder-url.ts`)
- Local Runner API 型とリクエスト (`local-runner.ts`)
- Easy Test 互換ジャッジ (`easy-test-judge.ts`)
- Java ソース変換 (`java-transform.ts`)
- JSON 設定の読み込み (`json.ts`)

```ts
import {parseAtCoderTaskUrl, evaluateEasyTestOutput} from "@atcoder-tools/shared";
```

## userscripts

TypeScript で開発し、Bun で Tampermonkey 用の単一 `.user.js`
にバンドルします。詳細は [userscripts/README.md](./userscripts/README.md) を参照してください。

```powershell
cd tools
bun --cwd userscripts run typecheck
bun --cwd userscripts run build
bun --cwd userscripts run watch
```

## runner

サンプルケースのローカル実行 (`test`) と提出 (`submit`) を行う CLI と、常駐 Local Runner HTTP
サーバーです。詳細は [runner/README.md](./runner/README.md) を参照してください。

```powershell
cd tools
bun --cwd runner run typecheck
bun --cwd runner run test abc001_a A.java
```

## TypeScript の方針

- パッケージマネージャは **Bun**（`tools/bun.lock`）
- `@ts-nocheck` / `@ts-ignore` は使わない
- 共通設定は `tsconfig.base.json`
- `userscripts/dist/*.user.js` は生成物。`src/main.ts` を編集して再ビルドする

## 変更後の確認

```powershell
cd tools
bun install
bun --cwd userscripts run typecheck
bun --cwd userscripts run build
bun --cwd runner run typecheck
```
