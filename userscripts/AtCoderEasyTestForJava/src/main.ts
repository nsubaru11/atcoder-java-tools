import {
	buildLocalRunnerKey,
	buildLocalRunnerListRequest,
	buildLocalRunnerPrecompileRequest,
	buildLocalRunnerRunRequest,
	buildQueryString as buildParams,
	evaluateEasyTestOutput,
	isHttpUrl,
	type LocalRunnerCompilerInfo,
	type LocalRunnerRunResponse,
	safeJsonParse,
	sleep,
	toEasyTestStatus
} from "@atcoder-tools/shared";

type RunnerOptions = {
	trim?: boolean;
	split?: boolean;
	allowableError?: number;
	runGroupId?: string;
	refreshLocalRunner?: boolean;
	[key: string]: unknown;
};

type RunnerResult = {
	status: string;
	input: string;
	exitCode?: string | number;
	execTime?: number;
	memory?: number;
	output?: string;
	error?: string;
	expectedOutput?: string;
};

type RunnerLike = {
	readonly label?: string;
	test(sourceCode: string, input: string, expectedOutput: string | null, options: RunnerOptions): Promise<RunnerResult>;
};

type RunnerMap = Record<string, RunnerLike>;

type ElementAttrs<K extends keyof HTMLElementTagNameMap> = Omit<Partial<HTMLElementTagNameMap[K]>, "style"> & {
	style?: Partial<CSSStyleDeclaration>;
};

type EventListenerFn = () => void;
type SettingOption = {
	type: "flag" | "count" | "text";
	key: string;
	defaultValue: boolean | number | string;
	description: string;
};
type SettingComponent = {
	title: string;
	generator: (win: Window) => Node;
};
type ConfigData = Record<string, string>;
type SavedCode = {
	path: string;
	code: string;
};
type TestCase = {
	title: string;
	input: string;
	output: string | null;
	anchor: Element | null;
	selector?: string;
};
type LanguageMap = Record<string, string>;
type Pair<T> = [T, T];
type ResultPair = [Promise<RunnerResult>, Promise<{ show(): void; close(): void; color: string }>];
type WandboxCompiler = {
	name: string;
	language: string;
	version: string;
	switches: Array<Record<string, string>>;
};
type WandboxRequest = Record<string, unknown> & {
	compiler?: string;
	code?: string;
	stdin: string;
};

