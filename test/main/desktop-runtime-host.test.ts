import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentState } from "@earendil-works/pi-agent-core";
import {
	type FauxProviderRegistration,
	fauxAssistantMessage,
	fauxText,
	getModels,
	type Model,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateDesktopAgentRuntimeOptions } from "../../src/main/runtime/create-runtime.ts";
import { createDesktopAgentRuntime } from "../../src/main/runtime/create-runtime.ts";
import {
	createDesktopAgentSnapshot,
	type DesktopAgentRuntime,
	DesktopRuntimeHost,
	type DesktopRuntimeHostPersistence,
} from "../../src/main/runtime/desktop-runtime-host.ts";
import type { SerializableAgentEvent } from "../../src/main/runtime/serialize-agent-event.ts";
import { normalizeProjectCwd } from "../../src/main/storage/project-store.ts";
import { DesktopSessionStore } from "../../src/main/storage/session-store.ts";
import type { DesktopAgentDiagnostic, SerializedAgentEvent } from "../../src/shared/serialized-agent-event.ts";
import type {
	DesktopAgentMode,
	DesktopMcpServerSummary,
	DesktopPersistedSession,
	DesktopPreparedPromptAttachment,
	DesktopProjectSummary,
	DesktopSessionSummary,
	DesktopSettingKey,
	DesktopSettingsData,
	DesktopTaskProgress,
} from "../../src/shared/types.ts";
import { DEFAULT_DESKTOP_COMPACT_INSTRUCTION, DESKTOP_TASK_PROGRESS_TOOL_NAME } from "../../src/shared/types.ts";
import { registerFauxProvider } from "../support/pi-provider-test-registry.ts";

type MutableFakeAgentState = Omit<
	AgentState,
	"pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage"
> & {
	pendingToolCalls: Set<string>;
	isStreaming: boolean;
	streamingMessage?: AgentState["streamingMessage"];
	errorMessage?: string;
};

function createFakeState(): MutableFakeAgentState {
	let messages = [] as AgentState["messages"];
	let tools = [] as AgentState["tools"];

	return {
		systemPrompt: "",
		model: {
			id: "faux-desktop",
			name: "Faux Desktop",
			api: "faux-provider",
			provider: "faux",
			baseUrl: "",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32000,
			maxTokens: 4096,
		},
		thinkingLevel: "off",
		get messages() {
			return messages;
		},
		set messages(nextMessages) {
			messages = nextMessages.slice();
		},
		get tools() {
			return tools;
		},
		set tools(nextTools) {
			tools = nextTools.slice();
		},
		isStreaming: false,
		streamingMessage: undefined,
		pendingToolCalls: new Set<string>(),
		errorMessage: undefined,
	};
}

const fakeModel = {
	id: "faux-desktop",
	name: "Faux Desktop",
	api: "faux-provider",
	provider: "faux",
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 32000,
	maxTokens: 4096,
} satisfies Model<any>;

const fakeTaskProgress: DesktopTaskProgress = {
	title: "Implement progress",
	items: [
		{ id: "inspect", label: "Inspect runtime", status: "completed" },
		{ id: "render", label: "Render panel", status: "active" },
	],
	updatedAt: "2026-05-17T00:00:00.000Z",
};

