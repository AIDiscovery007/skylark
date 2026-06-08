import { useCallback, useEffect } from "react";
import type { DesktopAgentSnapshot, SerializedAgentEvent } from "../../shared/serialized-agent-event.ts";
import type {
	DesktopAgentMode,
	DesktopPromptSubmission,
	DesktopSessionProfileUpdateInput,
} from "../../shared/types.ts";
import { createAgentEventCoalescer } from "../lib/agent-event-coalescer.ts";
import { applySessionSnapshot } from "../lib/apply-session-snapshot.ts";
import { runBridgeCommand } from "../lib/bridge-command.ts";
import { markRendererPerformance, measureRendererPerformance } from "../lib/performance-marks.ts";
import { useAgentStore } from "../stores/agent-store.ts";
import { useProjectStore } from "../stores/project-store.ts";
import { useSessionStore } from "../stores/session-store.ts";
import { useSubscribedResource } from "./use-subscribed-resource.ts";

let hasMeasuredFirstPrompt = false;

export interface AgentStreamControls {
	abort: () => Promise<void>;
	prompt: (request: DesktopPromptSubmission) => Promise<void>;
	refreshSnapshot: (sessionId?: string) => Promise<void>;
	setSessionMode: (agentMode: DesktopAgentMode) => Promise<void>;
	consumeProposedPlan: (planMessageId: string) => Promise<void>;
	executePlan: () => Promise<void>;
	compact: (customInstructions?: string) => Promise<void>;
	updateSessionProfile: (update: DesktopSessionProfileUpdateInput) => Promise<void>;
}

