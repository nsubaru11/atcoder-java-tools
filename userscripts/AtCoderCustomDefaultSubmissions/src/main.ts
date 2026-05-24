import {parseAtCoderTaskUrl} from '@shared/atcoder-url';

(function () {
	'use strict';

	type SubmissionConfig = {
		language: string;
		status: string;
		orderBy: string;
		includeTaskFilter: boolean;
	};

	const DEFAULTS: SubmissionConfig = {
		language: 'Java',
		status: 'AC',
		orderBy: 'time_consumption',
		includeTaskFilter: true,
	};

	function readConfig(): SubmissionConfig {
		const raw = typeof GM_getValue === 'function' ? GM_getValue('config', {}) : {};
		if (raw && typeof raw === 'object') return Object.assign({}, DEFAULTS, raw);
		return Object.assign({}, DEFAULTS);
	}

	function writeConfig(config: SubmissionConfig): void {
		if (typeof GM_setValue === 'function') {
			GM_setValue('config', config);
		}
	}

	function configureLanguage(): void {
		const current = readConfig();
		const language = window.prompt('Language name (e.g. Java, C#, Python3, Rust):', current.language);
		if (language === null) return;
		const next = Object.assign({}, current, {
			language: language.trim() || DEFAULTS.language,
		});
		writeConfig(next);
		window.alert('設定を保存しました。ページを再読み込みしてください。');
	}

	function configureStatus(): void {
		const current = readConfig();
		const status = window.prompt('Status filter (AC/WA/TLE/... or empty for all):', current.status);
		if (status === null) return;
		const next = Object.assign({}, current, {
			status: status.trim(),
		});
		writeConfig(next);
		window.alert('設定を保存しました。ページを再読み込みしてください。');
	}

	function configureOrderBy(): void {
		const current = readConfig();
		const orderBy = window.prompt('Sort key (source_length/time_consumption/memory_consumption/score):', current.orderBy);
		if (orderBy === null) return;
		const next = Object.assign({}, current, {
			orderBy: orderBy.trim() || DEFAULTS.orderBy,
		});
		writeConfig(next);
		window.alert('設定を保存しました。ページを再読み込みしてください。');
	}

	function toggleTaskFilter(): void {
		const current = readConfig();
		const next = Object.assign({}, current, {
			includeTaskFilter: !current.includeTaskFilter,
		});
		writeConfig(next);
		window.alert(`問題番号の絞り込み: ${next.includeTaskFilter ? 'ON' : 'OFF'}`);
	}

	function resetConfig(): void {
		writeConfig(Object.assign({}, DEFAULTS));
		window.alert('設定をリセットしました。ページを再読み込みしてください。');
	}

	if (typeof GM_registerMenuCommand === 'function') {
		GM_registerMenuCommand('AtCoder Custom Default Submissions: 言語設定', configureLanguage);
		GM_registerMenuCommand('AtCoder Custom Default Submissions: 結果フィルタ設定', configureStatus);
		GM_registerMenuCommand('AtCoder Custom Default Submissions: 並び順設定', configureOrderBy);
		GM_registerMenuCommand('AtCoder Custom Default Submissions: 問題番号絞り込み切替', toggleTaskFilter);
		GM_registerMenuCommand('AtCoder Custom Default Submissions: 設定リセット', resetConfig);
	}

	function getTaskId(): string {
		return parseAtCoderTaskUrl(location.href)?.taskId ?? '';
	}

	function buildSubmissionQuery(config: SubmissionConfig, task: string): string {
		const params = new URLSearchParams({
			'f.LanguageName': config.language,
			// AC, WA, TLE, MLE, RE, CE, QLE, OLE, IE, WJ, WR, Judging
			'f.Status': config.status,
			// source_length, time_consumption, memory_consumption, score
			'orderBy': config.orderBy,
		});
		if (task) params.set('f.Task', task);
		return params.toString();
	}

	function isSubmissionLink(url: URL): boolean {
		return /\/submissions(?:\/me)?\/?$/.test(url.pathname);
	}

	const config = readConfig();

	// 問題ページにいるときは問題番号での絞り込みも追加
	const task = config.includeTaskFilter ? getTaskId() : '';
	const querystring = buildSubmissionQuery(config, task);
	const links = document.querySelectorAll('#contest-nav-tabs a');
	for (let i = 0; i < links.length; i++) {
		const href = links[i].getAttribute('href');
		if (!href) continue;
		const url = new URL(href, location.origin);
		if (!isSubmissionLink(url)) continue;
		url.search = querystring;
		links[i].setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
	}
})();
