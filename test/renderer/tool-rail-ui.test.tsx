import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineToolRail } from "../../src/renderer/components/chat/InlineToolRail.tsx";

afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

describe("InlineToolRail UI", () => {
	function createImageReadToolCall(index: number, status: "completed" | "running" = "completed") {
		return {
			toolCallId: `read-image-${index}`,
			toolName: "read",
			args: { path: `/workspace/panel-${index}.png` },
			status,
			startedAt: index,
			updatedAt: index + 1,
			completedAt: status === "completed" ? index + 1 : undefined,
			result: {
				content: [
					{ type: "text", text: "Read image file [image/png]" },
					{ type: "image", name: `panel-${index}.png`, mimeType: "image/png", data: `iVBORw0KGgo${index}` },
				],
			},
		};
	}

	it("renders the run summary as an inline divider", () => {
		const { container } = render(
			<InlineToolRail
				toolCalls={[
					{
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "README.md" },
						status: "completed",
						startedAt: 1,
						updatedAt: 2,
						completedAt: 2,
						result: {
							content: [
								{ type: "text", text: "README.md contents" },
								{ type: "image", name: "panel.png", mimeType: "image/png", data: "iVBORw0KGgo=" },
							],
						},
					},
				]}
			/>,
		);

		expect(screen.getByRole("button", { name: /已处理 0s/i })).toBeTruthy();
		expect(container.querySelector("[data-slot='tool-task']")).toBeTruthy();
		expect(container.querySelector(".h-px.min-w-0.flex-1.bg-border")).toBeTruthy();
	});

	it("keeps the timer control tight while long activity lists stay contained", () => {
		const { container } = render(
			<InlineToolRail
				toolCalls={Array.from({ length: 18 }, (_, index) => ({
					toolCallId: `read-${index}`,
					toolName: "read",
					args: { path: `src/file-${index}.ts` },
					status: "completed" as const,
					startedAt: index,
					updatedAt: index + 1,
					completedAt: index + 1,
					result: { content: [{ type: "text", text: "done" }] },
				}))}
			/>,
		);

		const summaryButton = screen.getByRole("button", { name: /已处理 0s/i });
		expect(summaryButton.className).toContain("gap-1");
		expect(summaryButton.className).not.toContain("w-[10.75rem]");
		expect(container.querySelector("[data-slot='tool-rail-divider']")).toBeTruthy();
		expect(container.querySelector("[data-slot='collapsible-content']")?.className).not.toContain("border-l");
		expect(screen.getByRole("list", { name: "Tool activity" }).className).toContain("max-h-[min(48vh,32rem)]");
	});

	it("summarizes contiguous image reads while keeping preview images visible", () => {
		render(<InlineToolRail toolCalls={Array.from({ length: 7 }, (_, index) => createImageReadToolCall(index))} />);

		expect(screen.getByText("Read 7 images").closest("[data-slot='tool-task-item']")).not.toBeNull();
		expect(screen.queryByLabelText("Read panel-0.png")).toBeNull();
		expect(screen.queryByText("Read image file [image/png]")).toBeNull();
		expect(screen.getByAltText("panel-0.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
		expect(screen.getByAltText("panel-6.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
	});

	it("buffers active image read bursts before showing the grouped task row and preview grid", async () => {
		vi.useFakeTimers();
		const { rerender } = render(
			<InlineToolRail isRunActive={true} toolCalls={[createImageReadToolCall(0, "running")]} />,
		);

		expect(screen.queryByRole("list", { name: "Tool activity" })).toBeNull();
		expect(screen.queryByAltText("panel-0.png")).toBeNull();

		rerender(
			<InlineToolRail
				isRunActive={true}
				toolCalls={[createImageReadToolCall(0, "running"), createImageReadToolCall(1, "running")]}
			/>,
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(219);
		});

		expect(screen.queryByRole("list", { name: "Tool activity" })).toBeNull();
		expect(screen.queryByAltText("panel-1.png")).toBeNull();

		rerender(
			<InlineToolRail
				isRunActive={true}
				toolCalls={[
					createImageReadToolCall(0, "running"),
					createImageReadToolCall(1, "running"),
					createImageReadToolCall(2, "running"),
				]}
			/>,
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});

		expect(screen.getByText("Read 3 images").closest("[data-slot='tool-task-item']")).not.toBeNull();
		expect(screen.queryByLabelText("Read panel-0.png")).toBeNull();
		expect(screen.getByAltText("panel-0.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
		expect(screen.getByAltText("panel-2.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
		expect(screen.getByAltText("panel-0.png").closest("[data-slot='thread-image-preview-frame']")).not.toBeNull();
	});

	it("throttles active grouped task count and preview grid updates on the same stable row", async () => {
		vi.useFakeTimers();
		const { rerender } = render(
			<InlineToolRail
				isRunActive={true}
				toolCalls={Array.from({ length: 3 }, (_, index) => createImageReadToolCall(index, "running"))}
			/>,
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(220);
		});

		const groupedRow = screen.getByText("Read 3 images").closest("[data-slot='tool-task-item']");
		expect(groupedRow).not.toBeNull();
		expect(screen.getByAltText("panel-2.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();

		rerender(
			<InlineToolRail
				isRunActive={true}
				toolCalls={Array.from({ length: 7 }, (_, index) => createImageReadToolCall(index, "running"))}
			/>,
		);

		expect(screen.getByText("Read 3 images")).toBeTruthy();
		expect(screen.queryByText("Read 7 images")).toBeNull();
		expect(screen.queryByAltText("panel-6.png")).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(319);
		});

		expect(screen.getByText("Read 3 images")).toBeTruthy();
		expect(screen.queryByText("Read 7 images")).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});

		expect(screen.getByText("Read 7 images").closest("[data-slot='tool-task-item']")).toBe(groupedRow);
		expect(screen.getByAltText("panel-6.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
	});

	it("keeps short read runs and non-read-only tools as individual task items", () => {
		render(
			<InlineToolRail
				toolCalls={[
					{
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "README.md" },
						status: "completed",
						startedAt: 1,
						updatedAt: 2,
						completedAt: 2,
						result: { content: [{ type: "text", text: "README.md contents" }] },
					},
					{
						toolCallId: "read-2",
						toolName: "read",
						args: { path: "CHANGELOG.md" },
						status: "completed",
						startedAt: 3,
						updatedAt: 4,
						completedAt: 4,
						result: { content: [{ type: "text", text: "CHANGELOG.md contents" }] },
					},
					{
						toolCallId: "edit-1",
						toolName: "edit",
						args: { path: "src/App.tsx" },
						status: "completed",
						startedAt: 5,
						updatedAt: 6,
						completedAt: 6,
						result: { content: [{ type: "text", text: "Updated src/App.tsx" }] },
					},
					{
						toolCallId: "write-1",
						toolName: "write",
						args: { path: "src/NewView.tsx" },
						status: "completed",
						startedAt: 7,
						updatedAt: 8,
						completedAt: 8,
						result: { content: [{ type: "text", text: "Wrote src/NewView.tsx" }] },
					},
					{
						toolCallId: "subagent-1",
						toolName: "subagent",
						args: { title: "Inspect renderer state" },
						status: "completed",
						startedAt: 9,
						updatedAt: 10,
						completedAt: 10,
						result: { content: [{ type: "text", text: "done" }] },
					},
				]}
			/>,
		);

		expect(screen.queryByText("Read 2 files")).toBeNull();
		expect(screen.getByLabelText("Read README.md")).toBeTruthy();
		expect(screen.getByLabelText("Read CHANGELOG.md")).toBeTruthy();
		expect(screen.getByLabelText("Edited App.tsx")).toBeTruthy();
		expect(screen.getByLabelText("Wrote NewView.tsx")).toBeTruthy();
		expect(screen.getByLabelText(/Ran subagent Inspect renderer state/i)).toBeTruthy();
	});

	it("summarizes contiguous searches and reports grouped failures without raw output", () => {
		const { container } = render(
			<InlineToolRail
				toolCalls={[
					{
						toolCallId: "search-1",
						toolName: "bash",
						args: { command: "rg Foo src" },
						status: "completed",
						startedAt: 1,
						updatedAt: 2,
						completedAt: 2,
						result: { content: [{ type: "text", text: "src/App.tsx:Foo" }] },
					},
					{
						toolCallId: "search-2",
						toolName: "find",
						args: { path: "src" },
						status: "error",
						startedAt: 3,
						updatedAt: 4,
						completedAt: 4,
						result: { content: [{ type: "text", text: "find failed with private output" }] },
					},
					{
						toolCallId: "search-3",
						toolName: "grep",
						args: { pattern: "Foo" },
						status: "completed",
						startedAt: 5,
						updatedAt: 6,
						completedAt: 6,
						result: { content: [{ type: "text", text: "src/main.ts:Foo" }] },
					},
					{
						toolCallId: "bash-unknown",
						toolName: "bash",
						args: { command: "node scripts/build.js" },
						status: "completed",
						startedAt: 7,
						updatedAt: 8,
						completedAt: 8,
						result: { content: [{ type: "text", text: "build output" }] },
					},
				]}
			/>,
		);

		expect(screen.getByText("Searched 3 times, 1 failed").closest("[data-slot='tool-task-item']")).not.toBeNull();
		expect(screen.getByText("Ran command").closest("[data-slot='tool-task-item']")).not.toBeNull();
		expect(screen.queryByText("src/App.tsx:Foo")).toBeNull();
		expect(screen.queryByText("find failed with private output")).toBeNull();
		expect(screen.queryByText("Command")).toBeNull();
		expect(container.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
	});

	it("renders lightweight task items without tool detail drawers", () => {
		const { container } = render(
			<InlineToolRail
				toolCalls={[
					{
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "README.md" },
						status: "completed",
						startedAt: 1,
						updatedAt: 2,
						completedAt: 2,
						result: {
							content: [
								{ type: "text", text: "README.md contents" },
								{ type: "image", name: "panel.png", mimeType: "image/png", data: "iVBORw0KGgo=" },
							],
						},
					},
					{
						toolCallId: "bash-1",
						toolName: "bash",
						args: { command: "printf 'desktop-ai-agent\\n'" },
						status: "running",
						startedAt: Date.parse("2025-05-05T10:31:00Z"),
						updatedAt: Date.parse("2025-05-05T10:31:00Z"),
						partialResult: { content: [{ type: "text", text: "desktop-ai-agent" }] },
					},
				]}
			/>,
		);

		const readItem = screen.getByText("Read").closest("[data-slot='tool-task-item']");
		expect(readItem).not.toBeNull();
		expect(screen.getByText("README.md").closest("[data-slot='task-item-file']")).not.toBeNull();
		expect(screen.getByText("Ran command").closest("[data-slot='tool-task-item']")).not.toBeNull();
		expect(screen.getByText("运行中").closest("[data-slot='tool-task-item']")).not.toBeNull();
		expect(screen.queryByRole("button", { name: /ran command/i })).toBeNull();
		expect(screen.queryByText("Command")).toBeNull();
		expect(screen.queryByText("desktop-ai-agent")).toBeNull();
		expect(screen.queryByText("printf 'desktop-ai-agent\\n'")).toBeNull();
		expect(container.querySelector("[data-slot='tool-activity-row-details']")).toBeNull();
		expect(container.querySelector("[data-slot='tool-activity-details']")).toBeNull();
	});

	it("keeps only the run-level collapse state for task items", async () => {
		const user = userEvent.setup();

		render(
			<InlineToolRail
				toolCalls={[
					{
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "README.md" },
						status: "completed",
						startedAt: 1,
						updatedAt: 2,
						completedAt: 2,
						result: {
							content: [
								{ type: "text", text: "README.md contents" },
								{ type: "image", name: "panel.png", mimeType: "image/png", data: "iVBORw0KGgo=" },
							],
						},
					},
					{
						toolCallId: "bash-1",
						toolName: "bash",
						args: { command: "printf 'desktop-ai-agent\\n'" },
						status: "completed",
						startedAt: 3,
						updatedAt: 4,
						completedAt: 4,
						result: { content: [{ type: "text", text: "desktop-ai-agent" }] },
					},
				]}
			/>,
		);

		expect(screen.getByText("Read")).toBeTruthy();
		expect(screen.getByText("README.md").closest("[data-slot='task-item-file']")).not.toBeNull();
		expect(screen.getByAltText("panel.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
		expect(screen.getByText("Ran command")).toBeTruthy();
		expect(screen.queryByText("Preview")).toBeNull();
		expect(screen.queryByText("Command")).toBeNull();
		expect(screen.queryByText("README.md contents")).toBeNull();

		await user.click(screen.getByRole("button", { name: /已处理/i }));
		expect(screen.queryByText("Read")).toBeNull();
		expect(screen.queryByText("README.md")).toBeNull();
		expect(screen.queryByAltText("panel.png")).toBeNull();
		expect(screen.queryByText("Ran command")).toBeNull();

		await user.click(screen.getByRole("button", { name: /已处理/i }));
		expect(screen.getByText("Read")).toBeTruthy();
		expect(screen.getByText("README.md").closest("[data-slot='task-item-file']")).not.toBeNull();
		expect(screen.getByAltText("panel.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
		expect(screen.getByText("Ran command")).toBeTruthy();
		expect(screen.queryByText("Command")).toBeNull();
	});

	it("ticks active run duration forward without resetting on prop refresh", async () => {
		vi.useFakeTimers();
		const startedAt = Date.parse("2025-05-05T10:31:00Z");
		vi.setSystemTime(startedAt);

		const { rerender } = render(
			<InlineToolRail
				isRunActive={true}
				runStartedAt={startedAt}
				toolCalls={[
					{
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "README.md" },
						status: "completed",
						startedAt,
						updatedAt: startedAt,
						completedAt: startedAt,
						result: { content: [{ type: "text", text: "README.md contents" }] },
					},
				]}
			/>,
		);

		expect(screen.getByRole("button", { name: /已处理 0s/i })).toBeTruthy();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});

		expect(screen.getByRole("button", { name: /已处理 2s/i })).toBeTruthy();

		rerender(
			<InlineToolRail
				isRunActive={true}
				runStartedAt={startedAt + 1500}
				toolCalls={[
					{
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "README.md" },
						status: "completed",
						startedAt,
						updatedAt: startedAt + 500,
						completedAt: startedAt + 500,
						result: { content: [{ type: "text", text: "README.md contents" }] },
					},
				]}
			/>,
		);

		expect(screen.getByRole("button", { name: /已处理 2s/i })).toBeTruthy();
	});
});
