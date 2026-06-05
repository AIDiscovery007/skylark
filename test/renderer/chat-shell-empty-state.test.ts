import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
	ChatShell,
	resolveChatShellNoticeState,
	resolveContextWindowUsage,
	resolveModelContextWindow,
} from "../../src/renderer/components/chat/ChatShell.tsx";
import { MessageList } from "../../src/renderer/components/chat/MessageList.tsx";
import { AppLayout } from "../../src/renderer/components/layout/AppLayout.tsx";
import { WorkbenchHeader } from "../../src/renderer/components/layout/WorkbenchHeader.tsx";
import { SessionList } from "../../src/renderer/components/sidebar/SessionList.tsx";
import { TooltipProvider } from "../../src/renderer/components/ui/tooltip.tsx";
import { INITIAL_AGENT_RENDERER_STATE } from "../../src/renderer/lib/conversation-timeline-projection.ts";
import { agentStore } from "../../src/renderer/stores/agent-store.ts";

function resetAgentStore() {
	const { applyEvent, hydrateSnapshot, setActiveSession, setBridgeError } = agentStore.getState();
	agentStore.setState({
		...INITIAL_AGENT_RENDERER_STATE,
		activeSessionId: undefined,
		sessionStateAccessedAt: {},
		sessionStates: {},
		applyEvent,
		hydrateSnapshot,
		setActiveSession,
		setBridgeError,
	});
}

