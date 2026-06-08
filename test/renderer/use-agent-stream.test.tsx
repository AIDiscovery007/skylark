import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentStream } from "../../src/renderer/hooks/use-agent-stream.ts";
import { INITIAL_AGENT_RENDERER_STATE } from "../../src/renderer/lib/conversation-timeline-projection.ts";
import { agentStore } from "../../src/renderer/stores/agent-store.ts";
import { projectStore } from "../../src/renderer/stores/project-store.ts";
import { sessionStore } from "../../src/renderer/stores/session-store.ts";
import type { DesktopAgentSnapshot } from "../../src/shared/serialized-agent-event.ts";
import type { DesktopProjectSummary, DesktopSessionSummary } from "../../src/shared/types.ts";
import {
	installRendererDesktopAgentBridge,
	removeRendererDesktopAgentBridge,
} from "../support/renderer-desktop-agent-bridge.ts";

const session: DesktopSessionSummary = {
	id: "session-1",
	title: "Active session",
	cwd: "/workspace/project",
	createdAt: "2026-05-01T08:00:00.000Z",
	updatedAt: "2026-05-01T08:15:00.000Z",
	messageCount: 1,
	agentMode: "execute",
	provider: "anthropic",
	modelId: "claude-sonnet-4",
};

const project: DesktopProjectSummary = {
	id: "project-1",
	name: "project",
	cwd: "/workspace/project",
	createdAt: "2026-05-01T07:00:00.000Z",
	updatedAt: "2026-05-01T08:15:00.000Z",
	sessionCount: 1,
	lastOpenedSessionId: "session-1",
};

function resetStores(): void {
	agentStore.setState({
		...INITIAL_AGENT_RENDERER_STATE,
		activeSessionId: undefined,
		pendingActiveSessionId: undefined,
		sessionStateAccessedAt: {},
		sessionStates: {},
	});
	projectStore.setState({
		projects: [project],
		sessionsByProjectId: { "project-1": [session] },
		activeProjectId: "project-1",
		isLoading: false,
		isCreating: false,
		isSwitching: false,
		errorMessage: undefined,
	});
	sessionStore.setState({
		sessions: [session],
		projectId: "project-1",
		activeSessionId: "session-1",
		hasLoadedProjectSessions: true,
		isLoading: false,
		isCreating: false,
		isSwitching: false,
		isDeleting: false,
		errorMessage: undefined,
	});
}

function HookHarness(): null {
	useAgentStream("session-1");
	return null;
}

describe("useAgentStream", () => {
	beforeEach(() => {
		resetStores();
	});

	afterEach(() => {
		cleanup();
		resetStores();
		removeRendererDesktopAgentBridge();
		vi.restoreAllMocks();
	});

	it("applies refreshed snapshots to agent, session, and project stores", async () => {
		const snapshot: DesktopAgentSnapshot = {
			sessionId: "session-1",
			cwd: "/workspace/project",
			agentMode: "plan",
			diagnostics: [],
			model: {
				id: "gpt-5.4",
				name: "GPT-5.4",
				provider: "openai",
				reasoning: true,
			},
			thinkingLevel: "high",
			availableTools: ["read", "bash"],
			messages: [],
			pendingToolCalls: [],
			isStreaming: false,
		};
		const getSnapshot = vi.fn(async () => snapshot);

		installRendererDesktopAgentBridge({
			getSnapshot,
			subscribeToAgentEvents: vi.fn(() => () => undefined),
		});

		render(<HookHarness />);

		await waitFor(() => expect(getSnapshot).toHaveBeenCalledWith("session-1"));
		await waitFor(() => expect(agentStore.getState().hasHydrated).toBe(true));

		expect(sessionStore.getState().sessions[0]).toEqual(
			expect.objectContaining({
				agentMode: "plan",
				modelId: "gpt-5.4",
				provider: "openai",
			}),
		);
		expect(projectStore.getState().sessionsByProjectId["project-1"]?.[0]).toEqual(
			expect.objectContaining({
				agentMode: "plan",
				modelId: "gpt-5.4",
				provider: "openai",
			}),
		);
	});
});
