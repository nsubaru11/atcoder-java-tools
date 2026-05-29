// ==UserScript==
// @name           AtCoder Custom Default Submissions
// @name:en        AtCoder Custom Default Submissions
// @namespace      https://github.com/nsubaru11/AtCoder/tools/userscripts
// @version        1.6.5
// @description    AtCoderのすべての提出・自分の提出の絞り込み、並び替え設定のデフォルトを設定します。メニューから設定を変更できます。
// @description:en Sets default filters and sorting for AtCoder submission lists. Settings can be changed from the menu.
// @description:ja AtCoderのすべての提出・自分の提出の絞り込み、並び替え設定のデフォルトを設定します。メニューから設定を変更できます。
// @author         ktnyori (original), nsubaru (modified)
// @license        MIT
// @homepageURL    https://github.com/nsubaru11/AtCoder/tree/main/tools/userscripts/AtCoderCustomDefaultSubmissions
// @supportURL     https://github.com/nsubaru11/AtCoder/issues
// @match          https://atcoder.jp/contests/*
// @grant          GM_getValue
// @grant          GM_setValue
// @grant          GM_registerMenuCommand
// @icon           https://atcoder.jp/favicon.ico
// @updateURL      https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderCustomDefaultSubmissions/dist/AtCoderCustomDefaultSubmissions.user.js
// @downloadURL    https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderCustomDefaultSubmissions/dist/AtCoderCustomDefaultSubmissions.user.js
// ==/UserScript==

