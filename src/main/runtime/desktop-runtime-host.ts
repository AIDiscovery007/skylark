import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AgentState } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { CompactionResult } from "@earendil-works/pi-coding-agent";
import type {
	DesktopAgentDiagnostic,
	DesktopAgentModel,
	DesktopAgentSnapshot,
	SerializedAgentEvent,
} from "../../shared/serialized-agent-event.ts";
import { clampDesktopThinkingLevelForModel } from "../../shared/thinking-levels.ts";
import type {
	DesktopAgentMode,
	DesktopCapabilityCatalog,
	DesktopCapabilityDetail,
	DesktopCapabilityDetailRequest,
	DesktopConsumeProposedPlanRequest,
	DesktopCreateSkillRequest,
	DesktopExecutePlanRequest,
	DesktopMcpServerSummary,
	DesktopMcpServerUpsertRequest,
	DesktopPersistedSession,
	DesktopProjectSummary,
	DesktopPromptSubmission,
	DesktopPromptTemplateDeleteRequest,
	DesktopPromptTemplateUpsertRequest,
	DesktopReviewSnapshotRequest,
	DesktopSessionModeUpdateRequest,
	DesktopSessionProfileUpdateRequest,
	DesktopSessionSummary,
	DesktopSettingKey,
	DesktopSettingsData,
	DesktopTaskProgress,
	DesktopWorkspaceOverview,
} from "../../shared/types.ts";
import {
	DESKTOP_TASK_PROGRESS_TOOL_NAME,
	resolveConsumedProposedPlanMessageIds,
	resolveDesktopAgentMode,
	resolveDesktopTaskProgress,
} from "../../shared/types.ts";
import { measureMainAsync } from "../performance.ts";
import {
	deriveFallbackSessionTitleFromText,
	getFirstUserMessageText,
	isGenericSessionTitle,
} from "../session-title-utils.ts";
import { normalizeProjectCwd } from "../storage/project-store.ts";
import { normalizeDesktopProviderIdentifier } from "../storage/provider-id.ts";
import {
	type CreateDesktopAgentRuntimeOptions,
	findDesktopCatalogModel,
	hydrateDesktopModelMetadata,
} from "./create-runtime.ts";
import { type SerializableAgentEvent, serializeAgentEvent } from "./serialize-agent-event.ts";
import { generateSessionTitleFromPrompt } from "./session-title-generator.ts";

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

interface DesktopRuntimeEntry {
	sessionId: string;
	session?: DesktopPersistedSession;
	runtime?: DesktopAgentRuntime;
	runtimePromise?: Promise<DesktopAgentRuntime>;
	runtimeSubscription?: () => void;
	saveQueue: Promise<void>;
	activeRun?: Promise<void>;
	titleGeneration?: Promise<void>;
	runStartedAt?: string;
}

const DEFAULT_SESSION_ID = "default";
const EXECUTE_PLAN_PROMPT = "开始执行上面的计划。";
const RUNTIME_DISPOSE_TIMEOUT_MS = 2_000;

type CapabilityRuntime = Required<
	Pick<
		DesktopAgentRuntime,
		| "createSkill"
		| "deletePromptTemplate"
		| "getCapabilityDetail"
		| "listCapabilities"
		| "reloadCapabilities"
		| "restartMcpServer"
		| "setMcpServerEnabled"
		| "testMcpServer"
		| "upsertMcpServer"
		| "upsertPromptTemplate"
	>
>;

function requireCapabilityRuntime(runtime: DesktopAgentRuntime): CapabilityRuntime {
	if (
		!runtime.listCapabilities ||
		!runtime.getCapabilityDetail ||
		!runtime.createSkill ||
		!runtime.upsertPromptTemplate ||
		!runtime.deletePromptTemplate ||
		!runtime.upsertMcpServer ||
		!runtime.setMcpServerEnabled ||
		!runtime.testMcpServer ||
		!runtime.restartMcpServer ||
		!runtime.reloadCapabilities
	) {
		throw new Error("Desktop runtime does not support capability management.");
	}
	return runtime as CapabilityRuntime;
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

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

function areStringArraysEqual(left: readonly string[] | undefined, right: readonly string[]): boolean {
	if (!left || left.length !== right.length) {
		return false;
	}
	return left.every((value, index) => value === right[index]);
}

function areTaskProgressValuesEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(resolveDesktopTaskProgress(left)) === JSON.stringify(resolveDesktopTaskProgress(right));
}

async function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
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

function isNonFatalManualCompactionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("Nothing to compact") || message.includes("Already compacted");
}

export function createDesktopAgentSnapshot(
	sessionId: string,
	runtime: DesktopAgentRuntime,
	options: { consumedProposedPlanMessageIds?: readonly string[] } = {},
): DesktopAgentSnapshot {
	const state = runtime.getState();

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
		messages: [...state.messages],
		streamingMessage: state.streamingMessage,
		pendingToolCalls: Array.from(state.pendingToolCalls),
		isStreaming: state.isStreaming,
		errorMessage: state.errorMessage,
	};
}

export class DesktopRuntimeHost {
	private listeners = new Set<(event: SerializedAgentEvent) => void>();
	private entries = new Map<string, DesktopRuntimeEntry>();
	private activeProjectId?: string;
	private activeSessionId?: string;
	private hasMeasuredFirstPrompt = false;
	private switchSessionRequestSerial = 0;

	constructor(
		private readonly createRuntime: (options?: CreateDesktopAgentRuntimeOptions) => Promise<DesktopAgentRuntime>,
		private readonly persistence?: DesktopRuntimeHostPersistence,
	) {}

	private broadcast(sessionId: string, event: SerializableAgentEvent): void {
		const serialized = {
			...serializeAgentEvent(event),
			sessionId,
		} as SerializedAgentEvent;
		for (const listener of this.listeners) {
			listener(serialized);
		}
	}

