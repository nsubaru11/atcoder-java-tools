// ==UserScript==
// @name           AtCoder Widen Container
// @name:en        AtCoder Widen Container
// @namespace      https://github.com/nsubaru11/atcoder-java-tools/tree/main/userscripts
// @version        1.0.1
// @description    AtCoderのページ幅を広げるユーザースクリプト
// @description:en Widens the container width on AtCoder pages.
// @description:ja AtCoderのページ幅を広げるユーザースクリプト
// @author         nsubaru
// @license        MIT
// @homepageURL    https://github.com/nsubaru11/atcoder-java-tools/tree/main/userscripts/AtCoderWidenContainer
// @supportURL     https://github.com/nsubaru11/atcoder-java-tools/issues
// @match          https://atcoder.jp/*
// @grant          GM_addStyle
// @grant          GM_getValue
// @grant          GM_setValue
// @grant          GM_registerMenuCommand
// @run-at         document-start
// @icon           https://atcoder.jp/favicon.ico
// @updateURL      https://raw.githubusercontent.com/nsubaru11/atcoder-java-tools/main/userscripts/AtCoderWidenContainer/dist/AtCoderWidenContainer.user.js
// @downloadURL    https://raw.githubusercontent.com/nsubaru11/atcoder-java-tools/main/userscripts/AtCoderWidenContainer/dist/AtCoderWidenContainer.user.js
// ==/UserScript==

"use strict";
(() => {
	// AtCoderWidenContainer/src/main.ts
	var STORAGE_KEY = "containerWidth";
	var DEFAULT_WIDTH = "50%";
	function isValidWidth(value) {
		if (typeof value !== "string") return false;
		const trimmed = value.trim();
		return trimmed !== "" && CSS.supports("width", trimmed);
	}
	function readWidth() {
		const storedWidth = GM_getValue(STORAGE_KEY, DEFAULT_WIDTH);
		return isValidWidth(storedWidth) ? storedWidth.trim() : DEFAULT_WIDTH;
	}
	var currentWidth = readWidth();
	var hideStyle = document.createElement("style");
	hideStyle.textContent = `html { display: none !important; }`;
	document.documentElement.appendChild(hideStyle);
	var style = document.createElement("style");
	style.textContent = `
	#main-container {
		width: ${currentWidth} !important;
		max-width: 100% !important;
		transition: none !important;
	}
`;
	document.documentElement.appendChild(style);
	window.addEventListener("DOMContentLoaded", () => {
		if (document.documentElement.contains(hideStyle)) hideStyle.remove();
	});
	setTimeout(() => {
		if (document.documentElement.contains(hideStyle)) hideStyle.remove();
	}, 500);
	GM_registerMenuCommand("最大幅設定の変更", () => {
		const inputWidth = window.prompt("新しい幅設定を入力してください（例: 50%, 1200px）", currentWidth);
		if (inputWidth === null) return;
		const nextWidth = inputWidth.trim();
		if (!isValidWidth(nextWidth)) {
			window.alert("幅の形式が正しくありません。例: 50%, 1200px");
			return;
		}
		GM_setValue(STORAGE_KEY, nextWidth);
		window.location.reload();
	});
})();
