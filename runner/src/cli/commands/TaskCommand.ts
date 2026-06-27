import fs from "node:fs";
import path from "node:path";
import type {SamplePair, Task} from "../../types";
import {httpGetText, toCookieHeader} from "../atcoder";
import {extractSamples} from "../parser";
import {parseTask} from "../task";
import {ensureLocalRunnerReady} from "../ensureServer";
import {printSampleResults, runSampleTests, type SampleDisplayOptions} from "../sampleJudge";
import {readCachedSamples, writeCachedSamples} from "../sampleCache";
import {CliUsageError, type Command} from "./Command";
import {parseBoolFlag} from "./options";
import {prepareSource} from "./source";

// 短縮タスク指定（例: d, e, ex, d1）。AtCoder の問題記号は A〜H と Ex のみ。末尾の数字はファイル変種（D1.java 等）。
const SHORT_TASK_PATTERN = /^(ex|[a-z])\d*$/i;
// コンテストフォルダに見える名前（例: ABC463, typical90）。範囲フォルダ ABC451~475 や "src" は弾く。
const CONTEST_DIR_PATTERN = /^[A-Za-z]+\d+$/;

/** cwd から上方向に辿り、コンテストID（abcNNN 等）に見えるフォルダ名を小文字で返す。 */
function detectContestId(startDir: string): string {
	let dir = startDir;
	for (; ;) {
		if (CONTEST_DIR_PATTERN.test(path.basename(dir))) return path.basename(dir).toLowerCase();
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(
		`短縮表記のコンテスト名をフォルダ階層から特定できませんでした（abc463 のようなフォルダが見つからない）。\n` +
		`  フル指定してください: test <contestId>_<task> <File.java>`,
	);
}

/** cwd 内で <token>.java を大小無視で探し、実ファイル名（絶対パス）を返す。無ければ大文字版（相対）を返す。 */
function resolveShortSourceFile(token: string, cwd: string): string {
	const wanted = `${token}.java`.toLowerCase();
	try {
		const hit = fs.readdirSync(cwd).find((name) => name.toLowerCase() === wanted);
		if (hit) return path.join(cwd, hit);
	} catch {
		// ディレクトリ読み取り失敗時はフォールバックへ
	}
	return `${token.toUpperCase()}.java`;
}

/**
 * 短縮タスク指定（例: "d", "ex", "d1"）を {taskScreenName, sourceFilePath} に展開する。
 * - コンテストID: cwd から上の階層にある ABC463 等のフォルダ名を小文字化（URL はほぼ小文字なので統一）。
 * - タスク記号: 末尾の数字を除いた英字部分（"d1" → "d"）。サンプル取得・提出はこの記号で行う。
 * - ソースファイル: 入力どおりのトークン（数字込み）で cwd 内を大小無視検索（"d" → D.java, "d1" → D1.java）。
 */
export function expandShortTaskArg(token: string): { taskScreenName: string; sourceFilePath: string } {
	if (!SHORT_TASK_PATTERN.test(token)) {
		throw new Error(`短縮タスク指定が不正です: "${token}"（例: d, e, ex, d1）。フル指定なら2引数で。`);
	}
	const cwd = process.cwd();
	const contestId = detectContestId(cwd);
	const taskLetter = token.replace(/\d+$/, "").toLowerCase(); // 問題記号（末尾の数字は落とす）
	return {
		taskScreenName: `${contestId}_${taskLetter}`,
		sourceFilePath: resolveShortSourceFile(token, cwd),
	};
}

/**
 * サンプルケースを取得する。キャッシュにあればそれを使い、無ければ問題ページを
 * フェッチして抽出・保存する。サンプルは不変なので test → submit の二重取得を避けられる。
 */
async function getSamplesWithCache(task: Task, cookieHeader: string): Promise<SamplePair[]> {
	const cached = readCachedSamples(task);
	if (cached) return cached;
	const taskHtml = await httpGetText(task.taskUrl, cookieHeader);
	const samples = extractSamples(taskHtml);
	writeCachedSamples(task, samples);
	return samples;
}

/** サンプル実行を終えた時点で onSamplesComplete に渡すコンテキスト。 */
export type TaskRunContext = {
	task: Task;
	transformed: string;
	allAccepted: boolean;
	force: boolean;
};

/**
 * test / submit の共通テンプレート。
 * 「ソース整形 → サンプル取得 → ローカル実行 → 結果表示」までを担い、
 * その後の振る舞い（test は終了、submit は提出）をサブクラスの onSamplesComplete に委ねる。
 */
export abstract class TaskCommand implements Command {
	abstract readonly name: string;
	abstract readonly usageLines: readonly string[];
	/** -f/--force を受け付けるか（submit のみ true）。 */
	protected abstract readonly allowForce: boolean;
	/** DEBUG 有効化の既定値（test は true、submit は本番なので false）。-d/--debug で上書き可。 */
	protected abstract readonly debug: boolean;
	/** -d/--debug=true/false を受け付けるか（test のみ true。submit は本番なので不可）。 */
	protected readonly supportsDebugOption: boolean = false;
	/** --full / --wa-only の表示オプションを受け付けるか（test のみ true）。 */
	protected readonly supportsDisplayOptions: boolean = false;

	/** サンプル実行後の処理。終了コードを返す。 */
	protected abstract onSamplesComplete(ctx: TaskRunContext): Promise<number> | number;

	/** 引数を検証して Task・ソースパス・各オプションへ正規化する（短縮表記の展開もここで行う）。 */
	private validate(args: readonly string[]): {
		task: Task;
		sourceFilePath: string;
		force: boolean;
		debug: boolean;
		display: SampleDisplayOptions;
	} {
		const positionals: string[] = [];
		let force = false;
		let debug = this.debug; // 既定値。-d/--debug があれば上書き。
		const display: SampleDisplayOptions = {};
		for (const arg of args) {
			if (arg === "-f" || arg === "--force") {
				// test は提出しないので force を受け付けない。
				if (!this.allowForce) {
					throw new CliUsageError("-f/--force is only supported with the submit and tomain commands.");
				}
				force = true;
				continue;
			}
			if (this.supportsDebugOption) {
				const d = parseBoolFlag(arg, "--debug", "-d");
				if (d !== undefined) {
					debug = d;
					continue;
				}
			}
			if (this.supportsDisplayOptions) {
				const full = parseBoolFlag(arg, "--full");
				if (full !== undefined) {
					display.full = full;
					continue;
				}
				const waOnly = parseBoolFlag(arg, "--wa-only");
				if (waOnly !== undefined) {
					display.waOnly = waOnly;
					continue;
				}
			}
			if (arg.startsWith("-")) throw new CliUsageError(`Unknown option: ${arg}`);
			positionals.push(arg);
		}

		let taskScreenName: string | undefined;
		let sourceFilePath: string | undefined;
		if (positionals.length === 1) {
			// 短縮表記: test d → フォルダからコンテストを推定し test abc463_d D.java 相当へ展開
			({taskScreenName, sourceFilePath} = expandShortTaskArg(positionals[0]));
		} else {
			[taskScreenName, sourceFilePath] = positionals;
		}
		if (!taskScreenName || !sourceFilePath) {
			throw new CliUsageError();
		}
		return {task: parseTask(taskScreenName), sourceFilePath, force, debug, display};
	}

	async execute(args: readonly string[]): Promise<number> {
		const {task, sourceFilePath, force, debug, display} = this.validate(args);
		const {transformed, originalFileName, originalClassName} = prepareSource(sourceFilePath, debug);

		const cookieHeader = toCookieHeader();
		const samples = await getSamplesWithCache(task, cookieHeader);
		await ensureLocalRunnerReady();
		const sampleResults = await runSampleTests(transformed, samples);
		const allAccepted = printSampleResults(sampleResults, originalClassName, originalFileName, display);

		return this.onSamplesComplete({task, transformed, allAccepted, force});
	}
}
