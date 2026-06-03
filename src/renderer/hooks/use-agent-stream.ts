import { useCallback, useEffect } from "react";
import type { SerializedAgentEvent } from "../../shared/serialized-agent-event.ts";
import type {
	DesktopAgentMode,
	DesktopPromptSubmission,
	DesktopSessionProfileUpdateInput,
} from "../../shared/types.ts";
import { createAgentEventCoalescer } from "../lib/agent-event-coalescer.ts";
import { markRendererPerformance, measureRendererPerformance } from "../lib/performance-marks.ts";
import { useAgentStore } from "../stores/agent-store.ts";
import { useProjectStore } from "../stores/project-store.ts";
import { useSessionStore } from "../stores/session-store.ts";

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

	useEffect(() => {
		let disposed = false;
		const eventCoalescer = createAgentEventCoalescer({
			emit: (event) => {
				applyEvent(event);
				applySessionEvent(event);
				applyProjectEvent(event);
			},
		});

		const unsubscribe = window.desktopAgent.subscribeToAgentEvents((event: SerializedAgentEvent) => {
			if (disposed) {
				return;
			}

			eventCoalescer.push(event);
		});

		return () => {
			disposed = true;
			unsubscribe();
			eventCoalescer.dispose();
		};
	}, [applyEvent, applyProjectEvent, applySessionEvent]);

	const refreshSnapshot = useCallback(
		async (sessionId = activeSessionId) => {
			if (!sessionId) {
				return;
			}

			try {
				markRendererPerformance("renderer:snapshot:load:start");
				const snapshot = await window.desktopAgent.getSnapshot(sessionId);
				hydrateSnapshot(snapshot);
				applyProjectProfileSnapshot(snapshot);
				markRendererPerformance("renderer:snapshot:load:end");
				measureRendererPerformance(
					"renderer snapshot load",
					"renderer:snapshot:load:start",
					"renderer:snapshot:load:end",
				);
			} catch (error: unknown) {
				setBridgeError(error instanceof Error ? error.message : String(error));
			}
		},
		[activeSessionId, applyProjectProfileSnapshot, hydrateSnapshot, setBridgeError],
	);

	useEffect(() => {
		setActiveSession(activeSessionId);
		void refreshSnapshot(activeSessionId);
	}, [activeSessionId, refreshSnapshot, setActiveSession]);

	const prompt = useCallback(
		async (request: DesktopPromptSubmission) => {
			if (!activeSessionId) {
				throw new Error("No active session is selected.");
			}

			if (hasMeasuredFirstPrompt) {
				await window.desktopAgent.prompt({ sessionId: activeSessionId, ...request });
				return;
			}

			hasMeasuredFirstPrompt = true;
			markRendererPerformance("renderer:first-prompt:submit:start");
			try {
				await window.desktopAgent.prompt({ sessionId: activeSessionId, ...request });
			} finally {
				markRendererPerformance("renderer:first-prompt:submit:end");
				measureRendererPerformance(
					"renderer first prompt submit",
					"renderer:first-prompt:submit:start",
					"renderer:first-prompt:submit:end",
				);
			}
		},
		[activeSessionId],
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
			try {
				const snapshot = await window.desktopAgent.compact({
					sessionId: activeSessionId,
					...(customInstructions ? { customInstructions } : {}),
				});
				hydrateSnapshot(snapshot);
				applyProfileSnapshot(snapshot);
				applyProjectProfileSnapshot(snapshot);
			} catch (error: unknown) {
				setBridgeError(error instanceof Error ? error.message : String(error));
				throw error;
			}
		},
		[activeSessionId, applyProfileSnapshot, applyProjectProfileSnapshot, hydrateSnapshot, setBridgeError],
	);

	const updateSessionProfile = useCallback(
		async (update: DesktopSessionProfileUpdateInput) => {
			if (!activeSessionId) {
				throw new Error("No active session is selected.");
			}

			try {
				const snapshot = await window.desktopAgent.updateSessionProfile({ sessionId: activeSessionId, ...update });
				hydrateSnapshot(snapshot);
				applyProfileSnapshot(snapshot);
				applyProjectProfileSnapshot(snapshot);
			} catch (error: unknown) {
				setBridgeError(error instanceof Error ? error.message : String(error));
				throw error;
			}
		},
		[activeSessionId, applyProfileSnapshot, applyProjectProfileSnapshot, hydrateSnapshot, setBridgeError],
	);

	const setSessionMode = useCallback(
		async (agentMode: DesktopAgentMode) => {
			if (!activeSessionId) {
				throw new Error("No active session is selected.");
			}

			try {
				const snapshot = await window.desktopAgent.setSessionMode({ sessionId: activeSessionId, agentMode });
				hydrateSnapshot(snapshot);
				applyProfileSnapshot(snapshot);
				applyProjectProfileSnapshot(snapshot);
			} catch (error: unknown) {
				setBridgeError(error instanceof Error ? error.message : String(error));
				throw error;
			}
		},
		[activeSessionId, applyProfileSnapshot, applyProjectProfileSnapshot, hydrateSnapshot, setBridgeError],
	);

	const consumeProposedPlan = useCallback(
		async (planMessageId: string) => {
			if (!activeSessionId) {
				throw new Error("No active session is selected.");
			}

			try {
				const snapshot = await window.desktopAgent.consumeProposedPlan({
					sessionId: activeSessionId,
					planMessageId,
				});
				hydrateSnapshot(snapshot);
				applyProfileSnapshot(snapshot);
				applyProjectProfileSnapshot(snapshot);
			} catch (error: unknown) {
				setBridgeError(error instanceof Error ? error.message : String(error));
				throw error;
			}
		},
		[activeSessionId, applyProfileSnapshot, applyProjectProfileSnapshot, hydrateSnapshot, setBridgeError],
	);

	const executePlan = useCallback(async () => {
		if (!activeSessionId) {
			throw new Error("No active session is selected.");
		}

		try {
			const snapshot = await window.desktopAgent.executePlan({ sessionId: activeSessionId });
			hydrateSnapshot(snapshot);
			applyProfileSnapshot(snapshot);
			applyProjectProfileSnapshot(snapshot);
		} catch (error: unknown) {
			setBridgeError(error instanceof Error ? error.message : String(error));
			throw error;
		}
	}, [activeSessionId, applyProfileSnapshot, applyProjectProfileSnapshot, hydrateSnapshot, setBridgeError]);

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
