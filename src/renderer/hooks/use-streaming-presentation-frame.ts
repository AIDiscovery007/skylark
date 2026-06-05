import { useEffect, useRef, useState } from "react";

export const STREAMING_PRESENTATION_INITIAL_DELAY_MS = 220;
export const STREAMING_PRESENTATION_UPDATE_INTERVAL_MS = 320;

export function useStreamingPresentationFrame<T>(
	items: readonly T[],
	isActive: boolean,
	initialDelayMs = STREAMING_PRESENTATION_INITIAL_DELAY_MS,
	updateIntervalMs = STREAMING_PRESENTATION_UPDATE_INTERVAL_MS,
): readonly T[] {
	const pendingItemsRef = useRef(items);
	const timerRef = useRef<number | undefined>(undefined);
	const lastCommittedAtRef = useRef(0);
	const presentedItemsRef = useRef<readonly T[]>(isActive ? [] : items);
	const [presentedItems, setPresentedItems] = useState<readonly T[]>(() => presentedItemsRef.current);

	useEffect(() => {
		return () => {
			if (timerRef.current !== undefined) {
				window.clearTimeout(timerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		pendingItemsRef.current = items;

		if (!isActive || items.length === 0) {
			if (timerRef.current !== undefined) {
				window.clearTimeout(timerRef.current);
				timerRef.current = undefined;
			}
			lastCommittedAtRef.current = Date.now();
			presentedItemsRef.current = items;
			setPresentedItems(items);
			return;
		}

		if (timerRef.current !== undefined) {
			return;
		}

		const now = Date.now();
		const hasCommittedFrame = presentedItemsRef.current.length > 0;
		const nextDelay = hasCommittedFrame
			? Math.max(0, updateIntervalMs - (now - lastCommittedAtRef.current))
			: initialDelayMs;

		timerRef.current = window.setTimeout(() => {
			timerRef.current = undefined;
			lastCommittedAtRef.current = Date.now();
			const nextItems = pendingItemsRef.current;
			presentedItemsRef.current = nextItems;
			setPresentedItems(nextItems);
		}, nextDelay);
	}, [initialDelayMs, isActive, items, updateIntervalMs]);

	return isActive ? presentedItems : items;
}
