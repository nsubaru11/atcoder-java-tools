// ==UserScript==
// @name        AtCoder Easy Test for Java
// @namespace   https://github.com/nsubaru11/AtCoder/tools/userscripts
// @version     1.6.0
// @description Make testing sample cases easy (Modified by nsubaru11)
// @author      magurofly (original), nsubaru11 (modified)
// @license     MIT
// @homepageURL https://github.com/nsubaru11/AtCoder/tree/main/tools/userscripts/AtCoderEasyTestForJava
// @supportURL  https://github.com/nsubaru11/AtCoder/issues
// @match       https://atcoder.jp/contests/*/tasks/*
// @match       https://atcoder.jp/contests/*/submit*
// @match       https://yukicoder.me/problems/no/*
// @match       https://yukicoder.me/problems/*
// @match       http://codeforces.com/contest/*/problem/*
// @match       http://codeforces.com/gym/*/problem/*
// @match       http://codeforces.com/problemset/problem/*
// @match       http://codeforces.com/group/*/contest/*/problem/*
// @match       http://*.contest.codeforces.com/group/*/contest/*/problem/*
// @match       https://codeforces.com/contest/*/problem/*
// @match       https://codeforces.com/gym/*/problem/*
// @match       https://codeforces.com/problemset/problem/*
// @match       https://codeforces.com/group/*/contest/*/problem/*
// @match       https://*.contest.codeforces.com/group/*/contest/*/problem/*
// @match       https://m1.codeforces.com/contest/*/problem/*
// @match       https://m2.codeforces.com/contest/*/problem/*
// @match       https://m3.codeforces.com/contest/*/problem/*
// @match       https://greasyfork.org/*/scripts/433152-atcoder-easy-test-v2
// @grant       unsafeWindow
// @grant       GM_getValue
// @grant       GM_setValue
// @run-at      document-end
// @updateURL   https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderEasyTestForJava/dist/AtCoderEasyTestForJava.user.js
// @downloadURL https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderEasyTestForJava/dist/AtCoderEasyTestForJava.user.js
// ==/UserScript==

