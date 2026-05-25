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
declare var GM_registerMenuCommand: (name: string, fn: () => void, accessKey?: string) => void;
declare const GM: {
	getValue: <T>(key: string, defaultValue?: T) => Promise<T>;
	setValue: (key: string, value: unknown) => Promise<void>;
} | undefined;
declare var rating_history: RatingHistoryEntry[];
declare var perf_rating_history: RatingHistoryEntry[];
