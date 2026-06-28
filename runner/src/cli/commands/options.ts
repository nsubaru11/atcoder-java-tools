import {CliUsageError} from "./Command";

/**
 * 真偽値オプションを解釈する汎用ヘルパー。
 * 受け付ける形式:
 *   --flag            → true
 *   --flag=true       → true   （1 / yes / on も真）
 *   --flag=false      → false  （0 / no / off も偽）
 *   -x / -x=true ...  （shortName を渡した場合）
 *
 * arg がこのフラグでなければ undefined を返す（呼び出し側で次の判定に進める）。
 * 値が真偽として解釈できない場合は {@link CliUsageError} を投げる。
 *
 * オプションはコマンドごとに異なるため、どのフラグを受け付けるかは各コマンドが
 * このヘルパーを並べて宣言する（値の解釈という退屈な部分だけを共通化する）。
 */
export function parseBoolFlag(arg: string, longName: string, shortName?: string): boolean | undefined {
	const eq = arg.indexOf("=");
	const key = eq === -1 ? arg : arg.slice(0, eq);
	if (key !== longName && (shortName === undefined || key !== shortName)) return undefined;
	if (eq === -1) return true;
	const value = arg.slice(eq + 1).toLowerCase();
	if (["true", "1", "yes", "on"].includes(value)) return true;
	if (["false", "0", "no", "off"].includes(value)) return false;
	throw new CliUsageError(`Invalid boolean value for ${key}: "${arg.slice(eq + 1)}" (use true/false)`);
}

/**
 * 非負整数オプションを解釈する汎用ヘルパー。形式は `--name=N`（値必須）。
 * arg がこのフラグでなければ undefined。値が非負整数でなければ {@link CliUsageError} を投げる。
 */
export function parseIntFlag(arg: string, longName: string, shortName?: string): number | undefined {
	const eq = arg.indexOf("=");
	const key = eq === -1 ? arg : arg.slice(0, eq);
	if (key !== longName && (shortName === undefined || key !== shortName)) return undefined;
	const raw = eq === -1 ? "" : arg.slice(eq + 1);
	const n = Number(raw);
	if (raw === "" || !Number.isInteger(n) || n < 0) {
		throw new CliUsageError(`Invalid integer value for ${key}: "${raw}" (use a non-negative integer, e.g. ${key}=50)`);
	}
	return n;
}
