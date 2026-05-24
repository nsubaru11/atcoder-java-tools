"use strict";

// ヒューリスティックコンテストかどうかを判定
const isHeuristic = new URLSearchParams(window.location.search).get('contestType') === 'heuristic';

// 各値設定（ボタン追加）
{
	const element = document.getElementsByClassName('btn-text-group')[document.getElementsByClassName('btn-text-group').length - 1];

	// パフォーマンスON/OFFボタン
	const insertButton = Object.assign(document.createElement('button'), {
		className: 'btn btn-default', id: 'onoffButton', style: '\
margin-left:100px;\
color: #0275d8;\
background-color: #fff;\
border: 1px solid #ccc;\
border-radius: 4px;\
padding: 5px 10px;\
font-size: 14px;\
'
	});
	insertButton.textContent = "パフォーマンス ON/OFF切り替え";
	element.appendChild(insertButton);

	// recent/all切替ボタン
	const recentButton = Object.assign(document.createElement('button'), {
		id: 'recentAllToggleButton', className: 'btn btn-default', style: '\
margin-left:10px;\
color: #0275d8;\
background-color: #fff;\
border: 1px solid #ccc;\
border-radius: 4px;\
padding: 5px 10px;\
font-size: 14px;\
'
	});
	// デフォルトをrecentモードに設定
	window.isRecentMode = true;
	recentButton.textContent = "all";
	element.appendChild(recentButton);
}

// const
const MARGIN_VAL_X = 86400 * 30;
const MARGIN_VAL_Y_LOW = 100;
const MARGIN_VAL_Y_HIGH = 300;
const OFFSET_X = 50;
const OFFSET_Y = 5;
const DEFAULT_WIDTH = 640;
const GRAPH_READY_TIMEOUT_MS = 10000;
let canvas_status: HTMLCanvasElement | null = null;
let canvas_graph: HTMLCanvasElement | null = null;
let STATUS_WIDTH = 0;
let STATUS_HEIGHT = 0;
let PANEL_WIDTH = 0;
let PANEL_HEIGHT = 0;

// highest吹き出しサイズ
const HIGHEST_WIDTH = 115;
const HIGHEST_HEIGHT = 20;
const LABEL_FONT = "12px Lato";
const START_YEAR = 2010;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEAR_SEC = 86400 * 365;
const STEP_SIZE = 400;
const COLORS: Array<[number, string, number]> = [[0, "#808080", 0.15], [400, "#804000", 0.15], [800, "#008000", 0.15], [1200, "#00C0C0", 0.2], [1600, "#0000FF", 0.1], [2000, "#C0C000", 0.25], [2400, "#FF8000", 0.2], [2800, "#FF0000", 0.1]];

const STAR_MIN = 3200;
const PARTICLE_MIN = 3;
const PARTICLE_MAX = 20;
const LIFE_MAX = 30;
const EPS = 1e-9;

let cj: any = null;
let stage_graph: any, stage_status: any;
// graph
let panel_shape: {
	x: number;
	y: number;
	alpha: number;
	graphics: {
		beginFill: (arg0: string) => {
			(): any;
			new(): any;
			rect: { (arg0: number, arg1: number, arg2: number, arg3: number): void; new(): any; };
		};
	};
}, border_shape: {
	x: number;
	y: number;
	graphics: {
		beginStroke: (arg0: string) => { (): any; new(): any; setStrokeStyle: { (arg0: number): void; new(): any; }; };
		moveTo: (arg0: number, arg1: number) => {
			(): any;
			new(): any;
			lineTo: { (arg0: number, arg1: number): void; new(): any; };
		};
		mt: (arg0: number, arg1: number) => {
			(): any;
			new(): any;
			lt: { (arg0: number, arg1: number): void; new(): any; };
		};
		s: (arg0: string) => {
			(): any;
			new(): any;
			ss: {
				(arg0: number): {
					(): any;
					new(): any;
					rr: { (arg0: number, arg1: number, arg2: number, arg3: number, arg4: number): void; new(): any; };
				};
				new(): any;
			};
		};
	};
};
let chart_container: { shadow: any; }, line_shape: {
	graphics: {
		s: (arg0: string) => { (): any; new(): any; ss: { (arg0: number): void; new(): any; }; };
		mt: (arg0: any, arg1: any) => void;
		lt: (arg0: any, arg1: any) => void;
	};
}, vertex_shapes: any[], highest_shape: {
	graphics: {
		s: (arg0: string) => {
			(): any;
			new(): any;
			mt: {
				(arg0: any, arg1: any): { (): any; new(): any; lt: { (arg0: any, arg1: number): void; new(): any; }; };
				new(): any;
			};
			f: {
				(arg0: string): {
					(): any;
					new(): any;
					rr: { (arg0: number, arg1: number, arg2: number, arg3: number, arg4: number): void; new(): any; };
				};
				new(): any;
			};
		};
	};
	i: number;
	addEventListener: (arg0: string, arg1: { (e: any): void; (e: any): void; }) => void;
};
let n: number, x_min: number, x_max: number, y_min: number, y_max: number;