	private shouldPersistEvent(event: SerializableAgentEvent): boolean {
		return (
			event.type === "message_end" ||
			event.type === "agent_end" ||
			(event.type === "tool_execution_end" &&
				event.toolName === DESKTOP_TASK_PROGRESS_TOOL_NAME &&
				event.isError === false)
		);
	}

	private queuePersistence(entry: DesktopRuntimeEntry): void {
		if (!this.persistence) {
			return;
		}

		entry.saveQueue = entry.saveQueue
			.catch(() => undefined)
			.then(async () => {
				await this.persistSessionEntry(entry);
			});
	}

	private createSessionPayload(
		runtime: DesktopAgentRuntime,
		session: DesktopPersistedSession,
	): DesktopPersistedSession {
		const state = runtime.getState();
		const now = new Date().toISOString();

		return {
			id: session.id,
			title: session.title,
			cwd: runtime.cwd,
			createdAt: session.createdAt,
			updatedAt: now,
			sessionFilePath: session.sessionFilePath,
			agentMode: resolveDesktopAgentMode(runtime.agentMode),
			consumedProposedPlanMessageIds: resolveConsumedProposedPlanMessageIds(session.consumedProposedPlanMessageIds),
			taskProgress: resolveDesktopTaskProgress(runtime.taskProgress),
			model: hydrateDesktopModelMetadata(state.model),
			thinkingLevel: state.thinkingLevel,
			messages: [...state.messages],
		};
	}

	private hydratePersistedSession(session: DesktopPersistedSession): DesktopPersistedSession {
		const hydratedModel = hydrateDesktopModelMetadata(session.model);
		const agentMode = resolveDesktopAgentMode(session.agentMode);
		const consumedProposedPlanMessageIds = resolveConsumedProposedPlanMessageIds(
			session.consumedProposedPlanMessageIds,
		);
		const taskProgress = resolveDesktopTaskProgress(session.taskProgress);
		if (
			hydratedModel === session.model &&
			session.agentMode === agentMode &&
			areStringArraysEqual(session.consumedProposedPlanMessageIds, consumedProposedPlanMessageIds) &&
			areTaskProgressValuesEqual(session.taskProgress, taskProgress)
		) {
			return session;
		}

		return {
			...session,
			agentMode,
			consumedProposedPlanMessageIds,
			taskProgress,
			model: hydratedModel,
		};
	}

	private createSnapshotForEntry(entry: DesktopRuntimeEntry, runtime: DesktopAgentRuntime): DesktopAgentSnapshot {
		return createDesktopAgentSnapshot(entry.sessionId, runtime, {
			consumedProposedPlanMessageIds: entry.session?.consumedProposedPlanMessageIds,
		});
	}

	private createEntry(sessionId: string, session?: DesktopPersistedSession): DesktopRuntimeEntry {
		const entry: DesktopRuntimeEntry = {
			sessionId,
			session,
			saveQueue: Promise.resolve(),
		};
		this.entries.set(sessionId, entry);
		return entry;
	}

	private async persistSessionEntry(entry: DesktopRuntimeEntry): Promise<void> {
		if (!this.persistence || !entry.runtime || !entry.session) {
			return;
		}

		const nextSession = this.createSessionPayload(entry.runtime, entry.session);
		entry.session = await this.persistence.sessionStore.save(nextSession);
	}

	private queueSessionTitleGeneration(
		entry: DesktopRuntimeEntry,
		runtime: DesktopAgentRuntime,
		promptText: string,
	): void {
		if (!this.persistence || !entry.session || entry.titleGeneration) {
			return;
		}

		const titlePrompt = promptText.trim() || getFirstUserMessageText(runtime.getState().messages)?.trim();
		if (!titlePrompt) {
			return;
		}

		const fallbackTitle = deriveFallbackSessionTitleFromText(titlePrompt);
		if (!isGenericSessionTitle(entry.session.title) && entry.session.title !== fallbackTitle) {
			return;
		}

		entry.titleGeneration = (async () => {
			try {
				const state = runtime.getState();
				const model = hydrateDesktopModelMetadata(state.model);
				const title = await generateSessionTitleFromPrompt({
					text: titlePrompt,
					model,
					apiKey: await this.persistence?.getApiKey?.(model.provider),
				});
				if (
					!entry.session ||
					!this.persistence ||
					(!isGenericSessionTitle(entry.session.title) && entry.session.title !== fallbackTitle)
				) {
					return;
				}

				entry.session = await this.persistence.sessionStore.save({
					...entry.session,
					title,
					updatedAt: new Date().toISOString(),
				});
				this.broadcast(entry.sessionId, { type: "session_title_update", title });
			} finally {
				entry.titleGeneration = undefined;
			}
		})();
	}

	private async resolveSessionProfileModel(
		currentModel: Model<any>,
		update: DesktopSessionProfileUpdateRequest,
	): Promise<{ apiKey?: string; model: Model<any> }> {
		if (update.provider === undefined && update.modelId === undefined) {
			return { model: currentModel };
		}

		const provider = normalizeDesktopProviderIdentifier(update.provider ?? currentModel.provider);
		const modelId = update.modelId ?? currentModel.id;
		const model = findDesktopCatalogModel(provider, modelId);
		if (!model) {
			throw new Error(`Model '${modelId}' is unavailable for provider '${provider}'.`);
		}

		const apiKey = await this.persistence?.getApiKey?.(provider);
		if (!apiKey) {
			throw new Error(`Provider '${provider}' has no usable API key in desktop settings or environment.`);
		}

		return { apiKey, model: hydrateDesktopModelMetadata(model) };
	}

	private sessionBelongsToProject(
		session: DesktopSessionSummary | DesktopPersistedSession,
		project: DesktopProjectSummary,
	): boolean {
		return normalizeProjectCwd(session.cwd) === normalizeProjectCwd(project.cwd);
	}

