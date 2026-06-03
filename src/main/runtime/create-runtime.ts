import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
	AgentMessage,
	AgentState,
	AgentTool,
	BeforeToolCallContext,
	BeforeToolCallResult,
	StreamFn,
} from "@earendil-works/pi-agent-core";
import {
	type ThinkingLevel as AiThinkingLevel,
	completeSimple,
	getEnvApiKey,
	getModels,
	getProviders,
	type KnownProvider,
	type Model,
	type Transport,
} from "@earendil-works/pi-ai";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import {
	type AgentSession,
	type AgentSessionEvent,
	type AgentSessionServices,
	AuthStorage,
	type CompactionResult,
	createAgentSessionFromServices,
	createAgentSessionServices,
	getAgentDir,
	SessionManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { DesktopAgentDiagnostic } from "../../shared/serialized-agent-event.ts";
import type {
	DesktopAgentCreateEventInput,
	DesktopAgentMode,
	DesktopCapabilityCatalog,
	DesktopCapabilityDetail,
	DesktopCapabilityDetailRequest,
	DesktopCreateSkillRequest,
	DesktopEventDetail,
	DesktopMcpServerSummary,
	DesktopMcpServerUpsertRequest,
	DesktopPromptAttachmentDisplay,
	DesktopPromptSubmission,
	DesktopPromptTemplateDeleteRequest,
	DesktopPromptTemplateUpsertRequest,
	DesktopProviderAuthMethod,
	DesktopRuntimeCatalog,
	DesktopSettingsData,
	DesktopSubagentRuntimeEvent,
	DesktopTaskProgress,
} from "../../shared/types.ts";
import {
	DESKTOP_TASK_PROGRESS_TOOL_NAME,
	resolveDesktopAgentMode,
	resolveDesktopTaskProgress,
} from "../../shared/types.ts";
import {
	createCapabilityCatalog,
	createCapabilityTools,
	createDesktopSkill,
	deleteDesktopPromptTemplate,
	mergeCodexSkills,
	readCapabilityDetail,
	upsertDesktopPromptTemplate,
} from "../capabilities/resource-actions.ts";
import type { JsonEnvironmentResourceStore } from "../environment/environment-resource-store.ts";
import type { DesktopEventManagementGenerateText } from "../events/event-management-service.ts";
import type { DesktopMcpManager } from "../mcp/mcp-manager.ts";
import { DesktopMcpManager as DefaultDesktopMcpManager } from "../mcp/mcp-manager.ts";
import { DesktopMcpStore } from "../mcp/mcp-store.ts";
import type { DesktopApprovalRequester } from "../security/approval-broker.ts";
import { normalizeDesktopProviderIdentifier } from "../storage/provider-id.ts";
import type { DesktopAgentRuntime } from "./desktop-runtime-host.ts";
import {
	createModeAwareRuntimePolicy,
	DESKTOP_BASELINE_TOOL_NAMES,
	DESKTOP_CREATE_EVENTS_TOOL_NAME,
} from "./mode-aware-runtime-policy.ts";
import type {
	CoreAgentSessionEvent,
	SerializableAgentEvent,
	SerializableAgentSessionEvent,
} from "./serialize-agent-event.ts";

export { DESKTOP_SUBAGENT_TOOL_NAME } from "../../shared/types.ts";

export interface CreateDesktopAgentRuntimeOptions {
	sessionId?: string;
	sessionTitle?: string;
	cwd?: string;
	model?: Model<any>;
	systemPrompt?: string;
	thinkingLevel?: AgentState["thinkingLevel"];
	messages?: AgentMessage[];
	tools?: AgentTool[];
	streamFn?: StreamFn;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	hasAuth?: (provider: string) => Promise<boolean> | boolean;
	getSettings?: () => Promise<DesktopSettingsData> | DesktopSettingsData;
	agentDir?: string;
	agentSessionsDir?: string;
	subagentSessionsDir?: string;
	sessionFilePath?: string;
	mcpManager?: DesktopMcpManager;
	approvalRequester?: DesktopApprovalRequester;
	agentMode?: DesktopAgentMode;
	taskProgress?: DesktopTaskProgress;
	environmentResourceStore?: Pick<JsonEnvironmentResourceStore, "upsertResource">;
	publishSubagentEvent?: (event: DesktopSubagentRuntimeEvent) => void;
	createEvents?: (events: DesktopAgentCreateEventInput[]) => Promise<DesktopEventDetail[]>;
}

const DEFAULT_SYSTEM_PROMPT = [
	"You are Skylark, a local desktop AI agent.",
	"Use the available local tools to inspect, verify, and modify the current workspace when the answer depends on workspace state.",
	"Use concrete tools directly by their declared schemas; do not invent capability-activation steps.",
	"For long-running shell, test, dev-server, log, or resumable implementation work, load the bundled tmux skill and use bash with the documented tmux metadata conventions.",
	"Never claim to have read files, searched code, run commands, or changed anything unless you actually used a tool or the user supplied the content directly.",
	"Be concise, accurate, and explicit about tool usage and failures.",
].join(" ");

const DESKTOP_RESPONSE_PROTOCOL_PROMPT = [
	"Skylark response protocol:",
	"- Never reveal internal reasoning, hidden analysis, scratchpad notes, chain-of-thought, or channel-control text.",
	"- Do not include self-talk such as why you are answering, what you already did, or how you plan to produce the final answer.",
	"- When the user asks for exact output or content only, return only the requested output.",
	"- It is allowed and expected to quote exact local workspace file contents when the user asks you to read those files.",
].join("\n");

const DESKTOP_PROVIDER_TRANSPORT: Transport = "auto";
const DESKTOP_PROVIDER_REQUEST_TIMEOUT_MS = 45_000;
const DESKTOP_COMPLETION_FEEDBACK_ACTION_TOOL_NAMES = new Set([
	"edit",
	"write",
	DESKTOP_CREATE_EVENTS_TOOL_NAME,
	"create_skill",
	"create_prompt_template",
	"configure_mcp_server",
	"reload_capabilities",
]);
const DESKTOP_PROMPT_ATTACHMENTS_METADATA_KEY = "desktopPromptAttachments";
const DESKTOP_PROMPT_VISIBLE_TEXT_METADATA_KEY = "desktopPromptVisibleText";

const DESKTOP_MODEL_PREFERENCE: KnownProvider[] = [
	"anthropic",
	"openai",
	"google",
	"openrouter",
	"google-vertex",
	"amazon-bedrock",
	"mistral",
	"xai",
	"groq",
	"cerebras",
	"vercel-ai-gateway",
	"zai",
	"github-copilot",
	"azure-openai-responses",
	"huggingface",
	"minimax",
	"minimax-cn",
	"opencode",
	"opencode-go",
	"kimi-coding",
	"openai-codex",
];

const DESKTOP_PROVIDER_MODEL_PREFERENCES: Partial<Record<KnownProvider, readonly string[]>> = {
	groq: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"],
	"kimi-coding": ["kimi-for-coding"],
};

const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding";
const DESKTOP_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	anthropic: "Anthropic",
	"amazon-bedrock": "Amazon Bedrock",
	"azure-openai-responses": "Azure OpenAI Responses",
	cerebras: "Cerebras",
	"cloudflare-ai-gateway": "Cloudflare AI Gateway",
	"cloudflare-workers-ai": "Cloudflare Workers AI",
	deepseek: "DeepSeek",
	fireworks: "Fireworks",
	google: "Google Gemini",
	"google-vertex": "Google Vertex AI",
	groq: "Groq",
	"github-copilot": "GitHub Copilot",
	huggingface: "Hugging Face",
	"kimi-coding": "Kimi For Coding",
	mistral: "Mistral",
	minimax: "MiniMax",
	"minimax-cn": "MiniMax (China)",
	moonshotai: "Moonshot AI",
	"moonshotai-cn": "Moonshot AI (China)",
	opencode: "OpenCode Zen",
	"opencode-go": "OpenCode Go",
	openai: "OpenAI",
	"openai-codex": "OpenAI Codex",
	openrouter: "OpenRouter",
	together: "Together AI",
	"vercel-ai-gateway": "Vercel AI Gateway",
	xai: "xAI",
	zai: "ZAI",
};

