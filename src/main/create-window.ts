import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, type BrowserWindowConstructorOptions, type Rectangle } from "electron";
import type { DesktopWindowState } from "../shared/types.ts";
import { DESKTOP_PRODUCT_NAME } from "./app-identity.ts";
import { markMainPerformance, measureMainPerformance } from "./performance.ts";

const PRELOAD_ENTRY_CANDIDATES = ["../preload/index.cjs", "../preload/index.js", "../preload/index.mjs"] as const;
const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const MAIN_WINDOW_DEFAULT_SIZE = { width: 1440, height: 920 };
const MAIN_WINDOW_MIN_SIZE = { width: 960, height: 640 };
const SETTINGS_WINDOW_DEFAULT_SIZE = { width: 900, height: 720 };
const SETTINGS_WINDOW_MIN_SIZE = { width: 760, height: 560 };
const DEFAULT_FIRST_INTERACTIVE_SHOW_TIMEOUT_MS = 1_200;
const MACOS_NATIVE_CHROME_OPTIONS = {
	titleBarStyle: "hiddenInset",
	trafficLightPosition: { x: 16, y: 16 },
	vibrancy: "sidebar",
	visualEffectState: "followWindow",
} satisfies Pick<
	BrowserWindowConstructorOptions,
	"titleBarStyle" | "trafficLightPosition" | "vibrancy" | "visualEffectState"
>;
export const DESKTOP_CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"connect-src 'self'",
	"img-src 'self' data: blob:",
	"frame-src 'self' http: https:",
	"font-src 'self' data:",
	"worker-src 'self' blob:",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
].join("; ");

export function getPreloadEntryPath(baseDir: string = MODULE_DIR): string {
	for (const relativePath of PRELOAD_ENTRY_CANDIDATES) {
		const preloadPath = join(baseDir, relativePath);
		if (existsSync(preloadPath)) {
			return preloadPath;
		}
	}

	return join(baseDir, PRELOAD_ENTRY_CANDIDATES[0]);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function buildRestoredBounds(
	state: DesktopWindowState | undefined,
	minSize: { width: number; height: number },
	defaultSize: { width: number; height: number },
): Pick<BrowserWindowConstructorOptions, "height" | "width" | "x" | "y"> {
	if (!state || !isFiniteNumber(state.width) || !isFiniteNumber(state.height)) {
		return defaultSize;
	}
	const width = Math.round(state.width);
	const height = Math.round(state.height);
	if (width < minSize.width || height < minSize.height) {
		return defaultSize;
	}
	const x = isFiniteNumber(state.x) ? Math.round(state.x) : undefined;
	const y = isFiniteNumber(state.y) ? Math.round(state.y) : undefined;
	return {
		height,
		width,
		...(x !== undefined && y !== undefined ? { x, y } : {}),
	};
}

function buildSecureWebPreferences(
	preloadPath: string,
): NonNullable<BrowserWindowConstructorOptions["webPreferences"]> {
	return {
		preload: preloadPath,
		contextIsolation: true,
		nodeIntegration: false,
		sandbox: true,
		webSecurity: true,
	};
}

export interface DesktopWindowStateSource {
	getNormalBounds(): Rectangle;
	isFullScreen(): boolean;
	isMaximized(): boolean;
}

export interface FirstInteractiveShowGateWindow {
	webContents: { id: number };
	once(event: "ready-to-show", listener: () => void): void;
	show(): void;
	isDestroyed?(): boolean;
}

export interface FirstInteractiveShowGate {
	notifyFirstInteractive(webContentsId: number): void;
}

export function bindFirstInteractiveShowGate(
	window: FirstInteractiveShowGateWindow,
	options: {
		onReadyToShow?: () => void;
		timeoutMs?: number;
	} = {},
): FirstInteractiveShowGate {
	let isReadyToShow = false;
	let isRendererInteractive = false;
	let didShow = false;
	const timeout = setTimeout(() => {
		isRendererInteractive = true;
		showIfReady();
	}, options.timeoutMs ?? DEFAULT_FIRST_INTERACTIVE_SHOW_TIMEOUT_MS);
	timeout.unref?.();

	function showIfReady(): void {
		if (didShow || !isReadyToShow || !isRendererInteractive || window.isDestroyed?.()) {
			return;
		}
		didShow = true;
		clearTimeout(timeout);
		window.show();
	}

	window.once("ready-to-show", () => {
		isReadyToShow = true;
		options.onReadyToShow?.();
		showIfReady();
	});

	return {
		notifyFirstInteractive(webContentsId: number): void {
			if (webContentsId !== window.webContents.id) {
				return;
			}
			isRendererInteractive = true;
			showIfReady();
		},
	};
}

export function captureDesktopWindowState(window: DesktopWindowStateSource): DesktopWindowState {
	const bounds = window.getNormalBounds();
	return {
		height: bounds.height,
		isFullScreen: window.isFullScreen(),
		isMaximized: window.isMaximized(),
		width: bounds.width,
		x: bounds.x,
		y: bounds.y,
	};
}

export function buildMainWindowOptions(
	preloadPath: string,
	restoredState?: DesktopWindowState,
): BrowserWindowConstructorOptions {
	return {
		...buildRestoredBounds(restoredState, MAIN_WINDOW_MIN_SIZE, MAIN_WINDOW_DEFAULT_SIZE),
		minWidth: MAIN_WINDOW_MIN_SIZE.width,
		minHeight: MAIN_WINDOW_MIN_SIZE.height,
		show: false,
		title: DESKTOP_PRODUCT_NAME,
		backgroundColor: "#0b1020",
		...MACOS_NATIVE_CHROME_OPTIONS,
		webPreferences: buildSecureWebPreferences(preloadPath),
	};
}

export function buildSettingsWindowOptions(
	preloadPath: string,
	restoredState?: DesktopWindowState,
): BrowserWindowConstructorOptions {
	return {
		...buildRestoredBounds(restoredState, SETTINGS_WINDOW_MIN_SIZE, SETTINGS_WINDOW_DEFAULT_SIZE),
		minWidth: SETTINGS_WINDOW_MIN_SIZE.width,
		minHeight: SETTINGS_WINDOW_MIN_SIZE.height,
		show: false,
		title: "Settings",
		backgroundColor: "#0b1020",
		...MACOS_NATIVE_CHROME_OPTIONS,
		webPreferences: buildSecureWebPreferences(preloadPath),
	};
}

export function applyContentSecurityPolicy(mainWindow: BrowserWindow): void {
	mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": [DESKTOP_CONTENT_SECURITY_POLICY],
			},
		});
	});
}

export function createMainWindow(): BrowserWindow {
	markMainPerformance("main:window:create:start");
	const preloadPath = getPreloadEntryPath();
	const mainWindow = new BrowserWindow(buildMainWindowOptions(preloadPath));
	const isDevelopmentRenderer = Boolean(process.env.ELECTRON_RENDERER_URL);

	bindFirstInteractiveShowGate(mainWindow, {
		onReadyToShow: () => {
			markMainPerformance("main:window:ready-to-show");
			measureMainPerformance("main window ready to show", "main:window:create:start", "main:window:ready-to-show");
		},
	});

	mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	mainWindow.webContents.on("will-navigate", (event) => {
		event.preventDefault();
	});

	if (!isDevelopmentRenderer) {
		applyContentSecurityPolicy(mainWindow);
	}

	if (process.env.ELECTRON_RENDERER_URL) {
		void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		void mainWindow.loadFile(join(MODULE_DIR, "../renderer/index.html"));
	}

	return mainWindow;
}
