import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { stripPromptFileBlocks } from "../../shared/prompt-file-blocks.ts";
import type {
	DesktopAgentDiagnostic,
	DesktopAgentModel,
	DesktopAgentSnapshot,
	SerializedAgentEvent,
	SerializedCompactionReason,
} from "../../shared/serialized-agent-event.ts";
import type { DesktopAgentMode, DesktopSessionSummary, DesktopTaskProgress } from "../../shared/types.ts";
import { DESKTOP_TASK_PROGRESS_TOOL_NAME, resolveDesktopTaskProgressToolResult } from "../../shared/types.ts";

export type ToolCallStatus = "running" | "completed" | "error";

export interface ToolCallActivity {
	toolCallId: string;
	toolName: string;
	args: unknown;
	status: ToolCallStatus;
	startedAt: number;
	updatedAt: number;
	completedAt?: number;
	partialResult?: unknown;
	result?: unknown;
}

export interface RunActivityTiming {
	runId?: string;
	startedAt: number;
	endedAt?: number;
	firstTokenAt?: number;
	totalChunks?: number;
}

export interface CompactionActivity {
	reason: SerializedCompactionReason;
	startedAt: number;
}

export interface AgentRendererState {
	cwd: string;
	agentMode: DesktopAgentMode;
	consumedProposedPlanMessageIds: string[];
	taskProgress?: DesktopTaskProgress;
	diagnostics: DesktopAgentDiagnostic[];
	model?: DesktopAgentModel;
	thinkingLevel: ThinkingLevel;
	availableTools: string[];
	contextMessages: AgentMessage[];
	messages: AgentMessage[];
	streamingMessage?: AgentMessage;
	pendingToolCalls: string[];
	isStreaming: boolean;
	errorMessage?: string;
	toolCalls: ToolCallActivity[];
	runActivityTiming?: RunActivityTiming;
	compactionActivity?: CompactionActivity;
	hasHydrated: boolean;
	bridgeError?: string;
}

export const INITIAL_AGENT_RENDERER_STATE: AgentRendererState = {
	cwd: "",
	agentMode: "execute",
	consumedProposedPlanMessageIds: [],
	taskProgress: undefined,
	diagnostics: [],
	model: undefined,
	thinkingLevel: "off",
	availableTools: [],
	contextMessages: [],
	messages: [],
	streamingMessage: undefined,
	pendingToolCalls: [],
	isStreaming: false,
	errorMessage: undefined,
	toolCalls: [],
	runActivityTiming: undefined,
	compactionActivity: undefined,
	hasHydrated: false,
	bridgeError: undefined,
};

function createPendingToolActivity(toolCallId: string, timestamp: number): ToolCallActivity {
	return {
		toolCallId,
		toolName: "tool",
		args: {},
		status: "running",
		startedAt: timestamp,
		updatedAt: timestamp,
	};
}

function addPendingToolCall(pendingToolCalls: string[], toolCallId: string): string[] {
	return pendingToolCalls.includes(toolCallId) ? pendingToolCalls : [...pendingToolCalls, toolCallId];
}

function removePendingToolCall(pendingToolCalls: string[], toolCallId: string): string[] {
	return pendingToolCalls.filter((pendingId) => pendingId !== toolCallId);
}

function updateRunActivityTimingForMessageUpdate(
	runActivityTiming: RunActivityTiming | undefined,
	event: Extract<SerializedAgentEvent, { type: "message_update" }>,
): RunActivityTiming | undefined {
	if (!runActivityTiming) {
		return undefined;
	}

	const updatedAt = Date.now();
	const isFirstTextChunk =
		event.assistantMessageEvent.type === "text_delta" && event.assistantMessageEvent.delta.length > 0;

	return {
		...runActivityTiming,
		firstTokenAt: isFirstTextChunk ? (runActivityTiming.firstTokenAt ?? updatedAt) : runActivityTiming.firstTokenAt,
		totalChunks: (runActivityTiming.totalChunks ?? 0) + 1,
	};
}

