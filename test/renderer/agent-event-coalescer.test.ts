import { describe, expect, it } from "vitest";
import { createAgentEventCoalescer, type ScheduledFlush } from "../../src/renderer/lib/agent-event-coalescer.ts";
import type { SerializedAgentEvent } from "../../src/shared/serialized-agent-event.ts";

function assistantTextMessage(text: string) {
	return {
		role: "assistant" as const,
		api: "faux",
		content: [{ type: "text" as const, text }],
		model: "faux-model",
		provider: "faux",
		stopReason: "stop" as const,
		timestamp: text.length,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

function messageUpdate(text: string): SerializedAgentEvent {
	const message = assistantTextMessage(text);
	return {
		type: "message_update",
		sessionId: "session-1",
		message,
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 0,
			delta: text,
			partial: message,
		},
	};
}

function messageEnd(text: string): SerializedAgentEvent {
	return {
		type: "message_end",
		sessionId: "session-1",
		message: assistantTextMessage(text),
	};
}

function createManualScheduler(): {
	flush: () => void;
	schedule: (callback: () => void) => ScheduledFlush;
} {
	let pendingCallback: (() => void) | undefined;

	return {
		flush: () => {
			const callback = pendingCallback;
			pendingCallback = undefined;
			callback?.();
		},
		schedule: (callback) => {
			pendingCallback = callback;
			return {
				cancel: () => {
					if (pendingCallback === callback) {
						pendingCallback = undefined;
					}
				},
			};
		},
	};
}

describe("agent event coalescer", () => {
	it("coalesces rapid message updates to the latest event for the scheduled flush", () => {
		const emitted: SerializedAgentEvent[] = [];
		const scheduler = createManualScheduler();
		const coalescer = createAgentEventCoalescer({
			emit: (event) => emitted.push(event),
			schedule: scheduler.schedule,
		});

		coalescer.push(messageUpdate("alpha"));
		coalescer.push(messageUpdate("alpha beta"));

		expect(emitted).toEqual([]);

		scheduler.flush();

		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			type: "message_update",
			message: {
				content: [{ text: "alpha beta", type: "text" }],
			},
		});
	});

	it("flushes pending coalesced updates before terminal events", () => {
		const emitted: SerializedAgentEvent[] = [];
		const scheduler = createManualScheduler();
		const coalescer = createAgentEventCoalescer({
			emit: (event) => emitted.push(event),
			schedule: scheduler.schedule,
		});
		const finalEvent = messageEnd("alpha beta final");

		coalescer.push(messageUpdate("alpha"));
		coalescer.push(messageUpdate("alpha beta"));
		coalescer.push(finalEvent);

		expect(emitted).toHaveLength(2);
		expect(emitted[0]).toMatchObject({
			type: "message_update",
			message: {
				content: [{ text: "alpha beta", type: "text" }],
			},
		});
		expect(emitted[1]).toBe(finalEvent);

		scheduler.flush();
		expect(emitted).toHaveLength(2);
	});
});
