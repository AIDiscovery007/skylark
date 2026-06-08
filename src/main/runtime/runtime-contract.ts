import type { AgentMessage, AgentState } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { CompactionResult } from "@earendil-works/pi-coding-agent";
import type {
	DesktopAgentDiagnostic,
	DesktopAgentMessageWindow,
	DesktopAgentModel,
	DesktopAgentSnapshot,
} from "../../shared/serialized-agent-event.ts";
import type {
	DesktopAgentMode,
	DesktopCapabilityCatalog,
	DesktopCapabilityDetail,
	DesktopCapabilityDetailRequest,
	DesktopCreateSkillRequest,
	DesktopMcpServerSummary,
	DesktopMcpServerUpsertRequest,
	DesktopPersistedSession,
	DesktopProjectSummary,
	DesktopPromptSubmission,
	DesktopPromptTemplateDeleteRequest,
	DesktopPromptTemplateUpsertRequest,
	DesktopSessionSummary,
	DesktopSettingKey,
	DesktopSettingsData,
	DesktopTaskProgress,
} from "../../shared/types.ts";
import { resolveDesktopAgentMode, resolveDesktopTaskProgress } from "../../shared/types.ts";
import { hydrateDesktopModelMetadata } from "./desktop-model-catalog.ts";
import type { SerializableAgentEvent } from "./serialize-agent-event.ts";

export interface DesktopAgentRuntime {
	readonly cwd: string;
	readonly agentMode: DesktopAgentMode;
	readonly diagnostics: readonly DesktopAgentDiagnostic[];
	readonly availableTools: readonly string[];
	readonly taskProgress?: DesktopTaskProgress;
	getState(): AgentState;
	setAgentMode(agentMode: DesktopAgentMode): void;
	applySessionProfile?(update: {
		model: Model<any>;
		thinkingLevel: AgentState["thinkingLevel"];
		apiKey?: string;
	}): Promise<void>;
	prompt(request: DesktopPromptSubmission | string): Promise<void>;
	compact(customInstructions?: string): Promise<CompactionResult>;
	abort(): void;
	waitForIdle(): Promise<void>;
	subscribe(listener: (event: SerializableAgentEvent) => void): () => void;
	dispose?(): Promise<void> | void;
	listCapabilities?(): Promise<DesktopCapabilityCatalog>;
	getCapabilityDetail?(request: DesktopCapabilityDetailRequest): Promise<DesktopCapabilityDetail>;
	createSkill?(request: DesktopCreateSkillRequest): Promise<DesktopCapabilityCatalog>;
	upsertPromptTemplate?(request: DesktopPromptTemplateUpsertRequest): Promise<DesktopCapabilityCatalog>;
	deletePromptTemplate?(request: DesktopPromptTemplateDeleteRequest): Promise<DesktopCapabilityCatalog>;
	upsertMcpServer?(request: DesktopMcpServerUpsertRequest): Promise<DesktopCapabilityCatalog>;
	setMcpServerEnabled?(serverId: string, enabled: boolean): Promise<DesktopCapabilityCatalog>;
	testMcpServer?(serverId: string): Promise<DesktopMcpServerSummary>;
	restartMcpServer?(serverId: string): Promise<DesktopCapabilityCatalog>;
	reloadCapabilities?(): Promise<DesktopCapabilityCatalog>;
}