	private filterSessionsForProject(
		sessions: DesktopSessionSummary[],
		project: DesktopProjectSummary,
	): DesktopSessionSummary[] {
		return sessions.filter((session) => this.sessionBelongsToProject(session, project));
	}

	private async ensureProjectsForKnownCwds(
		knownSessions?: readonly DesktopSessionSummary[],
	): Promise<readonly DesktopSessionSummary[]> {
		const projectStore = this.persistence?.projectStore;
		if (!this.persistence || !projectStore) {
			return [];
		}

		const sessions = knownSessions ?? (await this.persistence.sessionStore.list());
		for (const session of sessions) {
			await projectStore.createOrGet(session.cwd);
		}
		return sessions;
	}

	private async listDecoratedProjects(): Promise<DesktopProjectSummary[]> {
		if (!this.persistence?.projectStore) {
			return [];
		}

		const sessions = await this.ensureProjectsForKnownCwds();
		return this.persistence.projectStore.listWithSessionStats(sessions);
	}

	private buildSessionsByProjectId(
		projects: readonly DesktopProjectSummary[],
		sessions: DesktopSessionSummary[],
	): Record<string, DesktopSessionSummary[]> {
		const decoratedSessions = this.decorateSessionSummaries(sessions);
		return Object.fromEntries(
			projects.map((project) => [project.id, this.filterSessionsForProject(decoratedSessions, project)]),
		);
	}

	private async findProject(projectId: string): Promise<DesktopProjectSummary | undefined> {
		const projectStore = this.persistence?.projectStore;
		if (!projectStore) {
			return undefined;
		}

		await this.ensureProjectsForKnownCwds();
		return (await projectStore.get(projectId)) ?? undefined;
	}

	private async ensureActiveProject(): Promise<DesktopProjectSummary | undefined> {
		const projectStore = this.persistence?.projectStore;
		if (!this.persistence || !projectStore) {
			return undefined;
		}

		await this.ensureProjectsForKnownCwds();
		if (this.activeProjectId) {
			const activeProject = await projectStore.get(this.activeProjectId);
			if (activeProject) {
				return activeProject;
			}
		}

		const lastOpenedProjectId = await this.persistence.settingsStore.get("lastOpenedProjectId");
		if (lastOpenedProjectId) {
			const lastOpenedProject = await projectStore.get(lastOpenedProjectId);
			if (lastOpenedProject) {
				this.activeProjectId = lastOpenedProject.id;
				return lastOpenedProject;
			}
		}

		const sessions = await this.ensureProjectsForKnownCwds();
		const [firstProject] = await projectStore.listWithSessionStats(sessions);
		if (firstProject) {
			this.activeProjectId = firstProject.id;
			await this.persistence.settingsStore.set("lastOpenedProjectId", firstProject.id);
			return firstProject;
		}

		return undefined;
	}

	private async activateProject(project: DesktopProjectSummary): Promise<void> {
		if (!this.persistence) {
			return;
		}

		this.activeProjectId = project.id;
		await this.persistence.settingsStore.set("lastOpenedProjectId", project.id);
	}

	private async setActiveSession(entry: DesktopRuntimeEntry, project?: DesktopProjectSummary): Promise<void> {
		this.activeSessionId = entry.sessionId;
		if (!this.persistence) {
			return;
		}

		await this.persistence.settingsStore.set("lastOpenedSessionId", entry.sessionId);
		if (project && this.persistence.projectStore) {
			await this.persistence.projectStore.updateLastOpenedSession(project.id, entry.sessionId);
			await this.activateProject(project);
		}
	}

	private async findProjectForSession(session: DesktopPersistedSession): Promise<DesktopProjectSummary | undefined> {
		const projectStore = this.persistence?.projectStore;
		if (!projectStore) {
			return undefined;
		}

		return projectStore.createOrGet(session.cwd);
	}

	private async findPreferredSessionForProject(
		project: DesktopProjectSummary,
		knownSessions?: readonly DesktopSessionSummary[],
	): Promise<DesktopRuntimeEntry | undefined> {
		if (!this.persistence) {
			return undefined;
		}

		const sessionSummaries = knownSessions ?? (await this.persistence.sessionStore.list());
		const sessions = this.filterSessionsForProject([...sessionSummaries], project);
		const preferredSessionIds = [
			project.lastOpenedSessionId,
			await this.persistence.settingsStore.get("lastOpenedSessionId"),
			sessions[0]?.id,
		].filter((sessionId): sessionId is string => Boolean(sessionId));

		for (const sessionId of preferredSessionIds) {
			const sessionSummary = sessions.find((session) => session.id === sessionId);
			if (!sessionSummary) {
				continue;
			}

			const entry = await this.loadSessionEntry(sessionSummary.id);
			if (entry?.session && this.sessionBelongsToProject(entry.session, project)) {
				return entry;
			}
		}

		return undefined;
	}

	private decorateSessionSummary(session: DesktopSessionSummary): DesktopSessionSummary {
		const entry = this.entries.get(session.id);
		if (!entry) {
			return session;
		}

		const isStreaming = this.isEntryRunning(entry);
		return {
			...session,
			isStreaming,
			runStartedAt: isStreaming ? entry.runStartedAt : undefined,
		};
	}

	private decorateSessionSummaries(sessions: DesktopSessionSummary[]): DesktopSessionSummary[] {
		return sessions.map((session) => this.decorateSessionSummary(session));
	}

	private async findSessionSummary(sessionId: string): Promise<DesktopSessionSummary | undefined> {
		if (!this.persistence) {
			return undefined;
		}

		const sessions = await this.persistence.sessionStore.list();
		return this.decorateSessionSummaries(sessions).find((session) => session.id === sessionId);
	}

