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
import type { DesktopEnvironmentEvent, DesktopEnvironmentResource } from "../../src/shared/types.ts";

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

	it("opens a persisted subagent activity row from the thread", async () => {
		const user = userEvent.setup();
		const onOpenSubagent = vi.fn();
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
				onOpenSubagent={onOpenSubagent}
				onSubmitPrompt={vi.fn(async () => undefined)}
				runtimeCatalog={{ defaultTools: ["read"], providers: [] }}
				showThinkingBlocks={false}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /Agent activity Completed 0s/i }));
		await user.click(screen.getByRole("button", { name: /subagent Inspect auth flow Completed/i }));

		expect(onOpenSubagent).toHaveBeenCalledTimes(1);
		expect(onOpenSubagent).toHaveBeenCalledWith({
			parentSessionId: "session-1",
			subagentId: "subagent-session-1",
			title: "Inspect auth flow",
		});
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

	it("opens the slash command palette when only slash is typed", async () => {
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

		expect(await screen.findByText("Slash commands")).toBeTruthy();
		expect(screen.getByText("/desktop-prompt")).toBeTruthy();
		expect(screen.getByText("/skill:review")).toBeTruthy();
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
			expect(await screen.findByText("Slash commands")).toBeTruthy();
			scrollIntoView.mockClear();

			await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");

			const selectedCommand = screen.getByText("/cmd-6").closest("button");
			expect(selectedCommand?.getAttribute("data-selected")).toBe("true");
			expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
		} finally {
			HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
		}
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

	it("renders user image parts as lightweight attachment cards", () => {
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

		const attachment = screen.getByAltText("Attached visual").closest("[data-slot='user-attachment-card']");

		expect(attachment).toBeTruthy();
		expect(attachment?.className).toContain("border-[color:var(--border-subtle)]");
		expect(screen.getByAltText("Attached visual").getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
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
		expect(inputSurface?.className).toContain("focus-within:shadow-[var(--shadow-panel-focused)]");
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
						{ type: "thinking", thinking: "Check the file before summarizing." },
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
		expect(activityRoot?.querySelector("[data-slot='assistant-run-activity-chain-of-thought']")).not.toBeNull();
		expect(screen.getByText("Agent activity")).toBeTruthy();
		expect(screen.getByText(/Completed 0s/)).toBeTruthy();
		expect(screen.queryByText("Reasoning")).toBeNull();
		expect(screen.queryByText("Tool calls")).toBeNull();
		expect(screen.queryByText("Working")).toBeNull();
		expect(screen.queryByText("README.md contents")).toBeNull();
		expect(screen.queryByText("Check the file before summarizing.")).toBeNull();

		await user.click(activityTrigger);
		expect(screen.getByText("Check the file before summarizing.")).toBeTruthy();
		const activityContent = screen
			.getByText("Check the file before summarizing.")
			.closest("[data-slot='assistant-run-activity-content']");
		expect(activityContent?.className).not.toContain("border-l");
		const activityDrawer = activityContent?.closest("[data-slot='assistant-run-activity-content-spacer']");
		expect(activityDrawer?.getAttribute("data-motion")).toBe("structural-drawer");
		expect(activityDrawer?.getAttribute("data-motion-mode")).toBe("drawer");
		expect(activityDrawer?.getAttribute("data-motion-origin")).toBe("top");
		expect(activityDrawer?.getAttribute("data-structural-layout-driver")).toBe("height");
		expect(activityDrawer?.getAttribute("data-state")).toBe("open");
		expect(activityDrawerTransition.duration).toBeGreaterThanOrEqual(0.3);
		expect(activityDrawerTransition.duration).toBeLessThanOrEqual(0.5);
		const reasoningStep = screen
			.getByText("Check the file before summarizing.")
			.closest("[data-slot='assistant-reasoning-part']");
		expect(reasoningStep?.className).toContain("animate-in");
		expect(screen.getAllByText("read").length).toBeGreaterThan(0);
		expect(screen.queryByText("call-1")).toBeNull();
		expect(screen.queryByText("README.md contents")).toBeNull();

		const toolRow = screen.getByRole("button", { name: /read README\.md/i });
		expect(toolRow.closest("[data-slot='assistant-tool-call-step']")).not.toBeNull();
		const toolChevron = toolRow.querySelector("[data-slot='assistant-tool-call-chevron']");
		expect(toolChevron?.getAttribute("class")).not.toContain("rotate-90");

		await user.click(toolRow);
		expect(toolChevron?.getAttribute("class")).toContain("rotate-90");
		const readContents = screen.getByText(
			(_content, element) =>
				element?.tagName.toLowerCase() === "code" && element.textContent === "README.md contents",
		);
		expect(readContents).toBeTruthy();
		const toolDetails = readContents.closest("[data-slot='assistant-tool-call-details']");
		expect(toolDetails).not.toBeNull();
		if (!toolDetails) {
			throw new Error("Expected tool call details to render after expanding the tool row.");
		}
		expect(toolDetails.className).toContain("block");
		expect(toolDetails.getAttribute("style")).toBeNull();
		expect(toolDetails?.className).not.toContain("border-l");
		expect(toolRow.compareDocumentPosition(toolDetails) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		await user.click(toolRow);
		expect(toolChevron?.getAttribute("class")).not.toContain("rotate-90");
		const closingToolDetailsSpacer = document.querySelector("[data-slot='assistant-tool-call-details-spacer']");
		expect(closingToolDetailsSpacer?.getAttribute("data-state")).toBe("closed");
		expect(document.querySelector("[data-slot='assistant-tool-call-details']")).not.toBeNull();
		await waitFor(() => {
			expect(document.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
		});
	});

	it("renders assistant run errors as timeline notices instead of normal markdown text", async () => {
		agentStore.setState({
			messages: [
				assistantMessage([{ type: "text", text: "I started the request." }], 1, {
					errorMessage: "Provider key missing.",
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
		const notice = screen.getByText("Provider key missing.").closest("[data-slot='error-notice']");

		expect(notice).toBeTruthy();
		expect(container.textContent).not.toContain("Error: Provider key missing.");
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

	it("hides completed reasoning when disabled while keeping tool activity expandable", async () => {
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
		expect(screen.getByRole("button", { name: /read README\.md/i })).toBeTruthy();
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

	it("keeps running tool activity open while tool details stay collapsed", async () => {
		const user = userEvent.setup();
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
		expect(screen.getByRole("button", { name: /read README\.md/i })).toBeTruthy();
		expect(screen.queryByText("reading README.md")).toBeNull();

		const toolRow = screen.getByRole("button", { name: /read README\.md/i });
		expect(toolRow).toBeTruthy();
		expect(screen.queryByText("run-1")).toBeNull();
		expect(screen.queryByText("reading README.md")).toBeNull();

		await user.click(toolRow);
		expect(
			screen.getByText(
				(_content, element) =>
					element?.tagName.toLowerCase() === "code" && element.textContent === "reading README.md",
			),
		).toBeTruthy();
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

	it("contains long tool output inside bounded scroll containers", async () => {
		const user = userEvent.setup();
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
		await user.click(await screen.findByRole("button", { name: /bash printf long-output/i }));
		const code = await screen.findByText(longOutput);
		const pre = code.closest("pre");
		const codeScroll = pre?.parentElement;
		const codeBlock = code.closest("[data-slot='tool-activity-code-block']");
		const output = code.closest("[data-slot='tool-activity-output']");
		const sections = code.closest("[data-slot='tool-activity-output-sections']");
		const details = code.closest("[data-slot='tool-activity-details']");

		expect(codeBlock?.getAttribute("data-language")).toBe("log");
		expect(codeBlock?.className).toContain("max-w-full");
		expect(codeBlock?.className).toContain("overflow-hidden");
		expect(pre?.className).toContain("text-sm");
		expect(pre?.className).toContain("p-4");
		expect(codeScroll?.className).toContain("overflow-auto");
		expect(output?.className).toContain("space-y-2");
		expect(sections?.className).toContain("max-w-full");
		expect(sections?.className).toContain("gap-3");
		expect(details?.className).toContain("not-prose");
		expect(details?.className).toContain("w-full");
	});

	it("streams running tool expansion in timeline flow while keeping local detail viewports bounded", async () => {
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
		await user.click(await screen.findByRole("button", { name: /bash find ./i }));
		const runningDetails = document.querySelector("[data-slot='assistant-tool-call-details']");
		expect(runningDetails?.getAttribute("data-layout")).toBe("timeline-flow");
		expect(runningDetails?.className).not.toContain("runtime-tool-detail-scrollport");
		const runningDetailsSpacer = runningDetails?.closest("[data-slot='assistant-tool-call-details-spacer']");
		expect(runningDetailsSpacer?.getAttribute("data-motion")).toBe("structural-drawer");
		expect(runningDetailsSpacer?.getAttribute("data-motion-mode")).toBe("drawer");
		expect(runningDetailsSpacer?.getAttribute("data-motion-origin")).toBe("top");
		expect(runningDetailsSpacer?.getAttribute("data-structural-layout-driver")).toBe("height");
		expect(runningDetailsSpacer?.getAttribute("data-state")).toBe("open");
		expect(activityDrawerTransition.duration).toBe(0.4);
		const runningDetailViewports = document.querySelectorAll("[data-slot='tool-activity-detail-viewport']");
		expect(runningDetailViewports.length).toBeGreaterThan(0);
		for (const viewport of runningDetailViewports) {
			expect(viewport.className).toContain("runtime-tool-section-scrollport");
		}
		await user.click(await screen.findByRole("button", { name: /bash find ./i }));
		expect(runningDetailsSpacer?.getAttribute("data-state")).toBe("closed");
		expect(document.querySelector("[data-slot='assistant-tool-call-details']")).not.toBeNull();
		await waitFor(() => {
			expect(document.querySelector("[data-slot='assistant-tool-call-details']")).toBeNull();
		});

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
		await user.click(await screen.findByRole("button", { name: /bash find ./i }));
		const completedDetails = document.querySelector("[data-slot='assistant-tool-call-details']");
		expect(completedDetails?.getAttribute("data-layout")).toBe("timeline-flow");
		expect(completedDetails?.className).not.toContain("runtime-tool-detail-scrollport");
	});

	it("starts tool call expansion from a mounted closed drawer before opening on the next frame", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage(
				[
					{
						type: "toolCall",
						id: "bash-opening-detail",
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

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Working Running \d+s/i }).getAttribute("aria-expanded")).toBe(
				"true",
			);
		});

		const animationFrameCallbacks: FrameRequestCallback[] = [];
		const requestAnimationFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				animationFrameCallbacks.push(callback);
				return animationFrameCallbacks.length;
			});
		const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

		try {
			await user.click(await screen.findByRole("button", { name: /bash find ./i }));

			const details = document.querySelector("[data-slot='assistant-tool-call-details']");
			const detailsSpacer = document.querySelector("[data-slot='assistant-tool-call-details-spacer']");
			expect(details).not.toBeNull();
			expect(detailsSpacer?.getAttribute("data-state")).toBe("open");
			expect(detailsSpacer?.getAttribute("data-motion-phase")).toBe("opening");
			expect(animationFrameCallbacks.length).toBeGreaterThan(0);

			await act(async () => {
				for (const callback of animationFrameCallbacks.splice(0)) {
					callback(16);
				}
			});

			await waitFor(() => {
				expect(detailsSpacer?.getAttribute("data-motion-phase")).toBe("open");
			});
		} finally {
			cancelAnimationFrame.mockRestore();
			requestAnimationFrame.mockRestore();
		}
	});

	it("measures tool call expansion from visual layout height instead of oversized scroll height", async () => {
		const user = userEvent.setup();
		agentStore.setState({
			isStreaming: true,
			streamingMessage: assistantMessage(
				[
					{
						type: "toolCall",
						id: "bash-oversized-scroll-height",
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

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Working Running \d+s/i }).getAttribute("aria-expanded")).toBe(
				"true",
			);
		});

		const animationFrameCallbacks: FrameRequestCallback[] = [];
		const requestAnimationFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback: FrameRequestCallback) => {
				animationFrameCallbacks.push(callback);
				return animationFrameCallbacks.length;
			});
		const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

		try {
			await user.click(await screen.findByRole("button", { name: /bash find ./i }));

			const details = document.querySelector("[data-slot='assistant-tool-call-details']");
			const detailsSpacer = document.querySelector("[data-slot='assistant-tool-call-details-spacer']");
			expect(details).not.toBeNull();
			expect(detailsSpacer?.getAttribute("data-motion-phase")).toBe("opening");
			if (!details) {
				throw new Error("Expected tool call details to be mounted before opening measurement.");
			}
			setElementRect(details, { bottom: 240, height: 240, top: 0 });
			setReadOnlyElementNumber(details, "scrollHeight", 1200);

			await act(async () => {
				for (const callback of animationFrameCallbacks.splice(0)) {
					callback(16);
				}
			});

			await waitFor(() => {
				expect(detailsSpacer?.getAttribute("data-motion-target-height")).toBe("240");
				expect(detailsSpacer?.getAttribute("data-motion-target-height")).not.toBe("1200");
			});
		} finally {
			cancelAnimationFrame.mockRestore();
			requestAnimationFrame.mockRestore();
		}
	});
});
