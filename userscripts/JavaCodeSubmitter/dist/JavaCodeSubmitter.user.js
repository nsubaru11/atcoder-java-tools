// ==UserScript==
// @name           Java Code Submitter
// @name:en        Java Code Submitter
// @namespace      https://github.com/nsubaru11/atcoder-java-tools/tree/main/userscripts
// @version        1.2.4
// @description    Java のソースコードを提出する際に、パッケージ名の削除やクラス名の Main への変更を自動で行います。
// @description:en Automatically removes package declarations and renames classes to Main when submitting Java source code.
// @description:ja Java のソースコードを提出する際に、パッケージ名の削除やクラス名の Main への変更を自動で行います。
// @author         nsubaru
// @license        MIT
// @homepageURL    https://github.com/nsubaru11/atcoder-java-tools/tree/main/userscripts/JavaCodeSubmitter
// @supportURL     https://github.com/nsubaru11/atcoder-java-tools/issues
// @match          https://onlinejudge.u-aizu.ac.jp/*
// @match          https://atcoder.jp/contests/*
// @match          https://judge.yosupo.jp/problem/*
// @match          https://paiza.jp/*
// @match          https://codeforces.com/*
// @grant          unsafeWindow
// @grant          GM_xmlhttpRequest
// @connect        localhost
// @connect        127.0.0.1
// @run-at         document-end
// @icon           https://atcoder.jp/favicon.ico
// @updateURL      https://raw.githubusercontent.com/nsubaru11/atcoder-java-tools/main/userscripts/JavaCodeSubmitter/dist/JavaCodeSubmitter.user.js
// @downloadURL    https://raw.githubusercontent.com/nsubaru11/atcoder-java-tools/main/userscripts/JavaCodeSubmitter/dist/JavaCodeSubmitter.user.js
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
	// ../shared/src/local-runner.ts
	function buildLocalRunnerTransformRequest(sourceCode, debug = false, autoImport = true, validate = true) {
		return { mode: "transform", sourceCode, debug, autoImport, validate };
	}
	// JavaCodeSubmitter/src/main.ts
	(function () {
		const g = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
		const DEFAULT_SETTINGS = {
			foldMainOnPaste: true,
			logEnabled: false,
			localRunnerURL: "http://127.0.0.1:8080",
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
		const findTopLevelFinalClassLines = (source) =>
			source
				.split(
					`
`,
				)
				.map((line, index) => (/^\s*(?:public\s+)?final\s+class\s+\w+\b/.test(line) ? index : -1))
				.filter((line) => line >= 0);
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
		function localRunnerURLs() {
			const urls = [SETTINGS.localRunnerURL];
			try {
				const alternate = new URL(SETTINGS.localRunnerURL);
				if (alternate.hostname === "localhost") alternate.hostname = "127.0.0.1";
				else if (alternate.hostname === "127.0.0.1") alternate.hostname = "localhost";
				if (alternate.toString() !== SETTINGS.localRunnerURL) urls.push(alternate.toString());
			} catch {}
			return [...new Set(urls)];
		}
		function requestWithGM(url, body) {
			return new Promise((resolve, reject) => {
				GM_xmlhttpRequest({
					method: "POST",
					url,
					headers: { "Content-Type": "application/json" },
					data: body,
					timeout: 30000,
					responseType: "json",
					onload: (response) => {
						if (response.status < 200 || response.status >= 300) {
							reject(new Error(`${url}: HTTP ${response.status}`));
							return;
						}
						try {
							const parsed =
								response.response && typeof response.response === "object"
									? response.response
									: JSON.parse(response.responseText);
							resolve(parsed);
						} catch (error) {
							reject(new Error(`${url}: invalid JSON (${String(error)})`));
						}
					},
					onerror: (response) => reject(new Error(`${url}: ${response.statusText || "request failed"}`)),
					ontimeout: () => reject(new Error(`${url}: request timed out`)),
				});
			});
		}
		async function requestWithFetch(url, body) {
			const response = await fetch(url, {
				method: "POST",
				mode: "cors",
				headers: { "Content-Type": "application/json" },
				body,
			});
			if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
			return await response.json();
		}
		async function requestLocalTransform(code) {
			const body = JSON.stringify(buildLocalRunnerTransformRequest(code, false, true, false));
			const errors = [];
			if (typeof GM_xmlhttpRequest === "function") {
				for (const url of localRunnerURLs()) {
					try {
						return await requestWithGM(url, body);
					} catch (error) {
						errors.push(String(error));
					}
				}
			}
			for (const url of localRunnerURLs()) {
				try {
					return await requestWithFetch(url, body);
				} catch (error) {
					errors.push(String(error));
				}
			}
			throw new Error(errors.join(" | ") || "No LocalRunner transport is available");
		}
		function reportTransformFailure(error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(LOG_PREFIX, "LocalRunner transform failed:", error);
			document.getElementById("java-code-submitter-error")?.remove();
			const notice = document.createElement("div");
			notice.id = "java-code-submitter-error";
			notice.textContent = `Java Code Submitter: LocalRunner変換に失敗しました。コードは変更していません。
${message}`;
			Object.assign(notice.style, {
				position: "fixed",
				right: "16px",
				bottom: "16px",
				zIndex: "2147483647",
				maxWidth: "640px",
				padding: "12px 16px",
				whiteSpace: "pre-wrap",
				color: "#fff",
				background: "#b42318",
				borderRadius: "6px",
				boxShadow: "0 4px 16px rgba(0,0,0,.35)",
				fontSize: "13px",
			});
			document.body.appendChild(notice);
			setTimeout(() => notice.remove(), 20000);
		}
		async function modifyPastedCode(text) {
			const code = typeof text === "string" ? text : "";
			if (!code) return { modified: "", didModify: false };
			try {
				const transformed = await requestLocalTransform(code);
				if (transformed.status !== "success") throw new Error(transformed.diagnostics);
				if (transformed.addedImports.length) log("Added imports:", transformed.addedImports.join(", "));
				if (transformed.inlinedClasses.length) log("Bundled:", transformed.inlinedClasses.join(", "));
				return { modified: transformed.sourceCode, didModify: transformed.sourceCode !== code };
			} catch (error) {
				reportTransformFailure(error);
				return { modified: code, didModify: false };
			}
		}
		async function transformEditorSnapshot(getValue, setValue, onModified) {
			const snapshot = getValue();
			if (!snapshot || snapshot.length < 30) return;
			const { modified, didModify } = await modifyPastedCode(snapshot);
			if (!didModify || getValue() !== snapshot) return;
			setValue(modified);
			onModified();
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
			foldClasses() {}
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
				editor.on("paste", () => {
					setTimeout(
						() =>
							void transformEditorSnapshot(
								() => session.getValue(),
								(value) => session.setValue(value),
								() => {
									if (SETTINGS.foldMainOnPaste) setTimeout(() => this.foldClasses(), 100);
								},
							),
						0,
					);
				});
				this.initialized = true;
				log("ACE Adapter initialized");
				return true;
			}
			foldClasses() {
				const ace = this.getAce();
				const editor = this.getEditor();
				if (!ace || !editor) return;
				const session = editor.getSession();
				const lines = session.getValue().split(`
`);
				const classLines = findTopLevelFinalClassLines(session.getValue());
				for (const classLine of classLines) {
					const existingFold = (session.getAllFolds() || []).find((fold) => fold.start.row === classLine);
					if (existingFold) continue;
					const range = session.getFoldWidget(classLine) ? session.getFoldWidgetRange(classLine) : null;
					if (range) {
						session.addFold("...", range);
						continue;
					}
					let brace = 0,
						endLine = -1;
					for (let i = classLine; i < lines.length; i++) {
						brace += (lines[i].match(/\{/g) || []).length;
						brace -= (lines[i].match(/}/g) || []).length;
						if (i > classLine && brace === 0) {
							endLine = i;
							break;
						}
					}
					if (endLine > classLine) {
						const Range = ace.require("ace/range").Range;
						session.addFold("...", new Range(classLine, lines[classLine].length, endLine, 0));
					}
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
					editor.onDidPaste(() => {
						transformEditorSnapshot(
							() => model.getValue(),
							(value) => model.setValue(value),
							() => {
								if (SETTINGS.foldMainOnPaste) setTimeout(() => this.foldClasses(), 100);
							},
						);
					});
				} catch (err) {
					model.onDidChangeContent((e) => {
						if (e.isFlush) return;
						if (e.changes.length === 1) {
							const { text } = e.changes[0];
							if (text && text.length >= 30) {
								transformEditorSnapshot(
									() => model.getValue(),
									(value) => model.setValue(value),
									() => {
										if (SETTINGS.foldMainOnPaste) setTimeout(() => this.foldClasses(), 100);
									},
								);
							}
						}
					});
				}
				this.initialized = true;
				log("Monaco Adapter initialized");
				return true;
			}
			foldClasses() {
				const editor = this.getEditor();
				if (!editor) return;
				const model = editor.getModel();
				if (!model) return;
				const classLines = findTopLevelFinalClassLines(model.getValue()).map((line) => line + 1);
				if (!classLines.length) return;
				const position = editor.getPosition?.();
				editor.setSelections(
					classLines.map((lineNumber) => ({
						startLineNumber: lineNumber,
						startColumn: 1,
						endLineNumber: lineNumber,
						endColumn: 1,
					})),
				);
				editor.focus();
				const action = editor.getAction && editor.getAction("editor.fold");
				if (action?.run)
					Promise.resolve(action.run()).finally(() => {
						if (position) editor.setPosition(position);
					});
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
							this.active?.editor?.foldClasses();
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
				"codeforces.com",
				(e) => e.ctrlKey && e.shiftKey && isEnterKey(e),
				() =>
					document.querySelector(".submit-form .submit") ||
					document.querySelector(".submitForm .submit") ||
					document.querySelector('input[type="submit"].submit'),
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