	private isEntryRunning(entry: DesktopRuntimeEntry): boolean {
		return Boolean(entry.activeRun) || entry.runtime?.getState().isStreaming === true;
	}

	private async deleteAgentSessionTranscript(sessionId: string): Promise<void> {
		if (!this.persistence?.agentSessionsDir) {
			return;
		}

		try {
			await unlink(join(this.persistence.agentSessionsDir, `${sessionId}.jsonl`));
		} catch (error) {
			if (!isMissingFileError(error)) {
				throw error;
			}
		}
	}

	private releaseEntry(entry: DesktopRuntimeEntry | undefined): void {
		if (!entry) {
			return;
		}

		entry.runtimeSubscription?.();
		entry.runtimeSubscription = undefined;
		this.entries.delete(entry.sessionId);
	}

	private async discardEntryRuntime(entry: DesktopRuntimeEntry): Promise<void> {
		entry.runtimeSubscription?.();
		entry.runtimeSubscription = undefined;
		const runtime = entry.runtime;
		entry.runtime = undefined;
		entry.runtimePromise = undefined;
		if (runtime) {
			try {
				await Promise.resolve(runtime.dispose?.());
			} catch {}
		}
	}

	private getAdjacentReplacementCandidates(
		sessions: DesktopSessionSummary[],
		deletedSessionId: string,
	): DesktopSessionSummary[] {
		const deletedSessionIndex = sessions.findIndex((session) => session.id === deletedSessionId);
		if (deletedSessionIndex === -1) {
			return sessions.filter((session) => session.id !== deletedSessionId);
		}

		const sessionsBelowDeleted = sessions.slice(deletedSessionIndex + 1);
		const sessionsAboveDeleted = sessions.slice(0, deletedSessionIndex).reverse();
		return [...sessionsBelowDeleted, ...sessionsAboveDeleted].filter((session) => session.id !== deletedSessionId);
	}

	private async findReplacementSessionEntry(
		deletedSession: DesktopPersistedSession,
		project: DesktopProjectSummary | undefined,
	): Promise<DesktopRuntimeEntry | undefined> {
		if (!this.persistence) {
			return undefined;
		}

		const sessions = await this.persistence.sessionStore.list();
		const projectSessions = project ? this.filterSessionsForProject(sessions, project) : sessions;
		const candidates = this.getAdjacentReplacementCandidates(projectSessions, deletedSession.id);
		for (const candidate of candidates) {
			const entry = await this.loadSessionEntry(candidate.id);
			if (!entry?.session) {
				continue;
			}

			if (!project || this.sessionBelongsToProject(entry.session, project)) {
				return entry;
			}
		}

		return undefined;
	}

	private async ensureTransientProjectRuntime(
		project: DesktopProjectSummary | undefined,
	): Promise<DesktopAgentRuntime> {
		const entryId = `transient:${project?.id ?? "default"}`;
		const existingEntry = this.entries.get(entryId);
		const entry = existingEntry ?? this.createEntry(entryId);
		if (entry.runtime) {
			return entry.runtime;
		}

		if (!entry.runtimePromise) {
			entry.runtimePromise = (async () => {
				const runtime = await this.createRuntime({
					cwd: project?.cwd ?? this.persistence?.defaultCwd ?? process.cwd(),
					messages: [],
					agentMode: "execute",
				});
				return this.attachRuntime(entry, runtime);
			})();
		}

		return entry.runtimePromise;
	}

	private async getCapabilityRuntime(): Promise<DesktopAgentRuntime> {
		if (this.activeSessionId) {
			const activeEntry = await this.loadSessionEntry(this.activeSessionId);
			if (activeEntry) {
				return this.ensureRuntimeForEntry(activeEntry);
			}
		}

		const project = await this.ensureActiveProject();
		if (project) {
			const sessionEntry = await this.findPreferredSessionForProject(project);
			if (sessionEntry) {
				await this.setActiveSession(sessionEntry, project);
				return this.ensureRuntimeForEntry(sessionEntry);
			}
		}

		return this.ensureTransientProjectRuntime(project);
	}

	private attachRuntime(entry: DesktopRuntimeEntry, runtime: DesktopAgentRuntime): DesktopAgentRuntime {
		entry.runtime = runtime;
		entry.runtimeSubscription?.();
		entry.runtimeSubscription = runtime.subscribe((event) => {
			this.broadcast(entry.sessionId, event);
			if (this.shouldPersistEvent(event)) {
				this.queuePersistence(entry);
			}
		});
		return runtime;
	}

	private async ensureRuntimeForEntry(
		entry: DesktopRuntimeEntry,
		options: Partial<CreateDesktopAgentRuntimeOptions> = {},
	): Promise<DesktopAgentRuntime> {
		if (entry.runtime) {
			return entry.runtime;
		}

		if (!entry.runtimePromise) {
			entry.runtimePromise = (async () => {
				const session = entry.session;
				const runtime = await this.createRuntime({
					sessionId: entry.sessionId,
					...(session?.title ? { sessionTitle: session.title } : {}),
					cwd: session?.cwd ?? this.persistence?.defaultCwd ?? process.cwd(),
					model: session?.model,
					thinkingLevel: session?.thinkingLevel,
					messages: session?.messages ?? [],
					agentMode: resolveDesktopAgentMode(session?.agentMode),
					taskProgress: resolveDesktopTaskProgress(session?.taskProgress),
					agentDir: this.persistence?.agentDir,
					agentSessionsDir: this.persistence?.agentSessionsDir,
					sessionFilePath: session?.sessionFilePath,
					...options,
				});
				return this.attachRuntime(entry, runtime);
			})();
		}

		return entry.runtimePromise;
	}

