import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { DesktopAgentBridge } from "../../shared/ipc-contract.ts";
import type { DesktopAgentSnapshot, SerializedAgentEvent } from "../../shared/serialized-agent-event.ts";
import type { DesktopSessionSummary, DesktopWorkspaceOverview } from "../../shared/types.ts";
import {
	updateSessionSummariesForAgentEvent,
	updateSessionSummariesForProfileSnapshot,
} from "../lib/conversation-timeline-projection.ts";

export type SessionStoreBridge = Pick<
	DesktopAgentBridge,
	"getSettings" | "listSessions" | "newSession" | "switchSession"
>;
export type SessionDeletionBridge = SessionStoreBridge & Partial<Pick<DesktopAgentBridge, "deleteSession">>;

function formatTimestamp(value: string): number {
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortSessionsByRecency(sessions: DesktopSessionSummary[]): DesktopSessionSummary[] {
	return [...sessions].sort((left, right) => {
		const updatedDelta = formatTimestamp(right.updatedAt) - formatTimestamp(left.updatedAt);
		if (updatedDelta !== 0) {
			return updatedDelta;
		}

		return formatTimestamp(right.createdAt) - formatTimestamp(left.createdAt);
	});
}

export function replaceSessionSummary(
	sessions: DesktopSessionSummary[],
	nextSession: DesktopSessionSummary,
): DesktopSessionSummary[] {
	const sessionIndex = sessions.findIndex((session) => session.id === nextSession.id);
	if (sessionIndex === -1) {
		return [...sessions, nextSession];
	}

	const nextSessions = sessions.slice();
	nextSessions[sessionIndex] = {
		...sessions[sessionIndex],
		...nextSession,
	};
	return nextSessions;
}

function mergeSessionSummariesPreservingOrder(
	currentSessions: DesktopSessionSummary[],
	latestSessions: DesktopSessionSummary[],
): DesktopSessionSummary[] {
	const latestSessionMap = new Map(latestSessions.map((session) => [session.id, session]));
	const mergedSessions = currentSessions.map((session) => {
		const latestSession = latestSessionMap.get(session.id);
		return latestSession ? { ...session, ...latestSession } : session;
	});

	for (const latestSession of latestSessions) {
		if (!mergedSessions.some((session) => session.id === latestSession.id)) {
			mergedSessions.push(latestSession);
		}
	}

	return mergedSessions;
}

function resolveActiveSessionId(
	sessions: DesktopSessionSummary[],
	preferredSessionId?: string,
	currentActiveSessionId?: string,
): string | undefined {
	if (currentActiveSessionId && sessions.some((session) => session.id === currentActiveSessionId)) {
		return currentActiveSessionId;
	}

	if (preferredSessionId && sessions.some((session) => session.id === preferredSessionId)) {
		return preferredSessionId;
	}

	return sessions[0]?.id;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface SessionStoreState {
	sessions: DesktopSessionSummary[];
	projectId?: string;
	activeSessionId?: string;
	hasLoadedProjectSessions: boolean;
	isLoading: boolean;
	isCreating: boolean;
	isSwitching: boolean;
	isDeleting: boolean;
	errorMessage?: string;
	loadSessions: (bridge: SessionStoreBridge, projectId?: string, preferredSessionId?: string) => Promise<void>;
	applyWorkspaceOverview: (overview: DesktopWorkspaceOverview) => void;
	createSession: (bridge: SessionStoreBridge, projectId?: string) => Promise<DesktopSessionSummary | undefined>;
	switchSession: (
		bridge: SessionStoreBridge,
		sessionId: string,
		projectId?: string,
	) => Promise<DesktopSessionSummary | undefined>;
	deleteSession: (
		bridge: SessionDeletionBridge,
		sessionId: string,
		projectId?: string,
	) => Promise<DesktopSessionSummary | undefined>;
	applyAgentEvent: (event: SerializedAgentEvent) => void;
	applyProfileSnapshot: (snapshot: DesktopAgentSnapshot) => void;
}

export function createSessionStore() {
	let latestSessionRequestId = 0;
	const createSessionRequestId = () => {
		latestSessionRequestId += 1;
		return latestSessionRequestId;
	};
	const isLatestSessionRequest = (requestId: number) => requestId === latestSessionRequestId;

	return createStore<SessionStoreState>()((set, get) => ({
		sessions: [],
		projectId: undefined,
		activeSessionId: undefined,
		hasLoadedProjectSessions: false,
		isLoading: false,
		isCreating: false,
		isSwitching: false,
		isDeleting: false,
		errorMessage: undefined,
		applyWorkspaceOverview: (overview) => {
			const activeSessions = overview.activeProjectId
				? (overview.sessionsByProjectId[overview.activeProjectId] ?? [])
				: [];
			set((state) => ({
				...state,
				sessions: sortSessionsByRecency(activeSessions),
				projectId: overview.activeProjectId,
				activeSessionId: resolveActiveSessionId(activeSessions, overview.activeSessionId),
				hasLoadedProjectSessions: true,
				isLoading: false,
				errorMessage: undefined,
			}));
		},
		loadSessions: async (bridge, projectId, preferredSessionId) => {
			const requestId = createSessionRequestId();
			set((state) => ({ ...state, isLoading: true, errorMessage: undefined }));

			try {
				const settings = await bridge.getSettings();
				const sessions = sortSessionsByRecency(await bridge.listSessions(projectId));
				if (!isLatestSessionRequest(requestId)) {
					return;
				}
				const currentState = get();
				const activeSessionId = resolveActiveSessionId(
					sessions,
					preferredSessionId ?? settings.lastOpenedSessionId,
					currentState.projectId === projectId ? currentState.activeSessionId : undefined,
				);

				set((state) => ({
					...state,
					sessions,
					projectId,
					activeSessionId,
					hasLoadedProjectSessions: true,
					isLoading: false,
				}));
			} catch (error: unknown) {
				if (!isLatestSessionRequest(requestId)) {
					return;
				}
				set((state) => ({
					...state,
					isLoading: false,
					hasLoadedProjectSessions: false,
					errorMessage: getErrorMessage(error),
				}));
			}
		},
		createSession: async (bridge, projectId) => {
			const requestId = createSessionRequestId();
			set((state) => ({ ...state, isCreating: true, errorMessage: undefined }));

			try {
				const createdSession = await bridge.newSession(projectId);
				if (!isLatestSessionRequest(requestId)) {
					return undefined;
				}
				if (!createdSession) {
					set((state) => ({ ...state, isCreating: false }));
					return undefined;
				}

				const sessions = sortSessionsByRecency(await bridge.listSessions(projectId));
				if (!isLatestSessionRequest(requestId)) {
					return undefined;
				}
				set((state) => ({
					...state,
					sessions,
					projectId,
					activeSessionId: createdSession.id,
					hasLoadedProjectSessions: true,
					isCreating: false,
				}));
				return createdSession;
			} catch (error: unknown) {
				if (!isLatestSessionRequest(requestId)) {
					return undefined;
				}
				set((state) => ({
					...state,
					isCreating: false,
					errorMessage: getErrorMessage(error),
				}));
				return undefined;
			}
		},
		switchSession: async (bridge, sessionId, projectId) => {
			if (sessionId === get().activeSessionId) {
				return get().sessions.find((session) => session.id === sessionId);
			}

			const targetProjectId = projectId ?? get().projectId;
			const requestId = createSessionRequestId();
			set((state) => ({ ...state, isSwitching: true, errorMessage: undefined }));

			try {
				const switchedSession = await bridge.switchSession(sessionId);
				if (!isLatestSessionRequest(requestId)) {
					return undefined;
				}
				if (!switchedSession) {
					set((state) => ({ ...state, isSwitching: false }));
					return undefined;
				}

				const latestSessions = await bridge.listSessions(targetProjectId);
				if (!isLatestSessionRequest(requestId)) {
					return undefined;
				}
				const latestSessionsWithSwitchedSession = replaceSessionSummary(latestSessions, switchedSession);

				set((state) => ({
					...state,
					sessions: mergeSessionSummariesPreservingOrder(
						state.projectId === targetProjectId
							? replaceSessionSummary(state.sessions, switchedSession)
							: latestSessionsWithSwitchedSession,
						latestSessionsWithSwitchedSession,
					),
					projectId: targetProjectId,
					activeSessionId: switchedSession.id,
					hasLoadedProjectSessions: true,
					isSwitching: false,
				}));
				return switchedSession;
			} catch (error: unknown) {
				if (!isLatestSessionRequest(requestId)) {
					return undefined;
				}
				set((state) => ({
					...state,
					isSwitching: false,
					errorMessage: getErrorMessage(error),
				}));
				return undefined;
			}
		},
		deleteSession: async (bridge, sessionId, projectId) => {
			const requestId = createSessionRequestId();
			set((state) => ({ ...state, isDeleting: true, errorMessage: undefined }));

			try {
				if (!bridge.deleteSession) {
					throw new Error("当前桌面 bridge 尚未加载删除会话能力，请重启应用窗口后重试。");
				}

				const currentActiveSessionId = get().activeSessionId;
				const replacementSession = await bridge.deleteSession(sessionId);
				if (!isLatestSessionRequest(requestId)) {
					return undefined;
				}
				const latestSessions = sortSessionsByRecency(await bridge.listSessions(projectId));
				if (!isLatestSessionRequest(requestId)) {
					return undefined;
				}
				const activeSessionId =
					sessionId === currentActiveSessionId
						? resolveActiveSessionId(latestSessions, replacementSession?.id)
						: resolveActiveSessionId(latestSessions, currentActiveSessionId, currentActiveSessionId);

				set((state) => ({
					...state,
					sessions: latestSessions,
					projectId,
					activeSessionId,
					hasLoadedProjectSessions: true,
					isDeleting: false,
				}));

				return activeSessionId ? latestSessions.find((session) => session.id === activeSessionId) : undefined;
			} catch (error: unknown) {
				if (!isLatestSessionRequest(requestId)) {
					return undefined;
				}
				set((state) => ({
					...state,
					isDeleting: false,
					errorMessage: getErrorMessage(error),
				}));
				return undefined;
			}
		},
		applyAgentEvent: (event) => {
			set((state) => ({
				...state,
				sessions: updateSessionSummariesForAgentEvent(state.sessions, event),
			}));
		},
		applyProfileSnapshot: (snapshot) => {
			set((state) => ({
				...state,
				sessions: updateSessionSummariesForProfileSnapshot(state.sessions, snapshot),
			}));
		},
	}));
}

export const sessionStore = createSessionStore();

export function useSessionStore<T>(selector: (state: SessionStoreState) => T): T {
	return useStore(sessionStore, selector);
}
