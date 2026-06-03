import type { DesktopProjectSummary, DesktopSessionSummary } from "../../shared/types.ts";

export type MainWorkbenchView = "chat" | "settings" | "capabilities" | "events";

export interface MainWorkbenchScopeInput {
	projectId?: string;
	sessionId?: string;
}

export interface DeriveMainWorkbenchCoordinationInput {
	activeAgentSessionId?: string;
	activeProject?: DesktopProjectSummary;
	activeProjectId?: string;
	activeView: MainWorkbenchView;
	cwd?: string;
	hiddenWorkspacePanelKeys: ReadonlySet<string>;
	optimisticActiveSession?: DesktopSessionSummary;
	reviewFullscreenKeys: ReadonlySet<string>;
	reviewOpenKeys: ReadonlySet<string>;
	sessions: DesktopSessionSummary[];
	sessionsActiveSessionId?: string;
	sessionsIsLoading: boolean;
	workspaceStatusAvailable: boolean;
}

export interface MainWorkbenchCoordination {
	activeSession?: DesktopSessionSummary;
	displayedActiveSession?: DesktopSessionSummary;
	displayedActiveSessionId?: string;
	hasEmptyActiveProject: boolean;
	isActiveNewConversation: boolean;
	isCapabilitiesView: boolean;
	isChatView: boolean;
	isEventsView: boolean;
	isReviewFullscreen: boolean;
	isReviewFullscreenActive: boolean;
	isReviewOpen: boolean;
	isWorkspacePanelAvailable: boolean;
	isWorkspacePanelOpen: boolean;
	reviewWorkspaceKey?: string;
	selectedPrimaryItem?: "capabilities" | "events";
	sessionMeta?: string;
	sessionTitle: string;
	terminalCwd?: string;
	workspaceLabel: string;
	workspacePanelKey?: string;
}

export function resolveInitialMainWorkbenchView(search: string | undefined): MainWorkbenchView {
	if (!search) {
		return "chat";
	}
	const view = new URLSearchParams(search).get("view");
	if (view === "settings" || view === "events") {
		return view;
	}
	return "chat";
}

export function getWorkbenchViewClass(isActive: boolean): string {
	const stateClass = isActive ? "visible z-10 opacity-100" : "invisible z-0 pointer-events-none opacity-0";
	return `absolute inset-0 h-full min-h-0 ${stateClass}`;
}

export function getMainWorkbenchScopeKey({ sessionId, projectId }: MainWorkbenchScopeInput): string | undefined {
	if (sessionId) {
		return `session:${sessionId}`;
	}
	if (projectId) {
		return `project:${projectId}`;
	}
	return undefined;
}

export function resolveSidebarSessionsByProjectId(
	sessionsByProjectId: Record<string, DesktopSessionSummary[]>,
	activeProjectId: string | undefined,
	activeSessionsProjectId: string | undefined,
	activeSessions: DesktopSessionSummary[],
): Record<string, DesktopSessionSummary[]> {
	if (!activeProjectId || activeSessionsProjectId !== activeProjectId) {
		return sessionsByProjectId;
	}

	const projectSessions = sessionsByProjectId[activeProjectId] ?? [];
	const projectSessionById = new Map(projectSessions.map((session) => [session.id, session]));
	const activeSessionIds = new Set(activeSessions.map((session) => session.id));
	const mergedSessions = [
		...activeSessions.map((session) => ({
			...session,
			...projectSessionById.get(session.id),
		})),
		...projectSessions.filter((session) => !activeSessionIds.has(session.id)),
	];

	return {
		...sessionsByProjectId,
		[activeProjectId]: mergedSessions,
	};
}

export function deriveMainWorkbenchCoordination(
	input: DeriveMainWorkbenchCoordinationInput,
): MainWorkbenchCoordination {
	const activeSession = input.sessions.find((session) => session.id === input.sessionsActiveSessionId);
	const displayedActiveSession = input.activeView === "chat" ? input.optimisticActiveSession : activeSession;
	const hasEmptyActiveProject =
		Boolean(input.activeProjectId) && !input.sessionsIsLoading && input.sessions.length === 0;
	const sessionTitle = displayedActiveSession
		? displayedActiveSession.messageCount
			? displayedActiveSession.title
			: "New session"
		: (input.activeProject?.name ?? "Workspace");
	const sessionMeta = displayedActiveSession
		? [displayedActiveSession.provider, displayedActiveSession.modelId].filter(Boolean).join(" / ") || undefined
		: hasEmptyActiveProject
			? "暂无对话"
			: undefined;
	const workspaceLabel =
		displayedActiveSession?.cwd || input.activeProject?.cwd || input.cwd || "Workspace unavailable";
	const terminalCwd = input.activeProject?.cwd || input.cwd || activeSession?.cwd;
	const reviewWorkspaceKey = getMainWorkbenchScopeKey({
		sessionId: input.sessionsActiveSessionId,
		projectId: input.activeProjectId,
	});
	const isReviewOpen = Boolean(reviewWorkspaceKey && input.reviewOpenKeys.has(reviewWorkspaceKey));
	const isReviewFullscreen = Boolean(reviewWorkspaceKey && input.reviewFullscreenKeys.has(reviewWorkspaceKey));
	const workspacePanelKey = getMainWorkbenchScopeKey({
		sessionId: input.activeAgentSessionId ?? input.sessionsActiveSessionId,
		projectId: input.activeProjectId,
	});
	const isWorkspacePanelAvailable = !hasEmptyActiveProject && input.workspaceStatusAvailable;
	const isCapabilitiesView = input.activeView === "capabilities";
	const isEventsView = input.activeView === "events";

	return {
		activeSession,
		displayedActiveSession,
		displayedActiveSessionId: displayedActiveSession?.id ?? input.sessionsActiveSessionId,
		hasEmptyActiveProject,
		isActiveNewConversation: activeSession?.messageCount === 0 && activeSession.isStreaming !== true,
		isCapabilitiesView,
		isChatView: input.activeView === "chat",
		isEventsView,
		isReviewFullscreen,
		isReviewFullscreenActive: isReviewOpen && isReviewFullscreen,
		isReviewOpen,
		isWorkspacePanelAvailable,
		isWorkspacePanelOpen: Boolean(
			workspacePanelKey && isWorkspacePanelAvailable && !input.hiddenWorkspacePanelKeys.has(workspacePanelKey),
		),
		reviewWorkspaceKey,
		selectedPrimaryItem: isCapabilitiesView ? "capabilities" : isEventsView ? "events" : undefined,
		sessionMeta,
		sessionTitle,
		terminalCwd,
		workspaceLabel,
		workspacePanelKey,
	};
}
