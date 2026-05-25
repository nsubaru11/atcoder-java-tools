import {buildAtCoderSubmissionsMeUrl, buildAtCoderSubmissionUrl,} from "@atcoder-tools/shared";
import fs from "node:fs";
import path from "node:path";
import type {SubmissionFinalResult, SubmitResult, Task} from "../types";
import {CLI_CONFIG} from "../config";
import {colorizeStatus, sleep} from "../utils";
import {
	chooseJavaLanguageIdFromOptions,
	extractCsrfToken,
	extractLanguageOptionsFromSubmitPage,
	extractSubmissionIdFromHtml,
	extractSubmitFailureReason,
	extractSubmitForm,
	isAtCoderLoginPage,
	parseExecAndMemory,
	parseSubmissionStatus,
} from "./parser";

export function toCookieHeader() {
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
	const defaultPath = homeDir ? path.join(homeDir, CLI_CONFIG.defaultSessionFileRelative) : "";
	const candidates = [explicitPath, defaultPath].filter(Boolean) as string[];
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

export async function httpGetText(url: string, cookieHeader = "") {
	const headers: Record<string, string> = {
		"User-Agent": CLI_CONFIG.userAgent,
		"Accept-Language": "ja,en;q=0.9",
	};
	if (cookieHeader) headers.Cookie = cookieHeader;
	const res = await fetch(url, {headers, redirect: "follow"});
	if (!res.ok) {
		throw new Error(`GET failed (${res.status}) for ${url}`);
	}
	return await res.text();
}

async function httpGetTextWith429Retry(url: string, cookieHeader = "", maxAttempts = 4) {
	const headers: Record<string, string> = {
		"User-Agent": CLI_CONFIG.userAgent,
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

export async function fetchLatestSubmissionId(task: Task, cookieHeader: string) {
	const listUrl = buildAtCoderSubmissionsMeUrl(task.contestId, {task: task.taskScreenName});
	const html = await httpGetTextWith429Retry(listUrl, cookieHeader);
	return extractSubmissionIdFromHtml(html, task.contestId);
}

async function waitForNewSubmissionId(task: Task, cookieHeader: string, previousSubmissionId: string) {
	const started = Date.now();
	while (Date.now() - started < CLI_CONFIG.submissionIdDetectTimeoutMs) {
		const latestId = await fetchLatestSubmissionId(task, cookieHeader);
		if (latestId && latestId !== previousSubmissionId) {
			return latestId;
		}
		await sleep(CLI_CONFIG.submissionIdDetectIntervalMs);
	}
	return "";
}

function parseRetryAfterToMs(headerValue: string | null, fallbackMs: number) {
	const sec = Number.parseInt((headerValue || "").trim(), 10);
	if (Number.isFinite(sec) && sec > 0) {
		return sec * 1000;
	}
	return fallbackMs;
}

async function postSubmitWithRetry(url: string, headers: Record<string, string>, body: string) {
	for (let attempt = 0; attempt < CLI_CONFIG.submitPostRetryMax; attempt++) {
		const res = await fetch(url, {
			method: "POST",
			headers,
			redirect: "follow",
			body,
		});
		if (res.status !== 429) {
			return res;
		}
		if (attempt + 1 >= CLI_CONFIG.submitPostRetryMax) {
			return res;
		}
		const waitMs = parseRetryAfterToMs(
			res.headers.get("retry-after"),
			CLI_CONFIG.submitPostRetryBaseMs * (attempt + 1),
		);
		console.log(`Warning: submit is rate-limited (429). Retrying in ${waitMs}ms...`);
		await sleep(waitMs);
	}
	throw new Error("Unreachable submit retry state.");
}

export async function submitToAtCoder(task: Task, sourceCode: string, cookieHeader: string): Promise<SubmitResult> {
	if (!cookieHeader) {
		throw new Error("Authentication is required for submit. Set ATCODER_COOKIE or ATCODER_SESSION.");
	}
	const submitPage = await httpGetText(task.submitUrl, cookieHeader);
	if (isAtCoderLoginPage(submitPage)) {
		throw new Error("Authentication is required for submit. Your REVEL_SESSION may be missing or expired.");
	}
	const csrfToken = extractCsrfToken(submitPage);
	const submitForm = extractSubmitForm(submitPage, task);
	const fixedLanguageId = CLI_CONFIG.defaultLanguageId;
	const submitPageJavaLanguageId = chooseJavaLanguageIdFromOptions(extractLanguageOptionsFromSubmitPage(submitPage));
	const languageCandidates: string[] = [];
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
		if (String(error instanceof Error ? error.message : error).includes("(429)")) {
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
			"User-Agent": CLI_CONFIG.userAgent,
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
				submissionUrl: buildAtCoderSubmissionUrl(task.contestId, htmlSubmissionId),
			};
		}
		if (canTrackByDiff) {
			const latestId = await waitForNewSubmissionId(task, cookieHeader, previousSubmissionId);
			if (latestId) {
				return {
					submissionId: latestId,
					submissionUrl: buildAtCoderSubmissionUrl(task.contestId, latestId),
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
		submissionUrl: buildAtCoderSubmissionsMeUrl(task.contestId, {task: task.taskScreenName}),
		trackingUnavailable: true,
	};
}

export function formatMetricValue(value: string) {
	return value && String(value).trim() ? String(value).trim() : "N/A";
}

export async function pollSubmissionFinal(submissionUrl: string, cookieHeader: string): Promise<SubmissionFinalResult> {
	const started = Date.now();
	let lastStatus = "";
	const terminal = new Set(["AC", "WA", "RE", "TLE", "MLE", "CE", "OLE", "IE"]);
	while (Date.now() - started < CLI_CONFIG.submissionPollTimeoutMs) {
		const html = await httpGetText(submissionUrl, cookieHeader);
		const status = parseSubmissionStatus(html) || lastStatus || "WJ";
		if (status !== lastStatus) {
			console.log(`Status: ${colorizeStatus(status)}`);
			lastStatus = status;
		}
		if (terminal.has(status)) {
			let extra = parseExecAndMemory(html);
			if (status !== "AC") return {status, ...extra};
			const extraFetchStarted = Date.now();
			for (let i = 0; i < CLI_CONFIG.submissionTerminalExtraFetchRetry; i++) {
				if (extra.execTime && extra.memory) break;
				if (Date.now() - extraFetchStarted >= CLI_CONFIG.submissionTerminalExtraFetchMaxWaitMs) break;
				await sleep(CLI_CONFIG.submissionTerminalExtraFetchIntervalMs);
				const retryHtml = await httpGetText(submissionUrl, cookieHeader);
				extra = parseExecAndMemory(retryHtml);
			}
			return {status, ...extra};
		}
		await sleep(CLI_CONFIG.submissionPollIntervalMs);
	}
	return {status: lastStatus || "PENDING", execTime: "", memory: ""};
}