	private async createInitialSessionEntry(project?: DesktopProjectSummary): Promise<DesktopRuntimeEntry | undefined> {
		if (!this.persistence) {
			return undefined;
		}

		const sessionId = randomUUID();
		const entry = this.createEntry(sessionId);
		const cwd = project?.cwd ?? this.persistence.defaultCwd;
		const runtime = await this.ensureRuntimeForEntry(entry, {
			cwd,
			messages: [],
		});
		const state = runtime.getState();
		const createdSession = await this.persistence.sessionStore.create({
			id: sessionId,
			cwd: runtime.cwd,
			model: hydrateDesktopModelMetadata(state.model),
			thinkingLevel: state.thinkingLevel,
			messages: [],
			agentMode: runtime.agentMode,
		});
		entry.session = createdSession;
		if (createdSession.sessionFilePath) {
			await this.discardEntryRuntime(entry);
			await this.ensureRuntimeForEntry(entry);
		}
		await this.setActiveSession(entry, project);
		return entry;
	}

	private async loadSessionEntry(sessionId: string): Promise<DesktopRuntimeEntry | undefined> {
		if (!this.persistence) {
			return this.ensureStandaloneEntry();
		}

		const existingEntry = this.entries.get(sessionId);
		if (existingEntry) {
			return existingEntry;
		}

		const persistedSession = await this.persistence.sessionStore.get(sessionId);
		if (!persistedSession) {
			return undefined;
		}

		const hydratedSession = this.hydratePersistedSession(persistedSession);
		if (hydratedSession !== persistedSession) {
			await this.persistence.sessionStore.save(hydratedSession);
		}

		return this.createEntry(hydratedSession.id, hydratedSession);
	}

	private async ensureStandaloneEntry(): Promise<DesktopRuntimeEntry> {
		const existingEntry = this.entries.get(DEFAULT_SESSION_ID);
		if (existingEntry) {
			this.activeSessionId = DEFAULT_SESSION_ID;
			return existingEntry;
		}

		const entry = this.createEntry(DEFAULT_SESSION_ID);
		this.activeSessionId = DEFAULT_SESSION_ID;
		return entry;
	}

	private async ensureActiveSessionEntry(): Promise<DesktopRuntimeEntry> {
		if (!this.persistence) {
			return this.ensureStandaloneEntry();
		}

		const activeProject = await this.ensureActiveProject();
		if (activeProject) {
			if (this.activeSessionId) {
				const activeEntry = await this.loadSessionEntry(this.activeSessionId);
				if (activeEntry?.session && this.sessionBelongsToProject(activeEntry.session, activeProject)) {
					return activeEntry;
				}
			}

			const preferredEntry = await this.findPreferredSessionForProject(activeProject);
			if (preferredEntry) {
				await this.setActiveSession(preferredEntry, activeProject);
				return preferredEntry;
			}

			const createdEntry = await this.createInitialSessionEntry(activeProject);
			if (createdEntry) {
				return createdEntry;
			}
		}

		if (this.activeSessionId) {
			const activeEntry = await this.loadSessionEntry(this.activeSessionId);
			if (activeEntry) {
				return activeEntry;
			}
		}

		const lastOpenedSessionId = await this.persistence.settingsStore.get("lastOpenedSessionId");
		if (lastOpenedSessionId) {
			const activeEntry = await this.loadSessionEntry(lastOpenedSessionId);
			if (activeEntry) {
				this.activeSessionId = activeEntry.sessionId;
				return activeEntry;
			}
		}

		const createdEntry = await this.createInitialSessionEntry();
		if (!createdEntry) {
			return this.ensureStandaloneEntry();
		}
		return createdEntry;
	}

	private async ensureSessionEntry(sessionId?: string): Promise<DesktopRuntimeEntry> {
		if (!sessionId) {
			return this.ensureActiveSessionEntry();
		}

		if (!this.persistence) {
			const standaloneEntry = await this.ensureStandaloneEntry();
			if (sessionId !== standaloneEntry.sessionId) {
				throw new Error(`Unknown session '${sessionId}'`);
			}
			return standaloneEntry;
		}

		const entry = await this.loadSessionEntry(sessionId);
		if (!entry) {
			throw new Error(`Unknown session '${sessionId}'`);
		}

		return entry;
	}

	async getSnapshot(sessionId?: string): Promise<DesktopAgentSnapshot> {
		return measureMainAsync("main snapshot load", async () => {
			const entry = await this.ensureSessionEntry(sessionId);
			const runtime = await this.ensureRuntimeForEntry(entry);
			return this.createSnapshotForEntry(entry, runtime);
		});
	}

	private startPromptForEntry(
		entry: DesktopRuntimeEntry,
		runtime: DesktopAgentRuntime,
		request: DesktopPromptSubmission,
		options: { trimText?: boolean } = {},
	): void {
		if (entry.activeRun || runtime.getState().isStreaming) {
			throw new Error(`Session '${entry.sessionId}' is already running.`);
		}

		const text = options.trimText === false ? request.text : request.text.trim();
		const capabilityInvocations = request.capabilityInvocations ?? [];
		const attachments = request.attachments ?? [];
		if (!text && capabilityInvocations.length === 0 && attachments.length === 0) {
			return;
		}

		const titlePrompt = runtime.getState().messages.some((message) => message.role === "user") ? undefined : text;
		entry.runStartedAt = new Date().toISOString();
		const promptPromise = runtime.prompt({
			text,
			...(capabilityInvocations.length > 0 ? { capabilityInvocations } : {}),
			...(attachments.length > 0 ? { attachments } : {}),
		});
		const runPromise = this.hasMeasuredFirstPrompt
			? promptPromise
			: measureMainAsync("main first prompt lifecycle", async () => promptPromise);
		this.hasMeasuredFirstPrompt = true;
		entry.activeRun = runPromise;
		void runPromise
			.catch(() => undefined)
			.then(() => {
				if (entry.activeRun === runPromise) {
					entry.activeRun = undefined;
					entry.runStartedAt = undefined;
				}
				this.queuePersistence(entry);
				if (titlePrompt !== undefined) {
					this.queueSessionTitleGeneration(entry, runtime, titlePrompt);
				}
			});
	}

