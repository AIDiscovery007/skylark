import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineToolRail } from "../../src/renderer/components/chat/InlineToolRail.tsx";

afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

describe("InlineToolRail UI", () => {
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
						result: { content: [{ type: "text", text: "README.md contents" }] },
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

	it("expands the tool list and reveals selected tool details", async () => {
		const user = userEvent.setup();

		const { container } = render(
			<InlineToolRail
				toolCalls={[
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

		await user.click(screen.getByRole("button", { name: /ran command bash/i }));

		expect(screen.getByText("Command")).toBeTruthy();
		expect(screen.getByText("desktop-ai-agent")).toBeTruthy();
		const statusLabel = screen.getByText("运行中");
		expect(statusLabel.className).toContain("shrink-0");
		const commandRow = screen.getByRole("button", { name: /ran command bash/i });
		expect(commandRow.closest("[data-slot='tool-task-item']")).not.toBeNull();
		expect(commandRow.className).toContain("hover:bg-muted/35");
		expect(commandRow.className).not.toContain("translate");
		expect(commandRow.className).not.toContain("scale");
		expect(
			within(commandRow).getByText("Ran command").compareDocumentPosition(within(commandRow).getByText("bash")),
		).toBe(globalThis.Node.DOCUMENT_POSITION_FOLLOWING);
		expect(within(commandRow).getByText("printf 'desktop-ai-agent\\n'").className).toContain("truncate");
		expect(container.querySelector("[data-slot='tool-activity-row-details']")?.getAttribute("style")).toBeNull();

		await user.click(screen.getByRole("button", { name: /ran command bash/i }));
		expect(screen.queryByText("Command")).toBeNull();
		expect(container.querySelector("[data-slot='tool-activity-details']")).toBeNull();
	});

	it("keeps the rail collapse state independent from row detail expansion", async () => {
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
						result: { content: [{ type: "text", text: "README.md contents" }] },
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

		await user.click(screen.getByRole("button", { name: /read readme.md/i }));
		await user.click(screen.getByRole("button", { name: /ran command/i }));

		expect(screen.getByText("Preview")).toBeTruthy();
		expect(screen.getByText("Command")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: /已处理/i }));
		expect(screen.queryByText("Read README.md")).toBeNull();
		expect(screen.queryByText("Preview")).toBeNull();

		await user.click(screen.getByRole("button", { name: /已处理/i }));
		expect(screen.getByText("Read README.md")).toBeTruthy();
		expect(screen.getByText("Preview")).toBeTruthy();
		expect(screen.getByText("Command")).toBeTruthy();
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