(function () {
	const STORAGE_KEY = "AtCoderEasyTest";

	// Greasemonkey 4 などの GM4 は GM.getValue/GM.setValue(非同期) で、GM_getValue/GM_setValue(同期) が存在しない。
	// このスクリプトは同期的に設定値へアクセスする箇所があるため、GM_getValue が無い環境では
	// ページ(localStorage)に安全フォールバックし、必要ならバックグラウンドで GM ストレージも更新する。
	if (typeof GM_getValue !== "function" || typeof GM_setValue !== "function") {
		const hasAsyncGM = typeof GM === "object" && typeof GM.getValue === "function" && typeof GM.setValue === "function";
		let storage = safeJsonParse<Record<string, unknown>>(localStorage[STORAGE_KEY] || "{}", {});
		if (!storage || typeof storage !== "object") storage = {};
		const persist = () => {
			try {
				localStorage[STORAGE_KEY] = JSON.stringify(storage);
			} catch (_e) {
				// ignore
			}
		};
		GM_getValue = <T, >(key: string, defaultValue: T = null as T): T => ((key in storage) ? storage[key] as T : defaultValue);
		GM_setValue = (key, value) => {
			storage[key] = value;
			persist();
			if (hasAsyncGM) Promise.resolve(GM.setValue(key, value)).catch(() => {
			});
		};
		// 初回のみ、GMストレージに既存設定があれば取り込む（同期初期化を壊さないため遅延ロード）
		if (hasAsyncGM && !("config" in storage)) {
			Promise.resolve(GM.getValue("config")).then(value => {
				if (typeof value === "string" && value.length) {
					storage.config = value;
					persist();
				}
			}).catch(() => {
				// ignore
			});
		}
	}

	if (typeof unsafeWindow !== "object") unsafeWindow = window;

	function doneOrFail<T>(p: Promise<T>): Promise<void> {
		return p.then(() => Promise.resolve(), () => Promise.resolve());
	}

	function html2element<T extends Element = HTMLElement>(html: string): T {
		const template = document.createElement("template");
		template.innerHTML = html;
		const element = template.content.firstElementChild;
		if (!element) throw new Error("html2element: empty HTML");
		return element as T;
	}

	function newElement<K extends keyof HTMLElementTagNameMap>(
		tagName: K,
		attrs: ElementAttrs<K> = {} as ElementAttrs<K>,
		children: Node[] = []
	): HTMLElementTagNameMap[K] {
		const e = document.createElement(tagName);
		const {style, ...rest} = attrs;
		// その他の属性はそのままプロパティとしてまとめて代入
		Object.assign(e, rest);
		// style がある場合のみスタイルをまとめて適用
		if (style && typeof style === "object") Object.assign(e.style, style);
		for (const child of children) {
			e.appendChild(child);
		}
		return e;
	}

	function uuid(): string {
		const hex = "0123456789abcdef";
		const yChars = "89ab";
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c =>
			c === "x" ? hex[Math.random() * 16 | 0] : yChars[Math.random() * 4 | 0]
		);
	}

	async function loadScript(src: string, ctx: unknown = null, env: Record<string, unknown> = {}): Promise<void> {
		const js = await fetch(src).then(res => res.text());
		const keys: string[] = [];
		const values: unknown[] = [];
		for (const [key, value] of Object.entries(env)) {
			keys.push(key);
			values.push(value);
		}
		(globalThis.Function as FunctionConstructor)(keys.join(), js).apply(ctx, values);
	}

	const eventListeners = new Map<string, EventListenerFn[]>();
	const events = {
		on(name: string, listener: EventListenerFn): void {
			if (!eventListeners.has(name)) eventListeners.set(name, []);
			eventListeners.get(name)?.push(listener);
		},
		off(name: string, listener: EventListenerFn): void {
			const listeners = eventListeners.get(name);
			if (listeners) {
				const idx = listeners.indexOf(listener);
				if (idx !== -1) listeners.splice(idx, 1);
			}
		},
		trig(name: string): void {
			const listeners = eventListeners.get(name);
			if (listeners) {
				for (const listener of listeners) listener();
			}
		},
	};

	class ObservableValue<T> {
		_value: T;
		_listeners: Set<(value: T) => void>;

		constructor(value: T) {
			this._value = value;
			this._listeners = new Set();
		}

		get value(): T {
			return this._value;
		}

		set value(value: T) {
			this._value = value;
			for (const listener of this._listeners)
				listener(value);
		}

		addListener(listener: (value: T) => void): void {
			this._listeners.add(listener);
			listener(this._value);
		}

		removeListener(listener: (value: T) => void): void {
			this._listeners.delete(listener);
		}

		map<U>(f: (value: T) => U): ObservableValue<U> {
			const y = new ObservableValue(f(this.value));
			this.addListener(x => {
				y.value = f(x);
			});
			return y;
		}
	}

	const hPage = "<!DOCTYPE html>\n<html>\n  <head>\n    <meta charset=\"utf-8\">\n    <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n    <title>AtCoder Easy Test</title>\n    <link href=\"https://maxcdn.bootstrapcdn.com/bootstrap/3.3.1/css/bootstrap.min.css\" rel=\"stylesheet\">\n  </head>\n  <body>\n    <div class=\"container\" id=\"root\">\n    </div>\n    <script src=\"https://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js\"></script>\n    <script src=\"https://maxcdn.bootstrapcdn.com/bootstrap/3.3.1/js/bootstrap.min.js\"></script>\n  </body>\n</html>";

	const components: SettingComponent[] = [];
	const settings = {
		add(title: string, generator: (win: Window) => Node): void {
			components.push({title, generator});
		},
		open(): void {
			const win = window.open("about:blank");
			if (!win) throw new Error("Failed to open settings window.");
			const doc = win.document;
			doc.open();
			doc.write(hPage);
			doc.close();
			const root = doc.getElementById("root");
			if (!root) throw new Error("Settings root element was not found.");
			for (const {title, generator} of components) {
				const panel = newElement("div", {className: "panel panel-default"}, [
					newElement("div", {className: "panel-heading", textContent: title}),
					newElement("div", {className: "panel-body"}, [generator(win)]),
				]);
				root.appendChild(panel);
			}
		},
	};

	const options: SettingOption[] = [];
	let data: ConfigData = {};

	function toString(): string {
		return JSON.stringify(data);
	}

	function save(): void {
		try {
			GM_setValue("config", toString());
		} catch (_e) {
			// ignore
		}
	}

	function load(): void {
		const raw = GM_getValue("config");
		if (raw && typeof raw === "object") {
			data = raw as ConfigData;
			return;
		}
		const parsed = safeJsonParse(typeof raw === "string" ? raw : null, {});
		data = (parsed && typeof parsed === "object") ? parsed as ConfigData : {};
	}

	function reset(): void {
		data = {};
		save();
	}

	load();
	// 設定ページ
	settings.add("config", (win: Window): HTMLElement => {
		const root = newElement("form", {className: "form-horizontal"});
		options.sort((a, b) => {
			const x = a.key.split(".");
			const y = b.key.split(".");
			return x < y ? -1 : x > y ? 1 : 0;
		});
		for (const {type, key, defaultValue, description} of options) {
			const id = uuid();
			const control = newElement("div", {className: "col-sm-3 text-center"});
			const group = newElement("div", {className: "form-group"}, [
				control,
				newElement("label", {
					className: "col-sm-3",
					htmlFor: id,
					textContent: key,
					style: {
						fontFamily: "monospace",
					},
				}),
				newElement("label", {
					className: "col-sm-6",
					htmlFor: id,
					textContent: description,
				}),
			]);
			root.appendChild(group);
			switch (type) {
				case "flag": {
					control.appendChild(newElement("input", {
						id,
						type: "checkbox",
						checked: config.get<boolean>(key, Boolean(defaultValue)),
						onchange(event) {
							config.set(key, (event.currentTarget as HTMLInputElement).checked);
						},
					}));
					break;
				}
				case "count": {
					control.appendChild(newElement("input", {
						id,
						type: "number",
						min: "0",
						value: String(config.get<number>(key, Number(defaultValue))),
						onchange(event) {
							config.set(key, +(event.currentTarget as HTMLInputElement).value);
						},
					}));
					break;
				}
				case "text": {
					control.appendChild(newElement("input", {
						id,
						type: "text",
						value: config.getString(key, String(defaultValue)),
						onchange(event) {
							config.setString(key, (event.currentTarget as HTMLInputElement).value);
						},
					}));
					break;
				}
				default:
					throw new TypeError(`AtCoderEasyTest.setting: undefined option type ${type} for ${key}`);
			}
		}
		root.appendChild(newElement("button", {
			className: "btn btn-danger",
			textContent: "Reset",
			type: "button",
			onclick() {
				if (win.confirm("Configuration data will be cleared. Are you sure?")) {
					config.reset();
				}
			},
		}));
		return root;
	});
	const config = {
		peekString(key: string, defaultValue = ""): string {
			if (!(key in data)) return defaultValue;
			const v = data[key];
			return (typeof v === "string") ? v : String(v ?? "");
		},
		peek<T>(key: string, defaultValue: T): T {
			if (!(key in data)) return defaultValue;
			try {
				return JSON.parse(data[key]) as T;
			} catch (_e) {
				return defaultValue;
			}
		},
		getString(key: string, defaultValue = ""): string {
			if (!(key in data)) {
				config.setString(key, defaultValue);
				return defaultValue;
			}
			return (typeof data[key] === "string") ? data[key] : String(data[key] ?? "");
		},
		setString(key: string, value: string): void {
			data[key] = value;
			save();
		},
		has(key: string): boolean {
			return key in data;
		},
		get<T>(key: string, defaultValue: T): T {
			if (!(key in data)) {
				config.set(key, defaultValue);
				return defaultValue;
			}
			try {
				return JSON.parse(data[key]) as T;
			} catch (_e) {
				config.set(key, defaultValue);
				return defaultValue;
			}
		},
		set(key: string, value: unknown): void {
			const json = JSON.stringify(value);
			config.setString(key, json === undefined ? "null" : json);
		},
		save,
		load,
		toString,
		reset,
		/** 設定項目を登録 */
		registerFlag(key: string, defaultValue: boolean, description: string): void {
			options.push({
				type: "flag",
				key,
				defaultValue,
				description,
			});
		},
		registerCount(key: string, defaultValue: number, description: string): void {
			options.push({
				type: "count",
				key,
				defaultValue,
				description,
			});
		},
		registerText(key: string, defaultValue: string, description: string): void {
			options.push({
				type: "text",
				key,
				defaultValue,
				description,
			});
		},
	};

	config.registerFlag("log.debug", false, "Enable debug logs in console");
	const log = (() => {
		const prefix = "[AtCoder Easy Test]";
		const isDebug = (): boolean => config.peek<boolean>("log.debug", false) === true;
		return {
			debug(...args: unknown[]): void {
				if (isDebug()) console.debug(prefix, ...args);
			},
			info(...args: unknown[]): void {
				if (isDebug()) console.info(prefix, ...args);
			},
			warn(...args: unknown[]): void {
				console.warn(prefix, ...args);
			},
			error(...args: unknown[]): void {
				console.error(prefix, ...args);
			},
		};
	})();

	config.registerCount("codeSaver.limit", 10, "Max number to save codes");
	const codeSaver = {
		get(): SavedCode[] {
			// `json` は、ソースコード文字列またはJSON文字列
			let json = unsafeWindow.localStorage.AtCoderEasyTest$lastCode;
			let data: SavedCode[] = [];
			try {
				if (typeof json === "string") {
					data.push(...JSON.parse(json) as SavedCode[]);
				} else {
					data = [];
				}
			} catch (e) {
				data.push({
					path: unsafeWindow.localStorage.AtCoderEasyTest$lastPage || unsafeWindow.localStorage.AtCoderEasyTset$lastPage,
					code: json,
				});
			}
			return data;
		},
		set(data: SavedCode[]): void {
			unsafeWindow.localStorage.AtCoderEasyTest$lastCode = JSON.stringify(data);
		},
		save(savePath: string, code: string): void {
			const data = codeSaver.get();
			const idx = data.findIndex(({path}) => path === savePath);
			// 既存エントリがあれば 1 件だけ削除（元コードは idx+1 を渡しており余分に削除する可能性があった）
			if (idx !== -1) data.splice(idx, 1);
			data.push({path: savePath, code});
			while (data.length > config.get<number>("codeSaver.limit", 10)) data.shift();
			codeSaver.set(data);
		},
		restore(savedPath: string): Promise<string> {
			const data = codeSaver.get();
			const idx = data.findIndex(({path}) => path === savedPath);
			if (idx === -1 || !(data[idx] instanceof Object))
				return Promise.reject(`No saved code found for ${location.pathname}`);
			return Promise.resolve(data[idx].code);
		}
	};
	settings.add(`codeSaver (${location.host})`, (_win: Window): HTMLElement => {
		const root = newElement("table", {className: "table"}, [
			newElement("thead", {}, [
				newElement("tr", {}, [
					newElement("th", {textContent: "path"}),
					newElement("th", {textContent: "code"}),
				]),
			]),
			newElement("tbody"),
		]);
		for (const savedCode of codeSaver.get()) {
			root.tBodies[0].appendChild(newElement("tr", {}, [
				newElement("td", {textContent: savedCode.path}),
				newElement("td", {}, [
					newElement("textarea", {
						rows: 1,
						cols: 30,
						textContent: savedCode.code,
					}),
				]),
			]));
		}
		return root;
	});

	function similarLangs(targetLang: string, candidateLangs: string[]): string[] {
		const [targetName, targetDetail = ""] = targetLang.split(" ", 2);
		const selectedLangs: Array<[string, number]> = [];
		for (const candidateLang of candidateLangs) {
			const spaceIdx = candidateLang.indexOf(" ");
			const name = spaceIdx === -1 ? candidateLang : candidateLang.slice(0, spaceIdx);
			if (name === targetName) {
				const detail = spaceIdx === -1 ? "" : candidateLang.slice(spaceIdx + 1);
				selectedLangs.push([candidateLang, similarity(detail, targetDetail)]);
			}
		}
		selectedLangs.sort((a, b) => a[1] - b[1]);
		return selectedLangs.map(([lang]) => lang);
	}

	function similarity(s: string, t: string): number {
		const n = s.length, m = t.length;
		// Float64Arrayを使用してメモリ効率と速度を改善
		let dp = new Float64Array(m + 1);
		let dp2 = new Float64Array(m + 1);
		for (let i = 0; i < n; i++) {
			dp2.fill(0);
			const si = s.charCodeAt(i);
			for (let j = 0; j < m; j++) {
				const cost = (si - t.charCodeAt(j)) ** 2;
				dp2[j + 1] = Math.min(dp[j] + cost, dp[j + 1] + cost * 0.25, dp2[j] + cost * 0.25);
			}
			// 配列をスワップして再利用
			[dp, dp2] = [dp2, dp];
		}
		return dp[m];
	}

	class CodeRunner {
		_label: string;

		get label(): string {
			return this._label;
		}

		constructor(label: string, site: string) {
			this._label = `${label} [${site}]`;
		}

		async run(_sourceCode: string, input: string, _options: RunnerOptions = {}): Promise<RunnerResult> {
			return {status: "IE", input};
		}

		async test(sourceCode: string, input: string, expectedOutput: string | null, options: RunnerOptions): Promise<RunnerResult> {
			let result: RunnerResult = {status: "IE", input};
			try {
				result = await this.run(sourceCode, input, options);
			} catch (e) {
				result.error = String(e);
				return result;
			}
			if (expectedOutput != null)
				result.expectedOutput = expectedOutput;
			if (result.status !== "OK" || typeof expectedOutput !== "string")
				return result;
			const judged = evaluateEasyTestOutput(
				{status: result.status, output: result.output || "", error: result.error, execTime: result.execTime},
				expectedOutput,
				options,
			);
			result.status = judged.status;
			result.output = judged.output;
			result.expectedOutput = judged.expectedOutput;
			return result;
		}
	}

	class CustomRunner extends CodeRunner {
		run: (sourceCode: string, input: string, options?: RunnerOptions) => Promise<RunnerResult>;

		constructor(label: string, run: (sourceCode: string, input: string, options?: RunnerOptions) => Promise<RunnerResult>) {
			super(label, "Browser");
			this.run = run;
		}
	}

	let waitAtCoderCustomTest: Promise<RunnerResult | void> = Promise.resolve();
	const AtCoderCustomTestBase = location.href.replace(/\/tasks\/.+$/, "/custom_test");
	const AtCoderCustomTestResultAPI = AtCoderCustomTestBase + "/json?reload=true";
	const AtCoderCustomTestSubmitAPI = AtCoderCustomTestBase + "/submit/json";
	const ce_groups = new Set();

	class AtCoderRunner extends CodeRunner {
		languageId: string;

		constructor(languageId: string, label: string) {
			super(label, "AtCoder");
			this.languageId = languageId;
		}

		async run(sourceCode: string, input: string, options: RunnerOptions = {}): Promise<RunnerResult> {
			const promise = this.submit(sourceCode, input, options);
			waitAtCoderCustomTest = promise;
			return await promise;
		}

		async submit(sourceCode: string, input: string, options: RunnerOptions = {}): Promise<RunnerResult> {
			try {
				await waitAtCoderCustomTest;
			} catch (error) {
				console.error(error);
			}
			// 同じグループで CE なら実行を省略し CE を返す
			if ("runGroupId" in options && ce_groups.has(options.runGroupId)) {
				return {
					status: "CE",
					input,
				};
			}
			const error = await fetch(AtCoderCustomTestSubmitAPI, {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
				},
				body: buildParams({
					"data.LanguageId": String(this.languageId),
					sourceCode,
					input,
					csrf_token: unsafeWindow.csrfToken,
				}),
			}).then(r => r.text());
			if (error) {
				throw new Error(error);
			}
			await sleep(100);
			// 最大試行回数を設定してタイムアウト防止
			const maxAttempts = 300; // 約5分のタイムアウト
			for (let attempt = 0; attempt < maxAttempts; attempt++) {
				const data = await fetch(AtCoderCustomTestResultAPI, {
					method: "GET",
					credentials: "include",
				}).then(r => r.json());
				if (!("Result" in data)) {
					await sleep(1000);
					continue;
				}
				const result = data.Result;
				if ("Interval" in data) {
					await sleep(data.Interval);
					continue;
				}
				const status = (result.ExitCode === 0) ? "OK" : (result.TimeConsumption.toString().startsWith("-")) ? "CE" : "RE";
				if (status === "CE" && "runGroupId" in options) {
					ce_groups.add(options.runGroupId);
				}
				return {
					status,
					exitCode: result.ExitCode,
					execTime: parseInt(result.TimeConsumption),
					memory: parseInt(result.MemoryConsumption),
					input,
					output: data.Stdout,
					error: data.Stderr,
				};
			}
			// タイムアウト時はエラーを返す
			return {
				status: "TLE",
				input,
				error: "Custom test timed out",
			};
		}
	}

	class PaizaIORunner extends CodeRunner {
		name: string;

		constructor(name: string, label: string) {
			super(label, "PaizaIO");
			this.name = name;
		}

		async run(sourceCode: string, input: string, _options: RunnerOptions = {}): Promise<RunnerResult> {
			let id: string;
			let status: string;
			try {
				const res = await fetch("https://api.paiza.io/runners/create?" + buildParams({
					source_code: sourceCode,
					language: this.name,
					input,
					longpoll: "true",
					longpoll_timeout: "10",
					api_key: "guest",
				}), {
					method: "POST",
					mode: "cors",
				}).then(r => r.json());
				id = res.id;
				status = res.status;
			} catch (error) {
				return {
					status: "IE",
					input,
					error: String(error),
				};
			}
			while (status === "running") {
				const res = await fetch("https://api.paiza.io/runners/get_status?" + buildParams({
					id,
					api_key: "guest",
				}), {
					mode: "cors",
				}).then(res => res.json());
				status = res.status;
			}
			const res = await fetch("https://api.paiza.io/runners/get_details?" + buildParams({
				id,
				api_key: "guest",
			}), {
				mode: "cors",
			}).then(r => r.json());
			const result: RunnerResult = {
				status: "OK",
				exitCode: String(res.exit_code),
				execTime: +res.time * 1e3,
				memory: +res.memory * 1e-3,
				input,
			};
			if (res.build_result === "failure") {
				result.status = "CE";
				result.exitCode = res.build_exit_code;
				result.output = res.build_stdout;
				result.error = res.build_stderr;
			} else {
				result.status = (res.result === "timeout") ? "TLE" : (res.result === "failure") ? "RE" : "OK";
				result.exitCode = res.exit_code;
				result.output = res.stdout;
				result.error = res.stderr;
			}
			return result;
		}
	}

	async function loadPyodide(): Promise<any> {
		const script = await fetch("https://cdn.jsdelivr.net/pyodide/v0.24.0/full/pyodide.js").then((res) => res.text());
		(globalThis.Function as FunctionConstructor)(script)();
		const loadPyodide = (unsafeWindow as Window & {
			loadPyodide: (options: { indexURL: string }) => Promise<any>
		}).loadPyodide;
		const pyodide: any = await loadPyodide({
			indexURL: "https://cdn.jsdelivr.net/pyodide/v0.24.0/full/",
		});
		await pyodide.runPythonAsync(`
import contextlib, io, platform
class __redirect_stdin(contextlib._RedirectStream):
  _stream = "stdin"
`);
		return pyodide;
	}

	let _pyodide: Promise<any> = Promise.reject("Pyodide is not yet loaded");
	let _serial: Promise<void> = Promise.resolve();
	const pyodideRunner = new CustomRunner("Pyodide", (sourceCode: string, input: string, _options: RunnerOptions = {}) => new Promise<RunnerResult>((resolve) => {
		_serial = _serial.finally(async () => {
			const pyodide = await (_pyodide = _pyodide.catch(loadPyodide));
			const code = `
def __run():
 global __stdout, __stderr, __stdin, __code
 with __redirect_stdin(io.StringIO(__stdin)):
  with contextlib.redirect_stdout(io.StringIO()) as __stdout:
   with contextlib.redirect_stderr(io.StringIO()) as __stderr:
    try:
     pass
` +
				sourceCode
					.split("\n")
					.map((line) => "     " + line)
					.join("\n") +
				`
    except SystemExit as e:
     __code = e.code
`;
			let status = "OK";
			let exitCode = "0";
			let stdout = "";
			let stderr = "";
			let startTime = -Infinity;
			let endTime = Infinity;
			pyodide.globals.set("__stdin", input);
			try {
				pyodide.globals.set("__code", null);
				await pyodide.loadPackagesFromImports(code);
				await pyodide.runPythonAsync(code);
				startTime = Date.now();
				pyodide.runPython("__run()");
				endTime = Date.now();
				stdout = pyodide.globals.get("__stdout").getvalue();
				stderr = pyodide.globals.get("__stderr").getvalue();
				const __code = pyodide.globals.get("__code");
				if (typeof __code === "number") {
					exitCode = String(__code);
					if (__code !== 0)
						status = "RE";
				}
			} catch (error: unknown) {
				status = "RE";
				exitCode = "-1";
				stderr += error instanceof Error ? error.message : String(error);
			}
			resolve({
				status,
				exitCode,
				execTime: endTime - startTime,
				input,
				output: stdout,
				error: stderr,
			});
		});
	}));

	function pairs<T>(list: ArrayLike<T>): Array<Pair<T>> {
		const pairs: Array<Pair<T>> = [];
		const len = list.length >> 1;
		for (let i = 0; i < len; i++)
			pairs.push([list[i * 2], list[i * 2 + 1]]);
		return pairs;
	}

	async function init$5() {
		if (location.host !== "atcoder.jp")
			throw "Not AtCoder";
		const doc = unsafeWindow.document as Document;
		// "言語名 その他の説明..." となっている
		// 注意:
		// * 言語名にはスペースが入ってはいけない（スペース以降は説明とみなされる）
		// * Python2 の言語名は「Python」、 Python3 の言語名は「Python3」
		const langMap: LanguageMap = {
			4001: "C GCC 9.2.1",
			4002: "C Clang 10.0.0",
			4003: "C++ GCC 9.2.1",
			4004: "C++ Clang 10.0.0",
			4005: "Java OpenJDK 11.0.6",
			4006: "Python3 CPython 3.8.2",
			4007: "Bash 5.0.11",
			4008: "bc 1.07.1",
			4009: "Awk GNU Awk 4.1.4",
			4010: "C# .NET Core 3.1.201",
			4011: "C# Mono-mcs 6.8.0.105",
			4012: "C# Mono-csc 3.5.0",
			4013: "Clojure 1.10.1.536",
			4014: "Crystal 0.33.0",
			4015: "D DMD 2.091.0",
			4016: "D GDC 9.2.1",
			4017: "D LDC 1.20.1",
			4018: "Dart 2.7.2",
			4019: "dc 1.4.1",
			4020: "Erlang 22.3",
			4021: "Elixir 1.10.2",
			4022: "F# .NET Core 3.1.201",
			4023: "F# Mono 10.2.3",
			4024: "Forth gforth 0.7.3",
			4025: "Fortran GNU Fortran 9.2.1",
			4026: "Go 1.14.1",
			4027: "Haskell GHC 8.8.3",
			4028: "Haxe 4.0.3",
			4029: "Haxe 4.0.3",
			4030: "JavaScript Node.js 12.16.1",
			4031: "Julia 1.4.0",
			4032: "Kotlin 1.3.71",
			4033: "Lua Lua 5.3.5",
			4034: "Lua LuaJIT 2.1.0",
			4035: "Dash 0.5.8",
			4036: "Nim 1.0.6",
			4037: "Objective-C Clang 10.0.0",
			4038: "Lisp SBCL 2.0.3",
			4039: "OCaml 4.10.0",
			4040: "Octave 5.2.0",
			4041: "Pascal FPC 3.0.4",
			4042: "Perl 5.26.1",
			4043: "Raku Rakudo 2020.02.1",
			4044: "PHP 7.4.4",
			4045: "Prolog SWI-Prolog 8.0.3",
			4046: "Python PyPy2 7.3.0",
			4047: "Python3 PyPy3 7.3.0",
			4048: "Racket 7.6",
			4049: "Ruby 2.7.1",
			4050: "Rust 1.42.0",
			4051: "Scala 2.13.1",
			4052: "Java OpenJDK 1.8.0",
			4053: "Scheme Gauche 0.9.9",
			4054: "ML MLton 20130715",
			4055: "Swift 5.2.1",
			4056: "Text cat 8.28",
			4057: "TypeScript 3.8",
			4058: "Basic .NET Core 3.1.101",
			4059: "Zsh 5.4.2",
			4060: "COBOL Fixed OpenCOBOL 1.1.0",
			4061: "COBOL Free OpenCOBOL 1.1.0",
			4062: "Brainfuck bf 20041219",
			4063: "Ada Ada2012 GNAT 9.2.1",
			4064: "Unlambda 2.0.0",
			4065: "Cython 0.29.16",
			4066: "Sed 4.4",
			4067: "Vim 8.2.0460",
			// newjudge-2308
			5001: "C++ 20 gcc 12.2",
			5002: "Go 1.20.6",
			5003: "C# 11.0 .NET 7.0.7",
			5004: "Kotlin 1.8.20",
			5005: "Java OpenJDK 17",
			5006: "Nim 1.6.14",
			5007: "V 0.4",
			5008: "Zig 0.10.1",
			5009: "JavaScript Node.js 18.16.1",
			5010: "JavaScript Deno 1.35.1",
			5011: "R GNU R 4.2.1",
			5012: "D DMD 2.104.0",
			5013: "D LDC 1.32.2",
			5014: "Swift 5.8.1",
			5015: "Dart 3.0.5",
			5016: "PHP 8.2.8",
			5017: "C GCC 12.2.0",
			5018: "Ruby 3.2.2",
			5019: "Crystal 1.9.1",
			5020: "Brainfuck bf 20041219",
			5021: "F# 7.0 .NET 7.0.7",
			5022: "Julia 1.9.2",
			5023: "Bash 5.2.2",
			5024: "Text cat 8.32",
			5025: "Haskell GHC 9.4.5",
			5026: "Fortran GNU Fortran 12.2",
			5027: "Lua LuaJIT 2.1.0-beta3",
			5028: "C++ 23 gcc 12.2",
			5029: "CommonLisp SBCL 2.3.6",
			5030: "COBOL Free GnuCOBOL 3.1.2",
			5031: "C++ 23 Clang 16.0.5",
			5032: "Zsh Zsh 5.9",
			5033: "SageMath SageMath 9.5",
			5034: "Sed GNU sed 4.8",
			5035: "bc bc 1.07.1",
			5036: "dc dc 1.07.1",
			5037: "Perl perl  5.34",
			5038: "AWK GNU Awk 5.0.1",
			5039: "なでしこ cnako3 3.4.20",
			5040: "Assembly x64 NASM 2.15.05",
			5041: "Pascal FPC 3.2.2",
			5042: "C# 11.0 AOT .NET 7.0.7",
			5043: "Lua Lua 5.4.6",
			5044: "Prolog SWI-Prolog 9.0.4",
			5045: "PowerShell PowerShell 7.3.1",
			5046: "Scheme Gauche 0.9.12",
			5047: "Scala 3.3.0 Scala Native 0.4.14",
			5048: "Visual Basic 16.9 .NET 7.0.7",
			5049: "Forth gforth 0.7.3",
			5050: "Clojure babashka 1.3.181",
			5051: "Erlang Erlang 26.0.2",
			5052: "TypeScript 5.1 Deno 1.35.1",
			5053: "C++ 17 gcc 12.2",
			5054: "Rust 1.70.0",
			5055: "Python3 CPython 3.11.4",
			5056: "Scala Dotty 3.3.0",
			5057: "Koka koka 2.4.0",
			5058: "TypeScript 5.1 Node.js 18.16.1",
			5059: "OCaml ocamlopt 5.0.0",
			5060: "Raku Rakudo 2023.06",
			5061: "Vim vim 9.0.0242",
			5062: "Emacs Lisp Native Compile GNU Emacs 28.2",
			5063: "Python3 Mambaforge / CPython 3.10.10",
			5064: "Clojure clojure 1.11.1",
			5065: "プロデル mono版プロデル 1.9.1182",
			5066: "ECLiPSe ECLiPSe 7.1_13",
			5067: "Nibbles literate form nibbles 1.01",
			5068: "Ada GNAT 12.2",
			5069: "jq jq 1.6",
			5070: "Cyber Cyber v0.2-Latest",
			5071: "Carp Carp 0.5.5",
			5072: "C++ 17 Clang 16.0.5",
			5073: "C++ 20 Clang 16.0.5",
			5074: "LLVM IR Clang 16.0.5",
			5075: "Emacs Lisp Byte Compile GNU Emacs 28.2",
			5076: "Factor Factor 0.98",
			5077: "D GDC 12.2",
			5078: "Python3 PyPy 3.10-v7.3.12",
			5079: "Whitespace whitespacers 1.0.0",
			5080: "><> fishr 0.1.0",
			5081: "ReasonML reason 3.9.0",
			5082: "Python Cython 0.29.34",
			5083: "Octave GNU Octave 8.2.0",
			5084: "Haxe JVM Haxe 4.3.1",
			5085: "Elixir Elixir 1.15.2",
			5086: "Mercury Mercury 22.01.6",
			5087: "Seed7 Seed7 3.2.1",
			5088: "Emacs Lisp No Compile GNU Emacs 28.2",
			5089: "Unison Unison M5b",
			5090: "COBOL GnuCOBOLFixed 3.1.2",
			//
			6001: "><> fishr 0.1.0",
			6002: "Ada 2022 GNAT 15.2.0",
			6003: "APL GNU APL 1.9",
			6004: "Assembly MIPS O32 ABI GNU assembler 2.42",
			6005: "Assembly x64 NASM 2.16.03",
			6006: "AWK GNU awk 5.2.1",
			6007: "A interpreter af48a2a",
			6008: "Bash 5.3",
			6009: "Basic FreeBASIC 1.10.1",
			6010: "bc GNU bc 1.08.2",
			6011: "Befunge 93 TBC 1.0",
			6012: "Brainfuck Tritium 1.2.73",
			6013: "C 23 Clang Clang 21.1.0",
			6014: "C 23 GCC 14.2.0",
			6015: "C# 13.0 .NET 9.0.8",
			6016: "C# 13.0 .NET Native AOT 9.0.8",
			6017: "C++ 23 GCC 15.2.0",
			6018: "C3 0.7.5",
			6019: "Carp 0.5.5",
			6020: "cLay 20250308-1 GCC 15.2.0",
			6021: "Clojure babashka 1.12.208",
			6022: "Clojure 1.12.2",
			6023: "Clojure 1.12.2 AOT",
			6025: "Clojure 1.12.2 ClojureScript 1.12.42 Node.js 22.19.0",
			6026: "COBOL Free GnuCOBOL 3.2",
			6027: "CommonLisp SBCL 2.5.8",
			6028: "Crystal 1.17.0",
			6029: "Cyber 0.3",
			6030: "D DMD 2.111.0",
			6031: "D GDC 15.2",
			6032: "D LDC 1.41.0",
			6033: "Dart 3.9.2",
			6034: "dc 1.5.2 GNU bc 1.08.2",
			6035: "ECLiPSe 7.1_13",
			6036: "Eiffel Gobo Eiffel 22.01",
			6037: "Eiffel Liberty Eiffel 07829e3",
			6038: "Elixir 1.18.4 OTP 28.0.2",
			6039: "EmacsLisp (Native Compile) GNU Emacs 29.4",
			6040: "Emojicode 1.0 beta 2 emojicodec 1.0 beta 2",
			6041: "Erlang 28.0.2",
			6042: "F# 9.0 .NET 9.0.8",
			6043: "Factor 0.100",
			6044: "Fish 4.0.2",
			6045: "Forth gforth 0.7.3",
			6046: "Fortran2018 Flang 20.1.7",
			6047: "Fortran2023 GCC 14.2.0",
			6048: "FORTRAN77 GCC 14.2.0",
			6049: "Gleam 1.12.0 OTP 28.0.2",
			6050: "Go 1.18 gccgo 15.2.0",
			6051: "Go 1.25.1",
			6052: "Haskell GHC 9.8.4",
			6053: "Haxe JVM Haxe 4.3.7 hxjava 4.2.0",
			6054: "C++ GCC 14.2.0 IOI-Style(GNU++20)",
			6055: "ISLisp Easy-ISLisp 5.43",
			6056: "Java 24 OpenJDK 24.0.2",
			6057: "JavaScript Bun 1.2.21",
			6058: "JavaScript Deno 2.4.5",
			6059: "JavaScript Node.js 22.19.0",
			6060: "Jule 0.1.6",
			6061: "Koka 3.2.2",
			6062: "Kotlin 2.2.10",
			6063: "Kuin kuincl v.2021.8.17",
			6064: "LazyK irori v1.0.0",
			6065: "Lean 4.22.0",
			6066: "LLVMIR Clang 21.1.0",
			6067: "Lua 5.4.7",
			6068: "Lua LuaJIT 2.1.1703358377",
			6069: "Mercury 22.01.8",
			6071: "Nim Nim 1.6.20",
			6072: "Nim Nim 2.2.4",
			6073: "OCaml ocamlopt 5.3.0",
			6074: "Octave GNU Octave 10.2.0",
			6075: "Pascal FPC 3.2.2",
			6076: "Perl 5.38.2",
			6077: "PHP 8.4.12",
			6078: "Piet your-diary/piet_programming_language 3.0.0 (PPM image)",
			6079: "Pony 0.59.0",
			6080: "PowerShell 7.5.2",
			6081: "Prolog SWI-Prolog 9.2.9",
			6082: "Python3 CPython 3.13.7",
			6083: "Python3 PyPy 3.11-v7.3.20",
			6084: "R GNU R 4.5.0",
			6085: "ReasonML reson 3.16.0",
			6086: "Ruby 3.3 truffleruby 25.0.0",
			6087: "Ruby 3.4.5",
			6088: "Rust 1.89.0",
			6089: "SageMath 10.7",
			6090: "Scala 3.7.2 Dotty",
			6091: "Scala 3.7.2 Scala Native 0.5.8",
			6092: "Scheme ChezScheme 10.2.0",
			6093: "Scheme Gauche 0.9.15",
			6094: "Seed7 Seed7 3.5.0",
			6095: "Swift 6.2",
			6096: "Tcl 9.0.1",
			6097: "Terra 1.2.0",
			6098: "TeX 3.141592653",
			6099: "Text cat 9.4",
			6100: "TypeScript 5.8 Deno 2.4.5",
			6101: "TypeScript 5.9 tsc 5.9.2 Bun 1.2.21",
			6102: "TypeScript 5.9 tsc 5.9.2 Node.js 22.19.0",
			6103: "Uiua 0.16.2",
			6104: "Unison 0.5.47",
			6105: "V 0.4.10",
			6106: "Vala 0.56.18",
			6107: "Verilog 2012 Icarus Verilog 12.0",
			6108: "Veryl 0.16.4",
			6109: "WebAssembly wabt 1.0.34 + iwasm 2.4.1",
			6110: "Whitespace whitespacers 1.3.0",
			6111: "Zig 0.15.1",
			6112: "なでしこ cnako3 3.7.8 Node.js 22.19.0",
			6113: "プロデル mono版プロデル 2.0.1353",
			6114: "Julia 1.11.6",
			6115: "Python Codon 0.19.3",
			6116: "C++ 23 Clang 21.1.0",
			6117: "Fix 1.1.0-alpha.12",
			6118: "SQL DuckDB 1.3.2",
		};
		// filter langMap
		const existingLangs = new Set<string>();
		const langSelect = doc.querySelector<HTMLSelectElement>("#select-lang select.current");
		if (!langSelect) throw new Error("AtCoder language selector was not found.");
		for (const option of langSelect.options) {
			existingLangs.add(option.value);
		}
		for (const key of Object.keys(langMap)) {
			if (!existingLangs.has(key.toString())) {
				delete langMap[key];
			}
		}
		const languageId = new ObservableValue<string>(String(unsafeWindow.$("#select-lang select.current").val()));
		unsafeWindow.$("#select-lang select").change(() => {
			languageId.value = String(unsafeWindow.$("#select-lang select.current").val());
		});
		const language = languageId.map((lang: string) => langMap[lang] ?? "");
		const isTestCasesHere = /^\/contests\/[^\/]+\/tasks\//.test(location.pathname);
		const taskSelector = doc.querySelector<HTMLSelectElement>("#select-task");
		let warnedTestCasesNotLoaded = false;

		function getTaskURI() {
			if (taskSelector)
				return `${location.origin}/contests/${unsafeWindow.contestScreenName}/tasks/${taskSelector.value}`;
			return `${location.origin}${location.pathname}`;
		}

		const testcasesCache: Record<string, {
			state: "loading";
			promise: Promise<void>;
			controller: AbortController
		} | { state: "loaded"; testcases: TestCase[] } | { state: "error"; error: unknown }> = {};
		let activeTestcaseFetchController: AbortController | null = null;
		if (taskSelector) {
			const doFetchTestCases = () => {
				const taskURI = getTaskURI();
				const cached = testcasesCache[taskURI];
				if (cached && (cached.state === "loaded" || cached.state === "loading"))
					return;

				if (activeTestcaseFetchController) {
					activeTestcaseFetchController.abort();
					activeTestcaseFetchController = null;
				}
				const controller = new AbortController();
				activeTestcaseFetchController = controller;
				log.debug("Fetching test cases:", taskURI);

				const promise = fetchTestCases(taskURI, controller.signal).then(testcases => {
					testcasesCache[taskURI] = {testcases, state: "loaded"};
				}).catch(e => {
					if (e && e.name === "AbortError") {
						testcasesCache[taskURI] = {state: "error", error: "aborted"};
						return;
					}
					testcasesCache[taskURI] = {state: "error", error: e};
					log.warn("Failed to fetch test cases:", taskURI, e);
				}).finally(() => {
					if (activeTestcaseFetchController === controller) {
						activeTestcaseFetchController = null;
					}
				});
				testcasesCache[taskURI] = {state: "loading", promise, controller};
			};
			unsafeWindow.$("#select-task").change(doFetchTestCases);
			doFetchTestCases();
		}

		async function fetchTestCases(taskUrl: string, signal: AbortSignal | undefined = undefined): Promise<TestCase[]> {
			const res = await fetch(taskUrl, {signal, credentials: "include"});
			if (!res.ok)
				throw new Error(`Failed to fetch task page: ${res.status} ${res.statusText}`);
			const html = await res.text();
			const taskDoc = new DOMParser().parseFromString(html, "text/html");
			return getTestCases(taskDoc);
		}

		function getTestCases(doc: Document): TestCase[] {
			const selectors: Array<[string, string]> = [
				["#task-statement p+pre.literal-block", ".section"],
				["#task-statement pre.source-code-for-copy", ".part"],
				["#task-statement .lang>*:nth-child(1) .div-btn-copy+pre", ".part"],
				["#task-statement .div-btn-copy+pre", ".part"],
				["#task-statement>.part pre.linenums", ".part"],
				["#task-statement>.part section>pre", ".part"],
				["#task-statement>.part:not(.io-style)>h3+section>pre", ".part"],
				["#task-statement pre", ".part"],
			];
			for (const [selector, closestSelector] of selectors) {
				let e: Element[] = [...doc.querySelectorAll(selector)];
				e = e.filter((e: Element) => {
					if (e.closest(".io-style")) return false;
					return !e.querySelector("var");
				});
				if (e.length === 0)
					continue;
				return pairs(e).map(([input, output], index) => {
					const container = input.closest(closestSelector) || input.parentElement;
					if (!container) throw new Error("Sample container was not found.");
					return {
						selector,
						title: `Sample ${index + 1}`,
						input: input.textContent ?? "",
						output: output.textContent ?? "",
						anchor: container.querySelector(".btn-copy") || container.querySelector("h1,h2,h3,h4,h5,h6"),
					};
				});
			}
			{ // maximum_cup_2018_d
				let e: Element[] = [...doc.querySelectorAll("#task-statement .div-btn-copy+pre")];
				e = e.filter((f: Element) => !f.childElementCount);
				if (e.length) {
					return pairs(e).map(([input, output], index) => ({
						selector: "#task-statement .div-btn-copy+pre",
						title: `Sample ${index + 1}`,
						input: input.textContent ?? "",
						output: output.textContent ?? "",
						anchor: (input.closest(".part") || input.parentElement)?.querySelector(".btn-copy") ?? input,
					}));
				}
			}
			return [];
		}

		return {
			name: "AtCoder",
			language,
			langMap,
			get sourceCode() {
				const $ = unsafeWindow.document.querySelector.bind(unsafeWindow.document);
				if (typeof unsafeWindow["ace"] !== "undefined" && unsafeWindow.ace) {
					const toggle = $(".btn-toggle-editor");
					if (toggle && !toggle.classList.contains("active")) {
						return unsafeWindow.ace.edit($("#editor")).getValue();
					}
					return ($("#plain-textarea") as HTMLTextAreaElement | null)?.value ?? "";
				}
				return unsafeWindow.getSourceCode?.() ?? "";
			},
			set sourceCode(sourceCode) {
				const $ = unsafeWindow.document.querySelector.bind(unsafeWindow.document);
				if (typeof unsafeWindow["ace"] !== "undefined") {
					unsafeWindow["ace"].edit($("#editor")).setValue(sourceCode);
					($("#plain-textarea") as HTMLTextAreaElement).value = sourceCode;
				} else {
					(doc.querySelector(".plain-textarea") as HTMLTextAreaElement).value = sourceCode;
					unsafeWindow.$(".editor").data("editor").doc.setValue(sourceCode);
				}
			},
			submit() {
				(doc.querySelector("#submit") as HTMLElement).click();
			},
			get testButtonContainer() {
				return doc.querySelector("#submit")?.parentElement ?? null;
			},
			get sideButtonContainer() {
				return doc.querySelector(".editor-buttons");
			},
			get bottomMenuContainer() {
				return doc.getElementById("main-div");
			},
			get resultListContainer() {
				return doc.querySelector(".form-code-submit");
			},
			get testCases() {
				const taskURI = getTaskURI();
				if (taskURI in testcasesCache && testcasesCache[taskURI].state === "loaded")
					return testcasesCache[taskURI].testcases;
				if (isTestCasesHere) {
					const testcases = getTestCases(doc);
					testcasesCache[taskURI] = {testcases, state: "loaded"};
					return testcases;
				} else {
					if (!warnedTestCasesNotLoaded) {
						warnedTestCasesNotLoaded = true;
						log.warn("Test cases are not loaded yet. Please wait a moment or re-open the task page.");
					}
					return [];
				}
			},
			get jQuery() {
				return unsafeWindow["jQuery"];
			},
			get taskURI() {
				return getTaskURI();
			},
		};
	}

	async function init$4() {
		if (location.host !== "yukicoder.me")
			throw "Not yukicoder";
		const $ = unsafeWindow.$;
		const doc = unsafeWindow.document as Document;
		const editor = unsafeWindow.ace!.edit("rich_source");
		const eSourceObject = $("#source");
		const eLang = $("#lang");
		const eSamples = $(".sample");
		const langMap: LanguageMap = {
			"cpp14": "C++ C++14 GCC 11.1.0 + Boost 1.77.0",
			"cpp17": "C++ C++17 GCC 11.1.0 + Boost 1.77.0",
			"cpp-clang": "C++ C++17 Clang 10.0.0 + Boost 1.76.0",
			"cpp23": "C++ C++11 GCC 8.4.1",
			"c11": "C++ C++11 GCC 11.1.0",
			"c": "C C90 GCC 8.4.1",
			"java8": "Java Java16 OpenJDK 16.0.1",
			"csharp": "C# CSC 3.9.0",
			"csharp_mono": "C# Mono 6.12.0.147",
			"csharp_dotnet": "C# .NET 5.0",
			"perl": "Perl 5.26.3",
			"raku": "Raku Rakudo v2021-07-2-g74d7ff771",
			"php": "PHP 7.2.24",
			"php7": "PHP 8.0.8",
			"python3": "Python3 3.9.6 + numpy 1.14.5 + scipy 1.1.0",
			"pypy2": "Python PyPy2 7.3.5",
			"pypy3": "Python3 PyPy3 7.3.5",
			"ruby": "Ruby 3.0.2p107",
			"d": "D DMD 2.097.1",
			"go": "Go 1.16.6",
			"haskell": "Haskell 8.10.5",
			"scala": "Scala 2.13.6",
			"nim": "Nim 1.4.8",
			"rust": "Rust 1.53.0",
			"kotlin": "Kotlin 1.5.21",
			"scheme": "Scheme Gauche 0.9.10",
			"crystal": "Crystal 1.1.1",
			"swift": "Swift 5.4.2",
			"ocaml": "OCaml 4.12.0",
			"clojure": "Clojure 1.10.2.790",
			"fsharp": "F# 5.0",
			"elixir": "Elixir 1.7.4",
			"lua": "Lua LuaJIT 2.0.5",
			"fortran": "Fortran gFortran 8.4.1",
			"node": "JavaScript Node.js 15.5.0",
			"typescript": "TypeScript 4.3.5",
			"lisp": "Lisp Common Lisp sbcl 2.1.6",
			"sml": "ML Standard ML MLton 20180207-6",
			"kuin": "Kuin KuinC++ v.2021.7.17",
			"vim": "Vim v8.2",
			"sh": "Bash 4.4.19",
			"nasm": "Assembler nasm 2.13.03",
			"clay": "cLay 20210917-1",
			"bf": "Brainfuck BFI 1.1",
			"Whitespace": "Whitespace 0.3",
			"text": "Text cat 8.3",
		};
		// place anchor elements
		for (const btnCopyInput of doc.querySelectorAll(".copy-sample-input")) {
			btnCopyInput.parentElement?.insertBefore(newElement("span", {className: "atcoder-easy-test-anchor"}), btnCopyInput);
		}
		const language = new ObservableValue<string>(langMap[String(eLang.val())] ?? "");
		eLang.on("change", () => {
			language.value = langMap[String(eLang.val())] ?? "";
		});
		return {
			name: "yukicoder",
			language,
			get sourceCode() {
				if (eSourceObject.is(":visible"))
					return eSourceObject.val();
				return editor.getSession().getValue();
			},
			set sourceCode(sourceCode) {
				eSourceObject.val(sourceCode);
				editor.getSession().setValue(sourceCode);
			},
			submit() {
				(doc.querySelector(`#submit_form input[type="submit"]`) as HTMLElement).click();
			},
			get testButtonContainer() {
				return doc.querySelector("#submit_form");
			},
			get sideButtonContainer() {
				return doc.querySelector("#toggle_source_editor")?.parentElement ?? null;
			},
			get bottomMenuContainer() {
				return doc.body;
			},
			get resultListContainer() {
				return doc.querySelector("#content");
			},
			get testCases() {
				const testCases: TestCase[] = [];
				let sampleId = 1;
				for (let i = 0; i < eSamples.length; i++) {
					const eSample = eSamples.eq(i);
					const [eInput, eOutput] = eSample.find("pre");
					testCases.push({
						title: `Sample ${sampleId++}`,
						input: eInput.textContent ?? "",
						output: eOutput.textContent ?? "",
						anchor: eSample.find(".atcoder-easy-test-anchor")[0] ?? eSample[0],
					});
				}
				return testCases;
			},
			get jQuery() {
				return $;
			},
			get taskURI() {
				return location.href;
			},
		};
	}

	class Editor {
		_element: HTMLTextAreaElement;

		constructor(_lang: string) {
			this._element = document.createElement("textarea");
			this._element.style.fontFamily = "monospace";
			this._element.style.width = "100%";
			this._element.style.minHeight = "5em";
		}

		get element(): HTMLTextAreaElement {
			return this._element;
		}

		get sourceCode(): string {
			return this._element.value;
		}

		set sourceCode(sourceCode: string) {
			this._element.value = sourceCode;
		}

		setLanguage(_lang: string): void {
		}
	}

	const langMap: LanguageMap = {
		3: "Delphi 7",
		4: "Pascal Free Pascal 3.0.2",
		6: "PHP 7.2.13",
		7: "Python 2.7.18",
		9: "C# Mono 6.8",
		12: "Haskell GHC 8.10.1",
		13: "Perl 5.20.1",
		19: "OCaml 4.02.1",
		20: "Scala 2.12.8",
		28: "D DMD32 v2.091.0",
		31: "Python3 3.8.10",
		32: "Go 1.15.6",
		34: "JavaScript V8 4.8.0",
		36: "Java 1.8.0_241",
		40: "Python PyPy2 2.7 (7.3.0)",
		41: "Python3 PyPy3 3.7 (7.3.0)",
		43: "C C11 GCC 5.1.0",
		48: "Kotlin 1.5.31",
		49: "Rust 1.49.0",
		50: "C++ C++14 G++ 6.4.0",
		51: "Pascal PascalABC.NET 3.4.1",
		52: "C++ C++17 Clang++",
		54: "C++ C++17 G++ 7.3.0",
		55: "JavaScript Node.js 12.6.3",
		59: "C++ Microsoft Visual C++ 2017",
		60: "Java 11.0.6",
		61: "C++ C++17 9.2.0 (64 bit, msys 2)",
		65: "C# 8, .NET Core 3.1",
		67: "Ruby 3.0.0",
		70: "Python3 PyPy 3.7 (7.3.5, 64bit)",
		72: "Kotlin 1.5.31",
		73: "C++ GNU G++ 11.2.0 (64 bit, winlibs)",
		75: "Rust 1.75.0 (2021)",
		79: "C# 10, .NET SDK 6.0",
		83: "Kotlin 1.7.20",
		87: "Java 21 64bit",
		88: "Kotlin 1.9.21",
		89: "C++ GNU G++20 13.2 (64 bit, winlibs)",
		91: "GNU G++23 14.2 (64 bit, msys2)",
	};

	config.registerFlag("site.codeforces.showEditor", true, "Show Editor in Codeforces Problem Page");

	async function init$3() {
		if (location.host !== "codeforces.com")
			throw "not Codeforces";
		const doc = unsafeWindow.document as Document;
		const eLang = doc.querySelector<HTMLSelectElement>("select[name='programTypeId']");
		if (!eLang) throw new Error("Codeforces language selector was not found.");
		doc.head.appendChild(newElement("link", {
			rel: "stylesheet",
			href: "https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/css/bootstrap.min.css",
		}));
		doc.head.appendChild(newElement("style", {
			textContent: `
.atcoder-easy-test-btn-run-case {
  float: right;
  line-height: 1.1rem;
}
    `,
		}));
		const eButtons = newElement("span");
		doc.querySelector(".submitForm")?.appendChild(eButtons);
		await loadScript("https://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js");
		const jQuery = (unsafeWindow as Window & { jQuery?: UserScriptJQuery }).jQuery?.noConflict?.();
		if (!jQuery) throw new Error("jQuery was not loaded.");
		const codeforcesWindow = unsafeWindow as Window & {
			jQuery?: UserScriptJQuery;
			$?: UserScriptJQuery;
			jQuery11?: UserScriptJQuery
		};
		codeforcesWindow.jQuery = codeforcesWindow.$;
		codeforcesWindow.jQuery11 = jQuery;
		await loadScript("https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/js/bootstrap.min.js", null, {
			jQuery,
			$: jQuery
		});
		const language = new ObservableValue<string>(langMap[eLang.value] ?? "");
		eLang.addEventListener("change", () => {
			language.value = langMap[eLang.value];
		});
		let _sourceCode = "";
		const submitForm = doc.querySelector(".submitForm") as HTMLFormElement;
		const eFile = submitForm.elements.namedItem("sourceFile") as HTMLInputElement;
		eFile.addEventListener("change", async () => {
			const file = eFile.files?.[0];
			if (file) {
				_sourceCode = await file.text();
				if (editor)
					editor.sourceCode = _sourceCode;
			}
		});
		let editor: { element?: HTMLElement; sourceCode: string; setLanguage(lang: string): void } | null = null;
		let waitCfFastSubmitCount = 0;
		const waitCfFastSubmit = setInterval(() => {
			if (document.getElementById("editor")) {
				// cf-fast-submit
				if (editor && editor.element)
					editor.element.style.display = "none";
				// 言語セレクトを同期させる
				const eLang2 = doc.querySelector<HTMLSelectElement>(".submit-form select[name='programTypeId']");
				if (eLang2) {
					eLang.addEventListener("change", () => {
						eLang2.value = eLang.value;
					});
					eLang2.addEventListener("change", () => {
						eLang.value = eLang2.value;
						language.value = langMap[eLang.value];
					});
				}
				// エディタを使う
				const aceEditor = unsafeWindow.ace!.edit("editor");
				editor = {
					get sourceCode() {
						return aceEditor.getValue();
					},
					set sourceCode(sourceCode) {
						aceEditor.setValue(sourceCode);
					},
					setLanguage(_lang: string): void {
					},
				};
				// ボタンを追加する
				const buttonContainer = (doc.querySelector(".submit-form .submit") as HTMLElement).parentElement;
				if (!buttonContainer) throw new Error("Codeforces button container was not found.");
				buttonContainer.appendChild(newElement("button", {
					type: "button",
					className: "btn btn-info",
					textContent: "Test & Submit",
					onclick: () => events.trig("testAndSubmit"),
				}));
				buttonContainer.appendChild(newElement("button", {
					type: "button",
					className: "btn btn-default",
					textContent: "Test All Samples",
					onclick: () => events.trig("testAllSamples"),
				}));
				clearInterval(waitCfFastSubmit);
			} else {
				waitCfFastSubmitCount++;
				if (waitCfFastSubmitCount >= 100)
					clearInterval(waitCfFastSubmit);
			}
		}, 100);
		if (config.get("site.codeforces.showEditor", true)) {
			editor = new Editor(langMap[eLang.value].split(" ")[0]);
			const pageContent = doc.getElementById("pageContent");
			if (pageContent && editor.element) pageContent.appendChild(editor.element);
			language.addListener((lang: string) => {
				editor?.setLanguage(lang);
			});
		}
		return {
			name: "Codeforces",
			language,
			get sourceCode() {
				if (editor)
					return editor.sourceCode;
				return _sourceCode;
			},
			set sourceCode(sourceCode) {
				const container = new DataTransfer();
				container.items.add(new File([sourceCode], "prog.txt", {type: "text/plain"}));
				const eFile = (doc.querySelector(".submitForm") as HTMLFormElement).elements.namedItem("sourceFile") as HTMLInputElement;
				eFile.files = container.files;
				_sourceCode = sourceCode;
				if (editor)
					editor.sourceCode = sourceCode;
			},
			submit() {
				if (editor)
					_sourceCode = editor.sourceCode;
				this.sourceCode = _sourceCode;
				(doc.querySelector(`.submitForm .submit`) as HTMLElement).click();
			},
			get testButtonContainer() {
				return eButtons;
			},
			get sideButtonContainer() {
				return eButtons;
			},
			get bottomMenuContainer() {
				return doc.body;
			},
			get resultListContainer() {
				return doc.querySelector("#pageContent");
			},
			get testCases() {
				const testcases = [];
				let num = 1;
				for (const eSampleTest of doc.querySelectorAll(".sample-test")) {
					const inputs = eSampleTest.querySelectorAll(".input pre");
					const outputs = eSampleTest.querySelectorAll(".output pre");
					const anchors = eSampleTest.querySelectorAll(".input .title .input-output-copier");
					const count = Math.min(inputs.length, outputs.length, anchors.length);
					for (let i = 0; i < count; i++) {
						let inputText = "";
						for (const node of inputs[i].childNodes) {
							inputText += node.textContent;
							if (node.nodeType === Node.ELEMENT_NODE && ((node as Element).tagName === "DIV" || (node as Element).tagName === "BR")) {
								inputText += "\n";
							}
						}
						testcases.push({
							title: `Sample ${num++}`,
							input: inputText,
							output: outputs[i].textContent,
							anchor: anchors[i],
						});
					}
				}
				return testcases;
			},
			get jQuery() {
				return jQuery;
			},
			get taskURI() {
				return location.href;
			},
		};
	}

	config.registerFlag("site.codeforcesMobile.showEditor", true, "Show Editor in Mobile Codeforces (m[1-3].codeforces.com) Problem Page");

	async function init$2() {
		if (!/^m[1-3]\.codeforces\.com$/.test(location.host))
			throw "not Codeforces Mobile";
		const url = /\/contest\/(\d+)\/problem\/([^/]+)/.exec(location.pathname);
		if (!url) throw new Error("Codeforces Mobile problem URL was not matched.");
		const contestId = url[1];
		const problemId = url[2];
		const doc = unsafeWindow.document as Document;
		const main = doc.querySelector("main");
		if (!main) throw new Error("Codeforces Mobile main element was not found.");
		doc.head.appendChild(newElement("link", {
			rel: "stylesheet",
			href: "https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/css/bootstrap.min.css",
		}));
		await loadScript("https://maxcdn.bootstrapcdn.com/bootstrap/3.3.1/js/bootstrap.min.js");
		const language = new ObservableValue("");
		let submit: () => void = () => {
		};
		let getSourceCode: () => string = () => "";
		let setSourceCode: (sourceCode: string) => void = (_sourceCode: string) => {
		};
		// make Editor
		if (config.get("site.codeforcesMobile.showEditor", true)) {
			const frame = newElement("iframe", {
				src: `/contest/${contestId}/submit`,
				style: {
					display: "none",
				},
			});
			doc.body.appendChild(frame);
			await new Promise<void>(done => {
				frame.onload = () => done();
			});
			const fdoc = frame.contentDocument;
			if (!fdoc) throw new Error("Codeforces submit iframe document is not available.");
			const form = fdoc.querySelector("._SubmitPage_submitForm") as HTMLFormElement | null;
			if (!form) throw new Error("Codeforces submit form was not found.");
			const problemIndexInput = form.elements.namedItem("problemIndex") as HTMLInputElement;
			const programTypeSelect = form.elements.namedItem("programTypeId") as HTMLSelectElement;
			const sourceInput = form.elements.namedItem("source") as HTMLTextAreaElement;
			problemIndexInput.value = problemId;
			problemIndexInput.readOnly = true;
			programTypeSelect.addEventListener("change", (event) => {
				language.value = langMap[(event.currentTarget as HTMLSelectElement).value];
			});
			for (const row of form.children) {
				if (row.tagName !== "DIV")
					continue;
				row.classList.add("form-group");
				const control = row.querySelector("*[name]");
				if (control)
					control.classList.add("form-control");
			}
			form.parentElement?.removeChild(form);
			main.appendChild(form);
			submit = () => form.submit();
			getSourceCode = () => sourceInput.value;
			setSourceCode = (sourceCode: string): void => {
				sourceInput.value = sourceCode;
			};
		}
		return {
			name: "Codeforces",
			language,
			get sourceCode() {
				return getSourceCode();
			},
			set sourceCode(sourceCode) {
				setSourceCode(sourceCode);
			},
			submit,
			get testButtonContainer() {
				return main;
			},
			get sideButtonContainer() {
				return main;
			},
			get bottomMenuContainer() {
				return doc.body;
			},
			get resultListContainer() {
				return main;
			},
			get testCases(): TestCase[] {
				const testcases: TestCase[] = [];
				let index = 1;
				for (const container of doc.querySelectorAll(".sample-test")) {
					const input = container.querySelector(".input pre.content")?.textContent ?? "";
					const output = container.querySelector(".output pre.content")?.textContent ?? "";
					const anchor = container.querySelector(".input .title") ?? container;
					testcases.push({
						input, output, anchor,
						title: `Sample ${index++}`,
					});
				}
				return testcases;
			},
			get jQuery() {
				return unsafeWindow["jQuery"];
			},
			get taskURI() {
				return location.href;
			},
		};
	}

	async function init$1() {
		if (location.host !== "greasyfork.org" && !location.href.match(/433152-atcoder-easy-test-v2/))
			throw "Not about page";
		const doc = unsafeWindow.document as Document;
		await loadScript("https://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js");
		const jQuery = unsafeWindow["jQuery"];
		await loadScript("https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/js/bootstrap.min.js", null, {
			jQuery,
			$: jQuery
		});
		const e = newElement("div");
		doc.getElementById("install-area")?.appendChild(newElement("button", {
			type: "button",
			textContent: "Open config",
			onclick: () => settings.open(),
		}));
		return {
			name: "About Page",
			language: new ObservableValue(""),
			get sourceCode() {
				return "";
			},
			set sourceCode(_sourceCode) {
			},
			submit() {
			},
			get testButtonContainer() {
				return e;
			},
			get sideButtonContainer() {
				return e;
			},
			get bottomMenuContainer() {
				return e;
			},
			get resultListContainer() {
				return e;
			},
			get testCases(): TestCase[] {
				return [];
			},
			get jQuery() {
				return jQuery;
			},
			get taskURI() {
				return "";
			},
		};
	}

	// 設定ページが開けなくなるのを避ける
	const inits: Array<Promise<any>> = [init$1()];
	config.registerFlag("site.atcoder", true, "Use AtCoder Easy Test in AtCoder");
	if (config.get("site.atcoder", true))
		inits.push(init$5());
	config.registerFlag("site.yukicoder", true, "Use AtCoder Easy Test in yukicoder");
	if (config.get("site.yukicoder", true))
		inits.push(init$4());
	config.registerFlag("site.codeforces", true, "Use AtCoder Easy Test in Codeforces");
	if (config.get("site.codeforces", true))
		inits.push(init$3());
	config.registerFlag("site.codeforcesMobile", true, "Use AtCoder Easy Test in Codeforces Mobile (m[1-3].codeforces.com)");
	if (config.get("site.codeforcesMobile", true))
		inits.push(init$2());
	const site = Promise.any(inits);
	site.catch(() => {
		for (const promise of inits) {
			promise.catch(console.error);
		}
	});

	class WandboxRunner extends CodeRunner {
		name: string;
		options: RunnerOptions | ((sourceCode: string, input: string) => RunnerOptions);

		constructor(name: string, label: string, options: RunnerOptions | ((sourceCode: string, input: string) => RunnerOptions) = {}) {
			super(label, "Wandbox");
			this.name = name;
			this.options = options;
		}

		getOptions(sourceCode: string, input: string): RunnerOptions {
			if (typeof this.options === "function") return this.options(sourceCode, input);
			return this.options;
		}

		run(sourceCode: string, input: string, options: RunnerOptions = {}): Promise<RunnerResult> {
			return this.request(Object.assign({
				compiler: this.name,
				code: sourceCode,
				stdin: input,
			}, Object.assign(options, this.getOptions(sourceCode, input))));
		}

		async request(body: WandboxRequest): Promise<RunnerResult> {
			const startTime = Date.now();
			let res: Record<string, any>;
			try {
				res = await fetch("https://wandbox.org/api/compile.json", {
					method: "POST",
					mode: "cors",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				}).then(r => r.json());
			} catch (error) {
				console.error(error);
				return {
					status: "IE",
					input: body.stdin,
					error: String(error),
				};
			}
			const endTime = Date.now();
			const result = {
				status: "OK",
				exitCode: String(res.status),
				execTime: endTime - startTime,
				input: body.stdin,
				output: String(res.program_output || ""),
				error: String(res.program_error || ""),
			};
			// 正常終了以外の場合
			if (res.status !== 0) {
				if (res.signal) result.exitCode += ` (${res.signal})`;
				result.output = String(res.compiler_output || "") + String(result.output || "");
				result.error = String(res.compiler_error || "") + String(result.error || "");
				if (res.compiler_output || res.compiler_error) result.status = "CE";
				else result.status = "RE";
			}
			return result;
		}
	}

	class WandboxCppRunner extends WandboxRunner {
		async run(sourceCode: string, input: string, _options: RunnerOptions = {}): Promise<RunnerResult> {
			// ACL を結合する
			const ACLBase = "https://cdn.jsdelivr.net/gh/atcoder/ac-library/";
			const files = new Map<string, string | null>();
			const includeHeader = async (source: string): Promise<void> => {
				const pattern = /^#\s*include\s*[<"]atcoder\/([^>"]+)[>"]/gm;
				const loaded: Array<[string, Promise<string>]> = [];
				for (const match of source.matchAll(pattern)) {
					const file = "atcoder/" + match[1];
					if (files.has(file))
						continue;
					files.set(file, null);
					loaded.push([file, fetch(ACLBase + file, {
						mode: "cors",
						cache: "force-cache",
					}).then(r => r.text())]);
				}
				const included = await Promise.all(loaded.map(async ([file, r]: [string, Promise<string>]) => {
					const source = await r;
					files.set(file, source);
					return source;
				}));
				for (const source of included) {
					await includeHeader(source);
				}
			};
			await includeHeader(sourceCode);
			const codes: Array<{ file: string; code: string | null }> = [];
			for (const [file, code] of files) {
				codes.push({file, code,});
			}
			return await this.request(Object.assign({
				compiler: this.name,
				code: sourceCode,
				stdin: input,
				codes,
			}, Object.assign(options, this.getOptions(sourceCode, input))));
		}
	}

	// 設定項目を定義
	config.registerCount("wandboxAPI.cacheLifetime", 24 * 60 * 60 * 1000, "lifetime [ms] of Wandbox compiler list cache");

	async function fetchWandboxCompilers(): Promise<WandboxCompiler[]> {
		// キャッシュが有効な場合はキャッシュを使う
		const cached = config.get("wandboxAPI.cachedCompilerList", {value: null, lastModified: -Infinity});
		if (
			Array.isArray(cached.value)
			&& Date.now() - cached.lastModified <= config.get("wandboxAPI.cacheLifetime", 24 * 60 * 60 * 1000)
		) {
			return cached.value;
		}
		// キャッシュが無効な場合は fetch
		const response = await fetch("https://wandbox.org/api/list.json");
		const compilers = await response.json() as WandboxCompiler[];
		if (!Array.isArray(compilers)) {
			throw new Error("Wandbox compiler list is not a JSON array.");
		}
		config.set("wandboxAPI.cachedCompilerList", {value: compilers, lastModified: Date.now()});
		config.save();
		return compilers;
	}

	function getOptimizationOption(compiler: WandboxCompiler): string | undefined {
		// Optimizationという名前のSwitchから、最適化のオプションを取得する
		return compiler.switches.find((sw: Record<string, string>) => sw["display-name"] === "Optimization")
			?.name;
	}

	function toRunner(compiler: WandboxCompiler): WandboxRunner {
		const optimizationOption = getOptimizationOption(compiler);
		if (compiler.language === "C++") {
			return new WandboxCppRunner(compiler.name, compiler.language + " " + compiler.name + " + ACL", {
				"compiler-option-raw": "-I.",
				options: optimizationOption,
			});
		} else {
			return new WandboxRunner(compiler.name, compiler.language + " " + compiler.name, {
				options: optimizationOption,
			});
		}
	}

	let runners$1: RunnerMap = {};
	const currentLocalRunners: string[] = [];
	let localRunnerCacheURL = "";
	let localRunnerCacheSignature = "";

	class LocalRunner extends CodeRunner {
		compilerName: string;

		static setRunners(_runners: RunnerMap) {
			runners$1 = _runners;
		}

		static async update() {
			const apiURL = config.getString("codeRunner.localRunnerURL", "");
			if (!apiURL) {
				if (currentLocalRunners.length === 0 && localRunnerCacheURL === "") {
					return false;
				}
				for (const key of currentLocalRunners) {
					delete runners$1[key];
				}
				currentLocalRunners.length = 0;
				localRunnerCacheURL = "";
				localRunnerCacheSignature = "";
				return true;
			}
			if (!isHttpUrl(apiURL)) throw "LocalRunner: invalid localRunnerURL";
			try {
				const res = await fetch(apiURL, {
					method: "POST",
					mode: "cors",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(buildLocalRunnerListRequest()),
				}).then(r => r.json()) as LocalRunnerCompilerInfo[];
				const nextEntries = [];
				for (const {compilerName, label, ...info} of res) {
					const key = buildLocalRunnerKey({compilerName, label, ...info});
					nextEntries.push({key, compilerName, label});
				}
				const nextSignature = nextEntries.map(({key}) => key).join("\n");
				if (localRunnerCacheURL === apiURL && localRunnerCacheSignature === nextSignature) {
					return false;
				}
				for (const key of currentLocalRunners) {
					delete runners$1[key];
				}
				currentLocalRunners.length = 0;
				for (const {key, compilerName, label} of nextEntries) {
					runners$1[key] = new LocalRunner(compilerName, label);
					currentLocalRunners.push(key);
				}
				localRunnerCacheURL = apiURL;
				localRunnerCacheSignature = nextSignature;
				return true;
			} catch (e) {
				console.error("LocalRunner:", e);
				return false;
			}
		}

		constructor(compilerName: string, label: string) {
			super(label, "Local");
			this.compilerName = compilerName;
		}

		async run(sourceCode: string, input: string, _options: RunnerOptions = {}): Promise<RunnerResult> {
			const apiURL = config.getString("codeRunner.localRunnerURL", "");
			if (!isHttpUrl(apiURL)) {
				throw "LocalRunner: invalid localRunnerURL";
			}
			let res: LocalRunnerRunResponse;
			try {
				res = await fetch(apiURL, {
					method: "POST",
					mode: "cors",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(buildLocalRunnerRunRequest(sourceCode, input, this.compilerName)),
				}).then(r => r.json()) as LocalRunnerRunResponse;
			} catch (error) {
				return {
					status: "IE",
					input,
					error: String(error),
				};
			}
			return {
				status: toEasyTestStatus(res.status, res.exitCode),
				exitCode: String(res.exitCode),
				execTime: +res.time,
				memory: +res.memory,
				input,
				output: res.stdout ?? "",
				error: res.stderr ?? "",
			};
		}
	}

	// runners[key] = runner; key = language + " " + environmentInfo
	const runners: RunnerMap = {
		"C C17 Clang paiza.io": new PaizaIORunner("c", "C (C17 / Clang)"),
		"Python3 CPython paiza.io": new PaizaIORunner("python3", "Python3"),
		"Python3 Pyodide": pyodideRunner,
		"Bash paiza.io": new PaizaIORunner("bash", "Bash"),
		"Clojure paiza.io": new PaizaIORunner("clojure", "Clojure"),
		"D LDC paiza.io": new PaizaIORunner("d", "D (LDC)"),
		"Erlang paiza.io": new PaizaIORunner("erlang", "Erlang"),
		"Elixir paiza.io": new PaizaIORunner("elixir", "Elixir"),
		"F# Interactive paiza.io": new PaizaIORunner("fsharp", "F# (Interactive)"),
		"Haskell paiza.io": new PaizaIORunner("haskell", "Haskell"),
		"JavaScript paiza.io": new PaizaIORunner("javascript", "JavaScript"),
		"Kotlin paiza.io": new PaizaIORunner("kotlin", "Kotlin"),
		"Objective-C paiza.io": new PaizaIORunner("objective-c", "Objective-C"),
		"Perl paiza.io": new PaizaIORunner("perl", "Perl"),
		"PHP paiza.io": new PaizaIORunner("php", "PHP"),
		"Ruby paiza.io": new PaizaIORunner("ruby", "Ruby"),
		"Rust 1.42.0 AtCoder": new AtCoderRunner("4050", "Rust (1.42.0)"),
		"Rust paiza.io": new PaizaIORunner("rust", "Rust"),
		"Scala paiza": new PaizaIORunner("scala", "Scala"),
		"Scheme paiza.io": new PaizaIORunner("scheme", "Scheme"),
		"Swift paiza.io": new PaizaIORunner("swift", "Swift"),
		"Text local": new CustomRunner("Text", async (sourceCode, input) => {
			return {
				status: "OK",
				exitCode: "0",
				input,
				output: sourceCode,
			};
		}),
		"Basic Visual Basic paiza.io": new PaizaIORunner("vb", "Visual Basic"),
		"COBOL Free paiza.io": new PaizaIORunner("cobol", "COBOL - Free"),
		"COBOL Fixed OpenCOBOL 1.1.0 AtCoder": new AtCoderRunner("4060", "COBOL - Fixed (OpenCOBOL 1.1.0)"),
		"COBOL Free OpenCOBOL 1.1.0 AtCoder": new AtCoderRunner("4061", "COBOL - Free (OpenCOBOL 1.1.0)"),
	};

	// wandboxの環境を追加
	// 以前はロード時に即 fetchWandboxCompilers() を呼び出していたが、
	// 実際に必要になる（= getEnvironment が呼ばれる）まで遅延させることで
	// ページロード直後の負荷を少し抑える。
	let wandboxPromise: Promise<void> | null = null;

	function ensureWandboxCompilersLoaded(): Promise<void> {
		if (!wandboxPromise) {
			wandboxPromise = fetchWandboxCompilers().then((compilers: WandboxCompiler[]) => {
				for (const compiler of compilers) {
					let language = compiler.language;
					if (compiler.language === "Python" && /python-3\./.test(compiler.version)) {
						language = "Python3";
					}
					const key = language + " " + compiler.name;
					runners[key] = toRunner(compiler);
					log.debug("wandbox", key, runners[key]);
				}
			});
		}
		return wandboxPromise;
	}

	site.then(site => {
		if (site.name === "AtCoder") {
			// AtCoderRunner がない場合は、追加する
			for (const [languageId, descriptor] of Object.entries(site.langMap as Record<string, string>)) {
				const m = descriptor.match(/([^ ]+)(.*)/);
				if (m) {
					const name = `${m[1]} ${m[2].slice(1)} AtCoder`;
					runners[name] = new AtCoderRunner(languageId, descriptor);
				}
			}
		}
	});

	// LocalRunner 関連
	// NOTE: 以前は "codeRunner. localRunnerURL" とスペース入りで登録していたため、
	// UI から設定しても実際の取得キーとずれてしまっていた。キー名を揃えてバグを修正。
	config.registerText("codeRunner.localRunnerURL", "", "URL of Local Runner API (cf. https://github.com/magurofly/atcoder-easy-test/blob/main/v2/docs/LocalRunner.md)");
	LocalRunner.setRunners(runners);
	const localRunnerPromise = LocalRunner.update();

	// ========== 事前コンパイル機能 ==========
	// Java ローカル実行向けに、エディタ変更時に軽くコンパイルだけ走らせる機能。
	// 「ローカルサーバーをデフォルトで使いたい」という要望に合わせて、既定値は true にする。
	config.registerFlag("codeRunner.precompile.enable", true, "Enable LocalRunner precompile on editor changes");

	let precompileTimeout: ReturnType<typeof setTimeout> | null = null;
	let lastPrecompiledCode = '';
	let isPrecompiling = false;
	const PRECOMPILE_DELAY_MS = 180;

	async function triggerPrecompile() {
		if (isPrecompiling) return;
		isPrecompiling = true;

		try {
			const apiURL = config.getString("codeRunner.localRunnerURL", "");
			if (!apiURL || !isHttpUrl(apiURL)) return;

			// 設定で無効化されている場合は何もしない
			if (!config.get("codeRunner.precompile.enable", true)) return;

			const currentSite = await site;
			const sourceCode = currentSite.sourceCode;

			if (!sourceCode || sourceCode === lastPrecompiledCode) return;
			lastPrecompiledCode = sourceCode;

			fetch(apiURL, {
				method: "POST",
				mode: "cors",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify(buildLocalRunnerPrecompileRequest(sourceCode))
			}).catch(() => {
			});

			log.debug("[LocalRunner] Precompile triggered");
		} catch (e) {
			log.error("[LocalRunner] Precompile error:", e);
		} finally {
			isPrecompiling = false;
		}
	}

	function schedulePrecompile() {
		// プリコンパイル機能が無効なら何もしない
		if (!config.get("codeRunner.precompile.enable", true)) return;
		if (precompileTimeout) clearTimeout(precompileTimeout);
		precompileTimeout = setTimeout(triggerPrecompile, PRECOMPILE_DELAY_MS);
	}

	site.then(currentSite => {
		if (currentSite.name === "AtCoder") {
			let checkCount = 0;
			const maxChecks = 40;
			const checkEditor = setInterval(() => {
				checkCount++;
				if (typeof unsafeWindow["ace"] !== "undefined") {
					clearInterval(checkEditor);
					try {
						const editorElement = unsafeWindow.document.getElementById("editor");
						if (editorElement) {
							const editor = unsafeWindow["ace"].edit(editorElement);
							editor.getSession().on("change", schedulePrecompile);
							log.debug("[LocalRunner] Editor monitoring started");
							// 最初の一回だけ軽くプリコンパイル（有効な場合のみ）
							schedulePrecompile();
						}
					} catch (e) {
						log.error("[LocalRunner] Failed to monitor editor:", e);
					}
				} else if (checkCount >= maxChecks) {
					clearInterval(checkEditor);
					log.warn("[LocalRunner] Editor detection timeout");
				}
			}, 500);
		}
	});
	// ========== 事前コンパイル機能 ここまで ==========

	log.debug("codeRunner OK");
	config.registerCount("codeRunner.maxRetry", 3, "Max count of retry when IE (Internal Error)");
	const codeRunner = {
		// 指定した環境でコードを実行する
		async run(runnerId: string, sourceCode: string, input: string, expectedOutput: string | null, options: RunnerOptions = {
			trim: true,
			split: true
		}) {
			// CodeRunner が存在しない言語ID
			if (!(runnerId in runners))
				return Promise.reject("Language not supported");
			// 最後に実行したコードを保存
			if (sourceCode.length > 0)
				site.then(site => codeSaver.save(site.taskURI, sourceCode));
			// 実行
			const maxRetry = config.get("codeRunner.maxRetry", 3);
			for (let retry = 0; retry < maxRetry; retry++) {
				try {
					const result = await runners[runnerId].test(sourceCode, input, expectedOutput, options);
					const lang = runnerId.split(" ")[0];
					if (result.status === "IE") {
						console.error(result);
						const runnerIds = Object.keys(runners).filter(runnerId => runnerId.split(" ")[0] === lang);
						const index = runnerIds.indexOf(runnerId);
						runnerId = runnerIds[(index + 1) % runnerIds.length];
						continue;
					}
					return result;
				} catch (e) {
					console.error(e);
				}
			}
		},
		// 環境の名前の一覧を取得する
		// @return runnerIdとラベルのペアの配列
		async getEnvironment(languageId: string, options: RunnerOptions = {}): Promise<Array<[string, string | undefined]>> {
			const {refreshLocalRunner = true} = options;
			await ensureWandboxCompilersLoaded(); // wandboxAPI がコンパイラ情報を取ってくるのを待つ
			await localRunnerPromise; // LocalRunner がコンパイラ情報を取ってくるのを待つ
			// リロード時・言語変更時にローカルサーバーの起動状態を再チェック
			if (refreshLocalRunner) await LocalRunner.update();
			let langs = similarLangs(languageId, Object.keys(runners));
			// Java 系のときだけ、実行環境の優先順位を調整する
			// - Local Server が起動していれば LocalRunner を優先
			// - そうでなければ AtCoder judge を優先
			// languageId は "Java OpenJDK 17" のような形式
			try {
				const langName = String(languageId).split(" ", 1)[0];
				if (langName === "Java") {
					const local = [];
					const atcoder = [];
					const other = [];
					for (const id of langs) {
						if (runners[id] instanceof LocalRunner) local.push(id);
						else if (runners[id] instanceof AtCoderRunner) atcoder.push(id);
						else other.push(id);
					}
					// Local Server が起動している（local runners が登録されている）場合は LocalRunner を優先
					// そうでなければ AtCoder judge を優先
					langs = local.length > 0 ? local.concat(atcoder).concat(other) : atcoder.concat(other);
				}
			} catch (e) {
				console.error("AtCoder Easy Test: getEnvironment(Java-local sort) failed:", e);
			}
			if (langs.length === 0)
				throw `Undefined language: ${languageId}`;
			return langs.map(runnerId => [runnerId, runners[runnerId].label]);
		},
	};

	const hBottomMenu = "<div id=\"bottom-menu-wrapper\" class=\"navbar navbar-default navbar-fixed-bottom\">\n  <div class=\"container\">\n    <div class=\"navbar-header\">\n      <button id=\"bottom-menu-key\" type=\"button\" class=\"navbar-toggle collapsed glyphicon glyphicon-menu-down\" data-toggle=\"collapse\" data-target=\"#bottom-menu\"></button>\n    </div>\n    <div id=\"bottom-menu\" class=\"collapse navbar-collapse\">\n      <ul id=\"bottom-menu-tabs\" class=\"nav nav-tabs\"></ul>\n      <div id=\"bottom-menu-contents\" class=\"tab-content\"></div>\n    </div>\n  </div>\n</div>";

	const hStyle$1 = "<style>\n#bottom-menu-wrapper {\n  background: transparent !important;\n  border: none !important;\n  pointer-events: none;\n  padding: 0;\n}\n\n#bottom-menu-wrapper>.container {\n  position: absolute;\n  bottom: 0;\n  width: 100%;\n  padding: 0;\n}\n\n#bottom-menu-wrapper>.container>.navbar-header {\n  float: none;\n}\n\n#bottom-menu-key {\n  display: block;\n  float: none;\n  margin: 0 auto;\n  padding: 10px 3em;\n  border-radius: 5px 5px 0 0;\n  background: #000;\n  opacity: 0.5;\n  color: #FFF;\n  cursor: pointer;\n  pointer-events: auto;\n  text-align: center;\n}\n\n@media screen and (max-width: 767px) {\n  #bottom-menu-key {\n    opacity: 0.25;\n  }\n}\n\n#bottom-menu-key.collapsed:before {\n  content: \"\\e260\";\n}\n\n#bottom-menu-tabs {\n  padding: 3px 0 0 10px;\n  cursor: n-resize;\n}\n\n#bottom-menu-tabs a {\n  pointer-events: auto;\n}\n\n#bottom-menu {\n  pointer-events: auto;\n  background: rgba(0, 0, 0, 0.8);\n  color: #fff;\n  max-height: unset;\n}\n\n#bottom-menu.collapse:not(.in) {\n  display: none !important;\n}\n\n#bottom-menu-tabs>li>a {\n  background: rgba(150, 150, 150, 0.5);\n  color: #000;\n  border: solid 1px #ccc;\n  filter: brightness(0.75);\n}\n\n#bottom-menu-tabs>li>a:hover {\n  background: rgba(150, 150, 150, 0.5);\n  border: solid 1px #ccc;\n  color: #111;\n  filter: brightness(0.9);\n}\n\n#bottom-menu-tabs>li.active>a {\n  background: #eee;\n  border: solid 1px #ccc;\n  color: #333;\n  filter: none;\n}\n\n.bottom-menu-btn-close {\n  font-size: 8pt;\n  vertical-align: baseline;\n  padding: 0 0 0 6px;\n  margin-right: -6px;\n}\n\n#bottom-menu-contents {\n  padding: 5px 15px;\n  max-height: 50vh;\n  overflow-y: auto;\n}\n\n#bottom-menu-contents .panel {\n  color: #333;\n}\n</style>";

	async function init() {
		const site$1 = await site;
		const style = html2element<HTMLElement>(hStyle$1);
		const bottomMenu = html2element<HTMLElement>(hBottomMenu);
		unsafeWindow.document.head.appendChild(style);
		site$1.bottomMenuContainer.appendChild(bottomMenu);
		const bottomMenuKey = bottomMenu.querySelector<HTMLElement>("#bottom-menu-key");
		const bottomMenuTabs = bottomMenu.querySelector<HTMLElement>("#bottom-menu-tabs");
		const bottomMenuContents = bottomMenu.querySelector<HTMLElement>("#bottom-menu-contents");
		if (!bottomMenuKey || !bottomMenuTabs || !bottomMenuContents) {
			throw new Error("bottom menu elements were not found.");
		}
		// メニューのリサイズ
		{
			let resizeStart: { y: number; height: number } | null = null;
			const onStart = (event: MouseEvent): void => {
				const target = event.target as HTMLElement;
				const pageY = event.pageY;
				if (target.id !== "bottom-menu-tabs")
					return;
				resizeStart = {y: pageY, height: bottomMenuContents.getBoundingClientRect().height};
			};
			const onMove = (event: MouseEvent): void => {
				if (!resizeStart)
					return;
				event.preventDefault();
				bottomMenuContents.style.height = `${resizeStart.height - (event.pageY - resizeStart.y)}px`;
			};
			const onEnd = (): void => {
				resizeStart = null;
			};
			bottomMenuTabs.addEventListener("mousedown", onStart);
			bottomMenuTabs.addEventListener("mousemove", onMove);
			bottomMenuTabs.addEventListener("mouseup", onEnd);
			bottomMenuTabs.addEventListener("mouseleave", onEnd);
		}
		let tabs = new Set<HTMLAnchorElement>();
		let selectedTab: string | null = null;
		/** 下メニューの操作
		 * 下メニューはいくつかのタブからなる。タブはそれぞれ tabId, ラベル, 中身を持っている。
		 */
		const menuController = {
			/** タブを選択 */
			selectTab(tabId: string): void {
				const tab = site$1.jQuery(`#bottom-menu-tab-${tabId}`);
				if (tab && tab[0]) {
					tab.tab("show"); // Bootstrap 3
					selectedTab = tabId;
				}
			},
			/** 下メニューにタブを追加する */
			addTab(tabId: string, tabLabel: string, paneContent: Node, options: {
				active?: boolean;
				closeButton?: boolean
			} = {}) {
				log.debug(`addTab: ${tabLabel} (${tabId})`, paneContent);
				// タブを追加
				const tab = document.createElement("a");
				tab.textContent = tabLabel;
				tab.id = `bottom-menu-tab-${tabId}`;
				tab.href = "#";
				tab.dataset.id = tabId;
				tab.dataset.target = `#bottom-menu-pane-${tabId}`;
				tab.dataset.toggle = "tab";
				tab.addEventListener("click", event => {
					event.preventDefault();
					menuController.selectTab(tabId);
				});
				tabs.add(tab);
				const tabLi = document.createElement("li");
				tabLi.appendChild(tab);
				bottomMenuTabs.appendChild(tabLi);
				// 内容を追加
				const pane = document.createElement("div");
				pane.className = "tab-pane";
				pane.id = `bottom-menu-pane-${tabId}`;
				pane.appendChild(paneContent);
				bottomMenuContents.appendChild(pane);
				const controller = {
					get id() {
						return tabId;
					},
					close() {
						bottomMenuTabs.removeChild(tabLi);
						bottomMenuContents.removeChild(pane);
						tabs.delete(tab);
						if (selectedTab === tabId) {
							selectedTab = null;
							if (tabs.size > 0) {
								const nextTab = tabs.values().next().value;
								if (nextTab?.dataset.id) menuController.selectTab(nextTab.dataset.id);
							}
						}
					},
					show() {
						menuController.show();
						menuController.selectTab(tabId);
					},
					set color(color: string) {
						tab.style.backgroundColor = color;
					},
				};
				// 閉じるボタン
				if (options.closeButton) {
					const btn = document.createElement("a");
					btn.className = "bottom-menu-btn-close btn btn-link glyphicon glyphicon-remove";
					btn.addEventListener("click", () => {
						controller.close();
					});
					tab.appendChild(btn);
				}
				// 選択されているタブがなければ選択
				if (!selectedTab)
					menuController.selectTab(tabId);
				return controller;
			},
			/** 下メニューを表示する */
			show() {
				if (bottomMenuKey.classList.contains("collapsed"))
					bottomMenuKey.click();
			},
			/** 下メニューの表示/非表示を切り替える */
			toggle() {
				bottomMenuKey.click();
			},
		};
		log.debug("bottomMenu OK");
		return menuController;
	}

	const hRowTemplate = "<div class=\"atcoder-easy-test-cases-row alert alert-dismissible\">\n  <button type=\"button\" class=\"close\" data-dismiss=\"alert\" aria-label=\"close\">\n    <span aria-hidden=\"true\">×</span>\n  </button>\n  <div class=\"progress\">\n    <div class=\"progress-bar\" style=\"width: 0;\">0 / 0</div>\n  </div>\n  <div class=\"atcoder-easy-test-cases-row-date\" style=\"font-family: monospace; text-align: right; position: absolute; right: 1em;\"></div>\n</div>";

	class ResultRow {
		_tabs: Array<Promise<{ close(): void }>>;
		_element: HTMLElement;
		_promise: Promise<void[]>;

		constructor(pairs: ResultPair[]) {
			this._tabs = pairs.map(([_pResult, tab]: ResultPair) => tab);
			this._element = html2element<HTMLElement>(hRowTemplate);
			this._element.querySelector(".close")?.addEventListener("click", () => this.remove());
			{
				const date = new Date();
				const h = date.getHours().toString().padStart(2, "0");
				const m = date.getMinutes().toString().padStart(2, "0");
				const s = date.getSeconds().toString().padStart(2, "0");
				this._element.querySelector(".atcoder-easy-test-cases-row-date")!.textContent = `${h}:${m}:${s}`;
			}
			const numCases = pairs.length;
			let numFinished = 0;
			let numAccepted = 0;
			const progressBar = this._element.querySelector<HTMLElement>(".progress-bar");
			if (!progressBar) throw new Error("Progress bar was not found.");
			progressBar.textContent = `${numFinished} / ${numCases}`;
			this._promise = Promise.all(pairs.map(async ([pResult, tab]: ResultPair) => {
				const button = html2element<HTMLElement>(`<div class="label label-default" style="margin: 3px; cursor: pointer;">WJ</div>`);
				button.addEventListener("click", async () => {
					(await tab).show();
				});
				this._element.appendChild(button);
				try {
					const result_1 = await pResult;
					button.textContent = result_1.status;
					if (result_1.status === "AC") {
						button.classList.add("label-success");
					} else if (result_1.status !== "OK") {
						button.classList.add("label-warning");
					}
					numFinished++;
					if (result_1.status === "AC")
						numAccepted++;
					progressBar.textContent = `${numFinished} / ${numCases}`;
					progressBar.style.width = `${100 * numFinished / numCases}%`;
					if (numFinished === numCases) {
						if (numAccepted === numCases)
							this._element.classList.add("alert-success");

						else
							this._element.classList.add("alert-warning");
					}
				} catch (reason) {
					button.textContent = "IE";
					button.classList.add("label-danger");
					console.error(reason);
				}
			}));
		}

		get element(): HTMLElement {
			return this._element;
		}

		onFinish(listener: () => void): void {
			this._promise.then(listener);
		}

		remove(): void {
			for (const pTab of this._tabs)
				pTab.then((tab: { close(): void }) => tab.close());
			const parent = this._element.parentElement;
			if (parent)
				parent.removeChild(this._element);
		}
	}

	const hResultList = "<div class=\"row\"></div>";

	const eResultList = html2element(hResultList);
	site.then(site => site.resultListContainer.appendChild(eResultList));
	const resultList = {
		addResult(pairs: ResultPair[]): ResultRow {
			const result = new ResultRow(pairs);
			eResultList.insertBefore(result.element, eResultList.firstChild);
			return result;
		},
	};

	const hTabTemplate = "<div class=\"atcoder-easy-test-result container\">\n  <div class=\"row\">\n    <div class=\"atcoder-easy-test-result-col-input col-xs-12\" data-if-expected-output=\"col-sm-6 col-sm-push-6\">\n      <div class=\"form-group\">\n        <label class=\"control-label col-xs-12\">\n          Standard Input\n          <div class=\"col-xs-12\">\n            <textarea class=\"atcoder-easy-test-result-input form-control\" rows=\"3\" readonly=\"readonly\"></textarea>\n          </div>\n        </label>\n      </div>\n    </div>\n    <div class=\"atcoder-easy-test-result-col-expected-output col-xs-12 col-sm-6 hidden\" data-if-expected-output=\"!hidden col-sm-pull-6\">\n      <div class=\"form-group\">\n        <label class=\"control-label col-xs-12\">\n          Expected Output\n          <div class=\"col-xs-12\">\n            <textarea class=\"atcoder-easy-test-result-expected-output form-control\" rows=\"3\" readonly=\"readonly\"></textarea>\n          </div>\n        </label>\n      </div>\n    </div>\n  </div>\n  <div class=\"row\"><div class=\"col-sm-6 col-sm-offset-3\">\n    <div class=\"panel panel-default\">\n      <table class=\"table table-condensed\">\n        <tbody>\n          <tr>\n            <th class=\"text-center\">Exit Code</th>\n            <th class=\"text-center\">Exec Time</th>\n            <th class=\"text-center\">Memory</th>\n          </tr>\n          <tr>\n            <td class=\"atcoder-easy-test-result-exit-code text-center\"></td>\n            <td class=\"atcoder-easy-test-result-exec-time text-center\"></td>\n            <td class=\"atcoder-easy-test-result-memory text-center\"></td>\n          </tr>\n        </tbody>\n      </table>\n    </div>\n  </div></div>\n  <div class=\"row\">\n    <div class=\"atcoder-easy-test-result-col-output col-xs-12\" data-if-error=\"col-md-6\">\n      <div class=\"form-group\">\n        <label class=\"control-label col-xs-12\">\n          Standard Output\n          <div class=\"col-xs-12\">\n            <textarea class=\"atcoder-easy-test-result-output form-control\" rows=\"5\" readonly=\"readonly\"></textarea>\n          </div>\n        </label>\n      </div>\n    </div>\n    <div class=\"atcoder-easy-test-result-col-error col-xs-12 col-md-6 hidden\" data-if-error=\"!hidden\">\n      <div class=\"form-group\">\n        <label class=\"control-label col-xs-12\">\n          Standard Error\n          <div class=\"col-xs-12\">\n            <textarea class=\"atcoder-easy-test-result-error form-control\" rows=\"5\" readonly=\"readonly\"></textarea>\n          </div>\n        </label>\n      </div>\n    </div>\n  </div>\n</div>";

	function setClassFromData(element: HTMLElement, name: string): void {
		const classes = (element.dataset[name] ?? "").split(/\s+/);
		for (let className of classes) {
			let flag = true;
			if (className[0] === "!") {
				className = className.slice(1);
				flag = false;
			}
			element.classList.toggle(className, flag);
		}
	}

	class ResultTabContent {
		_title = "";
		_uid: string;
		_element: HTMLElement;
		_result: RunnerResult | null;

		constructor() {
			this._uid = Date.now().toString(16) + Math.floor(Math.random() * 256).toString(16);
			this._result = null;
			this._element = html2element(hTabTemplate);
			this._element.id = `atcoder-easy-test-result-${this._uid}`;
		}

		set result(result: RunnerResult) {
			this._result = result;
			if (result.status === "AC") {
				this.outputStyle.backgroundColor = "#dff0d8";
			} else if (result.status !== "OK") {
				this.outputStyle.backgroundColor = "#fcf8e3";
			}
			this.input = result.input;
			if ("expectedOutput" in result)
				this.expectedOutput = result.expectedOutput;
			this.exitCode = result.exitCode;
			if ("execTime" in result)
				this.execTime = `${result.execTime} ms`;
			if ("memory" in result)
				this.memory = `${result.memory} KB`;
			if ("output" in result)
				this.output = result.output;
			if (result.error)
				this.error = result.error;
		}

		get result(): RunnerResult | null {
			return this._result;
		}

		get uid(): string {
			return this._uid;
		}

		get element(): HTMLElement {
			return this._element;
		}

		set title(title: string) {
			this._title = title;
		}

		get title(): string {
			return this._title;
		}

		set input(input: string) {
			(this._get("input") as HTMLTextAreaElement).value = input;
		}

		get inputStyle(): CSSStyleDeclaration {
			return this._get("input").style;
		}

		set expectedOutput(output: string | undefined) {
			(this._get("expected-output") as HTMLTextAreaElement).value = output ?? "";
			setClassFromData(this._get("col-input"), "ifExpectedOutput");
			setClassFromData(this._get("col-expected-output"), "ifExpectedOutput");
		}

		get expectedOutputStyle(): CSSStyleDeclaration {
			return this._get("expected-output").style;
		}

		set output(output: string | undefined) {
			(this._get("output") as HTMLTextAreaElement).value = output ?? "";
		}

		get outputStyle(): CSSStyleDeclaration {
			return this._get("output").style;
		}

		set error(error: string) {
			(this._get("error") as HTMLTextAreaElement).value = error;
			setClassFromData(this._get("col-output"), "ifError");
			setClassFromData(this._get("col-error"), "ifError");
		}

		set exitCode(code: string | number | undefined) {
			const element = this._get("exit-code");
			element.textContent = String(code ?? "");
			const isSuccess = code === "0";
			element.classList.toggle("bg-success", isSuccess);
			element.classList.toggle("bg-danger", !isSuccess);
		}

		set execTime(time: string) {
			this._get("exec-time").textContent = time;
		}

		set memory(memory: string) {
			this._get("memory").textContent = memory;
		}

		_get(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLElement {
			const element = this._element.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLElement>(`.atcoder-easy-test-result-${name}`);
			if (!element) throw new Error(`Result tab element not found: ${name}`);
			return element;
		}
	}

	const hRoot = "<form id=\"atcoder-easy-test-container\" class=\"form-horizontal\">\n  <div class=\"row\">\n      <div class=\"col-xs-12 col-lg-8\">\n          <div class=\"form-group\">\n              <label class=\"control-label col-sm-2\">Test Environment</label>\n              <div class=\"col-sm-10\">\n                  <select class=\"form-control\" id=\"atcoder-easy-test-language\" style=\"width: 100% !important\"></select>\n              </div>\n          </div>\n          <div class=\"form-group\">\n              <label class=\"control-label col-sm-2\" for=\"atcoder-easy-test-input\">Standard Input</label>\n              <div class=\"col-sm-10\">\n                  <textarea id=\"atcoder-easy-test-input\" name=\"input\" class=\"form-control\" rows=\"3\"></textarea>\n              </div>\n          </div>\n      </div>\n      <div class=\"col-xs-12 col-lg-4\">\n          <details close>\n              <summary>Expected Output</summary>\n              <div class=\"form-group\">\n                  <label class=\"control-label col-sm-2\" for=\"atcoder-easy-test-allowable-error-check\">Allowable Error</label>\n                  <div class=\"col-sm-10\">\n                      <div class=\"input-group\">\n                          <span class=\"input-group-addon\">\n                              <input id=\"atcoder-easy-test-allowable-error-check\" type=\"checkbox\" checked=\"checked\">\n                          </span>\n                          <input id=\"atcoder-easy-test-allowable-error\" type=\"text\" class=\"form-control\" value=\"1e-6\">\n                      </div>\n                  </div>\n              </div>\n              <div class=\"form-group\">\n                  <label class=\"control-label col-sm-2\" for=\"atcoder-easy-test-output\">Expected Output</label>\n                  <div class=\"col-sm-10\">\n                      <textarea id=\"atcoder-easy-test-output\" name=\"output\" class=\"form-control\" rows=\"3\"></textarea>\n                  </div>\n              </div>\n          </details>\n      </div>\n      <div class=\"col-xs-12 col-md-6\">\n          <div class=\"col-xs-11 col-xs-offset=1\">\n              <div class=\"form-group\">\n                  <a id=\"atcoder-easy-test-run\" class=\"btn btn-primary\">Run</a>\n              </div>\n          </div>\n      </div>\n      <div class=\"col-xs-12 col-md-6\">\n          <div class=\"col-xs-11 col-xs-offset=1\">\n              <div class=\"form-group text-right\">\n                  <a id=\"atcoder-easy-test-setting\" class=\"btn btn-xs btn-default\">Setting</a>\n              </div>\n          </div>\n      </div>\n  </div>\n  <style>\n  #atcoder-easy-test-language {\n      border: none;\n      background: transparent;\n      font: inherit;\n      color: #fff;\n  }\n  #atcoder-easy-test-language option {\n      border: none;\n      color: #333;\n      font: inherit;\n  }\n  </style>\n</form>";

	const hStyle = "<style>\n.atcoder-easy-test-result textarea {\n  font-family: monospace;\n  font-weight: normal;\n}\n</style>";

	const hRunButton = "<button type=\"button\" class=\"btn btn-primary btn-sm atcoder-easy-test-btn-run-case\" style=\"vertical-align: top; margin-left: 0.5em\">Run</button>";

	const hTestAndSubmit = "<button type=\"button\" id=\"atcoder-easy-test-btn-test-and-submit\" class=\"btn btn-info btn\" style=\"margin-left: 1rem\" title=\"Ctrl+Enter\" data-toggle=\"tooltip\">Test &amp; Submit</button>";

	const hTestAllSamples = "<button type=\"button\" id=\"atcoder-easy-test-btn-test-all\" class=\"btn btn-default btn-sm\" style=\"margin-left: 1rem\" title=\"Alt+Enter\" data-toggle=\"tooltip\">Test All Samples</button>";

	(async () => {
		const site$1 = await site;
		const doc = unsafeWindow.document as Document;
		// init bottomMenu
		const pBottomMenu = init();
		pBottomMenu.then(bottomMenu => {
			unsafeWindow.bottomMenu = bottomMenu;
		});
		await doneOrFail(pBottomMenu);
		// external interfaces
		unsafeWindow.codeRunner = codeRunner;
		doc.head.appendChild(html2element(hStyle));
		// interface
		const atCoderEasyTest = {
			site: site$1,
			config,
			codeSaver,
			enableButtons() {
				events.trig("enable");
			},
			disableButtons() {
				events.trig("disable");
			},
			runCount: 0,
			runTest(title: string, language: string, sourceCode: string, input: string, output: string | null = null, options: RunnerOptions = {
				trim: true,
				split: true,
			}) {
				this.disableButtons();
				const content = new ResultTabContent();
				const pTab = pBottomMenu.then(bottomMenu => bottomMenu.addTab("easy-test-result-" + content.uid, `#${++this.runCount} ${title}`, content.element, {
					active: true,
					closeButton: true
				}));
				const pResult = codeRunner.run(language, sourceCode, input, output, options);
				pResult.then(result => {
					if (!result) return;
					content.result = result;
					if (result.status === "AC") {
						pTab.then(tab => tab.color = "#dff0d8");
					} else if (result.status !== "OK") {
						pTab.then(tab => tab.color = "#fcf8e3");
					}
				}).finally(() => {
					this.enableButtons();
				});
				return [pResult, pTab];
			}
		};
		unsafeWindow.atCoderEasyTest = atCoderEasyTest;
		// place "Easy Test" tab
		{
			// declare const hRoot: string;
			const root = html2element<HTMLFormElement>(hRoot);
			const E = <T extends HTMLElement>(id: string): T => {
				const element = root.querySelector<T>(`#atcoder-easy-test-${id}`);
				if (!element) throw new Error(`AtCoder Easy Test element not found: ${id}`);
				return element;
			};
			const eLanguage = E<HTMLSelectElement>("language");
			const eInput = E<HTMLTextAreaElement>("input");
			const eAllowableErrorCheck = E<HTMLInputElement>("allowable-error-check");
			const eAllowableError = E<HTMLInputElement>("allowable-error");
			const eOutput = E<HTMLTextAreaElement>("output");
			const eRun = E<HTMLAnchorElement>("run");
			const eSetting = E<HTMLAnchorElement>("setting");
			events.on("enable", () => {
				eRun.classList.remove("disabled");
			});
			events.on("disable", () => {
				eRun.classList.add("disabled");
			});
			eSetting.addEventListener("click", () => {
				settings.open();
			});
			// 言語選択関係
			let latestSetLanguageToken = 0;

			async function onEnvChange() {
				const langSelection = config.get("langSelection", {}) as Record<string, string>;
				langSelection[site$1.language.value] = eLanguage.value;
				config.set("langSelection", langSelection);
				config.save();
			}

			if (unsafeWindow.jQuery?.fn?.select2) {
				unsafeWindow["jQuery"](eLanguage).on("change", onEnvChange);
			} else {
				eLanguage.addEventListener("change", onEnvChange);
			}

			async function setLanguage(refreshLocalRunner = true) {
				const currentToken = ++latestSetLanguageToken;
				const languageId = site$1.language.value;
				try {
					if (!languageId) throw new Error("AtCoder Easy Test: language not set");
					const langs = await codeRunner.getEnvironment(languageId, {refreshLocalRunner});
					if (currentToken !== latestSetLanguageToken) return;
					log.debug("getEnvironment:", languageId, `(${langs.length} candidates)`);
					const previousValue = eLanguage.value;
					const nextSignature = langs.map(([runnerId, label]) => `${runnerId}\u0000${label}`).join("\u0001");
					if (eLanguage.dataset.envSignature !== nextSignature) {
						while (eLanguage.firstChild)
							eLanguage.removeChild(eLanguage.firstChild);
						const fragment = document.createDocumentFragment();
						for (const [runnerId, label] of langs) {
							const option = document.createElement("option");
							option.value = runnerId;
							option.textContent = label ?? "";
							fragment.appendChild(option);
						}
						eLanguage.appendChild(fragment);
						eLanguage.dataset.envSignature = nextSignature;
					}
					let nextValue = previousValue;
					const langSelection = config.get("langSelection", {}) as Record<string, string>;
					if (!langs.some(([runnerId, _]) => runnerId === nextValue)) {
						nextValue = "";
					}
					// LocalRunnerが存在する場合は優先選択する
					const localEntry = langs.find(([_, label]) => (label ?? "").includes("[Local]"));
					if (localEntry) {
						nextValue = localEntry[0];
						log.debug("[LocalRunner] Auto-selected in setLanguage:", nextValue);
					} else if (!nextValue && languageId in langSelection) {
						const prev = langSelection[languageId];
						if (langs.some(([runnerId, _]) => runnerId === prev)) {
							nextValue = prev;
						}
					}
					if (!nextValue && langs.length > 0) {
						nextValue = langs[0][0];
					}
					if (nextValue && eLanguage.value !== nextValue) {
						if (unsafeWindow.jQuery?.fn?.select2) {
							unsafeWindow["jQuery"](eLanguage).val(nextValue).trigger("change");
						} else {
							eLanguage.value = nextValue;
							eLanguage.dispatchEvent(new Event("change"));
						}
					}
					events.trig("enable");
				} catch (error) {
					if (currentToken !== latestSetLanguageToken) return;
					log.debug("getEnvironment failed:", languageId);
					log.error(error);
					eLanguage.dataset.envSignature = "";
					while (eLanguage.firstChild)
						eLanguage.removeChild(eLanguage.firstChild);
					const option = document.createElement("option");
					option.className = "fg-danger";
					option.textContent = String(error);
					eLanguage.appendChild(option);
					events.trig("disable");
				}
			}

			site$1.language.addListener(() => setLanguage());

			eAllowableError.disabled = !eAllowableErrorCheck.checked;
			eAllowableErrorCheck.addEventListener("change", () => {
				eAllowableError.disabled = !eAllowableErrorCheck.checked;
			});

			// テスト実行
			function runTest(title: string, input: string, output: string | null = null, options: RunnerOptions = {}): ResultPair {
				const opts: RunnerOptions = Object.assign({trim: true, split: true,}, options);
				if (eAllowableErrorCheck.checked) {
					opts.allowableError = parseFloat(eAllowableError.value);
				}
				return atCoderEasyTest.runTest(title, eLanguage.value, site$1.sourceCode, input, output, opts) as ResultPair;
			}

			function runAllCases(testcases: TestCase[]): Promise<RunnerResult[]> {
				const runGroupId = uuid();
				const pairs: ResultPair[] = testcases.map((testcase: TestCase) => runTest(testcase.title, testcase.input, testcase.output, {runGroupId}));
				resultList.addResult(pairs);
				return Promise.all(pairs.map(([pResult, _pTab]: ResultPair) => pResult.then((result: RunnerResult) => {
					if (result.status === "AC") return Promise.resolve(result);
					else return Promise.reject(result);
				})));
			}

			eRun.addEventListener("click", async (_event: MouseEvent) => {
				await setLanguage();
				const title = "Run";
				const input = eInput.value;
				const output = eOutput.value;
				runTest(title, input, output || null);
			});
			await doneOrFail(pBottomMenu.then(bottomMenu => bottomMenu.addTab("easy-test", "Easy Test", root)));
			// place "Run" button on each sample
			for (const testCase of site$1.testCases) {
				const eRunButton = html2element(hRunButton);
				eRunButton.addEventListener("click", async () => {
					await setLanguage();
					const [pResult, pTab] = runTest(testCase.title, testCase.input, testCase.output) as ResultPair;
					await pResult;
					(await pTab).show();
				});
				testCase.anchor.insertAdjacentElement("afterend", eRunButton);
				events.on("disable", () => {
					eRunButton.classList.add("disabled");
				});
				events.on("enable", () => {
					eRunButton.classList.remove("disabled");
				});
			}
			// place "Test & Submit" button
			{
				const button = html2element(hTestAndSubmit);
				site$1.testButtonContainer.appendChild(button);
				const testAndSubmit = async () => {
					await setLanguage();
					await runAllCases(site$1.testCases);
					site$1.submit();
				};
				button.addEventListener("click", testAndSubmit);
				events.on("testAndSubmit", testAndSubmit);
				events.on("disable", () => button.classList.add("disabled"));
				events.on("enable", () => button.classList.remove("disabled"));
			}
			// place "Test All Samples" button
			{
				const button = html2element(hTestAllSamples);
				site$1.testButtonContainer.appendChild(button);
				const testAllSamples = async () => {
					await setLanguage();
					await runAllCases(site$1.testCases);
				};
				button.addEventListener("click", testAllSamples);
				events.on("testAllSamples", testAllSamples);
				events.on("disable", () => button.classList.add("disabled"));
				events.on("enable", () => button.classList.remove("disabled"));
			}
		}
		// place "Restore Last Play" button
		try {
			const restoreButton = doc.createElement("a");
			restoreButton.className = "btn btn-danger btn-sm";
			restoreButton.textContent = "Restore Last Play";
			restoreButton.addEventListener("click", async () => {
				try {
					const lastCode = await codeSaver.restore(site$1.taskURI);
					if (site$1.sourceCode.length === 0 || confirm("Your current code will be replaced. Are you sure?")) {
						site$1.sourceCode = lastCode;
					}
				} catch (reason) {
					alert(reason);
				}
			});
			site$1.sideButtonContainer.appendChild(restoreButton);
		} catch (e) {
			console.error(e);
		}
		// キーボードショートカット
		config.registerFlag("ui.useKeyboardShortcut", true, "Use Keyboard Shortcuts");
		unsafeWindow.addEventListener("keydown", (event: KeyboardEvent) => {
			if (config.get("ui.useKeyboardShortcut", true)) {
				if (event.key === "Enter" && event.ctrlKey) {
					events.trig("testAndSubmit");
				} else if (event.key === "Enter" && event.altKey) {
					events.trig("testAllSamples");
				} else if (event.key === "Escape" && event.altKey) {
					pBottomMenu.then(bottomMenu => bottomMenu.toggle());
				}
			}
		});
	})();
})();
