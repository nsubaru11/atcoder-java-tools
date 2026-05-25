export function safeJsonParse<T>(text: unknown, fallback: T): T {
	if (typeof text !== "string") return fallback;
	try {
		return JSON.parse(text) as T;
	} catch {
		return fallback;
	}
}

export function parseStoredObject<T extends Record<string, unknown>>(raw: unknown): Partial<T> {
	if (raw == null) return {};
	if (typeof raw === "string") {
		const parsed: unknown = safeJsonParse(raw, null);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Partial<T>;
		}
		return {};
	}
	if (typeof raw === "object" && !Array.isArray(raw)) {
		return raw as Partial<T>;
	}
	return {};
}

export function mergeWithDefaults<T extends Record<string, unknown>>(defaults: T, raw: unknown): T {
	return Object.assign({}, defaults, parseStoredObject<T>(raw));
}