describe("ChatShell empty states", () => {
	beforeEach(() => {
		resetAgentStore();
	});

	it("shows a visible empty transcript state in the message pane", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [],
				showThinkingBlocks: false,
				toolCalls: [],
				emptyState: {
					label: "Skylark",
					title: "Start a new session in this workspace.",
					description: "Ask Skylark to inspect files, explain code, or shape the next change.",
					detail: "/workspace/project",
					actionLabel: "Focus composer",
					tone: "idle",
				},
			}),
		);

		expect(html).toContain("Start a new session in this workspace.");
		expect(html).toContain("Ask Skylark to inspect files, explain code, or shape the next change.");
		expect(html).toContain("/workspace/project");
		expect(html).toContain("Focus composer");
		expect(html).toContain('data-slot="conversation-boundary-state"');
		expect(html).toContain('data-boundary-state="idle"');
		expect(html).toContain("boundary-state");
		expect(html).toContain("ui-detail-label");
	});

	it("omits the session date from the compact workbench header", () => {
		const html = renderToStaticMarkup(
			createElement(
				TooltipProvider,
				undefined,
				createElement(WorkbenchHeader, {
					onOpenReview: () => undefined,
					sessionMeta: "faux / faux-model",
					sessionTitle: "Inspect workspace",
					workspaceLabel: "/workspace/project",
				}),
			),
		);

		expect(html).not.toContain("May 5, 2025");
		expect(html).not.toContain("<time");
		expect(html).toContain("h-12");
		expect(html).toContain("workbench-header relative");
		expect(html).not.toContain("workbench-header desktop-window-drag-region");
		expect(html).toContain('data-slot="workbench-header-drag-region"');
		expect(html).toContain("workbench-header-drag-region");
		expect(html).toContain('data-slot="workbench-header-title-region"');
		expect(html).toContain("desktop-window-drag-region");
		expect(html).toContain(
			'class="desktop-window-drag-region relative z-10 flex h-full shrink-0 items-center justify-end gap-2"',
		);
		expect(html).toContain('data-slot="icon-button"');
	});

	it("renders the workbench header review action only while the review workspace is closed", () => {
		const closedHtml = renderToStaticMarkup(
			createElement(
				TooltipProvider,
				undefined,
				createElement(WorkbenchHeader, {
					isReviewOpen: false,
					onOpenReview: () => undefined,
					sessionMeta: "faux / faux-model",
					sessionTitle: "Inspect workspace",
					workspaceLabel: "/workspace/project",
				}),
			),
		);
		const openHtml = renderToStaticMarkup(
			createElement(
				TooltipProvider,
				undefined,
				createElement(WorkbenchHeader, {
					isReviewOpen: true,
					onOpenReview: () => undefined,
					sessionMeta: "faux / faux-model",
					sessionTitle: "Inspect workspace",
					workspaceLabel: "/workspace/project",
				}),
			),
		);

		expect(closedHtml).toContain('data-slot="panel-header"');
		expect(closedHtml).toContain('data-slot="icon-button"');
		expect(closedHtml).toContain('aria-label="审查"');
		expect(closedHtml).toContain('data-tooltip-trigger-mode="hover"');
		expect(openHtml).toContain('data-slot="panel-header"');
		expect(openHtml).not.toContain('data-slot="icon-button"');
		expect(openHtml).not.toContain('aria-label="审查"');
	});

	it("renders the compact runtime status in the workbench header", () => {
		const html = renderToStaticMarkup(
			createElement(
				TooltipProvider,
				undefined,
				createElement(WorkbenchHeader, {
					onOpenReview: () => undefined,
					runtimeState: { state: "running" },
					sessionMeta: "faux / faux-model",
					sessionTitle: "Inspect workspace",
					workspaceLabel: "/workspace/project",
				}),
			),
		);

		expect(html).toContain('data-slot="agent-status-indicator"');
		expect(html).toContain("Working");
	});

	it("keeps the transcript body flush below the compact header", () => {
		const html = renderToStaticMarkup(
			createElement(
				AppLayout,
				{
					header: createElement("div"),
					sidebar: createElement("div"),
				},
				createElement("div", undefined, "content"),
			),
		);

		expect(html).toContain("p-0");
		expect(html).not.toContain("pt-4");
	});

	it("lets the scroll stage cover the full chat pane behind the composer", () => {
		agentStore.getState().hydrateSnapshot({
			sessionId: "session-1",
			cwd: "/workspace/project",
			agentMode: "execute",
			diagnostics: [],
			model: undefined,
			thinkingLevel: "off",
			availableTools: ["read"],
			messages: [],
			streamingMessage: undefined,
			pendingToolCalls: [],
			isStreaming: false,
			errorMessage: undefined,
		});

		const html = renderToStaticMarkup(
			createElement(
				TooltipProvider,
				undefined,
				createElement(ChatShell, {
					onAbort: async () => undefined,
					onSubmitPrompt: async () => undefined,
					showThinkingBlocks: false,
				}),
			),
		);

		expect(html).toContain('data-slot="chat-scroll-stage"');
		expect(html).toContain("absolute inset-0");
		expect(html).toContain('data-slot="composer-dock"');
		expect(html).toContain("pointer-events-none absolute inset-x-0 bottom-0");
	});

	it("calculates context window usage from the latest assistant usage", () => {
		const contextWindowUsage = resolveContextWindowUsage({
			contextWindow: 258000,
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Measured context." }],
					api: "faux",
					provider: "faux",
					model: "faux-model",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 166000,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: 1,
				},
			],
		});

		expect(contextWindowUsage).toEqual({
			usedTokens: 166000,
			totalTokens: 258000,
		});
	});

	it("ignores stale assistant usage across the latest compaction boundary", () => {
		const staleUsage = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 166000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		const contextWindowUsage = resolveContextWindowUsage({
			contextWindow: 258000,
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Measured old context." }],
					api: "faux",
					provider: "faux",
					model: "faux-model",
					usage: staleUsage,
					stopReason: "stop",
					timestamp: 1,
				},
				{
					role: "compactionSummary",
					summary: "Kept the current task context.",
					tokensBefore: 166000,
					timestamp: 10,
				} as unknown as AgentMessage,
				{
					role: "user",
					content: "latest kept prompt",
					timestamp: 2,
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "latest kept answer" }],
					api: "faux",
					provider: "faux",
					model: "faux-model",
					usage: staleUsage,
					stopReason: "stop",
					timestamp: 3,
				},
			],
		});

		expect(contextWindowUsage?.totalTokens).toBe(258000);
		expect(contextWindowUsage?.usedTokens).toBeGreaterThan(0);
		expect(contextWindowUsage?.usedTokens).toBeLessThan(1000);
	});

	it("falls back to the runtime catalog when the snapshot model has no context window", () => {
		const contextWindow = resolveModelContextWindow({
			model: {
				id: "kimi-for-coding",
				name: "kimi-for-coding",
				provider: "kimi-coding",
				reasoning: true,
			},
			runtimeCatalog: {
				defaultTools: ["read", "bash", "edit", "write"],
				providers: [
					{
						id: "kimi-coding",
						name: "Kimi For Coding",
						configured: true,
						authMethods: ["api_key" as const],
						models: [
							{
								id: "kimi-for-coding",
								name: "kimi-for-coding",
								reasoning: true,
								contextWindow: 256000,
							},
						],
					},
				],
			},
		});

		expect(contextWindow).toBe(256000);
	});

	it("renders the loading transcript skeleton without an avatar placeholder", () => {
		const html = renderToStaticMarkup(
			createElement(
				TooltipProvider,
				undefined,
				createElement(ChatShell, {
					onAbort: async () => undefined,
					onSubmitPrompt: async () => undefined,
					showThinkingBlocks: false,
				}),
			),
		);

		expect(html).toContain("h-4 w-28");
		expect(html).not.toContain("h-10 w-10 rounded-lg");
	});

	it("routes aborted requests to the lightweight transient notice state", () => {
		const noticeState = resolveChatShellNoticeState({
			bridgeError: undefined,
			errorMessage: "Request was aborted.",
			messages: [
				{
					role: "user",
					content: "hi",
					timestamp: 1,
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "" }],
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
					stopReason: "aborted",
					errorMessage: "Request was aborted.",
					timestamp: 2,
				},
			],
		});

		expect(noticeState).toEqual({
			abortNoticeKey: "2:Request was aborted.",
		});
	});

	it("keeps non-abort failures in the persistent banner state", () => {
		const noticeState = resolveChatShellNoticeState({
			bridgeError: undefined,
			errorMessage: "Provider key missing.",
			messages: [
				{
					role: "user",
					content: "hi",
					timestamp: 1,
				},
			],
		});

		expect(noticeState).toEqual({
			persistentTopNotice: "Provider key missing.",
		});
	});

	it("shows an empty project hint when persisted sessions have no messages", () => {
		const html = renderToStaticMarkup(
			createElement(SessionList, {
				sessions: [
					{
						id: "session-1",
						title: "Reply with exactly OK.",
						cwd: "/workspace/project",
						createdAt: "2026-04-22T00:00:00.000Z",
						updatedAt: "2026-04-22T00:00:00.000Z",
						messageCount: 0,
						agentMode: "execute",
						provider: "kimi-coding",
						modelId: "kimi-for-coding",
					},
				],
				activeSessionId: "session-1",
				onSelectSession: async () => undefined,
			}),
		);

		expect(html).toContain("暂无对话");
		expect(html).not.toContain("Reply with exactly OK.");
	});

	it("hides empty historical sessions when another session has real messages", () => {
		const html = renderToStaticMarkup(
			createElement(SessionList, {
				sessions: [
					{
						id: "session-empty",
						title: "Reply with exactly OK.",
						cwd: "/workspace/project",
						createdAt: "2026-04-22T00:00:00.000Z",
						updatedAt: "2026-04-22T00:00:00.000Z",
						messageCount: 0,
						agentMode: "execute",
						provider: "kimi-coding",
						modelId: "kimi-for-coding",
					},
					{
						id: "session-full",
						title: "Inspect renderer shell",
						cwd: "/workspace/project",
						createdAt: "2026-04-22T01:00:00.000Z",
						updatedAt: "2026-04-22T01:00:00.000Z",
						messageCount: 3,
						agentMode: "execute",
						provider: "kimi-coding",
						modelId: "kimi-for-coding",
					},
				],
				activeSessionId: "session-full",
				onSelectSession: async () => undefined,
			}),
		);

		expect(html).toContain("Inspect renderer shell");
		expect(html).not.toContain("Reply with exactly OK.");
	});

	it("hides top-level tool result messages from the transcript list", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "I checked the file." }],
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
						timestamp: 1,
					},
					{
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "read",
						content: [{ type: "text", text: "README.md contents" }],
						isError: false,
						timestamp: 2,
					},
				],
				showThinkingBlocks: false,
				toolCalls: [],
			}),
		);

		expect(html).toContain("I checked the file.");
		expect(html).not.toContain("README.md contents");
	});

	it("renders transcript messages without user or assistant avatar chrome", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "user",
						content: "Inspect the renderer flow.",
						timestamp: Date.parse("2025-05-05T10:31:00Z"),
					},
					{
						role: "assistant",
						content: [{ type: "text", text: "I will inspect the renderer flow." }],
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
						timestamp: Date.parse("2025-05-05T10:31:01Z"),
					},
				],
				showThinkingBlocks: false,
				toolCalls: [],
			}),
		);

		expect(html).toContain("Inspect the renderer flow.");
		expect(html).toContain("I will inspect the renderer flow.");
		expect(html).toContain("bg-[color:var(--color-user-bubble)]");
		expect(html).not.toContain("lucide-bot");
		expect(html).not.toContain("size-8 shrink-0");
	});

	it("reconstructs historical tool activity as lightweight task items", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "assistant",
						content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }],
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
						timestamp: 1,
					},
					{
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "read",
						content: [{ type: "text", text: "README.md contents" }],
						isError: false,
						timestamp: 2,
					},
				],
				showThinkingBlocks: false,
				toolCalls: [],
				defaultExpandedToolRailMessageIndex: 0,
			}),
		);

		expect(html).toContain("已处理 0s");
		expect(html).toContain("Read README.md");
		expect(html).toContain('data-slot="task-item-file"');
		expect(html).not.toContain("README.md contents");
		expect(html).not.toContain("Preview");
		expect(html).not.toContain("tool-activity-details");
		expect(html).not.toContain("No visible assistant text was emitted for this step.");
		expect(html).not.toContain("Pi is working on the next step.");
	});

	it("keeps assistant prose visible when the same message also has tool activity", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "assistant",
						content: [
							{ type: "text", text: "I will inspect the file first." },
							{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
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
						timestamp: 1,
					},
					{
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "read",
						content: [{ type: "text", text: "README.md contents" }],
						isError: false,
						timestamp: 2,
					},
				],
				showThinkingBlocks: false,
				toolCalls: [],
			}),
		);

		expect(html).toContain("I will inspect the file first.");
		expect(html).toContain("Read README.md");
		expect(html).not.toContain("No visible assistant text was emitted for this step.");
	});

	it("segments tool activity by assistant message while keeping one run summary", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "user",
						content: "Inspect relevant files.",
						timestamp: 500,
					},
					{
						role: "assistant",
						content: [
							{ type: "text", text: "I will inspect the first file." },
							{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/alpha.ts" } },
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
						timestamp: 1_000,
					},
					{
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "read",
						content: [{ type: "text", text: "alpha contents" }],
						isError: false,
						timestamp: 5_000,
					},
					{
						role: "assistant",
						content: [
							{ type: "text", text: "I will inspect the second file." },
							{ type: "toolCall", id: "call-2", name: "read", arguments: { path: "src/beta.ts" } },
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
						timestamp: 20_000,
					},
					{
						role: "toolResult",
						toolCallId: "call-2",
						toolName: "read",
						content: [{ type: "text", text: "beta contents" }],
						isError: false,
						timestamp: 70_000,
					},
					{
						role: "assistant",
						content: [{ type: "text", text: "I found the relevant files." }],
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
						timestamp: 114_000,
					},
				],
				showThinkingBlocks: false,
				toolCalls: [],
			}),
		);

		expect(html.match(/已处理/g)).toHaveLength(1);
		expect(html).toContain("已处理 1m 53s");
		expect(html).toContain("Read alpha.ts");
		expect(html).toContain("Read beta.ts");
		expect(html.indexOf("Read alpha.ts")).toBeLessThan(html.indexOf("I will inspect the second file."));
		expect(html.indexOf("I will inspect the second file.")).toBeLessThan(html.indexOf("Read beta.ts"));
		expect(html).toContain("I found the relevant files.");
	});

	it("keeps parallel tool calls from one assistant message in the same activity segment", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "assistant",
						content: [
							{ type: "text", text: "I will inspect both files." },
							{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/alpha.ts" } },
							{ type: "toolCall", id: "call-2", name: "read", arguments: { path: "src/beta.ts" } },
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
						timestamp: 1_000,
					},
					{
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "read",
						content: [{ type: "text", text: "alpha contents" }],
						isError: false,
						timestamp: 2_000,
					},
					{
						role: "toolResult",
						toolCallId: "call-2",
						toolName: "read",
						content: [{ type: "text", text: "beta contents" }],
						isError: false,
						timestamp: 3_000,
					},
				],
				showThinkingBlocks: false,
				toolCalls: [],
			}),
		);

		expect(html.match(/aria-label="Tool activity"/g)).toHaveLength(1);
		expect(html.match(/已处理/g)).toHaveLength(1);
		expect(html).toContain("Read alpha.ts");
		expect(html).toContain("Read beta.ts");
	});

	it("does not show an empty assistant fallback for tool-only messages before activity hydration", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "assistant",
						content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }],
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
						timestamp: 1,
					},
				],
				showThinkingBlocks: false,
				toolCalls: [],
			}),
		);

		expect(html).not.toContain("No visible assistant text was emitted for this step.");
	});

	it("shows a lightweight thinking fallback for empty assistant messages", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "assistant",
						content: [],
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
						timestamp: 1,
					},
				],
				showThinkingBlocks: false,
				toolCalls: [],
			}),
		);

		expect(html).toContain("正在思考");
		expect(html).toContain("motion-thinking-dot");
		expect(html).not.toContain("No visible assistant text was emitted for this step.");
	});

	it("shows a pending thinking status immediately after the latest user message while streaming", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "user",
						content: "inspect this file",
						timestamp: 1,
					},
				],
				isStreaming: true,
				showThinkingBlocks: false,
				toolCalls: [],
			}),
		);

		expect(html).toContain("正在思考");
		expect(html.indexOf("inspect this file")).toBeLessThan(html.indexOf("正在思考"));
	});

	it("renders the active run thinking status before visible thinking blocks", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "user",
						content: "inspect this file",
						timestamp: 1,
					},
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "inspect package.json" },
							{ type: "text", text: "done" },
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
						stopReason: "stop",
						timestamp: 2,
					},
				],
				isStreaming: true,
				showThinkingBlocks: true,
				toolCalls: [],
			}),
		);

		expect(html).toContain("正在思考");
		expect(html.indexOf("正在思考")).toBeLessThan(html.indexOf("inspect package.json"));
	});

	it("shows a failure fallback when the transcript cannot be loaded", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [],
				showThinkingBlocks: false,
				toolCalls: [],
				emptyState: {
					label: "Session unavailable",
					title: "The current transcript could not be loaded.",
					description: "The desktop bridge did not return a usable session snapshot yet.",
					detail: "Bridge snapshot request failed",
					tone: "error",
				},
			}),
		);

		expect(html).toContain("The current transcript could not be loaded.");
		expect(html).toContain("The desktop bridge did not return a usable session snapshot yet.");
		expect(html).toContain("Bridge snapshot request failed");
		expect(html).toContain('data-boundary-state="error"');
		expect(html).toContain("boundary-state-error");
	});

	it("hides assistant thinking blocks by default", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "inspect package.json" },
							{ type: "text", text: "done" },
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
						stopReason: "stop",
						timestamp: 1,
					},
				],
				showThinkingBlocks: false,
				toolCalls: [],
			}),
		);

		expect(html).not.toContain("inspect package.json");
		expect(html).not.toContain("Thinking");
	});

	it("shows assistant thinking blocks when enabled", () => {
		const html = renderToStaticMarkup(
			createElement(MessageList, {
				messages: [
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "inspect package.json" },
							{ type: "text", text: "done" },
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
						stopReason: "stop",
						timestamp: 1,
					},
				],
				showThinkingBlocks: true,
				toolCalls: [],
			}),
		);

		expect(html).toContain("inspect package.json");
		expect(html).toContain("Thinking");
	});
});
