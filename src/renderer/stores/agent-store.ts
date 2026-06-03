import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { DesktopAgentSnapshot, SerializedAgentEvent } from "../../shared/serialized-agent-event.ts";
import {
	type AgentRendererState,
	createAgentRendererState,
	INITIAL_AGENT_RENDERER_STATE,
	reduceAgentEvent,
} from "../lib/conversation-timeline-projection.ts";

export interface AgentStoreState extends AgentRendererState {
	activeSessionId?: string;
	pendingActiveSessionId?: string;
	sessionStates: Record<string, AgentRendererState>;
	sessionStateAccessedAt: Record<string, number>;
	setActiveSession: (sessionId?: string) => void;
	hydrateSnapshot: (snapshot: DesktopAgentSnapshot) => void;
	applyEvent: (event: SerializedAgentEvent) => void;
	setBridgeError: (message: string) => void;
}

const MAX_SESSION_STATE_CACHE_ENTRIES = 8;
const SESSION_STATE_CACHE_TTL_MS = 30 * 60 * 1000;

function getInitialAgentRendererState(): AgentRendererState {
	return {
		...INITIAL_AGENT_RENDERER_STATE,
		consumedProposedPlanMessageIds: [...INITIAL_AGENT_RENDERER_STATE.consumedProposedPlanMessageIds],
		diagnostics: [...INITIAL_AGENT_RENDERER_STATE.diagnostics],
		availableTools: [...INITIAL_AGENT_RENDERER_STATE.availableTools],
		contextMessages: [...INITIAL_AGENT_RENDERER_STATE.contextMessages],
		messages: [...INITIAL_AGENT_RENDERER_STATE.messages],
		pendingToolCalls: [...INITIAL_AGENT_RENDERER_STATE.pendingToolCalls],
		toolCalls: [...INITIAL_AGENT_RENDERER_STATE.toolCalls],
	};
}

function getSessionState(
	sessionStates: Record<string, AgentRendererState>,
	sessionId: string | undefined,
): AgentRendererState {
	if (!sessionId) {
		return getInitialAgentRendererState();
	}

	return sessionStates[sessionId] ?? getInitialAgentRendererState();
}

function shouldRetainInactiveSessionState(sessionState: AgentRendererState): boolean {
	return (
		sessionState.isStreaming ||
		sessionState.streamingMessage !== undefined ||
		sessionState.pendingToolCalls.length > 0 ||
		sessionState.compactionActivity !== undefined
	);
}

function pruneSessionStateCache({
	activeSessionId,
	now,
	pendingActiveSessionId,
	sessionStateAccessedAt,
	sessionStates,
}: {
	activeSessionId?: string;
	now: number;
	pendingActiveSessionId?: string;
	sessionStateAccessedAt: Record<string, number>;
	sessionStates: Record<string, AgentRendererState>;
}): Pick<AgentStoreState, "sessionStateAccessedAt" | "sessionStates"> {
	const protectedSessionIds = new Set<string>();
	if (activeSessionId) {
		protectedSessionIds.add(activeSessionId);
	}
	if (pendingActiveSessionId) {
		protectedSessionIds.add(pendingActiveSessionId);
	}
	for (const [sessionId, sessionState] of Object.entries(sessionStates)) {
		if (shouldRetainInactiveSessionState(sessionState)) {
			protectedSessionIds.add(sessionId);
		}
	}

	const nextSessionStates = { ...sessionStates };
	const nextSessionStateAccessedAt = { ...sessionStateAccessedAt };
	for (const sessionId of Object.keys(nextSessionStates)) {
		const lastAccessedAt = nextSessionStateAccessedAt[sessionId] ?? 0;
		if (!protectedSessionIds.has(sessionId) && now - lastAccessedAt > SESSION_STATE_CACHE_TTL_MS) {
			delete nextSessionStates[sessionId];
			delete nextSessionStateAccessedAt[sessionId];
		}
	}

	let retainedSessionCount = Object.keys(nextSessionStates).length;
	if (retainedSessionCount > MAX_SESSION_STATE_CACHE_ENTRIES) {
		const evictionCandidates = Object.keys(nextSessionStates)
			.filter((sessionId) => !protectedSessionIds.has(sessionId))
			.sort(
				(leftSessionId, rightSessionId) =>
					(nextSessionStateAccessedAt[leftSessionId] ?? 0) - (nextSessionStateAccessedAt[rightSessionId] ?? 0),
			);
		for (const sessionId of evictionCandidates) {
			if (retainedSessionCount <= MAX_SESSION_STATE_CACHE_ENTRIES) {
				break;
			}
			delete nextSessionStates[sessionId];
			delete nextSessionStateAccessedAt[sessionId];
			retainedSessionCount -= 1;
		}
	}

	return {
		sessionStateAccessedAt: nextSessionStateAccessedAt,
		sessionStates: nextSessionStates,
	};
}

