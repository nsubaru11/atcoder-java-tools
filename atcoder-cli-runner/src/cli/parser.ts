import type {IndexedBlock, SamplePair, SubmitForm, Task} from "../types";
import {CLI_CONFIG} from "../shared/config";
import {normalizeNewlines} from "../shared/utils";

export function decodeHtmlEntities(text: string) {
	const named: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
		times: "x",
	};
	return text
		.replace(/<br\s*\/?\s*>/gi, "\n")
		.replace(/<\/p>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&([a-zA-Z]+);/g, (_, n) => named[n] ?? `&${n};`);
}

export function extractSamples(taskHtml: string): SamplePair[] {
	const inputRegex = /<h3[^>]*>\s*(?:入力例|Sample Input)\s*([0-9]+)?\s*<\/h3>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi;
	const outputRegex = /<h3[^>]*>\s*(?:出力例|Sample Output)\s*([0-9]+)?\s*<\/h3>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi;
	const inputs: IndexedBlock[] = [];
	const outputs: IndexedBlock[] = [];

	let m: RegExpExecArray | null;
	while ((m = inputRegex.exec(taskHtml)) !== null) {
		inputs.push({idx: m[1] ? Number(m[1]) : inputs.length + 1, text: decodeHtmlEntities(m[2])});
	}
	while ((m = outputRegex.exec(taskHtml)) !== null) {
		outputs.push({idx: m[1] ? Number(m[1]) : outputs.length + 1, text: decodeHtmlEntities(m[2])});
	}
	const uniqueInputs = dedupeIndexedBlocks(inputs);
	const uniqueOutputs = dedupeIndexedBlocks(outputs);
	uniqueInputs.sort((a, b) => a.idx - b.idx);
	uniqueOutputs.sort((a, b) => a.idx - b.idx);
	const len = Math.min(uniqueInputs.length, uniqueOutputs.length);
	if (len === 0) {
		throw new Error("No sample pairs were found on the task page.");
	}
	const pairs: SamplePair[] = [];
	for (let i = 0; i < len; i++) {
		pairs.push({
			index: i + 1,
			input: normalizeNewlines(uniqueInputs[i].text),
			expectedOutput: normalizeNewlines(uniqueOutputs[i].text),
		});
	}
	return dedupeSamplePairs(pairs);
}

function dedupeIndexedBlocks(blocks: IndexedBlock[]) {
	const set = new Set<string>();
	const result: IndexedBlock[] = [];
	for (const block of blocks) {
		const key = `${block.idx}\u0000${normalizeNewlines(block.text)}`;
		if (set.has(key)) continue;
		set.add(key);
		result.push(block);
	}
	return result;
}

function dedupeSamplePairs(pairs: SamplePair[]) {
	const set = new Set<string>();
	const result: SamplePair[] = [];
	for (const pair of pairs) {
		const key = `${pair.input}\u0000${pair.expectedOutput}`;
		if (set.has(key)) continue;
		set.add(key);
		result.push({...pair, index: result.length + 1});
	}
	return result;
}

