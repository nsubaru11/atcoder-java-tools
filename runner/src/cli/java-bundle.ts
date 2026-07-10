import fs from "node:fs";
import path from "node:path";
import {createMaskedCode, normalizeNewlines} from "@atcoder-tools/shared";

/**
 * Java ソースの「ライブラリ展開（バンドル）」。
 *
 * 解答ファイル中の `import lib.～;` を競プロライブラリの
 * ソースツリー（library/src）に対して解決し、依存クラスを推移的にインラインした
 * 単一ファイル（AtCoder 提出可能な形式）を生成する。
 *
 * - lib ファイル内の同一パッケージ兄弟クラス参照（import 不要な参照）は、
 *   識別子スキャンで検出して自動的にインライン対象へ含める。
 * - lib ファイルが持つ java.* などの import はバンドル先頭へ巻き上げて重複排除する。
 * - インラインされるトップレベル型からは `public` 修飾子を除去する
 *   （提出ファイルで public になれるのは Main だけのため）。
 *
 * 制約（明確なエラーにする）:
 * - `import static lib.～` は展開後に文法上表現できないため不可（クラス修飾呼び出しを使う）。
 * - 本文中の `lib.ds.UnionFind` のような FQN 参照は package 除去後に壊れるため不可。
 * - インライン結果でトップレベル型の単純名が衝突する場合は不可。
 */

/** バンドル対象として解決するルートパッケージ名。 */
const LIB_ROOT_PACKAGES: readonly string[] = ["lib"];

export type BundleOptions = {
	/** ライブラリの src ルート（直下に lib/ を含むディレクトリ）。 */
	libSrcRoot: string;
};

export type BundleResult = {
	bundled: string;
	/** lib.* の import が 1 つも無ければ false（入力をそのまま返す）。 */
	usedLibrary: boolean;
	/** インラインしたファイルの FQCN 相当（例: "lib.ds.UnionFind"）。展開順。 */
	inlined: string[];
};

/** バンドル失敗（原因をユーザーに伝えるためのメッセージ付き）。 */
export class BundleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BundleError";
	}
}

type ImportStatement = {
	/** ソース上の開始位置（行頭側の空白は含まない）。 */
	start: number;
	/** `;` の次の位置（直後の改行 1 つを含む）。 */
	end: number;
	/** import 対象（例: "lib.ds.UnionFind", "java.util.*"）。 */
	name: string;
	isStatic: boolean;
	/** 正規化テキスト（例: "import java.util.*;"）。巻き上げ時の重複排除キー。 */
	normalized: string;
};

type ParsedJavaFile = {
	/** 改行正規化済みソース。 */
	code: string;
	masked: string;
	/** package 宣言の [start, end)（直後の改行 1 つを含む）。無ければ null。 */
	packageSpan: { start: number; end: number; name: string } | null;
	imports: ImportStatement[];
	/** トップレベル型宣言（brace 深度 0）の名前一覧。 */
	topLevelTypes: string[];
	/** トップレベル型に付いた `public` 修飾子の [start, end)（後続空白込み）。 */
	publicModifierSpans: Array<{ start: number; end: number }>;
};

