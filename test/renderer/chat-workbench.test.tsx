import { readFileSync } from "node:fs";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWorkbench } from "../../src/renderer/components/chat/ChatWorkbench.tsx";
import { INITIAL_AGENT_RENDERER_STATE } from "../../src/renderer/lib/conversation-timeline-projection.ts";
import { activityDrawerTransition } from "../../src/renderer/lib/motion.ts";
import { agentStore } from "../../src/renderer/stores/agent-store.ts";
import type { DesktopAgentBridge } from "../../src/shared/ipc-contract.ts";
import type { DesktopAgentSnapshot } from "../../src/shared/serialized-agent-event.ts";
import type {
	DesktopEnvironmentEvent,
	DesktopEnvironmentResource,
	DesktopWorkspaceFileEntry,
} from "../../src/shared/types.ts";

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function resetAgentStore(): void {
	agentStore.setState({
		...INITIAL_AGENT_RENDERER_STATE,
		activeSessionId: "session-1",
		availableTools: ["read", "bash", "edit", "write"],
		cwd: "/workspace/project",
		hasHydrated: true,
		model: {
			contextWindow: 128000,
			id: "faux-model",
			name: "Faux Model",
			provider: "faux",
			reasoning: true,
		},
		sessionStateAccessedAt: {},
		pendingActiveSessionId: undefined,
		sessionStates: {},
		thinkingLevel: "low",
	});
}