(() => {
	// ../shared/src/async.ts
	function sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
	// ../shared/src/query.ts
	function buildQueryString(data) {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(data)) {
			if (value == null) continue;
			params.set(key, String(value));
		}
		return params.toString();
	}
	// ../shared/src/easy-test-judge.ts
	var FLOAT_PATTERN = /^[-+]?[0-9]*\.[0-9]+([eE][-+]?[0-9]+)?$/;
	function evaluateEasyTestOutput(runResult, expectedOutput, options = { trim: true, split: true }) {
		const status = runResult.status;
		if (status !== "OK" || typeof expectedOutput !== "string") {
			return { status, output: runResult.output || "", expectedOutput };
		}
		let output = runResult.output || "";
		let expected = expectedOutput;
		if (options.trim) {
			expected = expected.trim();
			output = output.trim();
		}
		let equals = (x, y) => x === y;
		const allowableError = options.allowableError;
		if (allowableError) {
			const superEquals = equals;
			equals = (x, y) => {
				if (FLOAT_PATTERN.test(x) || FLOAT_PATTERN.test(y)) {
					const a = Number.parseFloat(x);
					const b = Number.parseFloat(y);
					return Math.abs(a - b) <= Math.max(allowableError, Math.abs(b) * allowableError);
				}
				return superEquals(x, y);
			};
		}
		if (options.split) {
			const superEquals = equals;
			equals = (x, y) => {
				const xs = x.split(/\s+/);
				const ys = y.split(/\s+/);
				if (xs.length !== ys.length) return false;
				for (let i = 0; i < xs.length; i++) {
					if (!superEquals(xs[i], ys[i])) return false;
				}
				return true;
			};
		}
		const judgedStatus = equals(output, expected) ? "AC" : "WA";
		return { status: judgedStatus, output, expectedOutput: expected };
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
	// ../shared/src/local-runner.ts
	function isHttpUrl(value) {
		return /^https?:\/\//.test(value);
	}
	function buildLocalRunnerKey(info) {
		return `${info.language} ${info.compilerName} ${info.label}`;
	}
	function buildLocalRunnerListRequest() {
		return { mode: "list" };
	}
	function buildLocalRunnerPrecompileRequest(sourceCode) {
		return {
			mode: "precompile",
			sourceCode,
		};
	}
	function buildLocalRunnerRunRequest(sourceCode, stdin, compilerName) {
		return {
			mode: "run",
			compilerName,
			sourceCode,
			stdin,
		};
	}
	function toEasyTestStatus(status, exitCode = 0) {
		switch (status) {
			case "success":
				return exitCode === 0 ? "OK" : "RE";
			case "runtimeError":
				return "RE";
			case "timeLimitExceeded":
				return "TLE";
			case "compileError":
				return "CE";
			case "internalError":
			case "badRequest":
			default:
				return "IE";
		}
	}
	// AtCoderEasyTestForJava/src/main.ts
	(function () {
		const STORAGE_KEY = "AtCoderEasyTest";
		if (typeof GM_getValue !== "function" || typeof GM_setValue !== "function") {
			const hasAsyncGM =
				typeof GM === "object" && typeof GM.getValue === "function" && typeof GM.setValue === "function";
			let storage = safeJsonParse(localStorage[STORAGE_KEY] || "{}", {});
			if (!storage || typeof storage !== "object") storage = {};
			const persist = () => {
				try {
					localStorage[STORAGE_KEY] = JSON.stringify(storage);
				} catch (_e) {}
			};
			GM_getValue = (key, defaultValue = null) => (key in storage ? storage[key] : defaultValue);
			GM_setValue = (key, value) => {
				storage[key] = value;
				persist();
				if (hasAsyncGM) Promise.resolve(GM.setValue(key, value)).catch(() => {});
			};
			if (hasAsyncGM && !("config" in storage)) {
				Promise.resolve(GM.getValue("config"))
					.then((value) => {
						if (typeof value === "string" && value.length) {
							storage.config = value;
							persist();
						}
					})
					.catch(() => {});
			}
		}
		if (typeof unsafeWindow !== "object") unsafeWindow = window;
		function doneOrFail(p) {
			return p.then(
				() => Promise.resolve(),
				() => Promise.resolve(),
			);
		}
		function html2element(html) {
			const template = document.createElement("template");
			template.innerHTML = html;
			const element = template.content.firstElementChild;
			if (!element) throw new Error("html2element: empty HTML");
			return element;
		}
		function newElement(tagName, attrs = {}, children = []) {
			const e = document.createElement(tagName);
			const { style, ...rest } = attrs;
			Object.assign(e, rest);
			if (style && typeof style === "object") Object.assign(e.style, style);
			for (const child of children) {
				e.appendChild(child);
			}
			return e;
		}
		function uuid() {
			const hex = "0123456789abcdef";
			const yChars = "89ab";
			return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) =>
				c === "x" ? hex[(Math.random() * 16) | 0] : yChars[(Math.random() * 4) | 0],
			);
		}
		async function loadScript(src, ctx = null, env = {}) {
			const js = await fetch(src).then((res) => res.text());
			const keys = [];
			const values = [];
			for (const [key, value] of Object.entries(env)) {
				keys.push(key);
				values.push(value);
			}
			globalThis.Function(keys.join(), js).apply(ctx, values);
		}
		const eventListeners = new Map();
		const events = {
			on(name, listener) {
				if (!eventListeners.has(name)) eventListeners.set(name, []);
				eventListeners.get(name)?.push(listener);
			},
			off(name, listener) {
				const listeners = eventListeners.get(name);
				if (listeners) {
					const idx = listeners.indexOf(listener);
					if (idx !== -1) listeners.splice(idx, 1);
				}
			},
			trig(name) {
				const listeners = eventListeners.get(name);
				if (listeners) {
					for (const listener of listeners) listener();
				}
			},
		};

		class ObservableValue {
			_value;
			_listeners;
			constructor(value) {
				this._value = value;
				this._listeners = new Set();
			}
			get value() {
				return this._value;
			}
			set value(value) {
				this._value = value;
				for (const listener of this._listeners) listener(value);
			}
			addListener(listener) {
				this._listeners.add(listener);
				listener(this._value);
			}
			removeListener(listener) {
				this._listeners.delete(listener);
			}
			map(f) {
				const y = new ObservableValue(f(this.value));
				this.addListener((x) => {
					y.value = f(x);
				});
				return y;
			}
		}
		const hPage = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>AtCoder Easy Test</title>
    <link href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.1/css/bootstrap.min.css" rel="stylesheet">
  </head>
  <body>
    <div class="container" id="root">
    </div>
    <script src="https://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js"></script>
    <script src="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.1/js/bootstrap.min.js"></script>
  </body>
</html>`;
		const components = [];
		const settings = {
			add(title, generator) {
				components.push({ title, generator });
			},
			open() {
				const win = window.open("about:blank");
				if (!win) throw new Error("Failed to open settings window.");
				const doc = win.document;
				doc.open();
				doc.write(hPage);
				doc.close();
				const root = doc.getElementById("root");
				if (!root) throw new Error("Settings root element was not found.");
				for (const { title, generator } of components) {
					const panel = newElement("div", { className: "panel panel-default" }, [
						newElement("div", { className: "panel-heading", textContent: title }),
						newElement("div", { className: "panel-body" }, [generator(win)]),
					]);
					root.appendChild(panel);
				}
			},
		};
		const options = [];
		let data = {};
		function toString() {
			return JSON.stringify(data);
		}
		function save() {
			try {
				GM_setValue("config", toString());
			} catch (_e) {}
		}
		function load() {
			const raw = GM_getValue("config");
			if (raw && typeof raw === "object") {
				data = raw;
				return;
			}
			const parsed = safeJsonParse(typeof raw === "string" ? raw : null, {});
			data = parsed && typeof parsed === "object" ? parsed : {};
		}
		function reset() {
			data = {};
			save();
		}
		load();
		settings.add("config", (win) => {
			const root = newElement("form", { className: "form-horizontal" });
			options.sort((a, b) => {
				const x = a.key.split(".");
				const y = b.key.split(".");
				return x < y ? -1 : x > y ? 1 : 0;
			});
			for (const { type, key, defaultValue, description } of options) {
				const id = uuid();
				const control = newElement("div", { className: "col-sm-3 text-center" });
				const group = newElement("div", { className: "form-group" }, [
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
						control.appendChild(
							newElement("input", {
								id,
								type: "checkbox",
								checked: config.get(key, Boolean(defaultValue)),
								onchange(event) {
									config.set(key, event.currentTarget.checked);
								},
							}),
						);
						break;
					}
					case "count": {
						control.appendChild(
							newElement("input", {
								id,
								type: "number",
								min: "0",
								value: String(config.get(key, Number(defaultValue))),
								onchange(event) {
									config.set(key, +event.currentTarget.value);
								},
							}),
						);
						break;
					}
					case "text": {
						control.appendChild(
							newElement("input", {
								id,
								type: "text",
								value: config.getString(key, String(defaultValue)),
								onchange(event) {
									config.setString(key, event.currentTarget.value);
								},
							}),
						);
						break;
					}
					default:
						throw new TypeError(`AtCoderEasyTest.setting: undefined option type ${type} for ${key}`);
				}
			}
			root.appendChild(
				newElement("button", {
					className: "btn btn-danger",
					textContent: "Reset",
					type: "button",
					onclick() {
						if (win.confirm("Configuration data will be cleared. Are you sure?")) {
							config.reset();
						}
					},
				}),
			);
			return root;
		});
		const config = {
			peekString(key, defaultValue = "") {
				if (!(key in data)) return defaultValue;
				const v = data[key];
				return typeof v === "string" ? v : String(v ?? "");
			},
			peek(key, defaultValue) {
				if (!(key in data)) return defaultValue;
				try {
					return JSON.parse(data[key]);
				} catch (_e) {
					return defaultValue;
				}
			},
			getString(key, defaultValue = "") {
				if (!(key in data)) {
					config.setString(key, defaultValue);
					return defaultValue;
				}
				return typeof data[key] === "string" ? data[key] : String(data[key] ?? "");
			},
			setString(key, value) {
				data[key] = value;
				save();
			},
			has(key) {
				return key in data;
			},
			get(key, defaultValue) {
				if (!(key in data)) {
					config.set(key, defaultValue);
					return defaultValue;
				}
				try {
					return JSON.parse(data[key]);
				} catch (_e) {
					config.set(key, defaultValue);
					return defaultValue;
				}
			},
			set(key, value) {
				const json2 = JSON.stringify(value);
				config.setString(key, json2 === undefined ? "null" : json2);
			},
			save,
			load,
			toString,
			reset,
			registerFlag(key, defaultValue, description) {
				options.push({
					type: "flag",
					key,
					defaultValue,
					description,
				});
			},
			registerCount(key, defaultValue, description) {
				options.push({
					type: "count",
					key,
					defaultValue,
					description,
				});
			},
			registerText(key, defaultValue, description) {
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
			const isDebug = () => config.peek("log.debug", false) === true;
			return {
				debug(...args) {
					if (isDebug()) console.debug(prefix, ...args);
				},
				info(...args) {
					if (isDebug()) console.info(prefix, ...args);
				},
				warn(...args) {
					console.warn(prefix, ...args);
				},
				error(...args) {
					console.error(prefix, ...args);
				},
			};
		})();
		config.registerCount("codeSaver.limit", 10, "Max number to save codes");
		const codeSaver = {
			get() {
				let json2 = unsafeWindow.localStorage.AtCoderEasyTest$lastCode;
				let data2 = [];
				try {
					if (typeof json2 === "string") {
						data2.push(...JSON.parse(json2));
					} else {
						data2 = [];
					}
				} catch (e) {
					data2.push({
						path:
							unsafeWindow.localStorage.AtCoderEasyTest$lastPage ||
							unsafeWindow.localStorage.AtCoderEasyTset$lastPage,
						code: json2,
					});
				}
				return data2;
			},
			set(data2) {
				unsafeWindow.localStorage.AtCoderEasyTest$lastCode = JSON.stringify(data2);
			},
			save(savePath, code) {
				const data2 = codeSaver.get();
				const idx = data2.findIndex(({ path }) => path === savePath);
				if (idx !== -1) data2.splice(idx, 1);
				data2.push({ path: savePath, code });
				while (data2.length > config.get("codeSaver.limit", 10)) data2.shift();
				codeSaver.set(data2);
			},
			restore(savedPath) {
				const data2 = codeSaver.get();
				const idx = data2.findIndex(({ path }) => path === savedPath);
				if (idx === -1 || !(data2[idx] instanceof Object))
					return Promise.reject(`No saved code found for ${location.pathname}`);
				return Promise.resolve(data2[idx].code);
			},
		};
		settings.add(`codeSaver (${location.host})`, (_win) => {
			const root = newElement("table", { className: "table" }, [
				newElement("thead", {}, [
					newElement("tr", {}, [
						newElement("th", { textContent: "path" }),
						newElement("th", { textContent: "code" }),
					]),
				]),
				newElement("tbody"),
			]);
			for (const savedCode of codeSaver.get()) {
				root.tBodies[0].appendChild(
					newElement("tr", {}, [
						newElement("td", { textContent: savedCode.path }),
						newElement("td", {}, [
							newElement("textarea", {
								rows: 1,
								cols: 30,
								textContent: savedCode.code,
							}),
						]),
					]),
				);
			}
			return root;
		});
		function similarLangs(targetLang, candidateLangs) {
			const [targetName, targetDetail = ""] = targetLang.split(" ", 2);
			const selectedLangs = [];
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
		function similarity(s, t) {
			const n = s.length,
				m = t.length;
			let dp = new Float64Array(m + 1);
			let dp2 = new Float64Array(m + 1);
			for (let i = 0; i < n; i++) {
				dp2.fill(0);
				const si = s.charCodeAt(i);
				for (let j = 0; j < m; j++) {
					const cost = (si - t.charCodeAt(j)) ** 2;
					dp2[j + 1] = Math.min(dp[j] + cost, dp[j + 1] + cost * 0.25, dp2[j] + cost * 0.25);
				}
				[dp, dp2] = [dp2, dp];
			}
			return dp[m];
		}

		class CodeRunner {
			_label;
			get label() {
				return this._label;
			}
			constructor(label, site2) {
				this._label = `${label} [${site2}]`;
			}
			async run(_sourceCode, input, _options = {}) {
				return { status: "IE", input };
			}
			async test(sourceCode, input, expectedOutput, options2) {
				let result = { status: "IE", input };
				try {
					result = await this.run(sourceCode, input, options2);
				} catch (e) {
					result.error = String(e);
					return result;
				}
				if (expectedOutput != null) result.expectedOutput = expectedOutput;
				if (result.status !== "OK" || typeof expectedOutput !== "string") return result;
				const judged = evaluateEasyTestOutput(
					{
						status: result.status,
						output: result.output || "",
						error: result.error,
						execTime: result.execTime,
					},
					expectedOutput,
					options2,
				);
				result.status = judged.status;
				result.output = judged.output;
				result.expectedOutput = judged.expectedOutput;
				return result;
			}
		}

		class CustomRunner extends CodeRunner {
			run;
			constructor(label, run) {
				super(label, "Browser");
				this.run = run;
			}
		}
		let waitAtCoderCustomTest = Promise.resolve();
		const AtCoderCustomTestBase = location.href.replace(/\/tasks\/.+$/, "/custom_test");
		const AtCoderCustomTestResultAPI = AtCoderCustomTestBase + "/json?reload=true";
		const AtCoderCustomTestSubmitAPI = AtCoderCustomTestBase + "/submit/json";
		const ce_groups = new Set();

		class AtCoderRunner extends CodeRunner {
			languageId;
			constructor(languageId, label) {
				super(label, "AtCoder");
				this.languageId = languageId;
			}
			async run(sourceCode, input, options2 = {}) {
				const promise = this.submit(sourceCode, input, options2);
				waitAtCoderCustomTest = promise;
				return await promise;
			}
			async submit(sourceCode, input, options2 = {}) {
				try {
					await waitAtCoderCustomTest;
				} catch (error2) {
					console.error(error2);
				}
				if ("runGroupId" in options2 && ce_groups.has(options2.runGroupId)) {
					return {
						status: "CE",
						input,
					};
				}
				const error = await fetch(AtCoderCustomTestSubmitAPI, {
					method: "POST",
					credentials: "include",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
					},
					body: buildQueryString({
						"data.LanguageId": String(this.languageId),
						sourceCode,
						input,
						csrf_token: unsafeWindow.csrfToken,
					}),
				}).then((r) => r.text());
				if (error) {
					throw new Error(error);
				}
				await sleep(100);
				const maxAttempts = 300;
				for (let attempt = 0; attempt < maxAttempts; attempt++) {
					const data2 = await fetch(AtCoderCustomTestResultAPI, {
						method: "GET",
						credentials: "include",
					}).then((r) => r.json());
					if (!("Result" in data2)) {
						await sleep(1000);
						continue;
					}
					const result = data2.Result;
					if ("Interval" in data2) {
						await sleep(data2.Interval);
						continue;
					}
					const status =
						result.ExitCode === 0 ? "OK" : result.TimeConsumption.toString().startsWith("-") ? "CE" : "RE";
					if (status === "CE" && "runGroupId" in options2) {
						ce_groups.add(options2.runGroupId);
					}
					return {
						status,
						exitCode: result.ExitCode,
						execTime: parseInt(result.TimeConsumption),
						memory: parseInt(result.MemoryConsumption),
						input,
						output: data2.Stdout,
						error: data2.Stderr,
					};
				}
				return {
					status: "TLE",
					input,
					error: "Custom test timed out",
				};
			}
		}

		class PaizaIORunner extends CodeRunner {
			name;
			constructor(name, label) {
				super(label, "PaizaIO");
				this.name = name;
			}
			async run(sourceCode, input, _options = {}) {
				let id;
				let status;
				try {
					const res2 = await fetch(
						"https://api.paiza.io/runners/create?" +
							buildQueryString({
								source_code: sourceCode,
								language: this.name,
								input,
								longpoll: "true",
								longpoll_timeout: "10",
								api_key: "guest",
							}),
						{
							method: "POST",
							mode: "cors",
						},
					).then((r) => r.json());
					id = res2.id;
					status = res2.status;
				} catch (error) {
					return {
						status: "IE",
						input,
						error: String(error),
					};
				}
				while (status === "running") {
					const res2 = await fetch(
						"https://api.paiza.io/runners/get_status?" +
							buildQueryString({
								id,
								api_key: "guest",
							}),
						{
							mode: "cors",
						},
					).then((res3) => res3.json());
					status = res2.status;
				}
				const res = await fetch(
					"https://api.paiza.io/runners/get_details?" +
						buildQueryString({
							id,
							api_key: "guest",
						}),
					{
						mode: "cors",
					},
				).then((r) => r.json());
				const result = {
					status: "OK",
					exitCode: String(res.exit_code),
					execTime: +res.time * 1000,
					memory: +res.memory * 0.001,
					input,
				};
				if (res.build_result === "failure") {
					result.status = "CE";
					result.exitCode = res.build_exit_code;
					result.output = res.build_stdout;
					result.error = res.build_stderr;
				} else {
					result.status = res.result === "timeout" ? "TLE" : res.result === "failure" ? "RE" : "OK";
					result.exitCode = res.exit_code;
					result.output = res.stdout;
					result.error = res.stderr;
				}
				return result;
			}
		}
		async function loadPyodide() {
			const script = await fetch("https://cdn.jsdelivr.net/pyodide/v0.24.0/full/pyodide.js").then((res) =>
				res.text(),
			);
			globalThis.Function(script)();
			const loadPyodide2 = unsafeWindow.loadPyodide;
			const pyodide = await loadPyodide2({
				indexURL: "https://cdn.jsdelivr.net/pyodide/v0.24.0/full/",
			});
			await pyodide.runPythonAsync(`
import contextlib, io, platform
class __redirect_stdin(contextlib._RedirectStream):
  _stream = "stdin"
`);
			return pyodide;
		}
		let _pyodide = Promise.reject("Pyodide is not yet loaded");
		let _serial = Promise.resolve();
		const pyodideRunner = new CustomRunner(
			"Pyodide",
			(sourceCode, input, _options = {}) =>
				new Promise((resolve) => {
					_serial = _serial.finally(async () => {
						const pyodide = await (_pyodide = _pyodide.catch(loadPyodide));
						const code =
							`
def __run():
 global __stdout, __stderr, __stdin, __code
 with __redirect_stdin(io.StringIO(__stdin)):
  with contextlib.redirect_stdout(io.StringIO()) as __stdout:
   with contextlib.redirect_stderr(io.StringIO()) as __stderr:
    try:
     pass
` +
							sourceCode
								.split(
									`
`,
								)
								.map((line) => "     " + line).join(`
`) +
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
								if (__code !== 0) status = "RE";
							}
						} catch (error) {
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
				}),
		);
		function pairs(list) {
			const pairs2 = [];
			const len = list.length >> 1;
			for (let i = 0; i < len; i++) pairs2.push([list[i * 2], list[i * 2 + 1]]);
			return pairs2;
		}
		async function init$5() {
			if (location.host !== "atcoder.jp") throw "Not AtCoder";
			const doc = unsafeWindow.document;
			const langMap2 = {
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
			const existingLangs = new Set();
			const langSelect = doc.querySelector("#select-lang select.current");
			if (!langSelect) throw new Error("AtCoder language selector was not found.");
			for (const option of langSelect.options) {
				existingLangs.add(option.value);
			}
			for (const key of Object.keys(langMap2)) {
				if (!existingLangs.has(key.toString())) {
					delete langMap2[key];
				}
			}
			const languageId = new ObservableValue(String(unsafeWindow.$("#select-lang select.current").val()));
			unsafeWindow.$("#select-lang select").change(() => {
				languageId.value = String(unsafeWindow.$("#select-lang select.current").val());
			});
			const language = languageId.map((lang) => langMap2[lang] ?? "");
			const isTestCasesHere = /^\/contests\/[^\/]+\/tasks\//.test(location.pathname);
			const taskSelector = doc.querySelector("#select-task");
			let warnedTestCasesNotLoaded = false;
			function getTaskURI() {
				if (taskSelector)
					return `${location.origin}/contests/${unsafeWindow.contestScreenName}/tasks/${taskSelector.value}`;
				return `${location.origin}${location.pathname}`;
			}
			const testcasesCache = {};
			let activeTestcaseFetchController = null;
			if (taskSelector) {
				const doFetchTestCases = () => {
					const taskURI = getTaskURI();
					const cached = testcasesCache[taskURI];
					if (cached && (cached.state === "loaded" || cached.state === "loading")) return;
					if (activeTestcaseFetchController) {
						activeTestcaseFetchController.abort();
						activeTestcaseFetchController = null;
					}
					const controller = new AbortController();
					activeTestcaseFetchController = controller;
					log.debug("Fetching test cases:", taskURI);
					const promise = fetchTestCases(taskURI, controller.signal)
						.then((testcases) => {
							testcasesCache[taskURI] = { testcases, state: "loaded" };
						})
						.catch((e) => {
							if (e && e.name === "AbortError") {
								testcasesCache[taskURI] = { state: "error", error: "aborted" };
								return;
							}
							testcasesCache[taskURI] = { state: "error", error: e };
							log.warn("Failed to fetch test cases:", taskURI, e);
						})
						.finally(() => {
							if (activeTestcaseFetchController === controller) {
								activeTestcaseFetchController = null;
							}
						});
					testcasesCache[taskURI] = { state: "loading", promise, controller };
				};
				unsafeWindow.$("#select-task").change(doFetchTestCases);
				doFetchTestCases();
			}
			async function fetchTestCases(taskUrl, signal = undefined) {
				const res = await fetch(taskUrl, { signal, credentials: "include" });
				if (!res.ok) throw new Error(`Failed to fetch task page: ${res.status} ${res.statusText}`);
				const html = await res.text();
				const taskDoc = new DOMParser().parseFromString(html, "text/html");
				return getTestCases(taskDoc);
			}
			function getTestCases(doc2) {
				const selectors = [
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
					let e = [...doc2.querySelectorAll(selector)];
					e = e.filter((e2) => {
						if (e2.closest(".io-style")) return false;
						return !e2.querySelector("var");
					});
					if (e.length === 0) continue;
					return pairs(e).map(([input, output], index) => {
						const container = input.closest(closestSelector) || input.parentElement;
						if (!container) throw new Error("Sample container was not found.");
						return {
							selector,
							title: `Sample ${index + 1}`,
							input: input.textContent ?? "",
							output: output.textContent ?? "",
							anchor:
								container.querySelector(".btn-copy") || container.querySelector("h1,h2,h3,h4,h5,h6"),
						};
					});
				}
				{
					let e = [...doc2.querySelectorAll("#task-statement .div-btn-copy+pre")];
					e = e.filter((f) => !f.childElementCount);
					if (e.length) {
						return pairs(e).map(([input, output], index) => ({
							selector: "#task-statement .div-btn-copy+pre",
							title: `Sample ${index + 1}`,
							input: input.textContent ?? "",
							output: output.textContent ?? "",
							anchor:
								(input.closest(".part") || input.parentElement)?.querySelector(".btn-copy") ?? input,
						}));
					}
				}
				return [];
			}
			const atcoder = {
				name: "AtCoder",
				language,
				langMap: langMap2,
				get sourceCode() {
					const $ = unsafeWindow.document.querySelector.bind(unsafeWindow.document);
					if (typeof unsafeWindow["ace"] !== "undefined" && unsafeWindow.ace) {
						const toggle = $(".btn-toggle-editor");
						if (toggle && !toggle.classList.contains("active")) {
							return unsafeWindow.ace.edit($("#editor")).getValue();
						}
						return $("#plain-textarea")?.value ?? "";
					}
					return unsafeWindow.getSourceCode?.() ?? "";
				},
				set sourceCode(sourceCode) {
					const $ = unsafeWindow.document.querySelector.bind(unsafeWindow.document);
					if (typeof unsafeWindow["ace"] !== "undefined") {
						unsafeWindow["ace"].edit($("#editor")).setValue(sourceCode);
						$("#plain-textarea").value = sourceCode;
					} else {
						doc.querySelector(".plain-textarea").value = sourceCode;
						unsafeWindow.$(".editor").data("editor").doc.setValue(sourceCode);
					}
				},
				submit() {
					doc.querySelector("#submit").click();
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
						testcasesCache[taskURI] = { testcases, state: "loaded" };
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
			return atcoder;
		}
		async function init$4() {
			if (location.host !== "yukicoder.me") throw "Not yukicoder";
			const $ = unsafeWindow.$;
			const doc = unsafeWindow.document;
			const editor = unsafeWindow.ace.edit("rich_source");
			const eSourceObject = $("#source");
			const eLang = $("#lang");
			const eSamples = $(".sample");
			const langMap2 = {
				cpp14: "C++ C++14 GCC 11.1.0 + Boost 1.77.0",
				cpp17: "C++ C++17 GCC 11.1.0 + Boost 1.77.0",
				"cpp-clang": "C++ C++17 Clang 10.0.0 + Boost 1.76.0",
				cpp23: "C++ C++11 GCC 8.4.1",
				c11: "C++ C++11 GCC 11.1.0",
				c: "C C90 GCC 8.4.1",
				java8: "Java Java16 OpenJDK 16.0.1",
				csharp: "C# CSC 3.9.0",
				csharp_mono: "C# Mono 6.12.0.147",
				csharp_dotnet: "C# .NET 5.0",
				perl: "Perl 5.26.3",
				raku: "Raku Rakudo v2021-07-2-g74d7ff771",
				php: "PHP 7.2.24",
				php7: "PHP 8.0.8",
				python3: "Python3 3.9.6 + numpy 1.14.5 + scipy 1.1.0",
				pypy2: "Python PyPy2 7.3.5",
				pypy3: "Python3 PyPy3 7.3.5",
				ruby: "Ruby 3.0.2p107",
				d: "D DMD 2.097.1",
				go: "Go 1.16.6",
				haskell: "Haskell 8.10.5",
				scala: "Scala 2.13.6",
				nim: "Nim 1.4.8",
				rust: "Rust 1.53.0",
				kotlin: "Kotlin 1.5.21",
				scheme: "Scheme Gauche 0.9.10",
				crystal: "Crystal 1.1.1",
				swift: "Swift 5.4.2",
				ocaml: "OCaml 4.12.0",
				clojure: "Clojure 1.10.2.790",
				fsharp: "F# 5.0",
				elixir: "Elixir 1.7.4",
				lua: "Lua LuaJIT 2.0.5",
				fortran: "Fortran gFortran 8.4.1",
				node: "JavaScript Node.js 15.5.0",
				typescript: "TypeScript 4.3.5",
				lisp: "Lisp Common Lisp sbcl 2.1.6",
				sml: "ML Standard ML MLton 20180207-6",
				kuin: "Kuin KuinC++ v.2021.7.17",
				vim: "Vim v8.2",
				sh: "Bash 4.4.19",
				nasm: "Assembler nasm 2.13.03",
				clay: "cLay 20210917-1",
				bf: "Brainfuck BFI 1.1",
				Whitespace: "Whitespace 0.3",
				text: "Text cat 8.3",
			};
			for (const btnCopyInput of doc.querySelectorAll(".copy-sample-input")) {
				btnCopyInput.parentElement?.insertBefore(
					newElement("span", { className: "atcoder-easy-test-anchor" }),
					btnCopyInput,
				);
			}
			const language = new ObservableValue(langMap2[String(eLang.val())] ?? "");
			eLang.on("change", () => {
				language.value = langMap2[String(eLang.val())] ?? "";
			});
			return {
				name: "yukicoder",
				language,
				get sourceCode() {
					if (eSourceObject.is(":visible")) return eSourceObject.val();
					return editor.getSession().getValue();
				},
				set sourceCode(sourceCode) {
					eSourceObject.val(sourceCode);
					editor.getSession().setValue(sourceCode);
				},
				submit() {
					doc.querySelector(`#submit_form input[type="submit"]`).click();
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
					const testCases = [];
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
			_element;
			constructor(_lang) {
				this._element = document.createElement("textarea");
				this._element.style.fontFamily = "monospace";
				this._element.style.width = "100%";
				this._element.style.minHeight = "5em";
			}
			get element() {
				return this._element;
			}
			get sourceCode() {
				return this._element.value;
			}
			set sourceCode(sourceCode) {
				this._element.value = sourceCode;
			}
			setLanguage(_lang) {}
		}
		const langMap = {
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
			if (location.host !== "codeforces.com") throw "not Codeforces";
			const doc = unsafeWindow.document;
			const eLang = doc.querySelector("select[name='programTypeId']");
			if (!eLang) throw new Error("Codeforces language selector was not found.");
			doc.head.appendChild(
				newElement("link", {
					rel: "stylesheet",
					href: "https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/css/bootstrap.min.css",
				}),
			);
			doc.head.appendChild(
				newElement("style", {
					textContent: `
.atcoder-easy-test-btn-run-case {
  float: right;
  line-height: 1.1rem;
}
    `,
				}),
			);
			const eButtons = newElement("span");
			doc.querySelector(".submitForm")?.appendChild(eButtons);
			await loadScript("https://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js");
			const jQuery = unsafeWindow.jQuery?.noConflict?.();
			if (!jQuery) throw new Error("jQuery was not loaded.");
			const codeforcesWindow = unsafeWindow;
			codeforcesWindow.jQuery = codeforcesWindow.$;
			codeforcesWindow.jQuery11 = jQuery;
			await loadScript("https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/js/bootstrap.min.js", null, {
				jQuery,
				$: jQuery,
			});
			const language = new ObservableValue(langMap[eLang.value] ?? "");
			eLang.addEventListener("change", () => {
				language.value = langMap[eLang.value];
			});
			let _sourceCode = "";
			const submitForm = doc.querySelector(".submitForm");
			const eFile = submitForm.elements.namedItem("sourceFile");
			eFile.addEventListener("change", async () => {
				const file = eFile.files?.[0];
				if (file) {
					_sourceCode = await file.text();
					if (editor) editor.sourceCode = _sourceCode;
				}
			});
			let editor = null;
			let waitCfFastSubmitCount = 0;
			const waitCfFastSubmit = setInterval(() => {
				if (document.getElementById("editor")) {
					if (editor && editor.element) editor.element.style.display = "none";
					const eLang2 = doc.querySelector(".submit-form select[name='programTypeId']");
					if (eLang2) {
						eLang.addEventListener("change", () => {
							eLang2.value = eLang.value;
						});
						eLang2.addEventListener("change", () => {
							eLang.value = eLang2.value;
							language.value = langMap[eLang.value];
						});
					}
					const aceEditor = unsafeWindow.ace.edit("editor");
					editor = {
						get sourceCode() {
							return aceEditor.getValue();
						},
						set sourceCode(sourceCode) {
							aceEditor.setValue(sourceCode);
						},
						setLanguage(_lang) {},
					};
					const buttonContainer = doc.querySelector(".submit-form .submit").parentElement;
					if (!buttonContainer) throw new Error("Codeforces button container was not found.");
					buttonContainer.appendChild(
						newElement("button", {
							type: "button",
							className: "btn btn-info",
							textContent: "Test & Submit",
							onclick: () => events.trig("testAndSubmit"),
						}),
					);
					buttonContainer.appendChild(
						newElement("button", {
							type: "button",
							className: "btn btn-default",
							textContent: "Test All Samples",
							onclick: () => events.trig("testAllSamples"),
						}),
					);
					clearInterval(waitCfFastSubmit);
				} else {
					waitCfFastSubmitCount++;
					if (waitCfFastSubmitCount >= 100) clearInterval(waitCfFastSubmit);
				}
			}, 100);
			if (config.get("site.codeforces.showEditor", true)) {
				editor = new Editor(langMap[eLang.value].split(" ")[0]);
				const pageContent = doc.getElementById("pageContent");
				if (pageContent && editor.element) pageContent.appendChild(editor.element);
				language.addListener((lang) => {
					editor?.setLanguage(lang);
				});
			}
			return {
				name: "Codeforces",
				language,
				get sourceCode() {
					if (editor) return editor.sourceCode;
					return _sourceCode;
				},
				set sourceCode(sourceCode) {
					const container = new DataTransfer();
					container.items.add(new File([sourceCode], "prog.txt", { type: "text/plain" }));
					const eFile2 = doc.querySelector(".submitForm").elements.namedItem("sourceFile");
					eFile2.files = container.files;
					_sourceCode = sourceCode;
					if (editor) editor.sourceCode = sourceCode;
				},
				submit() {
					if (editor) _sourceCode = editor.sourceCode;
					this.sourceCode = _sourceCode;
					doc.querySelector(`.submitForm .submit`).click();
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
								if (
									node.nodeType === Node.ELEMENT_NODE &&
									(node.tagName === "DIV" || node.tagName === "BR")
								) {
									inputText += `
`;
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
		config.registerFlag(
			"site.codeforcesMobile.showEditor",
			true,
			"Show Editor in Mobile Codeforces (m[1-3].codeforces.com) Problem Page",
		);
		async function init$2() {
			if (!/^m[1-3]\.codeforces\.com$/.test(location.host)) throw "not Codeforces Mobile";
			const url = /\/contest\/(\d+)\/problem\/([^/]+)/.exec(location.pathname);
			if (!url) throw new Error("Codeforces Mobile problem URL was not matched.");
			const contestId = url[1];
			const problemId = url[2];
			const doc = unsafeWindow.document;
			const main = doc.querySelector("main");
			if (!main) throw new Error("Codeforces Mobile main element was not found.");
			doc.head.appendChild(
				newElement("link", {
					rel: "stylesheet",
					href: "https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/css/bootstrap.min.css",
				}),
			);
			await loadScript("https://maxcdn.bootstrapcdn.com/bootstrap/3.3.1/js/bootstrap.min.js");
			const language = new ObservableValue("");
			let submit = () => {};
			let getSourceCode = () => "";
			let setSourceCode = (_sourceCode) => {};
			if (config.get("site.codeforcesMobile.showEditor", true)) {
				const frame = newElement("iframe", {
					src: `/contest/${contestId}/submit`,
					style: {
						display: "none",
					},
				});
				doc.body.appendChild(frame);
				await new Promise((done) => {
					frame.onload = () => done();
				});
				const fdoc = frame.contentDocument;
				if (!fdoc) throw new Error("Codeforces submit iframe document is not available.");
				const form = fdoc.querySelector("._SubmitPage_submitForm");
				if (!form) throw new Error("Codeforces submit form was not found.");
				const problemIndexInput = form.elements.namedItem("problemIndex");
				const programTypeSelect = form.elements.namedItem("programTypeId");
				const sourceInput = form.elements.namedItem("source");
				problemIndexInput.value = problemId;
				problemIndexInput.readOnly = true;
				programTypeSelect.addEventListener("change", (event) => {
					language.value = langMap[event.currentTarget.value];
				});
				for (const row of form.children) {
					if (row.tagName !== "DIV") continue;
					row.classList.add("form-group");
					const control = row.querySelector("*[name]");
					if (control) control.classList.add("form-control");
				}
				form.parentElement?.removeChild(form);
				main.appendChild(form);
				submit = () => form.submit();
				getSourceCode = () => sourceInput.value;
				setSourceCode = (sourceCode) => {
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
				get testCases() {
					const testcases = [];
					let index = 1;
					for (const container of doc.querySelectorAll(".sample-test")) {
						const input = container.querySelector(".input pre.content")?.textContent ?? "";
						const output = container.querySelector(".output pre.content")?.textContent ?? "";
						const anchor = container.querySelector(".input .title") ?? container;
						testcases.push({
							input,
							output,
							anchor,
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
			const doc = unsafeWindow.document;
			await loadScript("https://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js");
			const jQuery = unsafeWindow["jQuery"];
			await loadScript("https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/js/bootstrap.min.js", null, {
				jQuery,
				$: jQuery,
			});
			const e = newElement("div");
			doc.getElementById("install-area")?.appendChild(
				newElement("button", {
					type: "button",
					textContent: "Open config",
					onclick: () => settings.open(),
				}),
			);
			return {
				name: "About Page",
				language: new ObservableValue(""),
				get sourceCode() {
					return "";
				},
				set sourceCode(_sourceCode) {},
				submit() {},
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
				get testCases() {
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
		const inits = [init$1()];
		config.registerFlag("site.atcoder", true, "Use AtCoder Easy Test in AtCoder");
		if (config.get("site.atcoder", true)) inits.push(init$5());
		config.registerFlag("site.yukicoder", true, "Use AtCoder Easy Test in yukicoder");
		if (config.get("site.yukicoder", true)) inits.push(init$4());
		config.registerFlag("site.codeforces", true, "Use AtCoder Easy Test in Codeforces");
		if (config.get("site.codeforces", true)) inits.push(init$3());
		config.registerFlag(
			"site.codeforcesMobile",
			true,
			"Use AtCoder Easy Test in Codeforces Mobile (m[1-3].codeforces.com)",
		);
		if (config.get("site.codeforcesMobile", true)) inits.push(init$2());
		const site = Promise.any(inits);
		site.catch(() => {
			for (const promise of inits) {
				promise.catch(console.error);
			}
		});

		class WandboxRunner extends CodeRunner {
			name;
			options;
			constructor(name, label, options2 = {}) {
				super(label, "Wandbox");
				this.name = name;
				this.options = options2;
			}
			getOptions(sourceCode, input) {
				if (typeof this.options === "function") return this.options(sourceCode, input);
				return this.options;
			}
			run(sourceCode, input, options2 = {}) {
				return this.request(
					Object.assign(
						{
							compiler: this.name,
							code: sourceCode,
							stdin: input,
						},
						Object.assign(options2, this.getOptions(sourceCode, input)),
					),
				);
			}
			async request(body) {
				const startTime = Date.now();
				let res;
				try {
					res = await fetch("https://wandbox.org/api/compile.json", {
						method: "POST",
						mode: "cors",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(body),
					}).then((r) => r.json());
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
			async run(sourceCode, input, _options = {}) {
				const ACLBase = "https://cdn.jsdelivr.net/gh/atcoder/ac-library/";
				const files = new Map();
				const includeHeader = async (source) => {
					const pattern = /^#\s*include\s*[<"]atcoder\/([^>"]+)[>"]/gm;
					const loaded = [];
					for (const match of source.matchAll(pattern)) {
						const file = "atcoder/" + match[1];
						if (files.has(file)) continue;
						files.set(file, null);
						loaded.push([
							file,
							fetch(ACLBase + file, {
								mode: "cors",
								cache: "force-cache",
							}).then((r) => r.text()),
						]);
					}
					const included = await Promise.all(
						loaded.map(async ([file, r]) => {
							const source2 = await r;
							files.set(file, source2);
							return source2;
						}),
					);
					for (const source2 of included) {
						await includeHeader(source2);
					}
				};
				await includeHeader(sourceCode);
				const codes = [];
				for (const [file, code] of files) {
					codes.push({ file, code });
				}
				return await this.request(
					Object.assign(
						{
							compiler: this.name,
							code: sourceCode,
							stdin: input,
							codes,
						},
						Object.assign(options, this.getOptions(sourceCode, input)),
					),
				);
			}
		}
		config.registerCount(
			"wandboxAPI.cacheLifetime",
			24 * 60 * 60 * 1000,
			"lifetime [ms] of Wandbox compiler list cache",
		);
		async function fetchWandboxCompilers() {
			const cached = config.get("wandboxAPI.cachedCompilerList", { value: null, lastModified: -Infinity });
			if (
				Array.isArray(cached.value) &&
				Date.now() - cached.lastModified <= config.get("wandboxAPI.cacheLifetime", 24 * 60 * 60 * 1000)
			) {
				return cached.value;
			}
			const response = await fetch("https://wandbox.org/api/list.json");
			const compilers = await response.json();
			if (!Array.isArray(compilers)) {
				throw new Error("Wandbox compiler list is not a JSON array.");
			}
			config.set("wandboxAPI.cachedCompilerList", { value: compilers, lastModified: Date.now() });
			config.save();
			return compilers;
		}
		function getOptimizationOption(compiler) {
			return compiler.switches.find((sw) => sw["display-name"] === "Optimization")?.name;
		}
		function toRunner(compiler) {
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
		let runners$1 = {};
		const currentLocalRunners = [];
		let localRunnerCacheURL = "";
		let localRunnerCacheSignature = "";

		class LocalRunner extends CodeRunner {
			compilerName;
			static setRunners(_runners) {
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
					}).then((r) => r.json());
					const nextEntries = [];
					for (const { compilerName, label, ...info } of res) {
						const key = buildLocalRunnerKey({ compilerName, label, ...info });
						nextEntries.push({ key, compilerName, label });
					}
					const nextSignature = nextEntries.map(({ key }) => key).join(`
`);
					if (localRunnerCacheURL === apiURL && localRunnerCacheSignature === nextSignature) {
						return false;
					}
					for (const key of currentLocalRunners) {
						delete runners$1[key];
					}
					currentLocalRunners.length = 0;
					for (const { key, compilerName, label } of nextEntries) {
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
			constructor(compilerName, label) {
				super(label, "Local");
				this.compilerName = compilerName;
			}
			async run(sourceCode, input, _options = {}) {
				const apiURL = config.getString("codeRunner.localRunnerURL", "");
				if (!isHttpUrl(apiURL)) {
					throw "LocalRunner: invalid localRunnerURL";
				}
				let res;
				try {
					res = await fetch(apiURL, {
						method: "POST",
						mode: "cors",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(buildLocalRunnerRunRequest(sourceCode, input, this.compilerName)),
					}).then((r) => r.json());
				} catch (error) {
					return {
						status: "IE",
						input,
						error: String(error),
					};
				}
				const result = {
					status: toEasyTestStatus(res.status, res.exitCode),
					exitCode: String(res.exitCode),
					execTime: +res.time,
					memory: +res.memory,
					input,
					output: res.stdout ?? "",
					error: res.stderr ?? "",
				};
				return result;
			}
		}
		const runners = {
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
		let wandboxPromise = null;
		function ensureWandboxCompilersLoaded() {
			if (!wandboxPromise) {
				wandboxPromise = fetchWandboxCompilers().then((compilers) => {
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
		site.then((site2) => {
			if (site2.name === "AtCoder") {
				for (const [languageId, descriptor] of Object.entries(site2.langMap)) {
					const m = descriptor.match(/([^ ]+)(.*)/);
					if (m) {
						const name = `${m[1]} ${m[2].slice(1)} AtCoder`;
						runners[name] = new AtCoderRunner(languageId, descriptor);
					}
				}
			}
		});
		config.registerText(
			"codeRunner.localRunnerURL",
			"",
			"URL of Local Runner API (cf. https://github.com/magurofly/atcoder-easy-test/blob/main/v2/docs/LocalRunner.md)",
		);
		LocalRunner.setRunners(runners);
		const localRunnerPromise = LocalRunner.update();
		config.registerFlag("codeRunner.precompile.enable", true, "Enable LocalRunner precompile on editor changes");
		let precompileTimeout = null;
		let lastPrecompiledCode = "";
		let isPrecompiling = false;
		const PRECOMPILE_DELAY_MS = 180;
		async function triggerPrecompile() {
			if (isPrecompiling) return;
			isPrecompiling = true;
			try {
				const apiURL = config.getString("codeRunner.localRunnerURL", "");
				if (!apiURL || !isHttpUrl(apiURL)) return;
				if (!config.get("codeRunner.precompile.enable", true)) return;
				const currentSite = await site;
				const sourceCode = currentSite.sourceCode;
				if (!sourceCode || sourceCode === lastPrecompiledCode) return;
				lastPrecompiledCode = sourceCode;
				fetch(apiURL, {
					method: "POST",
					mode: "cors",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(buildLocalRunnerPrecompileRequest(sourceCode)),
				}).catch(() => {});
				log.debug("[LocalRunner] Precompile triggered");
			} catch (e) {
				log.error("[LocalRunner] Precompile error:", e);
			} finally {
				isPrecompiling = false;
			}
		}
		function schedulePrecompile() {
			if (!config.get("codeRunner.precompile.enable", true)) return;
			if (precompileTimeout) clearTimeout(precompileTimeout);
			precompileTimeout = setTimeout(triggerPrecompile, PRECOMPILE_DELAY_MS);
		}
		site.then((currentSite) => {
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
		log.debug("codeRunner OK");
		config.registerCount("codeRunner.maxRetry", 3, "Max count of retry when IE (Internal Error)");
		const codeRunner = {
			async run(
				runnerId,
				sourceCode,
				input,
				expectedOutput,
				options2 = {
					trim: true,
					split: true,
				},
			) {
				if (!(runnerId in runners)) return Promise.reject("Language not supported");
				if (sourceCode.length > 0) site.then((site2) => codeSaver.save(site2.taskURI, sourceCode));
				const maxRetry = config.get("codeRunner.maxRetry", 3);
				for (let retry = 0; retry < maxRetry; retry++) {
					try {
						const result = await runners[runnerId].test(sourceCode, input, expectedOutput, options2);
						const lang = runnerId.split(" ")[0];
						if (result.status === "IE") {
							console.error(result);
							const runnerIds = Object.keys(runners).filter(
								(runnerId2) => runnerId2.split(" ")[0] === lang,
							);
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
			async getEnvironment(languageId, options2 = {}) {
				const { refreshLocalRunner = true } = options2;
				ensureWandboxCompilersLoaded();
				await localRunnerPromise;
				if (refreshLocalRunner) await LocalRunner.update();
				let langs = similarLangs(languageId, Object.keys(runners));
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
						langs = local.length > 0 ? local.concat(atcoder).concat(other) : atcoder.concat(other);
					}
				} catch (e) {
					console.error("AtCoder Easy Test: getEnvironment(Java-local sort) failed:", e);
				}
				if (langs.length === 0) throw `Undefined language: ${languageId}`;
				return langs.map((runnerId) => [runnerId, runners[runnerId].label]);
			},
		};
		const hBottomMenu = `<div id="bottom-menu-wrapper" class="navbar navbar-default navbar-fixed-bottom">
  <div class="container">
    <div class="navbar-header">
      <button id="bottom-menu-key" type="button" class="navbar-toggle collapsed glyphicon glyphicon-menu-down" data-toggle="collapse" data-target="#bottom-menu"></button>
    </div>
    <div id="bottom-menu" class="collapse navbar-collapse">
      <ul id="bottom-menu-tabs" class="nav nav-tabs"></ul>
      <div id="bottom-menu-contents" class="tab-content"></div>
    </div>
  </div>
</div>`;
		const hStyle$1 = `<style>
#bottom-menu-wrapper {
  background: transparent !important;
  border: none !important;
  pointer-events: none;
  padding: 0;
}

#bottom-menu-wrapper>.container {
  position: absolute;
  bottom: 0;
  width: 100%;
  padding: 0;
}

#bottom-menu-wrapper>.container>.navbar-header {
  float: none;
}

#bottom-menu-key {
  display: block;
  float: none;
  margin: 0 auto;
  padding: 10px 3em;
  border-radius: 5px 5px 0 0;
  background: #000;
  opacity: 0.5;
  color: #FFF;
  cursor: pointer;
  pointer-events: auto;
  text-align: center;
}

@media screen and (max-width: 767px) {
  #bottom-menu-key {
    opacity: 0.25;
  }
}

#bottom-menu-key.collapsed:before {
  content: "\\e260";
}

#bottom-menu-tabs {
  padding: 3px 0 0 10px;
  cursor: n-resize;
}

#bottom-menu-tabs a {
  pointer-events: auto;
}

#bottom-menu {
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  max-height: unset;
}

#bottom-menu.collapse:not(.in) {
  display: none !important;
}

#bottom-menu-tabs>li>a {
  background: rgba(150, 150, 150, 0.5);
  color: #000;
  border: solid 1px #ccc;
  filter: brightness(0.75);
}

#bottom-menu-tabs>li>a:hover {
  background: rgba(150, 150, 150, 0.5);
  border: solid 1px #ccc;
  color: #111;
  filter: brightness(0.9);
}

#bottom-menu-tabs>li.active>a {
  background: #eee;
  border: solid 1px #ccc;
  color: #333;
  filter: none;
}

.bottom-menu-btn-close {
  font-size: 8pt;
  vertical-align: baseline;
  padding: 0 0 0 6px;
  margin-right: -6px;
}

#bottom-menu-contents {
  padding: 5px 15px;
  max-height: 50vh;
  overflow-y: auto;
}

#bottom-menu-contents .panel {
  color: #333;
}
</style>`;
		async function init() {
			const site$1 = await site;
			const style = html2element(hStyle$1);
			const bottomMenu = html2element(hBottomMenu);
			unsafeWindow.document.head.appendChild(style);
			site$1.bottomMenuContainer.appendChild(bottomMenu);
			const bottomMenuKey = bottomMenu.querySelector("#bottom-menu-key");
			const bottomMenuTabs = bottomMenu.querySelector("#bottom-menu-tabs");
			const bottomMenuContents = bottomMenu.querySelector("#bottom-menu-contents");
			if (!bottomMenuKey || !bottomMenuTabs || !bottomMenuContents) {
				throw new Error("bottom menu elements were not found.");
			}
			{
				let resizeStart = null;
				const onStart = (event) => {
					const target = event.target;
					const pageY = event.pageY;
					if (target.id !== "bottom-menu-tabs") return;
					resizeStart = { y: pageY, height: bottomMenuContents.getBoundingClientRect().height };
				};
				const onMove = (event) => {
					if (!resizeStart) return;
					event.preventDefault();
					bottomMenuContents.style.height = `${resizeStart.height - (event.pageY - resizeStart.y)}px`;
				};
				const onEnd = () => {
					resizeStart = null;
				};
				bottomMenuTabs.addEventListener("mousedown", onStart);
				bottomMenuTabs.addEventListener("mousemove", onMove);
				bottomMenuTabs.addEventListener("mouseup", onEnd);
				bottomMenuTabs.addEventListener("mouseleave", onEnd);
			}
			let tabs = new Set();
			let selectedTab = null;
			const menuController = {
				selectTab(tabId) {
					const tab = site$1.jQuery(`#bottom-menu-tab-${tabId}`);
					if (tab && tab[0]) {
						tab.tab("show");
						selectedTab = tabId;
					}
				},
				addTab(tabId, tabLabel, paneContent, options2 = {}) {
					log.debug(`addTab: ${tabLabel} (${tabId})`, paneContent);
					const tab = document.createElement("a");
					tab.textContent = tabLabel;
					tab.id = `bottom-menu-tab-${tabId}`;
					tab.href = "#";
					tab.dataset.id = tabId;
					tab.dataset.target = `#bottom-menu-pane-${tabId}`;
					tab.dataset.toggle = "tab";
					tab.addEventListener("click", (event) => {
						event.preventDefault();
						menuController.selectTab(tabId);
					});
					tabs.add(tab);
					const tabLi = document.createElement("li");
					tabLi.appendChild(tab);
					bottomMenuTabs.appendChild(tabLi);
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
						set color(color) {
							tab.style.backgroundColor = color;
						},
					};
					if (options2.closeButton) {
						const btn = document.createElement("a");
						btn.className = "bottom-menu-btn-close btn btn-link glyphicon glyphicon-remove";
						btn.addEventListener("click", () => {
							controller.close();
						});
						tab.appendChild(btn);
					}
					if (!selectedTab) menuController.selectTab(tabId);
					return controller;
				},
				show() {
					if (bottomMenuKey.classList.contains("collapsed")) bottomMenuKey.click();
				},
				toggle() {
					bottomMenuKey.click();
				},
			};
			log.debug("bottomMenu OK");
			return menuController;
		}
		const hRowTemplate = `<div class="atcoder-easy-test-cases-row alert alert-dismissible">
  <button type="button" class="close" data-dismiss="alert" aria-label="close">
    <span aria-hidden="true">×</span>
  </button>
  <div class="progress">
    <div class="progress-bar" style="width: 0;">0 / 0</div>
  </div>
  <div class="atcoder-easy-test-cases-row-date" style="font-family: monospace; text-align: right; position: absolute; right: 1em;"></div>
</div>`;

		class ResultRow {
			_tabs;
			_element;
			_promise;
			constructor(pairs2) {
				this._tabs = pairs2.map(([_pResult, tab]) => tab);
				this._element = html2element(hRowTemplate);
				this._element.querySelector(".close")?.addEventListener("click", () => this.remove());
				{
					const date = new Date();
					const h = date.getHours().toString().padStart(2, "0");
					const m = date.getMinutes().toString().padStart(2, "0");
					const s = date.getSeconds().toString().padStart(2, "0");
					this._element.querySelector(".atcoder-easy-test-cases-row-date").textContent = `${h}:${m}:${s}`;
				}
				const numCases = pairs2.length;
				let numFinished = 0;
				let numAccepted = 0;
				const progressBar = this._element.querySelector(".progress-bar");
				if (!progressBar) throw new Error("Progress bar was not found.");
				progressBar.textContent = `${numFinished} / ${numCases}`;
				this._promise = Promise.all(
					pairs2.map(async ([pResult, tab]) => {
						const button = html2element(
							`<div class="label label-default" style="margin: 3px; cursor: pointer;">WJ</div>`,
						);
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
							if (result_1.status === "AC") numAccepted++;
							progressBar.textContent = `${numFinished} / ${numCases}`;
							progressBar.style.width = `${(100 * numFinished) / numCases}%`;
							if (numFinished === numCases) {
								if (numAccepted === numCases) this._element.classList.add("alert-success");
								else this._element.classList.add("alert-warning");
							}
						} catch (reason) {
							button.textContent = "IE";
							button.classList.add("label-danger");
							console.error(reason);
						}
					}),
				);
			}
			get element() {
				return this._element;
			}
			onFinish(listener) {
				this._promise.then(listener);
			}
			remove() {
				for (const pTab of this._tabs) pTab.then((tab) => tab.close());
				const parent = this._element.parentElement;
				if (parent) parent.removeChild(this._element);
			}
		}
		const hResultList = '<div class="row"></div>';
		const eResultList = html2element(hResultList);
		site.then((site2) => site2.resultListContainer.appendChild(eResultList));
		const resultList = {
			addResult(pairs2) {
				const result = new ResultRow(pairs2);
				eResultList.insertBefore(result.element, eResultList.firstChild);
				return result;
			},
		};
		const hTabTemplate = `<div class="atcoder-easy-test-result container">
  <div class="row">
    <div class="atcoder-easy-test-result-col-input col-xs-12" data-if-expected-output="col-sm-6 col-sm-push-6">
      <div class="form-group">
        <label class="control-label col-xs-12">
          Standard Input
          <div class="col-xs-12">
            <textarea class="atcoder-easy-test-result-input form-control" rows="3" readonly="readonly"></textarea>
          </div>
        </label>
      </div>
    </div>
    <div class="atcoder-easy-test-result-col-expected-output col-xs-12 col-sm-6 hidden" data-if-expected-output="!hidden col-sm-pull-6">
      <div class="form-group">
        <label class="control-label col-xs-12">
          Expected Output
          <div class="col-xs-12">
            <textarea class="atcoder-easy-test-result-expected-output form-control" rows="3" readonly="readonly"></textarea>
          </div>
        </label>
      </div>
    </div>
  </div>
  <div class="row"><div class="col-sm-6 col-sm-offset-3">
    <div class="panel panel-default">
      <table class="table table-condensed">
        <tbody>
          <tr>
            <th class="text-center">Exit Code</th>
            <th class="text-center">Exec Time</th>
            <th class="text-center">Memory</th>
          </tr>
          <tr>
            <td class="atcoder-easy-test-result-exit-code text-center"></td>
            <td class="atcoder-easy-test-result-exec-time text-center"></td>
            <td class="atcoder-easy-test-result-memory text-center"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div></div>
  <div class="row">
    <div class="atcoder-easy-test-result-col-output col-xs-12" data-if-error="col-md-6">
      <div class="form-group">
        <label class="control-label col-xs-12">
          Standard Output
          <div class="col-xs-12">
            <textarea class="atcoder-easy-test-result-output form-control" rows="5" readonly="readonly"></textarea>
          </div>
        </label>
      </div>
    </div>
    <div class="atcoder-easy-test-result-col-error col-xs-12 col-md-6 hidden" data-if-error="!hidden">
      <div class="form-group">
        <label class="control-label col-xs-12">
          Standard Error
          <div class="col-xs-12">
            <textarea class="atcoder-easy-test-result-error form-control" rows="5" readonly="readonly"></textarea>
          </div>
        </label>
      </div>
    </div>
  </div>
</div>`;
		function setClassFromData(element, name) {
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
			_uid;
			_element;
			_result;
			constructor() {
				this._uid = Date.now().toString(16) + Math.floor(Math.random() * 256).toString(16);
				this._result = null;
				this._element = html2element(hTabTemplate);
				this._element.id = `atcoder-easy-test-result-${this._uid}`;
			}
			set result(result) {
				this._result = result;
				if (result.status === "AC") {
					this.outputStyle.backgroundColor = "#dff0d8";
				} else if (result.status !== "OK") {
					this.outputStyle.backgroundColor = "#fcf8e3";
				}
				this.input = result.input;
				if ("expectedOutput" in result) this.expectedOutput = result.expectedOutput;
				this.exitCode = result.exitCode;
				if ("execTime" in result) this.execTime = `${result.execTime} ms`;
				if ("memory" in result) this.memory = `${result.memory} KB`;
				if ("output" in result) this.output = result.output;
				if (result.error) this.error = result.error;
			}
			get result() {
				return this._result;
			}
			get uid() {
				return this._uid;
			}
			get element() {
				return this._element;
			}
			set title(title) {
				this._title = title;
			}
			get title() {
				return this._title;
			}
			set input(input) {
				this._get("input").value = input;
			}
			get inputStyle() {
				return this._get("input").style;
			}
			set expectedOutput(output) {
				this._get("expected-output").value = output ?? "";
				setClassFromData(this._get("col-input"), "ifExpectedOutput");
				setClassFromData(this._get("col-expected-output"), "ifExpectedOutput");
			}
			get expectedOutputStyle() {
				return this._get("expected-output").style;
			}
			set output(output) {
				this._get("output").value = output ?? "";
			}
			get outputStyle() {
				return this._get("output").style;
			}
			set error(error) {
				this._get("error").value = error;
				setClassFromData(this._get("col-output"), "ifError");
				setClassFromData(this._get("col-error"), "ifError");
			}
			set exitCode(code) {
				const element = this._get("exit-code");
				element.textContent = String(code ?? "");
				const isSuccess = code === "0";
				element.classList.toggle("bg-success", isSuccess);
				element.classList.toggle("bg-danger", !isSuccess);
			}
			set execTime(time) {
				this._get("exec-time").textContent = time;
			}
			set memory(memory) {
				this._get("memory").textContent = memory;
			}
			_get(name) {
				const element = this._element.querySelector(`.atcoder-easy-test-result-${name}`);
				if (!element) throw new Error(`Result tab element not found: ${name}`);
				return element;
			}
		}
		const hRoot = `<form id="atcoder-easy-test-container" class="form-horizontal">
  <div class="row">
      <div class="col-xs-12 col-lg-8">
          <div class="form-group">
              <label class="control-label col-sm-2">Test Environment</label>
              <div class="col-sm-10">
                  <select class="form-control" id="atcoder-easy-test-language" style="width: 100% !important"></select>
              </div>
          </div>
          <div class="form-group">
              <label class="control-label col-sm-2" for="atcoder-easy-test-input">Standard Input</label>
              <div class="col-sm-10">
                  <textarea id="atcoder-easy-test-input" name="input" class="form-control" rows="3"></textarea>
              </div>
          </div>
      </div>
      <div class="col-xs-12 col-lg-4">
          <details close>
              <summary>Expected Output</summary>
              <div class="form-group">
                  <label class="control-label col-sm-2" for="atcoder-easy-test-allowable-error-check">Allowable Error</label>
                  <div class="col-sm-10">
                      <div class="input-group">
                          <span class="input-group-addon">
                              <input id="atcoder-easy-test-allowable-error-check" type="checkbox" checked="checked">
                          </span>
                          <input id="atcoder-easy-test-allowable-error" type="text" class="form-control" value="1e-6">
                      </div>
                  </div>
              </div>
              <div class="form-group">
                  <label class="control-label col-sm-2" for="atcoder-easy-test-output">Expected Output</label>
                  <div class="col-sm-10">
                      <textarea id="atcoder-easy-test-output" name="output" class="form-control" rows="3"></textarea>
                  </div>
              </div>
          </details>
      </div>
      <div class="col-xs-12 col-md-6">
          <div class="col-xs-11 col-xs-offset=1">
              <div class="form-group">
                  <a id="atcoder-easy-test-run" class="btn btn-primary">Run</a>
              </div>
          </div>
      </div>
      <div class="col-xs-12 col-md-6">
          <div class="col-xs-11 col-xs-offset=1">
              <div class="form-group text-right">
                  <a id="atcoder-easy-test-setting" class="btn btn-xs btn-default">Setting</a>
              </div>
          </div>
      </div>
  </div>
  <style>
  #atcoder-easy-test-language {
      border: none;
      background: transparent;
      font: inherit;
      color: #fff;
  }
  #atcoder-easy-test-language option {
      border: none;
      color: #333;
      font: inherit;
  }
  </style>
</form>`;
		const hStyle = `<style>
.atcoder-easy-test-result textarea {
  font-family: monospace;
  font-weight: normal;
}
</style>`;
		const hRunButton =
			'<button type="button" class="btn btn-primary btn-sm atcoder-easy-test-btn-run-case" style="vertical-align: top; margin-left: 0.5em">Run</button>';
		const hTestAndSubmit =
			'<button type="button" id="atcoder-easy-test-btn-test-and-submit" class="btn btn-info btn" style="margin-left: 1rem" title="Ctrl+Enter" data-toggle="tooltip">Test &amp; Submit</button>';
		const hTestAllSamples =
			'<button type="button" id="atcoder-easy-test-btn-test-all" class="btn btn-default btn-sm" style="margin-left: 1rem" title="Alt+Enter" data-toggle="tooltip">Test All Samples</button>';
		(async () => {
			const site$1 = await site;
			const doc = unsafeWindow.document;
			const pBottomMenu = init();
			pBottomMenu.then((bottomMenu) => {
				unsafeWindow.bottomMenu = bottomMenu;
			});
			await doneOrFail(pBottomMenu);
			unsafeWindow.codeRunner = codeRunner;
			doc.head.appendChild(html2element(hStyle));
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
				runTest(
					title,
					language,
					sourceCode,
					input,
					output = null,
					options2 = {
						trim: true,
						split: true,
					},
				) {
					this.disableButtons();
					const content = new ResultTabContent();
					const pTab = pBottomMenu.then((bottomMenu) =>
						bottomMenu.addTab(
							"easy-test-result-" + content.uid,
							`#${++this.runCount} ${title}`,
							content.element,
							{
								active: true,
								closeButton: true,
							},
						),
					);
					const pResult = codeRunner.run(language, sourceCode, input, output, options2);
					pResult
						.then((result) => {
							if (!result) return;
							content.result = result;
							if (result.status === "AC") {
								pTab.then((tab) => (tab.color = "#dff0d8"));
							} else if (result.status !== "OK") {
								pTab.then((tab) => (tab.color = "#fcf8e3"));
							}
						})
						.finally(() => {
							this.enableButtons();
						});
					return [pResult, pTab];
				},
			};
			unsafeWindow.atCoderEasyTest = atCoderEasyTest;
			{
				let runTest = function (title, input, output = null, options2 = {}) {
						const opts = Object.assign({ trim: true, split: true }, options2);
						if (eAllowableErrorCheck.checked) {
							opts.allowableError = parseFloat(eAllowableError.value);
						}
						return atCoderEasyTest.runTest(title, eLanguage.value, site$1.sourceCode, input, output, opts);
					},
					runAllCases = function (testcases) {
						const runGroupId = uuid();
						const pairs2 = testcases.map((testcase) =>
							runTest(testcase.title, testcase.input, testcase.output, { runGroupId }),
						);
						resultList.addResult(pairs2);
						return Promise.all(
							pairs2.map(([pResult, _pTab]) =>
								pResult.then((result) => {
									if (result.status === "AC") return Promise.resolve(result);
									else return Promise.reject(result);
								}),
							),
						);
					};
				const root = html2element(hRoot);
				const E = (id) => {
					const element = root.querySelector(`#atcoder-easy-test-${id}`);
					if (!element) throw new Error(`AtCoder Easy Test element not found: ${id}`);
					return element;
				};
				const eLanguage = E("language");
				const eInput = E("input");
				const eAllowableErrorCheck = E("allowable-error-check");
				const eAllowableError = E("allowable-error");
				const eOutput = E("output");
				const eRun = E("run");
				const eSetting = E("setting");
				events.on("enable", () => {
					eRun.classList.remove("disabled");
				});
				events.on("disable", () => {
					eRun.classList.add("disabled");
				});
				eSetting.addEventListener("click", () => {
					settings.open();
				});
				{
					let autoSelectLocalRunnerIfAvailable = function () {
						const currentOption = eLanguage.options[eLanguage.selectedIndex];
						if (currentOption && currentOption.text.includes("[Local]")) return;
						for (const option of Array.from(eLanguage.options)) {
							if (option.text.includes("[Local]")) {
								eLanguage.value = option.value;
								onEnvChange();
								log.debug("[LocalRunner] Auto-selected LocalRunner on editor change:", option.value);
								return;
							}
						}
					};
					let latestSetLanguageToken = 0;
					let isLocalServerPolling = false;
					async function onEnvChange() {
						const langSelection = config.get("langSelection", {});
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
							const langs = await codeRunner.getEnvironment(languageId, { refreshLocalRunner });
							if (currentToken !== latestSetLanguageToken) return;
							log.debug("getEnvironment:", languageId, `(${langs.length} candidates)`);
							const previousValue = eLanguage.value;
							const nextSignature = langs
								.map(([runnerId, label]) => `${runnerId}\x00${label}`)
								.join("\x01");
							if (eLanguage.dataset.envSignature !== nextSignature) {
								while (eLanguage.firstChild) eLanguage.removeChild(eLanguage.firstChild);
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
							const langSelection = config.get("langSelection", {});
							if (!langs.some(([runnerId, _]) => runnerId === nextValue)) {
								nextValue = "";
							}
							if (!nextValue && languageId in langSelection) {
								const prev = langSelection[languageId];
								if (langs.some(([runnerId, _]) => runnerId === prev)) {
									nextValue = prev;
								}
							}
							if (!nextValue && langs.length > 0) {
								nextValue = langs[0][0];
							}
							if (nextValue && eLanguage.value !== nextValue) {
								eLanguage.value = nextValue;
							}
							events.trig("enable");
						} catch (error) {
							if (currentToken !== latestSetLanguageToken) return;
							log.debug("getEnvironment failed:", languageId);
							log.error(error);
							eLanguage.dataset.envSignature = "";
							while (eLanguage.firstChild) eLanguage.removeChild(eLanguage.firstChild);
							const option = document.createElement("option");
							option.className = "fg-danger";
							option.textContent = String(error);
							eLanguage.appendChild(option);
							events.trig("disable");
						}
					}
					site$1.language.addListener(() => setLanguage());
					setInterval(async () => {
						if (isLocalServerPolling) return;
						isLocalServerPolling = true;
						try {
							const currentLangId = site$1.language.value;
							if (!currentLangId) return;
							const updated = await LocalRunner.update();
							if (updated) {
								await setLanguage(false);
							}
						} finally {
							isLocalServerPolling = false;
						}
					}, 5000);
					eAllowableError.disabled = !eAllowableErrorCheck.checked;
					eAllowableErrorCheck.addEventListener("change", () => {
						eAllowableError.disabled = !eAllowableErrorCheck.checked;
					});
					{
						let editorChangeHookCount = 0;
						const editorChangeHookMax = 40;
						const editorChangeHookTimer = setInterval(() => {
							editorChangeHookCount++;
							if (typeof unsafeWindow["ace"] !== "undefined") {
								clearInterval(editorChangeHookTimer);
								try {
									const editorEl = unsafeWindow.document.getElementById("editor");
									if (editorEl) {
										const aceEditor = unsafeWindow["ace"].edit(editorEl);
										aceEditor.getSession().on("change", autoSelectLocalRunnerIfAvailable);
										log.debug("[LocalRunner] Auto-select hook registered on editor");
									}
								} catch (e) {
									log.error("[LocalRunner] Failed to register auto-select hook:", e);
								}
							} else if (editorChangeHookCount >= editorChangeHookMax) {
								clearInterval(editorChangeHookTimer);
							}
						}, 500);
					}
				}
				eRun.addEventListener("click", (_event) => {
					const title = "Run";
					const input = eInput.value;
					const output = eOutput.value;
					runTest(title, input, output || null);
				});
				await doneOrFail(pBottomMenu.then((bottomMenu) => bottomMenu.addTab("easy-test", "Easy Test", root)));
				for (const testCase of site$1.testCases) {
					const eRunButton = html2element(hRunButton);
					eRunButton.addEventListener("click", async () => {
						const [pResult, pTab] = runTest(testCase.title, testCase.input, testCase.output);
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
				{
					const button = html2element(hTestAndSubmit);
					site$1.testButtonContainer.appendChild(button);
					const testAndSubmit = async () => {
						await runAllCases(site$1.testCases);
						site$1.submit();
					};
					button.addEventListener("click", testAndSubmit);
					events.on("testAndSubmit", testAndSubmit);
					events.on("disable", () => button.classList.add("disabled"));
					events.on("enable", () => button.classList.remove("disabled"));
				}
				{
					const button = html2element(hTestAllSamples);
					site$1.testButtonContainer.appendChild(button);
					const testAllSamples = () => runAllCases(site$1.testCases);
					button.addEventListener("click", testAllSamples);
					events.on("testAllSamples", testAllSamples);
					events.on("disable", () => button.classList.add("disabled"));
					events.on("enable", () => button.classList.remove("disabled"));
				}
			}
			try {
				const restoreButton = doc.createElement("a");
				restoreButton.className = "btn btn-danger btn-sm";
				restoreButton.textContent = "Restore Last Play";
				restoreButton.addEventListener("click", async () => {
					try {
						const lastCode = await codeSaver.restore(site$1.taskURI);
						if (
							site$1.sourceCode.length === 0 ||
							confirm("Your current code will be replaced. Are you sure?")
						) {
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
			config.registerFlag("ui.useKeyboardShortcut", true, "Use Keyboard Shortcuts");
			unsafeWindow.addEventListener("keydown", (event) => {
				if (config.get("ui.useKeyboardShortcut", true)) {
					if (event.key === "Enter" && event.ctrlKey) {
						events.trig("testAndSubmit");
					} else if (event.key === "Enter" && event.altKey) {
						events.trig("testAllSamples");
					} else if (event.key === "Escape" && event.altKey) {
						pBottomMenu.then((bottomMenu) => bottomMenu.toggle());
					}
				}
			});
		})();
	})();
})();
