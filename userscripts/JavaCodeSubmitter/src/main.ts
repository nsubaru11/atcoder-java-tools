import {
	buildLocalRunnerTransformRequest,
	type LocalRunnerTransformResponse,
	mergeWithDefaults,
	modifyJavaCode,
	safeJsonParse,
} from "@atcoder-tools/shared";

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
		// 貼り付け後にトップレベル型と複数行コメントを自動折りたたみするか
		foldMainOnPaste: true,
		// デバッグログを有効化するか
		logEnabled: false,
		// Java Compiler API を提供する LocalRunner
		localRunnerURL: 'http://localhost:8080',
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
	const foldableTypePattern = /^\s*(?:public\s+)?(?:final\s+class|interface|enum|record|@interface)\s+\w+\b/;
	const findFoldStartLines = (source: string): number[] => source.split('\n')
		.map((line, index) => foldableTypePattern.test(line) || /^\s*\/\*/.test(line) ? index : -1)
		.filter((line) => line >= 0);
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
	function requestLocalTransform(code: string): Promise<LocalRunnerTransformResponse> {
		const body = JSON.stringify(buildLocalRunnerTransformRequest(code, false, true, false));
		if (typeof GM_xmlhttpRequest === 'function') {
			return new Promise((resolve, reject) => {
				GM_xmlhttpRequest({
					method: 'POST',
					url: SETTINGS.localRunnerURL,
					headers: {'Content-Type': 'application/json'},
					data: body,
					timeout: 30_000,
					responseType: 'json',
					onload: (response) => {
						if (response.status < 200 || response.status >= 300) {
							reject(new Error(`LocalRunner HTTP ${response.status}`));
							return;
						}
						try {
							const parsed = response.response && typeof response.response === 'object'
								? response.response : JSON.parse(response.responseText);
							resolve(parsed as LocalRunnerTransformResponse);
						} catch (error) {
							reject(error);
						}
					},
					onerror: (response) => reject(new Error(response.statusText || 'LocalRunner request failed')),
					ontimeout: () => reject(new Error('LocalRunner request timed out')),
				});
			});
		}
		return fetch(SETTINGS.localRunnerURL, {
			method: 'POST',
			mode: 'cors',
			headers: {'Content-Type': 'application/json'},
			body,
		}).then(async (response) => {
			if (!response.ok) throw new Error(`LocalRunner HTTP ${response.status}`);
			return await response.json() as LocalRunnerTransformResponse;
		});
	}

	async function modifyPastedCode(text: unknown): Promise<{ modified: string; didModify: boolean }> {
		const code = (typeof text === 'string') ? text : '';
		if (!code) return {modified: '', didModify: false};
		try {
			const transformed = await requestLocalTransform(code);
			if (transformed.status !== 'success') {
				console.error(LOG_PREFIX, 'LocalRunner compile error:\n' + transformed.diagnostics);
				throw new Error(transformed.diagnostics);
			}
			if (transformed.addedImports.length) log('Added imports:', transformed.addedImports.join(', '));
			if (transformed.inlinedClasses.length) log('Bundled:', transformed.inlinedClasses.join(', '));
			return {modified: transformed.sourceCode, didModify: transformed.sourceCode !== code};
		} catch (error) {
			log('LocalRunner transform unavailable; using lexical fallback:', error);
		}

		const result = modifyJavaCode(code, {
			removePackage: SETTINGS.removePackage,
			renameClass: SETTINGS.renameClass,
			fixDebug: SETTINGS.fixDebug,
		});

		const didModify = result.packageRemoved || result.classReplaced || result.debugReplaced;
		if (result.classReplaced) log('Class renamed to Main');
		if (result.debugReplaced) log('DEBUG flag disabled');

		return {modified: result.modified, didModify};
	}

	async function transformEditorSnapshot(
		getValue: () => string,
		setValue: (value: string) => void,
		onModified: () => void,
	): Promise<void> {
		const snapshot = getValue();
		if (!snapshot || snapshot.length < 30) return;
		const {modified, didModify} = await modifyPastedCode(snapshot);
		if (!didModify || getValue() !== snapshot) return;
		setValue(modified);
		onModified();
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

		foldClasses(): void {
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

			editor.on('paste', () => {
				setTimeout(() => void transformEditorSnapshot(
					() => session.getValue(),
					(value) => session.setValue(value),
					() => {
						if (SETTINGS.foldMainOnPaste) setTimeout(() => this.foldClasses(), 100);
					},
				), 0);
			});
			this.initialized = true;
			log('ACE Adapter initialized');
			return true;
		}

		foldClasses(): void {
			const ace = this.getAce();
			const editor = this.getEditor();
			if (!ace || !editor) return;
			const session = editor.getSession();
			const lines = session.getValue().split('\n');
			const foldLines = findFoldStartLines(session.getValue());
			for (const foldLine of foldLines) {
				const existingFold = (session.getAllFolds() || []).find((fold: any) => fold.start.row === foldLine);
				if (existingFold) continue;
				const range = session.getFoldWidget(foldLine) ? session.getFoldWidgetRange(foldLine) : null;
				if (range) {
					session.addFold('...', range);
					continue;
				}
				if (!foldableTypePattern.test(lines[foldLine])) continue;
				let brace = 0, endLine = -1;
				for (let i = foldLine; i < lines.length; i++) {
					brace += (lines[i].match(/\{/g) || []).length;
					brace -= (lines[i].match(/}/g) || []).length;
					if (i > foldLine && brace === 0) {
						endLine = i;
						break;
					}
				}
				if (endLine > foldLine) {
					const Range = ace.require('ace/range').Range;
					session.addFold('...', new Range(foldLine, lines[foldLine].length, endLine, 0));
				}
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
				editor.onDidPaste(() => {
					void transformEditorSnapshot(
						() => model.getValue(),
						(value) => model.setValue(value),
						() => {
							if (SETTINGS.foldMainOnPaste) setTimeout(() => this.foldClasses(), 100);
						},
					);
				});
			} catch (err) {
				model.onDidChangeContent((e: any) => {
					if (e.isFlush) return;
					if (e.changes.length === 1) {
						const {text} = e.changes[0];
						if (text && text.length >= 30) {
							void transformEditorSnapshot(
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
			log('Monaco Adapter initialized');
			return true;
		}

		foldClasses(): void {
			const editor = this.getEditor();
			if (!editor) return;
			const model = editor.getModel();
			if (!model) return;
			const foldLines = findFoldStartLines(model.getValue()).map((line) => line + 1);
			if (!foldLines.length) return;
			const position = editor.getPosition?.();
			const action = editor.getAction && editor.getAction('editor.fold');
			if (!action?.run) return;
			void (async () => {
				for (const lineNumber of foldLines) {
					editor.setPosition({lineNumber, column: 1});
					await action.run();
				}
			})().catch((error) => log('Monaco fold failed:', error)).finally(() => {
				if (position) editor.setPosition(position);
			});
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
					this.active?.editor?.foldClasses();
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
