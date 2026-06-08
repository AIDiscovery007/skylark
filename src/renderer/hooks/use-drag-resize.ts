import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

export interface DragResizePanInfo {
	offset: {
		x: number;
		y: number;
	};
}

export interface DragResizePointerStart {
	clientX: number;
	clientY: number;
	value: number;
}

export interface DragResizePointerOptions {
	cursor: string;
	getValue: (event: PointerEvent, start: DragResizePointerStart) => number;
	shouldStart?: (event: ReactPointerEvent<HTMLElement>) => boolean;
	userSelect?: string;
}

export interface UseDragResizeOptions {
	clampValue: (value: number) => number;
	getKeyValue?: (key: string, value: number) => number | undefined;
	getMotionValue?: (startValue: number, info: DragResizePanInfo) => number;
	onActiveChange?: (active: boolean) => void;
	pointer?: DragResizePointerOptions;
	setValue: (value: number) => void;
	value: number;
}

export interface UseDragResizeResult {
	handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
	handleMotionDrag: (info: DragResizePanInfo) => void;
	handleMotionDragEnd: () => void;
	handleMotionDragStart: () => void;
	handlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
	isResizing: boolean;
	setClampedValue: (value: number) => void;
	startResize: () => void;
	stopResize: () => void;
}

export function useDragResize({
	clampValue,
	getKeyValue,
	getMotionValue,
	onActiveChange,
	pointer,
	setValue,
	value,
}: UseDragResizeOptions): UseDragResizeResult {
	const [isResizing, setIsResizing] = useState(false);
	const cleanupRef = useRef<(() => void) | undefined>(undefined);
	const startValueRef = useRef(value);

	const setResizeActive = useCallback(
		(active: boolean) => {
			setIsResizing(active);
			onActiveChange?.(active);
		},
		[onActiveChange],
	);

	const setClampedValue = useCallback(
		(nextValue: number) => {
			setValue(clampValue(nextValue));
		},
		[clampValue, setValue],
	);

	const stopResize = useCallback(() => {
		cleanupRef.current?.();
	}, []);

	const startResize = useCallback(() => {
		cleanupRef.current?.();
		startValueRef.current = value;
		setResizeActive(true);

		const cleanup = () => {
			window.removeEventListener("pointerup", cleanup);
			window.removeEventListener("pointercancel", cleanup);
			window.removeEventListener("blur", cleanup);
			setResizeActive(false);
			cleanupRef.current = undefined;
		};

		window.addEventListener("pointerup", cleanup);
		window.addEventListener("pointercancel", cleanup);
		window.addEventListener("blur", cleanup);
		cleanupRef.current = cleanup;
	}, [setResizeActive, value]);

	const handleMotionDragStart = useCallback(() => {
		startResize();
	}, [startResize]);

	const handleMotionDrag = useCallback(
		(info: DragResizePanInfo) => {
			if (!getMotionValue) {
				return;
			}
			setClampedValue(getMotionValue(startValueRef.current, info));
		},
		[getMotionValue, setClampedValue],
	);

	const handleMotionDragEnd = useCallback(() => {
		stopResize();
	}, [stopResize]);

	const handleKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			if (!getKeyValue) {
				return;
			}

			const nextValue = getKeyValue(event.key, value);
			if (nextValue === undefined) {
				return;
			}

			event.preventDefault();
			setClampedValue(nextValue);
		},
		[getKeyValue, setClampedValue, value],
	);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			if (!pointer || (pointer.shouldStart && !pointer.shouldStart(event))) {
				return;
			}

			event.preventDefault();
			cleanupRef.current?.();

			const start: DragResizePointerStart = {
				clientX: event.clientX,
				clientY: event.clientY,
				value,
			};
			const previousCursor = document.body.style.cursor;
			const previousUserSelect = document.body.style.userSelect;

			setResizeActive(true);
			document.body.style.cursor = pointer.cursor;
			if (pointer.userSelect !== undefined) {
				document.body.style.userSelect = pointer.userSelect;
			}

			const handlePointerMove = (moveEvent: PointerEvent) => {
				setClampedValue(pointer.getValue(moveEvent, start));
			};
			const cleanup = () => {
				window.removeEventListener("pointermove", handlePointerMove);
				window.removeEventListener("pointerup", cleanup);
				window.removeEventListener("pointercancel", cleanup);
				window.removeEventListener("blur", cleanup);
				document.body.style.cursor = previousCursor;
				document.body.style.userSelect = previousUserSelect;
				setResizeActive(false);
				cleanupRef.current = undefined;
			};

			window.addEventListener("pointermove", handlePointerMove);
			window.addEventListener("pointerup", cleanup);
			window.addEventListener("pointercancel", cleanup);
			window.addEventListener("blur", cleanup);
			cleanupRef.current = cleanup;
		},
		[pointer, setClampedValue, setResizeActive, value],
	);

	useEffect(() => {
		return () => {
			cleanupRef.current?.();
		};
	}, []);

	return {
		handleKeyDown,
		handleMotionDrag,
		handleMotionDragEnd,
		handleMotionDragStart,
		handlePointerDown,
		isResizing,
		setClampedValue,
		startResize,
		stopResize,
	};
}
