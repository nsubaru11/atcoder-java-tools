export type QueryValue = string | number | boolean | null | undefined;

export function buildQueryString(data: Record<string, QueryValue>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(data)) {
		if (value == null) continue;
		params.set(key, String(value));
	}
	return params.toString();
}
