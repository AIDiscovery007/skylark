import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	app as electronApp,
	type LoadFileOptions,
	Menu,
	type MenuItemConstructorOptions,
	type Rectangle,
} from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import type { DesktopSettingsOpenRequest, DesktopWindowKind, DesktopWindowState } from "../../shared/types.ts";
import { buildDesktopAboutPanelOptions, DESKTOP_PRODUCT_NAME } from "../app-identity.ts";
import {
	applyContentSecurityPolicy,
	bindFirstInteractiveShowGate,
	buildMainWindowOptions,
	buildSettingsWindowOptions,
	captureDesktopWindowState,
	type FirstInteractiveShowGate,
	getPreloadEntryPath,
} from "../create-window.ts";

export type DesktopRendererView = "chat" | "settings";
const RENDERER_ENTRY_CANDIDATES = ["../renderer/index.html", "../../renderer/index.html"] as const;
const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));

export interface DesktopManagedBrowserWindow {
	readonly webContents: {
		id: number;
		on?: BrowserWindow["webContents"]["on"];
		send?: BrowserWindow["webContents"]["send"];
		session?: BrowserWindow["webContents"]["session"];
		setWindowOpenHandler?: BrowserWindow["webContents"]["setWindowOpenHandler"];
	};
	focus(): void;
	getNormalBounds(): Rectangle;
	isDestroyed(): boolean;
	isFullScreen(): boolean;
	isMaximized(): boolean;
	isMinimized(): boolean;
	loadFile(filePath: string, options?: LoadFileOptions): Promise<void>;
	loadURL(url: string): Promise<void>;
	on(event: "close" | "closed", listener: () => void): void;
	once(event: "ready-to-show", listener: () => void): void;
	restore(): void;
	show(): void;
}

export interface DesktopWindowManagerOptions {
	createBrowserWindow?: (options: BrowserWindowConstructorOptions) => DesktopManagedBrowserWindow;
	getPreloadPath?: () => string;
	getWindowState(kind: DesktopWindowKind): DesktopWindowState | undefined;
	rendererFilePath?: string;
	rendererUrl?: string;
	saveWindowState(kind: DesktopWindowKind, state: DesktopWindowState): Promise<void> | void;
}

export interface DesktopWindowManager {
	focusMainWindow(): DesktopManagedBrowserWindow;
	notifyFirstInteractive(webContentsId: number): void;
	openMainWindow(): DesktopManagedBrowserWindow;
	openSettingsWindow(request?: DesktopSettingsOpenRequest): DesktopManagedBrowserWindow;
}

export interface DesktopMenuCommandHandlers {
	openSettingsWindow(): void;
}

export interface DesktopAboutPanelApp {
	getVersion(): string;
	setAboutPanelOptions(options: ReturnType<typeof buildDesktopAboutPanelOptions>): void;
}

function defaultCreateBrowserWindow(options: BrowserWindowConstructorOptions): DesktopManagedBrowserWindow {
	return new BrowserWindow(options);
}

function focusWindow(window: DesktopManagedBrowserWindow): void {
	if (window.isMinimized()) {
		window.restore();
	}
	window.focus();
}

function configureNavigationGuards(window: DesktopManagedBrowserWindow): void {
	window.webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
	window.webContents.on?.("will-navigate", (event) => {
		event.preventDefault();
	});
}

function loadRendererView(
	window: DesktopManagedBrowserWindow,
	input: {
		rendererFilePath?: string;
		rendererUrl?: string;
		settingsOpenRequest?: DesktopSettingsOpenRequest;
		view: DesktopRendererView;
	},
): void {
	if (input.rendererUrl) {
		const url = new URL(input.rendererUrl);
		url.searchParams.set("view", input.view);
		if (input.settingsOpenRequest?.section) {
			url.searchParams.set("settingsSection", input.settingsOpenRequest.section);
		}
		if (input.settingsOpenRequest?.providerId) {
			url.searchParams.set("providerId", input.settingsOpenRequest.providerId);
		}
		void window.loadURL(url.toString());
		return;
	}

	if (!input.rendererFilePath) {
		throw new Error("Desktop renderer file path is required when ELECTRON_RENDERER_URL is not set.");
	}
	void window.loadFile(input.rendererFilePath, {
		query: {
			view: input.view,
			...(input.settingsOpenRequest?.section ? { settingsSection: input.settingsOpenRequest.section } : {}),
			...(input.settingsOpenRequest?.providerId ? { providerId: input.settingsOpenRequest.providerId } : {}),
		},
	});
}