	async prompt(sessionId: string, request: DesktopPromptSubmission | string): Promise<void> {
		const promptRequest: DesktopPromptSubmission = typeof request === "string" ? { text: request } : request;
		const trimmed = promptRequest.text.trim();
		const capabilityInvocations = promptRequest.capabilityInvocations ?? [];
		const attachments = promptRequest.attachments ?? [];
		if (!trimmed && capabilityInvocations.length === 0 && attachments.length === 0) {
			return;
		}

		const entry = await this.ensureSessionEntry(sessionId);
		const runtime = await this.ensureRuntimeForEntry(entry);
		this.startPromptForEntry(entry, runtime, promptRequest);
	}

	async compact(sessionId: string, customInstructions?: string): Promise<DesktopAgentSnapshot> {
		const entry = await this.ensureSessionEntry(sessionId);
		const runtime = await this.ensureRuntimeForEntry(entry);
		if (entry.activeRun || runtime.getState().isStreaming) {
			throw new Error(`Session '${entry.sessionId}' is already running.`);
		}

		entry.runStartedAt = new Date().toISOString();
		const compactInstructions =
			customInstructions ?? (await this.persistence?.instructionStore?.getCompactInstruction());
		const compactPromise = runtime.compact(compactInstructions).then(() => undefined);
		entry.activeRun = compactPromise;
		try {
			await compactPromise;
		} catch (error) {
			if (!isNonFatalManualCompactionError(error)) {
				throw error;
			}
		} finally {
			if (entry.activeRun === compactPromise) {
				entry.activeRun = undefined;
				entry.runStartedAt = undefined;
			}
			this.queuePersistence(entry);
		}
		return this.createSnapshotForEntry(entry, runtime);
	}

	async updateSessionProfile(request: DesktopSessionProfileUpdateRequest): Promise<DesktopAgentSnapshot> {
		const entry = await this.ensureSessionEntry(request.sessionId);
		const runtime = await this.ensureRuntimeForEntry(entry);
		const state = runtime.getState();
		if (entry.activeRun || state.isStreaming) {
			throw new Error(`Session '${entry.sessionId}' is already running.`);
		}

		const nextProfileModel = await this.resolveSessionProfileModel(state.model, request);
		const nextModel = nextProfileModel.model;
		const nextThinkingLevel =
			request.thinkingLevel === undefined
				? clampDesktopThinkingLevelForModel(state.thinkingLevel, nextModel)
				: clampDesktopThinkingLevelForModel(request.thinkingLevel, nextModel);
		if (runtime.applySessionProfile) {
			await runtime.applySessionProfile({
				...(nextProfileModel.apiKey ? { apiKey: nextProfileModel.apiKey } : {}),
				model: nextModel,
				thinkingLevel: nextThinkingLevel,
			});
		} else {
			state.model = nextModel;
			state.thinkingLevel = nextThinkingLevel;
		}

		await this.persistSessionEntry(entry);
		return this.createSnapshotForEntry(entry, runtime);
	}

	async setSessionMode(request: DesktopSessionModeUpdateRequest): Promise<DesktopAgentSnapshot> {
		const entry = await this.ensureSessionEntry(request.sessionId);
		const runtime = await this.ensureRuntimeForEntry(entry);
		if (entry.activeRun || runtime.getState().isStreaming) {
			throw new Error(`Session '${entry.sessionId}' is already running.`);
		}

		runtime.setAgentMode(request.agentMode);
		if (entry.session) {
			entry.session = {
				...entry.session,
				agentMode: request.agentMode,
			};
			await this.persistSessionEntry(entry);
		}
		return this.createSnapshotForEntry(entry, runtime);
	}

	async consumeProposedPlan(request: DesktopConsumeProposedPlanRequest): Promise<DesktopAgentSnapshot> {
		const entry = await this.ensureSessionEntry(request.sessionId);
		const runtime = await this.ensureRuntimeForEntry(entry);
		if (entry.session) {
			entry.session = {
				...entry.session,
				consumedProposedPlanMessageIds: resolveConsumedProposedPlanMessageIds([
					...(entry.session.consumedProposedPlanMessageIds ?? []),
					request.planMessageId,
				]),
			};
			await this.persistSessionEntry(entry);
		}
		return this.createSnapshotForEntry(entry, runtime);
	}

	async executePlan(request: DesktopExecutePlanRequest): Promise<DesktopAgentSnapshot> {
		const entry = await this.ensureSessionEntry(request.sessionId);
		const runtime = await this.ensureRuntimeForEntry(entry);
		if (entry.activeRun || runtime.getState().isStreaming) {
			throw new Error(`Session '${entry.sessionId}' is already running.`);
		}

		runtime.setAgentMode("execute");
		if (entry.session) {
			entry.session = {
				...entry.session,
				agentMode: "execute",
			};
			await this.persistSessionEntry(entry);
		}
		this.startPromptForEntry(entry, runtime, { text: EXECUTE_PLAN_PROMPT }, { trimText: false });
		return this.createSnapshotForEntry(entry, runtime);
	}

	async abort(sessionId: string): Promise<void> {
		const entry = await this.ensureSessionEntry(sessionId);
		const runtime = await this.ensureRuntimeForEntry(entry);
		runtime.abort();
		await runtime.waitForIdle();
	}

	async resolveReviewWorkspaceCwd(request: DesktopReviewSnapshotRequest): Promise<string | undefined> {
		if (request.projectId) {
			const projectCwd = (await this.findProject(request.projectId))?.cwd;
			if (projectCwd) {
				return projectCwd;
			}
		}

		if (request.sessionId) {
			const entry = await this.loadSessionEntry(request.sessionId);
			return entry?.session?.cwd ?? entry?.runtime?.cwd;
		}

		return undefined;
	}

