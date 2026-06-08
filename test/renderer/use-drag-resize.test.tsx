import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { type UseDragResizeResult, useDragResize } from "../../src/renderer/hooks/use-drag-resize.ts";

function clamp(value: number): number {
	return Math.min(200, Math.max(50, value));
}

function DragResizeHarness({ expose }: { expose?: (controls: UseDragResizeResult) => void }) {
	const [value, setValue] = useState(100);
	const controls = useDragResize({
		clampValue: clamp,
		getKeyValue: (key, currentValue) => {
			if (key === "ArrowLeft") {
				return currentValue - 10;
			}
			if (key === "ArrowRight") {
				return currentValue + 10;
			}
			if (key === "Home") {
				return 50;
			}
			if (key === "End") {
				return 200;
			}
			return undefined;
		},
		getMotionValue: (startValue, info) => startValue + info.offset.x,
		pointer: {
			cursor: "col-resize",
			getValue: (event, start) => start.value - (event.clientX - start.clientX),
			userSelect: "none",
		},
		setValue,
		value,
	});
	expose?.(controls);

	return (
		<button data-active={String(controls.isResizing)} onKeyDown={controls.handleKeyDown} type="button">
			{value}
		</button>
	);
}

afterEach(() => {
	cleanup();
	document.body.style.cursor = "";
	document.body.style.userSelect = "";
});

describe("useDragResize", () => {
	it("applies keyboard resize values through the configured clamp", () => {
		render(<DragResizeHarness />);
		const resizeHandle = screen.getByRole("button");

		act(() => {
			resizeHandle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
		});
		expect(resizeHandle.textContent).toBe("110");

		act(() => {
			resizeHandle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
		});
		expect(resizeHandle.textContent).toBe("200");
	});

	it("tracks motion drag sessions and stops on pointerup", () => {
		let controls: UseDragResizeResult | undefined;
		render(
			<DragResizeHarness
				expose={(nextControls) => {
					controls = nextControls;
				}}
			/>,
		);
		const resizeHandle = screen.getByRole("button");

		act(() => {
			controls?.startResize();
		});
		expect(resizeHandle.dataset.active).toBe("true");

		act(() => {
			controls?.handleMotionDrag({ offset: { x: 30, y: 0 } });
		});
		expect(resizeHandle.textContent).toBe("130");

		act(() => {
			window.dispatchEvent(new PointerEvent("pointerup"));
		});
		expect(resizeHandle.dataset.active).toBe("false");
	});

	it("handles raw pointer resize sessions with body cursor cleanup", () => {
		let controls: UseDragResizeResult | undefined;
		render(
			<DragResizeHarness
				expose={(nextControls) => {
					controls = nextControls;
				}}
			/>,
		);
		const resizeHandle = screen.getByRole("button");

		act(() => {
			controls?.handlePointerDown({
				button: 0,
				clientX: 100,
				clientY: 0,
				preventDefault() {},
			} as React.PointerEvent<HTMLElement>);
		});
		expect(resizeHandle.dataset.active).toBe("true");
		expect(document.body.style.cursor).toBe("col-resize");
		expect(document.body.style.userSelect).toBe("none");

		act(() => {
			window.dispatchEvent(new PointerEvent("pointermove", { clientX: 70 }));
		});
		expect(resizeHandle.textContent).toBe("130");

		act(() => {
			window.dispatchEvent(new PointerEvent("pointerup"));
		});
		expect(resizeHandle.dataset.active).toBe("false");
		expect(document.body.style.cursor).toBe("");
		expect(document.body.style.userSelect).toBe("");
	});
});
