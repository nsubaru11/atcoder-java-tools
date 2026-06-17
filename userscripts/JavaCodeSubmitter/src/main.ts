import {mergeWithDefaults, modifyJavaCode, safeJsonParse} from "@atcoder-tools/shared";

(function () {
	'use strict';

	type SubmitterSettings = typeof DEFAULT_SETTINGS;

	const g = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

	// --------------- Utilities ---------------
	const DEFAULT_SETTINGS = {
		// パッケージ宣言を削除するか
		removePackage: true,
		// Java のクラス名を Main に強制変更するか
		renameClass: true,
		// DEBUG = true を自動的に false に強制するか
		fixDebug: true,
		// 貼り付け後に Main クラスを自動折りたたみするか
		foldMainOnPaste: true,
		// デバッグログを有効化するか
		logEnabled: false,
	};

	function loadSettings(): SubmitterSettings {
		try {
			const ls = g.localStorage;
			if (!ls) return DEFAULT_SETTINGS;
			const raw = ls.getItem('smartSubmitterSettings');
			if (!raw) return DEFAULT_SETTINGS;
			return mergeWithDefaults(DEFAULT_SETTINGS, safeJsonParse(raw, null));
		} catch {
			return DEFAULT_SETTINGS;
		}
	}

	const SETTINGS = loadSettings();

	const LOG_PREFIX = '[Java Code Submitter]';
	const log = (...args: unknown[]): void => {
		if (!SETTINGS.logEnabled) return;
		try {
			const fn = (console && (console.debug || console.log)) ? (console.debug || console.log) : null;
			if (fn) fn.call(console, LOG_PREFIX, ...args);
		} catch {
			// noop
		}
	};
	const isEnterKey = (e: KeyboardEvent): boolean => e.key === 'Enter' || e.keyCode === 13;
	const clickElementRobust = (el: Element | null): void => {
		if (!el) return;
		try {
			(el as HTMLElement).click();
			return;
		} catch {
			// fallback
		}
		try {
			el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
		} catch {
			// noop
		}
	};

	/**
	 * ペーストされたコードを自動修正する
	 */
	function modifyPastedCode(text: unknown): { modified: string; didModify: boolean } {
		const code = (typeof text === 'string') ? text : '';
		if (!code) return {modified: '', didModify: false};

		const result = modifyJavaCode(code, {
			removePackage: SETTINGS.removePackage,
			renameClass: SETTINGS.renameClass,
			fixDebug: SETTINGS.fixDebug,
		});

		const didModify = result.classReplaced || result.debugReplaced;
		if (result.classReplaced) log('Class renamed to Main');
		if (result.debugReplaced) log('DEBUG flag disabled');

		return {modified: result.modified, didModify};
	}

	// --------------- Editor Adapters ---------------
	class EditorAdapter {
		g: any;
		initialized: boolean;

		constructor(globalObj: unknown) {
			this.g = globalObj || g;
			this.initialized = false;
		}

		setup(): boolean {
			return false;
		}

		foldMain(): void {
		}
	}

	class AceEditorAdapter extends EditorAdapter {
		getAce(): any {
			return this.g && this.g.ace;
		}

		getEditorDiv(): HTMLElement | null {
			return document.getElementById('editor') || document.getElementById('editor-div');
		}

		getEditor(): any {
			const ace = this.getAce();
			const div = this.getEditorDiv();
			if (!ace || !div) return null;
			try {
				return ace.edit(div);
			} catch {
				return null;
			}
		}

		setup(): boolean {
			const editor = this.getEditor();
			if (!editor) return false;
			if (this.initialized) return true;

			const session = editor.getSession && editor.getSession();
			const modeId = (session && (session.$modeId || (session.getMode && session.getMode().$id))) || '';
			if (modeId && !/java/i.test(modeId)) return false;

			editor.on('paste', (e: { text?: string }) => {
				if (e && typeof e.text === 'string') {
					const {modified, didModify} = modifyPastedCode(e.text);
					if (didModify) {
						e.text = modified;
						if (SETTINGS.foldMainOnPaste) setTimeout(() => this.foldMain(), 100);
					}
				}
			});
			this.initialized = true;
			log('ACE Adapter initialized');
			return true;
		}

		foldMain(): void {
			const ace = this.getAce();
			const editor = this.getEditor();
			if (!ace || !editor) return;
			const session = editor.getSession();
			const lines = session.getValue().split('\n');
			const mainLine = lines.findIndex((l: string) => /class\s+Main\s*(\{|extends|implements)/.test(l));
			if (mainLine === -1) return;

			const existingFold = (session.getAllFolds() || []).find((fold: any) => fold.start.row === mainLine);
			if (existingFold) {
				session.expandFold(existingFold);
				return;
			}
			const widget = session.getFoldWidget(mainLine);
			if (widget) {
				const range = session.getFoldWidgetRange(mainLine);
				if (range) {
					session.addFold('...', range);
					return;
				}
			}
			// マニュアルフォールド
			let brace = 0, endLine = -1;
			// ここも厳密には文字列考慮が必要だが、フォールディングなので簡易版のままでOK
			for (let i = mainLine; i < lines.length; i++) {
				brace += (lines[i].match(/\{/g) || []).length;
				brace -= (lines[i].match(/}/g) || []).length;
				if (i > mainLine && brace === 0) {
					endLine = i;
					break;
				}
			}
			if (endLine > mainLine) {
				const Range = ace.require('ace/range').Range;
				const foldRange = new Range(mainLine, lines[mainLine].length, endLine, 0);
				session.addFold('...', foldRange);
			}
		}
	}

	class MonacoEditorAdapter extends EditorAdapter {
		getMonaco(): any {
			return this.g && this.g.monaco;
		}

		getEditor(): any {
			const monaco = this.getMonaco();
			if (!monaco || !monaco.editor) return null;
			const editors = monaco.editor.getEditors();
			return (editors && editors.length) ? editors[0] : null;
		}

		setup(): boolean {
			const editor = this.getEditor();
			if (!editor) return false;
			if (this.initialized) return true;

			const model = editor.getModel && editor.getModel();
			if (!model) return false;
			if (model.getLanguageId && model.getLanguageId() !== 'java') return false;

			try {
				editor.onDidPaste((e: any) => {
					const pastedText = model.getValueInRange(e.range);
					const {modified, didModify} = modifyPastedCode(pastedText);
					if (didModify) {
						editor.executeEdits('uss-paste', [{range: e.range, text: modified}]);
						if (SETTINGS.foldMainOnPaste) setTimeout(() => this.foldMain(), 100);
					}
				});
			} catch (err) {
				model.onDidChangeContent((e: any) => {
					if (e.isFlush) return;
					if (e.changes.length === 1) {
						const {text, range} = e.changes[0];
						if (text && text.length >= 30) {
							const {modified, didModify} = modifyPastedCode(text);
							if (didModify) {
								editor.executeEdits('uss-change', [{range, text: modified}]);
								if (SETTINGS.foldMainOnPaste) setTimeout(() => this.foldMain(), 100);
							}
						}
					}
				});
			}
			this.initialized = true;
			log('Monaco Adapter initialized');
			return true;
		}

		foldMain(): void {
			const editor = this.getEditor();
			if (!editor) return;
			const model = editor.getModel();
			if (!model) return;
			const lines = model.getValue().split('\n');
			let mainLine = -1;
			for (let i = 0; i < lines.length; i++) {
				if (/class\s+Main\s*(\{|extends|implements)/.test(lines[i])) {
					mainLine = i + 1;
					break;
				}
			}
			if (mainLine === -1) return;
			editor.setPosition({lineNumber: mainLine, column: 1});
			editor.focus();
			const action = editor.getAction && editor.getAction('editor.toggleFold');
			if (action && action.run) action.run();
		}
	}

	// --------------- Orchestrator ---------------
	class Site {
		hostSubstr: string;
		shortcut: (event: KeyboardEvent) => boolean;
		getSubmitButton: () => Element | null;
		editor: EditorAdapter;
		_cachedBtn: Element | null;

		constructor(hostSubstr: string, shortcutFn: (event: KeyboardEvent) => boolean, submitButtonGetter: () => Element | null, editorAdapter: EditorAdapter) {
			this.hostSubstr = hostSubstr;
			this.shortcut = shortcutFn;
			this.getSubmitButton = submitButtonGetter;
			this.editor = editorAdapter;
			this._cachedBtn = null;
		}

		matches(hostname: string): boolean {
			return hostname.includes(this.hostSubstr);
		}

		findSubmitButton(): Element | null {
			if (this._cachedBtn && document.contains(this._cachedBtn)) return this._cachedBtn;
			const btn = this.getSubmitButton && this.getSubmitButton();
			if (btn) this._cachedBtn = btn;
			return btn;
		}
	}

	class JavaCodeSubmitter {
		g: any;
		sites: Site[];
		active: Site | null;
		_keybound: boolean;

		constructor(globalObj: unknown) {
			this.g = globalObj || g;
			this.sites = [];
			this.active = null;
			this._keybound = false;
		}

		registerSite(site: Site): void {
			this.sites.push(site);
		}

		detect(): boolean {
			const host = window.location.hostname;
			this.active = this.sites.find((s: Site) => s.matches(host)) || null;
			if (this.active) log('Initialized for:', host);
			return !!this.active;
		}

		setupEditorLazy(): void {
			if (!this.active) return;
			const trySetup = (): boolean | null => this.active && this.active.editor && this.active.editor.setup();
			if (trySetup()) return;
			const observer = new MutationObserver(() => {
				if (trySetup()) observer.disconnect();
			});
			observer.observe(document.body, {childList: true, subtree: true});
			setTimeout(() => observer.disconnect(), 30000);
		}

		registerKeybindings(): void {
			if (!this.active || this._keybound) return;
			this._keybound = true;
			const isInEditor = (target: EventTarget | null): boolean => {
				try {
					const element = target as Element | null;
					return !!(element && element.closest && element.closest('.ace_editor, .monaco-editor, #editor, #editor-div'));
				} catch {
					return false;
				}
			};
			const isProbablyEditable = (target: EventTarget | null): boolean => {
				if (!target) return false;
				const element = target as HTMLElement;
				const tag = String(element.tagName || '').toUpperCase();
				if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
				return !!element.isContentEditable;
			};
			document.addEventListener('keydown', (event) => {
				// エディタ以外の入力欄での暴発を抑止
				if (isProbablyEditable(event.target) && !isInEditor(event.target)) return;
				if (this.active?.shortcut(event)) {
					const btn = this.active?.findSubmitButton();
					if (btn) {
						event.preventDefault();
						event.stopPropagation();
						clickElementRobust(btn);
						log('Submit button clicked');
					}
				} else if (event.ctrlKey && event.shiftKey && (event.key === 'M' || event.key === 'm')) {
					event.preventDefault();
					event.stopPropagation();
					this.active?.editor?.foldMain();
				}
			}, true);
		}

		start(): void {
			if (!this.detect()) return;
			this.registerKeybindings();
			setTimeout(() => this.setupEditorLazy(), 500);
		}
	}

	const submitter = new JavaCodeSubmitter(g);

	// AOJ
	submitter.registerSite(new Site(
		'onlinejudge.u-aizu.ac.jp',
		(e) => e.ctrlKey && !e.shiftKey && isEnterKey(e),
		() => document.querySelector('.editorFooter .submitBtn') || document.getElementById('submit_button'),
		new AceEditorAdapter(g)
	));

	// AtCoder
	submitter.registerSite(new Site(
		'atcoder.jp',
		(e) => e.ctrlKey && e.shiftKey && isEnterKey(e),
		() => document.getElementById('submit'),
		new AceEditorAdapter(g)
	));

	// Codeforces
	submitter.registerSite(new Site(
		'codeforces.com',
		(e) => e.ctrlKey && e.shiftKey && isEnterKey(e),
		() => document.querySelector('.submit-form .submit')
			|| document.querySelector('.submitForm .submit')
			|| document.querySelector('input[type="submit"].submit'),
		new AceEditorAdapter(g)
	));

	// Library Checker
	submitter.registerSite(new Site(
		'judge.yosupo.jp',
		(e) => e.ctrlKey && e.shiftKey && e.altKey && isEnterKey(e),
		() => {
			const forms = document.querySelectorAll('form');
			for (const form of forms) {
				const buttons = form.querySelectorAll('button[type="submit"], input[type="submit"]');
				for (const btn of buttons) {
					const text = (btn.textContent || '').trim().toLowerCase();
					if (text.includes('提出') || text.includes('submit')) return btn;
				}
			}
			return null;
		},
		new MonacoEditorAdapter(g)
	));

	// paiza
	submitter.registerSite(new Site(
		'paiza.jp',
		(e) => {
			if (!e.ctrlKey || e.shiftKey) return false;
			// シンプルに Ctrl + Enter を採用（Altチェックなどの複雑な条件を削除）
			return isEnterKey(e);
		},
		() => {
			const a = document.getElementById('handin');
			if (a) return a;
			const clickable = Array.from(document.querySelectorAll('a,button,input[type="button"],input[type="submit"]'));
			for (const el of clickable) {
				const oc = String(el.getAttribute('onclick') || '');
				if (oc.includes('hand_in_code')) return el;
			}
			for (const el of clickable) {
				const text = String(el.textContent || (el instanceof HTMLInputElement ? el.value : '') || '').trim();
				if (!text) continue;
				if (text.includes('コードを提出する')) return el;
				if (text === '提出' || text.includes('提出する')) return el;
			}
			return null;
		},
		new AceEditorAdapter(g)
	));

	submitter.start();

})();
export {};
