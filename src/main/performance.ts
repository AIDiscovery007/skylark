import { performance } from "node:perf_hooks";

const DEBUG_PERFORMANCE_ENV = "PI_DESKTOP_DEBUG_PERFORMANCE";

function shouldLogMainPerformance(): boolean {
	return process.env[DEBUG_PERFORMANCE_ENV] === "1";
}

export function markMainPerformance(name: string): void {
	if (!shouldLogMainPerformance()) {
		return;
	}

	performance.mark(name);
}

export function measureMainPerformance(name: string, startMark: string, endMark?: string): void {
	if (!shouldLogMainPerformance()) {
		return;
	}

	try {
		const measure = performance.measure(name, startMark, endMark);
		console.info(`[perf] ${measure.name}: ${Math.round(measure.duration)}ms`);
	} catch {
		// Missing marks should never affect app lifecycle paths.
	}
}

export async function measureMainAsync<T>(name: string, action: () => Promise<T>): Promise<T> {
	if (!shouldLogMainPerformance()) {
		return action();
	}

	const startMark = `${name}:start`;
	const endMark = `${name}:end`;
	markMainPerformance(startMark);
	try {
		return await action();
	} finally {
		markMainPerformance(endMark);
		measureMainPerformance(name, startMark, endMark);
	}
}