interface DesktopProviderAuthLookup {
	getApiKey(provider: string): Promise<string | undefined>;
	hasAuth(provider: string): Promise<boolean>;
}

function createDesktopProviderAuthLookup(options: {
	getApiKey: (provider: string) => Promise<string | undefined> | string | undefined;
	hasAuth?: (provider: string) => Promise<boolean> | boolean;
}): DesktopProviderAuthLookup {
	const apiKeyPromises = new Map<string, Promise<string | undefined>>();
	const authPromises = new Map<string, Promise<boolean>>();

	const getApiKey = (provider: string): Promise<string | undefined> => {
		const normalizedProvider = normalizeDesktopProviderIdentifier(provider);
		const existing = apiKeyPromises.get(normalizedProvider);
		if (existing) {
			return existing;
		}

		const next = Promise.resolve(options.getApiKey(normalizedProvider));
		apiKeyPromises.set(normalizedProvider, next);
		return next;
	};

	const hasAuth = (provider: string): Promise<boolean> => {
		const normalizedProvider = normalizeDesktopProviderIdentifier(provider);
		const existing = authPromises.get(normalizedProvider);
		if (existing) {
			return existing;
		}

		const next = (async () => {
			if (options.hasAuth) {
				return Boolean(await options.hasAuth(normalizedProvider));
			}
			return (await getApiKey(normalizedProvider)) !== undefined;
		})();
		authPromises.set(normalizedProvider, next);
		return next;
	};

	return { getApiKey, hasAuth };
}

function uniqueProviders(): KnownProvider[] {
	const availableProviders = new Set(getProviders());
	const orderedProviders = DESKTOP_MODEL_PREFERENCE.filter((provider) => availableProviders.has(provider));

	for (const provider of getProviders()) {
		if (!orderedProviders.includes(provider)) {
			orderedProviders.push(provider);
		}
	}

	return orderedProviders;
}

function getDesktopCatalogProviders(): string[] {
	const providers = [...uniqueProviders()];
	if (!providers.includes("kimi-coding")) {
		providers.push("kimi-coding");
	}
	return providers;
}