//performance graph - グローバルスコープで明示的に定義
let perf_panel_shape: any, perf_border_shape: any;
let perf_chart_container: { shadow: any; visible: boolean; }, perf_line_shape: {
	graphics: {
		s: (arg0: string) => { (): any; new(): any; ss: { (arg0: number): void; new(): any; }; };
		mt: (arg0: any, arg1: any) => void;
		lt: (arg0: any, arg1: any) => void;
	};
}, perf_vertex_shapes: any[], perf_highest_shape: {
	graphics: {
		s: (arg0: string) => {
			(): any;
			new(): any;
			mt: {
				(arg0: any, arg1: any): { (): any; new(): any; lt: { (arg0: any, arg1: number): void; new(): any; }; };
				new(): any;
			};
			f: {
				(arg0: string): {
					(): any;
					new(): any;
					rr: { (arg0: number, arg1: number, arg2: number, arg3: number, arg4: number): void; new(): any; };
				};
				new(): any;
			};
		};
	};
	i: number;
	addEventListener: (arg0: string, arg1: { (e: any): void; (e: any): void; }) => void;
};
let perf_n: number, perf_x_min: number, perf_x_max: number, perf_y_min: number, perf_y_max: number;
// windowオブジェクトに格納してグローバルアクセスを保証
window.perf_rating_history = [];

// status
let border_status_shape: any;
let rating_text: any, place_text: any, diff_text: any, date_text: any, contest_name_text: any, perf_text: any;
let particles: any[];
let standings_url: string;
const username = document.getElementsByClassName("username")[0].textContent ?? "";

function waitForPageLoad(): Promise<void> {
	if (document.readyState === "complete") return Promise.resolve();
	return new Promise<void>((resolve) => {
		window.addEventListener("load", () => resolve(), {once: true});
	});
}

function waitForDependencies(): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const start = Date.now();
		const timer = setInterval(() => {
			const hasHistory = Array.isArray(window.rating_history);
			const hasCreateJs = typeof window.createjs !== "undefined";
			const hasCanvases = document.getElementById("ratingGraph") && document.getElementById("ratingStatus");
			if (hasHistory && hasCreateJs && hasCanvases) {
				clearInterval(timer);
				resolve();
				return;
			}
			if (Date.now() - start > GRAPH_READY_TIMEOUT_MS) {
				clearInterval(timer);
				reject(new Error("rating graph dependencies not ready"));
			}
		}, 50);
	});
}

function refreshCanvasRefs(): void {
	canvas_status = document.getElementById("ratingStatus") as HTMLCanvasElement | null;
	canvas_graph = document.getElementById("ratingGraph") as HTMLCanvasElement | null;
}

function replaceCanvas(id: string): Node | null {
	const oldCanvas = document.getElementById(id);
	if (!oldCanvas || !oldCanvas.parentNode) return null;
	const newCanvas = oldCanvas.cloneNode(false);
	oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
	return newCanvas;
}

function prepareCanvases(): void {
	if (window.__perf_graph_canvas_ready) {
		refreshCanvasRefs();
		return;
	}
	replaceCanvas("ratingGraph");
	replaceCanvas("ratingStatus");
	refreshCanvasRefs();
	window.__perf_graph_canvas_ready = true;
}

