import { useCallback, useEffect } from "react";
import type { DesktopSessionSummary } from "../../shared/types.ts";
import type { SessionDeletionBridge } from "../stores/session-store.ts";
import { useSessionStore } from "../stores/session-store.ts";

export interface UseSessionsOptions {
	bridge?: SessionDeletionBridge;
	enabled?: boolean;
	onSessionActivated?: () => Promise<void>;
	preferredSessionId?: string;
	projectId?: string;
}

export interface UseSessionsResult {
	sessions: DesktopSessionSummary[];
	projectId?: string;
	activeSessionId?: string;
	isLoading: boolean;
	isCreating: boolean;
	isSwitching: boolean;
	isDeleting: boolean;
	errorMessage?: string;
	createSession: (projectId?: string) => Promise<DesktopSessionSummary | undefined>;
	deleteSession: (sessionId: string, projectId?: string) => Promise<void>;
	refreshSessions: () => Promise<void>;
	switchSession: (sessionId: string, projectId?: string) => Promise<void>;
}

export function useSessions(options: UseSessionsOptions = {}): UseSessionsResult {
	const bridge = options.bridge ?? window.desktopAgent;
	const enabled = options.enabled ?? true;
	const onSessionActivated = options.onSessionActivated;
	const preferredSessionId = options.preferredSessionId;
	const projectId = options.projectId;
	const activeSessionId = useSessionStore((state) => state.activeSessionId);
	const createSession = useSessionStore((state) => state.createSession);
	const deleteSession = useSessionStore((state) => state.deleteSession);
	const errorMessage = useSessionStore((state) => state.errorMessage);
	const isCreating = useSessionStore((state) => state.isCreating);
	const isDeleting = useSessionStore((state) => state.isDeleting);
	const hasLoadedProjectSessions = useSessionStore((state) => state.hasLoadedProjectSessions);
	const isLoading = useSessionStore((state) => state.isLoading);
	const isSwitching = useSessionStore((state) => state.isSwitching);
	const loadSessions = useSessionStore((state) => state.loadSessions);
	const sessionsProjectId = useSessionStore((state) => state.projectId);
	const sessions = useSessionStore((state) => state.sessions);
	const switchSession = useSessionStore((state) => state.switchSession);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		if (hasLoadedProjectSessions && sessionsProjectId === projectId) {
			return;
		}

		void loadSessions(bridge, projectId, preferredSessionId).then(async () => {
			await onSessionActivated?.();
		});
	}, [
		bridge,
		enabled,
		hasLoadedProjectSessions,
		loadSessions,
		onSessionActivated,
		preferredSessionId,
		projectId,
		sessionsProjectId,
	]);

	const handleCreateSession = useCallback(
		async (targetProjectId?: string) => {
			const session = await createSession(bridge, targetProjectId ?? projectId);
			if (session) {
				await onSessionActivated?.();
			}
			return session;
		},
		[bridge, createSession, onSessionActivated, projectId],
	);

	const handleDeleteSession = useCallback(
		async (sessionId: string, targetProjectId?: string) => {
			const session = await deleteSession(bridge, sessionId, targetProjectId ?? projectId);
			if (session) {
				await onSessionActivated?.();
			}
		},
		[bridge, deleteSession, onSessionActivated, projectId],
	);

	const refreshSessions = useCallback(async () => {
		await loadSessions(bridge, projectId, preferredSessionId);
	}, [bridge, loadSessions, preferredSessionId, projectId]);

	const handleSwitchSession = useCallback(
		async (sessionId: string, targetProjectId?: string) => {
			const session = await switchSession(bridge, sessionId, targetProjectId ?? projectId);
			if (session) {
				await onSessionActivated?.();
			}
		},
		[bridge, onSessionActivated, projectId, switchSession],
	);

	return {
		sessions,
		projectId: sessionsProjectId,
		activeSessionId,
		isLoading,
		isCreating,
		isSwitching,
		isDeleting,
		errorMessage,
		createSession: handleCreateSession,
		deleteSession: handleDeleteSession,
		refreshSessions,
		switchSession: handleSwitchSession,
	};
}
