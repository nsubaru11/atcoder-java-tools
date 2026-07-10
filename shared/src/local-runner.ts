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

export type LocalRunnerTransformRequest = {
	mode: "transform";
	sourceCode: string;
	debug?: boolean;
	autoImport?: boolean;
	validate?: boolean;
};

export type LocalRunnerRunRequest = {
	mode: "run";
	compilerName?: string;
	sourceCode: string;
	stdin?: string;
	prepared?: boolean;
};

export type LocalRunnerRequest =
	| LocalRunnerListRequest
	| LocalRunnerPrecompileRequest
	| LocalRunnerTransformRequest
	| LocalRunnerRunRequest;

export type LocalRunnerTransformResponse = {
	status: "success" | "compileError";
	sourceCode: string;
	diagnostics: string;
	inlinedClasses: string[];
	addedImports: string[];
	diagnosticItems: CompilerDiagnostic[];
};

export type CompilerDiagnostic = {
	kind: string;
	line: number;
	column: number;
	code: string;
	message: string;
};

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

export function buildLocalRunnerTransformRequest(
	sourceCode: string,
	debug = false,
	autoImport = true,
	validate = true,
): LocalRunnerTransformRequest {
	return {mode: "transform", sourceCode, debug, autoImport, validate};
}

export function buildLocalRunnerRunRequest(
	sourceCode: string,
	stdin: string,
	compilerName?: string,
	prepared = false,
): LocalRunnerRunRequest {
	return {
		mode: "run",
		compilerName,
		sourceCode,
		stdin,
		prepared,
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
