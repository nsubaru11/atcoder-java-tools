# Java Code Submitter

AtCoder で Java を使用する際のコード提出作業を自動化・効率化し、提出ミスを減らすための支援 UserScript です。

## 概要

Java 提出時に必要となる `public class Main` への書き換えや、デバッグ用コードの除去といった定型作業を自動化します。ローカルでの開発コードをそのまま貼り付けて提出ボタンを押すだけで、コンパイルエラーや余計な出力を防いだ状態で提出が行われます。

## 主な機能

- **Compiler API変換**: LocalRunnerのjavac構文木・シンボル解析により、対象クラス、コンストラクタ、自己参照だけを安全に`Main`化します。
- **ライブラリ自動解決**: importを書かずに使用した`FastScanner`や`UnionFind`も、自動importして必要な依存だけをインラインします。
- **デバッグ無効化**: mainクラスのboolean `DEBUG`フィールドだけを`false`へ変更します。
- **提出ショートカット**: キーボードショートカットを使用して、マウス操作なしで提出を完了させることが可能です。

## インストール

[Tampermonkey に追加する](https://raw.githubusercontent.com/nsubaru11/atcoder-java-tools/main/userscripts/JavaCodeSubmitter/dist/JavaCodeSubmitter.user.js)

Compiler API変換には`http://localhost:8080`のLocalRunnerが必要です。利用できない場合は従来の字句変換へフォールバックします。