// キャンバスサイズなど設定
function initStage(stage: any, canvas: HTMLCanvasElement): { cssWidth: number; cssHeight: number } {
	const rect = canvas.getBoundingClientRect();
	const attrWidth = Number(canvas.getAttribute('width')) || canvas.width || DEFAULT_WIDTH;
	const attrHeight = Number(canvas.getAttribute('height')) || canvas.height || 0;
	const cssWidth = Math.round(rect.width || canvas.clientWidth || attrWidth);
	const cssHeight = Math.round(rect.height || canvas.clientHeight || attrHeight);
	const ratio = window.devicePixelRatio || 1;

	canvas.width = Math.round(cssWidth * ratio);
	canvas.height = Math.round(cssHeight * ratio);
	stage.scaleX = stage.scaleY = ratio;

	canvas.style.width = cssWidth + "px";
	canvas.style.height = cssHeight + "px";
	canvas.style.maxWidth = cssWidth + "px";
	canvas.style.maxHeight = cssHeight + "px";
	stage.enableMouseOver();
	return {cssWidth: cssWidth, cssHeight: cssHeight};
}

// 図形の追加
function newShape(parent: any): any {
	let s = new cj.Shape();
	parent.addChild(s);
	return s;
}

// テキストの追加
function newText(parent: any, x: number, y: number, font: string): any {
	let t = new cj.Text("", font, "#000");
	t.x = x;
	t.y = y;
	t.textAlign = "center";
	t.textBaseline = "middle";
	parent.addChild(t);
	return t;
}

// 描画などもろもろ実行
function init(click_num: number): void {
	// windowオブジェクトから参照
	let perf_rating_history = window.perf_rating_history;

	n = rating_history.length;
	perf_n = perf_rating_history.length;
	if (n === 0) return;

	// stage
	if (!canvas_graph || !canvas_status) {
		refreshCanvasRefs();
	}
	if (!canvas_graph || !canvas_status) return;

	stage_graph = new cj.Stage(canvas_graph);
	stage_status = new cj.Stage(canvas_status);
	const graphSize = initStage(stage_graph, canvas_graph);
	const statusSize = initStage(stage_status, canvas_status);
	PANEL_WIDTH = graphSize.cssWidth - OFFSET_X - 10;
	PANEL_HEIGHT = graphSize.cssHeight - OFFSET_Y - 30;
	STATUS_WIDTH = statusSize.cssWidth - OFFSET_X - 10;
	STATUS_HEIGHT = statusSize.cssHeight - OFFSET_Y - 5;

	// グラフサイズ計算
	x_min = Infinity;
	x_max = -Infinity;
	y_min = Infinity;
	y_max = -Infinity;

	for (let i = 0; i < n; i++) {
		x_min = Math.min(x_min, rating_history[i].EndTime);
		x_max = Math.max(x_max, rating_history[i].EndTime);
		y_min = Math.min(y_min, rating_history[i].NewRating);
		y_max = Math.max(y_max, rating_history[i].NewRating);
	}

	x_min -= MARGIN_VAL_X;
	x_max += MARGIN_VAL_X;
	y_min = Math.min(1500, Math.max(0, y_min - MARGIN_VAL_Y_LOW));
	y_max += MARGIN_VAL_Y_HIGH;

	// パフォーマンスグラフのサイズ
	perf_y_min = Infinity;
	perf_y_max = -Infinity;

	for (let i = 0; i < perf_rating_history.length; i++) {
		perf_y_min = Math.min(perf_y_min, perf_rating_history[i].Performance);
		perf_y_max = Math.max(perf_y_max, perf_rating_history[i].Performance);
	}

	perf_y_min = Math.min(1500, Math.max(0, perf_y_min - MARGIN_VAL_Y_LOW));
	perf_y_max += MARGIN_VAL_Y_HIGH;

	// 偶数回クリックなら、パフォーマンスグラフが表示されている
	if (click_num % 2 === 0) {
		y_min = Math.min(y_min, perf_y_min);
		y_max = Math.max(y_max, perf_y_max);
	}

	initBackground();
	initChart(click_num);
	initPerfChart(click_num);
	stage_graph.update();

	initStatus(click_num);
	stage_status.update();

	// マウスオーバー時のアニメーション
	cj.Ticker.removeAllEventListeners("tick");
	cj.Ticker.setFPS(60);
	cj.Ticker.addEventListener("tick", handleTick);

	function handleTick(_event: unknown): void {
		updateParticles();
		stage_status.update();
	}
}

function getPer(x: number, l: number, r: number): number {
	return (x - l) / (r - l);
}

function getColor(x: number): [number, string, number] {
	for (let i = COLORS.length - 1; i >= 0; i--) {
		if (x >= COLORS[i][0]) return COLORS[i];
	}
	return [-1, "#000000", 0.1];
}

