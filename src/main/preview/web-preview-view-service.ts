import {
	type BrowserWindow,
	type MessagePortMain,
	type Rectangle,
	session,
	WebContentsView,
	type WebPreferences,
} from "electron";
import { normalizeDesktopWebPreviewUrl } from "../../shared/preview-url.ts";
import type {
	DesktopWebPreviewBounds,
	DesktopWebPreviewControlAction,
	DesktopWebPreviewElementSelection,
	DesktopWebPreviewEvent,
	DesktopWebPreviewSnapshot,
	DesktopWebPreviewState,
	DesktopWebPreviewStorageKind,
} from "../../shared/types.ts";

interface DesktopWebPreviewWindow {
	readonly contentView: Pick<BrowserWindow["contentView"], "addChildView" | "removeChildView">;
	isDestroyed(): boolean;
	once(event: "closed", listener: () => void): void;
}

interface DesktopWebPreviewView {
	readonly webContents?: WebContentsView["webContents"];
	setBounds(bounds: Rectangle): void;
	setVisible(visible: boolean): void;
}

interface DesktopWebPreviewRecord {
	bounds: Rectangle;
	id: string;
	isOccluded: boolean;
	isSelectingElement: boolean;
	requestedNavigationUrl?: string;
	selectionToken: number;
	url: string;
	view: DesktopWebPreviewView;
	window: DesktopWebPreviewWindow;
}

export interface DesktopWebPreviewViewServiceOptions {
	createView?: () => DesktopWebPreviewView;
}

export const DESKTOP_WEB_PREVIEW_PARTITION = "persist:skylark-web-preview";

const WEB_PREVIEW_WEB_PREFERENCES: WebPreferences = {
	contextIsolation: true,
	javascript: true,
	nodeIntegration: false,
	sandbox: true,
	webSecurity: true,
};

function createDefaultWebPreviewView(): DesktopWebPreviewView {
	return new WebContentsView({
		webPreferences: {
			...WEB_PREVIEW_WEB_PREFERENCES,
			session: session.fromPartition(DESKTOP_WEB_PREVIEW_PARTITION),
		},
	});
}