export function extractCsrfToken(html: string) {
	const m = html.match(/name=["']csrf_token["']\s+value=["']([^"']+)["']/i);
	if (!m) throw new Error("csrf_token not found.");
	return m[1];
}

export function isAtCoderLoginPage(html: string) {
	if (!html) return false;
	return (
		/<title>\s*(?:ログイン|Login)\s*-\s*AtCoder\s*<\/title>/i.test(html) ||
		/name=["']username["']/i.test(html) ||
		/name=["']password["']/i.test(html) ||
		/\/login\?continue=/i.test(html) ||
		/ログインしてください/.test(html)
	);
}

export function extractLanguageOptionsFromSubmitPage(html: string) {
	const selectMatch = html.match(/<select[^>]*name=["']data\.LanguageId["'][^>]*>([\s\S]*?)<\/select>/i);
	if (!selectMatch) return [];
	const optionRegex = /<option\s+value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
	const options: Array<{ value: string; label: string }> = [];
	let m: RegExpExecArray | null;
	while ((m = optionRegex.exec(selectMatch[1])) !== null) {
		options.push({
			value: m[1].trim(),
			label: decodeHtmlEntities(m[2]).replace(/\s+/g, " ").trim(),
		});
	}
	return options;
}

export function chooseJavaLanguageIdFromOptions(options: Array<{ value: string; label: string }>) {
	if (!options.length) return "";
	const normalized = options.map((o) => ({...o, lower: o.label.toLowerCase()}));
	const priority = [
		(l: string) => /java/.test(l) && /(24\.0\.2|24)/.test(l),
		(l: string) => /java/.test(l) && /openjdk/.test(l),
		(l: string) => /java/.test(l),
	];
	for (const rule of priority) {
		const found = normalized.find((o) => rule(o.lower));
		if (found) return found.value;
	}
	return "";
}

export function extractSubmitForm(submitPageHtml: string, task: Task): SubmitForm {
	const formMatch = submitPageHtml.match(/<form[^>]*class=["'][^"']*form-code-submit[^"']*["'][^>]*>[\s\S]*?<\/form>/i)
		|| submitPageHtml.match(/<form[^>]*id=["']submit-form["'][^>]*>[\s\S]*?<\/form>/i)
		|| submitPageHtml.match(/<form[^>]*action=["'][^"']*\/submit[^"']*["'][^>]*>[\s\S]*?<\/form>/i);
	if (!formMatch) {
		throw new Error("Submit form was not found on submit page.");
	}
	const formHtml = formMatch[0];
	const actionMatch = formHtml.match(/\saction=["']([^"']+)["']/i);
	const actionPath = actionMatch ? decodeHtmlEntities(actionMatch[1]) : `/contests/${task.contestId}/submit`;
	const actionUrl = actionPath.startsWith("http") ? actionPath : `https://atcoder.jp${actionPath}`;

	const formValues = new Map<string, string>();
	const inputRegex = /<input\b([^>]*)>/gi;
	let m: RegExpExecArray | null;
	while ((m = inputRegex.exec(formHtml)) !== null) {
		const attrs = m[1] || "";
		if (/\sdisabled(?:\s|>|$)/i.test(attrs)) continue;
		const nameMatch = attrs.match(/\sname=["']([^"']+)["']/i);
		if (!nameMatch) continue;
		const typeMatch = attrs.match(/\stype=["']([^"']+)["']/i);
		const type = (typeMatch ? typeMatch[1] : "text").toLowerCase();
		if (type === "checkbox" || type === "radio") {
			if (!/\schecked(?:\s|>|$)/i.test(attrs)) continue;
		}
		const valueMatch = attrs.match(/\svalue=["']([\s\S]*?)["']/i);
		formValues.set(nameMatch[1], decodeHtmlEntities(valueMatch ? valueMatch[1] : ""));
	}

	const textareaRegex = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi;
	while ((m = textareaRegex.exec(formHtml)) !== null) {
		const attrs = m[1] || "";
		if (/\sdisabled(?:\s|>|$)/i.test(attrs)) continue;
		const nameMatch = attrs.match(/\sname=["']([^"']+)["']/i);
		if (!nameMatch) continue;
		formValues.set(nameMatch[1], decodeHtmlEntities(m[2] || ""));
	}

	const selectRegex = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
	while ((m = selectRegex.exec(formHtml)) !== null) {
		const attrs = m[1] || "";
		if (/\sdisabled(?:\s|>|$)/i.test(attrs)) continue;
		const nameMatch = attrs.match(/\sname=["']([^"']+)["']/i);
		if (!nameMatch) continue;
		const optionsHtml = m[2] || "";
		const selected = optionsHtml.match(/<option\b[^>]*selected[^>]*value=["']([^"']+)["'][^>]*>/i)
			|| optionsHtml.match(/<option\b[^>]*value=["']([^"']+)["'][^>]*selected[^>]*>/i)
			|| optionsHtml.match(/<option\b[^>]*value=["']([^"']+)["'][^>]*>/i);
		formValues.set(nameMatch[1], selected ? decodeHtmlEntities(selected[1]) : "");
	}

	return {actionUrl, formValues};
}

export function extractSubmissionIdFromHtml(html: string, contestId: string) {
	if (!html) return "";
	const direct = html.match(/\/contests\/[^/]+\/submissions\/(\d+)/);
	if (direct) return direct[1];
	const dataId = html.match(/<tr[^>]*\sdata-id=["'](\d+)["']/i);
	if (dataId) return dataId[1];
	const meRow = html.match(new RegExp(`/contests/${contestId}/submissions/(\\d+)`));
	if (meRow) return meRow[1];
	return "";
}

export function stripTags(html: string) {
	return decodeHtmlEntities(html).replace(/\s+/g, " ").trim();
}

export function parseSubmissionStatus(html: string) {
	const patterns = [
		/<span[^>]*data-title=["']Status["'][^>]*>([\s\S]*?)<\/span>/i,
		/<td[^>]*id=["']judge-status["'][^>]*>([\s\S]*?)<\/td>/i,
		/<td[^>]*>\s*<span[^>]*class=["'][^"']*label[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<\/td>/i,
	];
	for (const p of patterns) {
		const m = html.match(p);
		if (m) {
			const status = stripTags(m[1]).replace(/\s+/g, "");
			if (status) return status;
		}
	}
	return "";
}

function escapeRegExp(text: string) {
	return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMetricByDataTitle(html: string, labelCandidates: string[]) {
	for (const label of labelCandidates) {
		const pattern = new RegExp(`data-title=["']${escapeRegExp(label)}["'][^>]*>([\\s\\S]*?)<\\/td>`, "i");
		const m = html.match(pattern);
		if (m) {
			const value = stripTags(m[1]);
			if (value) return value;
		}
	}
	return "";
}

function parseMetricByHeaderRow(html: string, labelCandidates: string[]) {
	for (const label of labelCandidates) {
		const pattern = new RegExp(`<tr[^>]*>[\\s\\S]*?<th[^>]*>\\s*${escapeRegExp(label)}\\s*<\\/th>[\\s\\S]*?<td[^>]*>([\\s\\S]*?)<\\/td>[\\s\\S]*?<\\/tr>`, "i");
		const m = html.match(pattern);
		if (m) {
			const value = stripTags(m[1]);
			if (value) return value;
		}
	}
	return "";
}

export function parseExecAndMemory(html: string) {
	const execTime = parseMetricByDataTitle(html, CLI_CONFIG.submissionExecTimeLabels)
		|| parseMetricByHeaderRow(html, CLI_CONFIG.submissionExecTimeLabels);
	const memory = parseMetricByDataTitle(html, CLI_CONFIG.submissionMemoryLabels)
		|| parseMetricByHeaderRow(html, CLI_CONFIG.submissionMemoryLabels);
	return {
		execTime,
		memory,
	};
}

export function extractSubmitFailureReason(html: string) {
	if (!html) return "";
	const patterns = [
		/<div[^>]*class=["'][^"']*alert-danger[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
		/<p[^>]*class=["'][^"']*text-danger[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
		/<li[^>]*class=["'][^"']*error[^"']*["'][^>]*>([\s\S]*?)<\/li>/i,
	];
	for (const pattern of patterns) {
		const m = html.match(pattern);
		if (!m) continue;
		const text = stripTags(m[1]).replace(/\s+/g, " ").trim();
		if (text) return text;
	}
	return "";
}
