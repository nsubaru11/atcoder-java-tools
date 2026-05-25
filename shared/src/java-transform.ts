import {normalizeNewlines} from "./utils";

export type TransformOptions = {
	removePackage?: boolean;
	renameClass?: boolean;
	fixDebug?: boolean;
};

export type TransformResult = {
	modified: string;
	packageRemoved: boolean;
	classReplaced: boolean;
	debugReplaced: boolean;
};

type ModifyResult = {
	code: string;
	modified: boolean;
};

type ClassInfo = {
	name: string;
	nameStart: number;
	nameEnd: number;
	classStart: number;
	closeBraceIdx: number;
	isPublic: boolean;
}

function createMaskedCode(text: string): string {
	const enum State {Normal, LineComment, BlockComment, String, Char}

	const out: string[] = [];
	let state: State = State.Normal;
	let isEscape = false;
	const mask = (c: string) => c === "\n" ? "\n" : " ";

	for (let i = 0, len = text.length; i < len; i++) {
		const c = text[i], n = i + 1 < len ? text[i + 1] : "";
		if (state === State.LineComment) {
			out.push(mask(c));
			if (c === "\n") state = State.Normal;
		} else if (state === State.BlockComment) {
			if (c === "*" && n === "/") {
				out.push(" ", " ");
				i++;
				state = State.Normal;
			} else {
				out.push(mask(c));
			}
		} else if (state === State.String || state === State.Char) {
			const closeChar = state === State.String ? "\"" : "'";
			if (isEscape) {
				isEscape = false;
				out.push(" ");
			} else if (c === "\\") {
				isEscape = true;
				out.push(" ");
			} else if (c === closeChar) {
				state = State.Normal;
				out.push(" ");
			} else {
				out.push(mask(c));
			}
		} else {
			if (c === "/" && n === "/") {
				out.push(" ", " ");
				i++;
				state = State.LineComment;
			} else if (c === "/" && n === "*") {
				out.push(" ", " ");
				i++;
				state = State.BlockComment;
			} else if (c === "\"") {
				state = State.String;
				out.push(" ");
			} else if (c === "'") {
				state = State.Char;
				out.push(" ");
			} else {
				out.push(c);
			}
		}
	}
	return out.join("");
}

function findMatchingBrace(maskedText: string, openBraceIdx: number): number {
	let depth = 1;
	for (let i = openBraceIdx + 1; i < maskedText.length; i++) {
		if (maskedText[i] === "{") depth++;
		else if (maskedText[i] === "}" && --depth === 0) return i;
	}
	return -1;
}

function isPublicClass(maskedText: string, classKeywordIndex: number): boolean {
	const lineStart = maskedText.lastIndexOf("\n", classKeywordIndex) + 1;
	return /\bpublic\b/.test(maskedText.slice(lineStart, classKeywordIndex));
}

function buildClassInfo(maskedText: string, m: RegExpExecArray): ClassInfo | null {
	const name = m[1];
	const classStart = m.index;
	const nameStart = classStart + m[0].length - name.length;
	const nameEnd = nameStart + name.length;
	const openBraceIdx = maskedText.indexOf("{", nameEnd);
	if (openBraceIdx === -1) return null;
	return {
		name, nameStart, nameEnd, classStart,
		closeBraceIdx: findMatchingBrace(maskedText, openBraceIdx),
		isPublic: isPublicClass(maskedText, classStart),
	};
}

function findMainClassInfo(maskedText: string): ClassInfo | null {
	const mainIndex =
		/(?:\bpublic\s+static|\bstatic\s+public)\s+void\s+main\s*\(\s*String\s*(?:\[]|\.\.\.)/.exec(maskedText)?.index ?? -1;

	const classRegex = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
	const candidates: ClassInfo[] = [];
	let m: RegExpExecArray | null;

	while ((m = classRegex.exec(maskedText)) !== null) {
		const info = buildClassInfo(maskedText, m);
		if (!info) continue;
		candidates.push(info);
		if (mainIndex !== -1 && info.closeBraceIdx !== -1
			&& mainIndex > info.classStart && mainIndex < info.closeBraceIdx) {
			return info;
		}
	}

	return candidates.find((c: { isPublic: any; }) => c.isPublic) ?? candidates[0] ?? null;
}

function removePackageDeclaration(maskedCode: string, currentCode: string): ModifyResult {
	const m = /\bpackage\s+[A-Za-z_][A-Za-z0-9_.]*\s*;/.exec(maskedCode);
	if (!m) return {code: currentCode, modified: false};
	let end = m.index + m[0].length;
	if (currentCode[end] === "\n") end++;
	return {
		code: currentCode.slice(0, m.index) + currentCode.slice(end),
		modified: true,
	};
}

function renameClassToMain(maskedCode: string, currentCode: string): ModifyResult {
	const info = findMainClassInfo(maskedCode);
	if (!info || info.name === "Main") return {code: currentCode, modified: false};

	const escapedName = info.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const refRegex = new RegExp(`\\b${escapedName}\\b`, "g");

	const replacements: Array<{ start: number; end: number }> = [];
	let rm: RegExpExecArray | null;
	while ((rm = refRegex.exec(maskedCode)) !== null) {
		replacements.push({start: rm.index, end: rm.index + info.name.length});
	}

	replacements.sort((a, b) => b.start - a.start);
	let code = currentCode;
	for (const {start, end} of replacements) {
		code = code.slice(0, start) + "Main" + code.slice(end);
	}
	return {code, modified: true};
}

function disableDebugStatements(maskedCode: string, currentCode: string): ModifyResult {
	const debugRegex = /\bDEBUG\b\s*=\s*true\b/g;
	const replacements: Array<{ start: number; end: number }> = [];
	let dm: RegExpExecArray | null;
	while ((dm = debugRegex.exec(maskedCode)) !== null) {
		const trueIdx = dm.index + dm[0].lastIndexOf("true");
		replacements.push({start: trueIdx, end: trueIdx + 4});
	}
	if (!replacements.length) return {code: currentCode, modified: false};
	replacements.sort((a, b) => b.start - a.start);
	let code = currentCode;
	for (const {start, end} of replacements) {
		code = code.slice(0, start) + "false" + code.slice(end);
	}
	return {code, modified: true};
}

/**
 * Java ソースコードに対して指定された変換を順に適用する。
 */
export function modifyJavaCode(originalCode: string, options: TransformOptions): TransformResult {
	let currentCode = normalizeNewlines(originalCode);
	let packageRemoved = false;
	let classReplaced = false;
	let debugReplaced = false;

	if (options.removePackage) {
		const result = removePackageDeclaration(createMaskedCode(currentCode), currentCode);
		currentCode = result.code;
		packageRemoved = result.modified;
	}

	if (options.renameClass) {
		const result = renameClassToMain(createMaskedCode(currentCode), currentCode);
		currentCode = result.code;
		classReplaced = result.modified;
	}

	if (options.fixDebug) {
		const result = disableDebugStatements(createMaskedCode(currentCode), currentCode);
		currentCode = result.code;
		debugReplaced = result.modified;
	}

	return {modified: currentCode, packageRemoved, classReplaced, debugReplaced};
}
