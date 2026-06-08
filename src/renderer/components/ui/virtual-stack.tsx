import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactNode, Ref, UIEventHandler } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { observeElementResize } from "@/lib/resize-observer";
import { cn } from "@/lib/utils";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
	if (!ref) {
		return;
	}
	if (typeof ref === "function") {
		ref(value);
		return;
	}
	ref.current = value;
}

interface VirtualStackRenderContext<T> {
	index: number;
	item: T;
}

interface VirtualStackProps<T> {
	ariaLabel?: string;
	className?: string;
	dataSlot?: string;
	estimateSize: (index: number) => number;
	footer?: ReactNode;
	gap?: number;
	getKey: (item: T, index: number) => string | number;
	initialViewportHeight?: number;
	itemClassName?: string;
	items: readonly T[];
	measureItems?: boolean;
	onScroll?: UIEventHandler<HTMLDivElement>;
	overscan?: number;
	paddingEnd?: number;
	paddingStart?: number;
	renderItem: (context: VirtualStackRenderContext<T>) => ReactNode;
	role?: "list" | "presentation";
	scrollToIndex?: number;
	viewportRef?: Ref<HTMLDivElement>;
}

function VirtualStack<T>({
	ariaLabel,
	className,
	dataSlot = "virtual-stack-viewport",
	estimateSize,
	footer,
	gap = 0,
	getKey,
	initialViewportHeight = 320,
	itemClassName,
	items,
	measureItems = false,
	onScroll,
	overscan = 6,
	paddingEnd = 0,
	paddingStart = 0,
	renderItem,
	role = "list",
	scrollToIndex,
	viewportRef,
}: VirtualStackProps<T>) {
	const viewportElementRef = useRef<HTMLDivElement | null>(null);
	const setViewportRef = useCallback(
		(element: HTMLDivElement | null) => {
			viewportElementRef.current = element;
			assignRef(viewportRef, element);
		},
		[viewportRef],
	);
	const observeElementRect = useCallback(
		(
			instance: { scrollElement: HTMLDivElement | null },
			callback: (rect: { height: number; width: number }) => void,
		) => {
			const element = instance.scrollElement;
			if (!element) {
				return undefined;
			}
			const notify = () => {
				callback({
					height: element.clientHeight || initialViewportHeight,
					width: element.clientWidth,
				});
			};
			return observeElementResize(element, notify);
		},
		[initialViewportHeight],
	);
	const observeElementOffset = useCallback(
		(
			instance: { scrollElement: HTMLDivElement | null },
			callback: (offset: number, isScrolling: boolean) => void,
		) => {
			const element = instance.scrollElement;
			const targetWindow = element?.ownerDocument.defaultView;
			if (!element || !targetWindow) {
				return undefined;
			}

			let offset = element.scrollTop;
			let resetTimeoutId: number | undefined;
			const clearResetTimeout = () => {
				if (resetTimeoutId === undefined) {
					return;
				}
				targetWindow.clearTimeout(resetTimeoutId);
				resetTimeoutId = undefined;
			};
			const handleScroll = () => {
				offset = element.scrollTop;
				clearResetTimeout();
				resetTimeoutId = targetWindow.setTimeout(() => {
					resetTimeoutId = undefined;
					callback(offset, false);
				}, 150);
				callback(offset, true);
			};

			element.addEventListener("scroll", handleScroll, { passive: true });
			return () => {
				element.removeEventListener("scroll", handleScroll);
				clearResetTimeout();
			};
		},
		[],
	);
	const getItemKey = useMemo(() => {
		return (index: number) => {
			const item = items[index];
			return item === undefined ? index : getKey(item, index);
		};
	}, [getKey, items]);
	const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: items.length,
		estimateSize,
		getItemKey,
		getScrollElement: () => viewportElementRef.current,
		gap,
		initialRect: { height: initialViewportHeight, width: 0 },
		measureElement: measureItems
			? (element) => {
					const index = Number(element.getAttribute("data-index"));
					const measuredHeight = element.getBoundingClientRect().height;
					if (Number.isFinite(measuredHeight) && measuredHeight > 0) {
						return measuredHeight;
					}
					return estimateSize(Number.isFinite(index) ? index : 0);
				}
			: undefined,
		observeElementOffset,
		observeElementRect,
		overscan,
		paddingEnd,
		paddingStart,
	});
	useEffect(() => {
		if (scrollToIndex === undefined || scrollToIndex < 0 || scrollToIndex >= items.length) {
			return;
		}
		virtualizer.scrollToIndex(scrollToIndex, { align: "auto" });
	}, [items.length, scrollToIndex, virtualizer]);
	const virtualItems = virtualizer.getVirtualItems();
	const viewportLabelProps = ariaLabel && role !== "presentation" ? { "aria-label": ariaLabel } : {};

	return (
		<div
			className={cn("relative overflow-y-auto overscroll-contain", className)}
			data-slot={dataSlot}
			onScroll={onScroll}
			ref={setViewportRef}
			role={role}
			{...viewportLabelProps}
		>
			<div
				className="relative w-full"
				data-slot="virtual-stack-content"
				style={{ height: virtualizer.getTotalSize() }}
			>
				{virtualItems.map((virtualItem) => {
					const item = items[virtualItem.index];
					if (item === undefined) {
						return null;
					}

					return (
						<div
							className={cn("absolute top-0 left-0 w-full", itemClassName)}
							data-index={virtualItem.index}
							data-slot="virtual-stack-item"
							key={virtualItem.key}
							ref={measureItems ? virtualizer.measureElement : undefined}
							role={role === "list" ? "listitem" : undefined}
							style={{ transform: `translateY(${virtualItem.start}px)` }}
						>
							{renderItem({
								index: virtualItem.index,
								item,
							})}
						</div>
					);
				})}
			</div>
			{footer}
		</div>
	);
}

export { VirtualStack };