export function createAgentStore() {
	return createStore<AgentStoreState>()((set) => ({
		...INITIAL_AGENT_RENDERER_STATE,
		activeSessionId: undefined,
		pendingActiveSessionId: undefined,
		sessionStates: {},
		sessionStateAccessedAt: {},
		setActiveSession: (sessionId) => {
			set((state) => {
				const now = Date.now();
				const hasHydratedTarget = sessionId !== undefined && state.sessionStates[sessionId]?.hasHydrated === true;
				const activeSessionId = sessionId === undefined || hasHydratedTarget ? sessionId : state.activeSessionId;
				const pendingActiveSessionId = sessionId !== undefined && !hasHydratedTarget ? sessionId : undefined;
				const sessionStateAccessedAt = sessionId
					? {
							...state.sessionStateAccessedAt,
							[sessionId]: now,
						}
					: state.sessionStateAccessedAt;
				const prunedSessionCache = pruneSessionStateCache({
					activeSessionId,
					now,
					pendingActiveSessionId,
					sessionStateAccessedAt,
					sessionStates: state.sessionStates,
				});
				return {
					...getSessionState(prunedSessionCache.sessionStates, activeSessionId),
					activeSessionId,
					pendingActiveSessionId,
					...prunedSessionCache,
				};
			});
		},
		hydrateSnapshot: (snapshot) => {
			set((state) => {
				const now = Date.now();
				const previousSessionState = state.sessionStates[snapshot.sessionId];
				const sessionState = createAgentRendererState(snapshot, previousSessionState);
				const sessionStates = {
					...state.sessionStates,
					[snapshot.sessionId]: sessionState,
				};
				const sessionStateAccessedAt = {
					...state.sessionStateAccessedAt,
					[snapshot.sessionId]: now,
				};
				const shouldActivateSnapshot =
					state.pendingActiveSessionId !== undefined
						? state.pendingActiveSessionId === snapshot.sessionId
						: state.activeSessionId === snapshot.sessionId || state.activeSessionId === undefined;
				const activeSessionId = shouldActivateSnapshot ? snapshot.sessionId : state.activeSessionId;
				const pendingActiveSessionId = shouldActivateSnapshot ? undefined : state.pendingActiveSessionId;
				const prunedSessionCache = pruneSessionStateCache({
					activeSessionId,
					now,
					pendingActiveSessionId,
					sessionStateAccessedAt,
					sessionStates,
				});
				return {
					...getSessionState(prunedSessionCache.sessionStates, activeSessionId),
					activeSessionId,
					pendingActiveSessionId,
					...prunedSessionCache,
				};
			});
		},
		applyEvent: (event) => {
			set((state) => {
				const now = Date.now();
				const previousSessionState = getSessionState(state.sessionStates, event.sessionId);
				const nextSessionState = reduceAgentEvent(previousSessionState, event);
				const sessionStates = {
					...state.sessionStates,
					[event.sessionId]: nextSessionState,
				};
				const sessionStateAccessedAt = {
					...state.sessionStateAccessedAt,
					[event.sessionId]: now,
				};
				const prunedSessionCache = pruneSessionStateCache({
					activeSessionId: state.activeSessionId,
					now,
					pendingActiveSessionId: state.pendingActiveSessionId,
					sessionStateAccessedAt,
					sessionStates,
				});

				if (
					state.activeSessionId !== event.sessionId ||
					(state.pendingActiveSessionId !== undefined && state.pendingActiveSessionId !== event.sessionId)
				) {
					return {
						pendingActiveSessionId: state.pendingActiveSessionId,
						...prunedSessionCache,
					};
				}

				return {
					...nextSessionState,
					pendingActiveSessionId: state.pendingActiveSessionId,
					...prunedSessionCache,
				};
			});
		},
		setBridgeError: (message) => {
			set((state) => {
				const now = Date.now();
				const nextState = {
					...getSessionState(state.sessionStates, state.activeSessionId),
					hasHydrated: true,
					bridgeError: message,
					errorMessage: message,
					isStreaming: false,
					streamingMessage: undefined,
				};
				const sessionStates = state.activeSessionId
					? {
							...state.sessionStates,
							[state.activeSessionId]: nextState,
						}
					: state.sessionStates;
				const sessionStateAccessedAt = state.activeSessionId
					? {
							...state.sessionStateAccessedAt,
							[state.activeSessionId]: now,
						}
					: state.sessionStateAccessedAt;
				const prunedSessionCache = pruneSessionStateCache({
					activeSessionId: state.activeSessionId,
					now,
					pendingActiveSessionId: undefined,
					sessionStateAccessedAt,
					sessionStates,
				});
				return {
					...nextState,
					pendingActiveSessionId: undefined,
					...prunedSessionCache,
				};
			});
		},
	}));
}

export const agentStore = createAgentStore();

export function useAgentStore<T>(selector: (state: AgentStoreState) => T): T {
	return useStore(agentStore, selector);
}
