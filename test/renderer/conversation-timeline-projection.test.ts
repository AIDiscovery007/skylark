import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAgentRendererState,
	getMessageToolCalls,
	prependOlderMessagesToRendererState,
	reduceAgentEvent,
	updateProjectSessionSummariesForAgentEvent,
	updateSessionSummariesForAgentEvent,
	updateSessionSummariesForProfileSnapshot,
} from "../../src/renderer/lib/conversation-timeline-projection.ts";
import type { DesktopAgentSnapshot, SerializedAgentEventPayload } from "../../src/shared/serialized-agent-event.ts";
import { DESKTOP_TASK_PROGRESS_TOOL_NAME, type DesktopSessionSummary } from "../../src/shared/types.ts";

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

function createSnapshot(sessionId = "session-1"): DesktopAgentSnapshot {
	return {
		sessionId,
		cwd: "/workspace/project",
		agentMode: "execute",
		diagnostics: [{ type: "info", message: "ready" }],
		model: {
			id: "faux-model",
			provider: "faux",
			name: "Faux Model",
			reasoning: false,
		},
		thinkingLevel: "off",
		availableTools: ["read", "bash", "edit", "write"],
		messages: [],
		streamingMessage: undefined,
		pendingToolCalls: [],
		isStreaming: false,
		errorMessage: undefined,
	};
}

function createUserMessage(text: string, timestamp: number): UserMessage {
	return {
		role: "user",
		content: text,
		timestamp,
	};
}

function createUserImageMessage(text: string, timestamp: number, metadata?: unknown): AgentMessage {
	return {
		role: "user",
		content: [
			{ type: "text", text },
			{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
		],
		...(metadata ? { metadata } : {}),
		timestamp,
	} as unknown as AgentMessage;
}

function createAssistantMessage(text: string, timestamp: number, errorMessage?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "faux-provider",
		provider: "faux",
		model: "faux-model",
		usage: EMPTY_USAGE,
		stopReason: errorMessage ? "aborted" : "stop",
		errorMessage,
		timestamp,
	};
}

function createAssistantToolMessage(timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{ type: "text", text: "I will inspect package.json first." },
			{ type: "toolCall", id: "call-1", name: "read", arguments: { filePath: "README.md" } },
		],
		api: "faux-provider",
		provider: "faux",
		model: "faux-model",
		usage: EMPTY_USAGE,
		stopReason: "toolUse",
		timestamp,
	};
}

function createToolResultMessage(toolCallId: string, timestamp: number): ToolResultMessage<unknown> {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "read",
		content: [{ type: "text", text: "README.md contents" }],
		isError: false,
		timestamp,
	};
}

function createCompactionSummaryMessage(summary: string, timestamp: number): AgentMessage {
	return {
		role: "compactionSummary" as const,
		summary,
		tokensBefore: 42_000,
		timestamp,
	} as unknown as AgentMessage;
}

function createEvent<TEvent extends SerializedAgentEventPayload>(
	event: TEvent,
	sessionId = "session-1",
): TEvent & { sessionId: string } {
	return {
		...event,
		sessionId,
	};
}

