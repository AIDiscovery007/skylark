import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
	createAssistantUiRuntimeMessages,
	DESKTOP_COMPACTION_NOTICE_METADATA_KEY,
	DESKTOP_FILE_REFERENCES_METADATA_KEY,
	DESKTOP_PROMPT_ATTACHMENTS_METADATA_KEY,
	DESKTOP_PROPOSED_PLAN_METADATA_KEY,
	DESKTOP_RUN_ACTIVITY_METADATA_KEY,
	type DesktopAppendMessage,
	type DesktopThreadMessage,
	getAppendMessageText,
} from "../../src/renderer/lib/assistant-runtime-adapter.ts";
import type { ToolCallActivity } from "../../src/renderer/lib/conversation-timeline-projection.ts";
import { DESKTOP_TASK_PROGRESS_TOOL_NAME } from "../../src/shared/types.ts";

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function userMessage(text: string, timestamp = 1): Extract<AgentMessage, { role: "user" }> {
	return {
		role: "user",
		content: text,
		timestamp,
	};
}

function assistantMessage(
	content: Extract<AgentMessage, { role: "assistant" }>["content"],
	timestamp = 2,
	overrides: Partial<Extract<AgentMessage, { role: "assistant" }>> = {},
): Extract<AgentMessage, { role: "assistant" }> {
	return {
		role: "assistant",
		api: "faux",
		content,
		model: "faux-model",
		provider: "faux",
		stopReason: "stop",
		timestamp,
		usage: EMPTY_USAGE,
		...overrides,
	};
}

function toolResultMessage(
	toolCallId: string,
	timestamp = 3,
	isError = false,
): Extract<AgentMessage, { role: "toolResult" }> {
	return {
		role: "toolResult",
		content: [{ type: "text", text: "README.md contents" }],
		isError,
		timestamp,
		toolCallId,
		toolName: "read",
	};
}

function getParts(message: DesktopThreadMessage) {
	if (typeof message.content === "string") {
		throw new Error("Expected structured content");
	}
	return message.content;
}

