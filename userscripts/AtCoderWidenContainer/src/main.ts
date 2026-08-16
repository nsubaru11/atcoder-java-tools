"use strict";

const STORAGE_KEY = "containerWidth";
const DEFAULT_WIDTH = "50%";

function isValidWidth(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	return trimmed !== "" && CSS.supports("width", trimmed);
}

function readWidth(): string {
	const storedWidth = GM_getValue<unknown>(STORAGE_KEY, DEFAULT_WIDTH);
	return isValidWidth(storedWidth) ? storedWidth.trim() : DEFAULT_WIDTH;
}

const currentWidth = readWidth();

// 初期描画時のちらつきを隠すため、html要素全体を一時的に非表示にするスタイルを挿入
const hideStyle = document.createElement("style");
hideStyle.textContent = `html { display: none !important; }`;
document.documentElement.appendChild(hideStyle);

// 幅を調整するスタイルを挿入
const style = document.createElement("style");
style.textContent = `
	#main-container {
		width: ${currentWidth} !important;
		max-width: 100% !important;
		transition: none !important;
	}
`;
document.documentElement.appendChild(style);

// DOMの構築完了時に非表示スタイルを削除し、画面を表示する
window.addEventListener("DOMContentLoaded", () => {
	if (document.documentElement.contains(hideStyle)) hideStyle.remove();
});

// 万が一DOMContentLoadedイベントの捕捉に失敗した場合のフェイルセーフ（500ms後）
setTimeout(() => {
	if (document.documentElement.contains(hideStyle)) hideStyle.remove();
}, 500);

GM_registerMenuCommand("最大幅設定の変更", () => {
	const inputWidth = window.prompt(
		"新しい幅設定を入力してください（例: 50%, 1200px）",
		currentWidth,
	);
	if (inputWidth === null) return;

	const nextWidth = inputWidth.trim();
	if (!isValidWidth(nextWidth)) {
		window.alert("幅の形式が正しくありません。例: 50%, 1200px");
		return;
	}

	GM_setValue(STORAGE_KEY, nextWidth);
	window.location.reload();
});