import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
	buildDesktopApplicationMenuTemplate,
	createDesktopWindowManager,
	type DesktopManagedBrowserWindow,
	getRendererEntryPath,
	installDesktopAboutPanel,
} from "../../src/main/window/desktop-window-manager.ts";
import { IPC_CHANNELS } from "../../src/shared/ipc-contract.ts";
import type { DesktopWindowKind, DesktopWindowState } from "../../src/shared/types.ts";

class FakeManagedWindow implements DesktopManagedBrowserWindow {
	readonly loadFile = vi.fn(async () => undefined);
	readonly loadURL = vi.fn(async () => undefined);
	readonly show = vi.fn();
	readonly focus = vi.fn();
	readonly restore = vi.fn();
	readonly send = vi.fn((_channel: string, ..._args: unknown[]) => undefined);
	private readonly webContentsValue: { id: number; send: (channel: string, ...args: unknown[]) => void };
	private readonly listeners = new Map<string, Array<() => void>>();
	private destroyed = false;
	private minimized = false;

	constructor(webContentsId: number) {
		this.webContentsValue = { id: webContentsId, send: this.send };
	}

	get webContents(): { id: number; send: (channel: string, ...args: unknown[]) => void } {
		if (this.destroyed) {
			throw new Error("webContents was accessed after window destruction");
		}
		return this.webContentsValue;
	}

	once(event: "ready-to-show", listener: () => void): void {
		this.on(event, listener);
	}

	on(event: "close" | "closed" | "ready-to-show", listener: () => void): void {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
	}

	emit(event: "close" | "closed" | "ready-to-show"): void {
		for (const listener of this.listeners.get(event) ?? []) {
			listener();
		}
	}

	getNormalBounds(): Electron.Rectangle {
		return { height: 760, width: 920, x: 120, y: 90 };
	}

	isDestroyed(): boolean {
		return this.destroyed;
	}

	isFullScreen(): boolean {
		return false;
	}

	isMaximized(): boolean {
		return true;
	}

	isMinimized(): boolean {
		return this.minimized;
	}

	markDestroyed(): void {
		this.destroyed = true;
	}

	markMinimized(): void {
		this.minimized = true;
	}
}

describe("DesktopWindowManager", () => {
	it("resolves the packaged renderer entry from the bundled main output directory", () => {
		const tempDir = join(tmpdir(), `desktop-renderer-entry-${process.pid}-${Date.now()}`);
		const mainDir = join(tempDir, "out", "main");
		const rendererDir = join(tempDir, "out", "renderer");
		mkdirSync(mainDir, { recursive: true });
		mkdirSync(rendererDir, { recursive: true });
		writeFileSync(join(rendererDir, "index.html"), "<div></div>");

		try {
			expect(getRendererEntryPath(mainDir)).toBe(join(rendererDir, "index.html"));
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	it("opens the main and settings windows as distinct renderer views and reuses live windows", () => {
		const windows: FakeManagedWindow[] = [];
		const factory = vi.fn((options: BrowserWindowConstructorOptions) => {
			const window = new FakeManagedWindow(windows.length + 1);
			windows.push(window);
			expect(options.webPreferences?.preload).toBe("/tmp/preload.js");
			return window;
		});
		const manager = createDesktopWindowManager({
			createBrowserWindow: factory,
			getPreloadPath: () => "/tmp/preload.js",
			getWindowState: (kind) => (kind === "settings" ? { height: 760, width: 920, x: 120, y: 90 } : undefined),
			rendererUrl: "http://localhost:5173",
			saveWindowState: vi.fn(),
		});

		const mainWindow = manager.openMainWindow();
		const settingsWindow = manager.openSettingsWindow({ section: "credentials", providerId: "openai" });
		const reusedSettingsWindow = manager.openSettingsWindow({ section: "credentials", providerId: "anthropic" });

		expect(mainWindow).toBe(windows[0]);
		expect(settingsWindow).toBe(windows[1]);
		expect(reusedSettingsWindow).toBe(settingsWindow);
		expect(factory).toHaveBeenCalledTimes(2);
		expect(windows[0]?.loadURL).toHaveBeenCalledWith("http://localhost:5173/?view=chat");
		expect(windows[1]?.loadURL).toHaveBeenCalledWith(
			"http://localhost:5173/?view=settings&settingsSection=credentials&providerId=openai",
		);
		expect(windows[1]?.focus).toHaveBeenCalledTimes(1);
		expect(windows[1]?.send).toHaveBeenCalledWith(IPC_CHANNELS.settingsNavigationRequest, {
			section: "credentials",
			providerId: "anthropic",
		});
	});

	it("persists normal bounds when a managed window closes", () => {
		const savedStates: Array<{ kind: DesktopWindowKind; state: DesktopWindowState }> = [];
		const window = new FakeManagedWindow(10);
		const manager = createDesktopWindowManager({
			createBrowserWindow: () => window,
			getPreloadPath: () => "/tmp/preload.js",
			getWindowState: () => undefined,
			rendererFilePath: "/tmp/renderer/index.html",
			saveWindowState: (kind, state) => {
				savedStates.push({ kind, state });
			},
		});

		manager.openSettingsWindow();
		window.emit("close");
		window.markDestroyed();
		expect(() => window.emit("closed")).not.toThrow();

		expect(savedStates).toEqual([
			{
				kind: "settings",
				state: {
					height: 760,
					isFullScreen: false,
					isMaximized: true,
					width: 920,
					x: 120,
					y: 90,
				},
			},
		]);
	});

	it("builds a desktop menu with native settings, close, hide, and quit commands", () => {
		const openSettingsWindow = vi.fn();
		const template = buildDesktopApplicationMenuTemplate({ openSettingsWindow });
		const appMenu = template[0];
		const fileMenu = template[1];

		expect(appMenu?.submenu).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					accelerator: "Command+,",
					click: openSettingsWindow,
					label: "Settings...",
				}),
				expect.objectContaining({ role: "hide" }),
				expect.objectContaining({ role: "quit" }),
			]),
		);
		expect(fileMenu?.submenu).toEqual(expect.arrayContaining([expect.objectContaining({ role: "close" })]));
	});

	it("configures the macOS About panel with Skylark attribution", () => {
		const app = { getVersion: vi.fn(() => "0.2.0"), setAboutPanelOptions: vi.fn() };

		installDesktopAboutPanel(app);

		expect(app.getVersion).toHaveBeenCalled();
		expect(app.setAboutPanelOptions).toHaveBeenCalledWith(
			expect.objectContaining({
				applicationName: "Skylark",
				applicationVersion: "0.2.0",
				credits: expect.stringContaining("badlogic/pi-mono"),
				version: "0.2.0",
			}),
		);
	});
});
