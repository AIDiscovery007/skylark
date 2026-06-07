import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	applyContentSecurityPolicy,
	bindFirstInteractiveShowGate,
	buildMainWindowOptions,
	buildSettingsWindowOptions,
	captureDesktopWindowState,
	DESKTOP_CONTENT_SECURITY_POLICY,
	getPreloadEntryPath,
} from "../../src/main/create-window.ts";

describe("buildMainWindowOptions", () => {
	it("enforces Electron security defaults", () => {
		const options = buildMainWindowOptions("/tmp/preload.js");

		expect(options.webPreferences?.preload).toBe("/tmp/preload.js");
		expect(options.webPreferences?.contextIsolation).toBe(true);
		expect(options.webPreferences?.nodeIntegration).toBe(false);
		expect(options.webPreferences?.sandbox).toBe(true);
		expect(options.webPreferences?.webSecurity).toBe(true);
	});

	it("uses restored bounds and macOS native window chrome for the main window", () => {
		const options = buildMainWindowOptions("/tmp/preload.js", {
			height: 980,
			isFullScreen: true,
			isMaximized: true,
			width: 1500,
			x: 80,
			y: 64,
		});

		expect(options).toMatchObject({
			height: 980,
			minHeight: 640,
			minWidth: 960,
			show: false,
			title: "Skylark",
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 16, y: 16 },
			visualEffectState: "followWindow",
			vibrancy: "sidebar",
			width: 1500,
			x: 80,
			y: 64,
		});
		expect(options.webPreferences?.preload).toBe("/tmp/preload.js");
	});

	it("ignores invalid restored bounds that would create a broken window", () => {
		const options = buildMainWindowOptions("/tmp/preload.js", {
			height: 120,
			width: 300,
			x: Number.NaN,
			y: 40,
		});

		expect(options.width).toBe(1440);
		expect(options.height).toBe(920);
		expect(options.x).toBeUndefined();
		expect(options.y).toBeUndefined();
	});

	it("builds a separate settings window with native chrome and stable defaults", () => {
		const options = buildSettingsWindowOptions("/tmp/preload.js", {
			height: 760,
			width: 920,
			x: 120,
			y: 90,
		});

		expect(options).toMatchObject({
			height: 760,
			minHeight: 560,
			minWidth: 760,
			show: false,
			title: "Settings",
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 16, y: 16 },
			width: 920,
			x: 120,
			y: 90,
		});
		expect(options.webPreferences?.preload).toBe("/tmp/preload.js");
	});

	it("captures restorable normal bounds without exposing transient fullscreen dimensions", () => {
		const windowState = captureDesktopWindowState({
			getNormalBounds: () => ({ height: 900, width: 1320, x: 42, y: 51 }),
			isFullScreen: () => true,
			isMaximized: () => false,
		});

		expect(windowState).toEqual({
			height: 900,
			isFullScreen: true,
			isMaximized: false,
			width: 1320,
			x: 42,
			y: 51,
		});
	});

	it("waits for Electron readiness and renderer first-interactive before showing", () => {
		let readyToShowHandler: (() => void) | undefined;
		const show = vi.fn();
		const gate = bindFirstInteractiveShowGate({
			isDestroyed: () => false,
			once: vi.fn((event: "ready-to-show", handler: () => void) => {
				expect(event).toBe("ready-to-show");
				readyToShowHandler = handler;
			}),
			show,
			webContents: { id: 7 },
		});

		gate.notifyFirstInteractive(7);
		expect(show).not.toHaveBeenCalled();

		readyToShowHandler?.();
		expect(show).toHaveBeenCalledTimes(1);
	});

	it("falls back to showing after ready-to-show when first-interactive is missing", () => {
		vi.useFakeTimers();
		let readyToShowHandler: (() => void) | undefined;
		const show = vi.fn();

		bindFirstInteractiveShowGate(
			{
				isDestroyed: () => false,
				once: vi.fn((_event: "ready-to-show", handler: () => void) => {
					readyToShowHandler = handler;
				}),
				show,
				webContents: { id: 9 },
			},
			{ timeoutMs: 250 },
		);

		readyToShowHandler?.();
		expect(show).not.toHaveBeenCalled();

		vi.advanceTimersByTime(250);
		expect(show).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});

	it("sets a restrictive production CSP header", () => {
		type HeadersReceivedCallback = (response: { responseHeaders: Record<string, string[]> }) => void;
		const callback = vi.fn<HeadersReceivedCallback>();
		const onHeadersReceived = vi.fn(
			(
				handler: (
					details: { responseHeaders: Record<string, string[]> },
					callback: HeadersReceivedCallback,
				) => void,
			) => {
				handler({ responseHeaders: { "X-Test": ["ok"] } }, callback);
			},
		);
		const mainWindow = {
			webContents: {
				session: {
					webRequest: {
						onHeadersReceived,
					},
				},
			},
		};

		applyContentSecurityPolicy(mainWindow as unknown as Parameters<typeof applyContentSecurityPolicy>[0]);

		expect(onHeadersReceived).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith({
			responseHeaders: {
				"X-Test": ["ok"],
				"Content-Security-Policy": [DESKTOP_CONTENT_SECURITY_POLICY],
			},
		});
		expect(DESKTOP_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
		expect(DESKTOP_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
		expect(DESKTOP_CONTENT_SECURITY_POLICY).toContain("frame-src 'self' http: https: skylark-preview:");
	});

	it("prefers a CommonJS preload entry when it exists", () => {
		const tempRoot = mkdtempSync(join(tmpdir(), "desktop-ai-agent-preload-"));
		const baseDir = join(tempRoot, "out/main");
		const preloadDir = join(tempRoot, "out/preload");
		const cjsPreloadPath = join(preloadDir, "index.cjs");
		const esmPreloadPath = join(preloadDir, "index.mjs");

		mkdirSync(baseDir, { recursive: true });
		mkdirSync(preloadDir, { recursive: true });
		writeFileSync(esmPreloadPath, "");
		writeFileSync(cjsPreloadPath, "");

		expect(getPreloadEntryPath(baseDir)).toBe(cjsPreloadPath);
	});

	it("falls back to the CommonJS preload path when no build output exists yet", () => {
		expect(getPreloadEntryPath("/tmp/out/main")).toBe("/tmp/out/preload/index.cjs");
	});
});
