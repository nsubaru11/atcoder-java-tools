#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_LOCAL_RUNNER_URL = process.env.LOCAL_RUNNER_URL || "http://localhost:8080";
const SUBMISSION_POLL_INTERVAL_MS = 1000;
const SUBMISSION_POLL_TIMEOUT_MS = 180000;
const SUBMISSION_ID_DETECT_TIMEOUT_MS = 45000;
const SUBMISSION_ID_DETECT_INTERVAL_MS = 800;
const SUBMISSION_TERMINAL_EXTRA_FETCH_RETRY = 3;
const SUBMISSION_TERMINAL_EXTRA_FETCH_INTERVAL_MS = 500;
const SUBMIT_POST_RETRY_MAX = Number(process.env.ATCODER_SUBMIT_RETRY_MAX || 5);
const SUBMIT_POST_RETRY_BASE_MS = Number(process.env.ATCODER_SUBMIT_RETRY_BASE_MS || 1200);
const DEFAULT_SESSION_FILE_RELATIVE = path.join(".atcoder", "session.txt");
const DEFAULT_LANGUAGE_ID = "6056";

const ANSI = {
	RESET: "\x1b[0m",
	GREEN: "\x1b[32m",
	RED: "\x1b[31m",
	YELLOW: "\x1b[33m",
	ORANGE: "\x1b[38;5;208m",
	CYAN: "\x1b[36m",
};

function printUsage() {
	console.error("Usage:");
	console.error("  test <taskScreenName> <sourceFile>");
	console.error("  submit <taskScreenName> <sourceFile>");
}

function parseTask(taskScreenName) {
	if (!/^[a-z0-9_]+$/.test(taskScreenName)) {
		throw new Error(`Invalid taskScreenName: ${taskScreenName}`);
	}
	const idx = taskScreenName.lastIndexOf("_");
	if (idx <= 0 || idx === taskScreenName.length - 1) {
		throw new Error(`Invalid taskScreenName format: ${taskScreenName}`);
	}
	const contestId = taskScreenName.slice(0, idx);
	return {
		contestId,
		taskScreenName,
		taskUrl: `https://atcoder.jp/contests/${contestId}/tasks/${taskScreenName}`,
		submitUrl: `https://atcoder.jp/contests/${contestId}/submit?taskScreenName=${taskScreenName}`,
		submitPostUrl: `https://atcoder.jp/contests/${contestId}/submit`,
	};
}

/**
 * 絶対パスまたは作業ディレクトリ基準の相対パスのみを許可する。
 */
function resolveSourceFilePath(sourceFilePath) {
	const direct = path.resolve(sourceFilePath);
	if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
		return direct;
	}
	throw new Error(`Source file not found from current directory: ${sourceFilePath}`);
}

function normalizeNewlines(text) {
	return text.replace(/\r\n?/g, "\n");
}

