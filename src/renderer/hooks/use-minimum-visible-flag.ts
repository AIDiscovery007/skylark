import { useEffect, useRef, useState } from "react";

export function useMinimumVisibleFlag(active: boolean, minMs = 1800): boolean {
	const [visible, setVisible] = useState(active);
	const visibleStartedAtRef = useRef<number | undefined>(active ? Date.now() : undefined);

	useEffect(() => {
		if (active) {
			visibleStartedAtRef.current ??= Date.now();
			setVisible(true);
			return;
		}

		if (!visible) {
			visibleStartedAtRef.current = undefined;
			return;
		}

		const visibleStartedAt = visibleStartedAtRef.current ?? Date.now();
		const remainingMs = minMs - (Date.now() - visibleStartedAt);
		if (remainingMs <= 0) {
			visibleStartedAtRef.current = undefined;
			setVisible(false);
			return;
		}

		const timeoutId = window.setTimeout(() => {
			visibleStartedAtRef.current = undefined;
			setVisible(false);
		}, remainingMs);

		return () => window.clearTimeout(timeoutId);
	}, [active, minMs, visible]);

	return visible;
}