	async listCapabilities(): Promise<DesktopCapabilityCatalog> {
		const runtime = await this.getCapabilityRuntime();
		return requireCapabilityRuntime(runtime).listCapabilities();
	}

	async getCapabilityDetail(request: DesktopCapabilityDetailRequest): Promise<DesktopCapabilityDetail> {
		const runtime = await this.getCapabilityRuntime();
		return requireCapabilityRuntime(runtime).getCapabilityDetail(request);
	}

	async createSkill(request: DesktopCreateSkillRequest): Promise<DesktopCapabilityCatalog> {
		const runtime = await this.getCapabilityRuntime();
		return requireCapabilityRuntime(runtime).createSkill(request);
	}

	async upsertPromptTemplate(request: DesktopPromptTemplateUpsertRequest): Promise<DesktopCapabilityCatalog> {
		const runtime = await this.getCapabilityRuntime();
		return requireCapabilityRuntime(runtime).upsertPromptTemplate(request);
	}

	async deletePromptTemplate(request: DesktopPromptTemplateDeleteRequest): Promise<DesktopCapabilityCatalog> {
		const runtime = await this.getCapabilityRuntime();
		return requireCapabilityRuntime(runtime).deletePromptTemplate(request);
	}

	async upsertMcpServer(request: DesktopMcpServerUpsertRequest): Promise<DesktopCapabilityCatalog> {
		const runtime = await this.getCapabilityRuntime();
		return requireCapabilityRuntime(runtime).upsertMcpServer(request);
	}

	async setMcpServerEnabled(serverId: string, enabled: boolean): Promise<DesktopCapabilityCatalog> {
		const runtime = await this.getCapabilityRuntime();
		return requireCapabilityRuntime(runtime).setMcpServerEnabled(serverId, enabled);
	}

	async testMcpServer(serverId: string): Promise<DesktopMcpServerSummary> {
		const runtime = await this.getCapabilityRuntime();
		return requireCapabilityRuntime(runtime).testMcpServer(serverId);
	}

	async restartMcpServer(serverId: string): Promise<DesktopCapabilityCatalog> {
		const runtime = await this.getCapabilityRuntime();
		return requireCapabilityRuntime(runtime).restartMcpServer(serverId);
	}

	async reloadCapabilities(): Promise<DesktopCapabilityCatalog> {
		const runtime = await this.getCapabilityRuntime();
		return requireCapabilityRuntime(runtime).reloadCapabilities();
	}

	async listProjects(): Promise<DesktopProjectSummary[]> {
		if (!this.persistence?.projectStore) {
			return [];
		}

		await this.ensureProjectsForKnownCwds();
		return this.listDecoratedProjects();
	}

	async getWorkspaceOverview(): Promise<Omit<DesktopWorkspaceOverview, "settings">> {
		return measureMainAsync("main workspace overview load", async () => {
			if (!this.persistence?.projectStore) {
				return {
					projects: [],
					sessionsByProjectId: {},
				};
			}

			const activeProject = await this.ensureActiveProject();
			const sessions = await this.persistence.sessionStore.list();
			if (activeProject) {
				const sessionEntry = await this.findPreferredSessionForProject(activeProject, sessions);
				if (sessionEntry) {
					await this.setActiveSession(sessionEntry, activeProject);
				} else {
					this.activeSessionId = undefined;
					await this.persistence.projectStore.updateLastOpenedSession(activeProject.id, undefined);
				}
			}

			await this.ensureProjectsForKnownCwds(sessions);
			const projects = await this.persistence.projectStore.listWithSessionStats(sessions);
			return {
				projects,
				sessionsByProjectId: this.buildSessionsByProjectId(projects, sessions),
				activeProjectId: this.activeProjectId,
				activeSessionId: this.activeSessionId,
			};
		});
	}

	async createProject(cwd: string): Promise<DesktopProjectSummary | undefined> {
		const projectStore = this.persistence?.projectStore;
		if (!this.persistence || !projectStore) {
			return undefined;
		}

		const project = await projectStore.createOrGet(cwd);
		await this.activateProject(project);
		const sessionEntry = await this.findPreferredSessionForProject(project);
		if (sessionEntry) {
			await this.setActiveSession(sessionEntry, project);
		} else {
			this.activeSessionId = undefined;
			await projectStore.updateLastOpenedSession(project.id, undefined);
		}
		return (await this.listDecoratedProjects()).find((entry) => entry.id === project.id);
	}

	async switchProject(projectId: string): Promise<DesktopProjectSummary | undefined> {
		const projectStore = this.persistence?.projectStore;
		const project = await this.findProject(projectId);
		if (!project) {
			return undefined;
		}

		await this.activateProject(project);
		const sessionEntry = await this.findPreferredSessionForProject(project);
		if (sessionEntry) {
			await this.setActiveSession(sessionEntry, project);
		} else {
			this.activeSessionId = undefined;
			if (projectStore) {
				await projectStore.updateLastOpenedSession(project.id, undefined);
			}
		}

		return (await this.listDecoratedProjects()).find((entry) => entry.id === project.id);
	}

	async listSessions(projectId?: string): Promise<DesktopSessionSummary[]> {
		if (!this.persistence) {
			return [];
		}

		const project = projectId ? await this.findProject(projectId) : await this.ensureActiveProject();
		if (projectId && !project) {
			return [];
		}

		if (project) {
			const projectSessions = this.filterSessionsForProject(await this.persistence.sessionStore.list(), project);
			return this.decorateSessionSummaries(projectSessions);
		}

		if (this.persistence.projectStore) {
			return [];
		}

		await this.ensureActiveSessionEntry();
		return this.decorateSessionSummaries(await this.persistence.sessionStore.list());
	}

