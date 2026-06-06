import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VirtualStack } from "../../src/renderer/components/ui/virtual-stack.tsx";

afterEach(() => {
	cleanup();
});

describe("VirtualStack", () => {
	it("renders only the visible row window plus overscan", async () => {
		const items = Array.from({ length: 100 }, (_, index) => `Item ${index}`);

		render(
			<VirtualStack
				className="h-[100px]"
				estimateSize={() => 20}
				getKey={(item) => item}
				initialViewportHeight={100}
				items={items}
				overscan={1}
				renderItem={({ item }) => <div>{item}</div>}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByText("Item 0")).toBeTruthy();
		});
		expect(screen.getByText("Item 5")).toBeTruthy();
		expect(screen.queryByText("Item 99")).toBeNull();
		expect(screen.getAllByText(/Item /)).toHaveLength(6);
	});

	it("updates the visible row window when the viewport scrolls", async () => {
		const items = Array.from({ length: 100 }, (_, index) => `Item ${index}`);

		render(
			<VirtualStack
				className="h-[100px]"
				estimateSize={() => 20}
				getKey={(item) => item}
				initialViewportHeight={100}
				items={items}
				overscan={1}
				renderItem={({ item }) => <div>{item}</div>}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByText("Item 0")).toBeTruthy();
		});
		const viewport = screen.getByRole("list");
		viewport.scrollTop = 400;
		fireEvent.scroll(viewport);

		await waitFor(() => {
			expect(screen.queryByText("Item 0")).toBeNull();
		});
		expect(screen.getByText("Item 19")).toBeTruthy();
		expect(screen.getByText("Item 25")).toBeTruthy();
		expect(screen.queryByText("Item 99")).toBeNull();
	});

	it("can scroll an external selected index into the virtual window", async () => {
		const items = Array.from({ length: 100 }, (_, index) => `Item ${index}`);
		const scrollTo = vi.fn();
		const renderStack = (scrollToIndex?: number) => (
			<VirtualStack
				className="h-[100px]"
				estimateSize={() => 20}
				getKey={(item) => item}
				initialViewportHeight={100}
				items={items}
				overscan={1}
				renderItem={({ item }) => <div>{item}</div>}
				scrollToIndex={scrollToIndex}
			/>
		);
		const { rerender } = render(renderStack());

		await waitFor(() => {
			expect(screen.getByText("Item 0")).toBeTruthy();
		});
		const viewport = screen.getByRole("list");
		Object.defineProperty(viewport, "scrollTo", {
			configurable: true,
			value: scrollTo,
		});

		rerender(renderStack(42));

		await waitFor(() => {
			expect(scrollTo).toHaveBeenCalled();
		});
	});
});
