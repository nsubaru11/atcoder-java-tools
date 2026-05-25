import type {EasyTestStatus} from "./local-runner";

export type EasyTestRunResult = {
	status: string;
	output: string;
	error?: string;
	execTime?: number;
};

export type EasyTestJudgeResult = {
	status: string;
	output: string;
	expectedOutput: string;
};

export type EasyTestJudgeOptions = {
	trim?: boolean;
	split?: boolean;
	allowableError?: number;
};

const FLOAT_PATTERN = /^[-+]?[0-9]*\.[0-9]+([eE][-+]?[0-9]+)?$/;

export function evaluateEasyTestOutput(
	runResult: EasyTestRunResult,
	expectedOutput: string,
	options: EasyTestJudgeOptions = {trim: true, split: true},
): EasyTestJudgeResult {
	const status = runResult.status;
	if (status !== "OK" || typeof expectedOutput !== "string") {
		return {status, output: runResult.output || "", expectedOutput};
	}

	let output = runResult.output || "";
	let expected = expectedOutput;
	if (options.trim) {
		expected = expected.trim();
		output = output.trim();
	}

	let equals = (x: string, y: string): boolean => x === y;
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

	const judgedStatus: EasyTestStatus = equals(output, expected) ? "AC" : "WA";
	return {status: judgedStatus, output, expectedOutput: expected};
}
