import { useEffect, useState } from "react";

export interface UseNowTickerOptions<TNow> {
	enabled?: boolean;
	getNow: () => TNow;
	intervalMs: number;
	resetKey?: unknown;
}

export function useNowTicker<TNow>({ enabled = true, getNow, intervalMs, resetKey }: UseNowTickerOptions<TNow>): TNow {
	const [now, setNow] = useState(getNow);

	useEffect(() => {
		void resetKey;
		setNow(getNow());
	}, [getNow, resetKey]);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		setNow(getNow());
		const intervalId = window.setInterval(() => setNow(getNow()), intervalMs);
		return () => window.clearInterval(intervalId);
	}, [enabled, getNow, intervalMs]);

	return now;
}
