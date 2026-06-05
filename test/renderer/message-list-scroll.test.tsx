import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "../../src/renderer/components/chat/MessageList.tsx";

afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

function createAssistantMessage(
	text: string,
	timestamp: number,
	overrides: Partial<Extract<AgentMessage, { role: "assistant" }>> = {},
): Extract<AgentMessage, { role: "assistant" }> {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "faux",
		provider: "faux",
		model: "faux-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
		...overrides,
	};
}

function createAssistantToolMessage(timestamp: number): Extract<AgentMessage, { role: "assistant" }> {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "README.md" } }],
		api: "faux",
		provider: "faux",
		model: "faux-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp,
	};
}

function createAssistantThinkingMessage(timestamp: number): Extract<AgentMessage, { role: "assistant" }> {
	return {
		role: "assistant",
		content: [{ type: "thinking", thinking: "**Planning**\n\nThe next step is clear." }],
		api: "faux",
		provider: "faux",
		model: "faux-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function createAssistantToolStep({
	path,
	text,
	timestamp,
	toolCallId,
}: {
	path: string;
	text: string;
	timestamp: number;
	toolCallId: string;
}): Extract<AgentMessage, { role: "assistant" }> {
	return {
		role: "assistant",
		content: [
			{ type: "text", text },
			{ type: "toolCall", id: toolCallId, name: "read", arguments: { path } },
		],
		api: "faux",
		provider: "faux",
		model: "faux-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp,
	};
}

function createToolResult({
	content,
	timestamp,
	toolCallId,
}: {
	content: string;
	timestamp: number;
	toolCallId: string;
}): Extract<AgentMessage, { role: "toolResult" }> {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "read",
		content: [{ type: "text", text: content }],
		isError: false,
		timestamp,
	};
}

function setViewportMetrics(
	viewport: HTMLDivElement,
	metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
): void {
	Object.defineProperty(viewport, "clientHeight", {
		configurable: true,
		value: metrics.clientHeight,
	});
	Object.defineProperty(viewport, "scrollHeight", {
		configurable: true,
		value: metrics.scrollHeight,
	});
	Object.defineProperty(viewport, "scrollTop", {
		configurable: true,
		value: metrics.scrollTop,
		writable: true,
	});
}

function getViewport(container: HTMLElement): HTMLDivElement {
	const viewport = container.querySelector("[data-slot='scroll-area-viewport']");
	if (!(viewport instanceof HTMLDivElement)) {
		throw new Error("MessageList scroll viewport was not rendered.");
	}

	return viewport;
}

