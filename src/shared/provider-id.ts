const KIMI_CODING_PROVIDER = "kimi-coding";
const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding";

function trimTrailingSlash(value: string): string {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function normalizeDesktopProviderIdentifier(provider: string): string {
	const normalized = trimTrailingSlash(provider.trim());
	if (normalized.length === 0) {
		return normalized;
	}

	const lowered = normalized.toLowerCase();
	if (lowered === KIMI_CODING_PROVIDER || lowered === KIMI_CODING_BASE_URL) {
		return KIMI_CODING_PROVIDER;
	}

	return normalized;
}

export function getDesktopProviderAliases(provider: string): string[] {
	const canonicalProvider = normalizeDesktopProviderIdentifier(provider);
	if (canonicalProvider === KIMI_CODING_PROVIDER) {
		return [KIMI_CODING_PROVIDER, KIMI_CODING_BASE_URL, `${KIMI_CODING_BASE_URL}/`];
	}

	return [canonicalProvider];
}