export function getDesktopCatalogModelsForProvider(provider: string): Model<any>[] {
	if (provider === "kimi-coding") {
		return [createKimiCodingModel("kimi-for-coding")];
	}

	if ((getProviders() as string[]).includes(provider)) {
		return [...getModels(provider as KnownProvider)];
	}

	return [];
}

function getDesktopProviderAuthMethods(provider: string): DesktopProviderAuthMethod[] {
	if (provider === "anthropic") {
		return ["oauth", "api_key"];
	}
	if (provider === "github-copilot" || provider === "openai-codex") {
		return ["oauth"];
	}
	return ["api_key"];
}

function getDesktopProviderDisplayName(provider: string): string {
	return DESKTOP_PROVIDER_DISPLAY_NAMES[provider] ?? getOAuthProvider(provider)?.name ?? provider;
}

export function findDesktopCatalogModel(provider: string, modelId: string): Model<any> | undefined {
	return getDesktopCatalogModelsForProvider(normalizeDesktopProviderIdentifier(provider)).find(
		(model) => model.id === modelId,
	);
}

function isPositiveNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function hydrateDesktopModelMetadata(model: Model<any>): Model<any> {
	if (isPositiveNumber(model.contextWindow) && isPositiveNumber(model.maxTokens)) {
		return model;
	}

	const catalogModel = findDesktopCatalogModel(model.provider, model.id);
	if (!catalogModel) {
		return model;
	}

	return {
		...catalogModel,
		...model,
		contextWindow: isPositiveNumber(model.contextWindow) ? model.contextWindow : catalogModel.contextWindow,
		maxTokens: isPositiveNumber(model.maxTokens) ? model.maxTokens : catalogModel.maxTokens,
	};
}

export function pickPreferredDesktopModelForProvider(
	provider: KnownProvider,
	models: readonly Model<any>[],
	preferredModelId?: string,
): Model<any> | undefined {
	if (preferredModelId) {
		const configuredModel = models.find((model) => model.id === preferredModelId);
		if (configuredModel) {
			return configuredModel;
		}
	}

	const preferredModelIds = DESKTOP_PROVIDER_MODEL_PREFERENCES[provider];
	if (!preferredModelIds) {
		return models[0];
	}

	for (const modelId of preferredModelIds) {
		const preferredModel = models.find((model) => model.id === modelId);
		if (preferredModel) {
			return preferredModel;
		}
	}

	return models[0];
}

function createKimiCodingModel(modelId: string): Model<"anthropic-messages"> {
	return {
		id: modelId,
		name: modelId,
		api: "anthropic-messages",
		provider: "kimi-coding",
		baseUrl: KIMI_CODING_BASE_URL,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 256000,
		maxTokens: 16384,
	};
}

function createDesktopCustomProviderModel(provider: string, modelId?: string): Model<"anthropic-messages"> | undefined {
	const canonicalProvider = normalizeDesktopProviderIdentifier(provider);
	if (canonicalProvider !== "kimi-coding") {
		return undefined;
	}

	return createKimiCodingModel(modelId ?? "kimi-for-coding");
}

async function findPreferredDesktopModel(options: {
	authLookup: DesktopProviderAuthLookup;
	settings?: DesktopSettingsData;
}): Promise<{ diagnostics: DesktopAgentDiagnostic[]; model: Model<any> }> {
	const diagnostics: DesktopAgentDiagnostic[] = [];
	const configuredProvider = options.settings?.defaultProvider
		? normalizeDesktopProviderIdentifier(options.settings.defaultProvider)
		: undefined;
	const configuredModelId = options.settings?.defaultModel;

	if (configuredProvider) {
		const configuredProviderHasAuth = await options.authLookup.hasAuth(configuredProvider);
		const configuredCustomModel = createDesktopCustomProviderModel(configuredProvider, configuredModelId);
		if (configuredCustomModel) {
			if (!configuredProviderHasAuth) {
				diagnostics.push({
					type: "warning",
					message: `Configured provider ${configuredProvider} has no usable API key in desktop settings or environment. Prompts may fail until credentials are configured.`,
				});
			}
			return { diagnostics, model: configuredCustomModel };
		}

		if ((getProviders() as string[]).includes(configuredProvider)) {
			const configuredProviderModel = pickPreferredDesktopModelForProvider(
				configuredProvider as KnownProvider,
				getModels(configuredProvider as KnownProvider),
				configuredModelId,
			);
			if (configuredProviderModel) {
				if (!configuredProviderHasAuth) {
					diagnostics.push({
						type: "warning",
						message: `Configured provider ${configuredProvider} has no usable API key in desktop settings or environment. Prompts may fail until credentials are configured.`,
					});
				}
				return { diagnostics, model: configuredProviderModel };
			}
			diagnostics.push({
				type: "warning",
				message: `Configured model ${configuredModelId ?? "<unspecified>"} is unavailable for provider ${configuredProvider}. Falling back to other providers.`,
			});
		} else {
			diagnostics.push({
				type: "warning",
				message: `Configured provider ${configuredProvider} is not available in the desktop runtime. Falling back to other providers.`,
			});
		}
	}

	if (await options.authLookup.getApiKey("kimi-coding")) {
		return {
			diagnostics,
			model: createKimiCodingModel(configuredModelId ?? "kimi-for-coding"),
		};
	}

	const providers = uniqueProviders();

	for (const provider of providers) {
		const apiKey = await options.authLookup.getApiKey(provider);
		const model = pickPreferredDesktopModelForProvider(provider, getModels(provider));
		if (apiKey && model) {
			return { diagnostics, model };
		}
	}

	for (const provider of providers) {
		const model = pickPreferredDesktopModelForProvider(provider, getModels(provider));
		if (model) {
			diagnostics.push({
				type: "warning",
				message: `No configured provider credentials detected. Defaulting to ${model.provider}/${model.id}; prompts may fail until a provider is configured.`,
			});
			return { diagnostics, model };
		}
	}

	return {
		diagnostics: [
			{
				type: "error",
				message: "No built-in models are available in @earendil-works/pi-ai.",
			},
		],
		model: {
			id: "desktop-fallback",
			name: "Desktop Fallback",
			api: "openai-completions",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		},
	};
}

