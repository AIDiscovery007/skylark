import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentStore } from "../../src/renderer/stores/agent-store.ts";
import type { DesktopAgentSnapshot, SerializedAgentEventPayload } from "../../src/shared/serialized-agent-event.ts";

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

function createSnapshot(sessionId = "session-1"): DesktopAgentSnapshot {
	return {
		sessionId,
		cwd: "/workspace/project",
		agentMode: "execute",
		diagnostics: [{ type: "info", message: "ready" }],
		model: {
			id: "faux-model",
			provider: "faux",
			name: "Faux Model",
			reasoning: false,
		},
		thinkingLevel: "off",
		availableTools: ["read", "bash", "edit", "write"],
		messages: [],
		streamingMessage: undefined,
		pendingToolCalls: [],
		isStreaming: false,
		errorMessage: undefined,
	};
}

function createEvent<TEvent extends SerializedAgentEventPayload>(
	event: TEvent,
	sessionId = "session-1",
): TEvent & { sessionId: string } {
	return {
		...event,
		sessionId,
	};
}

function createUserMessage(text: string, timestamp: number): UserMessage {
	return {
		role: "user",
		content: text,
		timestamp,
	};
}

function createAssistantMessage(text: string, timestamp: number, errorMessage?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "faux-provider",
		provider: "faux",
		model: "faux-model",
		usage: EMPTY_USAGE,
		stopReason: errorMessage ? "aborted" : "stop",
		errorMessage,
		timestamp,
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("agentStore", () => {
	it("routes inactive session events without mutating the active transcript", () => {
		const store = createAgentStore();
		const inactiveMessage = createUserMessage("background run", 5);

		store.getState().hydrateSnapshot(createSnapshot("session-1"));
		store.getState().applyEvent(createEvent({ type: "agent_start" }, "session-2"));
		store.getState().applyEvent(createEvent({ type: "message_end", message: inactiveMessage }, "session-2"));

		const state = store.getState();
		expect(state.activeSessionId).toBe("session-1");
		expect(state.messages).toEqual([]);
		expect(state.isStreaming).toBe(false);
		expect(state.sessionStates["session-2"]?.messages).toEqual([inactiveMessage]);
		expect(state.sessionStates["session-2"]?.isStreaming).toBe(true);
	});

	it("keeps the current transcript visible while an uncached session snapshot loads", () => {
		const store = createAgentStore();
		const currentSnapshot = createSnapshot("session-1");
		const currentMessage = createUserMessage("current transcript", 1);
		currentSnapshot.messages = [currentMessage];
		const nextSnapshot = createSnapshot("session-2");
		const nextMessage = createUserMessage("next transcript", 2);
		nextSnapshot.messages = [nextMessage];

		store.getState().hydrateSnapshot(currentSnapshot);
		store.getState().setActiveSession("session-2");

		expect(store.getState().activeSessionId).toBe("session-1");
		expect(store.getState().pendingActiveSessionId).toBe("session-2");
		expect(store.getState().hasHydrated).toBe(true);
		expect(store.getState().messages).toEqual([currentMessage]);

		const staleCurrentSnapshot = createSnapshot("session-1");
		staleCurrentSnapshot.messages = [createUserMessage("refreshed current transcript", 3)];
		store.getState().hydrateSnapshot(staleCurrentSnapshot);

		expect(store.getState().activeSessionId).toBe("session-1");
		expect(store.getState().pendingActiveSessionId).toBe("session-2");

		store.getState().hydrateSnapshot(nextSnapshot);

		expect(store.getState().activeSessionId).toBe("session-2");
		expect(store.getState().pendingActiveSessionId).toBe(undefined);
		expect(store.getState().messages).toEqual([nextMessage]);
	});

	it("keeps running source-session events out of the visible transcript while another session loads", () => {
		const store = createAgentStore();
		const currentSnapshot = createSnapshot("session-1");
		const currentMessage = createUserMessage("current transcript", 1);
		currentSnapshot.messages = [currentMessage];
		currentSnapshot.isStreaming = true;
		const sourceStreamMessage = createAssistantMessage("background stream chunk", 2);
		const sourceFinalMessage = createAssistantMessage("background final", 3);

		store.getState().hydrateSnapshot(currentSnapshot);
		store.getState().setActiveSession("session-2");
		store.getState().applyEvent(createEvent({ type: "message_end", message: sourceStreamMessage }, "session-1"));
		store.getState().applyEvent(createEvent({ type: "agent_end", messages: [sourceFinalMessage] }, "session-1"));

		const state = store.getState();
		expect(state.activeSessionId).toBe("session-1");
		expect(state.pendingActiveSessionId).toBe("session-2");
		expect(state.messages).toEqual([currentMessage]);
		expect(state.isStreaming).toBe(true);
		expect(state.sessionStates["session-1"]?.messages).toEqual([
			currentMessage,
			sourceStreamMessage,
			sourceFinalMessage,
		]);
		expect(state.sessionStates["session-1"]?.isStreaming).toBe(false);
	});

	it("switches immediately when the target session already has a cached snapshot", () => {
		const store = createAgentStore();
		const currentSnapshot = createSnapshot("session-1");
		const currentMessage = createUserMessage("current transcript", 1);
		currentSnapshot.messages = [currentMessage];
		const cachedSnapshot = createSnapshot("session-2");
		const cachedMessage = createUserMessage("cached transcript", 2);
		cachedSnapshot.messages = [cachedMessage];

		store.getState().hydrateSnapshot(currentSnapshot);
		store.getState().hydrateSnapshot(cachedSnapshot);

		expect(store.getState().activeSessionId).toBe("session-1");
		expect(store.getState().messages).toEqual([currentMessage]);

		store.getState().setActiveSession("session-2");

		expect(store.getState().activeSessionId).toBe("session-2");
		expect(store.getState().pendingActiveSessionId).toBe(undefined);
		expect(store.getState().messages).toEqual([cachedMessage]);
	});

	it("evicts stale inactive session cache entries while retaining active and running sessions", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(0));
		const store = createAgentStore();
		const currentSnapshot = createSnapshot("session-1");
		currentSnapshot.messages = [createUserMessage("active transcript", 1)];
		const inactiveSnapshot = createSnapshot("session-2");
		inactiveSnapshot.messages = [createUserMessage("stale transcript", 2)];

		store.getState().hydrateSnapshot(currentSnapshot);
		store.getState().hydrateSnapshot(inactiveSnapshot);
		store.getState().applyEvent(createEvent({ type: "agent_start" }, "session-3"));

		vi.setSystemTime(new Date(31 * 60 * 1000));
		store.getState().hydrateSnapshot(createSnapshot("session-4"));

		const state = store.getState();
		expect(state.sessionStates["session-1"]).toBeDefined();
		expect(state.sessionStates["session-2"]).toBeUndefined();
		expect(state.sessionStates["session-3"]?.isStreaming).toBe(true);
		expect(state.sessionStates["session-4"]).toBeDefined();
		expect(state.activeSessionId).toBe("session-1");
	});

	it("bounds cached inactive session states by least recent access", () => {
		vi.useFakeTimers();
		const store = createAgentStore();

		for (let index = 1; index <= 10; index += 1) {
			vi.setSystemTime(new Date(index));
			const snapshot = createSnapshot(`session-${index}`);
			snapshot.messages = [createUserMessage(`transcript ${index}`, index)];
			store.getState().hydrateSnapshot(snapshot);
		}

		const state = store.getState();
		expect(Object.keys(state.sessionStates)).toHaveLength(8);
		expect(state.sessionStates["session-1"]).toBeDefined();
		expect(state.sessionStates["session-2"]).toBeUndefined();
		expect(state.sessionStates["session-3"]).toBeUndefined();
		expect(state.sessionStates["session-4"]).toBeDefined();
		expect(state.sessionStates["session-10"]).toBeDefined();
	});
});
