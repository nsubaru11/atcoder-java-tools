// ==UserScript==
// @name           Java Code Submitter
// @name:en        Java Code Submitter
// @namespace      https://github.com/nsubaru/AtCoder/tools/userscripts
// @version        1.0.8
// @description    Java のソースコードを提出する際に、パッケージ名の削除やクラス名の Main への変更を自動で行います。
// @description:en Automatically removes package declarations and renames classes to Main when submitting Java source code.
// @description:ja Java のソースコードを提出する際に、パッケージ名の削除やクラス名の Main への変更を自動で行います。
// @author         nsubaru
// @license        MIT
// @homepageURL    https://github.com/nsubaru/AtCoder/tree/main/tools/userscripts/JavaCodeSubmitter
// @supportURL     https://github.com/nsubaru/AtCoder/issues
// @match          https://onlinejudge.u-aizu.ac.jp/*
// @match          https://atcoder.jp/contests/*
// @match          https://judge.yosupo.jp/problem/*
// @match          https://paiza.jp/*
// @grant          unsafeWindow
// @run-at         document-end
// @icon           https://atcoder.jp/favicon.ico
// @updateURL      https://raw.githubusercontent.com/nsubaru/AtCoder/main/tools/userscripts/JavaCodeSubmitter/dist/JavaCodeSubmitter.user.js
// @downloadURL    https://raw.githubusercontent.com/nsubaru/AtCoder/main/tools/userscripts/JavaCodeSubmitter/dist/JavaCodeSubmitter.user.js
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

	// JavaCodeSubmitter/src/main.ts
	var exports_main = {};
	// ../shared/src/utils.ts
	function normalizeNewlines(text) {
		return text.replace(
			/\r\n?/g,
			`
`,
		);
	}

	// ../shared/src/java-transform.ts
	function createMaskedCode(text) {
		var State;
		((State2) => {
			State2[(State2["Normal"] = 0)] = "Normal";
			State2[(State2["LineComment"] = 1)] = "LineComment";
			State2[(State2["BlockComment"] = 2)] = "BlockComment";
			State2[(State2["String"] = 3)] = "String";
			State2[(State2["Char"] = 4)] = "Char";
		})((State ||= {}));
		const out = [];
		let state = 0; /* Normal */
		let isEscape = false;
		const mask = (c) =>
			c ===
			`
`
				? `
`
				: " ";
		for (let i = 0, len = text.length; i < len; i++) {
			const c = text[i],
				n = i + 1 < len ? text[i + 1] : "";
			if (state === 1 /* LineComment */) {
				out.push(mask(c));
				if (
					c ===
					`
`
				)
					state = 0 /* Normal */;
			} else if (state === 2 /* BlockComment */) {
				if (c === "*" && n === "/") {
					out.push(" ", " ");
					i++;
					state = 0 /* Normal */;
				} else {
					out.push(mask(c));
				}
			} else if (state === 3 /* String */ || state === 4 /* Char */) {
				const closeChar = state === 3 /* String */ ? '"' : "'";
				if (isEscape) {
					isEscape = false;
					out.push(" ");
				} else if (c === "\\") {
					isEscape = true;
					out.push(" ");
				} else if (c === closeChar) {
					state = 0 /* Normal */;
					out.push(" ");
				} else {
					out.push(mask(c));
				}
			} else {
				if (c === "/" && n === "/") {
					out.push(" ", " ");
					i++;
					state = 1 /* LineComment */;
				} else if (c === "/" && n === "*") {
					out.push(" ", " ");
					i++;
					state = 2 /* BlockComment */;
				} else if (c === '"') {
					state = 3 /* String */;
					out.push(" ");
				} else if (c === "'") {
					state = 4 /* Char */;
					out.push(" ");
				} else {
					out.push(c);
				}
			}
		}
		return out.join("");
	}
	function findMatchingBrace(maskedText, openBraceIdx) {
		let depth = 1;
		for (let i = openBraceIdx + 1; i < maskedText.length; i++) {
			if (maskedText[i] === "{") depth++;
			else if (maskedText[i] === "}" && --depth === 0) return i;
		}
		return -1;
	}
	function isPublicClass(maskedText, classKeywordIndex) {
		const lineStart =
			maskedText.lastIndexOf(
				`
`,
				classKeywordIndex,
			) + 1;
		return /\bpublic\b/.test(maskedText.slice(lineStart, classKeywordIndex));
	}
	function buildClassInfo(maskedText, m) {
		const name = m[1];
		const classStart = m.index;
		const nameStart = classStart + m[0].length - name.length;
		const nameEnd = nameStart + name.length;
		const openBraceIdx = maskedText.indexOf("{", nameEnd);
		if (openBraceIdx === -1) return null;
		return {
			name,
			nameStart,
			nameEnd,
			classStart,
			closeBraceIdx: findMatchingBrace(maskedText, openBraceIdx),
			isPublic: isPublicClass(maskedText, classStart),
		};
	}
	function findMainClassInfo(maskedText) {
		const mainIndex =
			/(?:\bpublic\s+static|\bstatic\s+public)\s+void\s+main\s*\(\s*String\s*(?:\[]|\.\.\.)/.exec(maskedText)
				?.index ?? -1;
		const classRegex = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
		const candidates = [];
		let m;
		while ((m = classRegex.exec(maskedText)) !== null) {
			const info = buildClassInfo(maskedText, m);
			if (!info) continue;
			candidates.push(info);
			if (
				mainIndex !== -1 &&
				info.closeBraceIdx !== -1 &&
				mainIndex > info.classStart &&
				mainIndex < info.closeBraceIdx
			) {
				return info;
			}
		}
		return candidates.find((c) => c.isPublic) ?? candidates[0] ?? null;
	}
	function removePackageDeclaration(maskedCode, currentCode) {
		const m = /\bpackage\s+[A-Za-z_][A-Za-z0-9_.]*\s*;/.exec(maskedCode);
		if (!m) return { code: currentCode, modified: false };
		let end = m.index + m[0].length;
		if (
			currentCode[end] ===
			`
`
		)
			end++;
		return {
			code: currentCode.slice(0, m.index) + currentCode.slice(end),
			modified: true,
		};
	}
	function renameClassToMain(maskedCode, currentCode) {
		const info = findMainClassInfo(maskedCode);
		if (!info || info.name === "Main") return { code: currentCode, modified: false };
		const escapedName = info.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const refRegex = new RegExp(`\\b${escapedName}\\b`, "g");
		const replacements = [];
		let rm;
		while ((rm = refRegex.exec(maskedCode)) !== null) {
			replacements.push({ start: rm.index, end: rm.index + info.name.length });
		}
		replacements.sort((a, b) => b.start - a.start);
		let code = currentCode;
		for (const { start, end } of replacements) {
			code = code.slice(0, start) + "Main" + code.slice(end);
		}
		return { code, modified: true };
	}
	function disableDebugStatements(maskedCode, currentCode) {
		const debugRegex = /\bDEBUG\b\s*=\s*true\b/g;
		const replacements = [];
		let dm;
		while ((dm = debugRegex.exec(maskedCode)) !== null) {
			const trueIdx = dm.index + dm[0].lastIndexOf("true");
			replacements.push({ start: trueIdx, end: trueIdx + 4 });
		}
		if (!replacements.length) return { code: currentCode, modified: false };
		replacements.sort((a, b) => b.start - a.start);
		let code = currentCode;
		for (const { start, end } of replacements) {
			code = code.slice(0, start) + "false" + code.slice(end);
		}
		return { code, modified: true };
	}
	function modifyJavaCode(originalCode, options) {
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
		return { modified: currentCode, packageRemoved, classReplaced, debugReplaced };
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
	// JavaCodeSubmitter/src/main.ts
	(function () {
		const g = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
		const DEFAULT_SETTINGS = {
			removePackage: true,
			renameClass: true,
			fixDebug: true,
			foldMainOnPaste: true,
			logEnabled: false,
		};
		function loadSettings() {
			try {
				const ls = g.localStorage;
				if (!ls) return DEFAULT_SETTINGS;
				const raw = ls.getItem("smartSubmitterSettings");
				if (!raw) return DEFAULT_SETTINGS;
				return mergeWithDefaults(DEFAULT_SETTINGS, safeJsonParse(raw, null));
			} catch {
				return DEFAULT_SETTINGS;
			}
		}
		const SETTINGS = loadSettings();
		const LOG_PREFIX = "[Java Code Submitter]";
		const log = (...args) => {
			if (!SETTINGS.logEnabled) return;
			try {
				const fn = console && (console.debug || console.log) ? console.debug || console.log : null;
				if (fn) fn.call(console, LOG_PREFIX, ...args);
			} catch {}
		};
		const isEnterKey = (e) => e.key === "Enter" || e.keyCode === 13;
		const clickElementRobust = (el) => {
			if (!el) return;
			try {
				el.click();
				return;
			} catch {}
			try {
				el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
			} catch {}
		};
		function modifyPastedCode(text) {
			const code = typeof text === "string" ? text : "";
			if (!code) return { modified: "", didModify: false };
			const result = modifyJavaCode(code, {
				removePackage: SETTINGS.removePackage,
				renameClass: SETTINGS.renameClass,
				fixDebug: SETTINGS.fixDebug,
			});
			const didModify = result.classReplaced || result.debugReplaced;
			if (result.classReplaced) log("Class renamed to Main");
			if (result.debugReplaced) log("DEBUG flag disabled");
			return { modified: result.modified, didModify };
		}

		class EditorAdapter {
			g;
			initialized;
			constructor(globalObj) {
				this.g = globalObj || g;
				this.initialized = false;
			}
			setup() {
				return false;
			}
			foldMain() {}
		}

		class AceEditorAdapter extends EditorAdapter {
			getAce() {
				return this.g && this.g.ace;
			}
			getEditorDiv() {
				return document.getElementById("editor") || document.getElementById("editor-div");
			}
			getEditor() {
				const ace = this.getAce();
				const div = this.getEditorDiv();
				if (!ace || !div) return null;
				try {
					return ace.edit(div);
				} catch {
					return null;
				}
			}
			setup() {
				const editor = this.getEditor();
				if (!editor) return false;
				if (this.initialized) return true;
				const session = editor.getSession && editor.getSession();
				const modeId = (session && (session.$modeId || (session.getMode && session.getMode().$id))) || "";
				if (modeId && !/java/i.test(modeId)) return false;
				editor.on("paste", (e) => {
					if (e && typeof e.text === "string") {
						const { modified, didModify } = modifyPastedCode(e.text);
						if (didModify) {
							e.text = modified;
							if (SETTINGS.foldMainOnPaste) setTimeout(() => this.foldMain(), 100);
						}
					}
				});
				this.initialized = true;
				log("ACE Adapter initialized");
				return true;
			}
			foldMain() {
				const ace = this.getAce();
				const editor = this.getEditor();
				if (!ace || !editor) return;
				const session = editor.getSession();
				const lines = session.getValue().split(`
`);
				const mainLine = lines.findIndex((l) => /class\s+Main\s*(\{|extends|implements)/.test(l));
				if (mainLine === -1) return;
				const existingFold = (session.getAllFolds() || []).find((fold) => fold.start.row === mainLine);
				if (existingFold) {
					session.expandFold(existingFold);
					return;
				}
				const widget = session.getFoldWidget(mainLine);
				if (widget) {
					const range = session.getFoldWidgetRange(mainLine);
					if (range) {
						session.addFold("...", range);
						return;
					}
				}
				let brace = 0,
					endLine = -1;
				for (let i = mainLine; i < lines.length; i++) {
					brace += (lines[i].match(/\{/g) || []).length;
					brace -= (lines[i].match(/}/g) || []).length;
					if (i > mainLine && brace === 0) {
						endLine = i;
						break;
					}
				}
				if (endLine > mainLine) {
					const Range = ace.require("ace/range").Range;
					const foldRange = new Range(mainLine, lines[mainLine].length, endLine, 0);
					session.addFold("...", foldRange);
				}
			}
		}

		class MonacoEditorAdapter extends EditorAdapter {
			getMonaco() {
				return this.g && this.g.monaco;
			}
			getEditor() {
				const monaco = this.getMonaco();
				if (!monaco || !monaco.editor) return null;
				const editors = monaco.editor.getEditors();
				return editors && editors.length ? editors[0] : null;
			}
			setup() {
				const editor = this.getEditor();
				if (!editor) return false;
				if (this.initialized) return true;
				const model = editor.getModel && editor.getModel();
				if (!model) return false;
				if (model.getLanguageId && model.getLanguageId() !== "java") return false;
				try {
					editor.onDidPaste((e) => {
						const pastedText = model.getValueInRange(e.range);
						const { modified, didModify } = modifyPastedCode(pastedText);
						if (didModify) {
							editor.executeEdits("uss-paste", [{ range: e.range, text: modified }]);
							if (SETTINGS.foldMainOnPaste) setTimeout(() => this.foldMain(), 100);
						}
					});
				} catch (err) {
					model.onDidChangeContent((e) => {
						if (e.isFlush) return;
						if (e.changes.length === 1) {
							const { text, range } = e.changes[0];
							if (text && text.length >= 30) {
								const { modified, didModify } = modifyPastedCode(text);
								if (didModify) {
									editor.executeEdits("uss-change", [{ range, text: modified }]);
									if (SETTINGS.foldMainOnPaste) setTimeout(() => this.foldMain(), 100);
								}
							}
						}
					});
				}
				this.initialized = true;
				log("Monaco Adapter initialized");
				return true;
			}
			foldMain() {
				const editor = this.getEditor();
				if (!editor) return;
				const model = editor.getModel();
				if (!model) return;
				const lines = model.getValue().split(`
`);
				let mainLine = -1;
				for (let i = 0; i < lines.length; i++) {
					if (/class\s+Main\s*(\{|extends|implements)/.test(lines[i])) {
						mainLine = i + 1;
						break;
					}
				}
				if (mainLine === -1) return;
				editor.setPosition({ lineNumber: mainLine, column: 1 });
				editor.focus();
				const action = editor.getAction && editor.getAction("editor.toggleFold");
				if (action && action.run) action.run();
			}
		}

		class Site {
			hostSubstr;
			shortcut;
			getSubmitButton;
			editor;
			_cachedBtn;
			constructor(hostSubstr, shortcutFn, submitButtonGetter, editorAdapter) {
				this.hostSubstr = hostSubstr;
				this.shortcut = shortcutFn;
				this.getSubmitButton = submitButtonGetter;
				this.editor = editorAdapter;
				this._cachedBtn = null;
			}
			matches(hostname) {
				return hostname.includes(this.hostSubstr);
			}
			findSubmitButton() {
				if (this._cachedBtn && document.contains(this._cachedBtn)) return this._cachedBtn;
				const btn = this.getSubmitButton && this.getSubmitButton();
				if (btn) this._cachedBtn = btn;
				return btn;
			}
		}

		class JavaCodeSubmitter {
			g;
			sites;
			active;
			_keybound;
			constructor(globalObj) {
				this.g = globalObj || g;
				this.sites = [];
				this.active = null;
				this._keybound = false;
			}
			registerSite(site) {
				this.sites.push(site);
			}
			detect() {
				const host = window.location.hostname;
				this.active = this.sites.find((s) => s.matches(host)) || null;
				if (this.active) log("Initialized for:", host);
				return !!this.active;
			}
			setupEditorLazy() {
				if (!this.active) return;
				const trySetup = () => this.active && this.active.editor && this.active.editor.setup();
				if (trySetup()) return;
				const observer = new MutationObserver(() => {
					if (trySetup()) observer.disconnect();
				});
				observer.observe(document.body, { childList: true, subtree: true });
				setTimeout(() => observer.disconnect(), 30000);
			}
			registerKeybindings() {
				if (!this.active || this._keybound) return;
				this._keybound = true;
				const isInEditor = (target) => {
					try {
						const element = target;
						return !!(
							element &&
							element.closest &&
							element.closest(".ace_editor, .monaco-editor, #editor, #editor-div")
						);
					} catch {
						return false;
					}
				};
				const isProbablyEditable = (target) => {
					if (!target) return false;
					const element = target;
					const tag = String(element.tagName || "").toUpperCase();
					if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
					return !!element.isContentEditable;
				};
				document.addEventListener(
					"keydown",
					(event) => {
						if (isProbablyEditable(event.target) && !isInEditor(event.target)) return;
						if (this.active?.shortcut(event)) {
							const btn = this.active?.findSubmitButton();
							if (btn) {
								event.preventDefault();
								event.stopPropagation();
								clickElementRobust(btn);
								log("Submit button clicked");
							}
						} else if (event.ctrlKey && event.shiftKey && (event.key === "M" || event.key === "m")) {
							event.preventDefault();
							event.stopPropagation();
							this.active?.editor?.foldMain();
						}
					},
					true,
				);
			}
			start() {
				if (!this.detect()) return;
				this.registerKeybindings();
				setTimeout(() => this.setupEditorLazy(), 500);
			}
		}
		const submitter = new JavaCodeSubmitter(g);
		submitter.registerSite(
			new Site(
				"onlinejudge.u-aizu.ac.jp",
				(e) => e.ctrlKey && !e.shiftKey && isEnterKey(e),
				() => document.querySelector(".editorFooter .submitBtn") || document.getElementById("submit_button"),
				new AceEditorAdapter(g),
			),
		);
		submitter.registerSite(
			new Site(
				"atcoder.jp",
				(e) => e.ctrlKey && e.shiftKey && isEnterKey(e),
				() => document.getElementById("submit"),
				new AceEditorAdapter(g),
			),
		);
		submitter.registerSite(
			new Site(
				"judge.yosupo.jp",
				(e) => e.ctrlKey && e.shiftKey && e.altKey && isEnterKey(e),
				() => {
					const forms = document.querySelectorAll("form");
					for (const form of forms) {
						const buttons = form.querySelectorAll('button[type="submit"], input[type="submit"]');
						for (const btn of buttons) {
							const text = (btn.textContent || "").trim().toLowerCase();
							if (text.includes("提出") || text.includes("submit")) return btn;
						}
					}
					return null;
				},
				new MonacoEditorAdapter(g),
			),
		);
		submitter.registerSite(
			new Site(
				"paiza.jp",
				(e) => {
					if (!e.ctrlKey || e.shiftKey) return false;
					return isEnterKey(e);
				},
				() => {
					const a = document.getElementById("handin");
					if (a) return a;
					const clickable = Array.from(
						document.querySelectorAll('a,button,input[type="button"],input[type="submit"]'),
					);
					for (const el of clickable) {
						const oc = String(el.getAttribute("onclick") || "");
						if (oc.includes("hand_in_code")) return el;
					}
					for (const el of clickable) {
						const text = String(
							el.textContent || (el instanceof HTMLInputElement ? el.value : "") || "",
						).trim();
						if (!text) continue;
						if (text.includes("コードを提出する")) return el;
						if (text === "提出" || text.includes("提出する")) return el;
					}
					return null;
				},
				new AceEditorAdapter(g),
			),
		);
		submitter.start();
	})();
})();
