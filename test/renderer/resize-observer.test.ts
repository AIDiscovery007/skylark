import { afterEach, describe, expect, it, vi } from "vitest";
import { observeElementResize } from "../../src/renderer/lib/resize-observer.ts";

describe("observeElementResize", () => {
	const originalResizeObserver = globalThis.ResizeObserver;

	afterEach(() => {
		if (originalResizeObserver) {
			globalThis.ResizeObserver = originalResizeObserver;
		} else {
			Reflect.deleteProperty(globalThis, "ResizeObserver");
		}
		vi.restoreAllMocks();
	});

	it("notifies immediately and disconnects ResizeObserver", () => {
		const disconnect = vi.fn();
		const observe = vi.fn();
		class MockResizeObserver {
			disconnect = disconnect;
			observe = observe;
			unobserve() {}
		}
		globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
		const element = document.createElement("div");
		const callback = vi.fn();

		const cleanup = observeElementResize(element, callback);
		cleanup();

		expect(callback).toHaveBeenCalledTimes(1);
		expect(observe).toHaveBeenCalledWith(element);
		expect(disconnect).toHaveBeenCalledTimes(1);
	});

	it("falls back to window resize when requested", () => {
		Reflect.deleteProperty(globalThis, "ResizeObserver");
		const element = document.createElement("div");
		const callback = vi.fn();

		const cleanup = observeElementResize(element, callback, { fallbackToWindow: true });
		window.dispatchEvent(new Event("resize"));
		cleanup();
		window.dispatchEvent(new Event("resize"));

		expect(callback).toHaveBeenCalledTimes(2);
	});
});
