class ResizeObserverMock {
	disconnect() {}

	observe() {}

	unobserve() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
}

if (typeof Element !== "undefined" && typeof Element.prototype.scrollTo === "undefined") {
	Object.defineProperty(Element.prototype, "scrollTo", {
		configurable: true,
		value() {},
		writable: true,
	});
}

if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView === "undefined") {
	Object.defineProperty(Element.prototype, "scrollIntoView", {
		configurable: true,
		value() {},
		writable: true,
	});
}

if (typeof window !== "undefined") {
	Object.defineProperty(window, "scrollTo", {
		configurable: true,
		value() {},
		writable: true,
	});
}
