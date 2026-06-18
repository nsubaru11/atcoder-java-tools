import {spawn} from "node:child_process";
import path from "node:path";
import {CLI_CONFIG, PROJECT_ROOT} from "../config";

const READY_TIMEOUT_MS = Number(process.env.LOCAL_RUNNER_START_TIMEOUT_MS || 60000);
const POLL_INTERVAL_MS = 500;
const JAVA_VER = process.env.ATCODER_JAVA_VER || "24";

/** ヘルスチェック: POST {mode:"list"} が 200 を返せば daemon は利用可能（warmUp 済み）。 */
async function pingServer(timeoutMs = 1500): Promise<boolean> {
	try {
		const res = await fetch(CLI_CONFIG.defaultLocalRunnerUrl, {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({mode: "list"}),
			signal: AbortSignal.timeout(timeoutMs),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** bash 用シングルクオートエスケープ。 */
function shq(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Local Runner サーバーを起動する。
 * Windows: 新しいコンソール窓で wsl を直接前面実行（ConPTY＝擬似端末）→ ログがリアルタイムで窓に流れる。
 *          PowerShell を介さないのは、ネイティブ出力がパイプ経由でバッファされ窓に流れないため。
 *          cmd /k で失敗時もログが残り、窓を閉じるとサーバーも停止する。
 * WSL/Linux 内: setsid でバックグラウンド化し、ログは ~/.atcoder/runner-autostart.log へ。
 */
function startServer(): void {
	const binDir = path.join(PROJECT_ROOT, "runner", "bin");

	if (process.platform === "win32") {
		// 新しいコンソール窓で wsl を直接起動（PowerShell を介さない）。
		// --cd で Windows パスのまま作業ディレクトリ指定（スペース対応）、bash で .sh 実行（実行権限ビット不要）。
		// cmd /k により .sh 終了後も窓が残り、エラーログを読める。
		const child = spawn(
			"cmd.exe",
			["/c", "start", "Local Runner", "cmd", "/k", "wsl.exe", "--cd", binDir, "--", "bash", "./start-local-runner.sh", JAVA_VER],
			{stdio: "ignore"},
		);
		child.unref();
		return;
	}

	// CLI 自身が WSL/Linux 内の場合: setsid で背景化し、ログはファイルへ。
	const envExports: string[] = [];
	if (process.env.LOCAL_RUNNER_PORT) envExports.push(`export LOCAL_RUNNER_PORT=${shq(process.env.LOCAL_RUNNER_PORT)}`);
	if (process.env.LOCAL_RUNNER_BASE_DIR) envExports.push(`export LOCAL_RUNNER_BASE_DIR=${shq(process.env.LOCAL_RUNNER_BASE_DIR)}`);
	const exportsPart = envExports.length ? envExports.join("; ") + "; " : "";
	const inner =
		`mkdir -p "$HOME/.atcoder" && ` +
		`echo "=== autostart $(date) ===" >> "$HOME/.atcoder/runner-autostart.log" && ` +
		`cd ${shq(binDir)} && chmod +x ./start-local-runner.sh && ` +
		`{ ${exportsPart}setsid nohup ./start-local-runner.sh ${shq(JAVA_VER)} < /dev/null >> "$HOME/.atcoder/runner-autostart.log" 2>&1 & }`;
	const child = spawn("bash", ["-lc", inner], {stdio: "ignore"});
	child.unref();
}

/** CLI が server を叩く前に呼ぶ。未起動なら自動起動して ready まで待つ。 */
export async function ensureLocalRunnerReady(): Promise<void> {
	if (process.env.ATCODER_RUNNER_AUTOSTART === "0") return; // 自動起動を無効化（常駐運用に切替時）
	if (await pingServer()) return;                            // 既に起動済み

	console.error("Local Runner not responding — starting it in a new window...");
	try {
		startServer();
	} catch (e) {
		throw new Error(`Local Runner の起動コマンド実行に失敗: ${e instanceof Error ? e.message : String(e)}`);
	}

	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
		if (await pingServer()) {
			console.error("Local Runner is ready.");
			return;
		}
	}
	throw new Error(
		`Local Runner did not become ready within ${READY_TIMEOUT_MS}ms.\n` +
		`  起動した "Local Runner" ウィンドウのログを確認してください（bun/java が WSL に無い等）。\n` +
		`  手動確認: PowerShell 7 で  pwsh -File .\\bin\\start-local-runner.ps1 ${JAVA_VER}\n` +
		`  上書き用env: ATCODER_JAVA_VER / LOCAL_RUNNER_START_TIMEOUT_MS`,
	);
}