function maskJava(text) {
	// 文字列/文字リテラルとコメントを空白化し、
	// ソース長と改行位置を維持したマスク文字列を作る。
	// これにより後続の正規表現・位置計算を安全に行える。
	const out = [];
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

function findMatchingBrace(maskedText, openBraceIdx) {
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

function isPublicClass(maskedText, classKeywordIndex) {
	const lineStart = maskedText.lastIndexOf("\n", classKeywordIndex) + 1;
	const head = maskedText.slice(lineStart, classKeywordIndex);
	return /\bpublic\b/.test(head);
}

function findMainClassInfo(text, maskedText) {
	// main を含むクラスを最優先で選び、
	// なければ public class、最後に先頭クラスへフォールバックする。
	// クラス名差し替え時の対象特定に使う。
	const masked = maskedText || maskJava(text);
	const mainRegex = /(?:\bpublic\s+static|\bstatic\s+public)\s+void\s+main\s*\(\s*String\s*(?:\[]|\.\.\.)/;
	const mainMatch = mainRegex.exec(masked);
	const mainIndex = mainMatch ? mainMatch.index : -1;
	const classRegex = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
	const candidates = [];

	let m;
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

function forceMainAndDebug(sourceCode) {
	// AtCoder 提出用にエントリクラス名を Main に統一し、
	// DEBUG=true の定義だけを false へ強制する。
	// 置換は後方から適用してインデックスずれを防ぐ。
	let modified = normalizeNewlines(sourceCode);
	const masked = maskJava(modified);
	const replacements = [];

	const classInfo = findMainClassInfo(modified, masked);
	if (classInfo && classInfo.name !== "Main") {
		replacements.push({start: classInfo.nameStart, end: classInfo.nameEnd, text: "Main"});
	}

	const debugRegex = /\bDEBUG\b\s*=\s*true\b/g;
	let dm;
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

function decodeHtmlEntities(text) {
	const named = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
		times: "x",
	};
	return text
		.replace(/<br\s*\/?\s*>/gi, "\n")
		.replace(/<\/p>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&([a-zA-Z]+);/g, (_, n) => named[n] ?? `&${n};`);
}

function extractSamples(taskHtml) {
	const inputRegex = /<h3[^>]*>\s*(?:入力例|Sample Input)\s*([0-9]+)?\s*<\/h3>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi;
	const outputRegex = /<h3[^>]*>\s*(?:出力例|Sample Output)\s*([0-9]+)?\s*<\/h3>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi;
	const inputs = [];
	const outputs = [];

	let m;
	while ((m = inputRegex.exec(taskHtml)) !== null) {
		inputs.push({idx: m[1] ? Number(m[1]) : inputs.length + 1, text: decodeHtmlEntities(m[2])});
	}
	while ((m = outputRegex.exec(taskHtml)) !== null) {
		outputs.push({idx: m[1] ? Number(m[1]) : outputs.length + 1, text: decodeHtmlEntities(m[2])});
	}
	const uniqueInputs = dedupeIndexedBlocks(inputs);
	const uniqueOutputs = dedupeIndexedBlocks(outputs);
	uniqueInputs.sort((a, b) => a.idx - b.idx);
	uniqueOutputs.sort((a, b) => a.idx - b.idx);
	const len = Math.min(uniqueInputs.length, uniqueOutputs.length);
	if (len === 0) {
		throw new Error("No sample pairs were found on the task page.");
	}
	const pairs = [];
	for (let i = 0; i < len; i++) {
		pairs.push({
			index: i + 1,
			input: normalizeNewlines(uniqueInputs[i].text),
			expectedOutput: normalizeNewlines(uniqueOutputs[i].text)
		});
	}
	return dedupeSamplePairs(pairs);
}

function dedupeIndexedBlocks(blocks) {
	const set = new Set();
	const result = [];
	for (const block of blocks) {
		const key = `${block.idx}\u0000${normalizeNewlines(block.text)}`;
		if (set.has(key)) continue;
		set.add(key);
		result.push(block);
	}
	return result;
}

function dedupeSamplePairs(pairs) {
	const set = new Set();
	const result = [];
	for (const pair of pairs) {
		const key = `${pair.input}\u0000${pair.expectedOutput}`;
		if (set.has(key)) continue;
		set.add(key);
		result.push({...pair, index: result.length + 1});
	}
	return result;
}

function toCookieHeader() {
	if (process.env.ATCODER_COOKIE && process.env.ATCODER_COOKIE.trim()) {
		return process.env.ATCODER_COOKIE.trim();
	}
	if (process.env.ATCODER_SESSION && process.env.ATCODER_SESSION.trim()) {
		return `REVEL_SESSION=${process.env.ATCODER_SESSION.trim()}`;
	}
	const sessionFromFile = readSessionFromFile();
	if (sessionFromFile) {
		return `REVEL_SESSION=${sessionFromFile}`;
	}
	return "";
}

function readSessionFromFile() {
	const explicitPath = process.env.ATCODER_SESSION_FILE;
	const homeDir = process.env.USERPROFILE || process.env.HOME || "";
	const defaultPath = homeDir ? path.join(homeDir, DEFAULT_SESSION_FILE_RELATIVE) : "";
	const candidates = [explicitPath, defaultPath].filter(Boolean);
	for (const candidate of candidates) {
		try {
			if (!fs.existsSync(candidate)) continue;
			const raw = fs.readFileSync(candidate, "utf8").trim();
			if (!raw) continue;
			if (/^REVEL_SESSION=/i.test(raw)) {
				return raw.replace(/^REVEL_SESSION=/i, "").trim();
			}
			return raw;
		} catch {
			// ignore and continue fallback candidates
		}
	}
	return "";
}

async function httpGetText(url, cookieHeader = "") {
	const headers = {
		"User-Agent": "AtCoder-JavaCodeSubmitter-CLI/1.0",
		"Accept-Language": "ja,en;q=0.9",
	};
	if (cookieHeader) headers.Cookie = cookieHeader;
	const res = await fetch(url, {headers, redirect: "follow"});
	if (!res.ok) {
		throw new Error(`GET failed (${res.status}) for ${url}`);
	}
	return await res.text();
}

async function httpGetTextWith429Retry(url, cookieHeader = "", maxAttempts = 4) {
	const headers = {
		"User-Agent": "AtCoder-JavaCodeSubmitter-CLI/1.0",
		"Accept-Language": "ja,en;q=0.9",
	};
	if (cookieHeader) headers.Cookie = cookieHeader;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const res = await fetch(url, {headers, redirect: "follow"});
		if (res.ok) {
			return await res.text();
		}
		if (res.status !== 429) {
			throw new Error(`GET failed (${res.status}) for ${url}`);
		}
		const retryAfterHeader = res.headers.get("retry-after") || "";
		const retryAfterSec = Number.parseInt(retryAfterHeader, 10);
		const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
			? retryAfterSec * 1000
			: 700 + attempt * 700;
		await sleep(waitMs);
	}
	throw new Error(`GET failed (429) for ${url}`);
}

function extractCsrfToken(html) {
	const m = html.match(/name=["']csrf_token["']\s+value=["']([^"']+)["']/i);
	if (!m) throw new Error("csrf_token not found.");
	return m[1];
}

function isAtCoderLoginPage(html) {
	if (!html) return false;
	return (
		/<title>\s*(?:ログイン|Login)\s*-\s*AtCoder\s*<\/title>/i.test(html) ||
		/name=["']username["']/i.test(html) ||
		/name=["']password["']/i.test(html) ||
		/\/login\?continue=/i.test(html) ||
		/ログインしてください/.test(html)
	);
}

function resolveFixedJavaLanguageId(submitPageHtml) {
	if (isAtCoderLoginPage(submitPageHtml)) {
		throw new Error("Authentication is required for submit. Set ATCODER_COOKIE or ATCODER_SESSION.");
	}
	return DEFAULT_LANGUAGE_ID;
}

function extractLanguageOptionsFromSubmitPage(html) {
	const selectMatch = html.match(/<select[^>]*name=["']data\.LanguageId["'][^>]*>([\s\S]*?)<\/select>/i);
	if (!selectMatch) return [];
	const optionRegex = /<option\s+value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
	const options = [];
	let m;
	while ((m = optionRegex.exec(selectMatch[1])) !== null) {
		options.push({
			value: m[1].trim(),
			label: decodeHtmlEntities(m[2]).replace(/\s+/g, " ").trim(),
		});
	}
	return options;
}

function chooseJavaLanguageIdFromOptions(options) {
	if (!options.length) return "";
	const normalized = options.map((o) => ({...o, lower: o.label.toLowerCase()}));
	const priority = [
		(l) => /java/.test(l) && /(24\.0\.2|24)/.test(l),
		(l) => /java/.test(l) && /openjdk/.test(l),
		(l) => /java/.test(l),
	];
	for (const rule of priority) {
		const found = normalized.find((o) => rule(o.lower));
		if (found) return found.value;
	}
	return "";
}

function extractSubmitForm(submitPageHtml, task) {
	const formMatch = submitPageHtml.match(/<form[^>]*class=["'][^"']*form-code-submit[^"']*["'][^>]*>[\s\S]*?<\/form>/i)
		|| submitPageHtml.match(/<form[^>]*id=["']submit-form["'][^>]*>[\s\S]*?<\/form>/i)
		|| submitPageHtml.match(/<form[^>]*action=["'][^"']*\/submit[^"']*["'][^>]*>[\s\S]*?<\/form>/i);
	if (!formMatch) {
		throw new Error("Submit form was not found on submit page.");
	}
	const formHtml = formMatch[0];
	const actionMatch = formHtml.match(/\saction=["']([^"']+)["']/i);
	const actionPath = actionMatch ? decodeHtmlEntities(actionMatch[1]) : `/contests/${task.contestId}/submit`;
	const actionUrl = actionPath.startsWith("http") ? actionPath : `https://atcoder.jp${actionPath}`;

	const formValues = new Map();
	const inputRegex = /<input\b([^>]*)>/gi;
	let m;
	while ((m = inputRegex.exec(formHtml)) !== null) {
		const attrs = m[1] || "";
		if (/\sdisabled(?:\s|>|$)/i.test(attrs)) continue;
		const nameMatch = attrs.match(/\sname=["']([^"']+)["']/i);
		if (!nameMatch) continue;
		const typeMatch = attrs.match(/\stype=["']([^"']+)["']/i);
		const type = (typeMatch ? typeMatch[1] : "text").toLowerCase();
		if (type === "checkbox" || type === "radio") {
			if (!/\schecked(?:\s|>|$)/i.test(attrs)) continue;
		}
		const valueMatch = attrs.match(/\svalue=["']([\s\S]*?)["']/i);
		formValues.set(nameMatch[1], decodeHtmlEntities(valueMatch ? valueMatch[1] : ""));
	}

	const textareaRegex = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi;
	while ((m = textareaRegex.exec(formHtml)) !== null) {
		const attrs = m[1] || "";
		if (/\sdisabled(?:\s|>|$)/i.test(attrs)) continue;
		const nameMatch = attrs.match(/\sname=["']([^"']+)["']/i);
		if (!nameMatch) continue;
		formValues.set(nameMatch[1], decodeHtmlEntities(m[2] || ""));
	}

	const selectRegex = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
	while ((m = selectRegex.exec(formHtml)) !== null) {
		const attrs = m[1] || "";
		if (/\sdisabled(?:\s|>|$)/i.test(attrs)) continue;
		const nameMatch = attrs.match(/\sname=["']([^"']+)["']/i);
		if (!nameMatch) continue;
		const optionsHtml = m[2] || "";
		const selected = optionsHtml.match(/<option\b[^>]*selected[^>]*value=["']([^"']+)["'][^>]*>/i)
			|| optionsHtml.match(/<option\b[^>]*value=["']([^"']+)["'][^>]*selected[^>]*>/i)
			|| optionsHtml.match(/<option\b[^>]*value=["']([^"']+)["'][^>]*>/i);
		formValues.set(nameMatch[1], selected ? decodeHtmlEntities(selected[1]) : "");
	}

	return {actionUrl, formValues};
}

function extractSubmissionIdFromHtml(html, contestId) {
	if (!html) return "";
	const direct = html.match(/\/contests\/[^/]+\/submissions\/(\d+)/);
	if (direct) return direct[1];
	const dataId = html.match(/<tr[^>]*\sdata-id=["'](\d+)["']/i);
	if (dataId) return dataId[1];
	const meRow = html.match(new RegExp(`/contests/${contestId}/submissions/(\\d+)`));
	if (meRow) return meRow[1];
	return "";
}

async function fetchLatestSubmissionId(task, cookieHeader) {
	const listUrl = `https://atcoder.jp/contests/${task.contestId}/submissions/me?f.Task=${task.taskScreenName}`;
	const html = await httpGetTextWith429Retry(listUrl, cookieHeader);
	return extractSubmissionIdFromHtml(html, task.contestId);
}

async function waitForNewSubmissionId(task, cookieHeader, previousSubmissionId) {
	const started = Date.now();
	while (Date.now() - started < SUBMISSION_ID_DETECT_TIMEOUT_MS) {
		const latestId = await fetchLatestSubmissionId(task, cookieHeader);
		if (latestId && latestId !== previousSubmissionId) {
			return latestId;
		}
		await sleep(SUBMISSION_ID_DETECT_INTERVAL_MS);
	}
	return "";
}

async function postLocalRunner(sourceCode, stdinText) {
	const res = await fetch(DEFAULT_LOCAL_RUNNER_URL, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({mode: "run", sourceCode, stdin: stdinText}),
	});
	if (!res.ok) {
		throw new Error(`Local runner request failed: ${res.status}`);
	}
	return await res.json();
}

function evaluateByEasyTest(runResult, expectedOutput, options = {trim: true, split: true}) {
	// EasyTest 互換の比較順序: trim -> 許容誤差付き数値比較 -> 空白分割比較。
	// ローカル実行結果を AC/WA 判定へ正規化する。
	// 期待値が文字列でない場合はそのまま実行状態を返す。
	const status = runResult.status;
	if (status !== "OK" || typeof expectedOutput !== "string") {
		return {status, output: runResult.output || "", expectedOutput};
	}
	let output = runResult.output || "";
	let expected = expectedOutput;
	if (options.trim) {
		expected = expected.trim();
		output = output.trim();
	}
	let equals = (x, y) => x === y;
	if (options.allowableError) {
		const floatPattern = /^[-+]?[0-9]*\.[0-9]+([eE][-+]?[0-9]+)?$/;
		const superEquals = equals;
		equals = (x, y) => {
			if (floatPattern.test(x) || floatPattern.test(y)) {
				const a = Number.parseFloat(x);
				const b = Number.parseFloat(y);
				return Math.abs(a - b) <= Math.max(options.allowableError, Math.abs(b) * options.allowableError);
			}
			return superEquals(x, y);
		};
	}
	if (options.split) {
		const superEquals = equals;
		equals = (x, y) => {
			const xs = x.split(/\s+/);
			const ys = y.split(/\s+/);
			if (xs.length !== ys.length) return false;
			for (let i = 0; i < xs.length; i++) {
				if (!superEquals(xs[i], ys[i])) return false;
			}
			return true;
		};
	}
	return {status: equals(output, expected) ? "AC" : "WA", output, expectedOutput: expected};
}

function mapRunnerStatusToEasyTestStatus(localRunnerResult) {
	switch (localRunnerResult.status) {
		case "success":
			return "OK";
		case "compileError":
			return "CE";
		case "timeLimitExceeded":
			return "TLE";
		case "runtimeError":
		case "internalError":
		default:
			return "RE";
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterToMs(headerValue, fallbackMs) {
	const sec = Number.parseInt((headerValue || "").trim(), 10);
	if (Number.isFinite(sec) && sec > 0) {
		return sec * 1000;
	}
	return fallbackMs;
}

async function postSubmitWithRetry(url, headers, body) {
	for (let attempt = 0; attempt < SUBMIT_POST_RETRY_MAX; attempt++) {
		const res = await fetch(url, {
			method: "POST",
			headers,
			redirect: "follow",
			body,
		});
		if (res.status !== 429) {
			return res;
		}
		if (attempt + 1 >= SUBMIT_POST_RETRY_MAX) {
			return res;
		}
		const waitMs = parseRetryAfterToMs(
			res.headers.get("retry-after"),
			SUBMIT_POST_RETRY_BASE_MS * (attempt + 1),
		);
		console.log(`Warning: submit is rate-limited (429). Retrying in ${waitMs}ms...`);
		await sleep(waitMs);
	}
	throw new Error("Unreachable submit retry state.");
}

function supportsColor() {
	return process.stdout.isTTY && !process.env.NO_COLOR;
}

function colorizeStatus(status) {
	if (!supportsColor()) return status;
	if (status === "AC") return `${ANSI.GREEN}${status}${ANSI.RESET}`;
	if (status === "WA") return `${ANSI.RED}${status}${ANSI.RESET}`;
	if (status === "CE") return `${ANSI.YELLOW}${status}${ANSI.RESET}`;
	if (["RE", "MLE", "TLE", "OLE"].includes(status)) return `${ANSI.ORANGE}${status}${ANSI.RESET}`;
	if (["WJ", "WR"].includes(status)) return `${ANSI.CYAN}${status}${ANSI.RESET}`;
	return status;
}

async function runSampleTests(sourceCode, samplePairs) {
	const results = [];
	for (const sample of samplePairs) {
		const runnerRaw = await postLocalRunner(sourceCode, sample.input);
		const easyLikeRun = {
			status: mapRunnerStatusToEasyTestStatus(runnerRaw),
			output: runnerRaw.stdout || "",
			error: runnerRaw.stderr || "",
			execTime: runnerRaw.time || 0,
		};
		const judged = evaluateByEasyTest(easyLikeRun, sample.expectedOutput, {trim: true, split: true});
		results.push({
			index: sample.index,
			status: judged.status,
			execTime: easyLikeRun.execTime,
			memoryKb: Number(runnerRaw.memory || 0),
			runnerStatus: runnerRaw.status || "",
			exitCode: Number(runnerRaw.exitCode ?? 0),
			stdoutTruncated: !!runnerRaw.stdoutTruncated,
			stderrTruncated: !!runnerRaw.stderrTruncated,
			stderr: easyLikeRun.error,
			actualOutput: judged.output,
			expectedOutput: judged.expectedOutput,
		});
	}
	return results;
}

function printSampleResults(results, originalClassName, originalFileName) {
	let acCount = 0;
	let totalExecTime = 0;
	const statusCounts = new Map();
	for (const r of results) {
		if (r.status === "AC") acCount++;
		totalExecTime += Number(r.execTime || 0);
		statusCounts.set(r.status, (statusCounts.get(r.status) || 0) + 1);
		const details = [`exec=${r.execTime}ms`];
		if (r.memoryKb > 0) details.push(`mem=${r.memoryKb}KB`);
		if (r.runnerStatus && r.runnerStatus !== "success") details.push(`runner=${r.runnerStatus}`);
		if (r.exitCode !== 0) details.push(`exit=${r.exitCode}`);
		if (r.stdoutTruncated || r.stderrTruncated) {
			const flags = [];
			if (r.stdoutTruncated) flags.push("stdout");
			if (r.stderrTruncated) flags.push("stderr");
			details.push(`trunc=${flags.join(",")}`);
		}
		console.log(`[${r.index}] ${colorizeStatus(r.status)} ${details.join(" ")}`);
		if (r.stderr && r.stderr.trim().length > 0) {
			console.log(`  [stderr]`);
			let displayStderr = r.stderr.trim();
			if (originalClassName) {
				displayStderr = displayStderr
					.replace(/Main\.java/g, originalFileName)
					.replace(/\bMain\b/g, originalClassName);
			}
			console.log(displayStderr.split(/\r?\n/).map(line => `    ${line}`).join("\n"));
		}
	}
	const breakdown = Array.from(statusCounts.entries())
		.sort((a, b) => {
			if (a[0] === "AC") return -1;
			if (b[0] === "AC") return 1;
			return a[0].localeCompare(b[0]);
		})
		.map(([status, count]) => `${status}:${count}`)
		.join(" ");
	const avgExecTime = results.length ? (totalExecTime / results.length).toFixed(1) : "0.0";
	console.log(`Summary: ${acCount}/${results.length} AC | ${breakdown} | total=${totalExecTime}ms avg=${avgExecTime}ms`);
	return acCount === results.length;
}

async function submitToAtCoder(task, sourceCode, cookieHeader) {
	// 提出ページの hidden/select/textarea をそのまま引き継いで送信する。
	// 429 は段階的にリトライし、提出IDは redirect/html/差分監視で回収する。
	// 監視不能時は trackingUnavailable を返して呼び出し側で扱う。
	if (!cookieHeader) {
		throw new Error("Authentication is required for submit. Set ATCODER_COOKIE or ATCODER_SESSION.");
	}
	const submitPage = await httpGetText(task.submitUrl, cookieHeader);
	if (isAtCoderLoginPage(submitPage)) {
		throw new Error("Authentication is required for submit. Your REVEL_SESSION may be missing or expired.");
	}
	const csrfToken = extractCsrfToken(submitPage);
	const submitForm = extractSubmitForm(submitPage, task);
	const fixedLanguageId = resolveFixedJavaLanguageId(submitPage);
	const submitPageJavaLanguageId = chooseJavaLanguageIdFromOptions(extractLanguageOptionsFromSubmitPage(submitPage));
	const languageCandidates = [];
	for (const candidate of [fixedLanguageId, submitPageJavaLanguageId]) {
		if (!candidate) continue;
		if (languageCandidates.includes(candidate)) continue;
		languageCandidates.push(candidate);
	}
	if (!languageCandidates.length) {
		throw new Error("Java language ID was not found on submit page.");
	}
	let previousSubmissionId = "";
	let canTrackByDiff = true;
	try {
		previousSubmissionId = await fetchLatestSubmissionId(task, cookieHeader);
	} catch (error) {
		if (String(error.message || "").includes("(429)")) {
			canTrackByDiff = false;
			console.log("Warning: submissions/me is rate-limited (429). Continue submit without strict ID diff tracking.");
		} else {
			throw error;
		}
	}

	let lastRejectReason = "";
	for (const languageId of languageCandidates) {
		const params = new URLSearchParams();
		for (const [k, v] of submitForm.formValues.entries()) {
			params.set(k, v);
		}
		params.set("data.TaskScreenName", task.taskScreenName);
		params.set("data.LanguageId", languageId);
		params.set("sourceCode", sourceCode);
		params.set("csrf_token", csrfToken);
		console.log(`LanguageId: ${languageId}`);

		const submitHeaders = {
			"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
			"User-Agent": "AtCoder-JavaCodeSubmitter-CLI/1.0",
			"Accept-Language": "ja,en;q=0.9",
			Origin: "https://atcoder.jp",
			Referer: task.submitUrl,
			Cookie: cookieHeader,
		};
		const res = await postSubmitWithRetry(submitForm.actionUrl, submitHeaders, params.toString());
		if (!res.ok) {
			lastRejectReason = `Submit request failed (${res.status}).`;
			continue;
		}
		const html = await res.text();
		const urlFromRedirect = res.url || "";
		const redirectMatch = urlFromRedirect.match(/\/submissions\/(\d+)/);
		if (redirectMatch) {
			return {
				submissionId: redirectMatch[1],
				submissionUrl: urlFromRedirect,
			};
		}
		const htmlSubmissionId = extractSubmissionIdFromHtml(html, task.contestId);
		if (htmlSubmissionId && (!canTrackByDiff || htmlSubmissionId !== previousSubmissionId)) {
			return {
				submissionId: htmlSubmissionId,
				submissionUrl: `https://atcoder.jp/contests/${task.contestId}/submissions/${htmlSubmissionId}`,
			};
		}
		if (canTrackByDiff) {
			const latestId = await waitForNewSubmissionId(task, cookieHeader, previousSubmissionId);
			if (latestId) {
				return {
					submissionId: latestId,
					submissionUrl: `https://atcoder.jp/contests/${task.contestId}/submissions/${latestId}`,
				};
			}
		}
		lastRejectReason = extractSubmitFailureReason(html) || "Submit did not create a new submission ID.";
	}

	if (canTrackByDiff) {
		throw new Error(`Submit was rejected by AtCoder: ${lastRejectReason || "unknown error"}`);
	}
	return {
		submissionId: "-",
		submissionUrl: `https://atcoder.jp/contests/${task.contestId}/submissions/me?f.Task=${task.taskScreenName}`,
		trackingUnavailable: true,
	};
}

function stripTags(html) {
	return decodeHtmlEntities(html).replace(/\s+/g, " ").trim();
}

function parseSubmissionStatus(html) {
	const patterns = [
		/<span[^>]*data-title=["']Status["'][^>]*>([\s\S]*?)<\/span>/i,
		/<td[^>]*id=["']judge-status["'][^>]*>([\s\S]*?)<\/td>/i,
		/<td[^>]*>\s*<span[^>]*class=["'][^"']*label[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<\/td>/i,
	];
	for (const p of patterns) {
		const m = html.match(p);
		if (m) {
			const status = stripTags(m[1]).replace(/\s+/g, "");
			if (status) return status;
		}
	}
	return "";
}

function parseExecAndMemory(html) {
	const execMatch = html.match(/data-title=["']Execution Time["'][^>]*>([\s\S]*?)<\/td>/i);
	const memMatch = html.match(/data-title=["']Memory["'][^>]*>([\s\S]*?)<\/td>/i);
	return {
		execTime: execMatch ? stripTags(execMatch[1]) : "",
		memory: memMatch ? stripTags(memMatch[1]) : "",
	};
}

function extractSubmitFailureReason(html) {
	if (!html) return "";
	const patterns = [
		/<div[^>]*class=["'][^"']*alert-danger[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
		/<p[^>]*class=["'][^"']*text-danger[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
		/<li[^>]*class=["'][^"']*error[^"']*["'][^>]*>([\s\S]*?)<\/li>/i,
	];
	for (const pattern of patterns) {
		const m = html.match(pattern);
		if (!m) continue;
		const text = stripTags(m[1]).replace(/\s+/g, " ").trim();
		if (text) return text;
	}
	return "";
}

function formatMetricValue(value) {
	return value && String(value).trim() ? String(value).trim() : "N/A";
}

async function pollSubmissionFinal(submissionUrl, cookieHeader) {
	const started = Date.now();
	let lastStatus = "";
	const terminal = new Set(["AC", "WA", "RE", "TLE", "MLE", "CE", "OLE", "IE"]);
	while (Date.now() - started < SUBMISSION_POLL_TIMEOUT_MS) {
		const html = await httpGetText(submissionUrl, cookieHeader);
		const status = parseSubmissionStatus(html) || lastStatus || "WJ";
		if (status !== lastStatus) {
			console.log(`Status: ${colorizeStatus(status)}`);
			lastStatus = status;
		}
		if (terminal.has(status)) {
			let extra = parseExecAndMemory(html);
			for (let i = 0; i < SUBMISSION_TERMINAL_EXTRA_FETCH_RETRY; i++) {
				if (extra.execTime && extra.memory) break;
				await sleep(SUBMISSION_TERMINAL_EXTRA_FETCH_INTERVAL_MS);
				const retryHtml = await httpGetText(submissionUrl, cookieHeader);
				extra = parseExecAndMemory(retryHtml);
			}
			return {status, ...extra};
		}
		await sleep(SUBMISSION_POLL_INTERVAL_MS);
	}
	return {status: lastStatus || "PENDING", execTime: "", memory: ""};
}

async function runCommand(command, taskScreenName, sourceFilePath) {
	const task = parseTask(taskScreenName);
	const resolvedSourcePath = resolveSourceFilePath(sourceFilePath);
	const source = normalizeNewlines(fs.readFileSync(resolvedSourcePath, "utf8"));
	const transformed = forceMainAndDebug(source);
	const originalFileName = path.basename(resolvedSourcePath);
	const originalClassName = originalFileName.replace(/\.java$/i, "");

	const taskHtml = await httpGetText(task.taskUrl, toCookieHeader());
	const samples = extractSamples(taskHtml);
	const sampleResults = await runSampleTests(transformed, samples);
	const allAccepted = printSampleResults(sampleResults, originalClassName, originalFileName);

	if (command === "test") return allAccepted ? 0 : 5;

	if (!allAccepted) {
		console.log("Not submitting because at least one sample test is not AC.");
		return 5;
	}

	const submitResult = await submitToAtCoder(task, transformed, toCookieHeader());
	if (submitResult.trackingUnavailable) {
		const latestId = await fetchLatestSubmissionId(task, toCookieHeader());
		if (!latestId) {
			throw new Error("Submission tracking failed: could not resolve latest submission ID.");
		}
		const trackedSubmissionUrl = `https://atcoder.jp/contests/${task.contestId}/submissions/${latestId}`;
		const trackedResult = await pollSubmissionFinal(trackedSubmissionUrl, toCookieHeader());
		console.log(
			`Result: ${colorizeStatus(trackedResult.status)} | ID: ${latestId} | Exec: ${formatMetricValue(trackedResult.execTime)} | Memory: ${formatMetricValue(trackedResult.memory)} | URL: ${trackedSubmissionUrl}`,
		);
		return trackedResult.status === "AC" ? 0 : 8;
	}
	const finalResult = await pollSubmissionFinal(submitResult.submissionUrl, toCookieHeader());
	console.log(
		`Result: ${colorizeStatus(finalResult.status)} | ID: ${submitResult.submissionId} | Exec: ${formatMetricValue(finalResult.execTime)} | Memory: ${formatMetricValue(finalResult.memory)} | URL: ${submitResult.submissionUrl}`,
	);
	return finalResult.status === "AC" ? 0 : 8;
}

async function main() {
	const [command, taskScreenName, sourceFilePath] = process.argv.slice(2);
	if (!["test", "submit"].includes(command) || !taskScreenName || !sourceFilePath) {
		printUsage();
		process.exit(1);
	}

	try {
		const code = await runCommand(command, taskScreenName, sourceFilePath);
		process.exit(code);
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	}
}

main();
