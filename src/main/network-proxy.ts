import type { CommandLine, ProxyConfig, Session } from "electron";

type ProxyEnvironment = Record<string, string | undefined>;

export interface DesktopProxyCommandLineConfig {
	proxyBypassList: string;
	proxyServer: string;
}

const DEFAULT_PROXY_BYPASS_RULES = ["<local>", "localhost", "127.0.0.1", "::1"] as const;

interface NormalizedProxyServer {
	endpoint: string;
	protocol: string;
	server: string;
}

function readEnvironmentValue(env: ProxyEnvironment, ...names: string[]): string | undefined {
	for (const name of names) {
		const value = env[name]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
}

function normalizeProxyServer(value: string | undefined): NormalizedProxyServer | undefined {
	if (!value) {
		return undefined;
	}
	const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
	try {
		const proxyUrl = new URL(candidate);
		const protocol = proxyUrl.protocol.slice(0, -1).toLowerCase();
		if (!["http", "https", "socks", "socks4", "socks5"].includes(protocol) || !proxyUrl.hostname) {
			return undefined;
		}
		return {
			endpoint: proxyUrl.host.toLowerCase(),
			protocol,
			server: `${protocol}://${proxyUrl.host}`,
		};
	} catch {
		return undefined;
	}
}

function buildProxyBypassList(env: ProxyEnvironment): string {
	const explicitRules = (readEnvironmentValue(env, "no_proxy", "NO_PROXY") ?? "")
		.split(",")
		.map((rule) => rule.trim())
		.filter(Boolean);
	const rules = [...explicitRules];
	for (const defaultRule of DEFAULT_PROXY_BYPASS_RULES) {
		if (!rules.includes(defaultRule)) {
			rules.push(defaultRule);
		}
	}
	return rules.join(";");
}

function shouldPreferSocksAllProxy(
	allProxy: NormalizedProxyServer | undefined,
	httpProxy: NormalizedProxyServer | undefined,
	httpsProxy: NormalizedProxyServer | undefined,
): boolean {
	if (!allProxy?.protocol.startsWith("socks")) {
		return false;
	}
	const protocolProxies = [httpProxy, httpsProxy].filter((proxy): proxy is NormalizedProxyServer => Boolean(proxy));
	return protocolProxies.length > 0 && protocolProxies.every((proxy) => proxy.endpoint === allProxy.endpoint);
}

export function createDesktopProxyCommandLineConfig(
	env: ProxyEnvironment = process.env,
): DesktopProxyCommandLineConfig | undefined {
	const httpProxy = normalizeProxyServer(readEnvironmentValue(env, "http_proxy", "HTTP_PROXY"));
	const httpsProxy = normalizeProxyServer(readEnvironmentValue(env, "https_proxy", "HTTPS_PROXY"));
	const allProxy = normalizeProxyServer(readEnvironmentValue(env, "all_proxy", "ALL_PROXY"));

	if (allProxy && shouldPreferSocksAllProxy(allProxy, httpProxy, httpsProxy)) {
		return {
			proxyBypassList: buildProxyBypassList(env),
			proxyServer: allProxy.server,
		};
	}

	if (httpProxy || httpsProxy) {
		const fallbackProxy = httpsProxy ?? httpProxy;
		if (!fallbackProxy) {
			return undefined;
		}
		const proxyServer = [
			`http=${(httpProxy ?? fallbackProxy).server}`,
			`https=${(httpsProxy ?? fallbackProxy).server}`,
		].join(";");
		return {
			proxyBypassList: buildProxyBypassList(env),
			proxyServer,
		};
	}

	if (allProxy) {
		return {
			proxyBypassList: buildProxyBypassList(env),
			proxyServer: allProxy.server,
		};
	}

	return undefined;
}

export function installDesktopProxyFromEnvironment(
	commandLine: Pick<CommandLine, "appendSwitch">,
	env: ProxyEnvironment = process.env,
): DesktopProxyCommandLineConfig | undefined {
	const config = createDesktopProxyCommandLineConfig(env);
	if (!config) {
		return undefined;
	}

	commandLine.appendSwitch("proxy-server", config.proxyServer);
	commandLine.appendSwitch("proxy-bypass-list", config.proxyBypassList);
	return config;
}

export function createDesktopProxySessionConfig(env: ProxyEnvironment = process.env): ProxyConfig | undefined {
	const config = createDesktopProxyCommandLineConfig(env);
	if (!config) {
		return undefined;
	}
	return {
		mode: "fixed_servers",
		proxyBypassRules: config.proxyBypassList,
		proxyRules: config.proxyServer,
	};
}

export async function applyDesktopProxyToSession(
	session: Pick<Session, "closeAllConnections" | "forceReloadProxyConfig" | "setProxy">,
	env: ProxyEnvironment = process.env,
): Promise<ProxyConfig | undefined> {
	const config = createDesktopProxySessionConfig(env);
	if (!config) {
		return undefined;
	}
	await session.setProxy(config);
	await session.forceReloadProxyConfig();
	await session.closeAllConnections();
	return config;
}