const IMPORT_REGEX = /(?<=^|[\n;}])[ \t]*import\s+(static\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\.\*)?)\s*;/g;
const PACKAGE_REGEX = /(?<=^|\n)[ \t]*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/;
const TYPE_DECL_REGEX = /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g;
const PUBLIC_TYPE_REGEX = /\bpublic\s+(?=(?:(?:final|abstract|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record|@\s*interface)\b)/g;

/** masked コード全体の brace 深度プレフィックス配列（depth[i] = 位置 i の直前までの深度）。 */
function buildBraceDepth(masked: string): Int32Array {
	const depth = new Int32Array(masked.length + 1);
	let d = 0;
	for (let i = 0; i < masked.length; i++) {
		depth[i] = d;
		if (masked[i] === "{") d++;
		else if (masked[i] === "}") d--;
	}
	depth[masked.length] = d;
	return depth;
}

/** span 末尾の直後に改行が 1 つあれば取り込む（行ごと削除するため）。 */
function extendPastNewline(code: string, end: number): number {
	if (code[end] === "\r") end++;
	if (code[end] === "\n") end++;
	return end;
}

function parseJavaFile(rawCode: string): ParsedJavaFile {
	const code = normalizeNewlines(rawCode);
	const masked = createMaskedCode(code);
	const depth = buildBraceDepth(masked);

	const packageMatch = PACKAGE_REGEX.exec(masked);
	const packageSpan = packageMatch
		? {
			start: packageMatch.index,
			end: extendPastNewline(code, packageMatch.index + packageMatch[0].length),
			name: packageMatch[1],
		}
		: null;

	const imports: ImportStatement[] = [];
	IMPORT_REGEX.lastIndex = 0;
	let im: RegExpExecArray | null;
	while ((im = IMPORT_REGEX.exec(masked)) !== null) {
		if (depth[im.index] !== 0) continue; // 文字列やネスト内は masked 済みだが念のため
		const isStatic = !!im[1];
		const name = im[2];
		imports.push({
			start: im.index,
			end: extendPastNewline(code, im.index + im[0].length),
			name,
			isStatic,
			normalized: `import ${isStatic ? "static " : ""}${name};`,
		});
	}

	const topLevelTypes: string[] = [];
	TYPE_DECL_REGEX.lastIndex = 0;
	let tm: RegExpExecArray | null;
	while ((tm = TYPE_DECL_REGEX.exec(masked)) !== null) {
		if (depth[tm.index] === 0) topLevelTypes.push(tm[1]);
	}

	const publicModifierSpans: Array<{ start: number; end: number }> = [];
	PUBLIC_TYPE_REGEX.lastIndex = 0;
	let pm: RegExpExecArray | null;
	while ((pm = PUBLIC_TYPE_REGEX.exec(masked)) !== null) {
		if (depth[pm.index] === 0) publicModifierSpans.push({start: pm.index, end: pm.index + pm[0].length});
	}

	return {code, masked, packageSpan, imports, topLevelTypes, publicModifierSpans};
}

function isLibImport(name: string): boolean {
	const root = name.split(".", 1)[0];
	return LIB_ROOT_PACKAGES.includes(root);
}

/** import 名（例: "lib.ds.UnionFind" / "lib.ds.*"）を実ファイル群へ解決する。 */
function resolveImportFiles(name: string, libSrcRoot: string): string[] {
	const segments = name.split(".");
	const last = segments[segments.length - 1];
	if (last === "*") {
		const dir = path.join(libSrcRoot, ...segments.slice(0, -1));
		if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
			throw new BundleError(`ライブラリパッケージが見つかりません: ${name}（探した場所: ${dir}）`);
		}
		return fs.readdirSync(dir)
			.filter((f) => f.endsWith(".java"))
			.sort()
			.map((f) => path.join(dir, f));
	}
	// 通常は lib.ds.UnionFind → lib/ds/UnionFind.java。
	// ネストクラス import（lib.ds.UnionFind.Node）にも対応するため、後ろから順にファイル候補を探す。
	for (let k = segments.length - 1; k >= 1; k--) {
		const candidate = path.join(libSrcRoot, ...segments.slice(0, k), `${segments[k]}.java`);
		if (fs.existsSync(candidate)) return [candidate];
	}
	const expected = path.join(libSrcRoot, ...segments.slice(0, -1), `${last}.java`);
	throw new BundleError(`ライブラリクラスが見つかりません: ${name}（想定ファイル: ${expected}）`);
}

/** ファイルパス → "lib.ds.UnionFind" 形式の表示名。 */
function toFqcn(filePath: string, libSrcRoot: string): string {
	const rel = path.relative(libSrcRoot, filePath).replace(/\.java$/i, "");
	return rel.split(path.sep).join(".");
}

/** 本文（package/import を除いた範囲）に lib.* の FQN 参照が残っていないか検査する。 */
function assertNoFqnUsage(parsed: ParsedJavaFile, label: string): void {
	const excluded: Array<{ start: number; end: number }> = [];
	if (parsed.packageSpan) excluded.push(parsed.packageSpan);
	for (const imp of parsed.imports) excluded.push(imp);

	const fqnRegex = new RegExp(`\\b(?:${LIB_ROOT_PACKAGES.join("|")})\\.[A-Za-z_$]`, "g");
	let m: RegExpExecArray | null;
	while ((m = fqnRegex.exec(parsed.masked)) !== null) {
		const idx = m.index;
		if (excluded.some((s) => idx >= s.start && idx < s.end)) continue;
		const line = parsed.masked.slice(0, idx).split("\n").length;
		throw new BundleError(
			`${label} の ${line} 行目に lib.* の FQN 参照があります。` +
			`バンドル後は package が消えるため、import + 単純名で参照してください。`,
		);
	}
}

/** lib ファイル 1 つをインライン用に変換する（package/import 除去 + トップレベル public 除去）。 */
function transformLibFile(parsed: ParsedJavaFile): string {
	const edits: Array<{ start: number; end: number; text: string }> = [];
	if (parsed.packageSpan) edits.push({...parsed.packageSpan, text: ""});
	for (const imp of parsed.imports) edits.push({start: imp.start, end: imp.end, text: ""});
	for (const span of parsed.publicModifierSpans) edits.push({...span, text: ""});
	edits.sort((a, b) => b.start - a.start);
	let code = parsed.code;
	for (const e of edits) {
		code = code.slice(0, e.start) + e.text + code.slice(e.end);
	}
	return code.trim();
}

type QueueEntry = {
	filePath: string;
	fqcn: string;
};

/**
 * 解答ソース中の lib.* import を解決し、依存クラスを推移的にインラインした
 * 単一ファイルのソースを返す。lib import が無ければ入力をそのまま返す。
 */
