import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DesktopWebPreviewViewService } from "../../src/main/preview/web-preview-view-service.ts";
import type { DesktopWebPreviewEvent } from "../../src/shared/types.ts";

class FakeNavigationHistory {
	constructor(private readonly webContents: FakeWebContents) {}

	canGoBack(): boolean {
		return this.webContents.activeIndex > 0;
	}

	canGoForward(): boolean {
		return this.webContents.activeIndex < this.webContents.entries.length - 1;
	}

	goBack(): void {
		if (!this.canGoBack()) {
			return;
		}
		this.webContents.activeIndex -= 1;
		this.webContents.url = this.webContents.entries[this.webContents.activeIndex] ?? "";
		this.webContents.emit("did-navigate", {}, this.webContents.url);
	}

	goForward(): void {
		if (!this.canGoForward()) {
			return;
		}
		this.webContents.activeIndex += 1;
		this.webContents.url = this.webContents.entries[this.webContents.activeIndex] ?? "";
		this.webContents.emit("did-navigate", {}, this.webContents.url);
	}
}

class FakeWebContents extends EventEmitter {
	activeIndex = -1;
	deferNavigation = false;
	entries: string[] = [];
	isClosed = false;
	isLoadingValue = false;
	navigationHistory = new FakeNavigationHistory(this);
	scripts: string[] = [];
	snapshotDataUrl = "data:image/png;base64,preview";
	session = {
		clearCache: vi.fn(async () => undefined),
		clearStorageData: vi.fn(async () => undefined),
	};
	title = "";
	url = "";
	private pendingLoadReject?: (error: unknown) => void;
	private readonly scriptResolvers: Array<(value: unknown) => void> = [];
	private windowOpenHandler?: (details: { url: string }) => { action: "allow" | "deny" };

	async loadURL(url: string): Promise<void> {
		this.isLoadingValue = true;
		this.emit("did-start-loading");
		this.entries = [...this.entries.slice(0, this.activeIndex + 1), url];
		this.activeIndex = this.entries.length - 1;
		if (this.deferNavigation) {
			return new Promise((_resolve, reject) => {
				this.pendingLoadReject = reject;
			});
		}
		this.url = url;
		this.title = url.includes("youtube") ? "YouTube" : "Preview";
		this.emit("did-navigate", {}, url);
		this.emit("page-title-updated");
		this.isLoadingValue = false;
		this.emit("did-stop-loading");
	}

	reload(): void {
		this.emit("did-start-loading");
		this.emit("did-stop-loading");
	}

	stop(): void {
		this.isLoadingValue = false;
		this.emit("did-stop-loading");
	}

	getURL(): string {
		return this.url;
	}

	getTitle(): string {
		return this.title;
	}

	isLoading(): boolean {
		return this.isLoadingValue;
	}

	isDestroyed(): boolean {
		return this.isClosed;
	}

	close(): void {
		this.isClosed = true;
		this.emit("destroyed");
	}

	async capturePage(): Promise<{ toDataURL(): string }> {
		return {
			toDataURL: () => this.snapshotDataUrl,
		};
	}

	executeJavaScript(script: string): Promise<unknown> {
		this.scripts.push(script);
		if (script.includes("current.cancel")) {
			this.resolveScript(null);
			return Promise.resolve(undefined);
		}
		return new Promise((resolve) => {
			this.scriptResolvers.push(resolve);
		});
	}

	resolveScript(value: unknown): void {
		this.scriptResolvers.shift()?.(value);
	}

	rejectPendingLoad(error: unknown): void {
		this.pendingLoadReject?.(error);
		this.pendingLoadReject = undefined;
	}

	setWindowOpenHandler(handler: (details: { url: string }) => { action: "allow" | "deny" }): void {
		this.windowOpenHandler = handler;
	}

	openWindow(url: string): { action: "allow" | "deny" } | undefined {
		return this.windowOpenHandler?.({ url });
	}
}

class FakeView {
	bounds = { height: 0, width: 0, x: 0, y: 0 };
	visible = false;
	webContents = new FakeWebContents();

	setBounds(bounds: typeof this.bounds): void {
		this.bounds = bounds;
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
	}
}

