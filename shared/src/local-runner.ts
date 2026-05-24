export type LocalRunnerStatus =
	| "success"
	| "compileError"
	| "timeLimitExceeded"
	| "runtimeError"
	| "internalError"
	| "badRequest";

export type EasyTestStatus = "OK" | "AC" | "WA" | "RE" | "TLE" | "CE" | "IE";

export type LocalRunnerCompilerInfo = {
	language: string;
	compilerName: string;
	label: string;
};

export type LocalRunnerListRequest = {
	mode: "list";
};

export type LocalRunnerPrecompileRequest = {
	mode: "precompile";
	sourceCode: string;
};

export type LocalRunnerRunRequest = {
	mode: "run";
	compilerName?: string;
	sourceCode: string;
	stdin?: string;
};

export type LocalRunnerRequest =
	| LocalRunnerListRequest
	| LocalRunnerPrecompileRequest
	| LocalRunnerRunRequest;

export type LocalRunnerRunResponse = {
	status: LocalRunnerStatus;
	exitCode: number;
	stdout: string;
	stderr: string;
	time: number;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
	memory: number;
};

export type LocalRunnerPrecompileResponse = {
	status: "accepted";
};

export type LocalRunnerBadRequestResponse = {
	status: "badRequest" | "internalError";
	stderr: string;
};

export function isHttpUrl(value: string): boolean {
	return /^https?:\/\//.test(value);
}

export function buildLocalRunnerKey(info: LocalRunnerCompilerInfo): string {
	return `${info.language} ${info.compilerName} ${info.label}`;
}

export function buildLocalRunnerListRequest(): LocalRunnerListRequest {
	return {mode: "list"};
}

export function buildLocalRunnerPrecompileRequest(sourceCode: string): LocalRunnerPrecompileRequest {
	return {
		mode: "precompile",
		sourceCode,
	};
}

export function buildLocalRunnerRunRequest(
	sourceCode: string,
	stdin: string,
	compilerName?: string,
): LocalRunnerRunRequest {
	return {
		mode: "run",
		compilerName,
		sourceCode,
		stdin,
	};
}

export function toEasyTestStatus(status: LocalRunnerStatus, exitCode = 0): EasyTestStatus {
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