function findToolCall(toolCalls: ToolCallActivity[], toolCallId: string): ToolCallActivity | undefined {
	return toolCalls.find((toolCall) => toolCall.toolCallId === toolCallId);
}

function upsertToolCall(toolCalls: ToolCallActivity[], nextToolCall: ToolCallActivity): ToolCallActivity[] {
	const toolCallIndex = toolCalls.findIndex((toolCall) => toolCall.toolCallId === nextToolCall.toolCallId);
	if (toolCallIndex === -1) {
		return [...toolCalls, nextToolCall];
	}

	const nextToolCalls = toolCalls.slice();
	const previousToolCall = toolCalls[toolCallIndex];
	nextToolCalls[toolCallIndex] = {
		...previousToolCall,
		...nextToolCall,
		startedAt: previousToolCall.startedAt,
	};
	return nextToolCalls;
}

function appendMissingToolCalls(toolCalls: ToolCallActivity[], newToolCalls: ToolCallActivity[]): ToolCallActivity[] {
	if (newToolCalls.length === 0) {
		return toolCalls;
	}

	const existingIds = new Set(toolCalls.map((toolCall) => toolCall.toolCallId));
	const nextToolCalls = [...toolCalls];
	for (const toolCall of newToolCalls) {
		if (existingIds.has(toolCall.toolCallId)) {
			continue;
		}
		existingIds.add(toolCall.toolCallId);
		nextToolCalls.push(toolCall);
	}
	return nextToolCalls;
}

function finalizePendingToolCalls(
	toolCalls: ToolCallActivity[],
	pendingToolCalls: string[],
	status: Exclude<ToolCallStatus, "running">,
	timestamp: number,
): ToolCallActivity[] {
	if (pendingToolCalls.length === 0) {
		return toolCalls;
	}

	return toolCalls.map((toolCall) => {
		if (!pendingToolCalls.includes(toolCall.toolCallId) || toolCall.status !== "running") {
			return toolCall;
		}

		return {
			...toolCall,
			status,
			updatedAt: timestamp,
			completedAt: timestamp,
		};
	});
}

function messageFingerprint(message: AgentMessage): string {
	return JSON.stringify(message);
}

function messageAgentEndOverlapFingerprint(message: AgentMessage): string {
	const identity = { ...(message as unknown as Record<string, unknown>) };
	delete identity.metadata;
	return JSON.stringify(identity);
}

function isCompactionSummaryMessage(message: AgentMessage): boolean {
	return (message as { role?: string }).role === "compactionSummary";
}

function appendMissingMessages(messages: AgentMessage[], newMessages: AgentMessage[]): AgentMessage[] {
	if (newMessages.length === 0) {
		return messages;
	}

	const existingFingerprints = new Set(messages.map(messageFingerprint));
	let nextMessages: AgentMessage[] | undefined;
	for (const message of newMessages) {
		const fingerprint = messageFingerprint(message);
		if (existingFingerprints.has(fingerprint)) {
			continue;
		}
		existingFingerprints.add(fingerprint);
		nextMessages ??= [...messages];
		nextMessages.push(message);
	}
	return nextMessages ?? messages;
}

function haveSameMessageSequence(leftMessages: AgentMessage[], rightMessages: AgentMessage[]): boolean {
	if (leftMessages.length !== rightMessages.length) {
		return false;
	}

	for (let index = 0; index < leftMessages.length; index += 1) {
		if (messageFingerprint(leftMessages[index]!) !== messageFingerprint(rightMessages[index]!)) {
			return false;
		}
	}
	return true;
}

