const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
export const DESKTOP_STATIC_WEB_PREVIEW_PROTOCOL = "skylark-preview:";

function hasProtocol(value: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

export function normalizeDesktopWebPreviewUrl(value: string): string | undefined {
	const trimmedValue = value.trim();
	if (!trimmedValue) {
		return undefined;
	}

	const candidate = hasProtocol(trimmedValue)
		? trimmedValue
		: isDesktopLoopbackWebPreviewCandidate(trimmedValue)
			? `http://${trimmedValue}`
			: `https://${trimmedValue}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return undefined;
	}

	if (url.username || url.password) {
		return undefined;
	}
	if (url.protocol === DESKTOP_STATIC_WEB_PREVIEW_PROTOCOL) {
		return url.toString();
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return undefined;
	}
	if (!url.port && isSingleLabelPublicHostname(url.hostname)) {
		url.hostname = `${url.hostname}.com`;
	}
	return url.toString();
}

export function isDesktopStaticWebPreviewUrl(value: string): boolean {
	try {
		return new URL(value).protocol === DESKTOP_STATIC_WEB_PREVIEW_PROTOCOL;
	} catch {
		return false;
	}
}

export function isDesktopLoopbackWebPreviewUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
	} catch {
		return false;
	}
}

export function normalizeDesktopLoopbackWebPreviewUrl(value: string): string | undefined {
	const previewUrl = normalizeDesktopWebPreviewUrl(value);
	return previewUrl && isDesktopLoopbackWebPreviewUrl(previewUrl) ? previewUrl : undefined;
}

function isDesktopLoopbackWebPreviewCandidate(value: string): boolean {
	return isDesktopLoopbackWebPreviewUrl(`http://${value}`);
}

function isSingleLabelPublicHostname(hostname: string): boolean {
	const normalizedHostname = hostname.toLowerCase();
	return (
		!LOOPBACK_HOSTS.has(normalizedHostname) &&
		!normalizedHostname.includes(".") &&
		!normalizedHostname.includes(":") &&
		!/^\d+$/.test(normalizedHostname) &&
		/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalizedHostname)
	);
}
