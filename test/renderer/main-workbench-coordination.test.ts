import { describe, expect, it } from "vitest";
import {
	deriveMainWorkbenchCoordination,
	getMainWorkbenchScopeKey,
	getWorkbenchViewClass,
	resolveInitialMainWorkbenchView,
	resolveSidebarSessionsByProjectId,
} from "../../src/renderer/lib/main-workbench-coordination.ts";
import type { DesktopProjectSummary, DesktopSessionSummary } from "../../src/shared/types.ts";

const project = {
	id: "project-1",
	name: "Pi Mono",
	cwd: "/workspace/pi-mono",
	createdAt: "2026-05-30T10:00:00.000Z",
	updatedAt: "2026-05-30T11:00:00.000Z",
	sessionCount: 1,
	lastOpenedSessionId: "session-1",
} satisfies DesktopProjectSummary;

const activeSession = {
	id: "session-1",
	title: "Runtime policy",
	cwd: "/workspace/pi-mono",
	createdAt: "2026-05-30T10:05:00.000Z",
	updatedAt: "2026-05-30T10:30:00.000Z",
	messageCount: 4,
	agentMode: "execute",
	provider: "openai",
	modelId: "gpt-test",
} satisfies DesktopSessionSummary;

const optimisticSession = {
	...activeSession,
	id: "session-optimistic",
	title: "Optimistic session",
	cwd: "/workspace/other",
	messageCount: 0,
	provider: undefined,
	modelId: undefined,
} satisfies DesktopSessionSummary;

describe("main workbench coordination", () => {
	it("resolves the initial Main Workbench view from URL search", () => {
		expect(resolveInitialMainWorkbenchView("?view=settings")).toBe("settings");
		expect(resolveInitialMainWorkbenchView("?view=events")).toBe("events");
		expect(resolveInitialMainWorkbenchView("?view=chat")).toBe("chat");
		expect(resolveInitialMainWorkbenchView("?view=capabilities")).toBe("chat");
		expect(resolveInitialMainWorkbenchView(undefined)).toBe("chat");
	});

	it("keeps retained inactive Workbench views below the active view", () => {
		expect(getWorkbenchViewClass(true)).toBe("absolute inset-0 h-full min-h-0 visible z-10 opacity-100");
		expect(getWorkbenchViewClass(false)).toBe(
			"absolute inset-0 h-full min-h-0 invisible z-0 pointer-events-none opacity-0",
		);
	});

	it("resolves Main Workbench scope keys from session before project", () => {
		expect(getMainWorkbenchScopeKey({ sessionId: "session-1", projectId: "project-1" })).toBe("session:session-1");
		expect(getMainWorkbenchScopeKey({ projectId: "project-1" })).toBe("project:project-1");
		expect(getMainWorkbenchScopeKey({})).toBeUndefined();
	});

	it("merges active project sessions into Sidebar sessions without leaking across projects", () => {
		const existingSession = {
			...activeSession,
			id: "session-existing",
			title: "Existing",
		} satisfies DesktopSessionSummary;
		const merged = resolveSidebarSessionsByProjectId(
			{
				"project-1": [{ ...activeSession, title: "Cached title" }, existingSession],
				"project-2": [],
			},
			"project-1",
			"project-1",
			[activeSession],
		);

		expect(merged["project-1"]).toEqual([{ ...activeSession, title: "Cached title" }, existingSession]);
		expect(merged["project-2"]).toEqual([]);
		expect(
			resolveSidebarSessionsByProjectId(
				{
					"project-1": [activeSession],
					"project-2": [],
				},
				"project-2",
				"project-1",
				[activeSession],
			)["project-2"],
		).toEqual([]);
	});

	it("derives active view, session labels, Utility Panel keys, and Workspace Panel visibility", () => {
		const coordination = deriveMainWorkbenchCoordination({
			activeAgentSessionId: "agent-session",
			activeProject: project,
			activeProjectId: project.id,
			activeView: "chat",
			cwd: "/fallback/cwd",
			hiddenWorkspacePanelKeys: new Set(["project:other"]),
			optimisticActiveSession: optimisticSession,
			reviewFullscreenKeys: new Set(["session:session-1"]),
			reviewOpenKeys: new Set(["session:session-1"]),
			sessions: [activeSession],
			sessionsActiveSessionId: activeSession.id,
			sessionsIsLoading: false,
			workspaceStatusAvailable: true,
		});

		expect(coordination.isChatView).toBe(true);
		expect(coordination.isCapabilitiesView).toBe(false);
		expect(coordination.displayedActiveSession).toEqual(optimisticSession);
		expect(coordination.displayedActiveSessionId).toBe(optimisticSession.id);
		expect(coordination.sessionTitle).toBe("New session");
		expect(coordination.sessionMeta).toBeUndefined();
		expect(coordination.workspaceLabel).toBe(optimisticSession.cwd);
		expect(coordination.terminalCwd).toBe(project.cwd);
		expect(coordination.reviewWorkspaceKey).toBe("session:session-1");
		expect(coordination.isReviewOpen).toBe(true);
		expect(coordination.isReviewFullscreenActive).toBe(true);
		expect(coordination.workspacePanelKey).toBe("session:agent-session");
		expect(coordination.isWorkspacePanelOpen).toBe(true);
		expect(coordination.selectedPrimaryItem).toBeUndefined();
	});

	it("derives empty project and inactive view state without opening the Workspace Panel", () => {
		const coordination = deriveMainWorkbenchCoordination({
			activeProject: project,
			activeProjectId: project.id,
			activeView: "events",
			cwd: undefined,
			hiddenWorkspacePanelKeys: new Set(),
			optimisticActiveSession: optimisticSession,
			reviewFullscreenKeys: new Set(),
			reviewOpenKeys: new Set(),
			sessions: [],
			sessionsActiveSessionId: undefined,
			sessionsIsLoading: false,
			workspaceStatusAvailable: true,
		});

		expect(coordination.isEventsView).toBe(true);
		expect(coordination.displayedActiveSession).toBeUndefined();
		expect(coordination.displayedActiveSessionId).toBeUndefined();
		expect(coordination.hasEmptyActiveProject).toBe(true);
		expect(coordination.sessionTitle).toBe(project.name);
		expect(coordination.sessionMeta).toBe("暂无对话");
		expect(coordination.workspaceLabel).toBe(project.cwd);
		expect(coordination.terminalCwd).toBe(project.cwd);
		expect(coordination.reviewWorkspaceKey).toBe("project:project-1");
		expect(coordination.isReviewOpen).toBe(false);
		expect(coordination.workspacePanelKey).toBe("project:project-1");
		expect(coordination.isWorkspacePanelAvailable).toBe(false);
		expect(coordination.isWorkspacePanelOpen).toBe(false);
		expect(coordination.selectedPrimaryItem).toBe("events");
	});
});