function mergeVisibleMessagesForSnapshot(
	previousState: AgentRendererState | undefined,
	snapshotMessages: AgentMessage[],
): AgentMessage[] {
	if (
		!previousState ||
		previousState.messages.length === 0 ||
		snapshotMessages.length === 0 ||
		!isCompactionSummaryMessage(snapshotMessages[0])
	) {
		if (previousState && haveSameMessageSequence(previousState.messages, snapshotMessages)) {
			return previousState.messages;
		}
		return [...snapshotMessages];
	}

	return appendMissingMessages(previousState.messages, snapshotMessages);
}

function appendMissingAgentEndMessages(messages: AgentMessage[], newMessages: AgentMessage[]): AgentMessage[] {
	if (newMessages.length === 0) {
		return messages;
	}

	const existingFingerprints = messages.map(messageAgentEndOverlapFingerprint);
	const incomingFingerprints = newMessages.map(messageAgentEndOverlapFingerprint);
	const maxOverlap = Math.min(existingFingerprints.length, incomingFingerprints.length);

	for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
		const existingSuffix = existingFingerprints.slice(existingFingerprints.length - overlap);
		const incomingPrefix = incomingFingerprints.slice(0, overlap);
		if (existingSuffix.join("\u0000") === incomingPrefix.join("\u0000")) {
			return [...messages.slice(0, messages.length - overlap), ...newMessages];
		}
	}

	return [...messages, ...newMessages];
}

function findAssistantErrorMessage(messages: AgentMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "assistant" && message.errorMessage) {
			return message.errorMessage;
		}
	}

	return undefined;
}

