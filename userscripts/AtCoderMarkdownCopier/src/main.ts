// TurndownService と turndownPluginGfm は @require で読み込まれるため、グローバルに存在します
const turndownService = new TurndownService({
	headingStyle: 'atx',
	codeBlockStyle: 'fenced',
	bulletListMarker: '-'
});

// GFMプラグイン（テーブルなど）を有効化
turndownService.use(turndownPluginGfm.gfm);

// AtCoderの数式 (<var>) を Markdown の $...$ 形式に変換するルール
turndownService.addRule('math', {
	filter: 'var',
	replacement: function (content: string) {
		return `$${content}$`;
	}
});

// <pre> タグのコードブロックを整形
turndownService.addRule('pre', {
	filter: 'pre',
	replacement: function (content: string) {
		return `\n\`\`\`text\n${content.trim()}\n\`\`\`\n`;
	}
});

/**
 * 不要な要素を削除したクローンを作成する
 */
function getCleanElement(element: Element): Element {
	const clone = element.cloneNode(true) as HTMLElement;
	// コピー用ボタンなどのUI要素を除去
	clone.querySelectorAll('.btn, .btn-copy, .btn-pre, .div-btn-copy').forEach(el => el.remove());
	return clone;
}

/**
 * HTML要素からMarkdownテキストを生成する
 */
function getMarkdownFromElement(element: Element): string {
	const cleanEl = getCleanElement(element);
	return turndownService.turndown(cleanEl.innerHTML);
}

/**
 * コピー用ボタンのUIを作成する
 */
function createButton(text: string, onClick: () => void): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.textContent = text;
	btn.className = 'btn btn-default btn-sm';
	btn.style.marginLeft = '10px';
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		onClick();
		const originalText = btn.textContent;
		btn.textContent = 'Copied!';
		setTimeout(() => {
			btn.textContent = originalText;
		}, 1500);
	});
	return btn;
}

function main() {
	// AtCoderの問題文セクション全体を取得
	const statementContainer = document.getElementById('task-statement');
	if (!statementContainer) return;

	// 現在表示されている言語のコンテナを取得 (lang-ja または lang-en)
	// AtCoderは表示中の言語以外は display: none にしている
	const activeLangContainer = Array.from(statementContainer.querySelectorAll('.lang-ja, .lang-en'))
		.find(el => getComputedStyle(el).display !== 'none') || statementContainer;

	// 各パート（問題文、制約、入力、出力など）を取得
	const parts = activeLangContainer.querySelectorAll('.part section');

	const SAMPLE_KEYWORDS = ['入力例', '出力例', 'Sample Input', 'Sample Output'];

	parts.forEach((section) => {
		const header = section.querySelector('h3');
		if (!header) return;

		const title = header.textContent || '';
		if (SAMPLE_KEYWORDS.some(kw => title.includes(kw))) return;

		// 【機能1】個別コピー機能
		const copyBtn = createButton('Copy', () => {
			const markdown = getMarkdownFromElement(section);
			GM_setClipboard(markdown);
		});
		header.appendChild(copyBtn);
	});

	// 【機能2】一括コピー機能
	const taskTitle = document.querySelector('.h2') || document.querySelector('h2');
	if (taskTitle) {
		const wrap = document.createElement('span');
		wrap.className = 'pull-right';
		wrap.style.fontSize = '14px';

		const getFullMarkdown = () => {
			const cloneTitle = taskTitle.cloneNode(true) as HTMLElement;
			cloneTitle.querySelectorAll('.btn, .pull-right').forEach(el => el.remove());
			let fullMarkdown = `# ${cloneTitle.textContent?.trim() || 'Task'}\n\n`;
			fullMarkdown += `URL: ${window.location.href}\n\n`;
			for (const section of Array.from(parts)) {
				const header = section.querySelector('h3');
				if (header) {
					const title = header.textContent || '';
					if (SAMPLE_KEYWORDS.some(kw => title.includes(kw))) {
						break;
					}
				}
				fullMarkdown += getMarkdownFromElement(section) + '\n\n';
			}
			return fullMarkdown.trim();
		};

		// 一括コピーボタン
		const copyAllBtn = createButton('All Copy', () => {
			GM_setClipboard(getFullMarkdown());
		});

		wrap.appendChild(copyAllBtn);
		taskTitle.appendChild(wrap);
	}
}

// ページ読み込み完了後に実行
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', main);
} else {
	main();
}
export {};
