const PERFORMANCE_LOG_STORAGE_KEY = "pi:debug-performance";

function canUsePerformanceApi(): boolean {
	return typeof performance !== "undefined" && typeof performance.mark === "function";
}

function shouldLogPerformanceMeasure(): boolean {
	try {
		return typeof window !== "undefined" && window.localStorage.getItem(PERFORMANCE_LOG_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

export function markRendererPerformance(name: string): void {
	if (!canUsePerformanceApi()) {
		return;
	}

	performance.mark(name);
}

export function measureRendererPerformance(name: string, startMark: string, endMark?: string): void {
	if (!canUsePerformanceApi() || typeof performance.measure !== "function") {
		return;
	}

	try {
		const measure = performance.measure(name, startMark, endMark);
		if (shouldLogPerformanceMeasure()) {
			console.info(`[perf] ${measure.name}: ${Math.round(measure.duration)}ms`);
		}
	} catch {
		// Missing marks should never affect app startup or interaction paths.
	}
}

export function scheduleIdleWork(callback: () => void, timeout = 250): () => void {
	if (typeof window === "undefined") {
		callback();
		return () => undefined;
	}

	if ("requestIdleCallback" in window && typeof window.requestIdleCallback === "function") {
		const idleId = window.requestIdleCallback(callback, { timeout });
		return () => window.cancelIdleCallback(idleId);
	}

	const timeoutId = window.setTimeout(callback, timeout);
	return () => window.clearTimeout(timeoutId);
}