function initBackground(): void {
	panel_shape = newShape(stage_graph);
	panel_shape.x = OFFSET_X;
	panel_shape.y = OFFSET_Y;
	panel_shape.alpha = 0.3;

	border_shape = newShape(stage_graph);
	border_shape.x = OFFSET_X;
	border_shape.y = OFFSET_Y;

	// 左軸
	function newLabelY(s: string, y: number): void {
		let t = new cj.Text(s, LABEL_FONT, "#000");
		t.x = OFFSET_X - 10;
		t.y = OFFSET_Y + y;
		t.textAlign = "right";
		t.textBaseline = "middle";
		stage_graph.addChild(t);
	}

	// x軸ラベル
	function newLabelX(s: string, x: number, y: number): void {
		let t = new cj.Text(s, LABEL_FONT, "#000");
		t.x = OFFSET_X + x;
		t.y = OFFSET_Y + PANEL_HEIGHT + 2 + y;
		t.textAlign = "center";
		t.textBaseline = "top";
		stage_graph.addChild(t);
	}

	let y1 = 0;
	// グラフ中の(レートの)色設定
	for (let i = COLORS.length - 1; i >= 0; i--) {
		let y2 = PANEL_HEIGHT - PANEL_HEIGHT * getPer(COLORS[i][0], y_min, y_max);
		if (y2 > 0 && y1 < PANEL_HEIGHT) {
			y1 = Math.max(y1, 0);
			panel_shape.graphics.beginFill(COLORS[i][1]).rect(0, y1, PANEL_WIDTH, Math.min(y2, PANEL_HEIGHT) - y1);
		}
		y1 = y2;
	}

	// y軸ラベル
	for (let i = 0; i <= y_max; i += STEP_SIZE) {
		if (i >= y_min) {
			let y = PANEL_HEIGHT - PANEL_HEIGHT * getPer(i, y_min, y_max);
			newLabelY(String(i), y);
			border_shape.graphics.beginStroke("#FFF").setStrokeStyle(0.5);
			if (i === 2000) border_shape.graphics.beginStroke("#000");
			border_shape.graphics.moveTo(0, y).lineTo(PANEL_WIDTH, y);
		}
	}
	border_shape.graphics.beginStroke("#FFF").setStrokeStyle(0.5);

	let month_step = 6;
	for (let i = 3; i >= 1; i--) {
		if (x_max - x_min <= YEAR_SEC * i + MARGIN_VAL_X * 2) month_step = i;
	}

	// x軸ラベル
	let first_flag = true;
	for (let i = START_YEAR; i < 3000; i++) {
		let break_flag = false;
		for (let j = 0; j < 12; j += month_step) {
			let month = ('00' + (j + 1)).slice(-2);
			let unix = Date.parse(String(i) + "-" + month + "-01T00:00:00") / 1000;
			if (x_min < unix && unix < x_max) {
				let x = PANEL_WIDTH * getPer(unix, x_min, x_max);
				if (j === 0 || first_flag) {
					newLabelX(MONTH_NAMES[j], x, 0);
					newLabelX(String(i), x, 13);
					first_flag = false;
				} else {
					newLabelX(MONTH_NAMES[j], x, 0);
				}
				border_shape.graphics.mt(x, 0).lt(x, PANEL_HEIGHT);
			}
			if (unix > x_max) {
				break_flag = true;
				break;
			}
		}
		if (break_flag) break;
	}
	border_shape.graphics.s("#888").ss(1.5).rr(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 2);
}

