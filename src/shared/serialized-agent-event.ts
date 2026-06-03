import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { DesktopAgentMode, DesktopTaskProgress } from "./types.ts";

export interface DesktopAgentDiagnostic {
	type: "info" | "warning" | "error";
	message: string;
}

export interface DesktopAgentModel {
	id: string;
	provider: string;
	name: string;
	reasoning: boolean;
	contextWindow?: number;
}

export interface DesktopAgentSnapshot {
	sessionId: string;
	cwd: string;
	agentMode: DesktopAgentMode;
	consumedProposedPlanMessageIds?: string[];
	taskProgress?: DesktopTaskProgress;
	diagnostics: DesktopAgentDiagnostic[];
	model?: DesktopAgentModel;
	thinkingLevel: ThinkingLevel;
	availableTools: string[];
	messages: AgentMessage[];
	streamingMessage?: AgentMessage;
	pendingToolCalls: string[];
	isStreaming: boolean;
	errorMessage?: string;
}

export type SerializedCompactionReason = "manual" | "threshold" | "overflow";

export type SerializedAgentEventPayload =
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[] }
	| { type: "session_title_update"; title: string }
	| { type: "turn_start" }
	| { type: "turn_end"; message: AgentMessage; toolResults: AgentMessage[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
	| {
			type: "tool_execution_update";
			toolCallId: string;
			toolName: string;
			args: unknown;
			partialResult: unknown;
	  }
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result: unknown;
			isError: boolean;
	  }
	| { type: "compaction_start"; reason: SerializedCompactionReason }
	| {
			type: "compaction_end";
			reason: SerializedCompactionReason;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  };

export type SerializedAgentEvent = { sessionId: string } & SerializedAgentEventPayload;
