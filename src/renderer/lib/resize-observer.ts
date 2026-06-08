export interface ObserveElementResizeOptions {
	fallbackToWindow?: boolean;
	notifyImmediately?: boolean;
}

export function observeElementResize(
	element: Element,
	callback: () => void,
	{ fallbackToWindow = false, notifyImmediately = true }: ObserveElementResizeOptions = {},
): () => void {
	if (notifyImmediately) {
		callback();
	}

	if (typeof ResizeObserver !== "undefined") {
		const resizeObserver = new ResizeObserver(callback);
		resizeObserver.observe(element);
		return () => resizeObserver.disconnect();
	}

	const targetWindow = element.ownerDocument.defaultView;
	if (!fallbackToWindow || !targetWindow) {
		return () => undefined;
	}

	targetWindow.addEventListener("resize", callback);
	return () => targetWindow.removeEventListener("resize", callback);
}
