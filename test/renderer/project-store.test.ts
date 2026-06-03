import { describe, expect, it, vi } from "vitest";
import { createProjectStore } from "../../src/renderer/stores/project-store.ts";
import type { DesktopProjectSummary, DesktopSessionSummary, DesktopWorkspaceOverview } from "../../src/shared/types.ts";

function createProject(id: string, updatedAt: string, name = id): DesktopProjectSummary {
	return {
		id,
		name,
		cwd: `/workspace/${name}`,
		createdAt: updatedAt,
		updatedAt,
		sessionCount: 0,
	};
}

function createSession(id: string, projectName: string): DesktopSessionSummary {
	return {
		id,
		title: id,
		cwd: `/workspace/${projectName}`,
		createdAt: "2026-04-21T09:00:00.000Z",
		updatedAt: "2026-04-21T09:00:00.000Z",
		messageCount: 1,
		agentMode: "execute",
		provider: "anthropic",
		modelId: "claude-sonnet-4-20250514",
	};
}

function createOverview(options: {
	activeProjectId?: string;
	activeSessionId?: string;
	projects: DesktopProjectSummary[];
	sessionsByProjectId?: Record<string, DesktopSessionSummary[]>;
}): DesktopWorkspaceOverview {
	return {
		settings: {
			lastOpenedProjectId: options.activeProjectId,
			lastOpenedSessionId: options.activeSessionId,
		},
		projects: options.projects,
		sessionsByProjectId: options.sessionsByProjectId ?? {},
		activeProjectId: options.activeProjectId,
		activeSessionId: options.activeSessionId,
	};
}