function isCoreAgentEvent(event: AgentSessionEvent): event is CoreAgentSessionEvent {
	return (
		event.type === "agent_start" ||
		event.type === "agent_end" ||
		event.type === "turn_start" ||
		event.type === "turn_end" ||
		event.type === "message_start" ||
		event.type === "message_update" ||
		event.type === "message_end" ||
		event.type === "tool_execution_start" ||
		event.type === "tool_execution_update" ||
		event.type === "tool_execution_end"
	);
}

function isSerializableAgentEvent(event: AgentSessionEvent): event is SerializableAgentSessionEvent {
	return isCoreAgentEvent(event) || event.type === "compaction_start" || event.type === "compaction_end";
}

async function createDesktopAuthStorage(
	authLookup: DesktopProviderAuthLookup,
	extraProviders: readonly string[] = [],
	agentDir = getAgentDir(),
): Promise<AuthStorage> {
	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	const providers = new Set([...getDesktopCatalogProviders(), ...extraProviders]);
	for (const provider of providers) {
		if (provider === "openai-codex") {
			continue;
		}
		const apiKey = await authLookup.getApiKey(provider);
		if (apiKey) {
			authStorage.setRuntimeApiKey(provider, apiKey);
		}
	}
	return authStorage;
}

function createDesktopSessionManager(options: {
	cwd: string;
	agentSessionsDir?: string;
	sessionFilePath?: string;
	sessionId?: string;
	model: Model<any>;
	thinkingLevel: AgentState["thinkingLevel"];
	messages: AgentMessage[];
}): SessionManager {
	const sessionManager = options.sessionFilePath
		? openPersistentDesktopSession(options.sessionFilePath, dirname(options.sessionFilePath), options.cwd)
		: options.agentSessionsDir && options.sessionId
			? openPersistentDesktopSession(
					join(options.agentSessionsDir, `${options.sessionId}.jsonl`),
					options.agentSessionsDir,
					options.cwd,
				)
			: SessionManager.inMemory(options.cwd);
	if (sessionManager.getEntries().length === 0 && options.messages.length > 0) {
		sessionManager.appendModelChange(options.model.provider, options.model.id);
		sessionManager.appendThinkingLevelChange(options.thinkingLevel);
		for (const message of options.messages) {
			sessionManager.appendMessage(message as never);
		}
	}
	return sessionManager;
}

function openPersistentDesktopSession(sessionPath: string, sessionDir: string, cwd: string): SessionManager {
	mkdirSync(sessionDir, { recursive: true });
	return SessionManager.open(sessionPath, sessionDir, cwd);
}

function buildDesktopStorageSystemPrompt(options: {
	agentDir: string;
	agentSessionsDir?: string;
	cwd: string;
	sessionFilePath?: string;
	subagentSessionsDir?: string;
}): string {
	const sessionsDir = options.agentSessionsDir ?? join(options.agentDir, "sessions");
	const subagentSessionsDir = options.subagentSessionsDir ?? join(options.agentDir, "subagents");
	const lines = [
		"Skylark storage and workspace boundaries:",
		`- Agent home: ${options.agentDir}`,
		`- Session transcripts directory: ${sessionsDir}`,
		`- Subagent transcripts directory: ${subagentSessionsDir}`,
	];
	if (options.sessionFilePath) {
		lines.push(`- Current session transcript: ${options.sessionFilePath}`);
	}
	lines.push(
		`- Treat the current working directory as the user's workspace, not as Skylark's agent home or session store: ${options.cwd}`,
		"- AGENTS.md and CLAUDE.md files in the workspace are user or project instructions only. They do not define Skylark's identity, agent home, configuration, or session storage.",
		"- Agent-specific folders inside the workspace, including .codex, .opencode, .claude, .cursor, .pi, and .agents, are ordinary project files unless the user explicitly asks to inspect them. Do not treat them as Skylark configuration or session storage.",
	);
	return lines.join("\n");
}

function createFallbackMcpManager(approvalRequester?: DesktopApprovalRequester): DesktopMcpManager {
	const filePath = join(tmpdir(), `skylark-mcp-${process.pid}.json`);
	return new DefaultDesktopMcpManager(new DesktopMcpStore(filePath), { approvalRequester });
}