function initChart(click_num4: number): void {
	// windowオブジェクトから参照
	let perf_rating_history = window.perf_rating_history;

	chart_container = new cj.Container();
	stage_graph.addChild(chart_container);
	chart_container.shadow = new cj.Shadow("rgba(0,0,0,0.3)", 1, 2, 3);

	line_shape = newShape(chart_container);
	highest_shape = newShape(chart_container);
	vertex_shapes = [];

	// マウスホバー時のアニメーション
	function mouseoverVertex(e: any): void {
		vertex_shapes[e.target.i].scaleX = vertex_shapes[e.target.i].scaleY = 1.2;
		stage_graph.update();
		setStatus(rating_history[e.target.i], perf_rating_history[e.target.i], true, click_num4);
	}

	function mouseoutVertex(e: any): void {
		vertex_shapes[e.target.i].scaleX = vertex_shapes[e.target.i].scaleY = 1;
		stage_graph.update();
	}

	// 最高レーティング取得
	let highest_i = 0;
	for (let i = 0; i < n; i++) {
		if (rating_history[highest_i].NewRating < rating_history[i].NewRating) {
			highest_i = i;
		}
	}

	// rating-graph-plot
	for (let i = 0; i < n; i++) {
		vertex_shapes.push(newShape(chart_container));
		vertex_shapes[i].graphics.beginStroke("#FFF");
		if (i === highest_i) vertex_shapes[i].graphics.s("#000");
		vertex_shapes[i].graphics.setStrokeStyle(0.5).beginFill(getColor(rating_history[i].NewRating)[1]).dc(0, 0, 3.5);

		vertex_shapes[i].x = OFFSET_X + PANEL_WIDTH * getPer(rating_history[i].EndTime, x_min, x_max);
		vertex_shapes[i].y = OFFSET_Y + (PANEL_HEIGHT - PANEL_HEIGHT * getPer(rating_history[i].NewRating, y_min, y_max));
		vertex_shapes[i].i = i;

		let hitArea = new cj.Shape();
		hitArea.graphics.f("#000").dc(1.5, 1.5, 6);
		vertex_shapes[i].hitArea = hitArea;
		vertex_shapes[i].addEventListener("mouseover", mouseoverVertex);
		vertex_shapes[i].addEventListener("mouseout", mouseoutVertex);
	}

	// highest
	{
		let dx = 80;
		if ((x_min + x_max) / 2 < rating_history[highest_i].EndTime) dx = -80;
		let x = vertex_shapes[highest_i].x + dx;
		let y = vertex_shapes[highest_i].y - 16;
		highest_shape.graphics.s("#FFF").mt(vertex_shapes[highest_i].x, vertex_shapes[highest_i].y).lt(x, y);
		highest_shape.graphics.s("#888").f("#FFF").rr(x - HIGHEST_WIDTH / 2, y - HIGHEST_HEIGHT / 2, HIGHEST_WIDTH, HIGHEST_HEIGHT, 2);
		highest_shape.i = highest_i;
		let highest_text = newText(stage_graph, x, y, "12px Lato");
		highest_text.text = "Highest(Rate): " + rating_history[highest_i].NewRating;
		highest_shape.addEventListener("mouseover", mouseoverVertex);
		highest_shape.addEventListener("mouseout", mouseoutVertex);
	}

	// 線を描画
	for (let j = 0; j < 2; j++) {
		if (j === 0) line_shape.graphics.s("#AAA").ss(2); else line_shape.graphics.s("#000").ss(0.5);

		line_shape.graphics.mt(vertex_shapes[0].x, vertex_shapes[0].y);
		for (let i = 0; i < n; i++) {
			line_shape.graphics.lt(vertex_shapes[i].x, vertex_shapes[i].y);
		}
	}
}

