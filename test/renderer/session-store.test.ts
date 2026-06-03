import { describe, expect, it, vi } from "vitest";
import { createSessionStore } from "../../src/renderer/stores/session-store.ts";
import type { DesktopAgentSnapshot } from "../../src/shared/serialized-agent-event.ts";
import type { DesktopSessionSummary } from "../../src/shared/types.ts";

function createSession(id: string, updatedAt: string, title = id): DesktopSessionSummary {
	return {
		id,
		title,
		cwd: "/workspace/project",
		createdAt: updatedAt,
		updatedAt,
		messageCount: 0,
		agentMode: "execute",
		provider: "anthropic",
		modelId: "claude-sonnet-4-20250514",
	};
}

function createDeferredPromise<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return { promise, reject, resolve };
}

describe("sessionStore", () => {
	it("hydrates active project sessions from the workspace overview", () => {
		const store = createSessionStore();
		const sessionOne = createSession("session-1", "2026-04-21T09:00:00.000Z");
		const sessionTwo = createSession("session-2", "2026-04-21T10:00:00.000Z");

		store.getState().applyWorkspaceOverview({
			settings: { lastOpenedProjectId: "project-1", lastOpenedSessionId: "session-1" },
			projects: [],
			sessionsByProjectId: {
				"project-1": [sessionOne, sessionTwo],
			},
			activeProjectId: "project-1",
			activeSessionId: "session-1",
		});

		const state = store.getState();
		expect(state.projectId).toBe("project-1");
		expect(state.activeSessionId).toBe("session-1");
		expect(state.sessions.map((session) => session.id)).toEqual(["session-2", "session-1"]);
		expect(state.hasLoadedProjectSessions).toBe(true);
	});

	it("loads persisted sessions sorted by recency and respects the last opened session", async () => {
		const store = createSessionStore();
		const bridge = {
			getSettings: vi.fn(async () => ({ lastOpenedSessionId: "session-2" })),
			listSessions: vi.fn(async () => [
				createSession("session-1", "2026-04-21T09:00:00.000Z"),
				createSession("session-2", "2026-04-21T08:00:00.000Z"),
				createSession("session-3", "2026-04-21T11:00:00.000Z"),
			]),
			newSession: vi.fn(),
			switchSession: vi.fn(),
		};

		await store.getState().loadSessions(bridge);

		const state = store.getState();
		expect(state.sessions.map((session) => session.id)).toEqual(["session-3", "session-1", "session-2"]);
		expect(state.activeSessionId).toBe("session-2");
		expect(bridge.switchSession).not.toHaveBeenCalled();
		expect(state.errorMessage).toBe(undefined);
	});

	it("creates a session and marks it active", async () => {
		const store = createSessionStore();
		const createdSession = createSession("session-4", "2026-04-21T12:30:00.000Z", "Fresh");
		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async () => [createSession("session-1", "2026-04-21T09:00:00.000Z"), createdSession]),
			newSession: vi.fn(async () => createdSession),
			switchSession: vi.fn(),
		};

		const session = await store.getState().createSession(bridge);

		expect(session?.id).toBe("session-4");
		expect(store.getState().activeSessionId).toBe("session-4");
		expect(store.getState().sessions.map((entry) => entry.id)).toEqual(["session-4", "session-1"]);
	});

	it("loads and creates sessions within the selected project scope", async () => {
		const store = createSessionStore();
		const createdSession = createSession("session-2", "2026-04-21T12:30:00.000Z", "Project scoped");
		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async (_projectId?: string) => [createdSession]),
			newSession: vi.fn(async (_projectId?: string) => createdSession),
			switchSession: vi.fn(),
		};

		await store.getState().loadSessions(bridge, "project-1", "session-2");
		await store.getState().createSession(bridge, "project-1");

		expect(store.getState().activeSessionId).toBe("session-2");
		expect(store.getState().projectId).toBe("project-1");
		expect(bridge.listSessions).toHaveBeenCalledWith("project-1");
		expect(bridge.newSession).toHaveBeenCalledWith("project-1");
	});

	it("preserves the active session when a same-project reload resolves after creation", async () => {
		const store = createSessionStore();
		const olderSession = createSession("session-1", "2026-04-21T09:00:00.000Z", "Older");
		const createdSession = createSession("session-2", "2026-04-21T12:30:00.000Z", "Created");
		const bridge = {
			getSettings: vi.fn(async () => ({ lastOpenedSessionId: "session-1" })),
			listSessions: vi.fn(async (_projectId?: string) => [olderSession, createdSession]),
			newSession: vi.fn(async (_projectId?: string) => createdSession),
			switchSession: vi.fn(),
		};

		await store.getState().loadSessions(bridge, "project-1", "session-1");
		await store.getState().createSession(bridge, "project-1");
		await store.getState().loadSessions(bridge, "project-1", "session-1");

		expect(store.getState().activeSessionId).toBe("session-2");
	});

	it("switches sessions without re-invoking the bridge for the active session", async () => {
		const store = createSessionStore();
		const sessionOne = createSession("session-1", "2026-04-21T09:00:00.000Z");
		const sessionTwo = createSession("session-2", "2026-04-21T10:00:00.000Z");
		store.setState({
			...store.getState(),
			sessions: [sessionTwo, sessionOne],
			activeSessionId: "session-1",
		});

		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async () => [sessionTwo, sessionOne]),
			newSession: vi.fn(),
			switchSession: vi.fn(async () => sessionTwo),
		};

		await store.getState().switchSession(bridge, "session-2");
		const currentSession = await store.getState().switchSession(bridge, "session-2");

		expect(store.getState().activeSessionId).toBe("session-2");
		expect(currentSession?.id).toBe("session-2");
		expect(bridge.switchSession).toHaveBeenCalledTimes(1);
	});

	it("preserves visible session order when switching sessions", async () => {
		const store = createSessionStore();
		const sessionOne = createSession("session-1", "2026-04-21T09:00:00.000Z", "First");
		const sessionTwo = createSession("session-2", "2026-04-21T10:00:00.000Z", "Second");
		const sessionThree = createSession("session-3", "2026-04-21T11:00:00.000Z", "Third");

		store.setState({
			...store.getState(),
			sessions: [sessionThree, sessionOne, sessionTwo],
			activeSessionId: "session-1",
		});

		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async () => [
				{ ...sessionTwo, updatedAt: "2026-04-22T10:00:00.000Z" },
				sessionThree,
				{ ...sessionOne, updatedAt: "2026-04-22T09:30:00.000Z", title: "First updated", messageCount: 2 },
			]),
			newSession: vi.fn(),
			switchSession: vi.fn(async () => ({ ...sessionTwo, updatedAt: "2026-04-22T10:00:00.000Z" })),
		};

		await store.getState().switchSession(bridge, "session-2");

		expect(store.getState().sessions.map((session) => session.id)).toEqual(["session-3", "session-1", "session-2"]);
		expect(store.getState().sessions[1]).toEqual(
			expect.objectContaining({
				id: "session-1",
				title: "First updated",
				messageCount: 2,
				updatedAt: "2026-04-22T09:30:00.000Z",
			}),
		);
		expect(store.getState().activeSessionId).toBe("session-2");
		expect(bridge.listSessions).toHaveBeenCalledTimes(1);
	});

	it("preserves active project session order when switching without an explicit project id", async () => {
		const store = createSessionStore();
		const sessionOne = createSession("session-1", "2026-04-21T09:00:00.000Z", "First");
		const sessionTwo = createSession("session-2", "2026-04-21T10:00:00.000Z", "Second");
		const sessionThree = createSession("session-3", "2026-04-21T11:00:00.000Z", "Third");

		store.setState({
			...store.getState(),
			sessions: [sessionThree, sessionOne, sessionTwo],
			projectId: "project-1",
			activeSessionId: "session-1",
		});

		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async (_projectId?: string) => [
				{ ...sessionTwo, updatedAt: "2026-04-22T10:00:00.000Z" },
				sessionThree,
				sessionOne,
			]),
			newSession: vi.fn(),
			switchSession: vi.fn(async () => ({ ...sessionTwo, updatedAt: "2026-04-22T10:00:00.000Z" })),
		};

		await store.getState().switchSession(bridge, "session-2");

		expect(store.getState().sessions.map((session) => session.id)).toEqual(["session-3", "session-1", "session-2"]);
		expect(store.getState().projectId).toBe("project-1");
		expect(store.getState().activeSessionId).toBe("session-2");
		expect(bridge.listSessions).toHaveBeenCalledWith("project-1");
	});

	it("does not carry previous project sessions when switching across projects", async () => {
		const store = createSessionStore();
		const firstProjectSession = {
			...createSession("session-1", "2026-04-21T09:00:00.000Z", "First project"),
			cwd: "/workspace/one",
		};
		const previousProjectSession = {
			...createSession("session-2", "2026-04-21T10:00:00.000Z", "Previous project"),
			cwd: "/workspace/one",
		};
		const targetProjectSession = {
			...createSession("session-3", "2026-04-21T11:00:00.000Z", "Target project"),
			cwd: "/workspace/two",
		};
		store.setState({
			...store.getState(),
			sessions: [previousProjectSession, firstProjectSession],
			projectId: "project-1",
			activeSessionId: "session-1",
		});

		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async (projectId?: string) =>
				projectId === "project-2" ? [targetProjectSession] : [previousProjectSession, firstProjectSession],
			),
			newSession: vi.fn(),
			switchSession: vi.fn(async () => targetProjectSession),
		};

		await store.getState().switchSession(bridge, "session-3", "project-2");

		expect(store.getState().projectId).toBe("project-2");
		expect(store.getState().activeSessionId).toBe("session-3");
		expect(store.getState().sessions.map((session) => session.id)).toEqual(["session-3"]);
		expect(bridge.listSessions).toHaveBeenCalledWith("project-2");
	});

	it("preserves target project session order when switching across projects", async () => {
		const store = createSessionStore();
		const activeProjectSession = {
			...createSession("session-1", "2026-04-21T09:00:00.000Z", "Active project"),
			cwd: "/workspace/one",
		};
		const targetProjectSessionOne = {
			...createSession("session-2", "2026-04-21T10:00:00.000Z", "Hello"),
			cwd: "/workspace/two",
		};
		const targetProjectSessionTwo = {
			...createSession("session-3", "2026-04-21T09:30:00.000Z", "Snake"),
			cwd: "/workspace/two",
		};
		const targetProjectSessionThree = {
			...createSession("session-4", "2026-04-20T09:00:00.000Z", "HTML"),
			cwd: "/workspace/two",
		};
		store.setState({
			...store.getState(),
			sessions: [activeProjectSession],
			projectId: "project-1",
			activeSessionId: "session-1",
		});

		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async (projectId?: string) =>
				projectId === "project-2"
					? [targetProjectSessionOne, targetProjectSessionTwo, targetProjectSessionThree]
					: [activeProjectSession],
			),
			newSession: vi.fn(),
			switchSession: vi.fn(async () => ({
				...targetProjectSessionTwo,
				updatedAt: "2026-04-21T09:45:00.000Z",
			})),
		};

		await store.getState().switchSession(bridge, "session-3", "project-2");

		expect(store.getState().projectId).toBe("project-2");
		expect(store.getState().activeSessionId).toBe("session-3");
		expect(store.getState().sessions.map((session) => session.id)).toEqual(["session-2", "session-3", "session-4"]);
		expect(store.getState().sessions[1]?.updatedAt).toBe("2026-04-21T09:45:00.000Z");
		expect(bridge.listSessions).toHaveBeenCalledWith("project-2");
	});

	it("keeps the latest requested session active when rapid switches resolve out of order", async () => {
		const store = createSessionStore();
		const sessionOne = createSession("session-1", "2026-04-21T09:00:00.000Z", "First");
		const sessionTwo = createSession("session-2", "2026-04-21T10:00:00.000Z", "Second");
		const sessionThree = createSession("session-3", "2026-04-21T11:00:00.000Z", "Third");
		const switchTwo = createDeferredPromise<DesktopSessionSummary>();
		const switchThree = createDeferredPromise<DesktopSessionSummary>();
		store.setState({
			...store.getState(),
			sessions: [sessionThree, sessionTwo, sessionOne],
			activeSessionId: "session-1",
		});
		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async () => [sessionThree, sessionTwo, sessionOne]),
			newSession: vi.fn(),
			switchSession: vi.fn(async (sessionId: string) => {
				if (sessionId === "session-2") {
					return switchTwo.promise;
				}
				if (sessionId === "session-3") {
					return switchThree.promise;
				}
				return sessionOne;
			}),
		};

		const firstSwitch = store.getState().switchSession(bridge, "session-2");
		const secondSwitch = store.getState().switchSession(bridge, "session-3");
		switchThree.resolve(sessionThree);
		await secondSwitch;
		switchTwo.resolve(sessionTwo);
		await firstSwitch;

		expect(store.getState().activeSessionId).toBe("session-3");
		expect(store.getState().sessions.map((session) => session.id)).toEqual(["session-3", "session-2", "session-1"]);
		expect(bridge.switchSession).toHaveBeenCalledTimes(2);
	});

	it("deletes sessions and keeps the active selection when deleting inactive rows", async () => {
		const store = createSessionStore();
		const sessionOne = createSession("session-1", "2026-04-21T09:00:00.000Z", "First");
		const sessionTwo = createSession("session-2", "2026-04-21T10:00:00.000Z", "Second");
		store.setState({
			...store.getState(),
			sessions: [sessionTwo, sessionOne],
			activeSessionId: "session-2",
		});
		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async () => [sessionTwo]),
			newSession: vi.fn(),
			switchSession: vi.fn(),
			deleteSession: vi.fn(async () => sessionTwo),
		};

		await store.getState().deleteSession(bridge, "session-1", "project-1");

		expect(bridge.deleteSession).toHaveBeenCalledWith("session-1");
		expect(bridge.listSessions).toHaveBeenCalledWith("project-1");
		expect(store.getState().sessions.map((session) => session.id)).toEqual(["session-2"]);
		expect(store.getState().activeSessionId).toBe("session-2");
		expect(store.getState().isDeleting).toBe(false);
	});

	it("uses the replacement session returned from deletion when deleting the active row", async () => {
		const store = createSessionStore();
		const sessionOne = createSession("session-1", "2026-04-21T09:00:00.000Z", "First");
		const sessionTwo = createSession("session-2", "2026-04-21T10:00:00.000Z", "Second");
		store.setState({
			...store.getState(),
			sessions: [sessionTwo, sessionOne],
			activeSessionId: "session-2",
		});
		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async () => [sessionOne]),
			newSession: vi.fn(),
			switchSession: vi.fn(),
			deleteSession: vi.fn(async () => sessionOne),
		};

		await store.getState().deleteSession(bridge, "session-2", "project-1");

		expect(store.getState().sessions.map((session) => session.id)).toEqual(["session-1"]);
		expect(store.getState().activeSessionId).toBe("session-1");
	});

	it("trusts the deletion replacement over recency fallback for active rows", async () => {
		const store = createSessionStore();
		const sessionTop = createSession("session-top", "2026-04-21T12:00:00.000Z", "Top");
		const sessionNext = createSession("session-next", "2026-04-21T10:00:00.000Z", "Next");
		const sessionNewer = createSession("session-newer", "2026-04-21T11:00:00.000Z", "Newer");
		store.setState({
			...store.getState(),
			sessions: [sessionTop, sessionNext, sessionNewer],
			activeSessionId: "session-top",
		});
		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async () => [sessionNewer, sessionNext]),
			newSession: vi.fn(),
			switchSession: vi.fn(),
			deleteSession: vi.fn(async () => sessionNext),
		};

		await store.getState().deleteSession(bridge, "session-top", "project-1");

		expect(store.getState().sessions.map((session) => session.id)).toEqual(["session-newer", "session-next"]);
		expect(store.getState().activeSessionId).toBe("session-next");
	});

	it("reports a clear error when the current bridge cannot delete sessions", async () => {
		const store = createSessionStore();
		const bridge = {
			getSettings: vi.fn(async () => ({})),
			listSessions: vi.fn(async () => []),
			newSession: vi.fn(),
			switchSession: vi.fn(),
		};

		const result = await store.getState().deleteSession(bridge, "session-1", "project-1");

		expect(result).toBeUndefined();
		expect(store.getState().errorMessage).toBe("当前桌面 bridge 尚未加载删除会话能力，请重启应用窗口后重试。");
		expect(store.getState().isDeleting).toBe(false);
	});

	it("tracks run state from agent events without changing the active session", () => {
		const store = createSessionStore();
		store.setState({
			...store.getState(),
			sessions: [createSession("session-1", "2026-04-21T09:00:00.000Z", "New Session")],
			activeSessionId: "session-2",
		});

		store.getState().applyAgentEvent({ type: "agent_start", sessionId: "session-1" });
		store.getState().applyAgentEvent({
			type: "message_end",
			sessionId: "session-1",
			message: { role: "user", content: "Background prompt", timestamp: 1 },
		});
		store.getState().applyAgentEvent({ type: "agent_end", sessionId: "session-1", messages: [] });

		expect(store.getState().activeSessionId).toBe("session-2");
		expect(store.getState().sessions[0]).toEqual(
			expect.objectContaining({
				id: "session-1",
				title: "New Session",
				messageCount: 1,
				isStreaming: false,
				runStartedAt: undefined,
			}),
		);

		store.getState().applyAgentEvent({
			type: "session_title_update",
			sessionId: "session-1",
			title: "后台任务",
		});
		expect(store.getState().sessions[0]?.title).toBe("后台任务");
	});

	it("patches profile metadata without entering loading state or reordering sessions", () => {
		const store = createSessionStore();
		const sessionOne = createSession("session-1", "2026-04-21T09:00:00.000Z", "First");
		const sessionTwo = createSession("session-2", "2026-04-21T10:00:00.000Z", "Second");
		store.setState({
			...store.getState(),
			sessions: [sessionTwo, sessionOne],
			activeSessionId: "session-1",
		});

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

		store.getState().applyProfileSnapshot(snapshot);

		expect(store.getState().isLoading).toBe(false);
		expect(store.getState().sessions.map((session) => session.id)).toEqual(["session-2", "session-1"]);
		expect(store.getState().sessions[1]).toEqual(
			expect.objectContaining({
				id: "session-1",
				provider: "openai",
				modelId: "gpt-5.4",
				agentMode: "plan",
				updatedAt: "2026-04-21T09:00:00.000Z",
			}),
		);
	});
});