describe("assistant runtime adapter", () => {
	it("merges assistant run activity before final text", () => {
		const activity: ToolCallActivity = {
			args: { path: "README.md" },
			completedAt: 4,
			result: { content: [{ type: "text", text: "README.md contents" }] },
			startedAt: 2,
			status: "completed",
			toolCallId: "call-1",
			toolName: "read",
			updatedAt: 4,
		};
		const messages = [
			userMessage("inspect README"),
			assistantMessage(
				[
					{ type: "thinking", thinking: "Need to read the file." },
					{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
				],
				2,
				{ stopReason: "toolUse" },
			),
			toolResultMessage("call-1"),
			assistantMessage([{ type: "text", text: "README.md is ready." }], 5),
		];

		const converted = createAssistantUiRuntimeMessages({
			messages,
			showThinkingBlocks: true,
			toolCalls: [activity],
		});

		expect(converted).toHaveLength(2);
		expect(converted[0]).toMatchObject({ role: "user", content: "inspect README" });
		const assistantParts = getParts(converted[1]);
		expect(assistantParts.map((part) => part.type)).toEqual(["reasoning", "tool-call", "text"]);
		expect(assistantParts[0]).toMatchObject({ text: "Need to read the file.", type: "reasoning" });
		expect(assistantParts[1]).toMatchObject({
			args: { path: "README.md" },
			result: activity.result,
			toolCallId: "call-1",
			toolName: "read",
			type: "tool-call",
		});
		expect(assistantParts[2]).toMatchObject({ text: "README.md is ready.", type: "text" });
		expect(converted[1]?.metadata?.custom?.desktopRunActivity).toMatchObject({
			endedAt: 5,
			hasReasoning: true,
			startedAt: 2,
			toolCount: 1,
		});
	});

	it("hides reasoning parts when thinking blocks are disabled", () => {
		const [converted] = createAssistantUiRuntimeMessages({
			messages: [
				assistantMessage([
					{ type: "thinking", thinking: "Hidden chain" },
					{ type: "text", text: "Visible answer" },
				]),
			],
			showThinkingBlocks: false,
		});

		expect(getParts(converted).map((part) => part.type)).toEqual(["text"]);
	});

	it("hides internal task progress tool calls from assistant activity", () => {
		const progressArgs = {
			tasks: [{ id: "inspect", label: "Inspect runtime", status: "completed" }],
		};
		const progressActivity: ToolCallActivity = {
			args: progressArgs,
			completedAt: 4,
			result: {
				content: [{ type: "text", text: "Task progress updated: 1/1 tasks completed." }],
				details: {
					taskProgress: {
						items: [{ id: "inspect", label: "Inspect runtime", status: "completed" }],
						updatedAt: "2026-05-17T00:00:00.000Z",
					},
				},
			},
			startedAt: 2,
			status: "completed",
			toolCallId: "progress-1",
			toolName: DESKTOP_TASK_PROGRESS_TOOL_NAME,
			updatedAt: 4,
		};

		const [assistant] = createAssistantUiRuntimeMessages({
			messages: [
				assistantMessage(
					[
						{
							type: "toolCall",
							id: "progress-1",
							name: DESKTOP_TASK_PROGRESS_TOOL_NAME,
							arguments: progressArgs,
						},
						{ type: "text", text: "Continuing implementation." },
					],
					2,
				),
			],
			showThinkingBlocks: true,
			toolCalls: [progressActivity],
		});

		expect(getParts(assistant)).toEqual([{ text: "Continuing implementation.", type: "text" }]);
		expect(assistant.metadata?.custom?.desktopRunActivity).toMatchObject({ toolCount: 0 });
	});

	it("adds changed file references for completed edit and write tool calls", () => {
		const writeActivity: ToolCallActivity = {
			args: { path: "src/new-view.tsx" },
			completedAt: 4,
			result: { content: [{ type: "text", text: "Successfully wrote 10 bytes to src/new-view.tsx" }] },
			startedAt: 2,
			status: "completed",
			toolCallId: "call-write",
			toolName: "write",
			updatedAt: 4,
		};
		const editActivity: ToolCallActivity = {
			args: { path: "src/App.tsx" },
			completedAt: 5,
			result: { content: [{ type: "text", text: "Updated src/App.tsx" }] },
			startedAt: 3,
			status: "completed",
			toolCallId: "call-edit",
			toolName: "edit",
			updatedAt: 5,
		};

		const [, assistant] = createAssistantUiRuntimeMessages({
			messages: [
				userMessage("change files"),
				assistantMessage(
					[
						{ type: "toolCall", id: "call-write", name: "write", arguments: { path: "src/new-view.tsx" } },
						{ type: "toolCall", id: "call-edit", name: "edit", arguments: { path: "src/App.tsx" } },
						{ type: "text", text: "Done." },
					],
					2,
				),
			],
			showThinkingBlocks: true,
			toolCalls: [writeActivity, editActivity],
		});

		expect(assistant.metadata?.custom?.[DESKTOP_FILE_REFERENCES_METADATA_KEY]).toEqual([
			{ displayPath: "src/new-view.tsx", kind: "changed", path: "src/new-view.tsx", toolName: "write" },
			{ displayPath: "src/App.tsx", kind: "changed", path: "src/App.tsx", toolName: "edit" },
		]);
	});

	it("adds found file references from completed find and grep tool calls", () => {
		const findActivity: ToolCallActivity = {
			args: { path: "src", pattern: "**/*.tsx" },
			completedAt: 4,
			result: { content: [{ type: "text", text: "components/FileCard.tsx\nApp.tsx" }] },
			startedAt: 2,
			status: "completed",
			toolCallId: "call-find",
			toolName: "find",
			updatedAt: 4,
		};
		const grepActivity: ToolCallActivity = {
			args: { path: ".", pattern: "openWorkspacePreviewFile" },
			completedAt: 5,
			result: {
				content: [
					{
						type: "text",
						text: "src/App.tsx:12: openWorkspacePreviewFile()\nsrc/lib/preview.ts-7- context",
					},
				],
			},
			startedAt: 3,
			status: "completed",
			toolCallId: "call-grep",
			toolName: "grep",
			updatedAt: 5,
		};

		const [assistant] = createAssistantUiRuntimeMessages({
			messages: [
				assistantMessage(
					[
						{
							type: "toolCall",
							id: "call-find",
							name: "find",
							arguments: { path: "src", pattern: "**/*.tsx" },
						},
						{
							type: "toolCall",
							id: "call-grep",
							name: "grep",
							arguments: { path: ".", pattern: "openWorkspacePreviewFile" },
						},
						{ type: "text", text: "Found files." },
					],
					2,
				),
			],
			showThinkingBlocks: true,
			toolCalls: [findActivity, grepActivity],
		});

		expect(assistant.metadata?.custom?.[DESKTOP_FILE_REFERENCES_METADATA_KEY]).toEqual([
			{
				displayPath: "src/components/FileCard.tsx",
				kind: "found",
				path: "src/components/FileCard.tsx",
				toolName: "find",
			},
			{ displayPath: "src/App.tsx", kind: "found", path: "src/App.tsx", toolName: "find" },
			{ displayPath: "src/lib/preview.ts", kind: "found", path: "src/lib/preview.ts", toolName: "grep" },
		]);
	});

	it("keeps only directly referenced found files from broad searches", () => {
		const findActivity: ToolCallActivity = {
			args: { path: ".", pattern: "**/*" },
			completedAt: 4,
			result: {
				content: [
					{
						type: "text",
						text: [
							".DS_Store",
							".localized",
							".omx/logs/tmux-hook-2026-05-12.jsonl",
							".omx/logs/turns-2026-05-12.jsonl",
							".omx/metrics.json",
							".omx/state/hud-state.json",
							"index.html",
							"notes.txt",
						].join("\n"),
					},
				],
			},
			startedAt: 2,
			status: "completed",
			toolCallId: "call-find",
			toolName: "find",
			updatedAt: 4,
		};

		const [assistant] = createAssistantUiRuntimeMessages({
			messages: [
				assistantMessage(
					[
						{
							type: "toolCall",
							id: "call-find",
							name: "find",
							arguments: { path: ".", pattern: "**/*" },
						},
						{ type: "text", text: "Use `index.html` for the implementation." },
					],
					2,
				),
			],
			showThinkingBlocks: true,
			toolCalls: [findActivity],
		});

		expect(assistant.metadata?.custom?.[DESKTOP_FILE_REFERENCES_METADATA_KEY]).toEqual([
			{ displayPath: "index.html", kind: "found", path: "index.html", toolName: "find" },
		]);
	});

	it("marks streaming and error messages with desktop timeline statuses", () => {
		const streamingMessage = assistantMessage([{ type: "text", text: "partial" }], 10);
		const [streaming] = createAssistantUiRuntimeMessages({
			isStreaming: true,
			messages: [],
			showThinkingBlocks: true,
			streamingMessage,
		});
		const [failed] = createAssistantUiRuntimeMessages({
			messages: [
				assistantMessage([{ type: "text", text: "before error" }], 11, {
					errorMessage: "boom",
					stopReason: "error",
				}),
			],
			showThinkingBlocks: true,
		});

		expect(streaming.status).toEqual({ type: "running" });
		expect(failed.status).toMatchObject({ reason: "error", type: "incomplete" });
		expect(getParts(failed)).toEqual([{ text: "before error", type: "text" }]);
	});

	it("uses prompt attachment metadata to hide injected file content in user messages", () => {
		const [converted] = createAssistantUiRuntimeMessages({
			messages: [
				{
					role: "user",
					content: 'Please inspect this\n\n<file name="notes.md">hidden context</file>',
					timestamp: 1,
					metadata: {
						custom: {
							desktopPromptVisibleText: "Please inspect this",
							desktopPromptAttachments: [
								{
									id: "attachment-1",
									kind: "text",
									name: "notes.md",
									mimeType: "text/markdown",
									size: 42,
								},
							],
						},
					},
				} as Extract<AgentMessage, { role: "user" }>,
			],
			showThinkingBlocks: true,
		});

		expect(converted.role).toBe("user");
		expect(getParts(converted)).toEqual([{ type: "text", text: "Please inspect this" }]);
		expect(converted.metadata?.custom?.[DESKTOP_PROMPT_ATTACHMENTS_METADATA_KEY]).toEqual([
			{
				id: "attachment-1",
				kind: "text",
				name: "notes.md",
				mimeType: "text/markdown",
				size: 42,
			},
		]);
	});

	it("renders compaction summaries as restrained system notices", () => {
		const [converted] = createAssistantUiRuntimeMessages({
			messages: [
				{
					role: "compactionSummary",
					summary: "Architecture Decisions\n\nKeep the upload path desktop-only.",
					tokensBefore: 1234,
					timestamp: 2,
				} as unknown as AgentMessage,
			],
			showThinkingBlocks: true,
		});

		expect(converted.role).toBe("system");
		expect(getParts(converted)).toEqual([{ type: "text", text: "上下文已压缩" }]);
		expect(converted.metadata?.custom?.[DESKTOP_COMPACTION_NOTICE_METADATA_KEY]).toEqual({
			status: "completed",
			tokensBefore: 1234,
		});
	});

	it("extracts proposed plans without rendering raw plan blocks", () => {
		const planText = "\n# Plan\n\n1. Do the work.\n";
		const [converted] = createAssistantUiRuntimeMessages({
			messages: [
				assistantMessage([
					{
						type: "text",
						text: `Investigation done.\n<proposed_plan>${planText}</proposed_plan>\nReady to execute.`,
					},
				]),
			],
			showThinkingBlocks: true,
		});

		expect(converted.metadata?.custom?.[DESKTOP_PROPOSED_PLAN_METADATA_KEY]).toEqual({ text: planText });
		expect(getParts(converted)).toEqual([{ text: "Investigation done.\n\nReady to execute.", type: "text" }]);
	});

	it("keeps a streaming assistant run id stable across chunk timestamp changes", () => {
		const [first] = createAssistantUiRuntimeMessages({
			isStreaming: true,
			messages: [],
			showThinkingBlocks: true,
			streamingMessage: assistantMessage([{ type: "thinking", thinking: "Scanning" }], 10),
		});
		const [next] = createAssistantUiRuntimeMessages({
			isStreaming: true,
			messages: [],
			showThinkingBlocks: true,
			streamingMessage: assistantMessage([{ type: "thinking", thinking: "Still scanning" }], 11),
		});

		expect(first.id).toBe("assistant-run-0");
		expect(next.id).toBe(first.id);
	});

	it("marks the latest assistant run active from global streaming state and uses run timing metadata", () => {
		const startedAt = Date.parse("2026-04-28T00:00:00.000Z");
		const endedAt = startedAt + 7000;
		const [running] = createAssistantUiRuntimeMessages({
			isStreaming: true,
			messages: [
				assistantMessage([{ type: "thinking", thinking: "Waiting for tool result." }], 10, {
					stopReason: "toolUse",
				}),
			],
			runActivityTiming: { startedAt },
			showThinkingBlocks: true,
		});
		const [completed] = createAssistantUiRuntimeMessages({
			isStreaming: false,
			messages: [
				assistantMessage([
					{ type: "thinking", thinking: "Waiting for tool result." },
					{ type: "text", text: "Done." },
				]),
			],
			runActivityTiming: { startedAt, endedAt },
			showThinkingBlocks: true,
		});

		expect(running.status).toEqual({ type: "running" });
		expect(running.metadata?.custom?.desktopRunActivity).toMatchObject({
			runId: "assistant-run-0",
			startedAt,
			toolCount: 0,
		});
		expect(running.metadata?.timing).toMatchObject({
			streamStartTime: startedAt,
			totalChunks: 0,
			toolCallCount: 0,
		});
		expect(running.metadata?.timing?.totalStreamTime).toBeUndefined();
		expect(completed.metadata?.custom?.desktopRunActivity).toMatchObject({
			endedAt,
			runId: "assistant-run-0",
			startedAt,
		});
		expect(completed.metadata?.timing).toMatchObject({
			streamStartTime: startedAt,
			totalChunks: 0,
			toolCallCount: 0,
			totalStreamTime: 7000,
		});
	});

	it("marks the active gap after completed tools as waiting for response", () => {
		const [running] = createAssistantUiRuntimeMessages({
			isStreaming: true,
			messages: [
				assistantMessage([{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }], 10, {
					stopReason: "toolUse",
				}),
				toolResultMessage("call-1", 11),
			],
			showThinkingBlocks: true,
		});

		expect(running.status).toEqual({ type: "running" });
		expect(running.metadata?.custom?.desktopRunActivity).toMatchObject({
			phase: "waiting_for_response",
			toolCount: 1,
		});
	});

	it("adds an immediate assistant activity while waiting for the first model response", () => {
		const startedAt = Date.parse("2026-04-28T00:00:00.000Z");
		const converted = createAssistantUiRuntimeMessages({
			isStreaming: true,
			messages: [userMessage("read the attached markdown")],
			runActivityTiming: {
				runId: "run-first-response",
				startedAt,
				totalChunks: 0,
			},
			showThinkingBlocks: true,
			streamingMessage: undefined,
		});

		expect(converted).toHaveLength(2);
		expect(converted[0]).toMatchObject({ role: "user", content: "read the attached markdown" });
		expect(converted[1]).toMatchObject({
			id: "run-first-response",
			role: "assistant",
			content: [],
			status: { type: "running" },
		});
		expect(converted[1]?.metadata?.custom?.[DESKTOP_RUN_ACTIVITY_METADATA_KEY]).toMatchObject({
			hasReasoning: false,
			phase: "waiting_for_response",
			runId: "run-first-response",
			startedAt,
			toolCount: 0,
		});
		expect(converted[1]?.metadata?.timing).toMatchObject({
			streamStartTime: startedAt,
			totalChunks: 0,
			toolCallCount: 0,
		});
	});

	it("does not re-mark a completed run as active before the next user message arrives", () => {
		const [user, assistant] = createAssistantUiRuntimeMessages({
			isStreaming: true,
			messages: [
				userMessage("first run"),
				assistantMessage([
					{ type: "thinking", thinking: "Already done." },
					{ type: "text", text: "Done." },
				]),
			],
			runActivityTiming: {
				runId: "new-run",
				startedAt: Date.parse("2026-04-28T00:00:00.000Z"),
			},
			showThinkingBlocks: true,
		});

		expect(user.role).toBe("user");
		expect(assistant.status).toEqual({ type: "complete", reason: "stop" });
		expect(assistant.id).toBe("assistant-run-1");
		expect(assistant.metadata?.custom?.desktopRunActivity).not.toMatchObject({ runId: "new-run" });
	});

	it("does not carry a stale streaming message into a non-streaming snapshot", () => {
		const converted = createAssistantUiRuntimeMessages({
			isStreaming: false,
			messages: [userMessage("completed session"), assistantMessage([{ type: "text", text: "Completed answer." }])],
			showThinkingBlocks: true,
			streamingMessage: assistantMessage(
				[
					{ type: "thinking", thinking: "Still running elsewhere." },
					{ type: "toolCall", id: "call-stale", name: "bash", arguments: { command: "sleep 45" } },
				],
				9,
				{ stopReason: "toolUse" },
			),
		});

		expect(converted).toHaveLength(2);
		expect(converted[0]).toMatchObject({ role: "user", content: "completed session" });
		expect(getParts(converted[1]).map((part) => part.type)).toEqual(["text"]);
		expect(getParts(converted[1])[0]).toMatchObject({ text: "Completed answer." });
	});

	it("extracts text from desktop append messages", () => {
		const message = {
			content: [
				{ text: "first", type: "text" },
				{ text: "second", type: "text" },
			],
			createdAt: new Date(0),
			attachments: [],
			metadata: {
				custom: {},
				steps: undefined,
				unstable_annotations: undefined,
				unstable_data: undefined,
				unstable_state: undefined,
			},
			parentId: null,
			role: "user",
			runConfig: undefined,
			sourceId: null,
		} satisfies DesktopAppendMessage;

		expect(getAppendMessageText(message)).toBe("first\nsecond");
	});

	it("extracts text from string desktop append messages", () => {
		const message = {
			content: "  direct prompt  ",
			createdAt: new Date(0),
			attachments: [],
			metadata: { custom: {} },
			parentId: null,
			role: "user",
			runConfig: undefined,
			sourceId: null,
		} satisfies DesktopAppendMessage;

		expect(getAppendMessageText(message)).toBe("direct prompt");
	});
});