function createSession(id: string, updatedAt: string, title = id, messageCount = 0): DesktopSessionSummary {
	return {
		id,
		title,
		cwd: "/workspace/project",
		createdAt: updatedAt,
		updatedAt,
		messageCount,
		agentMode: "execute",
		provider: "anthropic",
		modelId: "claude-sonnet-4-20250514",
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("conversationTimelineProjection", () => {
	it("hydrates snapshot state with pending tool calls", () => {
		const userMessage = createUserMessage("inspect the repo", 1);
		const snapshot = {
			...createSnapshot(),
			messages: [userMessage],
			pendingToolCalls: ["call-1"],
			isStreaming: true,
		};

		const state = createAgentRendererState(snapshot);

		expect(state.hasHydrated).toBe(true);
		expect(state.cwd).toBe("/workspace/project");
		expect(state.availableTools).toEqual(["read", "bash", "edit", "write"]);
		expect(state.messages).toEqual([userMessage]);
		expect(state.contextMessages).toEqual([userMessage]);
		expect(state.pendingToolCalls).toEqual(["call-1"]);
		expect(state.toolCalls).toEqual([
			expect.objectContaining({
				toolCallId: "call-1",
				toolName: "tool",
				args: {},
				status: "running",
				startedAt: expect.any(Number),
				updatedAt: expect.any(Number),
			}),
		]);
	});

	it("preserves previously loaded older messages when a windowed snapshot refreshes", () => {
		const messages = Array.from({ length: 10 }, (_, index) => createUserMessage(`message ${index + 1}`, index + 1));
		const initialState = createAgentRendererState({
			...createSnapshot(),
			messages: messages.slice(6, 10),
			messageWindow: { start: 6, end: 10, total: 10, hasMoreBefore: true },
		});
		const loadedState = prependOlderMessagesToRendererState(initialState, {
			sessionId: "session-1",
			messages: messages.slice(2, 6),
			window: { start: 2, end: 6, total: 10, hasMoreBefore: true },
		});

		const refreshedState = createAgentRendererState(
			{
				...createSnapshot(),
				messages: messages.slice(6, 10),
				messageWindow: { start: 6, end: 10, total: 10, hasMoreBefore: true },
			},
			loadedState,
		);

		expect(refreshedState.messages).toEqual(messages.slice(2, 10));
		expect(refreshedState.contextMessages).toEqual(messages.slice(2, 10));
		expect(refreshedState.messageWindow).toEqual({ start: 2, end: 10, total: 10, hasMoreBefore: true });
	});

	it("advances a windowed transcript when new messages are appended", () => {
		const messages = Array.from({ length: 4 }, (_, index) => createUserMessage(`message ${index + 1}`, index + 1));
		let state = createAgentRendererState({
			...createSnapshot(),
			messages: messages.slice(2, 4),
			messageWindow: { start: 2, end: 4, total: 4, hasMoreBefore: true },
		});
		const nextMessage = createAssistantMessage("new answer", 5);

		state = reduceAgentEvent(state, createEvent({ type: "message_end", message: nextMessage }));

		expect(state.messages).toEqual([...messages.slice(2, 4), nextMessage]);
		expect(state.messageWindow).toEqual({ start: 2, end: 5, total: 5, hasMoreBefore: true });
	});

	it("keeps visible transcript messages when a compacted snapshot updates context messages", () => {
		const firstUser = createUserMessage("first prompt", 1);
		const firstAssistant = createAssistantMessage("first response", 2);
		const secondUser = createUserMessage("second prompt", 3);
		const secondAssistant = createAssistantMessage("second response", 4);
		const compactionSummary = createCompactionSummaryMessage("internal summary stays hidden", 5);

		const previousState = createAgentRendererState({
			...createSnapshot(),
			messages: [firstUser, firstAssistant, secondUser, secondAssistant],
		});
		const state = createAgentRendererState(
			{ ...createSnapshot(), messages: [compactionSummary, secondUser, secondAssistant] },
			previousState,
		);

		expect(state.messages).toEqual([firstUser, firstAssistant, secondUser, secondAssistant, compactionSummary]);
		expect(state.contextMessages).toEqual([compactionSummary, secondUser, secondAssistant]);
	});

	it("reduces streaming messages, tool activity, and agent_end without duplicating committed messages", () => {
		let state = createAgentRendererState(createSnapshot());
		const userMessage = createUserMessage("summarize README", 1);
		const partialAssistant = createAssistantMessage("Working", 2);
		const finalAssistant = createAssistantMessage("Summary complete", 3);
		const toolResult = createToolResultMessage("call-1", 4);

		state = reduceAgentEvent(state, createEvent({ type: "agent_start" }));
		state = reduceAgentEvent(state, createEvent({ type: "message_start", message: userMessage }));
		state = reduceAgentEvent(state, createEvent({ type: "message_end", message: userMessage }));
		state = reduceAgentEvent(state, createEvent({ type: "message_start", message: partialAssistant }));
		state = reduceAgentEvent(
			state,
			createEvent({
				type: "message_update",
				message: partialAssistant,
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "ing", partial: partialAssistant },
			}),
		);
		state = reduceAgentEvent(
			state,
			createEvent({
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "read",
				args: { filePath: "README.md" },
			}),
		);
		state = reduceAgentEvent(
			state,
			createEvent({
				type: "tool_execution_update",
				toolCallId: "call-1",
				toolName: "read",
				args: { filePath: "README.md" },
				partialResult: { content: [{ type: "text", text: "opening" }] },
			}),
		);
		state = reduceAgentEvent(state, createEvent({ type: "message_end", message: finalAssistant }));
		state = reduceAgentEvent(
			state,
			createEvent({
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "read",
				result: { content: [{ type: "text", text: "done" }] },
				isError: false,
			}),
		);
		state = reduceAgentEvent(state, createEvent({ type: "message_start", message: toolResult }));
		state = reduceAgentEvent(state, createEvent({ type: "message_end", message: toolResult }));
		state = reduceAgentEvent(
			state,
			createEvent({ type: "turn_end", message: finalAssistant, toolResults: [toolResult] }),
		);
		state = reduceAgentEvent(
			state,
			createEvent({ type: "agent_end", messages: [userMessage, finalAssistant, toolResult] }),
		);

		expect(state.isStreaming).toBe(false);
		expect(state.streamingMessage).toBe(undefined);
		expect(state.pendingToolCalls).toEqual([]);
		expect(state.messages).toEqual([userMessage, finalAssistant, toolResult]);
		expect(state.runActivityTiming).toEqual(
			expect.objectContaining({
				endedAt: expect.any(Number),
				firstTokenAt: expect.any(Number),
				runId: expect.any(String),
				startedAt: expect.any(Number),
				totalChunks: 1,
			}),
		);
		expect(state.toolCalls).toEqual([
			expect.objectContaining({
				toolCallId: "call-1",
				toolName: "read",
				args: { filePath: "README.md" },
				status: "completed",
				partialResult: { content: [{ type: "text", text: "opening" }] },
				result: { content: [{ type: "text", text: "done" }] },
				startedAt: expect.any(Number),
				updatedAt: expect.any(Number),
				completedAt: expect.any(Number),
			}),
		]);

		const matchedToolCalls = getMessageToolCalls(createAssistantToolMessage(5), state.toolCalls);
		expect(matchedToolCalls).toHaveLength(1);
		expect(matchedToolCalls[0]?.toolCallId).toBe("call-1");
	});

	it("reconciles enriched image prompt metadata from agent_end without duplicating the turn", () => {
		let state = createAgentRendererState(createSnapshot());
		const userMessage = createUserImageMessage("inspect this screenshot", 1);
		const enrichedUserMessage = createUserImageMessage("inspect this screenshot", 1, {
			custom: {
				desktopPromptVisibleText: "inspect this screenshot",
				desktopPromptAttachments: [
					{
						id: "attachment-1",
						kind: "image",
						name: "panel.png",
						mimeType: "image/png",
						size: 42,
					},
				],
			},
		});
		const finalAssistant = createAssistantMessage("Screenshot inspected.", 2);

		state = reduceAgentEvent(state, createEvent({ type: "agent_start" }));
		state = reduceAgentEvent(state, createEvent({ type: "message_end", message: userMessage }));
		state = reduceAgentEvent(state, createEvent({ type: "message_end", message: finalAssistant }));
		state = reduceAgentEvent(
			state,
			createEvent({ type: "agent_end", messages: [enrichedUserMessage, finalAssistant] }),
		);

		expect(state.isStreaming).toBe(false);
		expect(state.streamingMessage).toBe(undefined);
		expect(state.messages).toEqual([enrichedUserMessage, finalAssistant]);
		expect(state.contextMessages).toEqual([enrichedUserMessage, finalAssistant]);
	});

	it("hydrates and updates task progress from internal tool results", () => {
		const taskProgress = {
			title: "Implement panel",
			items: [
				{ id: "inspect", label: "Inspect runtime", status: "completed" as const },
				{ id: "render", label: "Render panel", status: "active" as const },
			],
			updatedAt: "2026-05-17T00:00:00.000Z",
		};
		const nextTaskProgress = {
			...taskProgress,
			items: taskProgress.items.map((item) => ({ ...item, status: "completed" as const })),
			completedAt: "2026-05-17T00:01:00.000Z",
			updatedAt: "2026-05-17T00:01:00.000Z",
		};

		const state = createAgentRendererState({ ...createSnapshot(), taskProgress });
		const nextState = reduceAgentEvent(
			state,
			createEvent({
				type: "tool_execution_end",
				toolCallId: "progress-1",
				toolName: DESKTOP_TASK_PROGRESS_TOOL_NAME,
				result: {
					content: [{ type: "text", text: "progress updated" }],
					details: { taskProgress: nextTaskProgress },
				},
				isError: false,
			}),
		);

		expect(state.taskProgress).toEqual(taskProgress);
		expect(nextState.taskProgress).toEqual(nextTaskProgress);
	});

	it("projects session summaries from agent lifecycle and title events", () => {
		vi.useFakeTimers();
		let sessions = [createSession("session-1", "2026-04-21T09:00:00.000Z", "New Session")];

		vi.setSystemTime(new Date("2026-04-21T10:00:00.000Z"));
		sessions = updateSessionSummariesForAgentEvent(sessions, { type: "agent_start", sessionId: "session-1" });
		expect(sessions[0]).toEqual(
			expect.objectContaining({
				isStreaming: true,
				runStartedAt: "2026-04-21T10:00:00.000Z",
				updatedAt: "2026-04-21T10:00:00.000Z",
			}),
		);

		vi.setSystemTime(new Date("2026-04-21T10:01:00.000Z"));
		sessions = updateSessionSummariesForAgentEvent(
			sessions,
			createEvent({ type: "message_end", message: createUserMessage("Background prompt", 1) }),
		);
		expect(sessions[0]).toEqual(
			expect.objectContaining({
				messageCount: 1,
				updatedAt: "2026-04-21T10:01:00.000Z",
			}),
		);

		vi.setSystemTime(new Date("2026-04-21T10:02:00.000Z"));
		sessions = updateSessionSummariesForAgentEvent(sessions, {
			type: "agent_end",
			sessionId: "session-1",
			messages: [],
		});
		expect(sessions[0]).toEqual(
			expect.objectContaining({
				isStreaming: false,
				runStartedAt: undefined,
				updatedAt: "2026-04-21T10:02:00.000Z",
			}),
		);

		vi.setSystemTime(new Date("2026-04-21T10:03:00.000Z"));
		sessions = updateSessionSummariesForAgentEvent(sessions, {
			type: "session_title_update",
			sessionId: "session-1",
			title: "后台任务",
		});
		expect(sessions[0]).toEqual(
			expect.objectContaining({
				title: "后台任务",
				updatedAt: "2026-04-21T10:03:00.000Z",
			}),
		);
	});

	it("projects project session titles from the first user message", () => {
		const firstUserPrompt =
			"Create a compact renderer-only projection module for the conversation timeline and preserve behavior";
		let sessions = [createSession("session-created", "2026-04-21T10:00:00.000Z", "New Session")];

		sessions = updateProjectSessionSummariesForAgentEvent(
			sessions,
			createEvent({ type: "message_end", message: createUserMessage(firstUserPrompt, 1) }, "session-created"),
		);

		expect(sessions[0]).toEqual(
			expect.objectContaining({
				title: firstUserPrompt.slice(0, 80),
				messageCount: 1,
			}),
		);

		sessions = updateProjectSessionSummariesForAgentEvent(
			sessions,
			createEvent({ type: "message_end", message: createUserMessage("second prompt", 2) }, "session-created"),
		);
		expect(sessions[0]?.title).toBe(firstUserPrompt.slice(0, 80));
		expect(sessions[0]?.messageCount).toBe(2);
	});

	it("strips prompt file blocks from projected project session titles", () => {
		const userPrompt =
			'Summarize this spreadsheet and list its columns.\n\n<file name="/Users/qiaochao/Downloads/笔记列表明细表.xlsx">\nhidden spreadsheet content\n</file>';
		let sessions = [createSession("session-created", "2026-04-21T10:00:00.000Z", "New Session")];

		sessions = updateProjectSessionSummariesForAgentEvent(
			sessions,
			createEvent({ type: "message_end", message: createUserMessage(userPrompt, 1) }, "session-created"),
		);

		expect(sessions[0]).toEqual(
			expect.objectContaining({
				title: "Summarize this spreadsheet and list its columns.",
				messageCount: 1,
			}),
		);
	});

	it("projects profile snapshot metadata without reordering session summaries", () => {
		const sessionOne = createSession("session-1", "2026-04-21T09:00:00.000Z", "First");
		const sessionTwo = createSession("session-2", "2026-04-21T10:00:00.000Z", "Second");

		const sessions = updateSessionSummariesForProfileSnapshot([sessionTwo, sessionOne], {
			...createSnapshot("session-1"),
			agentMode: "plan",
			isStreaming: true,
			model: {
				id: "gpt-5.4",
				name: "GPT-5.4",
				provider: "openai",
				reasoning: true,
			},
		});

		expect(sessions.map((session) => session.id)).toEqual(["session-2", "session-1"]);
		expect(sessions[1]).toEqual(
			expect.objectContaining({
				id: "session-1",
				provider: "openai",
				modelId: "gpt-5.4",
				agentMode: "plan",
				isStreaming: true,
				updatedAt: "2026-04-21T09:00:00.000Z",
			}),
		);
	});
});
