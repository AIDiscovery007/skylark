import { describe, expect, it, vi } from "vitest";
import {
	applyDesktopProxyToSession,
	createDesktopProxyCommandLineConfig,
	createDesktopProxySessionConfig,
	installDesktopProxyFromEnvironment,
} from "../../src/main/network-proxy.ts";

describe("desktop network proxy", () => {
	it("maps http and https proxy environment variables to Chromium proxy rules", () => {
		expect(
			createDesktopProxyCommandLineConfig({
				http_proxy: "http://127.0.0.1:7890",
				https_proxy: "http://127.0.0.1:7891",
				no_proxy: "example.test, .internal",
			}),
		).toEqual({
			proxyBypassList: "example.test;.internal;<local>;localhost;127.0.0.1;::1",
			proxyServer: "http=http://127.0.0.1:7890;https=http://127.0.0.1:7891",
		});
	});

	it("uses an http proxy for https requests when only http_proxy is set", () => {
		expect(
			createDesktopProxyCommandLineConfig({
				http_proxy: "127.0.0.1:7890",
			})?.proxyServer,
		).toBe("http=http://127.0.0.1:7890;https=http://127.0.0.1:7890");
	});

	it("uses all_proxy when protocol-specific proxies are absent", () => {
		expect(
			createDesktopProxyCommandLineConfig({
				all_proxy: "socks5://127.0.0.1:7890",
			}),
		).toEqual({
			proxyBypassList: "<local>;localhost;127.0.0.1;::1",
			proxyServer: "socks5://127.0.0.1:7890",
		});
	});

	it("prefers a SOCKS all_proxy when shell protocol proxies share the same endpoint", () => {
		expect(
			createDesktopProxyCommandLineConfig({
				all_proxy: "socks5://127.0.0.1:7890",
				http_proxy: "http://127.0.0.1:7890",
				https_proxy: "http://127.0.0.1:7890",
			}),
		).toEqual({
			proxyBypassList: "<local>;localhost;127.0.0.1;::1",
			proxyServer: "socks5://127.0.0.1:7890",
		});
	});

	it("does not install Chromium proxy switches when no proxy is configured", () => {
		const appendSwitch = vi.fn();

		expect(installDesktopProxyFromEnvironment({ appendSwitch }, {})).toBeUndefined();
		expect(appendSwitch).not.toHaveBeenCalled();
	});

	it("installs proxy switches before Chromium sessions are created", () => {
		const appendSwitch = vi.fn();

		const config = installDesktopProxyFromEnvironment(
			{ appendSwitch },
			{
				https_proxy: "http://127.0.0.1:7890",
			},
		);

		expect(config?.proxyServer).toBe("http=http://127.0.0.1:7890;https=http://127.0.0.1:7890");
		expect(appendSwitch).toHaveBeenCalledWith(
			"proxy-server",
			"http=http://127.0.0.1:7890;https=http://127.0.0.1:7890",
		);
		expect(appendSwitch).toHaveBeenCalledWith("proxy-bypass-list", "<local>;localhost;127.0.0.1;::1");
	});

	it("creates Electron session proxy config from the same environment rules", () => {
		expect(
			createDesktopProxySessionConfig({
				all_proxy: "socks5://127.0.0.1:7890",
			}),
		).toEqual({
			mode: "fixed_servers",
			proxyBypassRules: "<local>;localhost;127.0.0.1;::1",
			proxyRules: "socks5://127.0.0.1:7890",
		});
	});

	it("applies proxy rules to a target Electron session", async () => {
		const closeAllConnections = vi.fn().mockResolvedValue(undefined);
		const forceReloadProxyConfig = vi.fn().mockResolvedValue(undefined);
		const setProxy = vi.fn().mockResolvedValue(undefined);

		const config = await applyDesktopProxyToSession(
			{ closeAllConnections, forceReloadProxyConfig, setProxy },
			{
				all_proxy: "socks5://127.0.0.1:7890",
			},
		);

		expect(config?.proxyRules).toBe("socks5://127.0.0.1:7890");
		expect(setProxy).toHaveBeenCalledWith({
			mode: "fixed_servers",
			proxyBypassRules: "<local>;localhost;127.0.0.1;::1",
			proxyRules: "socks5://127.0.0.1:7890",
		});
		expect(forceReloadProxyConfig).toHaveBeenCalled();
		expect(closeAllConnections).toHaveBeenCalled();
	});
});