export function bundleJavaSource(source: string, options: BundleOptions): BundleResult {
	const solution = parseJavaFile(source);
	const solutionLibImports = solution.imports.filter((imp) => isLibImport(imp.name));
	if (solutionLibImports.length === 0) {
		return {bundled: source, usedLibrary: false, inlined: []};
	}

	const libSrcRoot = path.resolve(options.libSrcRoot);
	if (!fs.existsSync(path.join(libSrcRoot, "lib"))) {
		throw new BundleError(`ライブラリの src ルートが不正です（lib/ がありません）: ${libSrcRoot}`);
	}

	for (const imp of solutionLibImports) {
		if (imp.isStatic) {
			throw new BundleError(
				`static import はバンドルできません: ${imp.normalized}\n` +
				`  展開後は package が無くなり static import を書けないため、クラス名で修飾して呼び出してください。`,
			);
		}
	}
	assertNoFqnUsage(solution, "解答ソース");

	// BFS: 解答の lib import から出発し、lib ファイル自身の lib import と
	// 同一パッケージ兄弟クラス参照（識別子スキャン）を辿って全依存を集める。
	const visited = new Set<string>();
	const queue: QueueEntry[] = [];
	const enqueue = (filePath: string) => {
		const resolved = path.resolve(filePath);
		if (visited.has(resolved)) return;
		visited.add(resolved);
		queue.push({filePath: resolved, fqcn: toFqcn(resolved, libSrcRoot)});
	};

	for (const imp of solutionLibImports) {
		for (const file of resolveImportFiles(imp.name, libSrcRoot)) enqueue(file);
	}

	const inlinedParts: string[] = [];
	const inlinedFqcns: string[] = [];
	const hoistedImports: string[] = [];
	const hoistedSeen = new Set<string>();
	const topLevelTypeOwners = new Map<string, string>();

	for (const name of solution.topLevelTypes) topLevelTypeOwners.set(name, "解答ソース");

	for (let qi = 0; qi < queue.length; qi++) {
		const {filePath, fqcn} = queue[qi];
		let raw: string;
		try {
			raw = fs.readFileSync(filePath, "utf8");
		} catch (error) {
			throw new BundleError(`ライブラリファイルを読み込めません: ${filePath}（${String(error)}）`);
		}
		const parsed = parseJavaFile(raw);
		assertNoFqnUsage(parsed, fqcn);

		for (const imp of parsed.imports) {
			if (isLibImport(imp.name)) {
				if (imp.isStatic) {
					throw new BundleError(`static import はバンドルできません（${fqcn} 内）: ${imp.normalized}`);
				}
				for (const file of resolveImportFiles(imp.name, libSrcRoot)) enqueue(file);
			} else if (!hoistedSeen.has(imp.normalized)) {
				hoistedSeen.add(imp.normalized);
				hoistedImports.push(imp.normalized);
			}
		}

		// 同一パッケージの兄弟クラス参照（import 不要）を識別子スキャンで検出する。
		// 過剰検出しても未使用クラスが 1 つ増えるだけで、正しさには影響しない。
		const dir = path.dirname(filePath);
		const ownBase = path.basename(filePath, ".java");
		for (const sibling of fs.readdirSync(dir)) {
			if (!sibling.endsWith(".java")) continue;
			const base = path.basename(sibling, ".java");
			if (base === ownBase) continue;
			const refRegex = new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
			if (refRegex.test(parsed.masked)) enqueue(path.join(dir, sibling));
		}

		for (const typeName of parsed.topLevelTypes) {
			const owner = topLevelTypeOwners.get(typeName);
			if (owner) {
				throw new BundleError(
					`トップレベル型の単純名が衝突します: ${typeName}（${owner} と ${fqcn}）。` +
					`どちらか一方のみを import するか、解答側のクラス名を変えてください。`,
				);
			}
			topLevelTypeOwners.set(typeName, fqcn);
		}

		inlinedParts.push(`// ===== inlined: ${fqcn} =====\n${transformLibFile(parsed)}`);
		inlinedFqcns.push(fqcn);
	}

	// 解答側の編集: lib import を除去し、先頭の lib import 位置に巻き上げ import を挿入する。
	const solutionImportSet = new Set(solution.imports.map((imp) => imp.normalized));
	const importsToInsert = hoistedImports.filter((line) => !solutionImportSet.has(line));

	const edits: Array<{ start: number; end: number; text: string }> = solutionLibImports.map((imp, i) => ({
		start: imp.start,
		end: imp.end,
		text: i === 0 && importsToInsert.length > 0 ? `${importsToInsert.join("\n")}\n` : "",
	}));
	edits.sort((a, b) => b.start - a.start);
	let solutionCode = solution.code;
	for (const e of edits) {
		solutionCode = solutionCode.slice(0, e.start) + e.text + solutionCode.slice(e.end);
	}

	const bundled = `${solutionCode.trimEnd()}\n\n${inlinedParts.join("\n\n")}\n`;
	return {bundled, usedLibrary: true, inlined: inlinedFqcns};
}

/**
 * ソースが lib.* の import を含むかの軽量判定（バンドル要否の事前チェック用）。
 * コメント・文字列内の誤検出を避けるためマスクしてから調べる。
 */
export function hasLibImports(source: string): boolean {
	const masked = createMaskedCode(normalizeNewlines(source));
	IMPORT_REGEX.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = IMPORT_REGEX.exec(masked)) !== null) {
		if (isLibImport(m[2])) return true;
	}
	return false;
}
