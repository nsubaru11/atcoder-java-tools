type UserScriptAnyFunction = (...args: any[]) => any;
type UserScriptAnyObject = Record<string, any>;

interface UserScriptJQuery {
	(...args: any[]): any;

	fn?: UserScriptAnyObject;
	each: UserScriptAnyFunction;
	noConflict: () => UserScriptJQuery;
}

interface UserScriptAce {
	edit(target: Element | string | null): any;

	require(moduleName: string): any;
}

interface RatingHistoryEntry {
	ContestScreenName?: string;
	ContestName: string;
	EndTime: number;
	NewRating: number;
	OldRating: number;
	Place: number;
	StandingsUrl: string;
	Performance?: number;
	IsRated?: boolean;
}

interface Window {
	$: UserScriptJQuery;
	jQuery: UserScriptJQuery;
	ace?: UserScriptAce;
	monaco?: any;
	createjs?: any;
	csrfToken?: string;
	contestScreenName?: string;
	getSourceCode?: UserScriptAnyFunction;
	rating_history: RatingHistoryEntry[];
	rating_history_original: RatingHistoryEntry[];
	perf_rating_history: RatingHistoryEntry[];
	perf_rating_history_original?: RatingHistoryEntry[];
	isRecentMode?: boolean;
	clickCount1: number;
	__perf_graph_bootstrap?: boolean;
	__perf_graph_canvas_ready?: boolean;
	bottomMenu?: any;
	codeRunner?: any;
	atCoderEasyTest?: any;
}

declare var unsafeWindow: Window;

declare var GM_getValue: <T>(key: string, defaultValue?: T) => T;
declare var GM_setValue: (key: string, value: unknown) => void;
declare var GM_setClipboard: (data: string, info?: string | { type?: string, minibar?: boolean }) => void;
declare var GM_registerMenuCommand: (name: string, fn: () => void, accessKey?: string) => void;
declare const GM: {
	getValue: <T>(key: string, defaultValue?: T) => Promise<T>;
	setValue: (key: string, value: unknown) => Promise<void>;
} | undefined;

interface TurndownServiceOptions {
	headingStyle?: 'setext' | 'atx';
	hr?: string;
	br?: string;
	italicDelimiter?: '_' | '*';
	boldDelimiter?: '__' | '**';
	codeBlockStyle?: 'indented' | 'fenced';
	bulletListMarker?: '-' | '+' | '*';
}

declare class TurndownService {
	constructor(options?: TurndownServiceOptions);

	addRule(key: string, rule: any): this;

	keep(filter: any): this;

	remove(filter: any): this;

	use(plugin: any): this;

	turndown(html: string | Node): string;
}

declare var turndownPluginGfm: any;

declare var rating_history: RatingHistoryEntry[];
declare var perf_rating_history: RatingHistoryEntry[];
