# AtCoder Custom Default Submissions

AtCoder の提出一覧ページにおいて、自分好みのフィルタリング条件をデフォルトとして自動的に適用する UserScript です。

## 概要

提出一覧ページ（`submissions`）を開いた際、通常は全言語・全結果が表示されますが、このスクリプトを使用することで「特定の言語のみ」「AC
のみ」といった条件が選択された状態から開始できます。コンテスト中のデバッグや過去問練習時の確認作業を効率化します。

## 主な機能

- **フィルタ自動適用**: ページ遷移時に言語、ジャッジ結果（AC/WA等）、問題、ユーザーなどの絞り込み条件を自動でセットします。
- **ソート順の維持**: 提出日時の昇順・降順など、任意の並び替え順を初期状態として指定可能です。
- **柔軟なカスタマイズ**: `src/main.ts` 内の設定値を書き換えることで、用途に合わせた挙動に調整できます。

## インストール

[Tampermonkey に追加する](https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderCustomDefaultSubmissions/dist/AtCoderCustomDefaultSubmissions.user.js)