function isEmptyAssistantText(message: Extract<AgentMessage, { role: "assistant" }>): boolean {
	return message.content.filter((part) => part.type === "text").every((part) => part.text.trim().length === 0);
}

function fillEmptyAssistantText(message: Extract<AgentMessage, { role: "assistant" }>, text: string): void {
	const textPartIndex = message.content.findIndex((part) => part.type === "text");
	if (textPartIndex === -1) {
		message.content = [...message.content, { type: "text", text }];
		return;
	}
	message.content = message.content.map((part, index) =>
		index === textPartIndex && part.type === "text" ? { ...part, text } : part,
	);
}

class LocalDesktopRuntime implements DesktopAgentRuntime {
	private capabilityQueue: Promise<void> = Promise.resolve();
	private readonly capabilityTools: ToolDefinition[];
	private completedActionToolInCurrentTurn = false;
	private installedToolGuard = false;
	private runtimePolicy: ReturnType<typeof createModeAwareRuntimePolicy> | undefined;
	private _agentMode: DesktopAgentMode;

	constructor(
		public readonly cwd: string,
		private readonly session: AgentSession,
		private readonly mcpManager: DesktopMcpManager,
		public readonly diagnostics: readonly DesktopAgentDiagnostic[],
		agentMode: DesktopAgentMode = "execute",
		private _taskProgress: DesktopTaskProgress | undefined = undefined,
		private readonly desktopSessionId: string | undefined = undefined,
		private readonly ownsMcpManager = false,
		private readonly agentDir = getAgentDir(),
		private readonly services?: AgentSessionServices,
		private readonly subagentSessionsDir?: string,
		private readonly environmentResourceStore?: Pick<JsonEnvironmentResourceStore, "upsertResource">,
		private readonly publishSubagentEvent?: (event: DesktopSubagentRuntimeEvent) => void,
		private readonly createEvents?: (events: DesktopAgentCreateEventInput[]) => Promise<DesktopEventDetail[]>,
	) {
		this._agentMode = agentMode;
		this.capabilityTools = createCapabilityTools({
			createSkill: (request) => this.createSkillDuringTurn(request),
			upsertPromptTemplate: (request) => this.upsertPromptTemplateDuringTurn(request),
			upsertMcpServer: (request) => this.upsertMcpServerDuringTurn(request),
			reloadCapabilities: () => this.reloadCapabilitiesDuringTurn(),
		});
	}

	get agentMode(): DesktopAgentMode {
		return this._agentMode;
	}

	get availableTools(): readonly string[] {
		return this.session.getActiveToolNames().filter((toolName) => toolName !== DESKTOP_TASK_PROGRESS_TOOL_NAME);
	}

	get taskProgress(): DesktopTaskProgress | undefined {
		return this._taskProgress;
	}

	setAgentMode(agentMode: DesktopAgentMode): void {
		this._agentMode = agentMode;
		this.runtimePolicy = undefined;
		this.refreshCustomTools();
	}

	getState(): AgentState {
		return this.session.state;
	}

	prompt(request: DesktopPromptSubmission | string): Promise<void> {
		const promptRequest = typeof request === "string" ? { text: request } : request;
		const attachments = promptRequest.attachments ?? [];
		const visibleText = promptRequest.text.trim();
		const attachmentText = attachments
			.map((attachment) => attachment.promptText)
			.filter((text) => text.trim().length > 0)
			.join("\n");
		const promptText = [visibleText, attachmentText].filter((text) => text.length > 0).join("\n\n");
		const attachmentImages = attachments.flatMap((attachment) => attachment.images);
		const attachmentMetadata: DesktopPromptAttachmentDisplay[] = attachments.map((attachment) => ({
			id: attachment.id,
			kind: attachment.kind,
			name: attachment.name,
			...(attachment.path ? { path: attachment.path } : {}),
			mimeType: attachment.mimeType,
			size: attachment.size,
		}));
		const runPrompt = async () => {
			await this.session.prompt(promptText, {
				...(promptRequest.capabilityInvocations
					? {
							capabilitySelections: promptRequest.capabilityInvocations.map((invocation) => ({
								type: invocation.type,
								name: invocation.name,
							})),
						}
					: {}),
				...(attachmentImages.length > 0 ? { images: attachmentImages } : {}),
				...(attachmentMetadata.length > 0
					? {
							customMetadata: {
								[DESKTOP_PROMPT_VISIBLE_TEXT_METADATA_KEY]: visibleText,
								[DESKTOP_PROMPT_ATTACHMENTS_METADATA_KEY]: attachmentMetadata,
							},
						}
					: {}),
				source: "interactive",
			});
		};
		return runPrompt();
	}

	compact(customInstructions?: string): Promise<CompactionResult> {
		return this.session.compact(customInstructions);
	}

	abort(): void {
		this.session.agent.abort();
	}

	waitForIdle(): Promise<void> {
		return this.session.agent.waitForIdle();
	}

	subscribe(listener: (event: SerializableAgentEvent) => void): () => void {
		return this.session.subscribe((event) => {
			this.ensureCompletionFeedback(event);
			if (isSerializableAgentEvent(event)) {
				listener(event);
			}
		});
	}

