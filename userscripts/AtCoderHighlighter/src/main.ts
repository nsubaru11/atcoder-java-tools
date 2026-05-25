(function () {
	'use strict';

	type ColorProp = 'num' | 'var' | 'time' | 'memory';
	type ColorStorageKey = 'numColor' | 'varColor' | 'timeLimitColor' | 'memoryLimitColor';
	type ColorMap = Record<ColorProp, string>;
	type MenuItem = {
		label: string;
		key: ColorStorageKey;
		prop: ColorProp;
	};

	const TARGET_KEYWORDS: string[] = ['問題文', 'Problem Statement', '制約', 'Constraints'];
	const TIME_LIMIT_KEYWORDS: string[] = ['Time Limit', '実行時間制限'];
	const MEMORY_LIMIT_KEYWORDS: string[] = ['Memory Limit', 'メモリ制限'];
	const SKIP_TAGS = new Set<string>(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'VAR', 'KBD', 'SAMP']);

	const NUM_PATTERN = /(^|\W)([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+-]?\d+)?)/gi;
	const NUM_PURE = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+-]?\d+)?$/i;

	const DEFAULT_COLORS: ColorMap = {
		num: '#0033B3',
		var: '#9E2927',
		time: '#b3542a',
		memory: '#1d643b',
	};

	const IS_JP = navigator.language.startsWith('ja');
	const MSG: {
		prompt: string;
		error: string;
		labels: ColorMap;
	} = {
		prompt: IS_JP ? 'の色 (例: #0033B3 / #03b / rgb(0,51,179))' : ' Color (e.g. #0033B3 / #03b / rgb(0,51,179))',
		error: IS_JP ? '色の形式が正しくありません。' : 'Invalid color format.',
		labels: {
			num: IS_JP ? '数字の色' : 'Numbers Color',
			var: IS_JP ? '変数の色' : 'Variables Color',
			time: IS_JP ? '実行時間制限の色' : 'Time Limit Color',
			memory: IS_JP ? 'メモリ制限の色' : 'Memory Limit Color'
		}
	};

	function normalizeHexColor(input: unknown): string | null {
		if (typeof input !== 'string') return null;
		const value = input.trim();
		if (/^#[0-9a-fA-F]{3}$/.test(value)) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
		if (/^#[0-9a-fA-F]{4}$/.test(value)) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}${value[4]}${value[4]}`;
		if (/^#[0-9a-fA-F]{6}$/.test(value) || /^#[0-9a-fA-F]{8}$/.test(value)) return value;
		return null;
	}

	function normalizeColor(input: unknown): string | null {
		if (typeof input !== 'string') return null;
		const trimmed = input.trim();
		const normalizedHex = normalizeHexColor(trimmed);
		if (normalizedHex) return normalizedHex;
		if (/^(rgb|rgba|hsl|hsla)\([^)]*\)$/.test(trimmed)) return trimmed;
		return null;
	}

	function readColors(): ColorMap {
		if (typeof GM_getValue !== 'function') return Object.assign({}, DEFAULT_COLORS);
		return {
			num: GM_getValue('numColor', DEFAULT_COLORS.num),
			var: GM_getValue('varColor', DEFAULT_COLORS.var),
			time: GM_getValue('timeLimitColor', DEFAULT_COLORS.time),
			memory: GM_getValue('memoryLimitColor', DEFAULT_COLORS.memory),
		};
	}

	function writeColor(key: ColorStorageKey, value: string): void {
		if (typeof GM_setValue !== 'function') return;
		GM_setValue(key, value);
	}

	function injectStyles(): void {
		const existingStyle = document.getElementById('atcoder-highlighter-style');
		if (existingStyle) existingStyle.remove();

		const colors = readColors();
		const style = document.createElement('style');
		style.id = 'atcoder-highlighter-style';
		style.textContent = /* language=css */ `
			/* 強調表示の共通設定 */
			.target-scope .katex .mathnormal,
			.target-scope .number,
			.time-limit-value,
			.memory-limit-value {
				font-weight: 800 !important;
			}

			.target-scope .katex .mathnormal {
				color: ${colors.var} !important;
			}

			.target-scope .number {
				color: ${colors.num} !important;
			}

			.time-limit-value, .time-limit-value-number {
				color: ${colors.time};
			}

			.memory-limit-value, .memory-limit-value-number {
				color: ${colors.memory};
			}

			.time-limit-value-number, .memory-limit-value-number {
				font-size: 2em;
			}
		`;
		(document.head || document.documentElement).appendChild(style);
	}

	function markTargetSections(root: ParentNode = document): void {
		const sections = (root || document).querySelectorAll('#task-statement section');

		sections.forEach((sec: Element) => {
			const h3 = sec.querySelector('h3');
			if (!h3) return;

			const title = h3.textContent.trim();
			if (TARGET_KEYWORDS.some((kw: string) => title.includes(kw))) {
				sec.classList.add('target-scope');
			}
		});
	}

	function isPureNumber(text: string | null): boolean {
		if (text === null) return false;
		return NUM_PURE.test(text.trim());
	}

	function highlightKaTeXNumbers(scope: ParentNode): void {
		const elements = scope.querySelectorAll('.katex .mord, .katex .text, .katex .mord.text');
		elements.forEach((el: Element) => {
			if (el.classList.contains('number')) return;
			if (el.classList.contains('mathnormal')) return;
			if (isPureNumber(el.textContent)) {
				el.classList.add('number');
			}
		});
	}

	function highlightTextNumbers(scope: Node): void {
		const walker = document.createTreeWalker(
			scope,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode: function (node: Node): number {
					const parent = node.parentElement;
					if (!parent) return NodeFilter.FILTER_REJECT;

					const tagName = parent.tagName.toUpperCase();
					if (SKIP_TAGS.has(tagName)) return NodeFilter.FILTER_REJECT;

					if (typeof parent.closest === 'function') {
						if (parent.closest('.katex, var, .number')) {
							return NodeFilter.FILTER_REJECT;
						}
					}

					return NodeFilter.FILTER_ACCEPT;
				}
			}
		);

		const nodesToProcess: Text[] = [];
		let currentNode: Node | null;
		while ((currentNode = walker.nextNode())) {
			const nodeValue = currentNode.nodeValue;
			if (nodeValue && /\d/.test(nodeValue)) {
				nodesToProcess.push(currentNode as Text);
			}
		}

		nodesToProcess.forEach((node: Text) => {
			const text = node.nodeValue;
			if (!text || !NUM_PATTERN.test(text)) return;

			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			let match: RegExpExecArray | null;

			NUM_PATTERN.lastIndex = 0;
			while ((match = NUM_PATTERN.exec(text)) !== null) {
				const fullStart = match.index;
				const prefix = match[1] || '';
				const numberText = match[2];
				const numberStart = fullStart + prefix.length;
				const numberEnd = numberStart + numberText.length;

				if (fullStart > lastIndex) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex, fullStart)));
				}
				if (prefix) {
					fragment.appendChild(document.createTextNode(prefix));
				}
				const span = document.createElement('span');
				span.className = 'number';
				span.textContent = numberText;
				fragment.appendChild(span);

				lastIndex = numberEnd;
			}
			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}
			node.parentNode?.replaceChild(fragment, node);
		});
	}

	function highlightNumbers(): void {
		const scopes = document.querySelectorAll('.target-scope');
		scopes.forEach((scope: Element) => {
			highlightKaTeXNumbers(scope);
			highlightTextNumbers(scope);
		});
	}

	function wrapLimitValue(
		element: Node,
		keyword: string,
		className: string,
		options: { numberOnly?: boolean; numberClass?: string } = {}
	): void {
		const walker = document.createTreeWalker(
			element,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode: function (node: Node): number {
					const parent = node.parentElement;
					if (!parent) return NodeFilter.FILTER_REJECT;

					const tagName = parent.tagName.toUpperCase();
					if (SKIP_TAGS.has(tagName)) return NodeFilter.FILTER_REJECT;
					if (typeof parent.closest === 'function') {
						if (parent.closest('.katex, var, .number, .time-limit-value, .time-limit-value-number, .memory-limit-value')) {
							return NodeFilter.FILTER_REJECT;
						}
					}
					return NodeFilter.FILTER_ACCEPT;
				}
			}
		);

		const nodes: Text[] = [];
		let currentNode: Node | null;
		while ((currentNode = walker.nextNode())) {
			if (currentNode.nodeValue && currentNode.nodeValue.includes(keyword)) {
				nodes.push(currentNode as Text);
			}
		}

		const valuePattern = new RegExp(`${keyword}\\s*[:：]\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)(\\s*[a-zA-Z]+)?`, 'g');

		nodes.forEach((node: Text) => {
			const text = node.nodeValue;
			if (!text || !text.includes(keyword)) return;
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = valuePattern.exec(text)) !== null) {
				const fullStart = match.index;
				const valueNumber = match[1] || '';
				const valueUnit = match[2] || '';
				const valueStart = fullStart + match[0].lastIndexOf(valueNumber);
				const matchEnd = fullStart + match[0].length;
				if (fullStart > lastIndex) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex, fullStart)));
				}
				fragment.appendChild(document.createTextNode(text.slice(fullStart, valueStart)));
				if (options.numberOnly) {
					const span = document.createElement('span');
					span.className = options.numberClass || className;
					span.textContent = valueNumber;
					fragment.appendChild(span);
					if (valueUnit) fragment.appendChild(document.createTextNode(valueUnit));
				} else {
					const span = document.createElement('span');
					span.className = className;
					span.textContent = valueNumber + valueUnit;
					fragment.appendChild(span);
				}
				lastIndex = matchEnd;
			}
			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}
			if (node.parentNode) node.parentNode.replaceChild(fragment, node);
		});
	}

	function emphasizeLimits(): void {
		const root = document.getElementById('main-container') || document.body;
		if (!root) return;

		const configs: Array<{ keywords: string[]; cls: string; numCls: string }> = [
			{keywords: TIME_LIMIT_KEYWORDS, cls: 'time-limit-value', numCls: 'time-limit-value-number'},
			{keywords: MEMORY_LIMIT_KEYWORDS, cls: 'memory-limit-value', numCls: 'memory-limit-value-number'}
		];

		const candidates = root.querySelectorAll('p, dt, dd, th, td, div, li');
		candidates.forEach((el: Element) => {
			const text = el.textContent || '';
			configs.forEach(({keywords, cls, numCls}: { keywords: string[]; cls: string; numCls: string }) => {
				if (keywords.some((kw: string) => text.includes(kw)) && !el.querySelector(`.${numCls}`)) {
					keywords.forEach((kw: string) => wrapLimitValue(el, kw, cls, {
						numberOnly: true,
						numberClass: numCls,
					}));
				}
			});
		});
	}

	let scheduled = false;

	function scheduleHighlight(): void {
		if (scheduled) return;
		scheduled = true;
		setTimeout(() => {
			scheduled = false;
			injectStyles();
			markTargetSections();
			highlightNumbers();
			emphasizeLimits();
		}, 100);
	}

	function resetStyles(): void {
		const style = document.getElementById('atcoder-highlighter-style');
		if (style) style.remove();
		injectStyles();
		scheduleHighlight();
	}

	function registerMenu(): void {
		if (typeof GM_registerMenuCommand !== 'function') return;

		const menuItems: MenuItem[] = [
			{label: MSG.labels.num, key: 'numColor', prop: 'num'},
			{label: MSG.labels.var, key: 'varColor', prop: 'var'},
			{label: MSG.labels.time, key: 'timeLimitColor', prop: 'time'},
			{label: MSG.labels.memory, key: 'memoryLimitColor', prop: 'memory'}
		];

		menuItems.forEach(({label, key, prop}) => {
			GM_registerMenuCommand(`Highlighter: ${label}`, () => {
				const current = readColors();
				const next = prompt(`${label}${MSG.prompt}`, current[prop]);
				if (!next) return;
				const normalized = normalizeColor(next);
				if (!normalized) return alert(MSG.error);
				writeColor(key, normalized);
				resetStyles();
			});
		});
	}

	function observeTaskStatement(): void {
		const target = document.getElementById('task-statement') || document.body;
		if (!target) return;

		const observer = new MutationObserver(() => scheduleHighlight());
		observer.observe(target, {childList: true, subtree: true, characterData: true});
	}

	scheduleHighlight();
	observeTaskStatement();
	registerMenu();
})();
