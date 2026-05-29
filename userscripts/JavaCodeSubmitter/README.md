# Java Code Submitter

AtCoder で Java を使用する際のコード提出作業を自動化・効率化し、提出ミスを減らすための支援 UserScript です。

## 概要

Java 提出時に必要となる `public class Main` への書き換えや、デバッグ用コードの除去といった定型作業を自動化します。ローカルでの開発コードをそのまま貼り付けて提出ボタンを押すだけで、コンパイルエラーや余計な出力を防いだ状態で提出が行われます。

## 主な機能

- **クラス名自動修正**: `public class MySolution` のような任意のクラス名を、AtCoder の制約である `public class Main` に自動置換します。
- **デバッグコードの除去**: 特定のコメントやメソッド（`DEBUG` 用など）を自動で除去または無効化し、提出コードをクリーンに保ちます。
- **提出ショートカット**: キーボードショートカットを使用して、マウス操作なしで提出を完了させることが可能です。

## インストール

[Tampermonkey に追加する](https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/JavaCodeSubmitter/dist/JavaCodeSubmitter.user.js)