function createFakeWindow() {
	const views = new Set<FakeView>();
	return {
		contentView: {
			addChildView: vi.fn((view: FakeView) => {
				views.add(view);
			}),
			removeChildView: vi.fn((view: FakeView) => {
				views.delete(view);
			}),
		},
		isDestroyed: vi.fn(() => false),
		once: vi.fn(),
		views,
	};
}

function createFakePort() {
	const events: DesktopWebPreviewEvent[] = [];
	return {
		events,
		port: {
			on: vi.fn(),
			postMessage: vi.fn((event: DesktopWebPreviewEvent) => {
				events.push(event);
			}),
			start: vi.fn(),
		},
	};
}

function getLastWebPreviewState(events: DesktopWebPreviewEvent[]) {
	const event = events.at(-1);
	if (event?.type !== "web_preview_state") {
		throw new Error("Expected last web preview event to be state.");
	}
	return event.state;
}

describe("DesktopWebPreviewViewService", () => {
	it("attaches a WebContentsView and publishes state for public URLs", () => {
		const view = new FakeView();
		const window = createFakeWindow();
		const { events, port } = createFakePort();
		const service = new DesktopWebPreviewViewService({
			createView: () => view as never,
		});

		service.openPort(port as never);
		const state = service.show({
			bounds: { height: 320, width: 480, x: 24, y: 88 },
			id: "preview-1",
			url: "youtube.com",
			window: window as never,
		});

		expect(window.contentView.addChildView).toHaveBeenCalledWith(view);
		expect(view.bounds).toEqual({ height: 320, width: 480, x: 24, y: 88 });
		expect(view.visible).toBe(true);
		expect(state.url).toBe("https://youtube.com/");
		expect(getLastWebPreviewState(events).url).toBe("https://youtube.com/");
	});

	it("enables one-shot element selection and publishes the selected element", async () => {
		const view = new FakeView();
		const window = createFakeWindow();
		const { events, port } = createFakePort();
		const service = new DesktopWebPreviewViewService({
			createView: () => view as never,
		});
		service.openPort(port as never);
		service.show({
			bounds: { height: 320, width: 480, x: 24, y: 88 },
			id: "preview-1",
			url: "https://example.com",
			window: window as never,
		});

		const state = service.setElementSelectionMode("preview-1", true);

		expect(state.isSelectingElement).toBe(true);
		expect(view.webContents.scripts.at(-1)).toContain("__skylarkWebPreviewElementSelection");
		view.webContents.resolveScript({
			ariaLabel: "Buy now",
			className: "primary",
			href: "",
			id: "buy",
			selector: "button#buy",
			tagName: "button",
			text: "Buy now",
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(events).toContainEqual({
			id: "preview-1",
			selection: {
				ariaLabel: "Buy now",
				className: "primary",
				href: "",
				id: "buy",
				selector: "button#buy",
				tagName: "button",
				text: "Buy now",
			},
			type: "web_preview_element_selected",
		});
		expect(events.at(-1)?.type).toBe("web_preview_state");
		expect(getLastWebPreviewState(events).isSelectingElement).toBe(false);
	});

	it("supports navigation controls and closes views", () => {
		const view = new FakeView();
		const window = createFakeWindow();
		const service = new DesktopWebPreviewViewService({
			createView: () => view as never,
		});

		expect(() => service.updateBounds("preview-1", { height: 120, width: 240, x: 8, y: 16 })).not.toThrow();
		service.show({
			bounds: { height: 320, width: 480, x: 24, y: 88 },
			id: "preview-1",
			url: "https://google.com",
			window: window as never,
		});
		service.show({
			bounds: { height: 320, width: 480, x: 24, y: 88 },
			id: "preview-1",
			url: "https://youtube.com",
			window: window as never,
		});
		expect(service.control("preview-1", "back").url).toBe("https://google.com/");
		expect(service.control("preview-1", "forward").url).toBe("https://youtube.com/");

		service.close("preview-1");
		expect(() => service.updateBounds("preview-1", { height: 120, width: 240, x: 8, y: 16 })).not.toThrow();
		expect(window.contentView.removeChildView).toHaveBeenCalledWith(view);
		expect(view.webContents.isDestroyed()).toBe(true);
	});

	it("returns a snapshot before hiding the WebContentsView for renderer overlays", async () => {
		const view = new FakeView();
		const window = createFakeWindow();
		const service = new DesktopWebPreviewViewService({
			createView: () => view as never,
		});

		service.show({
			bounds: { height: 320, width: 480, x: 24, y: 88 },
			id: "preview-1",
			url: "https://example.com",
			window: window as never,
		});
		expect(view.visible).toBe(true);

		const snapshot = await service.updateBounds("preview-1", { height: 320, width: 480, x: 24, y: 88 }, true);
		expect(view.bounds).toEqual({ height: 320, width: 480, x: 24, y: 88 });
		expect(view.visible).toBe(false);
		expect(snapshot).toEqual({ dataUrl: "data:image/png;base64,preview" });

		await service.updateBounds("preview-1", { height: 320, width: 480, x: 24, y: 88 }, false);
		expect(view.visible).toBe(true);
	});

	it("keeps the requested URL while Electron still reports the previous page", () => {
		const view = new FakeView();
		const window = createFakeWindow();
		const { events, port } = createFakePort();
		const service = new DesktopWebPreviewViewService({
			createView: () => view as never,
		});
		service.openPort(port as never);

		service.show({
			bounds: { height: 320, width: 480, x: 24, y: 88 },
			id: "preview-1",
			url: "https://youtube.com/",
			window: window as never,
		});
		view.webContents.url = "https://youtube/";
		view.webContents.deferNavigation = true;
		const state = service.show({
			bounds: { height: 320, width: 480, x: 24, y: 88 },
			id: "preview-1",
			url: "google",
			window: window as never,
		});

		expect(view.webContents.getURL()).toBe("https://youtube/");
		expect(state.url).toBe("https://google.com/");
		expect(getLastWebPreviewState(events).url).toBe("https://google.com/");
		const eventCount = events.length;
		view.webContents.emit("did-fail-load", {}, -200, "ERR_CERT_COMMON_NAME_INVALID", "https://youtube/", true);
		expect(events).toHaveLength(eventCount);
		view.webContents.emit("did-navigate", {}, "https://www.youtube.com/");
		expect(events).toHaveLength(eventCount + 1);
		expect(getLastWebPreviewState(events).url).toBe("https://google.com/");
	});

	it("clears the web preview cache and cookies through the preview session", async () => {
		const view = new FakeView();
		const window = createFakeWindow();
		const service = new DesktopWebPreviewViewService({
			createView: () => view as never,
		});
		service.show({
			bounds: { height: 320, width: 480, x: 24, y: 88 },
			id: "preview-1",
			url: "https://example.com",
			window: window as never,
		});

		await service.clearStorage("preview-1", "cache");
		await service.clearStorage("preview-1", "cookies");

		expect(view.webContents.session.clearCache).toHaveBeenCalledTimes(1);
		expect(view.webContents.session.clearStorageData).toHaveBeenCalledWith({ storages: ["cookies"] });
	});

	it("ignores pending load failures after the preview has closed", async () => {
		const view = new FakeView();
		const window = createFakeWindow();
		const { events, port } = createFakePort();
		const service = new DesktopWebPreviewViewService({
			createView: () => view as never,
		});
		service.openPort(port as never);
		view.webContents.deferNavigation = true;
		service.show({
			bounds: { height: 320, width: 480, x: 24, y: 88 },
			id: "preview-1",
			url: "https://example.com",
			window: window as never,
		});
		const eventCount = events.length;

		const webContents = view.webContents;
		service.close("preview-1");
		(view as { webContents?: FakeWebContents }).webContents = undefined;
		webContents.rejectPendingLoad(new Error("ERR_ABORTED"));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(events).toHaveLength(eventCount);
	});

	it("ignores web contents events after the preview has closed", () => {
		const view = new FakeView();
		const window = createFakeWindow();
		const { events, port } = createFakePort();
		const service = new DesktopWebPreviewViewService({
			createView: () => view as never,
		});
		service.openPort(port as never);
		service.show({
			bounds: { height: 320, width: 480, x: 24, y: 88 },
			id: "preview-1",
			url: "https://example.com",
			window: window as never,
		});
		const webContents = view.webContents;

		service.close("preview-1");
		const eventCount = events.length;
		webContents.emit("did-stop-loading");
		webContents.emit("page-title-updated");
		webContents.emit("render-process-gone", {}, { reason: "crashed" });

		expect(events).toHaveLength(eventCount);
	});
});