// パフォーマンスグラフの描画
function initPerfChart(click_num2: number): void {
	// windowオブジェクトから参照
	let perf_rating_history = window.perf_rating_history;

	perf_chart_container = new cj.Container();
	stage_graph.addChild(perf_chart_container);
	perf_chart_container.shadow = new cj.Shadow("rgba(0,0,0,0.3)", 1, 2, 3);

	perf_line_shape = newShape(perf_chart_container);
	perf_highest_shape = newShape(perf_chart_container);
	perf_vertex_shapes = [];

	// パフォーマンスデータがない場合は早期リターン
	if (perf_rating_history.length === 0) {
		perf_chart_container.visible = false;
		return;
	}

	function mouseoverVertex(e: any): void {
		perf_vertex_shapes[e.target.i].scaleX = perf_vertex_shapes[e.target.i].scaleY = 1.2;
		stage_graph.update();
		setStatus(rating_history[e.target.i], perf_rating_history[e.target.i], true, click_num2);
	}

	function mouseoutVertex(e: any): void {
		perf_vertex_shapes[e.target.i].scaleX = perf_vertex_shapes[e.target.i].scaleY = 1;
		stage_graph.update();
	}

	// 最高パフォーマンスの取得
	let highest_i_perf = 0;
	for (let i = 0; i < perf_n; i++) {
		if (perf_rating_history[highest_i_perf].Performance < perf_rating_history[i].Performance) {
			highest_i_perf = i;
		}
	}

	// performance-graph-plot
	// 元のコードと同様にrating_history[i].EndTimeを使用
	for (let i = 0; i < perf_n; i++) {
		perf_vertex_shapes.push(newShape(perf_chart_container));
		perf_vertex_shapes[i].graphics.beginStroke("#FFF");
		if (i === highest_i_perf) {
			perf_vertex_shapes[i].graphics.s("#000");
			perf_vertex_shapes[i].graphics.setStrokeStyle(1).beginFill(getColor(perf_rating_history[i].Performance)[1]).dc(0, 0, 2.5);
		} else {
			perf_vertex_shapes[i].graphics.setStrokeStyle(0.5).beginFill(getColor(perf_rating_history[i].Performance)[1]).dc(0, 0, 2.8);
		}
		perf_vertex_shapes[i].x = OFFSET_X + PANEL_WIDTH * getPer(rating_history[i].EndTime, x_min, x_max);
		perf_vertex_shapes[i].y = OFFSET_Y + (PANEL_HEIGHT - PANEL_HEIGHT * getPer(perf_rating_history[i].Performance, y_min, y_max));
		perf_vertex_shapes[i].i = i;

		let hitArea = new cj.Shape();
		hitArea.graphics.f("#000").dc(1.5, 1.5, 6);
		perf_vertex_shapes[i].hitArea = hitArea;
		perf_vertex_shapes[i].addEventListener("mouseover", mouseoverVertex);
		perf_vertex_shapes[i].addEventListener("mouseout", mouseoutVertex);
	}

	// highest-perf
	let highest_perf_text;
	{
		let dx_perf = 80;
		if ((x_min + x_max) / 2 < rating_history[highest_i_perf].EndTime) dx_perf = -80;
		let x = perf_vertex_shapes[highest_i_perf].x + dx_perf;
		let y = perf_vertex_shapes[highest_i_perf].y - 16;
		perf_highest_shape.graphics.s("#FFF").mt(perf_vertex_shapes[highest_i_perf].x, perf_vertex_shapes[highest_i_perf].y).lt(x, y);
		perf_highest_shape.graphics.s("#888").f("#FFF").rr(x - HIGHEST_WIDTH / 2, y - HIGHEST_HEIGHT / 2, HIGHEST_WIDTH, HIGHEST_HEIGHT, 2);
		perf_highest_shape.i = highest_i_perf;
		highest_perf_text = newText(stage_graph, x, y, "12px Lato");
		highest_perf_text.text = "Highest(Perf): " + perf_rating_history[highest_i_perf].Performance;
		perf_highest_shape.addEventListener("mouseover", mouseoverVertex);
		perf_highest_shape.addEventListener("mouseout", mouseoutVertex);
	}

	// 線を描画
	for (let index = 0; index < 2; index++) {
		if (index === 0) perf_line_shape.graphics.s("#AAA").ss(2); else perf_line_shape.graphics.s("#F00").ss(0.5);
		perf_line_shape.graphics.mt(perf_vertex_shapes[0].x, perf_vertex_shapes[0].y);
		for (let i = 0; i < perf_rating_history.length; i++) {
			perf_line_shape.graphics.lt(perf_vertex_shapes[i].x, perf_vertex_shapes[i].y);
		}
	}

	// 表示/非表示の切り替え
	if (click_num2 % 2 === 0) {
		perf_chart_container.visible = true;
		highest_perf_text.text = "Highest(Perf): " + perf_rating_history[highest_i_perf].Performance;
	} else {
		perf_chart_container.visible = false;
		highest_perf_text.text = "";
	}
	stage_graph.update();
}