export function useAgentStream(activeSessionId?: string): AgentStreamControls {
	const applyEvent = useAgentStore((state) => state.applyEvent);
	const hydrateSnapshot = useAgentStore((state) => state.hydrateSnapshot);
	const setActiveSession = useAgentStore((state) => state.setActiveSession);
	const setBridgeError = useAgentStore((state) => state.setBridgeError);
	const applySessionEvent = useSessionStore((state) => state.applyAgentEvent);
	const applyProfileSnapshot = useSessionStore((state) => state.applyProfileSnapshot);
	const applyProjectEvent = useProjectStore((state) => state.applyAgentEvent);
	const applyProjectProfileSnapshot = useProjectStore((state) => state.applyProfileSnapshot);

	const applySnapshot = useCallback(
		(snapshot: DesktopAgentSnapshot) => {
			applySessionSnapshot(snapshot, {
				applyProfileSnapshot,
				applyProjectProfileSnapshot,
				hydrateSnapshot,
			});
		},
		[applyProfileSnapshot, applyProjectProfileSnapshot, hydrateSnapshot],
	);

	useSubscribedResource<SerializedAgentEvent>(
		(onEvent) => {
			const eventCoalescer = createAgentEventCoalescer({
				emit: onEvent,
			});

			const unsubscribe = window.desktopAgent.subscribeToAgentEvents((event: SerializedAgentEvent) => {
				eventCoalescer.push(event);
			});

			return () => {
				unsubscribe();
				eventCoalescer.dispose();
			};
		},
		(event) => {
			applyEvent(event);
			applySessionEvent(event);
			applyProjectEvent(event);
		},
		[applyEvent, applyProjectEvent, applySessionEvent],
	);

	const refreshSnapshot = useCallback(
		async (sessionId = activeSessionId) => {
			if (!sessionId) {
				return;
			}

			markRendererPerformance("renderer:snapshot:load:start");
			const snapshot = await runBridgeCommand({
				command: () => window.desktopAgent.getSnapshot(sessionId),
				onError: setBridgeError,
				rethrow: false,
			});
			if (!snapshot) {
				return;
			}
			applySnapshot(snapshot);
			markRendererPerformance("renderer:snapshot:load:end");
			measureRendererPerformance(
				"renderer snapshot load",
				"renderer:snapshot:load:start",
				"renderer:snapshot:load:end",
			);
		},
		[activeSessionId, applySnapshot, setBridgeError],
	);

	useEffect(() => {
		setActiveSession(activeSessionId);
		void refreshSnapshot(activeSessionId);
	}, [activeSessionId, refreshSnapshot, setActiveSession]);

	const prompt = useCallback(
		async (request: DesktopPromptSubmission) => {
			if (!activeSessionId) {
				const error = new Error("No active session is selected.");
				setBridgeError(error.message);
				throw error;
			}

			const submitPrompt = async () => {
				await window.desktopAgent.prompt({ sessionId: activeSessionId, ...request });
			};

			await runBridgeCommand({
				command: async () => {
					if (hasMeasuredFirstPrompt) {
						await submitPrompt();
						return;
					}

					hasMeasuredFirstPrompt = true;
					markRendererPerformance("renderer:first-prompt:submit:start");
					try {
						await submitPrompt();
					} finally {
						markRendererPerformance("renderer:first-prompt:submit:end");
						measureRendererPerformance(
							"renderer first prompt submit",
							"renderer:first-prompt:submit:start",
							"renderer:first-prompt:submit:end",
						);
					}
				},
				onError: setBridgeError,
			});
		},
		[activeSessionId, setBridgeError],
	);

	const abort = useCallback(async () => {
		if (!activeSessionId) {
			return;
		}

		await window.desktopAgent.abort(activeSessionId);
	}, [activeSessionId]);

	const compact = useCallback(
		async (customInstructions?: string) => {
			if (!activeSessionId) {
				throw new Error("No active session is selected.");
			}
			const snapshot = await runBridgeCommand({
				command: () =>
					window.desktopAgent.compact({
						sessionId: activeSessionId,
						...(customInstructions ? { customInstructions } : {}),
					}),
				onError: setBridgeError,
			});
			applySnapshot(snapshot);
		},
		[activeSessionId, applySnapshot, setBridgeError],
	);

	const updateSessionProfile = useCallback(
		async (update: DesktopSessionProfileUpdateInput) => {
			if (!activeSessionId) {
				throw new Error("No active session is selected.");
			}

			const snapshot = await runBridgeCommand({
				command: () => window.desktopAgent.updateSessionProfile({ sessionId: activeSessionId, ...update }),
				onError: setBridgeError,
			});
			applySnapshot(snapshot);
		},
		[activeSessionId, applySnapshot, setBridgeError],
	);

	const setSessionMode = useCallback(
		async (agentMode: DesktopAgentMode) => {
			if (!activeSessionId) {
				throw new Error("No active session is selected.");
			}

			const snapshot = await runBridgeCommand({
				command: () => window.desktopAgent.setSessionMode({ sessionId: activeSessionId, agentMode }),
				onError: setBridgeError,
			});
			applySnapshot(snapshot);
		},
		[activeSessionId, applySnapshot, setBridgeError],
	);

	const consumeProposedPlan = useCallback(
		async (planMessageId: string) => {
			if (!activeSessionId) {
				throw new Error("No active session is selected.");
			}

			const snapshot = await runBridgeCommand({
				command: () =>
					window.desktopAgent.consumeProposedPlan({
						sessionId: activeSessionId,
						planMessageId,
					}),
				onError: setBridgeError,
			});
			applySnapshot(snapshot);
		},
		[activeSessionId, applySnapshot, setBridgeError],
	);

	const executePlan = useCallback(async () => {
		if (!activeSessionId) {
			throw new Error("No active session is selected.");
		}

		const snapshot = await runBridgeCommand({
			command: () => window.desktopAgent.executePlan({ sessionId: activeSessionId }),
			onError: setBridgeError,
		});
		applySnapshot(snapshot);
	}, [activeSessionId, applySnapshot, setBridgeError]);

	return {
		abort,
		compact,
		consumeProposedPlan,
		executePlan,
		prompt,
		refreshSnapshot,
		setSessionMode,
		updateSessionProfile,
	};
}
