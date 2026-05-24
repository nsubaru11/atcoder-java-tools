export type CliCommand = "test" | "submit";

export interface Task {
	contestId: string;
	taskScreenName: string;
	taskUrl: string;
	submitUrl: string;
	submitPostUrl: string;
}

export interface IndexedBlock {
	idx: number;
	text: string;
}

export interface SamplePair {
	index: number;
	input: string;
	expectedOutput: string;
}

export interface SubmitForm {
	actionUrl: string;
	formValues: Map<string, string>;
}

export interface SubmitResult {
	submissionId: string;
	submissionUrl: string;
	trackingUnavailable?: boolean;
}

export interface SubmissionFinalResult {
	status: string;
	execTime: string;
	memory: string;
}

export interface LocalRunnerResult {
	status: string;
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	time?: number;
	memory?: number;
	stdoutTruncated?: boolean;
	stderrTruncated?: boolean;
}

export interface EasyTestRunResult {
	status: string;
	output: string;
	error?: string;
	execTime?: number;
}

export interface EasyTestJudgeResult {
	status: string;
	output: string;
	expectedOutput: string;
}

export interface SampleResult {
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
}

export interface CompileEntry {
	rootDir: string;
	classDir: string;
	mainClass: string;
	requiresIsolatedProcess: boolean;
	status: "compiled" | "error";
	error: string | null;
}

export interface ProcessResult {
	code: number;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

export interface DispatcherRunResult {
	exitCode?: number;
	time?: number;
	stdout?: string;
	stderr?: string;
	stdoutTruncated?: boolean;
	stderrTruncated?: boolean;
	timedOut?: boolean;
	error?: string;
}