	private ensureCompletionFeedback(event: AgentSessionEvent): void {
		if (event.type === "message_start" && event.message.role === "user") {
			this.completedActionToolInCurrentTurn = false;
			return;
		}
		if (event.type === "message_end" && event.message.role === "toolResult") {
			if (!event.message.isError && DESKTOP_COMPLETION_FEEDBACK_ACTION_TOOL_NAMES.has(event.message.toolName)) {
				this.completedActionToolInCurrentTurn = true;
			}
			return;
		}
		if (
			event.type === "message_end" &&
			event.message.role === "assistant" &&
			event.message.stopReason === "stop" &&
			this.completedActionToolInCurrentTurn &&
			isEmptyAssistantText(event.message)
		) {
			fillEmptyAssistantText(event.message, "Done.");
		}
		if (event.type === "agent_end") {
			this.completedActionToolInCurrentTurn = false;
		}
	}

	async dispose(): Promise<void> {
		this.session.dispose();
		if (this.ownsMcpManager) {
			await this.mcpManager.disposeAll();
		}
	}

	listCapabilities(): Promise<DesktopCapabilityCatalog> {
		return createCapabilityCatalog(this.session, this.mcpManager);
	}

	getCapabilityDetail(request: DesktopCapabilityDetailRequest): Promise<DesktopCapabilityDetail> {
		return readCapabilityDetail(this.session, request);
	}

	createSkill(request: DesktopCreateSkillRequest): Promise<DesktopCapabilityCatalog> {
		return this.enqueueCapabilityMutation(async () => {
			await createDesktopSkill(this.cwd, this.agentDir, request);
			await this.session.reload();
			this.refreshCustomTools();
			return this.listCapabilities();
		});
	}

	upsertPromptTemplate(request: DesktopPromptTemplateUpsertRequest): Promise<DesktopCapabilityCatalog> {
		return this.enqueueCapabilityMutation(async () => {
			upsertDesktopPromptTemplate(this.cwd, this.agentDir, request);
			await this.session.reload();
			this.refreshCustomTools();
			return this.listCapabilities();
		});
	}

	deletePromptTemplate(request: DesktopPromptTemplateDeleteRequest): Promise<DesktopCapabilityCatalog> {
		return this.enqueueCapabilityMutation(async () => {
			deleteDesktopPromptTemplate(request);
			await this.session.reload();
			this.refreshCustomTools();
			return this.listCapabilities();
		});
	}

	upsertMcpServer(request: DesktopMcpServerUpsertRequest): Promise<DesktopCapabilityCatalog> {
		return this.enqueueCapabilityMutation(async () => {
			await this.mcpManager.upsertServer(request);
			this.refreshCustomTools();
			return this.listCapabilities();
		});
	}

	setMcpServerEnabled(serverId: string, enabled: boolean): Promise<DesktopCapabilityCatalog> {
		return this.enqueueCapabilityMutation(async () => {
			await this.mcpManager.setServerEnabled(serverId, enabled);
			this.refreshCustomTools();
			return this.listCapabilities();
		});
	}

	async testMcpServer(serverId: string): Promise<DesktopMcpServerSummary> {
		return this.mcpManager.testServer(serverId);
	}

	restartMcpServer(serverId: string): Promise<DesktopCapabilityCatalog> {
		return this.enqueueCapabilityMutation(async () => {
			await this.mcpManager.restartServer(serverId);
			this.refreshCustomTools();
			return this.listCapabilities();
		});
	}

	reloadCapabilities(): Promise<DesktopCapabilityCatalog> {
		return this.enqueueCapabilityMutation(async () => {
			await this.session.reload();
			this.refreshCustomTools();
			return this.listCapabilities();
		});
	}

	initializeCapabilities(): void {
		this.installPlanModeToolGuard();
		this.refreshCustomTools();
	}

	private installPlanModeToolGuard(): void {
		if (this.installedToolGuard) {
			return;
		}
		this.installedToolGuard = true;
		const previousBeforeToolCall = this.session.agent.beforeToolCall;
		this.session.agent.beforeToolCall = async (
			context: BeforeToolCallContext,
			signal?: AbortSignal,
		): Promise<BeforeToolCallResult | undefined> => {
			const blockReason = this.getRuntimePolicy().getToolBlockReason(context.toolCall.name, context.args);
			if (blockReason) {
				return { block: true, reason: blockReason };
			}
			return previousBeforeToolCall?.(context, signal);
		};
	}

	private getRuntimePolicy(): ReturnType<typeof createModeAwareRuntimePolicy> {
		if (!this.runtimePolicy) {
			this.runtimePolicy = createModeAwareRuntimePolicy({
				agentDir: this.agentDir,
				agentMode: this._agentMode,
				cwd: this.cwd,
				desktopSessionId: this.desktopSessionId ?? this.session.sessionId,
				environmentResourceStore: this.environmentResourceStore,
				getModel: () => this.session.state.model,
				getThinkingLevel: () => this.session.state.thinkingLevel,
				providerRequestTimeoutMs: DESKTOP_PROVIDER_REQUEST_TIMEOUT_MS,
				providerTransport: DESKTOP_PROVIDER_TRANSPORT,
				publishSubagentEvent: this.publishSubagentEvent,
				services: this.services,
				createEvents: this.createEvents,
				subagentSessionsDir: this.subagentSessionsDir,
				updateTaskProgress: (taskProgress) => {
					this._taskProgress = taskProgress;
				},
			});
		}
		return this.runtimePolicy;
	}

