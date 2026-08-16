# AtCoder Widen Container

AtCoder のページ中央コンテナの幅を指定値に変更する UserScript です。

## 概要

AtCoder の標準レイアウトでは画面幅に対してコンテンツの最大幅が制限されます。このスクリプトは
`#main-container` に指定した幅を適用し、広い画面でもコンテンツを見やすく表示します。

## 主な機能

- **幅のカスタマイズ**: 初期値は `50%` で、`50%` や `1200px` など CSS の幅の値を設定できます。
- **設定の保存**: Tampermonkey のユーザースクリプトメニューから変更した幅を保存します。
- **ちらつきの抑制**: スタイルを `document-start` で登録し、ページ生成後に幅が変わって見える現象を抑えます。

## インストール

[Tampermonkey に追加する](https://raw.githubusercontent.com/nsubaru11/atcoder-java-tools/main/userscripts/AtCoderWidenContainer/dist/AtCoderWidenContainer.user.js)
