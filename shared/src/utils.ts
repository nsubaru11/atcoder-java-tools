export function normalizeNewlines(text: string) {
	return text.replace(/\r\n?/g, "\n");
}
