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
	});
}
