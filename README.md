# tools

AtCoder 用の補助ツール群です。

このディレクトリでは、UserScript、ローカルランナー、両者で共有する TypeScript コードを管理します。

## 構成

```text
tools/
	shared/
		src/
			async.ts
			atcoder-url.ts
			local-runner.ts
			query.ts
			types.ts
			index.ts
	userscripts/
		<ScriptName>/
			meta.json
			src/main.ts
			dist/<ScriptName>.user.js
		build.ts
		package.json
		tsconfig.json
	runner/
		src/
			cli/
			runner/
			shared/
			types/
		bin/
		runner/src/
		package.json
		README.md
```

## shared

`tools/shared` は、UserScript 側と runner 側の両方から使う共通コードです。

- `atcoder-url.ts`: AtCoder の contest/task URL 解析、submit URL 生成
- `local-runner.ts`: Local Runner API の request/response 型、status 変換、key 生成
- `async.ts`: `sleep`
- `query.ts`: query string 生成
- `types.ts`: 共通型

各プロジェクトからは `@shared/*` で参照します。

```ts
import {parseAtCoderTaskUrl} from "@shared/atcoder-url";
import {buildLocalRunnerRunRequest} from "@shared/local-runner";
```

## userscripts

UserScript は TypeScript で開発し、Bun の bundler で `.user.js` に変換します。

```text
tools/userscripts/<ScriptName>/src/main.ts
	-> tools/userscripts/<ScriptName>/dist/<ScriptName>.user.js
```

`meta.json` の `pairs` から UserScript metadata を生成し、ビルド時に `.user.js` の先頭へ付けます。
生成された `.user.js` は Prettier で整形し、コード部のインデントをタブに揃えます。
Tampermonkey / Violentmonkey には `dist/*.user.js` を登録してください。

### Commands

```powershell
cd tools/userscripts
bun install
bun run typecheck
bun run build
bun run watch
```

特定のスクリプトだけをビルドする場合:

```powershell
bun ./build.ts AtCoderHighlighter
```

## runner

`tools/runner` は Bun + TypeScript 製の CLI / Local Runner です。

- `src/cli`: `test` / `submit` コマンド
- `src/runner`: Local Runner HTTP API、Java コンパイル、Dispatcher 連携
- `src/shared`: runner 内部の設定、ログ、ファイル操作
- `runner/src`: Java 側の常駐 Dispatcher / WarmUp

詳細は [runner/README.md](./runner/README.md) を参照してください。

### Commands

```powershell
cd tools/runner
bun install
bun run typecheck
bun run runner
bun run test abc001_a A.java
bun run submit abc001_a A.java
```

## TypeScript 方針

- 依存管理と実行は基本的に Bun を使います。
- `package-lock.json` ではなく `bun.lock` を使います。
- `@ts-nocheck` / `@ts-ignore` は使わず、型定義や型ガードで解決します。
- UserScript と `build.ts` は `tools/userscripts/tsconfig.json` で確認します。
- `dist/*.user.js` は生成物です。直接編集せず、`src/main.ts` を編集して再ビルドしてください。

## Verification

変更後は最低限、次を確認します。

```powershell
cd tools/userscripts
bun run typecheck
bun run build

cd ../runner
bun run typecheck
```