function createAssistantTextMessage(
	text: string,
	timestamp: number,
): Extract<AgentState["messages"][number], { role: "assistant" }> {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "faux-provider",
		provider: "faux",
		model: "faux-desktop",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function createPersistedSession(
	id: string,
	title: string,
	cwd = "/workspace/project",
	agentMode: DesktopAgentMode = "execute",
): DesktopPersistedSession {
	const timestamp = new Date().toISOString();
	return {
		id,
		title,
		cwd,
		createdAt: timestamp,
		updatedAt: timestamp,
		agentMode,
		consumedProposedPlanMessageIds: [],
		model: fakeModel,
		thinkingLevel: "off",
		messages: [],
	};
}

function createSessionSummary(session: DesktopPersistedSession): DesktopSessionSummary {
	return {
		id: session.id,
		title: session.title,
		cwd: session.cwd,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		messageCount: session.messages.length,
		agentMode: session.agentMode ?? "execute",
		provider: session.model.provider,
		modelId: session.model.id,
	};
}

function isSessionSummary(value: DesktopSessionSummary | undefined): value is DesktopSessionSummary {
	return value !== undefined;
}

function createLegacyKimiModel(): Model<"anthropic-messages"> {
	return {
		id: "kimi-for-coding",
		name: "kimi-for-coding",
		api: "anthropic-messages",
		provider: "kimi-coding",
		baseUrl: "https://api.kimi.com/coding",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	} as unknown as Model<"anthropic-messages">;
}

class FakeRuntime implements DesktopAgentRuntime {
	private listener?: (event: SerializableAgentEvent) => void;
	agentMode: DesktopAgentMode = "execute";
	readonly diagnostics: readonly DesktopAgentDiagnostic[] = [{ type: "info", message: "ready" }];
	readonly availableTools = ["read", "bash"];
	taskProgress: DesktopPersistedSession["taskProgress"] = undefined;
	readonly prompt = vi.fn(async (_request: Parameters<DesktopAgentRuntime["prompt"]>[0]) => {
		return undefined;
	});
	readonly compact = vi.fn(async (_customInstructions?: string) => ({
		summary: "compacted",
		firstKeptEntryId: "entry-1",
		tokensBefore: 128,
	}));
	readonly abort = vi.fn(() => {
		return undefined;
	});
	readonly dispose = vi.fn(async () => {
		return undefined;
	});
	readonly waitForIdle = vi.fn(async () => {
		return undefined;
	});
	readonly applySessionProfile = vi.fn(
		async (update: Parameters<NonNullable<DesktopAgentRuntime["applySessionProfile"]>>[0]) => {
			this.mutableState.model = update.model;
			this.mutableState.thinkingLevel = update.thinkingLevel;
		},
	);
	readonly mutableState = createFakeState();

	constructor(public readonly cwd: string) {}

	readonly setAgentMode = vi.fn((agentMode: DesktopAgentMode) => {
		this.agentMode = agentMode;
	});

	getState(): AgentState {
		return this.mutableState;
	}

	subscribe(listener: (event: SerializableAgentEvent) => void): () => void {
		this.listener = listener;
		return () => {
			this.listener = undefined;
		};
	}

	async listCapabilities() {
		return {
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		};
	}

	async getCapabilityDetail() {
		return {
			type: "skill" as const,
			name: "empty",
			description: "Empty capability",
			body: "",
			filePath: "/workspace/.pi/skills/empty/SKILL.md",
			disableModelInvocation: false,
			source: { label: "project", scope: "project" as const },
		};
	}

	async createSkill() {
		return this.listCapabilities();
	}

	async upsertPromptTemplate() {
		return this.listCapabilities();
	}

	async deletePromptTemplate() {
		return this.listCapabilities();
	}

	async upsertMcpServer() {
		return this.listCapabilities();
	}

	async setMcpServerEnabled() {
		return this.listCapabilities();
	}

	async testMcpServer(): Promise<DesktopMcpServerSummary> {
		return {
			id: "unused",
			name: "unused",
			command: "unused",
			args: [],
			env: {},
			enabled: false,
			status: "disabled",
			tools: [],
			updatedAt: "2026-04-25T08:00:00.000Z",
		};
	}

	async restartMcpServer() {
		return this.listCapabilities();
	}

	async reloadCapabilities() {
		return this.listCapabilities();
	}

	emit(event: SerializableAgentEvent): void {
		this.listener?.(event);
	}
}

type TestSessionStore = DesktopRuntimeHostPersistence["sessionStore"];
type TestSettingsStore = DesktopRuntimeHostPersistence["settingsStore"];
type TestInstructionStore = NonNullable<DesktopRuntimeHostPersistence["instructionStore"]>;
type TestProjectStore = NonNullable<DesktopRuntimeHostPersistence["projectStore"]>;
type TestRuntimeFactory = (options?: CreateDesktopAgentRuntimeOptions) => Promise<DesktopAgentRuntime>;

class InMemorySessionStore implements TestSessionStore {
	private sessions = new Map<string, DesktopPersistedSession>();

	async create(options: {
		id?: string;
		cwd: string;
		model: DesktopPersistedSession["model"];
		thinkingLevel: DesktopPersistedSession["thinkingLevel"];
		messages?: DesktopPersistedSession["messages"];
		title?: string;
		agentMode?: DesktopAgentMode;
	}): Promise<DesktopPersistedSession> {
		const createdAt = new Date().toISOString();
		const session: DesktopPersistedSession = {
			id: options.id ?? `session-${this.sessions.size + 1}`,
			title: options.title ?? "New Session",
			cwd: options.cwd,
			createdAt,
			updatedAt: createdAt,
			agentMode: options.agentMode ?? "execute",
			consumedProposedPlanMessageIds: [],
			model: options.model,
			thinkingLevel: options.thinkingLevel,
			messages: options.messages ?? [],
		};
		this.sessions.set(session.id, session);
		return session;
	}

	async get(sessionId: string): Promise<DesktopPersistedSession | null> {
		return this.sessions.get(sessionId) ?? null;
	}

	async delete(sessionId: string): Promise<boolean> {
		return this.sessions.delete(sessionId);
	}

	async list(): Promise<DesktopSessionSummary[]> {
		return [...this.sessions.values()].map((session) => ({
			id: session.id,
			title: session.title,
			cwd: session.cwd,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			messageCount: session.messages.length,
			agentMode: session.agentMode ?? "execute",
			provider: session.model.provider,
			modelId: session.model.id,
		}));
	}

	async save(session: DesktopPersistedSession): Promise<DesktopPersistedSession> {
		this.sessions.set(session.id, session);
		return session;
	}
}

class InMemorySettingsStore implements TestSettingsStore {
	private settings: Record<string, unknown> = {};

	async get<TKey extends DesktopSettingKey>(key: TKey): Promise<DesktopSettingsData[TKey]> {
		return this.settings[key as string] as DesktopSettingsData[TKey];
	}

	async set<TKey extends DesktopSettingKey>(key: TKey, value: DesktopSettingsData[TKey]): Promise<void> {
		this.settings[key as string] = value;
	}
}

class InMemoryInstructionStore implements TestInstructionStore {
	constructor(private compactInstruction = DEFAULT_DESKTOP_COMPACT_INSTRUCTION) {}

	async getCompactInstruction(): Promise<string> {
		return this.compactInstruction;
	}
}

async function readDesktopSettings(settingsStore: TestSettingsStore): Promise<DesktopSettingsData> {
	return {
		defaultProvider: await settingsStore.get("defaultProvider"),
		defaultModel: await settingsStore.get("defaultModel"),
		defaultThinkingLevel: await settingsStore.get("defaultThinkingLevel"),
		showThinkingBlocks: await settingsStore.get("showThinkingBlocks"),
		permissionApprovals: await settingsStore.get("permissionApprovals"),
		lastOpenedProjectId: await settingsStore.get("lastOpenedProjectId"),
		lastOpenedSessionId: await settingsStore.get("lastOpenedSessionId"),
	};
}

class InMemoryProjectStore implements TestProjectStore {
	private projects = new Map<string, DesktopProjectSummary>();

	async createOrGet(cwd: string): Promise<DesktopProjectSummary> {
		const normalizedCwd = normalizeProjectCwd(cwd);
		const existingProject = [...this.projects.values()].find(
			(project) => normalizeProjectCwd(project.cwd) === normalizedCwd,
		);
		if (existingProject) {
			return existingProject;
		}

		const timestamp = new Date().toISOString();
		const project: DesktopProjectSummary = {
			id: `project-${this.projects.size + 1}`,
			name: normalizedCwd.split("/").filter(Boolean).at(-1) ?? normalizedCwd,
			cwd: normalizedCwd,
			createdAt: timestamp,
			updatedAt: timestamp,
			sessionCount: 0,
		};
		this.projects.set(project.id, project);
		return project;
	}

	async get(projectId: string): Promise<DesktopProjectSummary | null> {
		return this.projects.get(projectId) ?? null;
	}

	async list(): Promise<DesktopProjectSummary[]> {
		return [...this.projects.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	async listWithSessionStats(sessions: readonly DesktopSessionSummary[]): Promise<DesktopProjectSummary[]> {
		return (await this.list()).map((project) => ({
			...project,
			sessionCount: sessions.filter(
				(session) => normalizeProjectCwd(session.cwd) === normalizeProjectCwd(project.cwd),
			).length,
		}));
	}

	async updateLastOpenedSession(
		projectId: string,
		sessionId: string | undefined,
	): Promise<DesktopProjectSummary | null> {
		const project = this.projects.get(projectId);
		if (!project) {
			return null;
		}

		const nextProject = {
			...project,
			lastOpenedSessionId: sessionId,
		};
		this.projects.set(projectId, nextProject);
		return nextProject;
	}
}

async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function createDeferredPromise<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return { promise, resolve, reject };
}

const registrations: FauxProviderRegistration[] = [];
const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-runtime-host-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

function createFauxRegistration(): FauxProviderRegistration {
	const registration = registerFauxProvider({
		provider: "desktop-host-faux",
		api: "faux",
		models: [{ id: "desktop-host-model", name: "Desktop Host Model", reasoning: false }],
	});
	registrations.push(registration);
	return registration;
}

afterEach(async () => {
	while (registrations.length > 0) {
		registrations.pop()?.unregister();
	}
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

describe("DesktopRuntimeHost", () => {
	let runtime: FakeRuntime;
	let host: DesktopRuntimeHost;

	beforeEach(() => {
		runtime = new FakeRuntime("/workspace/project");
		host = new DesktopRuntimeHost(async () => runtime);
	});

	it("creates a snapshot before prompting", async () => {
		const snapshot = await host.getSnapshot();

		expect(snapshot.cwd).toBe("/workspace/project");
		expect(snapshot.agentMode).toBe("execute");
		expect(snapshot.model?.provider).toBe("faux");
		expect(snapshot.model?.contextWindow).toBe(32000);
		expect(snapshot.availableTools).toEqual(["read", "bash"]);
		expect(snapshot.messages).toEqual([]);
		expect(snapshot.isStreaming).toBe(false);
		expect(snapshot.diagnostics).toEqual([{ type: "info", message: "ready" }]);
	});

	it("forwards prompts and trims whitespace", async () => {
		await host.prompt("default", "  summarize the repo  ");

		expect(runtime.prompt).toHaveBeenCalledWith({ text: "summarize the repo" });
	});

	it("forwards prompt attachments even when the visible text is empty", async () => {
		const attachment: DesktopPreparedPromptAttachment = {
			id: "attachment-1",
			kind: "text",
			name: "notes.md",
			mimeType: "text/markdown",
			size: 12,
			promptText: '<file name="notes.md">hello</file>',
			images: [],
		};

		await host.prompt("default", { text: "", attachments: [attachment] });

		expect(runtime.prompt).toHaveBeenCalledWith({ text: "", attachments: [attachment] });
	});

	it("runs manual compaction and returns a refreshed snapshot", async () => {
		const snapshot = await host.compact("default", "preserve validation state");

		expect(runtime.compact).toHaveBeenCalledWith("preserve validation state");
		expect(snapshot.messages).toEqual([]);
	});

	it("uses the saved compact instruction when manual compaction has no inline instruction", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const instructionStore = new InMemoryInstructionStore(DEFAULT_DESKTOP_COMPACT_INSTRUCTION);
		await sessionStore.create({
			id: "session-1",
			cwd: "/workspace/project",
			model: fakeModel,
			thinkingLevel: "off",
		});
		const sessionRuntime = new FakeRuntime("/workspace/project");
		const sessionHost = new DesktopRuntimeHost(vi.fn<TestRuntimeFactory>().mockResolvedValue(sessionRuntime), {
			defaultCwd: "/workspace/project",
			instructionStore,
			sessionStore,
			settingsStore,
		});

		await sessionHost.compact("session-1");

		expect(sessionRuntime.compact).toHaveBeenCalledWith(DEFAULT_DESKTOP_COMPACT_INSTRUCTION);
	});

	it("creates runtimes from the canonical session transcript and Skylark agent home", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		await sessionStore.save({
			...createPersistedSession("session-1", "Persisted"),
			sessionFilePath: "/Users/test/.skylark/sessions/2026/05/24/session-1.jsonl",
		});
		const sessionRuntime = new FakeRuntime("/workspace/project");
		const runtimeFactory = vi.fn<TestRuntimeFactory>().mockResolvedValue(sessionRuntime);
		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			agentDir: "/Users/test/.skylark",
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		await sessionHost.getSnapshot("session-1");

		expect(runtimeFactory).toHaveBeenCalledWith(
			expect.objectContaining({
				agentDir: "/Users/test/.skylark",
				sessionFilePath: "/Users/test/.skylark/sessions/2026/05/24/session-1.jsonl",
				sessionId: "session-1",
			}),
		);
	});

	it("preserves the canonical session transcript path when persisting runtime updates", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const sessionFilePath = "/Users/test/.skylark/sessions/2026/05/24/session-1.jsonl";
		await sessionStore.save({
			...createPersistedSession("session-1", "Persisted"),
			sessionFilePath,
		});
		const sessionRuntime = new FakeRuntime("/workspace/project");
		const sessionHost = new DesktopRuntimeHost(vi.fn<TestRuntimeFactory>().mockResolvedValue(sessionRuntime), {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		await sessionHost.getSnapshot("session-1");
		sessionRuntime.mutableState.messages = [{ role: "user", content: "Persist me", timestamp: 1 }];
		sessionRuntime.emit({
			type: "message_end",
			message: { role: "user", content: "Persist me", timestamp: 1 },
		});
		await flushAsyncWork();

		const persistedSession = await sessionStore.get("session-1");
		expect(persistedSession?.sessionFilePath).toBe(sessionFilePath);
		expect(persistedSession?.messages).toEqual(sessionRuntime.mutableState.messages);
	});

	it("keeps manual compaction no-ops from invalidating the session", async () => {
		runtime.compact.mockRejectedValueOnce(new Error("Nothing to compact (session too small)"));

		const snapshot = await host.compact("default");

		expect(runtime.compact).toHaveBeenCalledTimes(1);
		expect(snapshot.sessionId).toBe("default");
		expect(snapshot.errorMessage).toBeUndefined();
	});

	it("updates and persists session mode", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const sessionRuntime = new FakeRuntime("/workspace/project");
		const sessionHost = new DesktopRuntimeHost(vi.fn<TestRuntimeFactory>().mockResolvedValue(sessionRuntime), {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});
		const [session] = await sessionHost.listSessions();
		if (!session) {
			throw new Error("Expected initial session.");
		}

		const snapshot = await sessionHost.setSessionMode({ sessionId: session.id, agentMode: "plan" });

		expect(sessionRuntime.setAgentMode).toHaveBeenCalledWith("plan");
		expect(snapshot.agentMode).toBe("plan");
		expect((await sessionStore.get(session.id))?.agentMode).toBe("plan");
		expect((await sessionHost.listSessions()).find((item) => item.id === session.id)?.agentMode).toBe("plan");
	});

	it("hydrates legacy sessions without mode as execute", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const legacySession = { ...createPersistedSession("legacy", "Legacy"), agentMode: undefined };
		await sessionStore.save(legacySession);
		const sessionRuntime = new FakeRuntime("/workspace/project");
		const runtimeFactory = vi.fn<TestRuntimeFactory>().mockImplementation(async (options) => {
			sessionRuntime.agentMode = options?.agentMode ?? "execute";
			return sessionRuntime;
		});
		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		const snapshot = await sessionHost.getSnapshot("legacy");

		expect(snapshot.agentMode).toBe("execute");
		expect(runtimeFactory.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ agentMode: "execute" }));
		expect((await sessionStore.get("legacy"))?.agentMode).toBe("execute");
	});

	it("executePlan switches to execute mode and sends a compact execution prompt", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		await sessionStore.save({
			...createPersistedSession("planned-session", "Planned", "/workspace/project", "plan"),
			consumedProposedPlanMessageIds: ["assistant-run-0"],
		});
		const sessionRuntime = new FakeRuntime("/workspace/project");
		sessionRuntime.agentMode = "plan";
		const sessionHost = new DesktopRuntimeHost(vi.fn<TestRuntimeFactory>().mockResolvedValue(sessionRuntime), {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		const snapshot = await sessionHost.executePlan({ sessionId: "planned-session" });

		expect(sessionRuntime.setAgentMode).toHaveBeenCalledWith("execute");
		expect(sessionRuntime.prompt).toHaveBeenCalledWith({ text: "开始执行上面的计划。" });
		expect(snapshot.agentMode).toBe("execute");
		expect(snapshot.consumedProposedPlanMessageIds).toEqual(["assistant-run-0"]);
		expect((await sessionStore.get("planned-session"))?.agentMode).toBe("execute");
	});

	it("consumes proposed plan actions once per message id", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		await sessionStore.save(createPersistedSession("planned-session", "Planned", "/workspace/project", "plan"));
		const sessionRuntime = new FakeRuntime("/workspace/project");
		const sessionHost = new DesktopRuntimeHost(vi.fn<TestRuntimeFactory>().mockResolvedValue(sessionRuntime), {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		const firstSnapshot = await sessionHost.consumeProposedPlan({
			sessionId: "planned-session",
			planMessageId: "assistant-run-0",
		});
		const secondSnapshot = await sessionHost.consumeProposedPlan({
			sessionId: "planned-session",
			planMessageId: "assistant-run-0",
		});

		expect(firstSnapshot.consumedProposedPlanMessageIds).toEqual(["assistant-run-0"]);
		expect(secondSnapshot.consumedProposedPlanMessageIds).toEqual(["assistant-run-0"]);
		expect((await sessionStore.get("planned-session"))?.consumedProposedPlanMessageIds).toEqual(["assistant-run-0"]);
		expect(sessionRuntime.prompt).not.toHaveBeenCalled();
	});

	it("broadcasts serialized events to stream listeners", async () => {
		const listener = vi.fn();
		await host.subscribe(listener);

		runtime.emit({ type: "agent_start" });
		runtime.emit({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "read",
			args: { filePath: "README.md" },
		});

		expect(listener).toHaveBeenNthCalledWith(1, { type: "agent_start", sessionId: "default" });
		expect(listener).toHaveBeenNthCalledWith(2, {
			type: "tool_execution_start",
			sessionId: "default",
			toolCallId: "call-1",
			toolName: "read",
			args: { filePath: "README.md" },
		});
	});

	it("broadcasts manual compaction lifecycle events to stream listeners", async () => {
		const listener = vi.fn();
		await host.subscribe(listener);

		runtime.emit({ type: "compaction_start", reason: "manual" });
		runtime.emit({
			type: "compaction_end",
			reason: "manual",
			result: undefined,
			aborted: false,
			willRetry: false,
		});

		expect(listener).toHaveBeenNthCalledWith(1, {
			type: "compaction_start",
			sessionId: "default",
			reason: "manual",
		});
		expect(listener).toHaveBeenNthCalledWith(2, {
			type: "compaction_end",
			sessionId: "default",
			reason: "manual",
			aborted: false,
			willRetry: false,
		});
	});

	it("aborts through the runtime", async () => {
		await host.abort("default");

		expect(runtime.abort).toHaveBeenCalledTimes(1);
		expect(runtime.waitForIdle).toHaveBeenCalledTimes(1);
	});

	it("waits for the runtime to settle before resolving abort", async () => {
		const deferred = createDeferredPromise<void>();
		runtime.waitForIdle.mockImplementation(async () => {
			await deferred.promise;
		});
		await host.getSnapshot();

		const abortPromise = host.abort("default");
		await flushAsyncWork();

		expect(runtime.abort).toHaveBeenCalledTimes(1);
		expect(runtime.waitForIdle).toHaveBeenCalledTimes(1);

		let hasResolved = false;
		void abortPromise.then(() => {
			hasResolved = true;
		});

		await flushAsyncWork();
		expect(hasResolved).toBe(false);

		deferred.resolve();
		await abortPromise;
		expect(hasResolved).toBe(true);
	});

	it("serializes snapshot state consistently", () => {
		runtime.mutableState.messages = [{ role: "user", content: "hi", timestamp: 1 }];
		runtime.mutableState.pendingToolCalls = new Set(["call-1"]);
		runtime.mutableState.isStreaming = true;
		runtime.taskProgress = fakeTaskProgress;

		const snapshot = createDesktopAgentSnapshot("snapshot-session", runtime);

		expect(snapshot.sessionId).toBe("snapshot-session");
		expect(snapshot.agentMode).toBe("execute");
		expect(snapshot.taskProgress).toEqual(fakeTaskProgress);
		expect(snapshot.messages).toEqual([{ role: "user", content: "hi", timestamp: 1 }]);
		expect(snapshot.pendingToolCalls).toEqual(["call-1"]);
		expect(snapshot.isStreaming).toBe(true);
	});

	it("hydrates persisted task progress into runtime snapshots", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		await sessionStore.save({
			...createPersistedSession("progress-session", "Progress"),
			taskProgress: fakeTaskProgress,
		});
		const sessionRuntime = new FakeRuntime("/workspace/project");
		const runtimeFactory = vi.fn<TestRuntimeFactory>().mockImplementation(async (options) => {
			sessionRuntime.taskProgress = options?.taskProgress;
			return sessionRuntime;
		});
		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		const snapshot = await sessionHost.getSnapshot("progress-session");

		expect(runtimeFactory.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ taskProgress: fakeTaskProgress }));
		expect(snapshot.taskProgress).toEqual(fakeTaskProgress);
	});

	it("persists task progress updates from the internal progress tool", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		await sessionStore.save(createPersistedSession("progress-session", "Progress"));
		const sessionRuntime = new FakeRuntime("/workspace/project");
		const sessionHost = new DesktopRuntimeHost(vi.fn<TestRuntimeFactory>().mockResolvedValue(sessionRuntime), {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		await sessionHost.getSnapshot("progress-session");
		sessionRuntime.taskProgress = fakeTaskProgress;
		sessionRuntime.emit({
			type: "tool_execution_end",
			toolCallId: "progress-1",
			toolName: DESKTOP_TASK_PROGRESS_TOOL_NAME,
			result: { content: [{ type: "text", text: "progress" }], details: { taskProgress: fakeTaskProgress } },
			isError: false,
		});
		await flushAsyncWork();

		expect((await sessionStore.get("progress-session"))?.taskProgress).toEqual(fakeTaskProgress);
	});

	it("hydrates legacy Kimi context metadata when serializing snapshots", () => {
		runtime.mutableState.model = createLegacyKimiModel();

		const snapshot = createDesktopAgentSnapshot("kimi-session", runtime);

		expect(snapshot.model?.contextWindow).toBe(256000);
	});

	it("creates and switches persisted sessions through the host", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const firstRuntime = new FakeRuntime("/workspace/project");
		firstRuntime.mutableState.model = fakeModel;
		const secondRuntime = new FakeRuntime("/workspace/project");
		secondRuntime.mutableState.model = {
			...fakeModel,
			id: "kimi-for-coding",
			provider: "kimi-coding",
			name: "Kimi Coding",
			api: "anthropic-messages",
			baseUrl: "https://api.kimi.com/coding",
		};
		const runtimeFactory = vi
			.fn<TestRuntimeFactory>()
			.mockResolvedValueOnce(firstRuntime)
			.mockResolvedValueOnce(secondRuntime);

		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		const initialSessions = await sessionHost.listSessions();
		const newSession = await sessionHost.newSession();
		const initialSessionId = initialSessions[0]!.id;

		expect(initialSessions).toHaveLength(1);
		expect(runtimeFactory.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ cwd: "/workspace/project", messages: [], sessionId: initialSessionId }),
		);
		expect(newSession?.id).not.toBe(initialSessionId);
		expect(await settingsStore.get("lastOpenedSessionId")).toBe(newSession?.id);
		expect(firstRuntime.waitForIdle).not.toHaveBeenCalled();
		expect(runtimeFactory.mock.calls[1]?.[0]).toEqual(
			expect.objectContaining({ cwd: "/workspace/project", messages: [], sessionId: newSession?.id }),
		);
		expect((await sessionStore.get(newSession!.id))?.model.provider).toBe("kimi-coding");

		const switched = await sessionHost.switchSession(initialSessionId);
		expect(switched?.id).toBe(initialSessionId);
		expect(secondRuntime.waitForIdle).not.toHaveBeenCalled();
	});

	it("keeps the latest requested host session active when rapid switches resolve out of order", async () => {
		const settingsStore = new InMemorySettingsStore();
		const firstSession = createPersistedSession("session-1", "First");
		const secondSession = createPersistedSession("session-2", "Second");
		const thirdSession = createPersistedSession("session-3", "Third");
		const switchTwo = createDeferredPromise<DesktopPersistedSession | null>();
		const sessions = new Map([
			[firstSession.id, firstSession],
			[secondSession.id, secondSession],
			[thirdSession.id, thirdSession],
		]);
		const sessionStore: TestSessionStore = {
			create: vi.fn(async (options) => ({
				...createPersistedSession(options.id ?? "created-session", options.title ?? "Created", options.cwd),
				messages: options.messages ?? [],
				model: options.model,
				thinkingLevel: options.thinkingLevel,
			})),
			get: vi.fn(async (sessionId) => {
				if (sessionId === secondSession.id) {
					return switchTwo.promise;
				}
				return sessions.get(sessionId) ?? null;
			}),
			delete: vi.fn(async (sessionId) => sessions.delete(sessionId)),
			list: vi.fn(async () => [...sessions.values()].map(createSessionSummary)),
			save: vi.fn(async (session) => {
				sessions.set(session.id, session);
				return session;
			}),
		};
		const sessionHost = new DesktopRuntimeHost(
			vi.fn<TestRuntimeFactory>(async () => new FakeRuntime("/workspace/project")),
			{
				defaultCwd: "/workspace/project",
				sessionStore,
				settingsStore,
			},
		);

		const firstSwitch = sessionHost.switchSession(secondSession.id);
		const secondSwitch = sessionHost.switchSession(thirdSession.id);
		await secondSwitch;
		switchTwo.resolve(secondSession);
		await firstSwitch;

		expect(await settingsStore.get("lastOpenedSessionId")).toBe(thirdSession.id);
		expect((await sessionHost.listSessions()).find((session) => session.id === thirdSession.id)?.id).toBe(
			thirdSession.id,
		);
		const snapshot = await sessionHost.getSnapshot();
		expect(snapshot.sessionId).toBe(thirdSession.id);
	});

	it("deletes inactive persisted sessions without changing the active session", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const firstRuntime = new FakeRuntime("/workspace/project");
		firstRuntime.mutableState.model = fakeModel;
		const secondRuntime = new FakeRuntime("/workspace/project");
		secondRuntime.mutableState.model = fakeModel;
		const sessionHost = new DesktopRuntimeHost(
			vi.fn<TestRuntimeFactory>().mockResolvedValueOnce(firstRuntime).mockResolvedValueOnce(secondRuntime),
			{
				defaultCwd: "/workspace/project",
				sessionStore,
				settingsStore,
			},
		);

		const [firstSession] = await sessionHost.listSessions();
		const secondSession = await sessionHost.newSession();
		const activeAfterDelete = await sessionHost.deleteSession(firstSession!.id);

		expect(activeAfterDelete?.id).toBe(secondSession?.id);
		expect(await sessionStore.get(firstSession!.id)).toBeNull();
		expect((await sessionHost.listSessions()).map((session) => session.id)).toEqual([secondSession?.id]);
		expect(await settingsStore.get("lastOpenedSessionId")).toBe(secondSession?.id);
	});

	it("deletes the active session and activates the next project session", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const project = await projectStore.createOrGet("/workspace/project");
		const firstRuntime = new FakeRuntime("/workspace/project");
		firstRuntime.mutableState.model = fakeModel;
		const secondRuntime = new FakeRuntime("/workspace/project");
		secondRuntime.mutableState.model = fakeModel;
		const sessionHost = new DesktopRuntimeHost(
			vi.fn<TestRuntimeFactory>().mockResolvedValueOnce(firstRuntime).mockResolvedValueOnce(secondRuntime),
			{
				defaultCwd: "/workspace/project",
				projectStore,
				sessionStore,
				settingsStore,
			},
		);

		await sessionHost.switchProject(project.id);
		const firstSession = await sessionHost.newSession(project.id);
		const secondSession = await sessionHost.newSession(project.id);
		const replacementSession = await sessionHost.deleteSession(secondSession!.id);

		expect(replacementSession?.id).toBe(firstSession?.id);
		expect(await sessionStore.get(secondSession!.id)).toBeNull();
		expect(await settingsStore.get("lastOpenedSessionId")).toBe(firstSession?.id);
		expect((await projectStore.get(project.id))?.lastOpenedSessionId).toBe(firstSession?.id);
	});

	it("deletes the active top project session and activates the adjacent session below it", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const project = await projectStore.createOrGet("/workspace/project");
		await sessionStore.create({
			id: "session-top",
			cwd: "/workspace/project",
			model: fakeModel,
			thinkingLevel: "off",
			title: "Top",
		});
		await sessionStore.create({
			id: "session-next",
			cwd: "/workspace/project",
			model: fakeModel,
			thinkingLevel: "off",
			title: "Next",
		});
		await sessionStore.create({
			id: "session-bottom",
			cwd: "/workspace/project",
			model: fakeModel,
			thinkingLevel: "off",
			title: "Bottom",
		});
		const runtimeFactory = vi.fn<TestRuntimeFactory>(async () => new FakeRuntime("/workspace/project"));
		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			defaultCwd: "/workspace/project",
			projectStore,
			sessionStore,
			settingsStore,
		});

		await sessionHost.switchProject(project.id);
		const replacementSession = await sessionHost.deleteSession("session-top");
		const remainingSessions = await sessionHost.listSessions(project.id);

		expect(replacementSession?.id).toBe("session-next");
		expect(remainingSessions.map((session) => session.id)).toEqual(["session-next", "session-bottom"]);
		expect(await settingsStore.get("lastOpenedSessionId")).toBe("session-next");
		expect((await projectStore.get(project.id))?.lastOpenedSessionId).toBe("session-next");
		expect(runtimeFactory).not.toHaveBeenCalled();
	});

	it("skips unavailable adjacent replacement summaries without creating a new session", async () => {
		const projectStore = new InMemoryProjectStore();
		const settingsStore = new InMemorySettingsStore();
		const project = await projectStore.createOrGet("/workspace/project");
		const topSession = createPersistedSession("session-top", "Top");
		const staleSession = createPersistedSession("session-stale", "Stale");
		const fallbackSession = createPersistedSession("session-fallback", "Fallback");
		let isTopDeleted = false;
		const createSession = vi.fn<TestSessionStore["create"]>(async (options) => ({
			...createPersistedSession(options.id ?? "created-session", options.title ?? "Created", options.cwd),
			messages: options.messages ?? [],
			model: options.model,
			thinkingLevel: options.thinkingLevel,
		}));
		const sessionStore: TestSessionStore = {
			create: createSession,
			get: vi.fn(async (sessionId) => {
				if (sessionId === topSession.id && !isTopDeleted) {
					return topSession;
				}
				if (sessionId === fallbackSession.id) {
					return fallbackSession;
				}
				return null;
			}),
			delete: vi.fn(async (sessionId) => {
				if (sessionId !== topSession.id || isTopDeleted) {
					return false;
				}
				isTopDeleted = true;
				return true;
			}),
			list: vi.fn(async () =>
				[
					isTopDeleted ? undefined : createSessionSummary(topSession),
					createSessionSummary(staleSession),
					createSessionSummary(fallbackSession),
				].filter(isSessionSummary),
			),
			save: vi.fn(async (session) => session),
		};
		const sessionHost = new DesktopRuntimeHost(
			vi.fn<TestRuntimeFactory>(async () => new FakeRuntime("/workspace/project")),
			{
				defaultCwd: "/workspace/project",
				projectStore,
				sessionStore,
				settingsStore,
			},
		);

		await sessionHost.switchProject(project.id);
		const replacementSession = await sessionHost.deleteSession(topSession.id);
		const remainingSessions = await sessionHost.listSessions(project.id);

		expect(replacementSession?.id).toBe(fallbackSession.id);
		expect(remainingSessions.map((session) => session.id)).toEqual([staleSession.id, fallbackSession.id]);
		expect(await settingsStore.get("lastOpenedSessionId")).toBe(fallbackSession.id);
		expect((await projectStore.get(project.id))?.lastOpenedSessionId).toBe(fallbackSession.id);
		expect(createSession).not.toHaveBeenCalled();
	});

	it("leaves the project empty when deleting the only active project session", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const project = await projectStore.createOrGet("/workspace/project");
		const firstRuntime = new FakeRuntime("/workspace/project");
		firstRuntime.mutableState.model = fakeModel;
		const sessionHost = new DesktopRuntimeHost(vi.fn<TestRuntimeFactory>().mockResolvedValueOnce(firstRuntime), {
			defaultCwd: "/workspace/project",
			projectStore,
			sessionStore,
			settingsStore,
		});

		await sessionHost.switchProject(project.id);
		const initialSession = await sessionHost.newSession(project.id);
		const replacementSession = await sessionHost.deleteSession(initialSession!.id);
		const sessions = await sessionHost.listSessions(project.id);

		expect(replacementSession).toBeUndefined();
		expect(sessions).toEqual([]);
		expect(await sessionStore.list()).toEqual([]);
		expect(await settingsStore.get("lastOpenedSessionId")).toBeUndefined();
		expect((await projectStore.get(project.id))?.lastOpenedSessionId).toBeUndefined();
	});

	it("does not move a project to the top when deleting one of its sessions", async () => {
		vi.useFakeTimers();
		try {
			const projectStore = new InMemoryProjectStore();
			const sessionStore = new InMemorySessionStore();
			const settingsStore = new InMemorySettingsStore();
			vi.setSystemTime(new Date("2026-04-25T08:00:00.000Z"));
			const olderProject = await projectStore.createOrGet("/workspace/older");
			vi.setSystemTime(new Date("2026-04-25T09:00:00.000Z"));
			const newerProject = await projectStore.createOrGet("/workspace/newer");
			const olderSession = await sessionStore.create({
				cwd: olderProject.cwd,
				model: fakeModel,
				thinkingLevel: "off",
				messages: [{ role: "user", content: "Older", timestamp: 1 }],
				title: "Older session",
			});
			const sessionHost = new DesktopRuntimeHost(
				vi.fn<TestRuntimeFactory>(async () => new FakeRuntime("/workspace/older")),
				{
					defaultCwd: "/workspace/older",
					projectStore,
					sessionStore,
					settingsStore,
				},
			);

			await sessionHost.switchProject(olderProject.id);
			await sessionHost.switchSession(olderSession.id);
			vi.setSystemTime(new Date("2026-04-25T10:00:00.000Z"));
			await sessionHost.deleteSession(olderSession.id);
			const projects = await sessionHost.listProjects();

			expect(projects.map((project) => project.id)).toEqual([newerProject.id, olderProject.id]);
			expect(projects.find((project) => project.id === olderProject.id)?.updatedAt).toBe(olderProject.updatedAt);
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects deleting a running session", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const runningRuntime = new FakeRuntime("/workspace/project");
		runningRuntime.mutableState.model = fakeModel;
		const run = createDeferredPromise<void>();
		runningRuntime.prompt.mockImplementation(async () => {
			runningRuntime.mutableState.isStreaming = true;
			await run.promise;
			runningRuntime.mutableState.isStreaming = false;
		});
		const sessionHost = new DesktopRuntimeHost(async () => runningRuntime, {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		const [session] = await sessionHost.listSessions();
		await sessionHost.prompt(session!.id, "Keep running.");

		await expect(sessionHost.deleteSession(session!.id)).rejects.toThrow(
			`Session '${session!.id}' is already running.`,
		);
		expect(await sessionStore.get(session!.id)).not.toBeNull();

		run.resolve();
		await flushAsyncWork();
	});

	it("creates project-scoped sessions with the selected project cwd", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const firstProject = await projectStore.createOrGet("/workspace/one");
		const secondProject = await projectStore.createOrGet("/workspace/two");
		await settingsStore.set("lastOpenedProjectId", firstProject.id);
		const runtimeFactory = vi.fn<TestRuntimeFactory>(async (options) => {
			const projectRuntime = new FakeRuntime(options?.cwd ?? "/workspace/fallback");
			projectRuntime.mutableState.model = fakeModel;
			return projectRuntime;
		});

		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			defaultCwd: "/workspace/one",
			projectStore,
			sessionStore,
			settingsStore,
		});

		await sessionHost.switchProject(firstProject.id);
		const firstProjectSessions = await sessionHost.listSessions(firstProject.id);
		await sessionHost.switchProject(secondProject.id);
		const secondProjectSession = await sessionHost.newSession(secondProject.id);

		expect(firstProjectSessions).toEqual([]);
		expect(secondProjectSession?.cwd).toBe("/workspace/two");
		expect(runtimeFactory.mock.calls.map((call) => call[0]?.cwd)).toContain("/workspace/two");
		expect(await settingsStore.get("lastOpenedProjectId")).toBe(secondProject.id);
		expect((await projectStore.get(secondProject.id))?.lastOpenedSessionId).toBe(secondProjectSession?.id);
	});

	it("creates project-scoped runtimes with the canonical session transcript path", async () => {
		const directoryPath = createTempDirectory();
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new DesktopSessionStore(
			join(directoryPath, "session_index.jsonl"),
			join(directoryPath, "sessions"),
			{ now: () => new Date("2026-05-24T08:30:00.000Z") },
		);
		const settingsStore = new InMemorySettingsStore();
		const project = await projectStore.createOrGet("/workspace/selected");
		const runtimeFactory = vi.fn<TestRuntimeFactory>(async (options) => {
			const projectRuntime = new FakeRuntime(options?.cwd ?? "/workspace/fallback");
			projectRuntime.mutableState.model = fakeModel;
			return projectRuntime;
		});
		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			agentDir: "/Users/test/.skylark",
			defaultCwd: "/workspace/fallback",
			projectStore,
			sessionStore,
			settingsStore,
		});

		const session = await sessionHost.newSession(project.id);

		expect(session?.cwd).toBe("/workspace/selected");
		expect(runtimeFactory).toHaveBeenCalledWith(
			expect.objectContaining({
				agentDir: "/Users/test/.skylark",
				cwd: "/workspace/selected",
				sessionFilePath: expect.stringMatching(
					/sessions[/\\]2026[/\\]05[/\\]24[/\\]2026-05-24T08-30-00-000Z-.+\.jsonl$/,
				),
			}),
		);
	});

	it("persists new sessions with the configured default provider", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const project = await projectStore.createOrGet("/workspace/project");
		await settingsStore.set("defaultProvider", "openai-codex");
		await settingsStore.set("defaultModel", "gpt-5.5");
		const sessionHost = new DesktopRuntimeHost(
			(options) =>
				createDesktopAgentRuntime({
					...options,
					getApiKey: async (provider) => (provider === "kimi-coding" ? "kimi-secret" : undefined),
					hasAuth: async (provider) => provider === "openai-codex" || provider === "kimi-coding",
					getSettings: () => readDesktopSettings(settingsStore),
					tools: [],
				}),
			{
				defaultCwd: "/workspace/project",
				projectStore,
				sessionStore,
				settingsStore,
			},
		);

		const createdSession = await sessionHost.newSession(project.id);
		const persistedSession = createdSession ? await sessionStore.get(createdSession.id) : undefined;

		expect(createdSession?.provider).toBe("openai-codex");
		expect(createdSession?.modelId).toBe("gpt-5.5");
		expect(persistedSession?.model.provider).toBe("openai-codex");
		expect(persistedSession?.model.id).toBe("gpt-5.5");
	});

	it("does not create a session when switching to an empty project", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const project = await projectStore.createOrGet("/workspace/empty");
		const runtimeFactory = vi.fn<TestRuntimeFactory>(async () => new FakeRuntime("/workspace/empty"));
		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			defaultCwd: "/workspace/empty",
			projectStore,
			sessionStore,
			settingsStore,
		});

		const switchedProject = await sessionHost.switchProject(project.id);
		const sessions = await sessionHost.listSessions(project.id);

		expect(switchedProject?.id).toBe(project.id);
		expect(sessions).toEqual([]);
		expect(await sessionStore.list()).toEqual([]);
		expect((await projectStore.get(project.id))?.lastOpenedSessionId).toBeUndefined();
		expect(runtimeFactory).not.toHaveBeenCalled();
	});

	it("loads a workspace overview without creating runtimes", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const firstProject = await projectStore.createOrGet("/workspace/one");
		const secondProject = await projectStore.createOrGet("/workspace/two");
		const firstSession = await sessionStore.create({
			cwd: firstProject.cwd,
			model: fakeModel,
			thinkingLevel: "off",
			messages: [{ role: "user", content: "First", timestamp: 1 }],
			title: "First session",
		});
		const secondSession = await sessionStore.create({
			cwd: secondProject.cwd,
			model: fakeModel,
			thinkingLevel: "off",
			messages: [{ role: "user", content: "Second", timestamp: 1 }],
			title: "Second session",
		});
		await settingsStore.set("lastOpenedProjectId", secondProject.id);
		await projectStore.updateLastOpenedSession(secondProject.id, secondSession.id);
		const listSessions = vi.spyOn(sessionStore, "list");
		const runtimeFactory = vi.fn<TestRuntimeFactory>(async () => new FakeRuntime("/workspace/unreachable"));
		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			defaultCwd: "/workspace/one",
			projectStore,
			sessionStore,
			settingsStore,
		});

		const overview = await sessionHost.getWorkspaceOverview();

		expect(runtimeFactory).not.toHaveBeenCalled();
		expect(overview.activeProjectId).toBe(secondProject.id);
		expect(overview.activeSessionId).toBe(secondSession.id);
		expect(overview.projects.find((project) => project.id === firstProject.id)?.sessionCount).toBe(1);
		expect(overview.projects.find((project) => project.id === secondProject.id)?.sessionCount).toBe(1);
		expect(overview.sessionsByProjectId[firstProject.id]?.map((session) => session.id)).toEqual([firstSession.id]);
		expect(overview.sessionsByProjectId[secondProject.id]?.map((session) => session.id)).toEqual([secondSession.id]);
		expect(await settingsStore.get("lastOpenedSessionId")).toBe(secondSession.id);
		expect(listSessions).toHaveBeenCalledTimes(2);
	});

	it("starts with an empty workspace overview for a clean installed app", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const runtimeFactory = vi.fn<TestRuntimeFactory>(async () => new FakeRuntime("/workspace/unreachable"));
		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			defaultCwd: "/workspace/dev-repo",
			projectStore,
			sessionStore,
			settingsStore,
		});

		const overview = await sessionHost.getWorkspaceOverview();
		const projects = await sessionHost.listProjects();
		const sessions = await sessionHost.listSessions();

		expect(overview).toEqual({
			projects: [],
			sessionsByProjectId: {},
			activeProjectId: undefined,
			activeSessionId: undefined,
		});
		expect(projects).toEqual([]);
		expect(sessions).toEqual([]);
		expect(await settingsStore.get("lastOpenedProjectId")).toBeUndefined();
		expect(await settingsStore.get("lastOpenedSessionId")).toBeUndefined();
		expect(runtimeFactory).not.toHaveBeenCalled();
	});

	it("lists capabilities for an empty project without persisting a session", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const project = await projectStore.createOrGet("/workspace/empty");
		const runtimeFactory = vi.fn<TestRuntimeFactory>(async (options) => {
			const runtime = new FakeRuntime(options?.cwd ?? "/workspace/fallback");
			runtime.mutableState.model = fakeModel;
			return runtime;
		});
		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			defaultCwd: "/workspace/empty",
			projectStore,
			sessionStore,
			settingsStore,
		});

		await sessionHost.switchProject(project.id);
		const catalog = await sessionHost.listCapabilities();

		expect(catalog).toEqual({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		});
		expect(runtimeFactory).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/workspace/empty", messages: [] }));
		expect(await sessionStore.list()).toEqual([]);
	});

	it("lists inactive project sessions without changing the active project", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const firstProject = await projectStore.createOrGet("/workspace/one");
		const secondProject = await projectStore.createOrGet("/workspace/two");
		const secondSession = await sessionStore.create({
			cwd: secondProject.cwd,
			model: fakeModel,
			thinkingLevel: "off",
			messages: [{ role: "user", content: "Second", timestamp: 1 }],
			title: "Second project session",
		});
		const runtimeFactory = vi.fn<TestRuntimeFactory>(async (options) => {
			const projectRuntime = new FakeRuntime(options?.cwd ?? "/workspace/fallback");
			projectRuntime.mutableState.model = fakeModel;
			projectRuntime.mutableState.messages = options?.messages ?? [];
			return projectRuntime;
		});

		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			defaultCwd: "/workspace/one",
			projectStore,
			sessionStore,
			settingsStore,
		});

		await sessionHost.switchProject(firstProject.id);
		const inactiveSessions = await sessionHost.listSessions(secondProject.id);

		expect(inactiveSessions.map((session) => session.id)).toEqual([secondSession.id]);
		expect(await settingsStore.get("lastOpenedProjectId")).toBe(firstProject.id);
	});

	it("restores the project last opened session when switching projects", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const project = await projectStore.createOrGet("/workspace/project");
		const firstSession = await sessionStore.create({
			cwd: project.cwd,
			model: fakeModel,
			thinkingLevel: "off",
			messages: [{ role: "user", content: "First", timestamp: 1 }],
			title: "First session",
		});
		await sessionStore.create({
			cwd: project.cwd,
			model: fakeModel,
			thinkingLevel: "off",
			messages: [{ role: "user", content: "Second", timestamp: 2 }],
			title: "Second session",
		});
		await projectStore.updateLastOpenedSession(project.id, firstSession.id);
		const runtimeFactory = vi.fn<TestRuntimeFactory>(async (options) => {
			const restoredRuntime = new FakeRuntime(options?.cwd ?? "/workspace/fallback");
			restoredRuntime.mutableState.model = fakeModel;
			restoredRuntime.mutableState.messages = options?.messages ?? [];
			return restoredRuntime;
		});

		const sessionHost = new DesktopRuntimeHost(runtimeFactory, {
			defaultCwd: "/workspace/project",
			projectStore,
			sessionStore,
			settingsStore,
		});

		await sessionHost.switchProject(project.id);
		const snapshot = await sessionHost.getSnapshot();

		expect(snapshot.sessionId).toBe(firstSession.id);
		expect(snapshot.messages).toEqual(firstSession.messages);
		expect(await settingsStore.get("lastOpenedSessionId")).toBe(firstSession.id);
	});

	it("creates projects for legacy persisted session cwd values", async () => {
		const projectStore = new InMemoryProjectStore();
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const legacySession = await sessionStore.create({
			cwd: "/workspace/legacy",
			model: fakeModel,
			thinkingLevel: "off",
			messages: [{ role: "user", content: "Legacy", timestamp: 1 }],
			title: "Legacy session",
		});

		const sessionHost = new DesktopRuntimeHost(
			async (options) => {
				const runtime = new FakeRuntime(options?.cwd ?? "/workspace/fallback");
				runtime.mutableState.model = fakeModel;
				return runtime;
			},
			{
				defaultCwd: "/workspace/default",
				projectStore,
				sessionStore,
				settingsStore,
			},
		);

		const projects = await sessionHost.listProjects();
		const legacyProject = projects.find((project) => project.cwd === normalizeProjectCwd("/workspace/legacy"));
		if (!legacyProject) {
			throw new Error("Expected legacy project to be created.");
		}
		const legacySessions = await sessionHost.listSessions(legacyProject.id);

		expect(legacyProject).toEqual(
			expect.objectContaining({
				name: "legacy",
				sessionCount: 1,
			}),
		);
		expect(legacySessions.map((session) => session.id)).toEqual([legacySession.id]);
	});

	it("persists emitted transcript messages into the current session", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const persistedRuntime = new FakeRuntime("/workspace/project");
		persistedRuntime.mutableState.model = fakeModel;

		const sessionHost = new DesktopRuntimeHost(async () => persistedRuntime, {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		await sessionHost.listSessions();

		persistedRuntime.mutableState.messages = [{ role: "user", content: "Read package.json", timestamp: 1 }];
		persistedRuntime.emit({
			type: "message_end",
			message: { role: "user", content: "Read package.json", timestamp: 1 },
		});
		persistedRuntime.mutableState.messages = [
			{ role: "user", content: "Read package.json", timestamp: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "The package name is skylark." }],
				api: "faux-provider",
				provider: "faux",
				model: "faux-desktop",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 2,
			},
		];
		persistedRuntime.emit({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "The package name is skylark." }],
				api: "faux-provider",
				provider: "faux",
				model: "faux-desktop",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 2,
			},
		});
		persistedRuntime.emit({
			type: "agent_end",
			messages: persistedRuntime.mutableState.messages,
		});

		await flushAsyncWork();

		const sessions = await sessionStore.list();
		const persistedSession = await sessionStore.get(sessions[0]!.id);

		expect(persistedSession?.messages).toHaveLength(2);
		expect(persistedSession?.messages[0]?.role).toBe("user");
		expect(persistedSession?.messages[1]?.role).toBe("assistant");
	});

	it("generates and broadcasts a compact session title after the first prompt", async () => {
		const registration = createFauxRegistration();
		registration.setResponses([fauxAssistantMessage("流动性风控")]);
		const titleModel = registration.getModel("desktop-host-model");
		if (!titleModel) {
			throw new Error("Expected faux title model.");
		}

		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const persistedRuntime = new FakeRuntime("/workspace/project");
		persistedRuntime.mutableState.model = titleModel;
		const events: SerializedAgentEvent[] = [];
		const sessionHost = new DesktopRuntimeHost(async () => persistedRuntime, {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		await sessionHost.subscribe((event) => {
			events.push(event);
		});
		const [session] = await sessionHost.listSessions();

		await sessionHost.prompt(session!.id, "请处理这个事件。先快速评估目标和约束，然后直接推进可执行部分。");
		for (let index = 0; index < 8; index += 1) {
			await flushAsyncWork();
		}

		expect(registration.state.callCount).toBe(1);
		expect((await sessionStore.get(session!.id))?.title).toBe("流动性风控");
		expect(events).toContainEqual({
			type: "session_title_update",
			sessionId: session!.id,
			title: "流动性风控",
		});
	});

	it("keeps the generated session title fixed after later prompts", async () => {
		const registration = createFauxRegistration();
		registration.setResponses([fauxAssistantMessage("初始风控命名"), fauxAssistantMessage("后续问题命名")]);
		const titleModel = registration.getModel("desktop-host-model");
		if (!titleModel) {
			throw new Error("Expected faux title model.");
		}

		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const persistedRuntime = new FakeRuntime("/workspace/project");
		persistedRuntime.mutableState.model = titleModel;
		persistedRuntime.prompt.mockImplementation(async (request) => {
			const text = typeof request === "string" ? request : request.text;
			const userTimestamp = persistedRuntime.mutableState.messages.length + 1;
			persistedRuntime.mutableState.messages = [
				...persistedRuntime.mutableState.messages,
				{ role: "user", content: text, timestamp: userTimestamp },
				createAssistantTextMessage("Done.", userTimestamp + 1),
			];
		});
		const events: SerializedAgentEvent[] = [];
		const sessionHost = new DesktopRuntimeHost(async () => persistedRuntime, {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		await sessionHost.subscribe((event) => {
			events.push(event);
		});
		const [session] = await sessionHost.listSessions();

		await sessionHost.prompt(session!.id, "请先评估流动性风险，并提出监控策略。");
		for (let index = 0; index < 8; index += 1) {
			await flushAsyncWork();
		}

		expect(registration.state.callCount).toBe(1);
		expect((await sessionStore.get(session!.id))?.title).toBe("初始风控命名");

		await sessionHost.prompt(session!.id, "再补充一个无关的客服回复模板。");
		for (let index = 0; index < 8; index += 1) {
			await flushAsyncWork();
		}

		expect(registration.state.callCount).toBe(1);
		expect((await sessionStore.get(session!.id))?.title).toBe("初始风控命名");
		expect(events.filter((event) => event.type === "session_title_update")).toEqual([
			{
				type: "session_title_update",
				sessionId: session!.id,
				title: "初始风控命名",
			},
		]);
	});

	it("keeps a running session alive when another session is created and activated", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const firstRuntime = new FakeRuntime("/workspace/project");
		firstRuntime.mutableState.model = fakeModel;
		const secondRuntime = new FakeRuntime("/workspace/project");
		secondRuntime.mutableState.model = fakeModel;
		const runDeferred = createDeferredPromise<void>();
		firstRuntime.prompt.mockImplementation(async () => {
			firstRuntime.mutableState.isStreaming = true;
			await runDeferred.promise;
			firstRuntime.mutableState.isStreaming = false;
		});

		const sessionHost = new DesktopRuntimeHost(
			vi.fn<TestRuntimeFactory>().mockResolvedValueOnce(firstRuntime).mockResolvedValueOnce(secondRuntime),
			{
				defaultCwd: "/workspace/project",
				sessionStore,
				settingsStore,
			},
		);

		const [firstSession] = await sessionHost.listSessions();
		await sessionHost.prompt(firstSession!.id, "Keep running in the first session.");
		const secondSession = await sessionHost.newSession();

		expect(firstRuntime.abort).not.toHaveBeenCalled();
		expect(firstRuntime.waitForIdle).not.toHaveBeenCalled();
		expect(secondSession?.id).not.toBe(firstSession!.id);
		expect(await settingsStore.get("lastOpenedSessionId")).toBe(secondSession?.id);
		expect((await sessionHost.listSessions()).find((session) => session.id === firstSession!.id)).toEqual(
			expect.objectContaining({
				isStreaming: true,
				runStartedAt: expect.any(String),
			}),
		);

		firstRuntime.mutableState.messages = [
			{ role: "user", content: "Keep running in the first session.", timestamp: 1 },
		];
		firstRuntime.emit({
			type: "message_end",
			message: { role: "user", content: "Keep running in the first session.", timestamp: 1 },
		});
		firstRuntime.emit({
			type: "agent_end",
			messages: firstRuntime.mutableState.messages,
		});
		await flushAsyncWork();

		expect((await sessionStore.get(firstSession!.id))?.messages).toEqual(firstRuntime.mutableState.messages);
		expect(await settingsStore.get("lastOpenedSessionId")).toBe(secondSession?.id);

		runDeferred.resolve();
		await flushAsyncWork();
	});

	it("allows parallel runs in different sessions but rejects a second run in the same session", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const firstRuntime = new FakeRuntime("/workspace/project");
		firstRuntime.mutableState.model = fakeModel;
		const secondRuntime = new FakeRuntime("/workspace/project");
		secondRuntime.mutableState.model = fakeModel;
		const firstRun = createDeferredPromise<void>();
		const secondRun = createDeferredPromise<void>();
		firstRuntime.prompt.mockImplementation(async () => {
			firstRuntime.mutableState.isStreaming = true;
			await firstRun.promise;
			firstRuntime.mutableState.isStreaming = false;
		});
		secondRuntime.prompt.mockImplementation(async () => {
			secondRuntime.mutableState.isStreaming = true;
			await secondRun.promise;
			secondRuntime.mutableState.isStreaming = false;
		});

		const sessionHost = new DesktopRuntimeHost(
			vi.fn<TestRuntimeFactory>().mockResolvedValueOnce(firstRuntime).mockResolvedValueOnce(secondRuntime),
			{
				defaultCwd: "/workspace/project",
				sessionStore,
				settingsStore,
			},
		);

		const [firstSession] = await sessionHost.listSessions();
		await sessionHost.prompt(firstSession!.id, "Run in the first session.");
		const secondSession = await sessionHost.newSession();
		await sessionHost.prompt(secondSession!.id, "Run in the second session.");

		expect(firstRuntime.prompt).toHaveBeenCalledWith({ text: "Run in the first session." });
		expect(secondRuntime.prompt).toHaveBeenCalledWith({ text: "Run in the second session." });
		await expect(sessionHost.prompt(firstSession!.id, "Run again too soon.")).rejects.toThrow(
			`Session '${firstSession!.id}' is already running.`,
		);

		firstRun.resolve();
		secondRun.resolve();
		await flushAsyncWork();
	});

	it("disposes active runtimes and clears stream listeners", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const runningRuntime = new FakeRuntime("/workspace/project");
		runningRuntime.mutableState.model = fakeModel;
		const run = createDeferredPromise<void>();
		runningRuntime.prompt.mockImplementation(async () => {
			runningRuntime.mutableState.isStreaming = true;
			await run.promise;
			runningRuntime.mutableState.isStreaming = false;
		});
		const sessionHost = new DesktopRuntimeHost(vi.fn<TestRuntimeFactory>().mockResolvedValue(runningRuntime), {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});
		const [session] = await sessionHost.listSessions();
		const listener = vi.fn();
		await sessionHost.subscribe(listener);

		await sessionHost.prompt(session!.id, "Keep running.");
		await flushAsyncWork();
		await sessionHost.disposeAll();
		runningRuntime.emit({ type: "agent_start" });
		run.resolve();
		await flushAsyncWork();

		expect(runningRuntime.abort).toHaveBeenCalledTimes(1);
		expect(runningRuntime.waitForIdle).toHaveBeenCalledTimes(1);
		expect(runningRuntime.dispose).toHaveBeenCalledTimes(1);
		expect(listener).not.toHaveBeenCalled();
	});

	it("updates the current session profile and persists the selected model and thinking level", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const persistedRuntime = new FakeRuntime("/workspace/project");
		persistedRuntime.mutableState.model = fakeModel;
		const sessionHost = new DesktopRuntimeHost(async () => persistedRuntime, {
			defaultCwd: "/workspace/project",
			getApiKey: async (provider) => (provider === "kimi-coding" ? "secret" : undefined),
			sessionStore,
			settingsStore,
		});

		const [session] = await sessionHost.listSessions();
		const snapshot = await sessionHost.updateSessionProfile({
			sessionId: session!.id,
			provider: "kimi-coding",
			modelId: "kimi-for-coding",
			thinkingLevel: "high",
		});
		const persistedSession = await sessionStore.get(session!.id);

		expect(snapshot.model?.provider).toBe("kimi-coding");
		expect(snapshot.model?.id).toBe("kimi-for-coding");
		expect(snapshot.thinkingLevel).toBe("high");
		expect(persistedSession?.model.provider).toBe("kimi-coding");
		expect(persistedSession?.model.id).toBe("kimi-for-coding");
		expect(persistedSession?.thinkingLevel).toBe("high");
	});

	it("passes the selected provider key into the active runtime when updating the session profile", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const opencodeModel = getModels("opencode")[0];
		if (!opencodeModel) {
			throw new Error("Expected OpenCode Zen test model.");
		}
		const persistedRuntime = new FakeRuntime("/workspace/project");
		persistedRuntime.mutableState.model = fakeModel;
		const sessionHost = new DesktopRuntimeHost(async () => persistedRuntime, {
			defaultCwd: "/workspace/project",
			getApiKey: async (provider) => (provider === opencodeModel.provider ? "opencode-key" : undefined),
			sessionStore,
			settingsStore,
		});

		const [session] = await sessionHost.listSessions();
		await sessionHost.updateSessionProfile({
			sessionId: session!.id,
			provider: opencodeModel.provider,
			modelId: opencodeModel.id,
		});

		expect(persistedRuntime.applySessionProfile).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "opencode-key",
				model: expect.objectContaining({
					id: opencodeModel.id,
					provider: opencodeModel.provider,
				}),
				thinkingLevel: "off",
			}),
		);
		expect((await sessionStore.get(session!.id))?.model.provider).toBe(opencodeModel.provider);
	});

	it("preserves xhigh thinking level for GPT-5.5 profile updates", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const persistedRuntime = new FakeRuntime("/workspace/project");
		persistedRuntime.mutableState.model = fakeModel;
		const sessionHost = new DesktopRuntimeHost(async () => persistedRuntime, {
			defaultCwd: "/workspace/project",
			getApiKey: async (provider) => (provider === "openai-codex" ? "secret" : undefined),
			sessionStore,
			settingsStore,
		});

		const [session] = await sessionHost.listSessions();
		const snapshot = await sessionHost.updateSessionProfile({
			sessionId: session!.id,
			provider: "openai-codex",
			modelId: "gpt-5.5",
			thinkingLevel: "xhigh",
		});
		const persistedSession = await sessionStore.get(session!.id);

		expect(snapshot.model?.provider).toBe("openai-codex");
		expect(snapshot.model?.id).toBe("gpt-5.5");
		expect(snapshot.thinkingLevel).toBe("xhigh");
		expect(persistedSession?.thinkingLevel).toBe("xhigh");
	});

	it("rejects explicit model profile updates without configured provider credentials", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const persistedRuntime = new FakeRuntime("/workspace/project");
		persistedRuntime.mutableState.model = fakeModel;
		const sessionHost = new DesktopRuntimeHost(async () => persistedRuntime, {
			defaultCwd: "/workspace/project",
			getApiKey: async () => undefined,
			sessionStore,
			settingsStore,
		});

		const [session] = await sessionHost.listSessions();

		await expect(
			sessionHost.updateSessionProfile({
				sessionId: session!.id,
				provider: "kimi-coding",
				modelId: "kimi-for-coding",
			}),
		).rejects.toThrow("has no usable API key");
	});

	it("rejects profile updates while the session is running", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const persistedRuntime = new FakeRuntime("/workspace/project");
		persistedRuntime.mutableState.model = fakeModel;
		persistedRuntime.mutableState.isStreaming = true;
		const sessionHost = new DesktopRuntimeHost(async () => persistedRuntime, {
			defaultCwd: "/workspace/project",
			sessionStore,
			settingsStore,
		});

		const [session] = await sessionHost.listSessions();

		await expect(
			sessionHost.updateSessionProfile({
				sessionId: session!.id,
				thinkingLevel: "high",
			}),
		).rejects.toThrow(`Session '${session!.id}' is already running.`);
	});

	it("persists real runtime transcript messages after a prompt completes", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const faux = createFauxRegistration();
		faux.setResponses([fauxAssistantMessage([fauxText("The package name is skylark.")])]);

		const sessionHost = new DesktopRuntimeHost(
			(options) =>
				createDesktopAgentRuntime({
					...options,
					cwd: "/workspace/project",
					getApiKey: async () => "faux-key",
					model: faux.getModel(),
					tools: [],
				}),
			{
				defaultCwd: "/workspace/project",
				sessionStore,
				settingsStore,
			},
		);

		const [session] = await sessionHost.listSessions();
		const agentEnded = createDeferredPromise<void>();
		const unsubscribe = await sessionHost.subscribe((event) => {
			if (event.sessionId === session!.id && event.type === "agent_end") {
				agentEnded.resolve();
			}
		});
		await sessionHost.prompt(session!.id, "Read package.json in this workspace and tell me the package name.");
		await agentEnded.promise;
		unsubscribe();
		await flushAsyncWork();

		const sessions = await sessionStore.list();
		const persistedSession = await sessionStore.get(sessions[0]!.id);
		const firstMessage = persistedSession?.messages[0];
		const secondMessage = persistedSession?.messages[1];

		expect(persistedSession?.messages).toHaveLength(2);
		expect(firstMessage).toEqual(
			expect.objectContaining({
				role: "user",
				timestamp: expect.any(Number),
			}),
		);
		expect(firstMessage?.role).toBe("user");
		if (firstMessage?.role !== "user" || typeof firstMessage.content === "string") {
			throw new Error("Expected the first persisted message to be a structured user message.");
		}
		expect(firstMessage.content).toEqual([
			{ type: "text", text: "Read package.json in this workspace and tell me the package name." },
		]);
		expect(secondMessage).toEqual(
			expect.objectContaining({
				role: "assistant",
				content: [{ type: "text", text: "The package name is skylark." }],
			}),
		);
	});

	it("restores persisted transcript messages into the initial runtime snapshot", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const faux = createFauxRegistration();
		const createdSession = await sessionStore.create({
			cwd: "/workspace/project",
			model: faux.getModel(),
			thinkingLevel: "off",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "Reply with exactly OK." }],
					timestamp: 1,
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "OK." }],
					api: "faux",
					provider: "desktop-host-faux",
					model: "desktop-host-model",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: 2,
				},
			],
			title: "Reply with exactly OK.",
		});
		await settingsStore.set("lastOpenedSessionId", createdSession.id);

		const sessionHost = new DesktopRuntimeHost(
			(options) =>
				createDesktopAgentRuntime({
					...options,
					cwd: "/workspace/project",
					model: faux.getModel(),
					tools: [],
				}),
			{
				defaultCwd: "/workspace/project",
				sessionStore,
				settingsStore,
			},
		);

		const snapshot = await sessionHost.getSnapshot();

		expect(snapshot.messages).toHaveLength(2);
		expect(snapshot.messages[0]).toEqual(
			expect.objectContaining({
				role: "user",
			}),
		);
		expect(snapshot.messages[1]).toEqual(
			expect.objectContaining({
				role: "assistant",
				content: [{ type: "text", text: "OK." }],
			}),
		);
	});

	it("lazily repairs legacy persisted Kimi model metadata when restoring a session", async () => {
		const sessionStore = new InMemorySessionStore();
		const settingsStore = new InMemorySettingsStore();
		const createdSession = await sessionStore.create({
			cwd: "/workspace/project",
			model: createLegacyKimiModel(),
			thinkingLevel: "off",
			messages: [],
			title: "Legacy Kimi session",
		});
		await settingsStore.set("lastOpenedSessionId", createdSession.id);

		const sessionHost = new DesktopRuntimeHost(
			(options) =>
				createDesktopAgentRuntime({
					...options,
					cwd: "/workspace/project",
					tools: [],
				}),
			{
				defaultCwd: "/workspace/project",
				sessionStore,
				settingsStore,
			},
		);

		const snapshot = await sessionHost.getSnapshot();
		const repairedSession = await sessionStore.get(createdSession.id);

		expect(snapshot.model?.contextWindow).toBe(256000);
		expect(repairedSession?.model.contextWindow).toBe(256000);
	});
});
