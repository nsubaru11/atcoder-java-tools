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

// document-start でルールだけを先に登録し、#main-container の生成直後から幅を適用する。
GM_addStyle(`
	#main-container {
		width: ${currentWidth} !important;
		max-width: 100% !important;
	}
`);

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