describe("projectStore", () => {
	it("loads projects sorted by recency and activates the last opened project", async () => {
		const store = createProjectStore();
		const projectOne = createProject("project-1", "2026-04-21T09:00:00.000Z", "one");
		const projectTwo = createProject("project-2", "2026-04-21T08:00:00.000Z", "two");
		const projectThree = createProject("project-3", "2026-04-21T11:00:00.000Z", "three");
		const bridge = {
			getWorkspaceOverview: vi.fn(async () =>
				createOverview({
					activeProjectId: "project-2",
					activeSessionId: "session-2",
					projects: [projectOne, { ...projectTwo, lastOpenedSessionId: "session-2" }, projectThree],
					sessionsByProjectId: {
						"project-2": [createSession("session-2", "two")],
					},
				}),
			),
			listProjects: vi.fn(),
			listSessions: vi.fn(async (projectId?: string) =>
				projectId === "project-2" ? [createSession("session-2", "two")] : [],
			),
			createProjectFromFolder: vi.fn(),
			switchProject: vi.fn(async () => ({ ...projectTwo, lastOpenedSessionId: "session-2" })),
		};

		await store.getState().loadProjects(bridge);

		const state = store.getState();
		expect(state.projects.map((project) => project.id)).toEqual(["project-3", "project-1", "project-2"]);
		expect(state.activeProjectId).toBe("project-2");
		expect(state.projects[2]?.lastOpenedSessionId).toBe("session-2");
		expect(state.sessionsByProjectId["project-2"]?.map((session) => session.id)).toEqual(["session-2"]);
		expect(bridge.getWorkspaceOverview).toHaveBeenCalledTimes(1);
		expect(bridge.switchProject).not.toHaveBeenCalled();
	});

	it("creates a project from a folder and marks it active", async () => {
		const store = createProjectStore();
		const existingProject = createProject("project-1", "2026-04-21T09:00:00.000Z", "one");
		const createdProject = createProject("project-2", "2026-04-21T12:00:00.000Z", "two");
		const bridge = {
			getWorkspaceOverview: vi.fn(),
			listProjects: vi.fn(async () => [existingProject, createdProject]),
			listSessions: vi.fn(async (projectId?: string) =>
				projectId === "project-2" ? [createSession("session-2", "two")] : [],
			),
			createProjectFromFolder: vi.fn(async () => createdProject),
			switchProject: vi.fn(),
		};

		const project = await store.getState().createProjectFromFolder(bridge);

		expect(project?.id).toBe("project-2");
		expect(store.getState().activeProjectId).toBe("project-2");
		expect(store.getState().projects.map((entry) => entry.id)).toEqual(["project-2", "project-1"]);
		expect(store.getState().sessionsByProjectId["project-2"]?.map((session) => session.id)).toEqual(["session-2"]);
	});

	it("switches projects without re-invoking the bridge for the active project", async () => {
		const store = createProjectStore();
		const projectOne = createProject("project-1", "2026-04-21T09:00:00.000Z", "one");
		const projectTwo = createProject("project-2", "2026-04-21T10:00:00.000Z", "two");
		store.setState({
			...store.getState(),
			projects: [projectOne, projectTwo],
			sessionsByProjectId: {
				"project-1": [createSession("session-1", "one")],
			},
			activeProjectId: "project-1",
		});

		const bridge = {
			getWorkspaceOverview: vi.fn(),
			listProjects: vi.fn(async () => [projectTwo, projectOne]),
			listSessions: vi.fn(async (projectId?: string) =>
				projectId === "project-2" ? [createSession("session-2", "two")] : [],
			),
			createProjectFromFolder: vi.fn(),
			switchProject: vi.fn(async () => projectTwo),
		};

		await store.getState().switchProject(bridge, "project-2");
		const currentProject = await store.getState().switchProject(bridge, "project-2");

		expect(store.getState().activeProjectId).toBe("project-2");
		expect(store.getState().projects.map((project) => project.id)).toEqual(["project-1", "project-2"]);
		expect(store.getState().sessionsByProjectId["project-1"]?.map((session) => session.id)).toEqual(["session-1"]);
		expect(store.getState().sessionsByProjectId["project-2"]?.map((session) => session.id)).toEqual(["session-2"]);
		expect(currentProject?.id).toBe("project-2");
		expect(bridge.switchProject).toHaveBeenCalledTimes(1);
		expect(bridge.listSessions).toHaveBeenCalledTimes(1);
		expect(bridge.listSessions).toHaveBeenCalledWith("project-2");
	});

	it("preserves the visible project order when refreshed project metadata changes", async () => {
		const store = createProjectStore();
		const projectOne = createProject("project-1", "2026-04-21T09:00:00.000Z", "one");
		const projectTwo = createProject("project-2", "2026-04-21T10:00:00.000Z", "two");
		const refreshedProjectOne = {
			...projectOne,
			updatedAt: "2026-04-21T12:00:00.000Z",
			sessionCount: 0,
		};
		const refreshedProjectTwo = {
			...projectTwo,
			sessionCount: 1,
		};
		const bridge = {
			getWorkspaceOverview: vi
				.fn()
				.mockResolvedValueOnce(
					createOverview({
						activeProjectId: "project-2",
						projects: [projectOne, refreshedProjectTwo],
						sessionsByProjectId: {
							"project-2": [createSession("session-2", "two")],
						},
					}),
				)
				.mockResolvedValueOnce(
					createOverview({
						activeProjectId: "project-2",
						projects: [refreshedProjectOne, refreshedProjectTwo],
						sessionsByProjectId: {
							"project-2": [createSession("session-2", "two")],
						},
					}),
				),
			listProjects: vi.fn(),
			listSessions: vi.fn(async (projectId?: string) =>
				projectId === "project-2" ? [createSession("session-2", "two")] : [],
			),
			createProjectFromFolder: vi.fn(),
			switchProject: vi.fn(async () => refreshedProjectTwo),
		};

		await store.getState().loadProjects(bridge);
		expect(store.getState().projects.map((project) => project.id)).toEqual(["project-2", "project-1"]);

		await store.getState().loadProjects(bridge);

		expect(store.getState().projects.map((project) => project.id)).toEqual(["project-2", "project-1"]);
		expect(store.getState().projects[1]?.updatedAt).toBe("2026-04-21T12:00:00.000Z");
		expect(store.getState().projects[0]?.sessionCount).toBe(1);
	});

	it("keeps created running sessions cached under their project while another project is active", async () => {
		const store = createProjectStore();
		const projectOne = createProject("project-1", "2026-04-21T09:00:00.000Z", "one");
		const projectTwo = createProject("project-2", "2026-04-21T10:00:00.000Z", "two");
		const existingSession = createSession("session-1", "one");
		const createdSession = {
			...createSession("session-created", "one"),
			createdAt: "2026-04-21T10:00:00.000Z",
			messageCount: 0,
			updatedAt: "2026-04-21T10:00:00.000Z",
		};
		const otherProjectSession = createSession("session-2", "two");
		store.setState({
			...store.getState(),
			projects: [projectOne, projectTwo],
			sessionsByProjectId: {
				"project-1": [existingSession],
				"project-2": [otherProjectSession],
			},
			activeProjectId: "project-1",
		});
		const bridge = {
			getWorkspaceOverview: vi.fn(),
			listProjects: vi.fn(async () => [projectTwo, projectOne]),
			listSessions: vi.fn(async (projectId?: string) =>
				projectId === "project-2" ? [otherProjectSession] : [createdSession, existingSession],
			),
			createProjectFromFolder: vi.fn(),
			switchProject: vi.fn(async () => projectTwo),
		};

		store.getState().upsertProjectSession("project-1", createdSession);
		store.getState().applyAgentEvent({ type: "agent_start", sessionId: createdSession.id });
		store.getState().applyAgentEvent({
			type: "message_end",
			sessionId: createdSession.id,
			message: { role: "user", content: "Background prompt", timestamp: 1 },
		});
		await store.getState().switchProject(bridge, "project-2");

		expect(store.getState().activeProjectId).toBe("project-2");
		expect(store.getState().sessionsByProjectId["project-1"]).toEqual([
			expect.objectContaining({
				id: "session-created",
				isStreaming: true,
				messageCount: 1,
				title: "Background prompt",
			}),
			existingSession,
		]);
		expect(store.getState().sessionsByProjectId["project-2"]).toEqual([otherProjectSession]);
	});
});