function normalizeBounds(bounds: DesktopWebPreviewBounds): Rectangle {
	return {
		height: Math.max(0, Math.round(bounds.height)),
		width: Math.max(0, Math.round(bounds.width)),
		x: Math.max(0, Math.round(bounds.x)),
		y: Math.max(0, Math.round(bounds.y)),
	};
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getComparableWebPreviewHost(url: string): string | undefined {
	try {
		const parsedUrl = new URL(url);
		return parsedUrl.host.toLowerCase().replace(/^www\./, "");
	} catch {
		return undefined;
	}
}

function isRelatedWebPreviewNavigation(requestedUrl: string, nextUrl: string): boolean {
	if (requestedUrl === nextUrl) {
		return true;
	}
	const requestedHost = getComparableWebPreviewHost(requestedUrl);
	const nextHost = getComparableWebPreviewHost(nextUrl);
	return Boolean(requestedHost && nextHost && requestedHost === nextHost);
}

const ELEMENT_SELECTION_SCRIPT = String.raw`
(() => {
	const key = "__skylarkWebPreviewElementSelection";
	const previous = window[key];
	if (previous && typeof previous.cancel === "function") {
		previous.cancel();
	}
	const buildSelector = (element) => {
		if (!element || element.nodeType !== Node.ELEMENT_NODE) {
			return "";
		}
		const parts = [];
		let current = element;
		while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
			const tagName = current.tagName.toLowerCase();
			if (current.id) {
				parts.unshift(tagName + "#" + CSS.escape(current.id));
				break;
			}
			const parent = current.parentElement;
			const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === current.tagName) : [];
			const index = siblings.length > 1 ? ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : "";
			parts.unshift(tagName + index);
			current = parent;
		}
		return parts.join(" > ");
	};
	const describe = (element) => {
		const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500);
		const href = element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement
			? element.href
			: element.getAttribute("href") || "";
		return {
			ariaLabel: element.getAttribute("aria-label") || "",
			className: typeof element.className === "string" ? element.className.slice(0, 240) : "",
			href,
			id: element.id || "",
			selector: buildSelector(element),
			tagName: element.tagName.toLowerCase(),
			text,
		};
	};
	return new Promise((resolve) => {
		const previousCursor = document.documentElement.style.cursor;
		let highlighted = null;
		let previousOutline = "";
		let previousOutlineOffset = "";
		const clearHighlight = () => {
			if (!highlighted) {
				return;
			}
			highlighted.style.outline = previousOutline;
			highlighted.style.outlineOffset = previousOutlineOffset;
			highlighted = null;
		};
		const cleanup = () => {
			clearHighlight();
			document.documentElement.style.cursor = previousCursor;
			document.removeEventListener("mousemove", handleMove, true);
			document.removeEventListener("click", handleClick, true);
			document.removeEventListener("keydown", handleKeyDown, true);
			delete window[key];
		};
		const finish = (selection) => {
			cleanup();
			resolve(selection);
		};
		const highlight = (element) => {
			if (!element || element === highlighted || element === document.documentElement || element === document.body) {
				return;
			}
			clearHighlight();
			highlighted = element;
			previousOutline = element.style.outline;
			previousOutlineOffset = element.style.outlineOffset;
			element.style.outline = "2px solid #2563eb";
			element.style.outlineOffset = "2px";
		};
		const handleMove = (event) => {
			const target = event.target instanceof Element ? event.target : null;
			if (target) {
				highlight(target);
			}
		};
		const handleClick = (event) => {
			const target = event.target instanceof Element ? event.target : null;
			if (!target) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			finish(describe(target));
		};
		const handleKeyDown = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				finish(null);
			}
		};
		window[key] = { cancel: () => finish(null) };
		document.documentElement.style.cursor = "crosshair";
		document.addEventListener("mousemove", handleMove, true);
		document.addEventListener("click", handleClick, true);
		document.addEventListener("keydown", handleKeyDown, true);
	});
})()
`;

const CANCEL_ELEMENT_SELECTION_SCRIPT = `
(() => {
	const current = window.__skylarkWebPreviewElementSelection;
	if (current && typeof current.cancel === "function") {
		current.cancel();
	}
})()
`;

export class DesktopWebPreviewViewService {
	private readonly createView: () => DesktopWebPreviewView;
	private readonly ports = new Set<MessagePortMain>();
	private readonly records = new Map<string, DesktopWebPreviewRecord>();

	constructor(options: DesktopWebPreviewViewServiceOptions = {}) {
		this.createView = options.createView ?? createDefaultWebPreviewView;
	}

	openPort(port: MessagePortMain): void {
		this.ports.add(port);
		port.start();
		port.on("close", () => {
			this.ports.delete(port);
		});
	}

	show(input: {
		bounds: DesktopWebPreviewBounds;
		id: string;
		occluded?: boolean;
		url: string;
		window: DesktopWebPreviewWindow;
	}): DesktopWebPreviewState {
		const url = this.normalizeUrl(input.url);
		const record = this.ensureRecord(input.id, input.window);
		this.updateRecordPlacement(record, input.bounds, input.occluded);
		if (record.url !== url) {
			this.loadUrl(record, url);
		}
		return this.publishRecordState(record);
	}

	async updateBounds(
		id: string,
		bounds: DesktopWebPreviewBounds,
		occluded?: boolean,
	): Promise<DesktopWebPreviewSnapshot | undefined> {
		const record = this.records.get(id);
		if (!record) {
			return undefined;
		}
		const snapshot = occluded ? await this.captureRecordSnapshot(record) : undefined;
		this.updateRecordPlacement(record, bounds, occluded);
		return snapshot;
	}

	control(id: string, action: DesktopWebPreviewControlAction): DesktopWebPreviewState {
		const record = this.getRecord(id);
		const webContents = record.view.webContents;
		if (!webContents || webContents.isDestroyed()) {
			throw new Error(`Web preview ${id} is not open.`);
		}
		switch (action) {
			case "back":
				if (webContents.navigationHistory.canGoBack()) {
					record.requestedNavigationUrl = undefined;
					webContents.navigationHistory.goBack();
				}
				break;
			case "forward":
				if (webContents.navigationHistory.canGoForward()) {
					record.requestedNavigationUrl = undefined;
					webContents.navigationHistory.goForward();
				}
				break;
			case "reload":
				webContents.reload();
				break;
			case "stop":
				webContents.stop();
				break;
		}
		return this.publishRecordState(record);
	}

	async clearStorage(id: string, storage: DesktopWebPreviewStorageKind): Promise<DesktopWebPreviewState> {
		const record = this.getRecord(id);
		const webContents = record.view.webContents;
		if (!webContents || webContents.isDestroyed()) {
			throw new Error(`Web preview ${id} is not open.`);
		}
		if (storage === "cache") {
			await webContents.session.clearCache();
		} else {
			await webContents.session.clearStorageData({ storages: ["cookies"] });
		}
		if (!this.isRecordOpen(record)) {
			throw new Error(`Web preview ${id} is not open.`);
		}
		return this.publishRecordState(record);
	}

	setElementSelectionMode(id: string, enabled: boolean): DesktopWebPreviewState {
		const record = this.getRecord(id);
		if (record.isSelectingElement === enabled) {
			return this.publishRecordState(record);
		}
		record.isSelectingElement = enabled;
		record.selectionToken += 1;
		const token = record.selectionToken;
		if (enabled) {
			void this.waitForElementSelection(record, token);
		} else {
			const webContents = record.view.webContents;
			if (webContents && !webContents.isDestroyed()) {
				void webContents.executeJavaScript(CANCEL_ELEMENT_SELECTION_SCRIPT, true).catch(() => undefined);
			}
		}
		return this.publishRecordState(record);
	}

	close(id: string): void {
		const record = this.records.get(id);
		if (!record) {
			return;
		}
		this.records.delete(id);
		try {
			record.window.contentView.removeChildView(record.view as unknown as WebContentsView);
		} catch {
			// The containing window may already be closing.
		}
		const webContents = record.view.webContents;
		if (webContents && !webContents.isDestroyed()) {
			record.isSelectingElement = false;
			record.requestedNavigationUrl = undefined;
			record.selectionToken += 1;
			webContents.close({ waitForBeforeUnload: false });
		}
	}

	closeAll(): void {
		for (const id of Array.from(this.records.keys())) {
			this.close(id);
		}
	}

	private ensureRecord(id: string, window: DesktopWebPreviewWindow): DesktopWebPreviewRecord {
		if (window.isDestroyed()) {
			throw new Error("Cannot create web preview for a destroyed window.");
		}
		const currentRecord = this.records.get(id);
		if (currentRecord?.window === window) {
			const webContents = currentRecord.view.webContents;
			if (webContents && !webContents.isDestroyed()) {
				return currentRecord;
			}
		}
		if (currentRecord) {
			this.close(id);
		}

		const view = this.createView();
		const record: DesktopWebPreviewRecord = {
			bounds: { height: 0, width: 0, x: 0, y: 0 },
			id,
			isOccluded: false,
			isSelectingElement: false,
			selectionToken: 0,
			url: "",
			view,
			window,
		};
		this.records.set(id, record);
		window.contentView.addChildView(view as unknown as WebContentsView);
		window.once("closed", () => this.close(id));
		this.wireRecord(record);
		return record;
	}

	private getRecord(id: string): DesktopWebPreviewRecord {
		const record = this.records.get(id);
		const webContents = record?.view.webContents;
		if (!record || !webContents || webContents.isDestroyed()) {
			throw new Error(`Web preview ${id} is not open.`);
		}
		return record;
	}

	private loadUrl(record: DesktopWebPreviewRecord, url: string): void {
		const webContents = record.view.webContents;
		if (!webContents || webContents.isDestroyed()) {
			return;
		}
		record.isSelectingElement = false;
		record.requestedNavigationUrl = url;
		record.selectionToken += 1;
		record.url = url;
		try {
			webContents.stop();
		} catch {
			// The view may already be between navigations.
		}
		void webContents
			.loadURL(url)
			.then(() => {
				if (this.isRecordOpen(record) && record.requestedNavigationUrl === url) {
					record.requestedNavigationUrl = undefined;
				}
			})
			.catch((error: unknown) => {
				if (this.isRecordOpen(record) && (record.requestedNavigationUrl === url || record.url === url)) {
					record.requestedNavigationUrl = undefined;
					this.publishRecordState(record, getErrorMessage(error));
				}
			});
	}

	private updateRecordPlacement(
		record: DesktopWebPreviewRecord,
		bounds: DesktopWebPreviewBounds,
		occluded?: boolean,
	): void {
		const nextBounds = normalizeBounds(bounds);
		record.bounds = nextBounds;
		if (occluded !== undefined) {
			record.isOccluded = occluded;
		}
		record.view.setBounds(nextBounds);
		record.view.setVisible(!record.isOccluded && nextBounds.width > 0 && nextBounds.height > 0);
	}

	private async captureRecordSnapshot(
		record: DesktopWebPreviewRecord,
	): Promise<DesktopWebPreviewSnapshot | undefined> {
		const webContents = record.view.webContents;
		if (!webContents || webContents.isDestroyed() || record.bounds.width <= 0 || record.bounds.height <= 0) {
			return undefined;
		}
		try {
			const image = await webContents.capturePage();
			const dataUrl = image.toDataURL();
			return dataUrl ? { dataUrl } : undefined;
		} catch {
			return undefined;
		}
	}

	private wireRecord(record: DesktopWebPreviewRecord): void {
		const { webContents } = record.view;
		if (!webContents) {
			throw new Error("Web preview view does not expose webContents.");
		}
		const publishCurrentState = (): void => {
			if (!this.isRecordOpen(record)) {
				return;
			}
			this.publishRecordState(record);
		};

		webContents.setWindowOpenHandler(({ url }) => {
			const previewUrl = normalizeDesktopWebPreviewUrl(url);
			if (previewUrl) {
				queueMicrotask(() => {
					if (this.isRecordOpen(record)) {
						this.loadUrl(record, previewUrl);
					}
				});
			}
			return { action: "deny" };
		});
		webContents.on("did-start-loading", publishCurrentState);
		webContents.on("will-navigate", () => {
			if (!this.isRecordOpen(record)) {
				return;
			}
			record.isSelectingElement = false;
			record.selectionToken += 1;
		});
		webContents.on("did-stop-loading", publishCurrentState);
		webContents.on("page-title-updated", publishCurrentState);
		webContents.on("did-navigate", (_event, url) => {
			if (!this.applyNavigatedUrl(record, url)) {
				return;
			}
			publishCurrentState();
		});
		webContents.on("did-navigate-in-page", (_event, url) => {
			if (!this.applyNavigatedUrl(record, url)) {
				return;
			}
			publishCurrentState();
		});
		webContents.on("did-fail-load", (_event, _errorCode, errorDescription, validatedUrl, isMainFrame) => {
			if (!this.isRecordOpen(record)) {
				return;
			}
			if (!isMainFrame) {
				return;
			}
			const failedUrl = normalizeDesktopWebPreviewUrl(validatedUrl);
			if (!failedUrl || failedUrl === record.url) {
				this.publishRecordState(record, errorDescription);
			}
		});
		webContents.on("render-process-gone", (_event, details) => {
			if (!this.isRecordOpen(record)) {
				return;
			}
			this.publishRecordState(record, `Page process ${details.reason}.`);
		});
	}

	private applyNavigatedUrl(record: DesktopWebPreviewRecord, url: string): boolean {
		if (!this.isRecordOpen(record)) {
			return false;
		}
		const nextUrl = normalizeDesktopWebPreviewUrl(url) ?? url;
		if (record.requestedNavigationUrl && !isRelatedWebPreviewNavigation(record.requestedNavigationUrl, nextUrl)) {
			this.publishRecordState(record);
			return false;
		}
		record.url = nextUrl;
		return true;
	}

	private isRecordOpen(record: DesktopWebPreviewRecord): boolean {
		const webContents = record.view.webContents;
		return this.records.get(record.id) === record && Boolean(webContents && !webContents.isDestroyed());
	}

	private normalizeUrl(value: string): string {
		const url = normalizeDesktopWebPreviewUrl(value);
		if (!url) {
			throw new TypeError("Invalid web preview URL: expected an http or https URL.");
		}
		return url;
	}

	private async waitForElementSelection(record: DesktopWebPreviewRecord, token: number): Promise<void> {
		try {
			const webContents = record.view.webContents;
			if (!this.isRecordOpen(record) || !webContents || webContents.isDestroyed()) {
				return;
			}
			const selection = (await webContents.executeJavaScript(
				ELEMENT_SELECTION_SCRIPT,
				true,
			)) as DesktopWebPreviewElementSelection | null;
			if (!this.isRecordOpen(record) || record.selectionToken !== token || !record.isSelectingElement) {
				return;
			}
			record.isSelectingElement = false;
			record.selectionToken += 1;
			if (selection) {
				this.publishElementSelection(record.id, selection);
			}
			this.publishRecordState(record);
		} catch (error: unknown) {
			if (!this.isRecordOpen(record) || record.selectionToken !== token) {
				return;
			}
			record.isSelectingElement = false;
			record.selectionToken += 1;
			this.publishRecordState(record, getErrorMessage(error));
		}
	}

	private publishRecordState(record: DesktopWebPreviewRecord, errorMessage?: string): DesktopWebPreviewState {
		const state = this.createState(record, errorMessage);
		this.publishState(state);
		return state;
	}

	private createState(record: DesktopWebPreviewRecord, errorMessage?: string): DesktopWebPreviewState {
		const { webContents } = record.view;
		const isDestroyed = !webContents || webContents.isDestroyed();
		const title = isDestroyed ? "" : webContents.getTitle();
		return {
			canGoBack: webContents && !isDestroyed ? webContents.navigationHistory.canGoBack() : false,
			canGoForward: webContents && !isDestroyed ? webContents.navigationHistory.canGoForward() : false,
			...(errorMessage ? { errorMessage } : {}),
			id: record.id,
			isSelectingElement: record.isSelectingElement,
			isLoading: webContents && !isDestroyed ? webContents.isLoading() : false,
			title: title || record.url,
			url: record.url,
		};
	}

	private publishElementSelection(id: string, selection: DesktopWebPreviewElementSelection): void {
		this.publishEvent({
			id,
			selection,
			type: "web_preview_element_selected",
		});
	}

	private publishState(state: DesktopWebPreviewState): void {
		this.publishEvent({
			state,
			type: "web_preview_state",
		});
	}

	private publishEvent(event: DesktopWebPreviewEvent): void {
		for (const port of this.ports) {
			port.postMessage(event);
		}
	}
}