// status情報初期化関数
function initStatus(click_num5: number): void {
	// windowオブジェクトから参照
	let perf_rating_history = window.perf_rating_history;

	border_status_shape = newShape(stage_status);
	rating_text = newText(stage_status, OFFSET_X + 75, OFFSET_Y + STATUS_HEIGHT / 2, "48px 'Squada One'");
	perf_text = newText(stage_status, OFFSET_X + 75, OFFSET_Y + STATUS_HEIGHT / 2 + 25, "16px 'Squada One'");
	place_text = newText(stage_status, OFFSET_X + 160, OFFSET_Y + STATUS_HEIGHT / 2.7, "16px Lato");
	diff_text = newText(stage_status, OFFSET_X + 160, OFFSET_Y + STATUS_HEIGHT / 1.5, "11px Lato");
	diff_text.color = '#888';
	date_text = newText(stage_status, OFFSET_X + 200, OFFSET_Y + STATUS_HEIGHT / 4, "14px Lato");
	contest_name_text = newText(stage_status, OFFSET_X + 200, OFFSET_Y + STATUS_HEIGHT / 1.6, "20px Lato");
	date_text.textAlign = contest_name_text.textAlign = "left";
	contest_name_text.maxWidth = STATUS_WIDTH - 200 - 10;

	{
		let hitArea = new cj.Shape();
		hitArea.graphics.f("#000").r(0, -12, contest_name_text.maxWidth, 24);
		contest_name_text.hitArea = hitArea;
		contest_name_text.cursor = "pointer";
		contest_name_text.addEventListener("click", function () {
			location.href = standings_url;
		});
	}

	particles = [];
	for (let i = 0; i < PARTICLE_MAX; i++) {
		particles.push(newText(stage_status, 0, 0, "64px Lato"));
		particles[i].visible = false;
	}

	// 安全なインデックスアクセス
	const lastRatingIndex = rating_history.length - 1;
	const lastPerfIndex = perf_rating_history.length - 1;
	if (lastRatingIndex >= 0 && lastPerfIndex >= 0) {
		setStatus(rating_history[lastRatingIndex], perf_rating_history[lastPerfIndex], false, click_num5);
	}
}

function getRatingPer(x: number): number {
	let pre = COLORS[COLORS.length - 1][0] + STEP_SIZE;
	for (let i = COLORS.length - 1; i >= 0; i--) {
		if (x >= COLORS[i][0]) return (x - COLORS[i][0]) / (pre - COLORS[i][0]);
		pre = COLORS[i][0];
	}
	return 0;
}

