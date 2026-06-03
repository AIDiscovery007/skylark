import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SerializedAgentEventPayload } from "../../shared/serialized-agent-event.ts";

export interface DesktopSessionTitleUpdateEvent {
	type: "session_title_update";
	title: string;
}

type CoreAgentEventType =
	| "agent_start"
	| "agent_end"
	| "turn_start"
	| "turn_end"
	| "message_start"
	| "message_update"
	| "message_end"
	| "tool_execution_start"
	| "tool_execution_update"
	| "tool_execution_end";

export type CoreAgentSessionEvent = Extract<AgentSessionEvent, { type: CoreAgentEventType }>;

export type SerializableAgentSessionEvent =
	| CoreAgentSessionEvent
	| Extract<AgentSessionEvent, { type: "compaction_start" | "compaction_end" }>;

export type SerializableAgentEvent = AgentEvent | DesktopSessionTitleUpdateEvent | SerializableAgentSessionEvent;

export function serializeAgentEvent(event: SerializableAgentEvent): SerializedAgentEventPayload {
	switch (event.type) {
		case "agent_start":
			return { type: "agent_start" };
		case "agent_end":
			return { type: "agent_end", messages: event.messages };
		case "session_title_update":
			return { type: "session_title_update", title: event.title };
		case "turn_start":
			return { type: "turn_start" };
		case "turn_end":
			return { type: "turn_end", message: event.message, toolResults: event.toolResults };
		case "message_start":
			return { type: "message_start", message: event.message };
		case "message_update":
			return {
				type: "message_update",
				message: event.message,
				assistantMessageEvent: event.assistantMessageEvent,
			};
		case "message_end":
			return { type: "message_end", message: event.message };
		case "tool_execution_start":
			return {
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
			};
		case "tool_execution_update":
			return {
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				partialResult: event.partialResult,
			};
		case "tool_execution_end":
			return {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: event.result,
				isError: event.isError,
			};
		case "compaction_start":
			return { type: "compaction_start", reason: event.reason };
		case "compaction_end":
			return {
				type: "compaction_end",
				reason: event.reason,
				aborted: event.aborted,
				willRetry: event.willRetry,
				...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
			};
	}
}