	private async createSkillDuringTurn(request: DesktopCreateSkillRequest): Promise<DesktopCapabilityCatalog> {
		this.assertExecuteModeForCapabilityMutation("create_skill");
		await createDesktopSkill(this.cwd, this.agentDir, request);
		await this.refreshResourcesForActiveTurn();
		return this.listCapabilities();
	}

	private async upsertPromptTemplateDuringTurn(
		request: DesktopPromptTemplateUpsertRequest,
	): Promise<DesktopCapabilityCatalog> {
		this.assertExecuteModeForCapabilityMutation("create_prompt_template");
		upsertDesktopPromptTemplate(this.cwd, this.agentDir, request);
		await this.refreshResourcesForActiveTurn();
		return this.listCapabilities();
	}

	private async upsertMcpServerDuringTurn(request: DesktopMcpServerUpsertRequest): Promise<DesktopCapabilityCatalog> {
		this.assertExecuteModeForCapabilityMutation("configure_mcp_server");
		await this.mcpManager.upsertServer(request);
		this.refreshCustomTools();
		return this.listCapabilities();
	}

	private assertExecuteModeForCapabilityMutation(toolName: string): void {
		if (this._agentMode === "plan") {
			throw new Error(`Plan mode blocks mutating tool '${toolName}'.`);
		}
	}

	private async reloadCapabilitiesDuringTurn(): Promise<DesktopCapabilityCatalog> {
		await this.refreshResourcesForActiveTurn();
		return this.listCapabilities();
	}

	private enqueueCapabilityMutation(
		action: () => Promise<DesktopCapabilityCatalog>,
	): Promise<DesktopCapabilityCatalog> {
		const next = this.capabilityQueue
			.catch(() => undefined)
			.then(async () => {
				if (this.session.isStreaming) {
					await this.waitForIdle();
				}
				return action();
			});
		this.capabilityQueue = next.then(() => undefined);
		return next;
	}

	private async refreshResourcesForActiveTurn(): Promise<void> {
		await this.session.resourceLoader.reload();
		this.refreshCustomTools();
	}

	private refreshCustomTools(): void {
		const runtimePolicy = this.getRuntimePolicy();
		const modeAwareBuiltInTools = runtimePolicy.builtInTools;
		const mcpTools =
			this._agentMode === "execute"
				? this.mcpManager.getToolDefinitions({ approvalRequester: undefined })
				: this.mcpManager.getToolDefinitions();
		const capabilityTools = this._agentMode === "execute" ? this.capabilityTools : [];
		this.session.setActiveToolsByName(
			runtimePolicy.resolveRefreshedActiveToolNames({
				builtInToolNames: modeAwareBuiltInTools.map((tool) => tool.name),
				capabilityToolNames: capabilityTools.map((tool) => tool.name),
				mcpToolNames: mcpTools.map((tool) => tool.name),
			}),
		);
	}
}

export async function createDesktopRuntimeCatalog(options: {
	getApiKey: (provider: string) => Promise<string | undefined> | string | undefined;
	hasAuth?: (provider: string) => Promise<boolean> | boolean;
}): Promise<DesktopRuntimeCatalog> {
	const authLookup = createDesktopProviderAuthLookup(options);
	const providers = await Promise.all(
		getDesktopCatalogProviders().map(async (provider) => ({
			id: provider,
			name: getDesktopProviderDisplayName(provider),
			configured: await authLookup.hasAuth(provider),
			authMethods: getDesktopProviderAuthMethods(provider),
			models: getDesktopCatalogModelsForProvider(provider).map((model) => ({
				id: model.id,
				name: model.name,
				reasoning: model.reasoning,
				contextWindow: isPositiveNumber(model.contextWindow) ? model.contextWindow : 0,
			})),
		})),
	);

	return {
		providers: providers.filter((provider) => provider.models.length > 0),
		defaultTools: [...DESKTOP_BASELINE_TOOL_NAMES],
	};
}

export async function createDesktopEventManagementGenerateText(
	options: Pick<CreateDesktopAgentRuntimeOptions, "getApiKey" | "hasAuth" | "getSettings"> = {},
): Promise<DesktopEventManagementGenerateText> {
	const getApiKey = options.getApiKey ?? ((provider: string) => getEnvApiKey(provider));
	const authLookup = createDesktopProviderAuthLookup({ getApiKey, hasAuth: options.hasAuth });
	const settings = await options.getSettings?.();
	const selected = await findPreferredDesktopModel({ authLookup, settings });
	const model = hydrateDesktopModelMetadata(selected.model);
	const reasoning: AiThinkingLevel | undefined =
		settings?.defaultThinkingLevel === "minimal" ||
		settings?.defaultThinkingLevel === "low" ||
		settings?.defaultThinkingLevel === "medium" ||
		settings?.defaultThinkingLevel === "high" ||
		settings?.defaultThinkingLevel === "xhigh"
			? settings.defaultThinkingLevel
			: undefined;

	return async ({ systemPrompt, prompt }) => {
		const apiKey = await authLookup.getApiKey(model.provider);
		const response = await completeSimple(
			model,
			{
				systemPrompt,
				messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			},
			{
				...(apiKey ? { apiKey } : {}),
				...(reasoning ? { reasoning } : {}),
				timeoutMs: DESKTOP_PROVIDER_REQUEST_TIMEOUT_MS,
			},
		);
		if (response.stopReason === "error") {
			throw new Error(response.errorMessage ?? "Event management proposal generation failed.");
		}
		const text = response.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim();
		if (!text) {
			throw new Error("Event management proposal generation returned no text.");
		}
		return text;
	};
}

