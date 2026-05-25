# userscripts

AtCoder 関連の UserScript を TypeScript で開発し、[Tampermonkey](https://www.tampermonkey.net/) 向けに配布します。

## 開発の流れ

1. `tools/userscripts/<ScriptName>/src/main.ts` を編集する（必要なら `@atcoder-tools/shared` を import）
2. `meta.json` で UserScript ヘッダ（`@match` など）を定義する
3. `bun run build` で `dist/<ScriptName>.user.js` を生成する
4. Tampermonkey に `dist/*.user.js` の URL を登録する

ソースは複数モジュール・shared 利用で問題ありません。配布物だけが 1 ファイルの `.user.js` になります。

```text
<ScriptName>/
├── meta.json
├── src/main.ts
└── dist/<ScriptName>.user.js   # 生成物（直接編集しない）
```

## コマンド

```powershell
cd tools
bun install
bun --cwd userscripts run typecheck
bun --cwd userscripts run build
bun --cwd userscripts run watch
```

特定スクリプトのみビルド:

```powershell
bun --cwd userscripts ./build.ts AtCoderHighlighter
```

## 型定義

- `types/userscript.d.ts` … `GM_*`、`unsafeWindow`、AtCoder ページ向け Window 拡張
- `tsconfig.json` … `**/src/**/*.ts` と `build.ts` を型チェック

## スクリプト一覧

### AtCoder Custom Default Submissions

提出一覧の絞り込み・並び替えのデフォルトを適用します。

- [インストール](https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderCustomDefaultSubmissions/dist/AtCoderCustomDefaultSubmissions.user.js)

### AtCoder Easy Test for Java

サンプル入出力のテストを簡単に行えるようにします（Java 向け拡張）。出力比較は `@atcoder-tools/shared` の
`evaluateEasyTestOutput` と runner CLI で共通です。

- [インストール](https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderEasyTestForJava/dist/AtCoderEasyTestForJava.user.js)
- ローカル実行: [runner/README.md](../runner/README.md)

### AtCoder Highlighter

問題文の数字・変数（KaTeX）と制限時間を強調表示します。

- [Greasy Fork](https://update.greasyfork.org/scripts/566471/AtCoder%20Highlighter.user.js)（更新 URL は meta.json を参照）

### AtCoder Listing Tasks

「問題」タブにホバーで各問題へ飛べるドロップダウンを表示します。

- [インストール](https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderListingTasks/dist/AtCoderListingTasks.user.js)

### AtCoder Rating Graph

レーティンググラフにパフォーマンスを重ねて表示します（旧 AtCoder Perf Graph）。

- [インストール](https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderRatingGraph/dist/AtCoderRatingGraph.user.js)

### Java Code Submitter

Java 提出の補助（Main/DEBUG 自動修正、折りたたみ、ショートカット）。変換ロジックは shared の `modifyJavaCode` を使用します。

- [インストール](https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/JavaCodeSubmitter/dist/JavaCodeSubmitter.user.js)

## 使い方（利用者向け）

1. Tampermonkey をインストールする
2. ブラウザで「サイトが JavaScript を使用できるようにする」を有効にする
3. 上記インストールリンクからスクリプトを追加する

## shared との関係

| スクリプト                           | shared の主な利用                          |
|---------------------------------|---------------------------------------|
| AtCoderEasyTestForJava          | Local Runner API、ジャッジ、query、JSON      |
| AtCoderCustomDefaultSubmissions | `parseAtCoderTaskUrl`、提出一覧クエリ、設定 JSON |
| JavaCodeSubmitter               | `modifyJavaCode`、設定 JSON              |
| その他                             | DOM 専用のため shared 未使用のものあり             |