export function getRendererEntryPath(baseDir: string = MODULE_DIR): string {
	for (const relativePath of RENDERER_ENTRY_CANDIDATES) {
		const rendererPath = join(baseDir, relativePath);
		if (existsSync(rendererPath)) {
			return rendererPath;
		}
	}

	return join(baseDir, RENDERER_ENTRY_CANDIDATES[0]);
}

function getRendererFilePath(rendererFilePath: string | undefined): string | undefined {
	return rendererFilePath ?? getRendererEntryPath();
}

export function createDesktopWindowManager(options: DesktopWindowManagerOptions): DesktopWindowManager {
	const createBrowserWindow = options.createBrowserWindow ?? defaultCreateBrowserWindow;
	const getPreloadPath = options.getPreloadPath ?? getPreloadEntryPath;
	const rendererFilePath = getRendererFilePath(options.rendererFilePath);
	const rendererUrl = options.rendererUrl ?? process.env.ELECTRON_RENDERER_URL;
	let mainWindow: DesktopManagedBrowserWindow | undefined;
	let settingsWindow: DesktopManagedBrowserWindow | undefined;
	const showGates = new Map<number, FirstInteractiveShowGate>();

	function wireWindow(kind: DesktopWindowKind, window: DesktopManagedBrowserWindow): void {
		const webContentsId = window.webContents.id;
		const showGate = bindFirstInteractiveShowGate(window);
		showGates.set(webContentsId, showGate);
		configureNavigationGuards(window);
		window.on("close", () => {
			void Promise.resolve(options.saveWindowState(kind, captureDesktopWindowState(window))).catch(() => undefined);
		});
		window.on("closed", () => {
			showGates.delete(webContentsId);
			if (kind === "main") {
				mainWindow = undefined;
			} else {
				settingsWindow = undefined;
			}
		});
		if (!rendererUrl) {
			if (window.webContents.session) {
				applyContentSecurityPolicy(window as BrowserWindow);
			}
		}
	}

	function openWindow(
		kind: DesktopWindowKind,
		settingsOpenRequest?: DesktopSettingsOpenRequest,
	): DesktopManagedBrowserWindow {
		const currentWindow = kind === "main" ? mainWindow : settingsWindow;
		if (currentWindow && !currentWindow.isDestroyed()) {
			focusWindow(currentWindow);
			if (kind === "settings" && settingsOpenRequest) {
				currentWindow.webContents.send?.(IPC_CHANNELS.settingsNavigationRequest, settingsOpenRequest);
			}
			return currentWindow;
		}

		const preloadPath = getPreloadPath();
		const window =
			kind === "main"
				? createBrowserWindow(buildMainWindowOptions(preloadPath, options.getWindowState(kind)))
				: createBrowserWindow(buildSettingsWindowOptions(preloadPath, options.getWindowState(kind)));
		if (kind === "main") {
			mainWindow = window;
		} else {
			settingsWindow = window;
		}
		wireWindow(kind, window);
		loadRendererView(window, {
			rendererFilePath,
			rendererUrl,
			settingsOpenRequest: kind === "settings" ? settingsOpenRequest : undefined,
			view: kind === "main" ? "chat" : "settings",
		});
		return window;
	}

	return {
		focusMainWindow(): DesktopManagedBrowserWindow {
			return openWindow("main");
		},
		notifyFirstInteractive(webContentsId: number): void {
			showGates.get(webContentsId)?.notifyFirstInteractive(webContentsId);
		},
		openMainWindow(): DesktopManagedBrowserWindow {
			return openWindow("main");
		},
		openSettingsWindow(request?: DesktopSettingsOpenRequest): DesktopManagedBrowserWindow {
			return openWindow("settings", request);
		},
	};
}

export function buildDesktopApplicationMenuTemplate(
	handlers: DesktopMenuCommandHandlers,
	applicationName = DESKTOP_PRODUCT_NAME,
): MenuItemConstructorOptions[] {
	return [
		{
			label: applicationName,
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{
					accelerator: "Command+,",
					click: handlers.openSettingsWindow,
					label: "Settings...",
				},
				{ type: "separator" },
				{ role: "hide" },
				{ role: "quit" },
			],
		},
		{
			label: "File",
			submenu: [{ role: "close" }],
		},
		{ role: "editMenu" },
		{ role: "viewMenu" },
		{ role: "windowMenu" },
	];
}

export function installDesktopAboutPanel(
	app: DesktopAboutPanelApp = electronApp as unknown as DesktopAboutPanelApp,
): void {
	app.setAboutPanelOptions(buildDesktopAboutPanelOptions(app));
}

export function installDesktopApplicationMenu(handlers: DesktopMenuCommandHandlers): void {
	installDesktopAboutPanel();
	Menu.setApplicationMenu(Menu.buildFromTemplate(buildDesktopApplicationMenuTemplate(handlers)));
}