	async newSession(projectId?: string): Promise<DesktopSessionSummary | undefined> {
		if (!this.persistence) {
			return undefined;
		}

		const project = projectId ? await this.findProject(projectId) : await this.ensureActiveProject();
		if (projectId && !project) {
			return undefined;
		}

		if (project) {
			await this.activateProject(project);
		}

		if (!project && this.persistence.projectStore) {
			return undefined;
		}

		const activeEntry = project ? undefined : await this.ensureActiveSessionEntry();
		const sessionId = randomUUID();
		const entry = this.createEntry(sessionId);
		const currentCwd =
			project?.cwd ?? activeEntry?.runtime?.cwd ?? activeEntry?.session?.cwd ?? this.persistence.defaultCwd;
		const runtime = await this.ensureRuntimeForEntry(entry, {
			cwd: currentCwd,
			messages: [],
		});
		const state = runtime.getState();
		const createdSession = await this.persistence.sessionStore.create({
			id: sessionId,
			cwd: runtime.cwd,
			model: hydrateDesktopModelMetadata(state.model),
			thinkingLevel: state.thinkingLevel,
			messages: [],
			agentMode: runtime.agentMode,
		});

		entry.session = createdSession;
		if (createdSession.sessionFilePath) {
			await this.discardEntryRuntime(entry);
			await this.ensureRuntimeForEntry(entry);
		}
		await this.setActiveSession(entry, project);
		return this.findSessionSummary(createdSession.id);
	}

	async switchSession(sessionId: string): Promise<DesktopSessionSummary | undefined> {
		if (!this.persistence) {
			return undefined;
		}

		this.switchSessionRequestSerial += 1;
		const requestSerial = this.switchSessionRequestSerial;
		const entry = await this.loadSessionEntry(sessionId);
		if (!entry) {
			return undefined;
		}
		if (requestSerial !== this.switchSessionRequestSerial) {
			return this.activeSessionId ? this.findSessionSummary(this.activeSessionId) : undefined;
		}

		const project = entry.session ? await this.findProjectForSession(entry.session) : undefined;
		if (requestSerial !== this.switchSessionRequestSerial) {
			return this.activeSessionId ? this.findSessionSummary(this.activeSessionId) : undefined;
		}
		await this.setActiveSession(entry, project);
		return this.findSessionSummary(entry.sessionId);
	}

	async deleteSession(sessionId: string): Promise<DesktopSessionSummary | undefined> {
		if (!this.persistence) {
			return undefined;
		}

		const persistedSession = await this.persistence.sessionStore.get(sessionId);
		if (!persistedSession) {
			return undefined;
		}

		const entry = this.entries.get(sessionId);
		if (entry && this.isEntryRunning(entry)) {
			throw new Error(`Session '${sessionId}' is already running.`);
		}
		await entry?.saveQueue.catch(() => undefined);

		const project = await this.findProjectForSession(persistedSession);
		const replacementEntry = await this.findReplacementSessionEntry(persistedSession, project);
		const isActiveSession = this.activeSessionId === sessionId;
		const lastOpenedSessionId = await this.persistence.settingsStore.get("lastOpenedSessionId");
		const projectLastOpenedSessionId = project?.lastOpenedSessionId;

		const deleted = await this.persistence.sessionStore.delete(sessionId);
		if (!deleted) {
			return undefined;
		}
		await this.deleteAgentSessionTranscript(sessionId);
		this.releaseEntry(entry);

		if (isActiveSession) {
			if (replacementEntry) {
				await this.setActiveSession(replacementEntry, project);
				return this.findSessionSummary(replacementEntry.sessionId);
			}

			this.activeSessionId = undefined;
			if (lastOpenedSessionId === sessionId) {
				await this.persistence.settingsStore.set("lastOpenedSessionId", undefined);
			}
			if (project && this.persistence.projectStore) {
				await this.persistence.projectStore.updateLastOpenedSession(project.id, undefined);
			}
			return undefined;
		}

		if (lastOpenedSessionId === sessionId) {
			await this.persistence.settingsStore.set(
				"lastOpenedSessionId",
				this.activeSessionId ?? replacementEntry?.sessionId,
			);
		}

		if (project && projectLastOpenedSessionId === sessionId && this.persistence.projectStore) {
			await this.persistence.projectStore.updateLastOpenedSession(project.id, replacementEntry?.sessionId);
		}

		return this.activeSessionId ? this.findSessionSummary(this.activeSessionId) : undefined;
	}

	private async disposeEntry(entry: DesktopRuntimeEntry): Promise<void> {
		entry.runtimeSubscription?.();
		entry.runtimeSubscription = undefined;
		const runtime = entry.runtime;
		if (runtime) {
			if (entry.activeRun || runtime.getState().isStreaming) {
				try {
					runtime.abort();
					await waitWithTimeout(runtime.waitForIdle(), RUNTIME_DISPOSE_TIMEOUT_MS);
				} catch {}
			}

			try {
				await Promise.resolve(runtime.dispose?.());
			} catch {}
		}

		await entry.saveQueue.catch(() => undefined);
	}

	async disposeAll(): Promise<void> {
		const entries = [...this.entries.values()];
		await Promise.all(entries.map((entry) => this.disposeEntry(entry)));
		this.entries.clear();
		this.listeners.clear();
		this.activeSessionId = undefined;
		this.activeProjectId = undefined;
	}

	async subscribe(listener: (event: SerializedAgentEvent) => void): Promise<() => void> {
		this.listeners.add(listener);
		if (!this.persistence) {
			const entry = await this.ensureStandaloneEntry();
			await this.ensureRuntimeForEntry(entry);
		}

		return () => {
			this.listeners.delete(listener);
		};
	}
}