function assistantMessage(
	content: Extract<AgentMessage, { role: "assistant" }>["content"],
	timestamp = 1,
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

function userMessage(
	text: string,
	timestamp = 1,
	capabilityInvocations?: Array<{
		type: "skill" | "prompt_template";
		name: string;
		description?: string;
		sourcePath?: string;
	}>,
): Extract<AgentMessage, { role: "user" }> {
	const message = {
		role: "user" as const,
		content: [{ type: "text" as const, text }],
		timestamp,
	};
	if (!capabilityInvocations) {
		return message;
	}
	return {
		...message,
		metadata: {
			custom: {
				desktopCapabilityInvocations: capabilityInvocations,
			},
		},
	} as Extract<AgentMessage, { role: "user" }>;
}

function toolResultMessage(toolCallId: string): Extract<AgentMessage, { role: "toolResult" }> {
	return {
		role: "toolResult",
		content: [{ type: "text", text: "README.md contents" }],
		isError: false,
		timestamp: 2,
		toolCallId,
		toolName: "read",
	};
}

function compactionSummaryMessage(summary = "Internal summary should stay hidden.", timestamp = 1): AgentMessage {
	return {
		role: "compactionSummary",
		summary,
		tokensBefore: 42000,
		timestamp,
	} as unknown as AgentMessage;
}

function agentSnapshot(overrides: Partial<DesktopAgentSnapshot> = {}): DesktopAgentSnapshot {
	return {
		sessionId: "session-1",
		cwd: "/workspace/project",
		agentMode: "execute",
		consumedProposedPlanMessageIds: [],
		diagnostics: [],
		model: {
			contextWindow: 128000,
			id: "faux-model",
			name: "Faux Model",
			provider: "faux",
			reasoning: true,
		},
		thinkingLevel: "low",
		availableTools: ["read", "bash", "edit", "write"],
		messages: [],
		pendingToolCalls: [],
		isStreaming: false,
		...overrides,
	};
}

function getStreamingMarkdownText(container: HTMLElement): string | undefined {
	return (
		container.querySelector("[data-slot='assistant-markdown-content'][data-streaming='true']")?.textContent ??
		undefined
	);
}

function getAssistantViewport(container: HTMLElement): HTMLDivElement {
	const viewport = container.querySelector("[data-slot='assistant-thread-viewport']");
	if (!(viewport instanceof HTMLDivElement)) {
		throw new Error("Assistant thread viewport was not rendered.");
	}
	return viewport;
}

function setAssistantViewportMetrics(
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

function createResizeObserverEntry(target: Element, height: number): ResizeObserverEntry {
	return {
		contentRect: {
			bottom: height,
			height,
			left: 0,
			right: 0,
			toJSON: () => ({}),
			top: 0,
			width: 0,
			x: 0,
			y: 0,
		},
		target,
	} as ResizeObserverEntry;
}

function setElementRect(
	element: Element,
	rect: { bottom: number; height: number; left?: number; right?: number; top: number; width?: number },
): void {
	const width = rect.width ?? 760;
	const left = rect.left ?? 0;
	Object.defineProperty(element, "getBoundingClientRect", {
		configurable: true,
		value: () =>
			({
				bottom: rect.bottom,
				height: rect.height,
				left,
				right: rect.right ?? left + width,
				toJSON: () => ({}),
				top: rect.top,
				width,
				x: left,
				y: rect.top,
			}) satisfies DOMRect,
	});
}

function setReadOnlyElementNumber(
	element: Element,
	key: "clientHeight" | "scrollHeight" | "scrollTop",
	value: number,
): void {
	Object.defineProperty(element, key, {
		configurable: true,
		value,
		writable: key === "scrollTop",
	});
}

function promptSlashCommand(index: number) {
	return {
		name: `cmd-${index}`,
		description: `Command ${index}`,
		source: "prompt" as const,
		sourcePath: `/workspace/project/.pi/prompts/cmd-${index}.md`,
	};
}

const environmentResources: DesktopEnvironmentResource[] = [
	{
		id: "env_tmux_session",
		sessionId: "session-1",
		cwd: "/workspace/project",
		kind: "tmux_session",
		provider: "tmux",
		title: "fix-login-500",
		status: "running",
		metadata: {
			tmuxSessionName: "skylark_session_fix_login",
		},
		createdAt: "2026-05-20T08:00:00.000Z",
		updatedAt: "2026-05-20T08:30:00.000Z",
		lastSeenAt: "2026-05-20T08:30:00.000Z",
	},
	{
		id: "env_tmux_window_test",
		sessionId: "session-1",
		cwd: "/workspace/project",
		kind: "tmux_window",
		provider: "tmux",
		parentId: "env_tmux_session",
		title: "Test",
		status: "running",
		metadata: {
			currentCommand: "vitest --run login.spec.ts",
			tmuxSessionName: "skylark_session_fix_login",
			tmuxWindowName: "test",
		},
		createdAt: "2026-05-20T08:00:00.000Z",
		updatedAt: "2026-05-20T08:30:00.000Z",
		lastSeenAt: "2026-05-20T08:30:00.000Z",
	},
	{
		id: "env_tmux_window_dev",
		sessionId: "session-1",
		cwd: "/workspace/project",
		kind: "tmux_window",
		provider: "tmux",
		parentId: "env_tmux_session",
		title: "Dev Server",
		status: "stale",
		metadata: {
			currentCommand: "npm run dev",
			tmuxSessionName: "skylark_session_fix_login",
			tmuxWindowName: "dev-server",
		},
		createdAt: "2026-05-20T08:00:00.000Z",
		updatedAt: "2026-05-20T08:30:00.000Z",
		lastSeenAt: "2026-05-20T08:30:00.000Z",
	},
];

const singleWindowEnvironmentResources: DesktopEnvironmentResource[] = [
	environmentResources[0]!,
	{
		...environmentResources[1]!,
		id: "env_tmux_window_zsh",
		title: "zsh",
		metadata: {
			currentCommand: "zsh",
			tmuxSessionName: "skylark_session_fix_login",
			tmuxWindowName: "zsh",
		},
	},
];

function installEnvironmentBridge(resources: DesktopEnvironmentResource[] = environmentResources) {
	const bridge = {
		listEnvironmentResources: vi.fn(async () => resources),
		subscribeToEnvironmentEvents: vi.fn(() => () => undefined),
	} satisfies Pick<DesktopAgentBridge, "listEnvironmentResources" | "subscribeToEnvironmentEvents">;
	Object.defineProperty(window, "desktopAgent", {
		configurable: true,
		value: bridge,
	});
	return bridge;
}

function installWorkspaceFileBridge(files: DesktopWorkspaceFileEntry[]) {
	const bridge = {
		listWorkspaceFiles: vi.fn(async () => ({
			rootPath: "/workspace/project",
			files,
			truncated: false,
		})),
	} satisfies Pick<DesktopAgentBridge, "listWorkspaceFiles">;
	Object.defineProperty(window, "desktopAgent", {
		configurable: true,
		value: bridge,
	});
	return bridge;
}

const workspaceFiles: DesktopWorkspaceFileEntry[] = [
	{
		path: "src/App.tsx",
		name: "App.tsx",
		type: "code",
		size: 42,
		updatedAt: "2026-06-01T10:00:00.000Z",
	},
	{
		path: "docs/my file.md",
		name: "my file.md",
		type: "docs",
		size: 24,
		updatedAt: "2026-06-01T09:00:00.000Z",
	},
	{
		path: "README.md",
		name: "README.md",
		type: "docs",
		size: 12,
		updatedAt: "2026-06-01T08:00:00.000Z",
	},
];

beforeEach(() => {
	resetAgentStore();
});

afterEach(() => {
	cleanup();
	agentStore.setState({
		...INITIAL_AGENT_RENDERER_STATE,
		activeSessionId: undefined,
		pendingActiveSessionId: undefined,
		sessionStateAccessedAt: {},
		sessionStates: {},
	});
	Reflect.deleteProperty(window, "desktopAgent");
	vi.useRealTimers();
});

describe("ChatWorkbench", () => {
	it("renders markdown through AI Elements without assistant-ui markdown scope", () => {
		const source = readFileSync("src/renderer/components/chat/ChatWorkbench.tsx", "utf8");

		expect(source).not.toContain("@assistant-ui/react-markdown");
		expect(source).not.toContain("TextMessagePartProvider");
		expect(source).toContain("MessageResponse");
	});

	it("renders an intentional empty boundary state without prompt examples", async () => {
		const user = userEvent.setup();

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const emptyState = screen.getByText("What should we work on?").closest("[data-slot='assistant-empty-state']");
		expect(emptyState).not.toBeNull();
		expect(emptyState?.getAttribute("data-boundary-state")).toBe("idle");
		expect(emptyState?.className).toContain("boundary-state");
		expect(screen.getByText("Ask Skylark to inspect files, explain code, or shape the next change.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /inspect/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /research/i })).toBeNull();

		await user.click(screen.getByRole("button", { name: "Focus composer" }));
		expect(document.activeElement).toBe(screen.getByLabelText("Message Skylark"));
	});

	it("renders bridge failures as an accessible empty boundary state", () => {
		agentStore.setState({
			bridgeError: "Bridge snapshot request failed",
			hasHydrated: true,
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const emptyState = screen
			.getByText("The current transcript could not be loaded.")
			.closest("[data-slot='assistant-empty-state']");
		expect(emptyState?.getAttribute("data-boundary-state")).toBe("error");
		expect(emptyState?.getAttribute("role")).toBe("alert");
		expect(screen.getByText("Bridge snapshot request failed")).toBeTruthy();
		expect((screen.getByLabelText("Message Skylark") as HTMLTextAreaElement).disabled).toBe(true);
	});

	it("keeps conversation hydration visually quiet before delayed status is needed", () => {
		vi.useFakeTimers();
		agentStore.setState({ activeSessionId: "session-1", hasHydrated: false });

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const hydrationState = document.querySelector("[data-slot='assistant-hydration-state']");
		expect(hydrationState?.getAttribute("aria-busy")).toBe("true");
		expect(document.querySelector("[data-slot='assistant-hydration-skeleton']")).toBeNull();
		expect(document.querySelector("[data-slot='skeleton']")).toBeNull();
		expect(screen.queryByRole("status", { name: "Loading conversation" })).toBeNull();

		act(() => {
			vi.advanceTimersByTime(200);
		});

		expect(screen.getByRole("status", { name: "Loading conversation" })).toBeTruthy();
		expect(document.querySelector("[data-slot='skeleton']")).toBeNull();
	});

	it("does not show an infinite loading state when no session is active", () => {
		vi.useFakeTimers();
		agentStore.setState({ activeSessionId: undefined, cwd: undefined, hasHydrated: false });

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		act(() => {
			vi.advanceTimersByTime(250);
		});

		expect(screen.queryByRole("status", { name: "Loading conversation" })).toBeNull();
		expect(screen.getByText("What should we work on?")).toBeTruthy();
		expect((screen.getByLabelText("Message Skylark") as HTMLTextAreaElement).disabled).toBe(true);
	});

	it("hides the current transcript behind a quiet switch state while an uncached session loads", () => {
		vi.useFakeTimers();
		agentStore.setState({
			activeSessionId: "session-1",
			messages: [assistantMessage([{ type: "text", text: "Previous transcript should not remain visible." }], 1)],
			pendingActiveSessionId: "session-2",
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const switchState = document.querySelector("[data-slot='assistant-session-switch-state']");
		expect(switchState?.getAttribute("aria-busy")).toBe("true");
		expect(screen.queryByText("Previous transcript should not remain visible.")).toBeNull();
		expect(document.querySelector("[data-slot='assistant-hydration-skeleton']")).toBeNull();
		expect(document.querySelector("[data-slot='skeleton']")).toBeNull();
		expect(screen.queryByRole("status", { name: "Loading session" })).toBeNull();

		act(() => {
			vi.advanceTimersByTime(200);
		});

		expect(screen.getByRole("status", { name: "Loading session" })).toBeTruthy();
	});

	it("shows a cached target session immediately without the quiet switch state", () => {
		agentStore.setState({
			activeSessionId: "session-2",
			messages: [assistantMessage([{ type: "text", text: "Cached transcript appears immediately." }], 1)],
			pendingActiveSessionId: undefined,
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.getByText("Cached transcript appears immediately.")).toBeTruthy();
		expect(document.querySelector("[data-slot='assistant-session-switch-state']")).toBeNull();
	});

	it("marks thread message text as selectable", () => {
		agentStore.setState({
			messages: [
				userMessage("Please keep this selectable.", 1),
				assistantMessage([{ type: "text", text: "Assistant text remains selectable." }], 2),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const markdownRoots = document.querySelectorAll("[data-slot='assistant-markdown-content']");
		expect(markdownRoots.length).toBeGreaterThanOrEqual(2);
		for (const markdownRoot of markdownRoots) {
			expect(markdownRoot.getAttribute("data-selectable-text")).toBe("true");
			expect(markdownRoot.className).toContain("select-text");
		}
	});

	it("submits composer text through the external store runtime", async () => {
		const user = userEvent.setup();
		const onSubmitPrompt = vi.fn(async () => undefined);
		const prompt = "inspect package json：中文，punctuation?!";

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={onSubmitPrompt}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.type(screen.getByPlaceholderText("Message Skylark"), prompt);
		await user.click(screen.getByLabelText("Send message"));

		await waitFor(() => {
			expect(onSubmitPrompt).toHaveBeenCalledWith({ text: prompt });
		});
	});

	it("submits prepared prompt attachments without requiring visible text", async () => {
		const user = userEvent.setup();
		const onSubmitPrompt = vi.fn(async () => undefined);
		const attachment = {
			id: "attachment-1",
			kind: "text" as const,
			name: "notes.md",
			mimeType: "text/markdown",
			size: 12,
			promptText: '<file name="notes.md">hello</file>',
			images: [],
		};
		agentStore.setState({ activeSessionId: "session-1" });
		Object.defineProperty(window, "desktopAgent", {
			configurable: true,
			value: {
				openPromptAttachments: vi.fn(async () => ({ attachments: [attachment], errors: [] })),
			},
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={onSubmitPrompt}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.click(screen.getByLabelText("Attach files"));
		expect(await screen.findByText("notes.md")).toBeTruthy();
		await user.click(screen.getByLabelText("Send message"));

		await waitFor(() => {
			expect(onSubmitPrompt).toHaveBeenCalledWith({ text: "", attachments: [attachment] });
		});
	});

	it("prepares pasted images as prompt attachments", async () => {
		const attachment = {
			id: "attachment-1",
			kind: "image" as const,
			name: "pasted.png",
			mimeType: "image/png",
			size: 4,
			promptText: '<file name="pasted.png"></file>',
			images: [],
		};
		const preparePromptAttachments = vi.fn(async () => ({ attachments: [attachment], errors: [] }));
		Object.defineProperty(window, "desktopAgent", {
			configurable: true,
			value: { preparePromptAttachments },
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const file = new File([new Uint8Array([1, 2, 3, 4])], "pasted.png", { type: "image/png" });
		fireEvent.paste(screen.getByPlaceholderText("Message Skylark"), {
			clipboardData: {
				files: [file],
			},
		});

		await waitFor(() => {
			expect(preparePromptAttachments).toHaveBeenCalledWith({
				candidates: [
					{
						type: "inline_image",
						name: "pasted.png",
						mimeType: "image/png",
						data: "AQIDBA==",
						size: 4,
					},
				],
			});
		});
		expect(await screen.findByText("pasted.png")).toBeTruthy();
	});

	it("clears prompt attachment errors when switching sessions", async () => {
		const user = userEvent.setup();
		agentStore.setState({ activeSessionId: "session-1" });
		Object.defineProperty(window, "desktopAgent", {
			configurable: true,
			value: {
				openPromptAttachments: vi.fn(async () => ({
					attachments: [],
					errors: [
						{
							name: "budget.xlsx",
							path: "/workspace/project/budget.xlsx",
							message:
								"Unsupported binary prompt attachment. Supported prompt attachments are text files, images, .docx, and .xlsx.",
						},
					],
				})),
			},
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.click(screen.getByLabelText("Attach files"));
		expect(await screen.findByText(/budget\.xlsx/)).toBeTruthy();

		await act(async () => {
			agentStore.setState({ activeSessionId: "session-2" });
		});

		await waitFor(() => {
			expect(screen.queryByText(/budget\.xlsx/)).toBeNull();
		});
	});

	it("routes the compact slash command to manual compaction", async () => {
		const user = userEvent.setup();
		const onCompact = vi.fn(async () => undefined);
		const onSubmitPrompt = vi.fn(async () => undefined);

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onCompact={onCompact}
				onSubmitPrompt={onSubmitPrompt}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.type(screen.getByPlaceholderText("Message Skylark"), "/compact preserve tests");
		await user.click(screen.getByLabelText("Send message"));

		await waitFor(() => {
			expect(onCompact).toHaveBeenCalledWith("preserve tests");
		});
		expect(onSubmitPrompt).not.toHaveBeenCalled();
	});

	it("clears the compact slash command even when manual compaction is a no-op", async () => {
		const user = userEvent.setup();
		const onCompact = vi.fn(async () => {
			throw new Error("Nothing to compact (session too small)");
		});
		const onSubmitPrompt = vi.fn(async () => undefined);

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onCompact={onCompact}
				onSubmitPrompt={onSubmitPrompt}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const input = screen.getByPlaceholderText("Message Skylark");
		await user.type(input, "/compact");
		await user.click(screen.getByLabelText("Send message"));

		await waitFor(() => {
			expect((input as HTMLTextAreaElement).value).toBe("");
		});
		expect(onCompact).toHaveBeenCalledWith(undefined);
		expect(onSubmitPrompt).not.toHaveBeenCalled();
	});

	it("routes selected compact slash command to manual compaction on the next enter", async () => {
		const user = userEvent.setup();
		const onCompact = vi.fn(async () => undefined);
		const onSubmitPrompt = vi.fn(async () => undefined);

		render(
			<ChatWorkbench
				capabilityCatalog={{
					diagnostics: [],
					mcpServers: [],
					prompts: [],
					skills: [],
					slashCommands: [
						{
							name: "compact",
							description: "Manually compact the session context",
							source: "builtin",
						},
					],
				}}
				onAbort={vi.fn(async () => undefined)}
				onCompact={onCompact}
				onSubmitPrompt={onSubmitPrompt}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const input = screen.getByPlaceholderText("Message Skylark") as HTMLTextAreaElement;
		await user.type(input, "/com");
		expect(await screen.findByText("/compact")).toBeTruthy();

		await user.keyboard("{Enter}");
		expect(input.value).toBe("/compact ");

		await user.keyboard("{Enter}");
		await waitFor(() => {
			expect(onCompact).toHaveBeenCalledWith(undefined);
		});
		expect(input.value).toBe("");
		expect(onSubmitPrompt).not.toHaveBeenCalled();
	});

	it("renders compaction summary as a restrained thread divider without summary content", async () => {
		agentStore.setState({
			messages: [
				compactionSummaryMessage("Architecture Decisions\n\nDo not render this internal text.", 1),
				userMessage("latest kept prompt", 2),
				assistantMessage([{ type: "text", text: "latest kept answer" }], 3),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(await screen.findByText("上下文已压缩")).toBeTruthy();
		expect(screen.queryByText(/Architecture Decisions/)).toBeNull();
		expect(screen.getByText("latest kept prompt")).toBeTruthy();
		expect(screen.getByText("latest kept answer")).toBeTruthy();
	});

	it("shows an in-thread compaction progress divider while compaction is running", () => {
		agentStore.setState({
			compactionActivity: {
				reason: "manual",
				startedAt: 1,
			},
			messages: [userMessage("compact this session", 1)],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const divider = screen.getByText("正在压缩上下文").closest("[data-slot='compaction-timeline-divider']");
		expect(divider).toBeTruthy();
		expect(divider?.getAttribute("data-status")).toBe("running");
	});

	it("renders the session mode control and updates the session mode", async () => {
		const user = userEvent.setup();
		const onSetSessionMode = vi.fn(async () => undefined);

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSetSessionMode={onSetSessionMode}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const inactivePlanButton = screen.getByRole("button", { name: "Turn on plan mode" });
		expect(inactivePlanButton.getAttribute("aria-pressed")).toBe("false");
		expect(screen.queryByRole("button", { name: /execute mode/i })).toBeNull();
		await user.click(inactivePlanButton);

		expect(onSetSessionMode).toHaveBeenCalledWith("plan");

		act(() => {
			agentStore.setState({ agentMode: "plan" });
		});

		const activePlanButton = screen.getByRole("button", { name: "Turn off plan mode" });
		expect(activePlanButton.getAttribute("aria-pressed")).toBe("true");
		await user.click(activePlanButton);

		expect(onSetSessionMode).toHaveBeenLastCalledWith("execute");
	});

	it("does not scroll the thread to the bottom when switching session mode", async () => {
		const user = userEvent.setup();
		const requestAnimationFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			});
		const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
		try {
			const messages = [
				assistantMessage(
					[{ type: "text", text: "A long completed answer that the user is reading above the bottom." }],
					1,
				),
			];
			const onSetSessionMode = vi.fn(async () => {
				agentStore.getState().hydrateSnapshot(
					agentSnapshot({
						agentMode: "plan",
						availableTools: ["read", "bash"],
						messages,
					}),
				);
			});
			agentStore.getState().hydrateSnapshot(agentSnapshot({ messages }));

			const { container } = render(
				<ChatWorkbench
					onAbort={vi.fn(async () => undefined)}
					onSetSessionMode={onSetSessionMode}
					onSubmitPrompt={vi.fn(async () => undefined)}
					runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
					showThinkingBlocks={false}
				/>,
			);
			const viewport = getAssistantViewport(container);
			const scrollTo = vi.fn();
			Object.defineProperty(viewport, "scrollTo", {
				configurable: true,
				value: scrollTo,
			});
			setAssistantViewportMetrics(viewport, { clientHeight: 600, scrollHeight: 1800, scrollTop: 420 });

			await user.click(screen.getByRole("button", { name: "Turn on plan mode" }));

			expect(onSetSessionMode).toHaveBeenCalledWith("plan");
			expect(scrollTo).not.toHaveBeenCalled();
			expect(viewport.scrollTop).toBe(420);
		} finally {
			cancelAnimationFrame.mockRestore();
			requestAnimationFrame.mockRestore();
		}
	});

	it("renders a header-controlled read-only environment status panel", async () => {
		const user = userEvent.setup();
		const bridge = installEnvironmentBridge();
		agentStore.setState({
			activeSessionId: "session-1",
			taskProgress: {
				title: "Implement progress panel",
				items: [
					{ id: "inspect", label: "Inspect runtime", status: "completed" },
					{ id: "render", label: "Render panel", status: "active" },
					{ id: "verify", label: "Run verification", status: "pending" },
					{ id: "smoke", label: "Desktop smoke test", status: "failed" },
				],
				updatedAt: "2026-05-17T00:00:00.000Z",
			},
		});

		function renderShell(isWorkspacePanelOpen: boolean) {
			return (
				<ChatWorkbench
					isWorkspacePanelOpen={isWorkspacePanelOpen}
					onAbort={vi.fn(async () => undefined)}
					onSubmitPrompt={vi.fn(async () => undefined)}
					runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
					showThinkingBlocks={false}
				/>
			);
		}

		const { rerender } = render(renderShell(true));

		const panel = screen.getByLabelText("Environment");
		expect(panel.getAttribute("data-slot")).toBe("assistant-workspace-status-panel");
		expect(panel.className).toContain("absolute");
		expect(panel.className).toContain("right-4");
		expect(screen.getByText("Implement progress panel")).toBeTruthy();
		expect(screen.getByText("Inspect runtime")).toBeTruthy();
		expect(screen.getByText("Render panel")).toBeTruthy();
		expect(screen.getByText("Run verification")).toBeTruthy();
		expect(screen.getByText("Desktop smoke test")).toBeTruthy();
		await waitFor(() => {
			expect(bridge.listEnvironmentResources).toHaveBeenCalled();
			expect(screen.getByText("Test")).toBeTruthy();
		});
		expect(screen.getByText("Dev Server")).toBeTruthy();
		expect(screen.queryByText("fix-login-500")).toBeNull();
		expect(panel.textContent).not.toContain("vitest --run login.spec.ts");
		expect(panel.textContent).not.toContain("/workspace/project");
		expect(screen.queryByRole("button", { name: "Minimize workspace status panel" })).toBeNull();
		expect(document.querySelector("[data-slot='assistant-workspace-status-mini']")).toBeNull();

		rerender(renderShell(false));
		await waitFor(() => expect(screen.queryByLabelText("Environment")).toBeNull());
		expect(document.querySelector("[data-slot='assistant-workspace-status-mini']")).toBeNull();

		rerender(renderShell(true));
		expect(screen.getByLabelText("Environment")).toBeTruthy();
		expect(screen.getByText("Render panel")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Collapse environment status" }));

		expect(screen.queryByText("Inspect runtime")).toBeNull();
		expect(screen.getByRole("button", { name: "Expand environment status" }).getAttribute("aria-expanded")).toBe(
			"false",
		);
	});

	it("hides the workspace status panel when no progress or environment resource exists", () => {
		installEnvironmentBridge([]);
		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.queryByLabelText("Environment")).toBeNull();
	});

	it("does not keep detached environment resources visible", async () => {
		const bridge = installEnvironmentBridge([
			{
				...environmentResources[0]!,
				status: "detached",
			},
		]);
		agentStore.setState({ activeSessionId: "session-1" });

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await waitFor(() => expect(bridge.listEnvironmentResources).toHaveBeenCalled());
		expect(screen.queryByLabelText("Environment")).toBeNull();
		expect(screen.queryByText("fix-login-500")).toBeNull();
	});

	it("shows environment resource status without task progress", async () => {
		installEnvironmentBridge();
		agentStore.setState({ activeSessionId: "session-1" });

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const panel = await screen.findByLabelText("Environment");
		expect(screen.getByText("Test")).toBeTruthy();
		expect(screen.getByText("Dev Server")).toBeTruthy();
		expect(screen.queryByText("fix-login-500")).toBeNull();
		expect(screen.getAllByText("running").length).toBeGreaterThan(0);
		expect(panel.textContent).not.toContain("/workspace/project");
	});

	it("keeps completed and failed subagents visible in the environment panel", async () => {
		const user = userEvent.setup();
		const onOpenEnvironmentResource = vi.fn();
		installEnvironmentBridge([
			{
				createdAt: "2026-05-27T01:00:00.000Z",
				cwd: "/workspace/project",
				id: "env_subagent_completed",
				kind: "subagent",
				lastSeenAt: "2026-05-27T01:01:00.000Z",
				metadata: {
					limitReached: "true",
					limitReason: "max_turns",
					subagentId: "subagent-1",
					transcriptPath: "/Users/qiaochao/.skylark/subagents/session-1/subagent-1.jsonl",
					turnCount: "1",
				},
				provider: "subagent",
				sessionId: "session-1",
				status: "completed",
				title: "Inspect auth flow",
				updatedAt: "2026-05-27T01:01:00.000Z",
			},
			{
				createdAt: "2026-05-27T01:02:00.000Z",
				cwd: "/workspace/project",
				id: "env_subagent_failed",
				kind: "subagent",
				lastSeenAt: "2026-05-27T01:03:00.000Z",
				metadata: {
					subagentId: "subagent-2",
					transcriptPath: "/Users/qiaochao/.skylark/subagents/session-1/subagent-2.jsonl",
				},
				provider: "subagent",
				sessionId: "session-1",
				status: "failed",
				title: "Inspect billing flow",
				updatedAt: "2026-05-27T01:03:00.000Z",
			},
		]);
		agentStore.setState({ activeSessionId: "session-1" });

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onOpenEnvironmentResource={onOpenEnvironmentResource}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await screen.findByText("Inspect auth flow");
		expect(screen.getByText("Inspect billing flow")).toBeTruthy();
		expect(screen.getByText("Subagent · project · budget reached")).toBeTruthy();
		expect(screen.getByText("Subagent · project")).toBeTruthy();
		expect(screen.getByText("completed")).toBeTruthy();
		expect(screen.getByText("failed")).toBeTruthy();
		const authSubagentRow = screen.getByRole("button", { name: "Open Inspect auth flow" });
		expect(authSubagentRow.getAttribute("disabled")).toBeNull();
		await user.click(authSubagentRow);
		expect(onOpenEnvironmentResource).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "subagent",
				metadata: expect.objectContaining({ subagentId: "subagent-1" }),
				sessionId: "session-1",
			}),
		);
	});

	it("renders a persisted subagent activity row as a noninteractive task item", async () => {
		const user = userEvent.setup();
		installEnvironmentBridge([]);
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{
							type: "toolCall",
							id: "subagent-1",
							name: "subagent",
							arguments: {
								title: "Inspect auth flow",
								task: "Find where the auth flow is defined.",
							},
						},
					],
					1,
					{ stopReason: "toolUse" },
				),
				{
					role: "toolResult",
					content: [{ type: "text", text: "## Subagent conclusion\nAuth lives in `src/auth.ts`." }],
					details: {
						status: "completed",
						subagentId: "subagent-session-1",
						title: "Inspect auth flow",
						transcriptPath: "/Users/qiaochao/.skylark/subagents/session-1/subagent-session-1.jsonl",
					},
					isError: false,
					timestamp: 2,
					toolCallId: "subagent-1",
					toolName: "subagent",
				},
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /Agent activity Completed 0s/i }));
		expect(screen.getByText("Ran subagent").closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();
		expect(screen.getByText("Inspect auth flow")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Inspect auth flow subagent/i })).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
	});

	it("collapses a single tmux window into its parent session row", async () => {
		installEnvironmentBridge(singleWindowEnvironmentResources);
		agentStore.setState({ activeSessionId: "session-1" });

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await screen.findByText("fix-login-500");
		expect(screen.queryByText("zsh")).toBeNull();
		expect(screen.queryByText("tmux window")).toBeNull();
		expect(screen.getByText("tmux session · project")).toBeTruthy();
	});

	it("updates environment resources from the event stream without interval polling", async () => {
		const setIntervalSpy = vi.spyOn(window, "setInterval");
		const listeners: Array<(event: DesktopEnvironmentEvent) => void> = [];
		const bridge = {
			listEnvironmentResources: vi.fn(async () => []),
			subscribeToEnvironmentEvents: vi.fn((listener: (event: DesktopEnvironmentEvent) => void) => {
				listeners.push(listener);
				return () => undefined;
			}),
		} satisfies Pick<DesktopAgentBridge, "listEnvironmentResources" | "subscribeToEnvironmentEvents">;
		Object.defineProperty(window, "desktopAgent", {
			configurable: true,
			value: bridge,
		});
		agentStore.setState({ activeSessionId: "session-1" });

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await waitFor(() => expect(bridge.subscribeToEnvironmentEvents).toHaveBeenCalledTimes(1));
		expect(screen.queryByLabelText("Environment")).toBeNull();

		act(() => {
			listeners[0]?.({
				type: "environment_resources_updated",
				resources: environmentResources,
				updatedAt: "2026-05-20T08:31:00.000Z",
			});
		});

		expect(await screen.findByText("Test")).toBeTruthy();
		expect(screen.queryByText("fix-login-500")).toBeNull();
		expect(bridge.listEnvironmentResources).toHaveBeenCalledTimes(1);
		expect(setIntervalSpy.mock.calls.some((call) => call[1] === 2_000)).toBe(false);
		setIntervalSpy.mockRestore();
	});

	it("does not show same-repo environment resources from other sessions", async () => {
		const bridge = installEnvironmentBridge([
			{
				...environmentResources[0]!,
				sessionId: "session-other",
			},
		]);
		agentStore.setState({
			activeSessionId: "session-1",
			cwd: "/workspace/project",
			taskProgress: {
				title: "Current task",
				items: [{ id: "current", label: "Run current task", status: "active" }],
				updatedAt: "2026-05-17T00:00:00.000Z",
			},
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(await screen.findByText("Current task")).toBeTruthy();
		await waitFor(() => expect(bridge.listEnvironmentResources).toHaveBeenCalled());
		expect(screen.queryByText("fix-login-500")).toBeNull();
		expect(screen.queryByText("tmux session")).toBeNull();
	});

	it("executes the latest completed proposed plan without replaying plan text", async () => {
		const user = userEvent.setup();
		const exactPlan = "\n1. Inspect the runtime.\n2. Apply the patch.\n";
		const onConsumeProposedPlan = vi.fn(async () => undefined);
		const onExecutePlan = vi.fn(async () => undefined);
		agentStore.setState({
			messages: [
				assistantMessage([{ type: "text", text: `Ready.\n<proposed_plan>${exactPlan}</proposed_plan>` }], 1),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onConsumeProposedPlan={onConsumeProposedPlan}
				onExecutePlan={onExecutePlan}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.click(await screen.findByRole("button", { name: "Execute plan" }));

		await waitFor(() => {
			expect(onConsumeProposedPlan).toHaveBeenCalledWith("assistant-run-0");
			expect(onExecutePlan).toHaveBeenCalledWith();
			expect(screen.queryByRole("button", { name: "Execute plan" })).toBeNull();
		});
	});

	it("keeps proposed plan actions hidden after execution adds a new user turn", async () => {
		const user = userEvent.setup();
		const exactPlan = "\n1. Inspect the runtime.\n2. Apply the patch.\n";
		const onConsumeProposedPlan = vi.fn(async (planMessageId: string) => {
			act(() => {
				agentStore.setState({ consumedProposedPlanMessageIds: [planMessageId] });
			});
		});
		const onExecutePlan = vi.fn(async () => {
			act(() => {
				agentStore.setState((state) => ({
					messages: [...state.messages, userMessage("开始执行上面的计划。", 3)],
					runActivityTiming: undefined,
				}));
			});
		});
		agentStore.setState({
			messages: [
				userMessage("make a plan", 1),
				assistantMessage([{ type: "text", text: `Ready.\n<proposed_plan>${exactPlan}</proposed_plan>` }], 2),
			],
			runActivityTiming: {
				endedAt: Date.parse("2026-05-17T00:00:02.000Z"),
				runId: "runtime-run-id",
				startedAt: Date.parse("2026-05-17T00:00:00.000Z"),
			},
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onConsumeProposedPlan={onConsumeProposedPlan}
				onExecutePlan={onExecutePlan}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.click(await screen.findByRole("button", { name: "Execute plan" }));

		await waitFor(() => {
			expect(onConsumeProposedPlan).toHaveBeenCalledWith("assistant-run-1");
			expect(onExecutePlan).toHaveBeenCalledWith();
			expect(screen.queryByRole("button", { name: "Execute plan" })).toBeNull();
			expect(screen.queryByRole("button", { name: "等一会儿" })).toBeNull();
		});
	});

	it("renders proposed plans as expandable cards with separate one-shot execution actions", async () => {
		const user = userEvent.setup();
		const exactPlan = `\n# Thread plan\n\n## Summary\n\n${Array.from(
			{ length: 14 },
			(_, index) => `- Step ${index + 1}`,
		).join("\n")}\n`;
		const onConsumeProposedPlan = vi.fn(async () => undefined);
		const onExecutePlan = vi.fn(async () => undefined);
		agentStore.setState({
			messages: [
				assistantMessage(
					[{ type: "text", text: `Investigation done.\n<proposed_plan>${exactPlan}</proposed_plan>` }],
					1,
				),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onConsumeProposedPlan={onConsumeProposedPlan}
				onExecutePlan={onExecutePlan}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const card = await screen.findByText("Thread plan");
		const planCard = card.closest("[data-slot='assistant-proposed-plan-card']");
		expect(planCard).not.toBeNull();
		expect(planCard?.textContent).not.toContain("<proposed_plan>");
		expect(planCard?.textContent).not.toContain("Execute plan");

		const expandButton = screen.getByRole("button", { name: "展开计划" });
		expect(expandButton.getAttribute("aria-expanded")).toBe("false");
		await user.click(expandButton);
		expect(screen.getByRole("button", { name: "收起计划" }).getAttribute("aria-expanded")).toBe("true");

		const executeButton = screen.getByRole("button", { name: "Execute plan" });
		expect(executeButton.closest("[data-slot='assistant-proposed-plan-card']")).toBeNull();
		expect(executeButton.closest("[data-slot='assistant-proposed-plan-actions']")).not.toBeNull();

		await user.click(executeButton);
		await waitFor(() => {
			expect(onConsumeProposedPlan).toHaveBeenCalledWith("assistant-run-0");
			expect(onExecutePlan).toHaveBeenCalledWith();
		});
	});

	it("dismisses proposed plan actions without executing", async () => {
		const user = userEvent.setup();
		const onConsumeProposedPlan = vi.fn(async () => undefined);
		const onExecutePlan = vi.fn(async () => undefined);
		agentStore.setState({
			messages: [assistantMessage([{ type: "text", text: "<proposed_plan>wait for now</proposed_plan>" }], 1)],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onConsumeProposedPlan={onConsumeProposedPlan}
				onExecutePlan={onExecutePlan}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.click(await screen.findByRole("button", { name: "等一会儿" }));

		await waitFor(() => {
			expect(onConsumeProposedPlan).toHaveBeenCalledWith("assistant-run-0");
			expect(screen.queryByRole("button", { name: "Execute plan" })).toBeNull();
			expect(screen.queryByRole("button", { name: "等一会儿" })).toBeNull();
		});
		expect(onExecutePlan).not.toHaveBeenCalled();
		expect(screen.getByText("wait for now")).toBeTruthy();
	});

	it("keeps consumed proposed plan actions hidden after hydration", () => {
		agentStore.setState({
			consumedProposedPlanMessageIds: ["assistant-run-0"],
			messages: [assistantMessage([{ type: "text", text: "<proposed_plan>review only</proposed_plan>" }], 1)],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onConsumeProposedPlan={vi.fn(async () => undefined)}
				onExecutePlan={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.getByText("review only")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Execute plan" })).toBeNull();
		expect(screen.queryByRole("button", { name: "等一会儿" })).toBeNull();
	});

	it("shows execute only for the newest completed well-formed plan", () => {
		agentStore.setState({
			messages: [
				assistantMessage([{ type: "text", text: "<proposed_plan>old plan</proposed_plan>" }], 1),
				assistantMessage([{ type: "text", text: "<proposed_plan>new plan</proposed_plan>" }], 2),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onConsumeProposedPlan={vi.fn(async () => undefined)}
				onExecutePlan={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.getAllByRole("button", { name: "Execute plan" })).toHaveLength(1);
	});

	it("does not show execute for streaming or malformed plans", () => {
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage([{ type: "text", text: "<proposed_plan>streaming</proposed_plan>" }], 1),
		});

		const { rerender } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onConsumeProposedPlan={vi.fn(async () => undefined)}
				onExecutePlan={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Execute plan" })).toBeNull();

		agentStore.setState({
			isStreaming: false,
			streamingMessage: undefined,
			messages: [assistantMessage([{ type: "text", text: "<proposed_plan>missing close" }], 1)],
		});
		rerender(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onConsumeProposedPlan={vi.fn(async () => undefined)}
				onExecutePlan={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Execute plan" })).toBeNull();
	});

	it("selects slash command capabilities as chips without inserting invocation text", async () => {
		const user = userEvent.setup();
		const onSubmitPrompt = vi.fn(async () => undefined);

		render(
			<ChatWorkbench
				capabilityCatalog={{
					diagnostics: [],
					mcpServers: [],
					prompts: [],
					skills: [],
					slashCommands: [
						{
							name: "desktop-prompt",
							description: "Expand inside AgentSession",
							source: "prompt",
							sourcePath: "/workspace/project/.pi/prompts/desktop-prompt.md",
						},
						{
							name: "skill:review",
							description: "Review skill",
							source: "skill",
							sourcePath: "/workspace/project/.pi/skills/review/SKILL.md",
						},
					],
				}}
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={onSubmitPrompt}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const input = screen.getByPlaceholderText("Message Skylark") as HTMLTextAreaElement;
		await user.type(input, "/ski");
		expect(await screen.findByText("/skill:review")).toBeTruthy();

		await user.keyboard("{Enter}");
		expect(input.value).toBe("");
		expect(screen.getByText("review")).toBeTruthy();

		await user.type(input, "check auth");
		await user.click(screen.getByLabelText("Send message"));

		await waitFor(() => {
			expect(onSubmitPrompt).toHaveBeenCalledWith({
				text: "check auth",
				capabilityInvocations: [
					{
						type: "skill",
						name: "review",
						description: "Review skill",
						sourcePath: "/workspace/project/.pi/skills/review/SKILL.md",
					},
				],
			});
		});
	});

	it("opens the shared composer suggestion panel when only slash is typed", async () => {
		const user = userEvent.setup();

		render(
			<ChatWorkbench
				capabilityCatalog={{
					diagnostics: [],
					mcpServers: [],
					prompts: [],
					skills: [],
					slashCommands: [
						{
							name: "desktop-prompt",
							description: "Expand inside AgentSession",
							source: "prompt",
							sourcePath: "/workspace/project/.pi/prompts/desktop-prompt.md",
						},
						{
							name: "skill:review",
							description: "Review skill",
							source: "skill",
							sourcePath: "/workspace/project/.pi/skills/review/SKILL.md",
						},
					],
				}}
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.type(screen.getByLabelText("Message Skylark"), "/");

		const panel = await screen.findByRole("listbox", { name: "Composer suggestions" });

		expect(panel).toBeTruthy();
		expect(panel.className).toContain("shadow-[var(--uix-flat-shadow-floating)]");
		expect(screen.getByText("Skills")).toBeTruthy();
		expect(screen.getByText("Prompt templates")).toBeTruthy();
		expect(screen.getByText("/desktop-prompt")).toBeTruthy();
		expect(screen.getByText("/skill:review")).toBeTruthy();
	});

	it("renders all slash skills and prompt templates in the scrollable panel", async () => {
		const user = userEvent.setup();

		render(
			<ChatWorkbench
				capabilityCatalog={{
					diagnostics: [],
					mcpServers: [],
					prompts: [],
					skills: [],
					slashCommands: [
						{ name: "compact", description: "Compact context", source: "builtin" },
						...Array.from({ length: 5 }, (_, index) => ({
							name: `skill:review-${index + 1}`,
							description: `Review skill ${index + 1}`,
							source: "skill" as const,
							sourcePath: `/workspace/project/.pi/skills/review-${index + 1}/SKILL.md`,
						})),
						...Array.from({ length: 5 }, (_, index) => ({
							name: `template-${index + 1}`,
							description: `Prompt template ${index + 1}`,
							source: "prompt" as const,
							sourcePath: `/workspace/project/.pi/prompts/template-${index + 1}.md`,
						})),
					],
				}}
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.type(screen.getByLabelText("Message Skylark"), "/");

		expect(await screen.findByRole("listbox", { name: "Composer suggestions" })).toBeTruthy();
		expect(screen.getByText("/skill:review-5")).toBeTruthy();
		expect(screen.getByText("/template-5")).toBeTruthy();
	});

	it("keeps the selected slash command scrolled into view during keyboard navigation", async () => {
		const user = userEvent.setup();
		const scrollIntoView = vi.fn();
		const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
		HTMLElement.prototype.scrollIntoView = scrollIntoView;

		try {
			render(
				<ChatWorkbench
					capabilityCatalog={{
						diagnostics: [],
						mcpServers: [],
						prompts: [],
						skills: [],
						slashCommands: Array.from({ length: 8 }, (_, index) => promptSlashCommand(index + 1)),
					}}
					onAbort={vi.fn(async () => undefined)}
					onSubmitPrompt={vi.fn(async () => undefined)}
					runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
					showThinkingBlocks={false}
				/>,
			);

			await user.type(screen.getByLabelText("Message Skylark"), "/");
			expect(await screen.findByRole("listbox", { name: "Composer suggestions" })).toBeTruthy();
			scrollIntoView.mockClear();

			await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");

			const selectedCommand = screen.getByText("/cmd-6").closest("button");
			expect(selectedCommand?.getAttribute("data-selected")).toBe("true");
			expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
		} finally {
			HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
		}
	});

	it("opens the shared composer suggestion panel with workspace files when at is typed", async () => {
		const user = userEvent.setup();
		const bridge = installWorkspaceFileBridge(workspaceFiles);

		render(
			<ChatWorkbench
				activeProjectId="project-1"
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.type(screen.getByLabelText("Message Skylark"), "@");

		expect(await screen.findByRole("listbox", { name: "Composer suggestions" })).toBeTruthy();
		expect(await screen.findByText("App.tsx")).toBeTruthy();
		expect(screen.getByText("docs/my file.md")).toBeTruthy();
		expect(bridge.listWorkspaceFiles).toHaveBeenCalledWith({
			projectId: "project-1",
			sessionId: "session-1",
			limit: 1000,
		});
	});

	it("filters workspace file suggestions by the current at token", async () => {
		const user = userEvent.setup();
		installWorkspaceFileBridge(workspaceFiles);

		render(
			<ChatWorkbench
				activeProjectId="project-1"
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.type(screen.getByLabelText("Message Skylark"), "@read");

		expect((await screen.findAllByText("README.md")).length).toBeGreaterThan(0);
		expect(screen.queryByText("App.tsx")).toBeNull();
	});

	it("previews a workspace file when its suggestion row is clicked", async () => {
		const user = userEvent.setup();
		const onOpenWorkspacePreviewFile = vi.fn();
		installWorkspaceFileBridge(workspaceFiles);

		render(
			<ChatWorkbench
				activeProjectId="project-1"
				onAbort={vi.fn(async () => undefined)}
				onOpenWorkspacePreviewFile={onOpenWorkspacePreviewFile}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const input = screen.getByLabelText("Message Skylark") as HTMLTextAreaElement;
		await user.type(input, "@");
		await user.click(await screen.findByText("App.tsx"));

		expect(onOpenWorkspacePreviewFile).toHaveBeenCalledWith("src/App.tsx");
		expect(input.value).toBe("@");
	});

	it("inserts the selected workspace file reference on Enter", async () => {
		const user = userEvent.setup();
		installWorkspaceFileBridge(workspaceFiles);

		render(
			<ChatWorkbench
				activeProjectId="project-1"
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const input = screen.getByLabelText("Message Skylark") as HTMLTextAreaElement;
		await user.type(input, "@app");
		expect(await screen.findByText("App.tsx")).toBeTruthy();
		await user.keyboard("{Enter}");

		expect(input.value).toBe("@src/App.tsx");
		expect(screen.queryByRole("listbox", { name: "Composer suggestions" })).toBeNull();
	});

	it("quotes inserted workspace file references when the path has spaces", async () => {
		const user = userEvent.setup();
		installWorkspaceFileBridge(workspaceFiles);

		render(
			<ChatWorkbench
				activeProjectId="project-1"
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const input = screen.getByLabelText("Message Skylark") as HTMLTextAreaElement;
		await user.type(input, "@my");
		expect(await screen.findByText("my file.md")).toBeTruthy();
		await user.keyboard("{Enter}");

		expect(input.value).toBe('@"docs/my file.md"');
	});

	it("closes the workspace file suggestion panel on Escape without changing text", async () => {
		const user = userEvent.setup();
		installWorkspaceFileBridge(workspaceFiles);

		render(
			<ChatWorkbench
				activeProjectId="project-1"
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const input = screen.getByLabelText("Message Skylark") as HTMLTextAreaElement;
		await user.type(input, "@");
		expect(await screen.findByRole("listbox", { name: "Composer suggestions" })).toBeTruthy();
		await user.keyboard("{Escape}");

		expect(input.value).toBe("@");
		expect(screen.queryByRole("listbox", { name: "Composer suggestions" })).toBeNull();
	});

	it("does not open workspace file suggestions for email-like at characters", async () => {
		const user = userEvent.setup();
		const bridge = installWorkspaceFileBridge(workspaceFiles);

		render(
			<ChatWorkbench
				activeProjectId="project-1"
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.type(screen.getByLabelText("Message Skylark"), "me@example.com package@1.0.0");

		expect(screen.queryByRole("listbox", { name: "Composer suggestions" })).toBeNull();
		expect(bridge.listWorkspaceFiles).not.toHaveBeenCalled();
	});

	it("renders sent capability chips without exposing expanded prompt or skill content", () => {
		agentStore.setState({
			messages: [
				userMessage("check auth", 1, [
					{
						type: "prompt_template",
						name: "desktop-prompt",
						description: "Expand inside AgentSession",
						sourcePath: "/workspace/project/.pi/prompts/desktop-prompt.md",
					},
					{
						type: "skill",
						name: "review",
						description: "Review skill",
						sourcePath: "/workspace/project/.pi/skills/review/SKILL.md",
					},
				]),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.getByText("desktop-prompt")).toBeTruthy();
		expect(screen.getByText("review")).toBeTruthy();
		expect(screen.getByText("check auth")).toBeTruthy();
		expect(screen.queryByText(/Expand inside AgentSession/)).toBeNull();
	});

	it("renders sent prompt attachments as compact file cards without exposing prompt text", () => {
		agentStore.setState({
			messages: [
				{
					role: "user",
					content: 'Summarize this\n\n<file name="notes.md">hidden attachment context</file>',
					timestamp: 1,
					metadata: {
						custom: {
							desktopPromptVisibleText: "Summarize this",
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
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const attachmentCard = screen.getByLabelText("notes.md");
		const mediaStack = attachmentCard.closest("[data-slot='user-message-media-stack']");
		const promptBubble = screen.getByText("Summarize this").closest("[data-slot='user-message-bubble']");
		expect(screen.getByText("notes.md")).toBeTruthy();
		expect(screen.getByText("Markdown / 42 B")).toBeTruthy();
		expect(screen.getByText("Summarize this")).toBeTruthy();
		expect(screen.queryByText(/hidden attachment context/)).toBeNull();
		expect(attachmentCard.className).toContain("min-h-9");
		expect(attachmentCard.closest("[data-slot='user-message-bubble']")).toBeNull();
		expect(mediaStack?.className).toContain("self-end");
		expect(promptBubble).toBeTruthy();
		expect(
			attachmentCard.compareDocumentPosition(promptBubble!) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("renders fallback prompt attachment cards before prompt metadata hydrates", () => {
		agentStore.setState({
			messages: [
				{
					role: "user",
					content:
						'Summarize this\n\n<file name="/workspace/project/budget.xlsx">\nhidden spreadsheet context\n</file>',
					timestamp: 1,
				} as Extract<AgentMessage, { role: "user" }>,
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.getByLabelText("budget.xlsx")).toBeTruthy();
		expect(screen.getByText("Spreadsheet")).toBeTruthy();
		expect(screen.getByText("Summarize this")).toBeTruthy();
		expect(screen.queryByText(/hidden spreadsheet context/)).toBeNull();
	});

	it("renders common user file attachments as native thread cards by file type", () => {
		agentStore.setState({
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "Review these files" }],
					timestamp: 1,
					metadata: {
						custom: {
							desktopPromptVisibleText: "Review these files",
							desktopPromptAttachments: [
								{
									id: "attachment-xlsx",
									kind: "text",
									name: "budget.xlsx",
									mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
									size: 2048,
								},
								{
									id: "attachment-docx",
									kind: "text",
									name: "brief.docx",
									mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
									size: 4096,
								},
								{
									id: "attachment-md",
									kind: "text",
									name: "notes.md",
									mimeType: "text/markdown",
									size: 512,
								},
							],
						},
					},
				} as Extract<AgentMessage, { role: "user" }>,
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const xlsxCard = screen.getByLabelText("budget.xlsx");
		const docxCard = screen.getByLabelText("brief.docx");
		const markdownCard = screen.getByLabelText("notes.md");
		const promptBubble = screen.getByText("Review these files").closest("[data-slot='user-message-bubble']");

		expect(screen.getByText("Spreadsheet / 2 KB")).toBeTruthy();
		expect(screen.getByText("Word document / 4 KB")).toBeTruthy();
		expect(screen.getByText("Markdown / 512 B")).toBeTruthy();
		expect(xlsxCard.closest("[data-slot='user-message-bubble']")).toBeNull();
		expect(docxCard.closest("[data-slot='user-message-bubble']")).toBeNull();
		expect(markdownCard.closest("[data-slot='user-message-bubble']")).toBeNull();
		expect(promptBubble).toBeTruthy();
		expect(
			xlsxCard.compareDocumentPosition(promptBubble!) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("renders user bubbles with minimal markdown without using a strong brand fill", () => {
		agentStore.setState({
			messages: [userMessage("Open [docs](https://example.com) and inspect `src/index.ts`.", 1)],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const link = screen.getByRole("link", { name: "docs" });
		const bubble = link.closest("[data-slot='user-message-bubble']");

		expect(link.getAttribute("href")).toBe("https://example.com");
		expect(screen.getByText("src/index.ts").tagName.toLowerCase()).toBe("code");
		expect(bubble?.className).toContain("max-w-[82%]");
		expect(bubble?.className).toContain("bg-[color:var(--surface-2)]");
	});

	it("routes local markdown file links to workspace preview while leaving external links alone", async () => {
		const user = userEvent.setup();
		const onOpenWorkspacePreviewFile = vi.fn();
		const openExternalUrl = vi.fn(async () => undefined);
		Object.defineProperty(window, "desktopAgent", {
			configurable: true,
			value: {
				openExternalUrl,
			},
		});
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{
							type: "text",
							text: "Open [App](/workspace/project/src/App.tsx:12) and [docs](https://example.com).",
						},
					],
					1,
				),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onOpenWorkspacePreviewFile={onOpenWorkspacePreviewFile}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.click(screen.getByRole("link", { name: "App" }));
		expect(onOpenWorkspacePreviewFile).toHaveBeenCalledWith("/workspace/project/src/App.tsx:12");

		const externalLink = screen.getByRole("link", { name: "docs" });
		expect(externalLink.getAttribute("target")).toBe("_blank");
		await user.click(externalLink);
		expect(onOpenWorkspacePreviewFile).toHaveBeenCalledTimes(1);
		expect(openExternalUrl).toHaveBeenCalledWith("https://example.com");
	});

	it("renders assistant markdown local images through the workspace preview bridge", async () => {
		const user = userEvent.setup();
		const openWorkspacePreviewFile = vi.fn(async (request: { path: string; sessionId?: string }) => ({
			path: `/workspace/project/${request.path.replace(/^file:\/\/\/workspace\/project\//, "")}`,
			name: request.path.includes("diagram") ? "diagram.png" : "panel.png",
			mimeType: "image/png",
			size: 42,
			kind: "image" as const,
			updatedAt: "2026-06-05T00:00:00.000Z",
			dataUrl: request.path.includes("diagram")
				? "data:image/png;base64,ZGlhZ3JhbQ=="
				: "data:image/png;base64,cGFuZWw=",
		}));
		Object.defineProperty(window, "desktopAgent", {
			configurable: true,
			value: { openWorkspacePreviewFile },
		});
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{
							type: "text",
							text: "下面是根目录这几张图：\n\n![panel](panel.png)\n\n![diagram](file:///workspace/project/diagram.png)",
						},
					],
					1,
				),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByAltText("panel")).toBeTruthy();
			expect(screen.getByAltText("diagram")).toBeTruthy();
		});
		expect(openWorkspacePreviewFile).toHaveBeenCalledWith({ path: "panel.png", sessionId: "session-1" });
		expect(openWorkspacePreviewFile).toHaveBeenCalledWith({
			path: "file:///workspace/project/diagram.png",
			sessionId: "session-1",
		});
		expect(openWorkspacePreviewFile).toHaveBeenCalledTimes(2);
		expect(document.querySelectorAll("[data-slot='thread-image-preview-grid']")).toHaveLength(1);
		expect(screen.queryByText("Image not available")).toBeNull();

		await user.click(screen.getByRole("button", { name: "Open image preview for panel" }));
		expect(screen.getByRole("dialog", { name: "Image preview" }).querySelector("img")?.getAttribute("src")).toBe(
			"data:image/png;base64,cGFuZWw=",
		);
	});

	it("shows a lightweight placeholder for markdown images outside the workspace", async () => {
		const openWorkspacePreviewFile = vi.fn(async () => ({
			path: "/Users/qiaochao/.ssh/secret.png",
			name: "secret.png",
			mimeType: "application/octet-stream",
			size: 0,
			kind: "unsupported" as const,
			updatedAt: "1970-01-01T00:00:00.000Z",
			errorMessage: "只能预览当前 workspace 内的文件。",
		}));
		Object.defineProperty(window, "desktopAgent", {
			configurable: true,
			value: { openWorkspacePreviewFile },
		});
		agentStore.setState({
			messages: [assistantMessage([{ type: "text", text: "![secret](/Users/qiaochao/.ssh/secret.png)" }], 1)],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByText("Image not available")).toBeTruthy();
		});
		expect(screen.queryByAltText("secret")).toBeNull();
		expect(screen.queryByRole("button", { name: "Open image preview for secret" })).toBeNull();
		expect(screen.queryByText("/Users/qiaochao/.ssh/secret.png")).toBeNull();
	});

	it("renders completed tool file references and opens them in workspace preview", async () => {
		const user = userEvent.setup();
		const onOpenWorkspacePreviewFile = vi.fn();
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{ type: "toolCall", id: "call-edit", name: "edit", arguments: { path: "src/App.tsx" } },
						{ type: "text", text: "Implemented." },
					],
					1,
				),
			],
			toolCalls: [
				{
					args: { path: "src/App.tsx" },
					completedAt: 3,
					result: { content: [{ type: "text", text: "Updated src/App.tsx" }] },
					startedAt: 2,
					status: "completed",
					toolCallId: "call-edit",
					toolName: "edit",
					updatedAt: 3,
				},
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onOpenWorkspacePreviewFile={onOpenWorkspacePreviewFile}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.getByText("Changed")).toBeTruthy();
		const fileButton = screen.getByRole("button", { name: "Open src/App.tsx in workspace preview" });

		await user.click(fileButton);

		expect(onOpenWorkspacePreviewFile).toHaveBeenCalledWith("src/App.tsx");
	});

	it("renders user image parts as native thread images above the prompt", () => {
		agentStore.setState({
			messages: [
				{
					...userMessage("Inspect this screenshot", 1),
					content: [
						{ type: "text", text: "Inspect this screenshot" },
						{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
					],
				},
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const image = screen.getByAltText("Attached visual");
		const nativeImage = image.closest("[data-slot='user-thread-image']");
		const promptBubble = screen.getByText("Inspect this screenshot").closest("[data-slot='user-message-bubble']");

		expect(nativeImage).toBeTruthy();
		expect(nativeImage?.closest("[data-slot='user-message-bubble']")).toBeNull();
		expect(nativeImage?.className).not.toContain("bg-muted");
		expect(image.className).toContain("object-contain");
		expect(image.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
		expect(promptBubble).toBeTruthy();
		expect(image.compareDocumentPosition(promptBubble!) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it("opens a native preview when clicking a user thread image", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			messages: [
				{
					...userMessage("Inspect this screenshot", 1),
					content: [
						{ type: "text", text: "Inspect this screenshot" },
						{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
					],
				},
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Open image preview for Attached visual" }));

		const dialog = screen.getByRole("dialog", { name: "Image preview" });
		expect(dialog).toBeTruthy();
		expect(dialog.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("dialog", { name: "Image preview" })).toBeNull();
	});

	it("hides sent image attachment chips when rendering the image natively", () => {
		agentStore.setState({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: 'Inspect this\n\n<file name="panel.png"></file>' },
						{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
					],
					timestamp: 1,
					metadata: {
						custom: {
							desktopPromptVisibleText: "Inspect this",
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
					},
				} as Extract<AgentMessage, { role: "user" }>,
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.getByText("Inspect this")).toBeTruthy();
		expect(screen.queryByText(/<file name=/)).toBeNull();
		expect(screen.getByAltText("panel.png").getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
		expect(screen.queryByLabelText("panel.png")).toBeNull();
	});

	it("recovers composer input when an IME composition is interrupted by input source switching", async () => {
		const user = userEvent.setup();
		const onSubmitPrompt = vi.fn(async () => undefined);

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={onSubmitPrompt}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const input = screen.getByPlaceholderText("Message Skylark") as HTMLTextAreaElement;
		fireEvent.compositionStart(input);
		fireEvent.input(input, {
			data: "pin",
			inputType: "insertCompositionText",
			isComposing: true,
			target: { value: "pin" },
		});
		expect((screen.getByLabelText("Send message") as HTMLButtonElement).disabled).toBe(true);

		fireEvent.input(input, {
			data: ",",
			inputType: "insertText",
			isComposing: false,
			target: { value: "pin," },
		});

		expect(input.value).toBe("pin,");
		await user.click(screen.getByLabelText("Send message"));

		await waitFor(() => {
			expect(onSubmitPrompt).toHaveBeenCalledWith({ text: "pin," });
		});
	});

	it("hides the current thread and disables composer during session hydration", () => {
		agentStore.setState({
			activeSessionId: "session-1",
			messages: [assistantMessage([{ type: "text", text: "Current thread should be hidden." }])],
			pendingActiveSessionId: "session-2",
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.queryByText("Current thread should be hidden.")).toBeNull();
		expect(container.querySelector("[data-slot='assistant-session-switch-state']")).toBeTruthy();
		expect(container.querySelector("[data-slot='assistant-hydration-skeleton']")).toBeNull();
		expect((screen.getByPlaceholderText("Message Skylark") as HTMLTextAreaElement).disabled).toBe(true);
		expect((screen.getByLabelText("Send message") as HTMLButtonElement).disabled).toBe(true);
	});

	it("hides the disabled scroll-to-bottom affordance at the bottom of the thread", () => {
		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const scrollToBottom = screen.getByLabelText("Scroll to bottom") as HTMLButtonElement;
		const scrollAnchor = scrollToBottom.closest("[data-slot='assistant-scroll-to-bottom-anchor']");

		expect(scrollToBottom.disabled).toBe(true);
		expect(scrollToBottom.className).toContain("disabled:hidden");
		expect(scrollAnchor?.className).toContain("h-8");
	});

	it("keeps active assistant streaming pinned with a scheduled instant viewport scroll", async () => {
		vi.useFakeTimers();
		const requestAnimationFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			});
		const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
		try {
			agentStore.setState({
				activeSessionId: "session-1",
				isStreaming: true,
				messages: [userMessage("Explain the plan", 1)],
				streamingMessage: assistantMessage([{ type: "text", text: "First chunk" }], 2),
			});

			const { container } = render(
				<ChatWorkbench
					onAbort={vi.fn(async () => undefined)}
					onSubmitPrompt={vi.fn(async () => undefined)}
					runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
					showThinkingBlocks={false}
				/>,
			);
			const viewport = getAssistantViewport(container);
			const scrollTo = vi.fn();
			Object.defineProperty(viewport, "scrollTo", {
				configurable: true,
				value: scrollTo,
			});
			setAssistantViewportMetrics(viewport, { clientHeight: 100, scrollHeight: 1000, scrollTop: 900 });
			scrollTo.mockClear();

			await act(async () => {
				agentStore.setState({
					streamingMessage: assistantMessage(
						[{ type: "text", text: "First chunk with a second streamed word" }],
						3,
					),
				});
			});
			await act(async () => {
				vi.advanceTimersByTime(160);
			});

			expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1000 });
		} finally {
			cancelAnimationFrame.mockRestore();
			requestAnimationFrame.mockRestore();
		}
	});

	it("cancels pending streaming auto-scroll as soon as the user wheels upward", async () => {
		vi.useFakeTimers();
		const frameCallbacks = new Map<number, FrameRequestCallback>();
		let nextFrameId = 1;
		const requestAnimationFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				const frameId = nextFrameId;
				nextFrameId += 1;
				frameCallbacks.set(frameId, callback);
				return frameId;
			});
		const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId: number) => {
			frameCallbacks.delete(frameId);
		});
		try {
			agentStore.setState({
				activeSessionId: "session-1",
				isStreaming: true,
				messages: [userMessage("Explain the plan", 1)],
				streamingMessage: assistantMessage([{ type: "text", text: "First chunk" }], 2),
			});

			const { container } = render(
				<ChatWorkbench
					onAbort={vi.fn(async () => undefined)}
					onSubmitPrompt={vi.fn(async () => undefined)}
					runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
					showThinkingBlocks={false}
				/>,
			);
			const viewport = getAssistantViewport(container);
			const scrollTo = vi.fn();
			Object.defineProperty(viewport, "scrollTo", {
				configurable: true,
				value: scrollTo,
			});
			setAssistantViewportMetrics(viewport, { clientHeight: 100, scrollHeight: 1000, scrollTop: 900 });
			frameCallbacks.clear();
			scrollTo.mockClear();

			await act(async () => {
				agentStore.setState({
					streamingMessage: assistantMessage(
						[{ type: "text", text: "First chunk with a second streamed word" }],
						3,
					),
				});
			});
			await act(async () => {
				vi.advanceTimersByTime(160);
			});
			expect(frameCallbacks.size).toBeGreaterThan(0);

			fireEvent.wheel(viewport, { deltaY: -40 });
			for (const callback of frameCallbacks.values()) {
				callback(0);
			}

			expect(scrollTo).not.toHaveBeenCalled();
			expect(viewport.scrollTop).toBe(900);
		} finally {
			cancelAnimationFrame.mockRestore();
			requestAnimationFrame.mockRestore();
		}
	});

	it("does not force active assistant streaming back to bottom after the user scrolls away", async () => {
		vi.useFakeTimers();
		const requestAnimationFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			});
		const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
		try {
			agentStore.setState({
				activeSessionId: "session-1",
				isStreaming: true,
				messages: [userMessage("Explain the plan", 1)],
				streamingMessage: assistantMessage([{ type: "text", text: "First chunk" }], 2),
			});

			const { container } = render(
				<ChatWorkbench
					onAbort={vi.fn(async () => undefined)}
					onSubmitPrompt={vi.fn(async () => undefined)}
					runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
					showThinkingBlocks={false}
				/>,
			);
			const viewport = getAssistantViewport(container);
			const scrollTo = vi.fn();
			Object.defineProperty(viewport, "scrollTo", {
				configurable: true,
				value: scrollTo,
			});
			setAssistantViewportMetrics(viewport, { clientHeight: 100, scrollHeight: 1000, scrollTop: 900 });

			await act(async () => {
				viewport.scrollTop = 200;
				fireEvent.scroll(viewport);
			});
			scrollTo.mockClear();

			await act(async () => {
				agentStore.setState({
					streamingMessage: assistantMessage(
						[{ type: "text", text: "First chunk with a second streamed word" }],
						3,
					),
				});
			});
			await act(async () => {
				vi.advanceTimersByTime(160);
			});

			expect(scrollTo).not.toHaveBeenCalled();
			expect(viewport.scrollTop).toBe(200);
		} finally {
			cancelAnimationFrame.mockRestore();
			requestAnimationFrame.mockRestore();
		}
	});

	it("does not force streaming back to bottom after a small upward user scroll inside the bottom threshold", async () => {
		vi.useFakeTimers();
		const requestAnimationFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			});
		const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
		try {
			agentStore.setState({
				activeSessionId: "session-1",
				isStreaming: true,
				messages: [userMessage("Explain the plan", 1)],
				streamingMessage: assistantMessage([{ type: "text", text: "First chunk" }], 2),
			});

			const { container } = render(
				<ChatWorkbench
					onAbort={vi.fn(async () => undefined)}
					onSubmitPrompt={vi.fn(async () => undefined)}
					runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
					showThinkingBlocks={false}
				/>,
			);
			const viewport = getAssistantViewport(container);
			const scrollTo = vi.fn();
			Object.defineProperty(viewport, "scrollTo", {
				configurable: true,
				value: scrollTo,
			});
			setAssistantViewportMetrics(viewport, { clientHeight: 100, scrollHeight: 1000, scrollTop: 900 });
			fireEvent.scroll(viewport);

			await act(async () => {
				viewport.scrollTop = 850;
				fireEvent.scroll(viewport);
			});
			scrollTo.mockClear();

			await act(async () => {
				agentStore.setState({
					streamingMessage: assistantMessage(
						[{ type: "text", text: "First chunk with a second streamed word" }],
						3,
					),
				});
			});
			await act(async () => {
				vi.advanceTimersByTime(160);
			});

			expect(scrollTo).not.toHaveBeenCalled();
			expect(viewport.scrollTop).toBe(850);
		} finally {
			cancelAnimationFrame.mockRestore();
			requestAnimationFrame.mockRestore();
		}
	});

	it("does not let content resize pull streaming back to the bottom after the user scrolls away", async () => {
		vi.useFakeTimers();
		const threadContentResizeCallbacks: ResizeObserverCallback[] = [];
		const originalResizeObserver = globalThis.ResizeObserver;
		class MockResizeObserver implements ResizeObserver {
			constructor(private readonly callback: ResizeObserverCallback) {}

			disconnect(): void {}

			observe(element: Element): void {
				if (element.parentElement?.getAttribute("data-slot") === "assistant-thread-viewport") {
					threadContentResizeCallbacks.push(this.callback);
				}
			}

			unobserve(): void {}
		}
		Object.defineProperty(globalThis, "ResizeObserver", {
			configurable: true,
			value: MockResizeObserver,
		});
		const requestAnimationFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			});
		const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
		try {
			agentStore.setState({
				activeSessionId: "session-1",
				isStreaming: true,
				messages: [userMessage("Explain the plan", 1)],
				streamingMessage: assistantMessage([{ type: "text", text: "First chunk" }], 2),
			});

			const { container } = render(
				<ChatWorkbench
					onAbort={vi.fn(async () => undefined)}
					onSubmitPrompt={vi.fn(async () => undefined)}
					runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
					showThinkingBlocks={false}
				/>,
			);
			const viewport = getAssistantViewport(container);
			setAssistantViewportMetrics(viewport, { clientHeight: 100, scrollHeight: 1000, scrollTop: 900 });

			await act(async () => {
				viewport.scrollTop = 200;
				fireEvent.scroll(viewport);
			});

			const threadContent = viewport.firstElementChild;
			if (!threadContent) {
				throw new Error("Assistant thread content was not rendered.");
			}
			for (const callback of threadContentResizeCallbacks) {
				callback([createResizeObserverEntry(threadContent, 1200)], {} as ResizeObserver);
			}
			await act(async () => {
				vi.advanceTimersByTime(16);
			});

			expect(viewport.scrollTop).toBe(200);
		} finally {
			cancelAnimationFrame.mockRestore();
			requestAnimationFrame.mockRestore();
			Object.defineProperty(globalThis, "ResizeObserver", {
				configurable: true,
				value: originalResizeObserver,
			});
		}
	});

	it("keeps the composer dock inside the shell aligned to the workbench reading width", () => {
		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const shell = container.querySelector("[data-slot='assistant-chat-shell']");
		const dock = shell?.querySelector("[data-slot='composer-dock']");
		const dockFrame = dock?.firstElementChild;

		expect(shell).toBeTruthy();
		expect(dock?.className).toContain("absolute");
		expect(dock?.className).toContain("bottom-0");
		expect(dockFrame?.className).toContain("max-w-[880px]");
	});

	it("renders the active composer as an agent console inside the dock", () => {
		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const dock = container.querySelector("[data-slot='composer-dock']");
		const consoleRoot = dock?.querySelector("[data-slot='agent-console']");
		const inputSurface = consoleRoot?.querySelector("[data-slot='agent-console-input-surface']");
		const toolbar = consoleRoot?.querySelector("[data-slot='agent-console-toolbar']");

		expect(consoleRoot).toBeTruthy();
		expect(consoleRoot?.getAttribute("data-state")).toBe("idle");
		expect(consoleRoot?.className).toContain("shadow-[var(--shadow-middle)]");
		expect(consoleRoot?.className).toContain("overflow-visible");
		expect(consoleRoot?.className).not.toContain("overflow-hidden");
		expect(inputSurface).toBeTruthy();
		expect(inputSurface?.className).toContain("focus-within:shadow-[var(--control-focus-shadow)]");
		expect(inputSurface?.className).toContain("overflow-visible");
		expect(inputSurface?.className).not.toContain("overflow-hidden");
		expect(toolbar).toBeTruthy();
		expect(toolbar?.querySelector("[data-slot='composer-status-icon']")).toBeTruthy();
		const sendButton = toolbar?.querySelector("[aria-label='Send message']");
		expect(sendButton).toBeTruthy();
		expect(sendButton?.getAttribute("data-slot")).toBe("agent-console-send-button");
		expect(sendButton?.getAttribute("data-size")).toBe("icon-sm");
		expect(dock?.querySelector("[aria-label='Attach files']")).toBeTruthy();
	});

	it("focuses the input when the agent console surface is clicked", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const input = screen.getByPlaceholderText("Message Skylark") as HTMLTextAreaElement;
		const consoleRoot = container.querySelector("[data-slot='agent-console']");

		expect(consoleRoot).toBeTruthy();
		expect(document.activeElement).not.toBe(input);

		await user.click(consoleRoot as Element);

		expect(document.activeElement).toBe(input);
	});

	it("keeps long composer input bounded with internal scrolling", async () => {
		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const input = screen.getByPlaceholderText("Message Skylark") as HTMLTextAreaElement;
		Object.defineProperty(input, "scrollHeight", {
			configurable: true,
			value: 360,
		});

		fireEvent.change(input, {
			target: { value: Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n") },
		});

		await waitFor(() => {
			expect(input.style.height).toBe("224px");
		});
		expect(input.style.overflowY).toBe("auto");
		expect(input.getAttribute("data-overflow")).toBe("true");
	});

	it("shows a compact stop control when the agent console is running", () => {
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage([{ type: "text", text: "working" }], 10),
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const consoleRoot = container.querySelector("[data-slot='agent-console']");
		const stopButton = screen.getByLabelText("Cancel response");

		expect(consoleRoot?.getAttribute("data-state")).toBe("running");
		expect(consoleRoot?.className).toContain("var(--info)");
		expect(stopButton.getAttribute("data-slot")).toBe("agent-console-stop-button");
		expect(stopButton.className).toContain("rounded-[var(--radius-md)]");
		expect(screen.queryByLabelText("Send message")).toBeNull();
	});

	it("routes cancel through the desktop abort handler", async () => {
		const onAbort = vi.fn(async () => undefined);
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage([{ type: "text", text: "working" }], 10),
		});

		render(
			<ChatWorkbench
				onAbort={onAbort}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		fireEvent.click(screen.getByLabelText("Cancel response"));

		await waitFor(() => {
			expect(onAbort).toHaveBeenCalled();
		});
	});

	it("renders grouped markdown, code blocks, reasoning, and structured tool fallbacks", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{
							type: "text",
							text: '| File | Status |\n| --- | --- |\n| README.md | read |\n\n```ts\nconst status = "ok";\n```',
						},
						{ type: "thinking", thinking: "**Check the file before summarizing**\n\nRead before summarizing." },
						{ type: "thinking", thinking: "**Standalone reasoning heading**" },
						{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
					],
					1,
					{ stopReason: "toolUse" },
				),
				toolResultMessage("call-1"),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		expect(await screen.findByText("File")).toBeTruthy();
		expect(screen.getByText("Status")).toBeTruthy();
		expect(screen.getByText("ts")).toBeTruthy();
		const copyCodeButton = screen.getByTitle("Copy Code");
		expect(copyCodeButton).toBeTruthy();
		const codeBlockFrame = copyCodeButton.closest("[data-streamdown='code-block']");
		expect(codeBlockFrame).not.toBeNull();
		expect(codeBlockFrame?.getAttribute("data-language")).toBe("ts");
		expect(codeBlockFrame?.getAttribute("style")).toContain("content-visibility: auto");
		expect(codeBlockFrame?.querySelector("[data-streamdown='code-block-actions']")).not.toBeNull();
		expect(codeBlockFrame?.querySelector("[data-streamdown='code-block-body']")).not.toBeNull();
		const css = readFileSync("src/renderer/styles/globals.css", "utf8");
		expect(css).toContain('[data-streamdown="code-block"] > [data-streamdown="code-block-body"]');
		expect(css).toContain("border-width: 0");
		const activityTrigger = screen.getByRole("button", { name: /Agent activity Completed 0s/i });
		expect(activityTrigger).toBeTruthy();
		expect(activityTrigger.getAttribute("data-slot")).toBe("assistant-run-activity-trigger");
		expect(activityTrigger.getAttribute("aria-expanded")).toBe("false");
		const activityRoot = activityTrigger.closest("[data-slot='assistant-run-activity']");
		expect(activityRoot?.querySelector("[data-slot='assistant-run-activity-task']")).not.toBeNull();
		expect(activityRoot?.querySelector("[data-slot='assistant-run-activity-chain-of-thought']")).not.toBeNull();
		expect(screen.getByText("Agent activity")).toBeTruthy();
		expect(screen.getByText(/Completed 0s/)).toBeTruthy();
		expect(screen.getByText("1 tool")).toBeTruthy();
		expect(screen.queryByText("Reasoning")).toBeNull();
		expect(screen.queryByText("Tool calls")).toBeNull();
		expect(screen.queryByText("Working")).toBeNull();
		expect(screen.queryByText("README.md contents")).toBeNull();
		expect(screen.queryByText("Check the file before summarizing.")).toBeNull();
		expect(screen.queryByText("Read before summarizing.")).toBeNull();
		expect(screen.queryByText("Standalone reasoning heading")).toBeNull();

		await user.click(activityTrigger);
		const reasoningText = screen.getByText("Read before summarizing.");
		expect(screen.queryByText("Check the file before summarizing")).toBeNull();
		expect(screen.queryByText("Standalone reasoning heading")).toBeNull();
		const activityContent = reasoningText.closest("[data-slot='assistant-run-activity-content']");
		expect(activityContent?.className).not.toContain("border-l");
		const activityDrawer = activityContent?.closest("[data-slot='assistant-run-activity-content-spacer']");
		expect(activityDrawer?.getAttribute("data-motion")).toBe("structural-drawer");
		expect(activityDrawer?.getAttribute("data-motion-mode")).toBe("drawer");
		expect(activityDrawer?.getAttribute("data-motion-origin")).toBe("top");
		expect(activityDrawer?.getAttribute("data-structural-layout-driver")).toBe("height");
		expect(activityDrawer?.getAttribute("data-state")).toBe("open");
		expect(activityDrawerTransition.duration).toBeGreaterThanOrEqual(0.3);
		expect(activityDrawerTransition.duration).toBeLessThanOrEqual(0.5);
		const reasoningStep = reasoningText.closest("[data-slot='assistant-reasoning-part']");
		expect(reasoningStep?.textContent).toContain("Read before summarizing.");
		expect(reasoningStep?.textContent).not.toContain("Check the file before summarizing");
		expect(reasoningStep?.textContent).not.toContain("**");
		expect(reasoningStep?.className).toContain("animate-in");
		expect(screen.getByText("Read").closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();
		expect(screen.getAllByText("README.md").some((element) => element.closest("[data-slot='task-item-file']"))).toBe(
			true,
		);
		expect(screen.queryByText("call-1")).toBeNull();
		expect(screen.queryByText("README.md contents")).toBeNull();
		expect(screen.queryByRole("button", { name: /read README\.md/i })).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-chevron']")).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-details-spacer']")).toBeNull();
	});

	it("renders tool result images as a separate activity preview grid", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{
							type: "toolCall",
							id: "image-tool-1",
							name: "read",
							arguments: { path: "/workspace/panel_003.jpg" },
						},
					],
					1,
					{ stopReason: "toolUse" },
				),
				{
					role: "toolResult",
					content: [
						{ type: "text", text: "Read image file [image/png]" },
						{
							type: "image",
							mimeType: "image/png",
							data: "iVBORw0KGgo=",
						},
					],
					isError: false,
					timestamp: 2,
					toolCallId: "image-tool-1",
					toolName: "read",
				} as Extract<AgentMessage, { role: "toolResult" }>,
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		await user.click(screen.getByRole("button", { name: /Agent activity Completed 0s/i }));
		expect(screen.getByText("Read").closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();
		expect(screen.getByText("panel_003.jpg").closest("[data-slot='task-item-file']")).not.toBeNull();
		expect(screen.getByAltText("panel_003.jpg").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
		await user.click(screen.getByRole("button", { name: "Open image preview for panel_003.jpg" }));
		expect(screen.getByRole("dialog", { name: "Image preview" }).querySelector("img")?.getAttribute("src")).toBe(
			"data:image/png;base64,iVBORw0KGgo=",
		);
		expect(screen.queryByText("Read image file [image/png]")).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-cot-image']")).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
	});

	it("summarizes batched image reads in agent activity without hiding preview images", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			messages: [
				assistantMessage(
					Array.from({ length: 7 }, (_, index) => ({
						type: "toolCall",
						id: `image-tool-${index}`,
						name: "read",
						arguments: { path: `/workspace/panel_${index}.png` },
					})),
					1,
					{ stopReason: "toolUse" },
				),
				...Array.from({ length: 7 }, (_, index) => ({
					role: "toolResult" as const,
					content: [
						{ type: "text" as const, text: "Read image file [image/png]" },
						{
							type: "image" as const,
							mimeType: "image/png",
							name: `panel_${index}.png`,
							data: `iVBORw0KGgo${index}`,
						},
					],
					isError: false,
					timestamp: 2 + index,
					toolCallId: `image-tool-${index}`,
					toolName: "read",
				})),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		await user.click(screen.getByRole("button", { name: /Agent activity Completed 0s/i }));
		expect(screen.getByText("Read 7 images").closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();
		expect(screen.queryByLabelText("Read panel_0.png")).toBeNull();
		expect(screen.getByAltText("panel_0.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
		expect(screen.getByAltText("panel_6.png").closest("[data-slot='thread-image-preview-grid']")).not.toBeNull();
		await user.click(screen.getByRole("button", { name: "Open image preview for panel_0.png" }));
		expect(screen.getByRole("dialog", { name: "Image preview" }).querySelector("img")?.getAttribute("src")).toBe(
			"data:image/png;base64,iVBORw0KGgo0",
		);
		expect(screen.queryByText("Read image file [image/png]")).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
	});

	it("renders assistant run errors as a collapsed task instead of a red notice", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			messages: [
				assistantMessage([{ type: "text", text: "I started the request." }], 1, {
					errorMessage: "Error: Provider key missing.\nstack frame should stay compact.",
					stopReason: "error",
				}),
			],
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(await screen.findByText("I started the request.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Authentication required" })).toBeTruthy();
		expect(container.querySelector("[data-slot='error-notice']")).toBeNull();
		expect(screen.queryByText(/Provider key missing/u)).toBeNull();

		await user.click(screen.getByRole("button", { name: "Authentication required" }));
		const detail = screen.getByText(/Provider key missing/u).closest("[data-slot='thread-run-status-detail']");

		expect(detail).toBeTruthy();
		expect(detail?.textContent).not.toContain("Error:");
		expect(detail?.textContent).not.toContain("\n");
		expect(detail?.textContent).not.toContain("stack frame");
	});

	it("extracts a compact detail from JSON-shaped provider errors", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			messages: [
				assistantMessage([{ type: "text", text: "I started the request." }], 1, {
					errorMessage: '{"error":{"message":"quota exceeded for this provider"}}',
					stopReason: "error",
				}),
			],
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.click(await screen.findByRole("button", { name: "Provider limit reached" }));
		const detail = screen
			.getByText("quota exceeded for this provider")
			.closest("[data-slot='thread-run-status-detail']");

		expect(detail).toBeTruthy();
		expect(container.textContent).not.toContain('{"error"');
	});

	it.each([
		{
			errorMessage: "Rate limit exceeded for this provider.",
			stopReason: "error" as const,
			summary: "Provider limit reached",
		},
		{
			errorMessage:
				"stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
			stopReason: "error" as const,
			summary: "Network interrupted",
		},
		{
			errorMessage: "Unexpected provider failure.",
			stopReason: "error" as const,
			summary: "Agent run failed",
		},
		{
			errorMessage: undefined,
			stopReason: "aborted" as const,
			summary: "Run cancelled",
		},
	])("classifies common run status as $summary", async ({ errorMessage, stopReason, summary }) => {
		agentStore.setState({
			messages: [
				assistantMessage([{ type: "text", text: "I started the request." }], 1, {
					errorMessage,
					stopReason,
				}),
			],
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(await screen.findByRole("button", { name: summary })).toBeTruthy();
		expect(container.querySelector("[data-slot='thread-run-status-task']")).toBeTruthy();
		expect(container.querySelector("[data-slot='error-notice']")).toBeNull();
		expect(container.textContent).not.toContain("https://chatgpt.com/backend-api/codex/responses");
	});

	it("renders long markdown code blocks through AI Elements code containment", async () => {
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{
							type: "text",
							text: "```text\nline 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\n```",
						},
					],
					1,
				),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(await screen.findByText("line 7")).toBeTruthy();
		const codeBlock = document.querySelector<HTMLElement>("[data-streamdown='code-block']");

		expect(codeBlock).not.toBeNull();
		expect(codeBlock?.getAttribute("data-language")).toBe("text");
		expect(codeBlock?.getAttribute("style")).toContain("content-visibility: auto");
		expect(codeBlock?.querySelector("[data-streamdown='code-block-header']")?.textContent).toContain("text");
		expect(screen.queryByRole("button", { name: "Expand code block" })).toBeNull();
	});

	it("keeps single-line text code blocks inside the AI Elements code container", async () => {
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{
							type: "text",
							text: "```text\nadult East Asian woman in her early 20s, a completely new and different facial identity in every generation step\n```",
						},
					],
					1,
				),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(
			await screen.findByText(
				"adult East Asian woman in her early 20s, a completely new and different facial identity in every generation step",
			),
		).toBeTruthy();
		const codeBlock = document.querySelector<HTMLElement>("[data-streamdown='code-block']");

		expect(codeBlock).not.toBeNull();
		expect(codeBlock?.getAttribute("data-language")).toBe("text");
		expect(codeBlock?.querySelector("[data-streamdown='code-block-actions']")).not.toBeNull();
		expect(screen.queryByRole("button", { name: "Wrap code block text" })).toBeNull();
	});

	it("uses AI Elements code actions instead of custom structural code drawers", async () => {
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{
							type: "text",
							text: "```text\nline 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\n```",
						},
					],
					1,
				),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(await screen.findByText("line 7")).toBeTruthy();
		const codeBlock = document.querySelector<HTMLElement>("[data-streamdown='code-block']");

		expect(codeBlock).not.toBeNull();
		expect(codeBlock?.querySelector("[data-streamdown='code-block-actions']")).not.toBeNull();
		expect(document.querySelector("[data-slot='assistant-code-block-content-spacer']")).toBeNull();
		expect(screen.getByTitle("Copy Code")).toBeTruthy();
	});

	it("keeps the scroll-to-bottom affordance driven by viewport metrics with AI Elements code blocks", async () => {
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{
							type: "text",
							text: "```text\nline 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\n```",
						},
					],
					1,
				),
			],
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const viewport = getAssistantViewport(container);
		const scrollToBottom = screen.getByLabelText("Scroll to bottom") as HTMLButtonElement;
		expect(await screen.findByText("line 7")).toBeTruthy();

		setAssistantViewportMetrics(viewport, { clientHeight: 600, scrollHeight: 600, scrollTop: 0 });
		fireEvent.scroll(viewport);
		expect(scrollToBottom.disabled).toBe(true);

		setAssistantViewportMetrics(viewport, { clientHeight: 600, scrollHeight: 1100, scrollTop: 0 });
		fireEvent.scroll(viewport);
		await waitFor(() => expect(scrollToBottom.disabled).toBe(false));

		setAssistantViewportMetrics(viewport, { clientHeight: 600, scrollHeight: 600, scrollTop: 0 });
		fireEvent.scroll(viewport);

		await waitFor(() => expect(scrollToBottom.disabled).toBe(true));
	});

	it("uses native auto scroll for the thread viewport when scroll-to-bottom is clicked", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{
							type: "text",
							text: "```text\nline 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\n```",
						},
					],
					1,
				),
			],
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const viewport = getAssistantViewport(container);
		const scrollTo = vi.fn();
		Object.defineProperty(viewport, "scrollTo", {
			configurable: true,
			value: scrollTo,
		});
		const scrollToBottom = screen.getByLabelText("Scroll to bottom") as HTMLButtonElement;
		expect(await screen.findByText("line 7")).toBeTruthy();

		setAssistantViewportMetrics(viewport, { clientHeight: 600, scrollHeight: 1600, scrollTop: 300 });
		fireEvent.scroll(viewport);
		await waitFor(() => expect(scrollToBottom.disabled).toBe(false));

		await user.click(scrollToBottom);

		expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1600 });
	});

	it("keeps completed run activity open across unrelated store updates", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{ type: "thinking", thinking: "Opened reasoning should remain visible." },
						{ type: "text", text: "Done." },
					],
					1,
				),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		const activityTrigger = screen.getByRole("button", { name: /Agent activity Completed 0s/i });
		expect(activityTrigger.getAttribute("aria-expanded")).toBe("false");

		await user.click(activityTrigger);
		expect(activityTrigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("Opened reasoning should remain visible.")).toBeTruthy();

		act(() => {
			agentStore.setState({
				availableTools: ["read", "bash"],
			});
		});

		expect(screen.getByRole("button", { name: /Agent activity Completed 0s/i }).getAttribute("aria-expanded")).toBe(
			"true",
		);
		expect(screen.getByText("Opened reasoning should remain visible.")).toBeTruthy();
	});

	it("hides completed reasoning when disabled while keeping lightweight tool activity visible", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{ type: "thinking", thinking: "Hidden reasoning." },
						{ type: "toolCall", id: "hidden-thinking-tool", name: "read", arguments: { path: "README.md" } },
						{ type: "text", text: "Tool run finished." },
					],
					1,
					{ stopReason: "toolUse" },
				),
				toolResultMessage("hidden-thinking-tool"),
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		expect(screen.getByText("Tool run finished.")).toBeTruthy();
		expect(screen.queryByText("Hidden reasoning.")).toBeNull();

		await user.click(screen.getByRole("button", { name: /Agent activity Completed 0s/i }));
		expect(screen.queryByText("Hidden reasoning.")).toBeNull();
		expect(screen.getByText("Read").closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();
		expect(screen.getByText("README.md").closest("[data-slot='task-item-file']")).not.toBeNull();
		expect(screen.queryByRole("button", { name: /read README\.md/i })).toBeNull();
	});

	it("summarizes completed errored tool activity as processed", () => {
		agentStore.setState({
			messages: [
				assistantMessage(
					[{ type: "toolCall", id: "failed-tool", name: "bash", arguments: { command: "exit 1" } }],
					1000,
					{ stopReason: "toolUse" },
				),
			],
			toolCalls: [
				{
					toolCallId: "failed-tool",
					toolName: "bash",
					args: { command: "exit 1" },
					status: "error",
					startedAt: 1000,
					updatedAt: 2000,
					completedAt: 2000,
					result: { content: [{ type: "text", text: "failed" }] },
				},
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["bash"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const activityTrigger = screen.getByRole("button", { name: /Agent activity Completed 1s/i });
		expect(activityTrigger).toBeTruthy();
		expect(screen.getByText("1 failed")).toBeTruthy();
		expect(screen.queryByText("处理失败")).toBeNull();
		expect(activityTrigger.querySelector("[data-slot='assistant-run-activity-status-icon']")).toBeNull();
	});

	it("opens streaming run activity by default with work-record language", async () => {
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage([{ type: "thinking", thinking: "Scanning context before editing." }], 1),
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		const activityTrigger = screen.getByRole("button", { name: /Working Running \d+s/i });
		await waitFor(() => {
			expect(activityTrigger.getAttribute("aria-expanded")).toBe("true");
		});
		expect(screen.getByText("Scanning context before editing.")).toBeTruthy();
		expect(screen.queryByText("Reasoning")).toBeNull();
	});

	it("throttles streaming text reveal while preserving final message updates", async () => {
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage([{ type: "text", text: "alpha" }], 1),
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		expect(await screen.findByText("alpha")).toBeTruthy();

		await act(async () => {
			agentStore.setState({
				streamingMessage: assistantMessage([{ type: "text", text: "alpha beta" }], 2),
			});
		});
		await act(async () => undefined);

		expect(screen.queryByText("alpha beta")).toBeNull();
		expect(screen.getByText("alpha")).toBeTruthy();

		await act(async () => {
			await new Promise((resolve) => window.setTimeout(resolve, 120));
		});

		expect(screen.queryByText("alpha beta")).toBeNull();

		await act(async () => {
			await new Promise((resolve) => window.setTimeout(resolve, 60));
		});

		await waitFor(() => {
			expect(getStreamingMarkdownText(document.body)).toBe("alpha beta");
		});

		await act(async () => {
			agentStore.setState({
				isStreaming: false,
				messages: [assistantMessage([{ type: "text", text: "alpha beta gamma" }], 3)],
				streamingMessage: undefined,
			});
		});

		expect(await screen.findByText("alpha beta gamma")).toBeTruthy();
	});

	it("renders active streaming text through AI Elements streaming markdown without word reveal replay", async () => {
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage(
				[
					{
						type: "text",
						text: "Streaming **bold** words arrive",
					},
				],
				1,
			),
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		const streamingText = await screen.findByText("Streaming", { exact: false });
		const streamingRoot = streamingText.closest("[data-slot='assistant-markdown-content']");

		expect(streamingRoot?.getAttribute("data-streaming")).toBe("true");
		expect(streamingRoot?.querySelector("[data-slot='assistant-streaming-word']")).toBeNull();

		await act(async () => {
			agentStore.setState({
				isStreaming: false,
				messages: [
					assistantMessage(
						[
							{
								type: "text",
								text: "Streaming **bold** words arrive",
							},
						],
						2,
					),
				],
				streamingMessage: undefined,
			});
		});

		await waitFor(() => {
			expect(container.querySelector("[data-slot='assistant-markdown-content'][data-streaming='true']")).toBeNull();
		});
		expect(screen.getByText("bold").closest("[data-streamdown='strong']")).not.toBeNull();
	});

	it("keeps the streaming markdown node mounted across chunk updates", async () => {
		agentStore.setState({
			activeSessionId: "session-1",
			isStreaming: true,
			streamingMessage: assistantMessage([{ type: "text", text: "alpha" }], 1),
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		const initialMarkdown = await screen.findByText("alpha");
		const initialRoot = initialMarkdown.closest("[data-slot='assistant-markdown-content']");
		expect(initialRoot?.getAttribute("data-streaming")).toBe("true");

		await act(async () => {
			agentStore.setState({
				streamingMessage: assistantMessage([{ type: "text", text: "alpha beta" }], 2),
			});
			await new Promise((resolve) => window.setTimeout(resolve, 180));
		});

		await waitFor(() => {
			expect(getStreamingMarkdownText(container)).toBe("alpha beta");
		});
		expect(container.querySelector("[data-slot='assistant-markdown-content'][data-streaming='true']")).toBe(
			initialRoot,
		);
	});

	it("reveals a pending streaming session without replaying word reveal animation", async () => {
		agentStore.setState({
			activeSessionId: "session-1",
			messages: [assistantMessage([{ type: "text", text: "Previous session stays visible while switching." }], 1)],
			pendingActiveSessionId: "session-2",
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		expect(screen.queryByText("Previous session stays visible while switching.")).toBeNull();
		expect(container.querySelector("[data-slot='assistant-session-switch-state']")).toBeTruthy();

		await act(async () => {
			agentStore.setState({
				activeSessionId: "session-2",
				isStreaming: true,
				messages: [],
				pendingActiveSessionId: undefined,
				streamingMessage: assistantMessage(
					[{ type: "text", text: "Already streamed content should not flash." }],
					2,
				),
			});
		});

		expect(await screen.findByText("Already streamed content should not flash.")).toBeTruthy();
		expect(container.querySelector("[data-slot='assistant-session-switch-state']")).toBeNull();
		expect(container.querySelector("[data-slot='assistant-streaming-word']")).toBeNull();
		expect(getStreamingMarkdownText(container)).toBe("Already streamed content should not flash.");
	});

	it("contains completed assistant messages for offscreen rendering without containing the active stream", () => {
		agentStore.setState({
			activeSessionId: "session-1",
			isStreaming: true,
			messages: [
				assistantMessage([{ type: "text", text: "Settled answer should be contained." }], 1),
				userMessage("Continue", 2),
			],
			streamingMessage: assistantMessage([{ type: "text", text: "Live answer should stay uncontained." }], 3),
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const completedMessage = screen
			.getByText("Settled answer should be contained.")
			.closest("[data-slot='assistant-message']");
		const streamingMessageRoot = container
			.querySelector("[data-slot='assistant-markdown-content'][data-streaming='true']")
			?.closest("[data-slot='assistant-message']");
		const css = readFileSync("src/renderer/styles/globals.css", "utf8");

		expect(completedMessage?.className).toContain("assistant-message-contained");
		expect(streamingMessageRoot?.className).not.toContain("assistant-message-contained");
		expect(css).toContain("content-visibility: auto");
		expect(css).toContain("contain-intrinsic-size");
	});

	it("does not render stale throttled streaming content after message_end commits the final response", async () => {
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage([{ type: "text", text: "partial answer" }], 1),
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		await waitFor(() => {
			expect(getStreamingMarkdownText(document.body)).toBe("partial answer");
		});

		flushSync(() => {
			agentStore.setState({
				isStreaming: true,
				messages: [assistantMessage([{ type: "text", text: "final response" }], 2)],
				streamingMessage: undefined,
			});
		});

		await waitFor(() => {
			expect(screen.queryByText("partial answer")).toBeNull();
			expect(screen.getByText("final response")).toBeTruthy();
			expect(screen.queryByRole("button", { name: /Working Running/i })).toBeNull();
		});
	});

	it("renders an in-thread first-response placeholder before assistant tokens arrive", async () => {
		agentStore.setState({
			isStreaming: true,
			messages: [userMessage("read the attached markdown", 1)],
			runActivityTiming: {
				runId: "run-first-response",
				startedAt: Date.parse("2026-04-28T00:00:00.000Z"),
			},
			streamingMessage: undefined,
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		await act(async () => undefined);
		expect(container.querySelector("[data-slot='assistant-empty-working']")?.textContent).toBe("Working");
		expect(container.querySelectorAll("[data-slot='assistant-message']")).toHaveLength(1);
	});

	it("keeps the latest activity running during tool execution gaps", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-28T00:00:05.000Z"));
		agentStore.setState({
			isStreaming: true,
			messages: [
				assistantMessage([{ type: "thinking", thinking: "Waiting for the next tool." }], 1, {
					stopReason: "toolUse",
				}),
			],
			runActivityTiming: {
				runId: "run-gap",
				startedAt: Date.parse("2026-04-28T00:00:00.000Z"),
			},
			streamingMessage: undefined,
			toolCalls: [],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		await act(async () => undefined);
		const activityTrigger = screen.getByRole("button", { name: /Working Running 5s/i });
		expect(activityTrigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("Waiting for the next tool.")).toBeTruthy();
	});

	it("keeps counting during a running run even when the current tool part is complete", async () => {
		vi.useFakeTimers();
		const startedAt = Date.parse("2026-04-28T00:00:00.000Z");
		vi.setSystemTime(new Date(startedAt + 5000));
		agentStore.setState({
			isStreaming: true,
			messages: [
				assistantMessage(
					[{ type: "toolCall", id: "completed-gap-tool", name: "read", arguments: { path: "README.md" } }],
					1,
					{ stopReason: "toolUse" },
				),
			],
			runActivityTiming: {
				runId: "run-completed-tool-gap",
				startedAt,
			},
			toolCalls: [
				{
					toolCallId: "completed-gap-tool",
					toolName: "read",
					args: { path: "README.md" },
					status: "completed",
					startedAt,
					updatedAt: startedAt + 1000,
					completedAt: startedAt + 1000,
					result: { content: [{ type: "text", text: "done" }] },
				},
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await act(async () => undefined);
		expect(screen.getByRole("button", { name: /Waiting for response Responding 5s/i })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Working Running 0s/i })).toBeNull();

		act(() => {
			vi.advanceTimersByTime(2000);
		});

		expect(screen.getByRole("button", { name: /Waiting for response Responding 7s/i })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Working Running 0s/i })).toBeNull();
	});

	it("keeps streaming activity open while running and collapses it after completion", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-28T00:00:00.000Z"));
		agentStore.setState({
			isStreaming: true,
			runActivityTiming: {
				runId: "run-smooth",
				startedAt: Date.parse("2026-04-28T00:00:00.000Z"),
			},
			streamingMessage: assistantMessage([{ type: "thinking", thinking: "Scanning context." }], 1),
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		await act(async () => undefined);
		const initialTrigger = screen.getByRole("button", { name: /Working Running 0s/i });
		expect(initialTrigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("Scanning context.")).toBeTruthy();

		act(() => {
			vi.advanceTimersByTime(2000);
		});
		const tickingTrigger = screen.getByRole("button", { name: /Working Running 2s/i });
		expect(tickingTrigger.getAttribute("aria-expanded")).toBe("true");

		act(() => {
			agentStore.setState({
				availableTools: ["read", "bash"],
			});
		});
		const updatedTrigger = screen.getByRole("button", { name: /Working Running 2s/i });
		expect(updatedTrigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("Scanning context.")).toBeTruthy();

		await act(async () => {
			agentStore.setState({
				isStreaming: false,
				messages: [
					assistantMessage(
						[
							{ type: "thinking", thinking: "Scanning context." },
							{ type: "text", text: "Done." },
						],
						1,
					),
				],
				runActivityTiming: {
					endedAt: Date.parse("2026-04-28T00:00:02.000Z"),
					runId: "run-smooth",
					startedAt: Date.parse("2026-04-28T00:00:00.000Z"),
				},
				streamingMessage: undefined,
			});
		});
		await act(async () => undefined);
		const completedTrigger = screen.getByRole("button", { name: /Agent activity Completed 2s/i });
		expect(completedTrigger.getAttribute("aria-expanded")).toBe("false");
		expect(screen.getByText("Done.")).toBeTruthy();
		await act(async () => {
			vi.advanceTimersByTime(410);
		});
		expect(screen.queryByText("Scanning context.")).toBeNull();
	});

	it("keeps running tool activity open as a lightweight task list", async () => {
		agentStore.setState({
			isStreaming: true,
			messages: [
				assistantMessage([{ type: "toolCall", id: "run-1", name: "read", arguments: { path: "README.md" } }], 1, {
					stopReason: "toolUse",
				}),
			],
			toolCalls: [
				{
					toolCallId: "run-1",
					toolName: "read",
					args: { path: "README.md" },
					status: "running",
					startedAt: 1,
					updatedAt: 1,
					partialResult: { content: [{ type: "text", text: "reading README.md" }] },
				},
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const activityTrigger = screen.getByRole("button", { name: /Working Running \d+s/i });
		await waitFor(() => {
			expect(activityTrigger.getAttribute("aria-expanded")).toBe("true");
		});
		expect(activityTrigger.textContent).toContain("Working");
		expect(screen.queryByText("Tool calls")).toBeNull();
		expect((await screen.findByText("Read")).closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();
		expect(screen.getByText("README.md").closest("[data-slot='task-item-file']")).not.toBeNull();
		expect(screen.queryByRole("button", { name: /read README\.md/i })).toBeNull();
		expect(screen.queryByText("run-1")).toBeNull();
		expect(screen.queryByText("reading README.md")).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
	});

	it("keeps active tool activity content available after collapsing and reopening during streaming", async () => {
		vi.useFakeTimers();
		agentStore.setState({
			isStreaming: true,
			messages: [
				assistantMessage(
					[{ type: "toolCall", id: "run-reopen-1", name: "read", arguments: { path: "README.md" } }],
					1,
					{
						stopReason: "toolUse",
					},
				),
			],
			toolCalls: [
				{
					toolCallId: "run-reopen-1",
					toolName: "read",
					args: { path: "README.md" },
					status: "running",
					startedAt: 1,
					updatedAt: 1,
					partialResult: { content: [{ type: "text", text: "reading README.md" }] },
				},
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const activityTrigger = screen.getByRole("button", { name: /Working Running \d+s/i });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(220);
		});
		expect(screen.getByText("Read").closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();

		fireEvent.click(activityTrigger);
		expect(activityTrigger.getAttribute("aria-expanded")).toBe("false");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(410);
		});

		fireEvent.click(activityTrigger);
		expect(activityTrigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("Read").closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();
		expect(screen.getByText("README.md").closest("[data-slot='task-item-file']")).not.toBeNull();
		expect(screen.queryByText("reading README.md")).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
	});

	it("pushes agent activity upward when the final answer dominates the visible viewport", async () => {
		const user = userEvent.setup();
		const requestAnimationFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			});
		const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
		try {
			agentStore.setState({
				messages: [
					assistantMessage(
						[
							{ type: "thinking", thinking: "Hidden planning details." },
							{ type: "text", text: "Dominant final answer stays visually anchored." },
						],
						1,
					),
				],
			});

			const { container } = render(
				<ChatWorkbench
					onAbort={vi.fn(async () => undefined)}
					onSubmitPrompt={vi.fn(async () => undefined)}
					runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
					showThinkingBlocks
				/>,
			);

			const viewport = getAssistantViewport(container);
			const scrollTo = vi.fn();
			Object.defineProperty(viewport, "scrollTo", {
				configurable: true,
				value: scrollTo,
			});
			setAssistantViewportMetrics(viewport, { clientHeight: 600, scrollHeight: 1800, scrollTop: 420 });
			setElementRect(viewport, { bottom: 600, height: 600, top: 0 });
			const finalAnswer = screen
				.getByText("Dominant final answer stays visually anchored.")
				.closest("[data-slot='assistant-markdown-content']");
			expect(finalAnswer).not.toBeNull();
			if (finalAnswer) {
				setElementRect(finalAnswer, { bottom: 570, height: 440, top: 130 });
			}

			const activityTrigger = screen.getByRole("button", { name: /Agent activity Completed 0s/i });
			const activityDrawer = activityTrigger
				.closest("[data-slot='assistant-run-activity']")
				?.querySelector("[data-slot='assistant-run-activity-content-spacer']");
			expect(activityDrawer).not.toBeNull();
			if (activityDrawer) {
				setReadOnlyElementNumber(activityDrawer, "scrollHeight", 240);
			}

			await user.click(activityTrigger);

			expect(activityDrawer?.getAttribute("data-push-direction")).toBe("up");
			expect(activityDrawer?.getAttribute("data-motion-origin")).toBe("bottom");
			expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 660 });
		} finally {
			cancelAnimationFrame.mockRestore();
			requestAnimationFrame.mockRestore();
		}
	});

	it("pushes agent activity downward when the final answer is not visually dominant", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			messages: [
				assistantMessage(
					[
						{ type: "thinking", thinking: "Hidden planning details." },
						{ type: "text", text: "Small final answer area." },
					],
					1,
				),
			],
		});

		const { container } = render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		const viewport = getAssistantViewport(container);
		const scrollTo = vi.fn();
		Object.defineProperty(viewport, "scrollTo", {
			configurable: true,
			value: scrollTo,
		});
		setAssistantViewportMetrics(viewport, { clientHeight: 600, scrollHeight: 1800, scrollTop: 420 });
		setElementRect(viewport, { bottom: 600, height: 600, top: 0 });
		const finalAnswer = screen
			.getByText("Small final answer area.")
			.closest("[data-slot='assistant-markdown-content']");
		expect(finalAnswer).not.toBeNull();
		if (finalAnswer) {
			setElementRect(finalAnswer, { bottom: 180, height: 80, top: 100 });
		}

		const activityTrigger = screen.getByRole("button", { name: /Agent activity Completed 0s/i });
		const activityDrawer = activityTrigger
			.closest("[data-slot='assistant-run-activity']")
			?.querySelector("[data-slot='assistant-run-activity-content-spacer']");
		expect(activityDrawer).not.toBeNull();
		if (activityDrawer) {
			setReadOnlyElementNumber(activityDrawer, "scrollHeight", 240);
		}

		await user.click(activityTrigger);

		expect(activityDrawer?.getAttribute("data-push-direction")).toBe("down");
		expect(activityDrawer?.getAttribute("data-motion-origin")).toBe("top");
		expect(scrollTo).not.toHaveBeenCalled();
	});

	it("auto-collapses run activity after completion while keeping the final answer visible", async () => {
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage([{ type: "thinking", thinking: "Drafting the final answer." }], 1),
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks
			/>,
		);

		const runningTrigger = screen.getByRole("button", { name: /Working Running \d+s/i });
		await waitFor(() => {
			expect(runningTrigger.getAttribute("aria-expanded")).toBe("true");
		});
		expect(screen.getByText("Drafting the final answer.")).toBeTruthy();

		act(() => {
			agentStore.setState({
				isStreaming: false,
				messages: [
					assistantMessage(
						[
							{ type: "thinking", thinking: "Drafting the final answer." },
							{ type: "text", text: "Final answer is ready." },
						],
						1,
					),
				],
				streamingMessage: undefined,
			});
		});

		const completedTrigger = await screen.findByRole("button", { name: /Agent activity Completed 0s/i });
		await waitFor(() => {
			expect(completedTrigger.getAttribute("aria-expanded")).toBe("false");
		});
		expect(screen.getByText("Final answer is ready.")).toBeTruthy();
		await waitFor(() => {
			expect(screen.queryByText("Drafting the final answer.")).toBeNull();
		});
	});

	it("animates tool rows before auto-collapsing completed run activity", async () => {
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage(
				[
					{ type: "toolCall", id: "collapse-read", name: "read", arguments: { path: "README.md" } },
					{ type: "toolCall", id: "collapse-bash", name: "bash", arguments: { command: "pwd" } },
				],
				1,
				{ stopReason: "toolUse" },
			),
			toolCalls: [
				{
					toolCallId: "collapse-read",
					toolName: "read",
					args: { path: "README.md" },
					status: "running",
					startedAt: 1,
					updatedAt: 1,
				},
				{
					toolCallId: "collapse-bash",
					toolName: "bash",
					args: { command: "pwd" },
					status: "running",
					startedAt: 1,
					updatedAt: 1,
				},
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read", "bash"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const runningTrigger = screen.getByRole("button", { name: /Working Running \d+s/i });
		await waitFor(() => {
			expect(runningTrigger.getAttribute("aria-expanded")).toBe("true");
		});

		vi.useFakeTimers();
		act(() => {
			agentStore.setState({
				isStreaming: false,
				messages: [
					assistantMessage(
						[
							{ type: "toolCall", id: "collapse-read", name: "read", arguments: { path: "README.md" } },
							{ type: "toolCall", id: "collapse-bash", name: "bash", arguments: { command: "pwd" } },
							{ type: "text", text: "Final answer is ready." },
						],
						1,
					),
					toolResultMessage("collapse-read"),
					toolResultMessage("collapse-bash"),
				],
				runActivityTiming: { endedAt: 260, runId: "collapse-run", startedAt: 1 },
				streamingMessage: undefined,
				toolCalls: [],
			});
		});
		await act(async () => undefined);

		const completedTrigger = screen.getByRole("button", { name: /Agent activity Completed 0s/i });
		expect(completedTrigger.getAttribute("aria-expanded")).toBe("true");
		const activity = completedTrigger.closest("[data-slot='assistant-run-activity']");
		expect(activity?.getAttribute("data-auto-collapsing")).toBe("true");

		const toolSteps = document.querySelectorAll("[data-slot='assistant-tool-call-step']");
		expect(toolSteps).toHaveLength(2);
		expect(toolSteps[0]?.getAttribute("data-auto-collapse")).toBe("closing");
		expect(toolSteps[0]?.getAttribute("data-auto-collapse-index")).toBe("0");
		expect(toolSteps[1]?.getAttribute("data-auto-collapse")).toBe("closing");
		expect(toolSteps[1]?.getAttribute("data-auto-collapse-index")).toBe("1");

		await act(async () => {
			vi.advanceTimersByTime(260);
		});

		expect(completedTrigger.getAttribute("aria-expanded")).toBe("false");
		expect(screen.getByText("Final answer is ready.")).toBeTruthy();
	});

	it("keeps raw tool output out of lightweight task items", async () => {
		const longOutput = "desktop-ai-agent-".repeat(32);
		agentStore.setState({
			isStreaming: true,
			messages: [
				assistantMessage(
					[
						{
							type: "toolCall",
							id: "bash-long-1",
							name: "bash",
							arguments: { command: "printf long-output" },
						},
					],
					1,
					{ stopReason: "toolUse" },
				),
			],
			toolCalls: [
				{
					toolCallId: "bash-long-1",
					toolName: "bash",
					args: { command: "printf long-output" },
					status: "running",
					startedAt: 1,
					updatedAt: 1,
					partialResult: { content: [{ type: "text", text: longOutput }] },
				},
			],
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["bash"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const activityTrigger = screen.getByRole("button", { name: /Working Running \d+s/i });
		await waitFor(() => {
			expect(activityTrigger.getAttribute("aria-expanded")).toBe("true");
		});
		expect((await screen.findByText("Ran command")).closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();
		expect(screen.queryByText(longOutput)).toBeNull();
		expect(screen.queryByText("Command")).toBeNull();
		expect(screen.queryByRole("button", { name: /bash printf long-output/i })).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
		expect(document.querySelector("[data-slot='tool-activity-detail-viewport']")).toBeNull();
	});

	it("keeps running and completed tool activity in lightweight timeline flow", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage(
				[
					{
						type: "toolCall",
						id: "bash-running-detail",
						name: "bash",
						arguments: { command: "find ." },
					},
				],
				1,
				{ stopReason: "toolUse" },
			),
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["bash"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const runningActivityTrigger = screen.getByRole("button", { name: /Working Running \d+s/i });
		await waitFor(() => {
			expect(runningActivityTrigger.getAttribute("aria-expanded")).toBe("true");
		});
		const runningContent = document.querySelector("[data-slot='assistant-run-activity-content']");
		expect(runningContent?.className).not.toContain("runtime-activity-scrollport");
		expect((await screen.findByText("Ran command")).closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();
		expect(screen.queryByRole("button", { name: /bash find ./i })).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-details-spacer']")).toBeNull();
		expect(activityDrawerTransition.duration).toBe(0.4);

		cleanup();
		agentStore.setState({
			isStreaming: false,
			messages: [
				assistantMessage(
					[
						{
							type: "toolCall",
							id: "bash-completed-detail",
							name: "bash",
							arguments: { command: "find ." },
						},
					],
					1,
					{ stopReason: "toolUse" },
				),
				toolResultMessage("bash-completed-detail"),
			],
			streamingMessage: undefined,
		});

		render(
			<ChatWorkbench
				onAbort={vi.fn(async () => undefined)}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["bash"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		const completedActivityTrigger = screen.getByRole("button", { name: /Agent activity Completed 0s/i });
		await user.click(completedActivityTrigger);
		const completedContent = document.querySelector("[data-slot='assistant-run-activity-content']");
		expect(completedContent?.className).not.toContain("runtime-activity-scrollport");
		expect(screen.getByText("Ran command").closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();
		expect(screen.queryByRole("button", { name: /bash find ./i })).toBeNull();
		expect(document.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
	});
});
