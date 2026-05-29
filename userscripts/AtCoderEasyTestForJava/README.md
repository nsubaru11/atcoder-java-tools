# AtCoder Easy Test for Java

AtCoder の問題ページから直接、ローカル環境でのテスト実行と結果確認をシームレスに行うための Java 開発支援 UserScript です。

## 概要

ブラウザ上の問題文にあるサンプルケースを、ワンクリックでローカルの Java
実行環境へ送り、結果をブラウザにフィードバックします。エディタとブラウザを行き来して入力をコピー＆ペーストする手間を省き、競技プログラミングのサイクルを高速化します。

## 主な機能

- **サンプルテスト UI**: 各サンプル入出力の付近に「Test」ボタンを追加し、その場で実行結果を確認できます。
- **結果のインライン表示**: 実行結果（AC/WA/RE 等）や標準出力、エラーメッセージを問題ページ上に直接表示します。
- **ローカル連携**: 専用の [runner](../../runner/README.md) CLI と通信することで、実際のコード実行をローカル環境で安全に行います。

## インストール

[Tampermonkey に追加する](https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderEasyTestForJava/dist/AtCoderEasyTestForJava.user.js)

## 必要な環境

このスクリプトの動作には、ローカルで動作するテスト実行用 CLI が必要です。
詳細は [runner/README.md](../../runner/README.md) を参照してください。
