// ==UserScript==
// @name           AtCoder Markdown Copier
// @name:en        AtCoder Markdown Copier
// @namespace      https://github.com/nsubaru11/AtCoder/tools/userscripts
// @version        1.0.2
// @description    AtCoderの問題文をMarkdown形式でコピーする機能を追加します。
// @description:en Adds functionality to copy AtCoder problem statements in Markdown format.
// @description:ja AtCoderの問題文をMarkdown形式でコピーする機能を追加します。
// @author         nsubaru
// @license        MIT
// @homepageURL    https://github.com/nsubaru11/AtCoder/tree/main/tools/userscripts/AtCoderMarkdownCopier
// @supportURL     https://github.com/nsubaru11/AtCoder/issues
// @match          https://atcoder.jp/contests/*/tasks/*
// @grant          GM_setClipboard
// @require        https://unpkg.com/turndown/dist/turndown.js
// @require        https://unpkg.com/turndown-plugin-gfm/dist/turndown-plugin-gfm.js
// @icon           https://atcoder.jp/favicon.ico
// @updateURL      https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderMarkdownCopier/dist/AtCoderMarkdownCopier.user.js
// @downloadURL    https://raw.githubusercontent.com/nsubaru11/AtCoder/main/tools/userscripts/AtCoderMarkdownCopier/dist/AtCoderMarkdownCopier.user.js
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

	// AtCoderMarkdownCopier/src/main.ts
	var exports_main = {};
	var turndownService = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	});
	turndownService.use(turndownPluginGfm.gfm);
	turndownService.addRule("math", {
		filter: "var",
		replacement: function (content) {
			return `$${content}$`;
		},
	});
	turndownService.addRule("pre", {
		filter: "pre",
		replacement: function (content) {
			return `
\`\`\`text
${content.trim()}
\`\`\`
`;
		},
	});
	turndownService.addRule("listItem", {
		filter: "li",
		replacement: function (content, node, options) {
			content = content
				.replace(/^\n+/, "")
				.replace(
					/\n+$/,
					`
`,
				)
				.replace(
					/\n/gm,
					`
  `,
				);
			let prefix = options.bulletListMarker + " ";
			const parent = node.parentNode;
			if (parent && parent.nodeName === "OL") {
				const start = parent.getAttribute("start");
				const index = Array.prototype.indexOf.call(parent.children, node);
				prefix = (start ? Number(start) + index : index + 1) + ". ";
			}
			return (
				prefix +
				content +
				(node.nextSibling && !/\n$/.test(content)
					? `
`
					: "")
			);
		},
	});
	function getCleanElement(element) {
		const clone = element.cloneNode(true);
		clone.querySelectorAll(".btn, .btn-copy, .btn-pre, .div-btn-copy").forEach((el) => el.remove());
		return clone;
	}
	function getMarkdownFromElement(element) {
		const cleanEl = getCleanElement(element);
		return turndownService.turndown(cleanEl.innerHTML);
	}
	function createButton(text, onClick) {
		const btn = document.createElement("button");
		btn.textContent = text;
		btn.className = "btn btn-default btn-sm";
		btn.style.marginLeft = "10px";
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			onClick();
			const originalText = btn.textContent;
			btn.textContent = "Copied!";
			setTimeout(() => {
				btn.textContent = originalText;
			}, 1500);
		});
		return btn;
	}
	function main() {
		const statementContainer = document.getElementById("task-statement");
		if (!statementContainer) return;
		const activeLangContainer =
			Array.from(statementContainer.querySelectorAll(".lang-ja, .lang-en")).find(
				(el) => getComputedStyle(el).display !== "none",
			) || statementContainer;
		const parts = activeLangContainer.querySelectorAll(".part section");
		const SAMPLE_KEYWORDS = ["入力例", "出力例", "Sample Input", "Sample Output"];
		parts.forEach((section) => {
			const header = section.querySelector("h3");
			if (!header) return;
			const title = header.textContent || "";
			if (SAMPLE_KEYWORDS.some((kw) => title.includes(kw))) return;
			const copyBtn = createButton("Copy", () => {
				const markdown = getMarkdownFromElement(section);
				GM_setClipboard(markdown);
			});
			header.appendChild(copyBtn);
		});
		const taskTitle = document.querySelector(".h2") || document.querySelector("h2");
		if (taskTitle) {
			const wrap = document.createElement("span");
			wrap.className = "pull-right";
			wrap.style.fontSize = "14px";
			const getFullMarkdown = () => {
				const cloneTitle = taskTitle.cloneNode(true);
				cloneTitle.querySelectorAll(".btn, .pull-right").forEach((el) => el.remove());
				let fullMarkdown = `# ${cloneTitle.textContent?.trim() || "Task"}

`;
				fullMarkdown += `URL: ${window.location.href}

`;
				for (const section of Array.from(parts)) {
					const header = section.querySelector("h3");
					if (header) {
						const title = header.textContent || "";
						if (SAMPLE_KEYWORDS.some((kw) => title.includes(kw))) {
							break;
						}
					}
					fullMarkdown +=
						getMarkdownFromElement(section) +
						`

`;
				}
				return fullMarkdown.trim();
			};
			const copyAllBtn = createButton("All Copy", () => {
				GM_setClipboard(getFullMarkdown());
			});
			wrap.appendChild(copyAllBtn);
			taskTitle.appendChild(wrap);
		}
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", main);
	} else {
		main();
	}
})();