export interface DesktopRuntimeHostPersistence {
	projectStore?: {
		createOrGet(cwd: string): Promise<DesktopProjectSummary>;
		get(projectId: string): Promise<DesktopProjectSummary | null>;
		list(): Promise<DesktopProjectSummary[]>;
		listWithSessionStats(sessions: readonly DesktopSessionSummary[]): Promise<DesktopProjectSummary[]>;
		updateLastOpenedSession(projectId: string, sessionId: string | undefined): Promise<DesktopProjectSummary | null>;
	};
	sessionStore: {
		create(options: {
			id?: string;
			cwd: string;
			model: DesktopPersistedSession["model"];
			thinkingLevel: DesktopPersistedSession["thinkingLevel"];
			messages?: DesktopPersistedSession["messages"];
			title?: string;
			agentMode?: DesktopAgentMode;
		}): Promise<DesktopPersistedSession>;
		get(sessionId: string): Promise<DesktopPersistedSession | null>;
		delete(sessionId: string): Promise<boolean>;
		list(): Promise<DesktopSessionSummary[]>;
		save(session: DesktopPersistedSession): Promise<DesktopPersistedSession>;
	};
	settingsStore: {
		get<TKey extends DesktopSettingKey>(key: TKey): Promise<DesktopSettingsData[TKey]>;
		set<TKey extends DesktopSettingKey>(key: TKey, value: DesktopSettingsData[TKey]): Promise<void>;
	};
	instructionStore?: {
		getCompactInstruction(): Promise<string>;
	};
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	agentDir?: string;
	agentSessionsDir?: string;
	defaultCwd: string;
}

function serializeModel(state: AgentState): DesktopAgentModel | undefined {
	const model = hydrateDesktopModelMetadata(state.model);
	if (!model?.id || !model.provider || !model.name) {
		return undefined;
	}

	return {
		id: model.id,
		provider: model.provider,
		name: model.name,
		reasoning: model.reasoning,
		contextWindow: model.contextWindow,
	};
}

export function areStringArraysEqual(left: readonly string[] | undefined, right: readonly string[]): boolean {
	if (!left || left.length !== right.length) {
		return false;
	}
	return left.every((value, index) => value === right[index]);
}

export function areTaskProgressValuesEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(resolveDesktopTaskProgress(left)) === JSON.stringify(resolveDesktopTaskProgress(right));
}

export async function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
	let timeout: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<undefined>((resolve) => {
				timeout = setTimeout(() => resolve(undefined), timeoutMs);
				timeout.unref();
			}),
		]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

export function createDesktopAgentSnapshot(
	sessionId: string,
	runtime: DesktopAgentRuntime,
	options: { consumedProposedPlanMessageIds?: readonly string[]; messageWindowLimit?: number } = {},
): DesktopAgentSnapshot {
	const state = runtime.getState();
	const messageWindow = sliceLatestMessages(state.messages, options.messageWindowLimit);

	return {
		sessionId,
		cwd: runtime.cwd,
		agentMode: resolveDesktopAgentMode(runtime.agentMode),
		consumedProposedPlanMessageIds: [...(options.consumedProposedPlanMessageIds ?? [])],
		taskProgress: resolveDesktopTaskProgress(runtime.taskProgress),
		diagnostics: [...runtime.diagnostics],
		model: serializeModel(state),
		thinkingLevel: state.thinkingLevel,
		availableTools: [...runtime.availableTools],
		messages: messageWindow.messages,
		...(messageWindow.window ? { messageWindow: messageWindow.window } : {}),
		streamingMessage: state.streamingMessage,
		pendingToolCalls: Array.from(state.pendingToolCalls),
		isStreaming: state.isStreaming,
		errorMessage: state.errorMessage,
	};
}

function createMessageWindow(total: number, start: number, end: number): DesktopAgentMessageWindow {
	return {
		start,
		end,
		total,
		hasMoreBefore: start > 0,
	};
}

export function sliceMessagesBefore(
	messages: readonly AgentMessage[],
	before: number,
	limit: number,
): { messages: AgentMessage[]; window: DesktopAgentMessageWindow } {
	const total = messages.length;
	const safeBefore = Math.min(Math.max(0, before), total);
	const safeLimit = Math.max(1, limit);
	const start = Math.max(0, safeBefore - safeLimit);
	const end = safeBefore;
	return {
		messages: messages.slice(start, end),
		window: createMessageWindow(total, start, end),
	};
}

function sliceLatestMessages(
	messages: readonly AgentMessage[],
	limit: number | undefined,
): { messages: AgentMessage[]; window?: DesktopAgentMessageWindow } {
	if (limit === undefined || messages.length <= limit) {
		return { messages: [...messages] };
	}

	const end = messages.length;
	const start = Math.max(0, end - Math.max(1, limit));
	return {
		messages: messages.slice(start, end),
		window: createMessageWindow(messages.length, start, end),
	};
}