export async function createDesktopAgentRuntime(
	options: CreateDesktopAgentRuntimeOptions = {},
): Promise<DesktopAgentRuntime> {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	const diagnostics: DesktopAgentDiagnostic[] = [];
	const getApiKey = options.getApiKey ?? ((provider: string) => getEnvApiKey(provider));
	const authLookup = createDesktopProviderAuthLookup({ getApiKey, hasAuth: options.hasAuth });
	const settings = await options.getSettings?.();
	const selected = options.model
		? { diagnostics, model: hydrateDesktopModelMetadata(options.model) }
		: await findPreferredDesktopModel({ authLookup, settings });
	const ownsMcpManager = !options.mcpManager;
	const mcpManager = options.mcpManager ?? createFallbackMcpManager(options.approvalRequester);
	await mcpManager.initialize();
	const agentMode = resolveDesktopAgentMode(options.agentMode);
	let taskProgress = resolveDesktopTaskProgress(options.taskProgress);

	const authStorage = await createDesktopAuthStorage(authLookup, [selected.model.provider], agentDir);
	const services = await createAgentSessionServices({
		cwd,
		agentDir,
		authStorage,
		resourceLoaderOptions: {
			systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
			appendSystemPrompt: [
				DESKTOP_RESPONSE_PROTOCOL_PROMPT,
				buildDesktopStorageSystemPrompt({
					agentDir,
					agentSessionsDir: options.agentSessionsDir,
					cwd,
					sessionFilePath: options.sessionFilePath,
					subagentSessionsDir: options.subagentSessionsDir,
				}),
			],
			skillsOverride: (base) => mergeCodexSkills(base, { agentDir }),
		},
	});
	const thinkingLevel = options.thinkingLevel ?? settings?.defaultThinkingLevel ?? "off";
	const sessionManager = createDesktopSessionManager({
		cwd,
		agentSessionsDir: options.agentSessionsDir,
		sessionFilePath: options.sessionFilePath,
		sessionId: options.sessionId,
		model: selected.model,
		thinkingLevel,
		messages: options.messages ?? [],
	});
	const customTools = createCapabilityTools({
		createSkill: async () => {
			throw new Error("Capability tools are not initialized yet.");
		},
		upsertPromptTemplate: async () => {
			throw new Error("Capability tools are not initialized yet.");
		},
		upsertMcpServer: async () => {
			throw new Error("Capability tools are not initialized yet.");
		},
		reloadCapabilities: async () => {
			throw new Error("Capability tools are not initialized yet.");
		},
	});
	const runtimePolicy = createModeAwareRuntimePolicy({
		agentDir,
		agentMode,
		cwd,
		desktopSessionId: options.sessionId ?? sessionManager.getSessionId(),
		environmentResourceStore: options.environmentResourceStore,
		getModel: () => selected.model,
		getThinkingLevel: () => thinkingLevel,
		providerRequestTimeoutMs: DESKTOP_PROVIDER_REQUEST_TIMEOUT_MS,
		providerTransport: DESKTOP_PROVIDER_TRANSPORT,
		publishSubagentEvent: options.publishSubagentEvent,
		services,
		createEvents: options.createEvents,
		subagentSessionsDir: options.subagentSessionsDir,
		updateTaskProgress: (nextTaskProgress) => {
			taskProgress = nextTaskProgress;
		},
	});
	const sessionResult = await createAgentSessionFromServices({
		services,
		sessionManager,
		model: selected.model,
		thinkingLevel,
		tools: options.tools ? options.tools.map((tool) => tool.name) : undefined,
		customTools: [
			...runtimePolicy.builtInTools,
			...customTools,
			...(agentMode === "execute"
				? mcpManager.getToolDefinitions({ approvalRequester: undefined })
				: mcpManager.getToolDefinitions()),
		],
	});
	if (!options.tools) {
		sessionResult.session.setActiveToolsByName(
			runtimePolicy.resolveInitialActiveToolNames(sessionResult.session.getActiveToolNames()),
		);
	}
	const runtime = new LocalDesktopRuntime(
		cwd,
		sessionResult.session,
		mcpManager,
		[
			...selected.diagnostics,
			...services.diagnostics.map((diagnostic) => ({ type: diagnostic.type, message: diagnostic.message })),
		],
		agentMode,
		taskProgress,
		options.sessionId,
		ownsMcpManager,
		agentDir,
		services,
		options.subagentSessionsDir,
		options.environmentResourceStore,
		options.publishSubagentEvent,
		options.createEvents,
	);
	runtime.initializeCapabilities();

	return runtime;
}
