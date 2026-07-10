import {spawnSync} from "node:child_process";

type ClipboardCommand = {
	command: string;
	args: string[];
};

function clipboardCommands(): ClipboardCommand[] {
	switch (process.platform) {
		case "win32":
			return [{
				command: "powershell.exe",
				args: [
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					"[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())",
				],
			}];
		case "darwin":
			return [{command: "pbcopy", args: []}];
		default:
			return [
				{command: "wl-copy", args: []},
				{command: "xclip", args: ["-selection", "clipboard"]},
			];
	}
}

/** UTF-8の提出ソースをOSのクリップボードへコピーする。 */
export function copyToClipboard(source: string): void {
	const errors: string[] = [];
	for (const {command, args} of clipboardCommands()) {
		const result = spawnSync(command, args, {
			input: source,
			encoding: "utf8",
			windowsHide: true,
		});
		if (!result.error && result.status === 0) return;
		const detail = result.error?.message || result.stderr.trim() || `exit code ${result.status}`;
		errors.push(`${command}: ${detail}`);
	}
	throw new Error(`クリップボードへコピーできませんでした: ${errors.join("; ")}`);
}