function replaceSessionSummary(
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

function getUserMessageText(event: SerializedAgentEvent): string | undefined {
	if (event.type !== "message_end" || event.message.role !== "user") {
		return undefined;
	}

	const content = event.message.content;
	const text =
		typeof content === "string"
			? content
			: content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(" ");
	const normalizedText = stripPromptFileBlocks(text).replace(/\s+/g, " ").trim();
	return normalizedText || undefined;
}

export function getMessageToolCallIds(message: AgentMessage): string[] {
	if (message.role !== "assistant") {
		return [];
	}

	const toolCallIds: string[] = [];

	for (const content of message.content) {
		if (content.type === "toolCall") {
			toolCallIds.push(content.id);
		}
	}

	return toolCallIds;
}

export function getMessageToolCalls(message: AgentMessage, toolCalls: ToolCallActivity[]): ToolCallActivity[] {
	const toolCallIds = getMessageToolCallIds(message);
	if (toolCallIds.length === 0) {
		return [];
	}

	return toolCallIds
		.map((toolCallId) => findToolCall(toolCalls, toolCallId))
		.filter((toolCall): toolCall is ToolCallActivity => toolCall !== undefined);
}

export function createAgentRendererState(
	snapshot: DesktopAgentSnapshot,
	previousState?: AgentRendererState,
): AgentRendererState {
	const snapshotTimestamp = Date.now();
	const snapshotMessages = [...snapshot.messages];
	const messages = mergeVisibleMessagesForSnapshot(previousState, snapshotMessages);
	const contextMessages =
		previousState && haveSameMessageSequence(previousState.contextMessages, snapshotMessages)
			? previousState.contextMessages
			: snapshotMessages;

	return {
		cwd: snapshot.cwd,
		agentMode: snapshot.agentMode,
		consumedProposedPlanMessageIds: [...(snapshot.consumedProposedPlanMessageIds ?? [])],
		taskProgress: snapshot.taskProgress,
		diagnostics: [...snapshot.diagnostics],
		model: snapshot.model,
		thinkingLevel: snapshot.thinkingLevel,
		availableTools: [...snapshot.availableTools],
		contextMessages,
		messages,
		streamingMessage: snapshot.streamingMessage,
		pendingToolCalls: [...snapshot.pendingToolCalls],
		isStreaming: snapshot.isStreaming,
		errorMessage: snapshot.errorMessage,
		toolCalls: appendMissingToolCalls(
			previousState?.toolCalls ?? [],
			snapshot.pendingToolCalls.map((toolCallId) => createPendingToolActivity(toolCallId, snapshotTimestamp)),
		),
		runActivityTiming: snapshot.isStreaming
			? { runId: `run-${snapshotTimestamp}`, startedAt: snapshotTimestamp, totalChunks: 0 }
			: undefined,
		hasHydrated: true,
		bridgeError: undefined,
		compactionActivity: undefined,
	};
}

export function reduceAgentEvent(state: AgentRendererState, event: SerializedAgentEvent): AgentRendererState {
	switch (event.type) {
		case "agent_start": {
			const startedAt = Date.now();
			return {
				...state,
				isStreaming: true,
				errorMessage: undefined,
				bridgeError: undefined,
				runActivityTiming: { runId: `run-${startedAt}`, startedAt, totalChunks: 0 },
			};
		}

		case "agent_end": {
			const terminalErrorMessage = findAssistantErrorMessage(event.messages);
			const didFail = terminalErrorMessage !== undefined;
			const completedAt = Date.now();
			const runActivityTiming = {
				runId: state.runActivityTiming?.runId ?? `run-${completedAt}`,
				startedAt: state.runActivityTiming?.startedAt ?? completedAt,
				endedAt: completedAt,
				firstTokenAt: state.runActivityTiming?.firstTokenAt,
				totalChunks: state.runActivityTiming?.totalChunks,
			};

			return {
				...state,
				contextMessages: appendMissingAgentEndMessages(state.contextMessages, event.messages),
				messages: appendMissingAgentEndMessages(state.messages, event.messages),
				streamingMessage: undefined,
				toolCalls: finalizePendingToolCalls(
					state.toolCalls,
					state.pendingToolCalls,
					didFail ? "error" : "completed",
					completedAt,
				),
				pendingToolCalls: [],
				isStreaming: false,
				errorMessage: terminalErrorMessage ?? state.errorMessage,
				runActivityTiming,
			};
		}

		case "session_title_update":
			return state;

		case "turn_start":
			return state;

		case "turn_end":
			return {
				...state,
				errorMessage:
					event.message.role === "assistant" && event.message.errorMessage
						? event.message.errorMessage
						: state.errorMessage,
			};

		case "message_start":
			return {
				...state,
				streamingMessage: event.message,
			};

		case "message_update":
			return {
				...state,
				streamingMessage: event.message,
				runActivityTiming: updateRunActivityTimingForMessageUpdate(state.runActivityTiming, event),
			};

		case "message_end":
			return {
				...state,
				contextMessages: [...state.contextMessages, event.message],
				messages: [...state.messages, event.message],
				streamingMessage: undefined,
				errorMessage:
					event.message.role === "assistant" && event.message.errorMessage
						? event.message.errorMessage
						: state.errorMessage,
			};

		case "tool_execution_start": {
			const startedAt = Date.now();

			return {
				...state,
				pendingToolCalls: addPendingToolCall(state.pendingToolCalls, event.toolCallId),
				toolCalls: upsertToolCall(state.toolCalls, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
					status: "running",
					startedAt,
					updatedAt: startedAt,
					partialResult: undefined,
					result: undefined,
					completedAt: undefined,
				}),
			};
		}

		case "tool_execution_update": {
			const existingToolCall = findToolCall(state.toolCalls, event.toolCallId);
			const updatedAt = Date.now();

			return {
				...state,
				pendingToolCalls: addPendingToolCall(state.pendingToolCalls, event.toolCallId),
				toolCalls: upsertToolCall(state.toolCalls, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
					status: "running",
					startedAt: existingToolCall?.startedAt ?? updatedAt,
					updatedAt,
					partialResult: event.partialResult,
					completedAt: undefined,
				}),
			};
		}

		case "tool_execution_end": {
			const existingToolCall = findToolCall(state.toolCalls, event.toolCallId);
			const completedAt = Date.now();
			const taskProgress =
				event.toolName === DESKTOP_TASK_PROGRESS_TOOL_NAME && !event.isError
					? resolveDesktopTaskProgressToolResult(event.result)
					: undefined;

			return {
				...state,
				taskProgress: taskProgress ?? state.taskProgress,
				pendingToolCalls: removePendingToolCall(state.pendingToolCalls, event.toolCallId),
				toolCalls: upsertToolCall(state.toolCalls, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: existingToolCall?.args ?? {},
					status: event.isError ? "error" : "completed",
					startedAt: existingToolCall?.startedAt ?? completedAt,
					updatedAt: completedAt,
					completedAt,
					partialResult: existingToolCall?.partialResult,
					result: event.result,
				}),
			};
		}

		case "compaction_start": {
			return {
				...state,
				bridgeError: undefined,
				compactionActivity: {
					reason: event.reason,
					startedAt: Date.now(),
				},
			};
		}

		case "compaction_end":
			return {
				...state,
				compactionActivity: undefined,
				errorMessage: event.errorMessage ?? state.errorMessage,
			};
	}
}

