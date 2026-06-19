export const CLI_COMMANDS = ["test", "submit", "tomain", "localtest", "serve", "run", "stop"] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

export type Task = {
	contestId: string;
	taskScreenName: string;
	taskUrl: string;
	submitUrl: string;
	submitPostUrl: string;
};

export type IndexedBlock = {
	idx: number;
	text: string;
};

export type SamplePair = {
	index: number;
	input: string;
	expectedOutput?: string;
};

export type SubmitForm = {
	actionUrl: string;
	formValues: Map<string, string>;
};

export type SubmitResult = {
	submissionId: string;
	submissionUrl: string;
	trackingUnavailable?: boolean;
};

export type SubmissionFinalResult = {
	status: string;
	execTime: string;
	memory: string;
};

export type SampleResult = {
	index: number;
	status: string;
	execTime: number;
	memoryKb: number;
	runnerStatus: string;
	exitCode: number;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
	stderr: string;
	actualOutput: string;
	expectedOutput: string;
};

export type CompileEntry = {
	rootDir: string;
	classDir: string;
	mainClass: string;
	requiresIsolatedProcess: boolean;
	status: "compiled" | "error";
	error: string | null;
};

export type ProcessResult = {
	code: number;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};

export type DispatcherRunResult = {
	kind: "run";
	exitCode?: number;
	time?: number;
	stdout?: string;
	stderr?: string;
	stdoutTruncated?: boolean;
	stderrTruncated?: boolean;
	timedOut?: boolean;
	error?: string;
};