describe("MessageList autoscroll", () => {
	it("does not force the transcript back to bottom after the user scrolls away", async () => {
		const messages = [createAssistantMessage("Initial response", 1)];
		const { container, rerender } = render(
			<MessageList messages={messages} showThinkingBlocks={false} toolCalls={[]} />,
		);
		const viewport = getViewport(container);
		setViewportMetrics(viewport, { clientHeight: 100, scrollHeight: 1000, scrollTop: 900 });

		await act(async () => {
			viewport.scrollTop = 200;
			fireEvent.scroll(viewport);
		});

		rerender(
			<MessageList
				messages={messages}
				showThinkingBlocks={false}
				streamingMessage={createAssistantMessage("Streaming update", 2)}
				toolCalls={[]}
			/>,
		);
		await act(async () => undefined);

		expect(viewport.scrollTop).toBe(200);
	});

	it("shows a jump control when scrolled away and returns to the latest message", async () => {
		const { container } = render(
			<MessageList
				messages={[createAssistantMessage("Initial response", 1)]}
				showThinkingBlocks={false}
				toolCalls={[]}
			/>,
		);
		const viewport = getViewport(container);
		setViewportMetrics(viewport, { clientHeight: 100, scrollHeight: 1000, scrollTop: 900 });

		await act(async () => {
			viewport.scrollTop = 200;
			fireEvent.scroll(viewport);
		});

		const jumpButton = screen.getByRole("button", { name: "Jump to latest message" });
		await act(async () => {
			fireEvent.click(jumpButton);
		});

		expect(viewport.scrollTop).toBe(1000);
		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "Jump to latest message" })).toBeNull();
		});
	});

	it("renders legacy assistant run errors as a collapsed task", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<MessageList
				messages={[
					createAssistantMessage("Partial response", 1, {
						errorMessage: "Provider key missing.",
						stopReason: "error",
					}),
				]}
				showThinkingBlocks={false}
				toolCalls={[]}
			/>,
		);

		expect(screen.getByText("Partial response")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Authentication required" })).toBeTruthy();
		expect(container.querySelector("[data-slot='thread-run-status-task']")).not.toBeNull();
		expect(container.querySelector("[data-slot='badge'][data-variant='destructive']")).toBeNull();
		expect(screen.queryByText("Provider key missing.")).toBeNull();

		await user.click(screen.getByRole("button", { name: "Authentication required" }));
		expect(
			screen.getByText("Provider key missing.").closest("[data-slot='thread-run-status-detail']"),
		).not.toBeNull();
	});

	it("does not force the transcript to bottom when expanding a legacy error task", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<MessageList
				messages={[
					createAssistantMessage("Partial response", 1, {
						errorMessage: "stream disconnected before completion: error sending request",
						stopReason: "error",
					}),
				]}
				showThinkingBlocks={false}
				toolCalls={[]}
			/>,
		);
		const viewport = getViewport(container);
		setViewportMetrics(viewport, { clientHeight: 100, scrollHeight: 1000, scrollTop: 900 });

		await act(async () => {
			viewport.scrollTop = 200;
			fireEvent.scroll(viewport);
		});

		await user.click(screen.getByRole("button", { name: "Network interrupted" }));
		expect(viewport.scrollTop).toBe(200);

		await user.click(screen.getByRole("button", { name: "Network interrupted" }));
		expect(viewport.scrollTop).toBe(200);
	});

	it("omits legacy thinking title markers while keeping the body", () => {
		render(<MessageList messages={[createAssistantThinkingMessage(1)]} showThinkingBlocks toolCalls={[]} />);

		expect(screen.getByText("The next step is clear.")).toBeTruthy();
		expect(screen.queryByText("Planning")).toBeNull();
		expect(screen.queryByText("**Planning**")).toBeNull();
	});

	it("keeps lightweight tool activity visible when streaming timestamps refresh", async () => {
		vi.useFakeTimers();
		const toolCalls = [
			{
				toolCallId: "read-1",
				toolName: "read",
				args: { path: "README.md" },
				status: "completed" as const,
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
		];
		const { rerender } = render(
			<MessageList
				isStreaming={true}
				messages={[]}
				showThinkingBlocks={false}
				streamingMessage={createAssistantToolMessage(1)}
				toolCalls={toolCalls}
			/>,
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(220);
		});

		expect(screen.getByLabelText("Read README.md")).toBeTruthy();
		expect(document.querySelector("[data-slot='task-item-file']")?.textContent).toContain("README.md");
		expect(screen.getByAltText("panel.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
		expect(screen.queryByText("Preview")).toBeNull();
		expect(screen.queryByText("README.md contents")).toBeNull();

		rerender(
			<MessageList
				isStreaming={true}
				messages={[]}
				showThinkingBlocks={false}
				streamingMessage={createAssistantToolMessage(2)}
				toolCalls={toolCalls}
			/>,
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(320);
		});

		expect(screen.getByLabelText("Read README.md")).toBeTruthy();
		expect(screen.getByAltText("panel.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
		expect(screen.queryByText("Preview")).toBeNull();
	});

	it("keeps streaming image read batches summarized across timestamp refreshes", async () => {
		vi.useFakeTimers();
		const toolCalls = Array.from({ length: 4 }, (_, index) => ({
			toolCallId: `read-image-${index}`,
			toolName: "read",
			args: { path: `/workspace/panel-${index}.png` },
			status: "completed" as const,
			startedAt: index,
			updatedAt: index + 1,
			completedAt: index + 1,
			result: {
				content: [
					{ type: "text", text: "Read image file [image/png]" },
					{ type: "image", name: `panel-${index}.png`, mimeType: "image/png", data: `iVBORw0KGgo${index}` },
				],
			},
		}));
		const createStreamingImageMessage = (timestamp: number): Extract<AgentMessage, { role: "assistant" }> => ({
			role: "assistant",
			content: toolCalls.map((toolCall) => ({
				type: "toolCall" as const,
				id: toolCall.toolCallId,
				name: "read",
				arguments: toolCall.args,
			})),
			api: "faux",
			provider: "faux",
			model: "faux-model",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp,
		});
		const { rerender } = render(
			<MessageList
				isStreaming={true}
				messages={[]}
				showThinkingBlocks={false}
				streamingMessage={createStreamingImageMessage(1)}
				toolCalls={toolCalls}
			/>,
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(220);
		});

		expect(screen.getByText("Read 4 images")).toBeTruthy();
		expect(screen.queryByLabelText("Read panel-0.png")).toBeNull();
		expect(screen.getByAltText("panel-0.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();

		rerender(
			<MessageList
				isStreaming={true}
				messages={[]}
				showThinkingBlocks={false}
				streamingMessage={createStreamingImageMessage(2)}
				toolCalls={toolCalls}
			/>,
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(320);
		});

		expect(screen.getByText("Read 4 images")).toBeTruthy();
		expect(screen.queryByText("Read image file [image/png]")).toBeNull();
		expect(screen.getByAltText("panel-3.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
	});

	it("collapses all tool segments with only run-level task state", async () => {
		const user = userEvent.setup();

		render(
			<MessageList
				messages={[
					createAssistantToolStep({
						path: "src/alpha.ts",
						text: "I will inspect the first file.",
						timestamp: 1_000,
						toolCallId: "read-alpha",
					}),
					createToolResult({
						content: "alpha contents",
						timestamp: 2_000,
						toolCallId: "read-alpha",
					}),
					createAssistantToolStep({
						path: "src/beta.ts",
						text: "I will inspect the second file.",
						timestamp: 3_000,
						toolCallId: "read-beta",
					}),
					createToolResult({
						content: "beta contents",
						timestamp: 4_000,
						toolCallId: "read-beta",
					}),
				]}
				showThinkingBlocks={false}
				toolCalls={[]}
			/>,
		);

		expect(screen.getByLabelText("Read alpha.ts")).toBeTruthy();
		expect(screen.getByLabelText("Read beta.ts")).toBeTruthy();
		expect(screen.queryByText("Preview")).toBeNull();

		await user.click(screen.getAllByRole("button", { name: /已处理/i })[0]);
		expect(screen.queryByLabelText("Read alpha.ts")).toBeNull();
		expect(screen.getByText("I will inspect the second file.")).toBeTruthy();

		await user.click(screen.getAllByRole("button", { name: /已处理/i })[0]);
		expect(screen.getByLabelText("Read alpha.ts")).toBeTruthy();
		expect(screen.queryByText("Preview")).toBeNull();
	});
});
