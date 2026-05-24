// ==UserScript==
// @name        Java Code Submitter
// @namespace   https://github.com/nsubaru11/AtCoder/tools/userscripts
// @version     1.0.6
// @description Java submission helper (Main/DEBUG/fold/shortcuts)
// @author      nsubaru11
// @license     MIT
// @homepageURL https://github.com/nsubaru11/AtCoder/tree/main/tools/userscripts/JavaCodeSubmitter
// @supportURL  https://github.com/nsubaru11/AtCoder/issues
// @match       https://onlinejudge.u-aizu.ac.jp/*
// @match       https://atcoder.jp/contests/*
// @match       https://judge.yosupo.jp/problem/*
// @match       https://paiza.jp/*
// @grant       unsafeWindow
// @run-at      document-end
// @updateURL   https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/JavaCodeSubmitter/dist/JavaCodeSubmitter.user.js
// @downloadURL https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/JavaCodeSubmitter/dist/JavaCodeSubmitter.user.js
// ==/UserScript==

(() => {
	// JavaCodeSubmitter/src/main.ts
	(function () {
		const g = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
		const DEFAULT_SETTINGS = {
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
				const parsed = JSON.parse(raw);
				return Object.assign({}, DEFAULT_SETTINGS, parsed);
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
		const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		function maskJava(text) {
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
					if (
						c ===
						`
`
					) {
						inLineComment = false;
						out.push(`
`);
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
					out.push(
						c ===
							`
`
							? `
`
							: " ",
					);
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
					if (c === '"') {
						inString = false;
						out.push(" ");
						continue;
					}
					out.push(
						c ===
							`
`
							? `
`
							: " ",
					);
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
					out.push(
						c ===
							`
`
							? `
`
							: " ",
					);
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
				if (c === '"') {
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
				else if (c === "}") {
					depth--;
					if (depth === 0) return i;
				}
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
			const head = maskedText.slice(lineStart, classKeywordIndex);
			return /\bpublic\b/.test(head);
		}
		function findMainClassInfo(text, maskedText) {
			const masked = maskedText || maskJava(text);
			const MAIN_REGEX = /(?:\bpublic\s+static|\bstatic\s+public)\s+void\s+main\s*\(\s*String\s*(?:\[]|\.\.\.)/;
			const mainMatch = MAIN_REGEX.exec(masked);
			const mainIndex = mainMatch ? mainMatch.index : -1;
			const CLASS_REGEX = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
			const candidates = [];
			let m;
			while ((m = CLASS_REGEX.exec(masked)) !== null) {
				const name = m[1];
				const classStart = m.index;
				const nameStart = classStart + m[0].lastIndexOf(name);
				const nameEnd = nameStart + name.length;
				const openBraceIdx = masked.indexOf("{", nameEnd);
				if (openBraceIdx === -1) continue;
				const closeBraceIdx = findMatchingBrace(masked, openBraceIdx);
				const isPublic = isPublicClass(masked, classStart);
				const info = { name, nameStart, nameEnd, classStart, openBraceIdx, closeBraceIdx, isPublic };
				candidates.push(info);
				if (mainIndex !== -1 && closeBraceIdx !== -1 && mainIndex > classStart && mainIndex < closeBraceIdx) {
					return info;
				}
			}
			if (!candidates.length) return null;
			return candidates.find((c) => c.isPublic) || candidates[0];
		}
		function modifyPastedCode(text) {
			let modified =
				typeof text === "string"
					? text.replace(
							/\r\n?/g,
							`
`,
						)
					: "";
			let classReplaced = false;
			let debugReplaced = false;
			const masked = maskJava(modified);
			const replacements = [];
			const applyReplacements = () => {
				if (!replacements.length) return;
				replacements.sort((a, b) => b.start - a.start);
				for (const r of replacements) {
					modified = modified.slice(0, r.start) + r.text + modified.slice(r.end);
				}
			};
			if (SETTINGS.renameClass) {
				const info = findMainClassInfo(modified, masked);
				if (info && info.name && info.name !== "Main") {
					const oldName = info.name;
					const newName = "Main";
					replacements.push({ start: info.nameStart, end: info.nameEnd, text: newName });
					const refRegex = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, "g");
					refRegex.lastIndex = info.nameEnd;
					let rm;
					while ((rm = refRegex.exec(masked)) !== null) {
						replacements.push({ start: rm.index, end: rm.index + oldName.length, text: newName });
					}
					classReplaced = true;
				}
			}
			if (SETTINGS.fixDebug) {
				const DEBUG_REGEX = /\bDEBUG\s*=\s*true\s*;/g;
				let dm;
				while ((dm = DEBUG_REGEX.exec(masked)) !== null) {
					const seg = modified.slice(dm.index, dm.index + dm[0].length);
					const replacedSeg = seg.replace(/\btrue\b/, "false");
					if (seg !== replacedSeg) {
						replacements.push({ start: dm.index, end: dm.index + dm[0].length, text: replacedSeg });
						debugReplaced = true;
					}
				}
			}
			applyReplacements();
			if (classReplaced) log("Class renamed to Main");
			if (debugReplaced) log("DEBUG flag disabled");
			return { modified, didModify: classReplaced || debugReplaced };
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

		class SmartSubmitter {
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
						if (this.active.shortcut(event)) {
							const btn = this.active.findSubmitButton();
							if (btn) {
								event.preventDefault();
								event.stopPropagation();
								clickElementRobust(btn);
								log("Submit button clicked");
							}
						} else if (event.ctrlKey && event.shiftKey && (event.key === "M" || event.key === "m")) {
							event.preventDefault();
							event.stopPropagation();
							this.active.editor && this.active.editor.foldMain();
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
		const submitter = new SmartSubmitter(g);
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
