import fs from "node:fs";
import path from "node:path";
import {normalizeNewlines} from "../shared/utils";

export function resolveSourceFilePath(sourceFilePath: string) {
	const direct = path.resolve(sourceFilePath);
	if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
		return direct;
	}
	throw new Error(`Source file not found from current directory: ${sourceFilePath}`);
}

function maskJava(text: string) {
	const out: string[] = [];
	let inLineComment = false;
	let inBlockComment = false;
	let inString = false;
	let inChar = false;
	let isEscape = false;

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		const n = i + 1 < text.length ? text[i + 1] : "";

		if (inLineComment) {
			if (c === "\n") {
				inLineComment = false;
				out.push("\n");
			} else {
				out.push(" ");
			}
			continue;
		}
		if (inBlockComment) {
			if (c === "*" && n === "/") {
				out.push(" ", " ");
				i++;
				inBlockComment = false;
				continue;
			}
			out.push(c === "\n" ? "\n" : " ");
			continue;
		}
		if (inString) {
			if (isEscape) {
				isEscape = false;
				out.push(" ");
				continue;
			}
			if (c === "\\") {
				isEscape = true;
				out.push(" ");
				continue;
			}
			if (c === "\"") {
				inString = false;
				out.push(" ");
				continue;
			}
			out.push(c === "\n" ? "\n" : " ");
			continue;
		}
		if (inChar) {
			if (isEscape) {
				isEscape = false;
				out.push(" ");
				continue;
			}
			if (c === "\\") {
				isEscape = true;
				out.push(" ");
				continue;
			}
			if (c === "'") {
				inChar = false;
				out.push(" ");
				continue;
			}
			out.push(c === "\n" ? "\n" : " ");
			continue;
		}

		if (c === "/" && n === "/") {
			out.push(" ", " ");
			i++;
			inLineComment = true;
			continue;
		}
		if (c === "/" && n === "*") {
			out.push(" ", " ");
			i++;
			inBlockComment = true;
			continue;
		}
		if (c === "\"") {
			inString = true;
			out.push(" ");
			continue;
		}
		if (c === "'") {
			inChar = true;
			out.push(" ");
			continue;
		}
		out.push(c);
	}
	return out.join("");
}

function findMatchingBrace(maskedText: string, openBraceIdx: number) {
	let depth = 1;
	for (let i = openBraceIdx + 1; i < maskedText.length; i++) {
		const c = maskedText[i];
		if (c === "{") depth++;
		if (c === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function isPublicClass(maskedText: string, classKeywordIndex: number) {
	const lineStart = maskedText.lastIndexOf("\n", classKeywordIndex) + 1;
	const head = maskedText.slice(lineStart, classKeywordIndex);
	return /\bpublic\b/.test(head);
}

function findMainClassInfo(text: string, maskedText?: string) {
	const masked = maskedText || maskJava(text);
	const mainRegex = /(?:\bpublic\s+static|\bstatic\s+public)\s+void\s+main\s*\(\s*String\s*(?:\[]|\.\.\.)/;
	const mainMatch = mainRegex.exec(masked);
	const mainIndex = mainMatch ? mainMatch.index : -1;
	const classRegex = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
	const candidates: Array<{
		name: string;
		nameStart: number;
		nameEnd: number;
		classStart: number;
		closeBraceIdx: number;
		isPublic: boolean;
	}> = [];

	let m: RegExpExecArray | null;
	while ((m = classRegex.exec(masked)) !== null) {
		const name = m[1];
		const classStart = m.index;
		const nameStart = classStart + m[0].lastIndexOf(name);
		const nameEnd = nameStart + name.length;
		const openBraceIdx = masked.indexOf("{", nameEnd);
		if (openBraceIdx === -1) continue;
		const closeBraceIdx = findMatchingBrace(masked, openBraceIdx);
		const candidate = {
			name,
			nameStart,
			nameEnd,
			classStart,
			closeBraceIdx,
			isPublic: isPublicClass(masked, classStart),
		};
		candidates.push(candidate);
		if (mainIndex !== -1 && closeBraceIdx !== -1 && mainIndex > classStart && mainIndex < closeBraceIdx) {
			return candidate;
		}
	}
	if (!candidates.length) return null;
	return candidates.find((c) => c.isPublic) || candidates[0];
}

export function forceMainAndDebug(sourceCode: string) {
	let modified = normalizeNewlines(sourceCode);
	const masked = maskJava(modified);
	const replacements: Array<{ start: number; end: number; text: string }> = [];

	const classInfo = findMainClassInfo(modified, masked);
	if (classInfo && classInfo.name !== "Main") {
		replacements.push({start: classInfo.nameStart, end: classInfo.nameEnd, text: "Main"});
	}

	const debugRegex = /\bDEBUG\b\s*=\s*true\b/g;
	let dm: RegExpExecArray | null;
	while ((dm = debugRegex.exec(masked)) !== null) {
		const trueIdx = dm.index + dm[0].lastIndexOf("true");
		replacements.push({start: trueIdx, end: trueIdx + 4, text: "false"});
	}

	replacements.sort((a, b) => b.start - a.start);
	for (const rep of replacements) {
		modified = `${modified.slice(0, rep.start)}${rep.text}${modified.slice(rep.end)}`;
	}
	return modified;
}