export function updateSessionSummariesForAgentEvent(
	sessions: DesktopSessionSummary[],
	event: SerializedAgentEvent,
): DesktopSessionSummary[] {
	const sessionIndex = sessions.findIndex((session) => session.id === event.sessionId);
	if (sessionIndex === -1) {
		return sessions;
	}

	const nextSessions = sessions.slice();
	const session = sessions[sessionIndex]!;
	const now = new Date().toISOString();

	switch (event.type) {
		case "agent_start":
			nextSessions[sessionIndex] = {
				...session,
				isStreaming: true,
				runStartedAt: session.runStartedAt ?? now,
				updatedAt: now,
			};
			break;

		case "session_title_update":
			nextSessions[sessionIndex] = {
				...session,
				title: event.title,
				updatedAt: now,
			};
			break;

		case "message_end": {
			nextSessions[sessionIndex] = {
				...session,
				messageCount: session.messageCount + 1,
				updatedAt: now,
			};
			break;
		}

		case "agent_end":
			nextSessions[sessionIndex] = {
				...session,
				isStreaming: false,
				runStartedAt: undefined,
				updatedAt: now,
			};
			break;

		default:
			break;
	}

	return nextSessions;
}

export function updateSessionSummariesForProfileSnapshot(
	sessions: DesktopSessionSummary[],
	snapshot: DesktopAgentSnapshot,
): DesktopSessionSummary[] {
	const sessionIndex = sessions.findIndex((session) => session.id === snapshot.sessionId);
	if (sessionIndex === -1) {
		return sessions;
	}

	const session = sessions[sessionIndex]!;
	const nextSession: DesktopSessionSummary = {
		...session,
		agentMode: snapshot.agentMode,
		provider: snapshot.model?.provider ?? session.provider,
		modelId: snapshot.model?.id ?? session.modelId,
		isStreaming: snapshot.isStreaming,
	};

	if (
		nextSession.provider === session.provider &&
		nextSession.modelId === session.modelId &&
		nextSession.agentMode === session.agentMode &&
		nextSession.isStreaming === session.isStreaming
	) {
		return sessions;
	}

	const nextSessions = sessions.slice();
	nextSessions[sessionIndex] = nextSession;
	return nextSessions;
}

export function updateProjectSessionSummariesForAgentEvent(
	sessions: DesktopSessionSummary[],
	event: SerializedAgentEvent,
): DesktopSessionSummary[] {
	const previousSession = sessions.find((session) => session.id === event.sessionId);
	const nextSessions = updateSessionSummariesForAgentEvent(sessions, event);
	const userMessageText = getUserMessageText(event);
	if (!previousSession || previousSession.messageCount > 0 || !userMessageText) {
		return nextSessions;
	}

	return replaceSessionSummary(nextSessions, {
		...previousSession,
		...nextSessions.find((session) => session.id === event.sessionId),
		title: userMessageText.slice(0, 80),
	});
}
