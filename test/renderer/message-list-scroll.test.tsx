import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MessageList } from "../../src/renderer/components/chat/MessageList.tsx";

afterEach(() => {
	cleanup();
});

function createAssistantMessage(text: string, timestamp: number): Extract<AgentMessage, { role: "assistant" }> {
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

	it("keeps tool row expansion when streaming timestamps refresh", async () => {
		const toolCalls = [
			{
				toolCallId: "read-1",
				toolName: "read",
				args: { path: "README.md" },
				status: "completed" as const,
				startedAt: 1,
				updatedAt: 2,
				completedAt: 2,
				result: { content: [{ type: "text", text: "README.md contents" }] },
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
			fireEvent.click(screen.getByRole("button", { name: /read readme\.md/i }));
		});

		expect(screen.getByText("Preview")).toBeTruthy();

		rerender(
			<MessageList
				isStreaming={true}
				messages={[]}
				showThinkingBlocks={false}
				streamingMessage={createAssistantToolMessage(2)}
				toolCalls={toolCalls}
			/>,
		);

		expect(screen.getByText("Preview")).toBeTruthy();
	});

	it("collapses all tool segments without clearing row detail expansion", async () => {
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

		await user.click(screen.getByRole("button", { name: /read alpha\.ts/i }));
		expect(screen.getByText("Preview")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: /已处理/i }));
		expect(screen.queryByText("Read alpha.ts")).toBeNull();
		expect(screen.getByText("I will inspect the second file.")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: /已处理/i }));
		expect(screen.getByText("Read alpha.ts")).toBeTruthy();
		expect(screen.getByText("Preview")).toBeTruthy();
	});
});