function getOrdinal(x: number): string {
	let s = ["th", "st", "nd", "rd"], v = x % 100;
	return x + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getDiff(x: number): string {
	let sign = x === 0 ? '±' : (x < 0 ? '-' : '+');
	return sign + Math.abs(x);
}

// status更新
function setStatus(data: RatingHistoryEntry | undefined, data2: RatingHistoryEntry | undefined, particle_flag: boolean, click_num3: number): void {
	if (!data || !data2) return;

	let date = new Date(data.EndTime * 1000);
	let rating = data.NewRating, old_rating = data.OldRating;
	let place = data.Place;
	let contest_name = data.ContestName;
	let perf = data2.Performance;
	let tmp = getColor(rating);
	let color = tmp[1], alpha = tmp[2];

	border_status_shape.graphics.c().s(color).ss(1).rr(OFFSET_X, OFFSET_Y, STATUS_WIDTH, STATUS_HEIGHT, 2);
	rating_text.text = rating;
	rating_text.color = color;
	perf_text.text = "perf: " + perf;
	place_text.text = getOrdinal(place);
	diff_text.text = getDiff(rating - old_rating);
	date_text.text = date.toLocaleDateString();
	contest_name_text.text = contest_name;

	if (particle_flag) {
		let particle_num = Math.floor(Math.pow(getRatingPer(rating), 2) * (PARTICLE_MAX - PARTICLE_MIN) + PARTICLE_MIN);
		setParticles(particle_num, color, alpha, rating);
	}
	standings_url = data.StandingsUrl;

	// 偶数回クリック(パフォグラフが表示されている)ならレートの下にパフォを表示
	if (click_num3 % 2 === 0) {
		perf_text.text = "perf: " + perf;
	} else {
		perf_text.text = "";
	}
	stage_graph.update();
}

// ホバー時のレート変化アニメーション
function setParticle(particle: any, x: number, y: number, color: string, alpha: number, star_flag: boolean): void {
	particle.x = x;
	particle.y = y;
	let ang = Math.random() * Math.PI * 2;
	let speed = Math.random() * 4 + 4;
	particle.vx = Math.cos(ang) * speed;
	particle.vy = Math.sin(ang) * speed;
	particle.rot_speed = Math.random() * 20 + 10;
	particle.life = LIFE_MAX;
	particle.visible = true;
	particle.color = color;
	particle.text = star_flag ? "★" : "@";
	particle.alpha = alpha;
}

function setParticles(num: number, color: string, alpha: number, rating: number): void {
	for (let i = 0; i < PARTICLE_MAX; i++) {
		if (i < num) {
			setParticle(particles[i], rating_text.x, rating_text.y, color, alpha, rating >= STAR_MIN);
		} else {
			particles[i].life = 0;
			particles[i].visible = false;
		}
	}
}

function updateParticle(particle: any): void {
	if (particle.life <= 0) {
		particle.visible = false;
		return;
	}
	particle.x += particle.vx;
	particle.vx *= 0.9;
	particle.y += particle.vy;
	particle.vy *= 0.9;
	particle.life--;
	particle.scaleX = particle.scaleY = particle.life / LIFE_MAX;
	particle.rotation += particle.rot_speed;
}

function updateParticles(): void {
	for (let i = 0; i < PARTICLE_MAX; i++) {
		if (particles[i].life > 0) {
			updateParticle(particles[i]);
		}
	}
}

// main関数
async function main(): Promise<void> {
	let json: RatingHistoryEntry[], page: HTMLCollection;

	try {
		let parser = new DOMParser();

		// ヒューリスティックコンテストの場合はURLを変更
		const historyJsonUrl = isHeuristic ? `https://atcoder.jp/users/${username}/history/json?contestType=heuristic` : `https://atcoder.jp/users/${username}/history/json`;
		const historyPageUrl = isHeuristic ? `https://atcoder.jp/users/${username}/history?contestType=heuristic` : `https://atcoder.jp/users/${username}/history`;

		// 並列でフェッチして高速化
		const [jsonResponse, pageResponse] = await Promise.all([fetch(historyJsonUrl), fetch(historyPageUrl)]);

		json = await jsonResponse.json();
		const pageText = await pageResponse.text();
		const parsedPage = parser.parseFromString(pageText, "text/html");
		const historyTable = parsedPage.getElementById("history");

		if (historyTable && historyTable.children[1]) {
			page = historyTable.children[1].children;
		} else {
			console.log('履歴テーブルが見つかりません');
			return;
		}
	} catch (reason) {
		console.log('データ取得に失敗しました:', reason);
		return;
	}

	// rated参加ならデータに追加
	for (let i = 0; i < json.length; i++) {
		let rated = json[i].IsRated;
		if (rated && page[i] && page[i].children[3]) {
			const perfValue = Number((page[i].children[3] as HTMLElement).innerText);
			json[i].Performance = Math.max(0, perfValue);
			window.perf_rating_history.push({...json[i]});
		}
	}

	// rating_historyの元データ退避
	window.rating_history_original = rating_history.slice();
	// パフォーマンス履歴もバックアップ
	window.perf_rating_history_original = [...window.perf_rating_history];

	// デフォルトでrecentモードを適用
	const k = Math.max(0, window.rating_history_original.length - 3);
	if (window.isRecentMode) {
		if (window.rating_history_original.length > k) {
			rating_history = window.rating_history_original.slice(-k);
		}
		if (window.perf_rating_history_original.length > k) {
			window.perf_rating_history = window.perf_rating_history_original.slice(-k);
		}
	}

	// 描画関数実行
	init(0);
	window.clickCount1 = 0;

	// パフォーマンスON/OFFボタン
	const onoffButton = document.getElementById('onoffButton');
	if (onoffButton) {
		onoffButton.addEventListener('click', function () {
			window.clickCount1 += 1;
			init(window.clickCount1);
		});
	}

	// recent/all切替ボタン
	const recentButton = document.getElementById('recentAllToggleButton');
	if (recentButton) {
		recentButton.onclick = function () {
			window.isRecentMode = !window.isRecentMode;
			if (window.isRecentMode) {
				rating_history = window.rating_history_original.slice(-k);
				recentButton.textContent = "all";
			} else {
				rating_history = window.rating_history_original.slice();
				recentButton.textContent = "recent";
			}

			// perf_rating_historyも同様に更新
			if (window.perf_rating_history_original) {
				if (window.isRecentMode) {
					window.perf_rating_history = window.perf_rating_history_original.slice(-k);
				} else {
					window.perf_rating_history = window.perf_rating_history_original.slice();
				}
			}

			// 再描画
			init(window.clickCount1);
		};
	}
}

async function bootstrap() {
	if (window.__perf_graph_bootstrap) return;
	window.__perf_graph_bootstrap = true;

	await waitForPageLoad();
	try {
		await waitForDependencies();
	} catch (reason) {
		console.log("グラフ初期化に必要な要素が見つかりません:", reason);
		return;
	}

	cj = window.createjs;
	prepareCanvases();
	if (cj && cj.Ticker) {
		cj.Ticker.removeAllEventListeners("tick");
	}

	await main();
}

bootstrap();
