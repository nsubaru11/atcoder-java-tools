# AtCoder Markdown Copier

AtCoder の問題文を Markdown 形式でコピーし、ノート作成や解説記事の執筆をサポートする UserScript です。

## 概要

問題ページの内容を Markdown に変換してクリップボードにコピーします。単純なテキストコピーとは異なり、数式やコードブロックを適切な
Markdown 記法で保持します。

## 主な機能

- **一括コピー（All Copy）**: 問題タイトル、URL、本文、制約、入出力形式をまとめて一つの Markdown
  文書としてコピーします。※入出力例は除外される設定になっています。
- **セクション別コピー**: 「問題文」「制約」などの各見出し横にあるボタンから、必要な箇所だけをピンポイントでコピーできます。
- **数式・コードブロック対応**: AtCoder 独自の `<var>` タグを `$...$` に変換し、入出力例などの `pre` タグをコードフェンス（
  ` ```text `）で囲います。

## インストール

[Greasy Fork からインストール](https://update.greasyfork.org/scripts/580283/AtCoder%20Markdown%20Copier.user.js)
