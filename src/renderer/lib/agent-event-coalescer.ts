import type { SerializedAgentEvent } from "../../shared/serialized-agent-event.ts";

export interface ScheduledFlush {
	cancel: () => void;
}

export interface AgentEventCoalescerOptions {
	emit: (event: SerializedAgentEvent) => void;
	schedule?: (callback: () => void) => ScheduledFlush;
}

export interface AgentEventCoalescer {
	dispose: () => void;
	flush: () => void;
	push: (event: SerializedAgentEvent) => void;
}

function scheduleNextFrame(callback: () => void): ScheduledFlush {
	if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
		const frameId = window.requestAnimationFrame(callback);
		return {
			cancel: () => window.cancelAnimationFrame(frameId),
		};
	}

	const timeoutId = setTimeout(callback, 16);
	return {
		cancel: () => clearTimeout(timeoutId),
	};
}

function getCoalescingKey(event: SerializedAgentEvent): string | undefined {
	switch (event.type) {
		case "message_update":
			return `${event.sessionId}:message_update`;
		case "tool_execution_update":
			return `${event.sessionId}:tool_execution_update:${event.toolCallId}`;
		default:
			return undefined;
	}
}

export function createAgentEventCoalescer({
	emit,
	schedule = scheduleNextFrame,
}: AgentEventCoalescerOptions): AgentEventCoalescer {
	let pendingEvents: SerializedAgentEvent[] = [];
	let scheduledFlush: ScheduledFlush | undefined;

	function clearScheduledFlush(): void {
		scheduledFlush?.cancel();
		scheduledFlush = undefined;
	}

	function flush(): void {
		clearScheduledFlush();
		if (pendingEvents.length === 0) {
			return;
		}

		const events = pendingEvents;
		pendingEvents = [];
		for (const event of events) {
			emit(event);
		}
	}

	function scheduleFlush(): void {
		if (scheduledFlush) {
			return;
		}

		scheduledFlush = schedule(flush);
	}

	function push(event: SerializedAgentEvent): void {
		const coalescingKey = getCoalescingKey(event);
		if (!coalescingKey) {
			flush();
			emit(event);
			return;
		}

		const pendingEventIndex = pendingEvents.findIndex(
			(pendingEvent) => getCoalescingKey(pendingEvent) === coalescingKey,
		);
		if (pendingEventIndex === -1) {
			pendingEvents.push(event);
		} else {
			pendingEvents[pendingEventIndex] = event;
		}
		scheduleFlush();
	}

	function dispose(): void {
		clearScheduledFlush();
		pendingEvents = [];
	}

	return {
		dispose,
		flush,
		push,
	};
}
