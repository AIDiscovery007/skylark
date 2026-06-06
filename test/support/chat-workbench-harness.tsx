import { type RenderResult, render } from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { vi } from "vitest";
import { ChatWorkbench } from "../../src/renderer/components/chat/ChatWorkbench.tsx";
import { INITIAL_AGENT_RENDERER_STATE } from "../../src/renderer/lib/conversation-timeline-projection.ts";
import { type AgentStoreState, agentStore } from "../../src/renderer/stores/agent-store.ts";
import type { DesktopRuntimeCatalog } from "../../src/shared/types.ts";

type ChatWorkbenchProps = ComponentProps<typeof ChatWorkbench>;

export const DEFAULT_CHAT_WORKBENCH_RUNTIME_CATALOG = {
	defaultTools: ["read"],
	providers: [],
} satisfies DesktopRuntimeCatalog;

export function resetChatWorkbenchAgentStore(overrides: Partial<AgentStoreState> = {}): void {
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
		pendingActiveSessionId: undefined,
		sessionStateAccessedAt: {},
		sessionStates: {},
		thinkingLevel: "low",
		...overrides,
	});
}

export function clearChatWorkbenchAgentStore(): void {
	agentStore.setState({
		...INITIAL_AGENT_RENDERER_STATE,
		activeSessionId: undefined,
		pendingActiveSessionId: undefined,
		sessionStateAccessedAt: {},
		sessionStates: {},
	});
}

export function createChatWorkbenchProps(overrides: Partial<ChatWorkbenchProps> = {}): ChatWorkbenchProps & {
	onAbort: () => Promise<void>;
	onSubmitPrompt: ChatWorkbenchProps["onSubmitPrompt"];
} {
	const onAbort = overrides.onAbort ?? vi.fn(async () => undefined);
	const onSubmitPrompt = overrides.onSubmitPrompt ?? vi.fn(async () => undefined);

	return {
		onAbort,
		onSubmitPrompt,
		runtimeCatalog: DEFAULT_CHAT_WORKBENCH_RUNTIME_CATALOG,
		showThinkingBlocks: false,
		...overrides,
	};
}

export function renderChatWorkbench(overrides: Partial<ChatWorkbenchProps> = {}): RenderResult & {
	onAbort: () => Promise<void>;
	onSubmitPrompt: ChatWorkbenchProps["onSubmitPrompt"];
	props: ChatWorkbenchProps;
	renderResult: RenderResult;
} {
	const props = createChatWorkbenchProps(overrides);
	const renderResult = render(createElement(ChatWorkbench, props));

	return {
		...renderResult,
		onAbort: props.onAbort,
		onSubmitPrompt: props.onSubmitPrompt,
		props,
		renderResult,
	};
}