(() => {
	var __defProp = Object.defineProperty;
	var __getOwnPropNames = Object.getOwnPropertyNames;
	var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
	var __hasOwnProp = Object.prototype.hasOwnProperty;
	function __accessProp(key) {
		return this[key];
	}
	var __toCommonJS = (from) => {
		var entry = (__moduleCache ??= new WeakMap()).get(from),
			desc;
		if (entry) return entry;
		entry = __defProp({}, "__esModule", { value: true });
		if ((from && typeof from === "object") || typeof from === "function") {
			for (var key of __getOwnPropNames(from))
				if (!__hasOwnProp.call(entry, key))
					__defProp(entry, key, {
						get: __accessProp.bind(from, key),
						enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
					});
		}
		__moduleCache.set(from, entry);
		return entry;
	};
	var __moduleCache;

	// AtCoderCustomDefaultSubmissions/src/main.ts
	var exports_main = {};
	// ../shared/src/query.ts
	function buildQueryString(data) {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(data)) {
			if (value == null) continue;
			params.set(key, String(value));
		}
		return params.toString();
	}

	// ../shared/src/atcoder-url.ts
	var ATCODER_TASK_URL_PATTERN = /^https:\/\/atcoder\.jp\/contests\/([^/?#]+)\/tasks\/([^/?#]+)/;
	function parseAtCoderTaskUrl(url) {
		const match = url.match(ATCODER_TASK_URL_PATTERN);
		if (!match) return null;
		return {
			contestId: match[1],
			taskId: match[2],
		};
	}
	function buildAtCoderSubmissionsQuery(filter) {
		const params = {};
		if (filter.language !== undefined) params["f.LanguageName"] = filter.language;
		if (filter.status !== undefined) params["f.Status"] = filter.status;
		if (filter.orderBy !== undefined) params["orderBy"] = filter.orderBy;
		if (filter.task) params["f.Task"] = filter.task;
		return buildQueryString(params);
	}
	// ../shared/src/json.ts
	function safeJsonParse(text, fallback) {
		if (typeof text !== "string") return fallback;
		try {
			return JSON.parse(text);
		} catch {
			return fallback;
		}
	}
	function parseStoredObject(raw) {
		if (raw == null) return {};
		if (typeof raw === "string") {
			const parsed = safeJsonParse(raw, null);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed;
			}
			return {};
		}
		if (typeof raw === "object" && !Array.isArray(raw)) {
			return raw;
		}
		return {};
	}
	function mergeWithDefaults(defaults, raw) {
		return Object.assign({}, defaults, parseStoredObject(raw));
	}
	// AtCoderCustomDefaultSubmissions/src/main.ts
	(function () {
		const DEFAULTS = {
			language: "Java",
			status: "AC",
			orderBy: "time_consumption",
			includeTaskFilter: true,
		};
		function readConfig() {
			const raw = typeof GM_getValue === "function" ? GM_getValue("config") : undefined;
			return mergeWithDefaults(DEFAULTS, raw);
		}
		function writeConfig(config2) {
			if (typeof GM_setValue === "function") {
				GM_setValue("config", config2);
			}
		}
		function configureLanguage() {
			const current = readConfig();
			const language = window.prompt("Language name (e.g. Java, C#, Python3, Rust):", current.language);
			if (language === null) return;
			const next = Object.assign({}, current, {
				language: language.trim() || DEFAULTS.language,
			});
			writeConfig(next);
			window.alert("設定を保存しました。ページを再読み込みしてください。");
		}
		function configureStatus() {
			const current = readConfig();
			const status = window.prompt("Status filter (AC/WA/TLE/... or empty for all):", current.status);
			if (status === null) return;
			const next = Object.assign({}, current, {
				status: status.trim(),
			});
			writeConfig(next);
			window.alert("設定を保存しました。ページを再読み込みしてください。");
		}
		function configureOrderBy() {
			const current = readConfig();
			const orderBy = window.prompt(
				"Sort key (source_length/time_consumption/memory_consumption/score):",
				current.orderBy,
			);
			if (orderBy === null) return;
			const next = Object.assign({}, current, {
				orderBy: orderBy.trim() || DEFAULTS.orderBy,
			});
			writeConfig(next);
			window.alert("設定を保存しました。ページを再読み込みしてください。");
		}
		function toggleTaskFilter() {
			const current = readConfig();
			const next = Object.assign({}, current, {
				includeTaskFilter: !current.includeTaskFilter,
			});
			writeConfig(next);
			window.alert(`問題番号の絞り込み: ${next.includeTaskFilter ? "ON" : "OFF"}`);
		}
		function resetConfig() {
			writeConfig(Object.assign({}, DEFAULTS));
			window.alert("設定をリセットしました。ページを再読み込みしてください。");
		}
		if (typeof GM_registerMenuCommand === "function") {
			GM_registerMenuCommand("AtCoder Custom Default Submissions: 言語設定", configureLanguage);
			GM_registerMenuCommand("AtCoder Custom Default Submissions: 結果フィルタ設定", configureStatus);
			GM_registerMenuCommand("AtCoder Custom Default Submissions: 並び順設定", configureOrderBy);
			GM_registerMenuCommand("AtCoder Custom Default Submissions: 問題番号絞り込み切替", toggleTaskFilter);
			GM_registerMenuCommand("AtCoder Custom Default Submissions: 設定リセット", resetConfig);
		}
		function getTaskId() {
			return parseAtCoderTaskUrl(location.href)?.taskId ?? "";
		}
		function buildSubmissionQuery(config2, task2) {
			return buildAtCoderSubmissionsQuery({
				language: config2.language,
				status: config2.status,
				orderBy: config2.orderBy,
				task: task2 || undefined,
			});
		}
		function isSubmissionLink(url) {
			return /\/submissions(?:\/me)?\/?$/.test(url.pathname);
		}
		const config = readConfig();
		const task = config.includeTaskFilter ? getTaskId() : "";
		const querystring = buildSubmissionQuery(config, task);
		const links = document.querySelectorAll("#contest-nav-tabs a");
		for (let i = 0; i < links.length; i++) {
			const href = links[i].getAttribute("href");
			if (!href) continue;
			const url = new URL(href, location.origin);
			if (!isSubmissionLink(url)) continue;
			url.search = querystring;
			links[i].setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
		}
	})();
})();
