import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type {
	DesktopAgentDiagnostic,
	DesktopAgentModel,
	SerializedAgentEventPayload,
} from "./serialized-agent-event.ts";

export type DesktopThemeMode = "light" | "dark" | "system";

export interface DesktopThemePalette {
	accentColor: string;
	backgroundColor: string;
	foregroundColor: string;
	uiFontFamily: string;
	codeFontFamily: string;
	translucentSidebar: boolean;
	contrast: number;
}

export interface DesktopAppearanceSettings {
	themeMode: DesktopThemeMode;
	uiFontSize: number;
	codeFontSize: number;
	lightTheme: DesktopThemePalette;
	darkTheme: DesktopThemePalette;
}

export const DEFAULT_DESKTOP_APPEARANCE_SETTINGS: DesktopAppearanceSettings = {
	themeMode: "system",
	uiFontSize: 13,
	codeFontSize: 12,
	lightTheme: {
		accentColor: "#0a84ff",
		backgroundColor: "#fafafa",
		foregroundColor: "#383a42",
		uiFontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
		codeFontFamily: '"SFMono-Regular", "SF Mono", ui-monospace, Menlo, Consolas, "JetBrains Mono", monospace',
		translucentSidebar: true,
		contrast: 50,
	},
	darkTheme: {
		accentColor: "#cc7d5e",
		backgroundColor: "#2d2d2b",
		foregroundColor: "#f9f9f7",
		uiFontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
		codeFontFamily: '"SFMono-Regular", "SF Mono", ui-monospace, Menlo, Consolas, "JetBrains Mono", monospace',
		translucentSidebar: true,
		contrast: 50,
	},
};

export interface DesktopSettingsData {
	appearance?: DesktopAppearanceSettings;
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: ThinkingLevel;
	showThinkingBlocks?: boolean;
	compactInstruction?: string;
	globalAgentsInstruction?: string;
	permissionApprovals?: DesktopPermissionApprovalSettings;
	lastOpenedProjectId?: string;
	lastOpenedSessionId?: string;
	windowStates?: Partial<Record<DesktopWindowKind, DesktopWindowState>>;
}

export type DesktopSettingKey = keyof DesktopSettingsData;

export type DesktopSettingsEvent = {
	type: "settings_updated";
	settings: DesktopSettingsData;
};

export type DesktopSettingsSectionId = "general" | "appearance" | "permissions" | "credentials";

export interface DesktopSettingsOpenRequest {
	section?: DesktopSettingsSectionId;
	providerId?: string;
}

export const DEFAULT_DESKTOP_COMPACT_INSTRUCTION =
	"Preserve the current goal, user preferences, key decisions, modified files, validation results, blockers, and next steps. Keep exact file paths, commands, errors, and identifiers needed to continue. Omit unrelated background.";

export type DesktopWindowKind = "main" | "settings";

export interface DesktopWindowState {
	x?: number;
	y?: number;
	width: number;
	height: number;
	isFullScreen?: boolean;
	isMaximized?: boolean;
}

export interface DesktopNativeAppearance {
	accentColor: string;
	colorScheme: "dark" | "light";
	forcedColors: boolean;
	highContrast: boolean;
	invertedColors: boolean;
	reducedTransparency: boolean;
}

export interface DesktopWebPreviewBounds {
	height: number;
	width: number;
	x: number;
	y: number;
}

export interface DesktopWebPreviewShowRequest {
	bounds: DesktopWebPreviewBounds;
	id: string;
	occluded?: boolean;
	url: string;
}

export interface DesktopWebPreviewBoundsRequest {
	bounds: DesktopWebPreviewBounds;
	id: string;
	occluded?: boolean;
}

export interface DesktopWebPreviewSnapshot {
	dataUrl: string;
}

export type DesktopWebPreviewControlAction = "back" | "forward" | "reload" | "stop";

export interface DesktopWebPreviewControlRequest {
	action: DesktopWebPreviewControlAction;
	id: string;
}

export interface DesktopWebPreviewCloseRequest {
	id: string;
}

export type DesktopWebPreviewStorageKind = "cache" | "cookies";

export interface DesktopWebPreviewStorageRequest {
	id: string;
	storage: DesktopWebPreviewStorageKind;
}

export interface DesktopWebPreviewElementSelection {
	ariaLabel?: string;
	className?: string;
	href?: string;
	id?: string;
	selector: string;
	tagName: string;
	text: string;
}

export interface DesktopWebPreviewSelectionModeRequest {
	enabled: boolean;
	id: string;
}

export interface DesktopWebPreviewState {
	canGoBack: boolean;
	canGoForward: boolean;
	errorMessage?: string;
	id: string;
	isSelectingElement?: boolean;
	isLoading: boolean;
	title: string;
	url: string;
}

export type DesktopWebPreviewEvent =
	| {
			state: DesktopWebPreviewState;
			type: "web_preview_state";
	  }
	| {
			id: string;
			selection: DesktopWebPreviewElementSelection;
			type: "web_preview_element_selected";
	  };

export type DesktopAgentMode = "plan" | "execute";

export const DEFAULT_DESKTOP_AGENT_MODE: DesktopAgentMode = "execute";
export const DESKTOP_TASK_PROGRESS_TOOL_NAME = "update_task_progress";
export const DESKTOP_SUBAGENT_TOOL_NAME = "subagent";

export const DESKTOP_TASK_PROGRESS_STATUSES = ["pending", "active", "completed", "failed"] as const;

export type DesktopTaskProgressStatus = (typeof DESKTOP_TASK_PROGRESS_STATUSES)[number];

export interface DesktopTaskProgressItem {
	id: string;
	label: string;
	status: DesktopTaskProgressStatus;
}

export interface DesktopTaskProgress {
	title?: string;
	items: DesktopTaskProgressItem[];
	updatedAt: string;
	completedAt?: string;
}

export interface DesktopTaskProgressToolResultDetails {
	taskProgress: DesktopTaskProgress;
}

export function resolveDesktopAgentMode(value: unknown): DesktopAgentMode {
	return value === "plan" || value === "execute" ? value : DEFAULT_DESKTOP_AGENT_MODE;
}

export function isDesktopTaskProgressStatus(value: unknown): value is DesktopTaskProgressStatus {
	return typeof value === "string" && DESKTOP_TASK_PROGRESS_STATUSES.includes(value as DesktopTaskProgressStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalProgressText(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

export function resolveDesktopTaskProgress(value: unknown): DesktopTaskProgress | undefined {
	if (!isRecord(value) || !Array.isArray(value.items)) {
		return undefined;
	}

	const updatedAt = typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt.trim() : undefined;
	if (!updatedAt) {
		return undefined;
	}

	const items: DesktopTaskProgressItem[] = [];
	const seenIds = new Set<string>();
	for (const item of value.items) {
		if (!isRecord(item)) {
			return undefined;
		}
		const id = normalizeOptionalProgressText(item.id);
		const label = normalizeOptionalProgressText(item.label);
		if (!id || !label || seenIds.has(id) || !isDesktopTaskProgressStatus(item.status)) {
			return undefined;
		}
		seenIds.add(id);
		items.push({ id, label, status: item.status });
	}

	if (items.length === 0) {
		return undefined;
	}

	return {
		...(normalizeOptionalProgressText(value.title) ? { title: normalizeOptionalProgressText(value.title) } : {}),
		items,
		updatedAt,
		...(normalizeOptionalProgressText(value.completedAt)
			? { completedAt: normalizeOptionalProgressText(value.completedAt) }
			: {}),
	};
}

export function resolveDesktopTaskProgressToolResult(value: unknown): DesktopTaskProgress | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const details = value.details;
	if (!isRecord(details)) {
		return undefined;
	}
	return resolveDesktopTaskProgress(details.taskProgress);
}

export function resolveConsumedProposedPlanMessageIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const consumedMessageIds: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") {
			continue;
		}
		const messageId = item.trim();
		if (!messageId || seen.has(messageId)) {
			continue;
		}
		seen.add(messageId);
		consumedMessageIds.push(messageId);
	}
	return consumedMessageIds;
}

export type DesktopApprovalCategory =
	| "bash"
	| "file_mutation"
	| "capability_mutation"
	| "mcp_tool"
	| "mcp_server_lifecycle"
	| "terminal";

export interface DesktopPermissionApprovalSettings {
	bash: boolean;
	fileMutation: boolean;
	capabilityMutation: boolean;
	mcpTool: boolean;
	mcpServerLifecycle: boolean;
	terminal: boolean;
}

export const DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS: DesktopPermissionApprovalSettings = {
	bash: true,
	fileMutation: true,
	capabilityMutation: true,
	mcpTool: true,
	mcpServerLifecycle: true,
	terminal: true,
};

export function resolveDesktopPermissionApprovalSettings(
	settings: Pick<DesktopSettingsData, "permissionApprovals"> | undefined,
): DesktopPermissionApprovalSettings {
	return {
		...DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		...(settings?.permissionApprovals ?? {}),
	};
}

export interface DesktopApprovalRequest {
	id: string;
	category: DesktopApprovalCategory;
	action: string;
	title: string;
	description?: string;
	subject?: string;
	cwd?: string;
	details?: Record<string, unknown>;
	createdAt: string;
}

export interface DesktopApprovalDecision {
	requestId: string;
	approved: boolean;
	reason?: string;
}

export type DesktopApprovalEvent =
	| {
			type: "approval_requested";
			request: DesktopApprovalRequest;
	  }
	| {
			type: "approval_resolved";
			decision: DesktopApprovalDecision;
	  };

export interface DesktopProviderKeyStatus {
	provider: string;
	configured: boolean;
}

export type DesktopProviderKeyTestResult =
	| {
			provider: string;
			ok: true;
			message: string;
			modelId?: string;
	  }
	| {
			provider: string;
			ok: false;
			message: string;
	  };

export type DesktopProviderAuthMethod = "api_key" | "oauth";

export interface DesktopOAuthProviderStatus {
	id: string;
	name: string;
	configured: boolean;
	source: "shared-auth";
	usesCallbackServer: boolean;
}

export type DesktopOAuthLoginEvent =
	| {
			type: "auth_url";
			provider: string;
			url: string;
			instructions?: string;
	  }
	| {
			type: "progress";
			provider: string;
			message: string;
	  }
	| {
			type: "manual_code_prompt";
			provider: string;
			message: string;
			placeholder?: string;
			allowEmpty?: boolean;
	  }
	| {
			type: "success";
			provider: string;
	  }
	| {
			type: "credentials_changed";
			provider?: string;
	  }
	| {
			type: "error";
			provider: string;
			message: string;
	  }
	| {
			type: "cancelled";
			provider: string;
	  };

export interface DesktopStorageSecurityState {
	secureStorageAvailable: boolean;
	providerKeysEncrypted: boolean;
}

export interface DesktopPromptCapabilityInvocation {
	type: "skill" | "prompt_template";
	name: string;
	description?: string;
	sourcePath?: string;
}

export interface DesktopPromptSubmission {
	text: string;
	capabilityInvocations?: DesktopPromptCapabilityInvocation[];
	attachments?: DesktopPreparedPromptAttachment[];
}

export interface DesktopPromptRequest extends DesktopPromptSubmission {
	sessionId: string;
}

export type DesktopPromptAttachmentCandidate =
	| {
			type: "path";
			path: string;
	  }
	| {
			type: "inline_image";
			name: string;
			mimeType: string;
			data: string;
			size?: number;
	  };

export type DesktopPromptAttachmentKind = "text" | "image";

export interface DesktopPromptAttachmentSummary {
	id: string;
	kind: DesktopPromptAttachmentKind;
	name: string;
	path?: string;
	mimeType: string;
	size: number;
}

export interface DesktopPreparedPromptAttachment extends DesktopPromptAttachmentSummary {
	promptText: string;
	images: ImageContent[];
}

export type DesktopPromptAttachmentDisplay = DesktopPromptAttachmentSummary;

export interface DesktopPromptAttachmentError {
	name: string;
	path?: string;
	message: string;
}

export interface DesktopPreparePromptAttachmentsRequest {
	candidates: DesktopPromptAttachmentCandidate[];
}

export interface DesktopOpenPromptAttachmentsRequest {
	sessionId: string;
}

export interface DesktopPreparePromptAttachmentsResult {
	attachments: DesktopPreparedPromptAttachment[];
	errors: DesktopPromptAttachmentError[];
}

export const DESKTOP_EVENT_STATUSES = ["inbox", "ready", "running", "completed", "discarded"] as const;

export type DesktopEventStatus = (typeof DESKTOP_EVENT_STATUSES)[number];

export const DESKTOP_EVENT_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

export type DesktopEventPriority = (typeof DESKTOP_EVENT_PRIORITIES)[number];

export const DESKTOP_EVENT_RUN_STATUSES = ["running", "awaiting_review", "failed", "aborted"] as const;

export type DesktopEventRunStatus = (typeof DESKTOP_EVENT_RUN_STATUSES)[number];

export type DesktopEventCommentAuthor = "user" | "agent";

export type DesktopEventCommentSource = "manual" | "management_proposal";

export interface DesktopEventAttachmentDraft {
	id: string;
	name: string;
	sourcePath: string;
	mimeType: string;
	size: number;
	textSnapshot?: string;
	extractionError?: string;
}

export interface DesktopEventAttachment {
	id: string;
	name: string;
	originalPath: string;
	storedPath: string;
	mimeType: string;
	size: number;
	textSnapshot?: string;
	extractionError?: string;
	createdAt: string;
}

export interface DesktopEventRun {
	id: string;
	projectId: string;
	promptText: string;
	attachmentIds: string[];
	status: DesktopEventRunStatus;
	createdAt: string;
	updatedAt: string;
	sessionId?: string;
	completedAt?: string;
	errorMessage?: string;
}

export interface DesktopEventComment {
	id: string;
	author: DesktopEventCommentAuthor;
	body: string;
	createdAt: string;
	source?: DesktopEventCommentSource;
	proposalId?: string;
}

export interface DesktopEventSummary {
	id: string;
	title: string;
	bodyPreview: string;
	status: DesktopEventStatus;
	priority?: DesktopEventPriority;
	attachmentCount: number;
	commentCount: number;
	createdAt: string;
	updatedAt: string;
	statusChangedAt: string;
	completedAt?: string;
	discardedAt?: string;
	latestCommentAt?: string;
	activeRunStatus?: Extract<DesktopEventRunStatus, "running">;
	activeSessionId?: string;
	latestRunStatus?: DesktopEventRunStatus;
	latestRunAt?: string;
	latestSessionId?: string;
}

export interface DesktopEventDetail extends DesktopEventSummary {
	body: string;
	attachments: DesktopEventAttachment[];
	runs: DesktopEventRun[];
	comments: DesktopEventComment[];
}

export interface DesktopEventListRequest {
	includeDiscarded?: boolean;
}

export interface DesktopEventCreateRequest {
	title?: string;
	body?: string;
	priority?: DesktopEventPriority;
	attachments?: DesktopEventAttachmentDraft[];
}

export interface DesktopEventUpdateRequest {
	eventId: string;
	title?: string;
	body?: string;
	priority?: DesktopEventPriority | null;
}

export interface DesktopEventCommentCreateRequest {
	eventId: string;
	author: DesktopEventCommentAuthor;
	body: string;
}

export interface DesktopEventManagementCriteria {
	path: string;
	content: string;
}

export interface DesktopEventManagementCriteriaUpdateRequest {
	content: string;
}

export interface DesktopEventManagementProposalItem {
	id: string;
	eventId: string;
	priority?: DesktopEventPriority;
	status?: Exclude<DesktopEventStatus, "running">;
	commentBody: string;
	reason: string;
}

export interface DesktopEventManagementProposal {
	id: string;
	items: DesktopEventManagementProposalItem[];
	createdAt: string;
	criteriaPath: string;
}

export interface DesktopEventManagementProposalRequest {
	includeCompleted?: boolean;
}

export interface DesktopEventManagementApplyRequest {
	proposalId: string;
	selectedItemIds: string[];
	items: DesktopEventManagementProposalItem[];
}

export interface DesktopAgentCreateEventInput {
	title?: string;
	body?: string;
}

export interface DesktopCreateEventsToolResultDetails {
	events: DesktopEventSummary[];
}

export interface DesktopEventStatusUpdateRequest {
	eventId: string;
	status: DesktopEventStatus;
}

export interface DesktopEventDeleteRequest {
	eventId: string;
}

export interface DesktopEventAttachmentCandidate {
	type: "path";
	path: string;
}

export interface DesktopPrepareEventAttachmentsRequest {
	candidates: DesktopEventAttachmentCandidate[];
}

export interface DesktopOpenEventAttachmentsRequest {
	defaultPath?: string;
}

export interface DesktopEventAttachmentError {
	name: string;
	path?: string;
	message: string;
}

export interface DesktopPrepareEventAttachmentsResult {
	attachments: DesktopEventAttachmentDraft[];
	errors: DesktopEventAttachmentError[];
}

export interface DesktopEventRunRequest {
	eventId: string;
	projectId: string;
	promptText: string;
	attachmentIds?: string[];
}

export interface DesktopEventRunResult {
	event: DesktopEventDetail;
	session: DesktopSessionSummary;
}

export type DesktopEventEvent =
	| {
			type: "event_updated";
			event: DesktopEventDetail;
			updatedAt: string;
	  }
	| {
			type: "event_deleted";
			eventId: string;
			updatedAt: string;
	  };

export interface DesktopCompactRequest {
	sessionId: string;
	customInstructions?: string;
}

export interface DesktopSessionProfileUpdateRequest {
	sessionId: string;
	provider?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
}

export type DesktopSessionProfileUpdateInput = Omit<DesktopSessionProfileUpdateRequest, "sessionId">;

export interface DesktopSessionModeUpdateRequest {
	sessionId: string;
	agentMode: DesktopAgentMode;
}

export interface DesktopExecutePlanRequest {
	sessionId: string;
}

export interface DesktopConsumeProposedPlanRequest {
	sessionId: string;
	planMessageId: string;
}

export interface DesktopReviewSnapshotRequest {
	projectId?: string;
	sessionId?: string;
}

export interface DesktopReviewFilePatchRequest extends DesktopReviewSnapshotRequest {
	path: string;
}

export interface DesktopWorkspacePreviewFileRequest extends DesktopReviewSnapshotRequest {
	path: string;
}

export type DesktopWorkspaceFileType = "code" | "docs" | "images" | "data" | "other";

export interface DesktopWorkspaceFileEntry {
	path: string;
	name: string;
	type: DesktopWorkspaceFileType;
	size: number;
	updatedAt: string;
}

export interface DesktopWorkspaceFileListRequest extends DesktopReviewSnapshotRequest {
	limit?: number;
}

export interface DesktopWorkspaceFileListResult {
	rootPath?: string;
	files: DesktopWorkspaceFileEntry[];
	truncated: boolean;
	errorMessage?: string;
}

export interface DesktopProjectSummary {
	id: string;
	name: string;
	cwd: string;
	createdAt: string;
	updatedAt: string;
	sessionCount: number;
	lastOpenedSessionId?: string;
}

export const DESKTOP_WORKSPACE_STATUSES = ["created", "starting", "running", "paused", "archived", "crashed"] as const;

export type DesktopWorkspaceStatus = (typeof DESKTOP_WORKSPACE_STATUSES)[number];

export type DesktopWorkspacePaneRole = "agent" | "shell" | "dev-server" | "test" | "logs";
export type DesktopWorkspacePaneControlOwner = "agent" | "none" | "user";

export interface DesktopWorkspacePaneDefinition {
	id: string;
	role: DesktopWorkspacePaneRole;
	title: string;
	command?: string;
	cwd?: string;
	controlOwner?: DesktopWorkspacePaneControlOwner;
}

export interface DesktopWorkspaceResourcePolicy {
	historyLimit: number;
	idlePauseMinutes: number;
	maxWorkspaceLogBytes: number;
	maxHotWorkspaces: number;
	snapshotRetentionDays: number;
}

export interface DesktopWorkspace {
	id: string;
	taskTitle?: string;
	projectId?: string;
	repoPath: string;
	worktreePath?: string;
	piSessionId?: string;
	piSessionPath?: string;
	tmuxSocketPath?: string;
	tmuxSessionName?: string;
	status: DesktopWorkspaceStatus;
	paneDefinitions: DesktopWorkspacePaneDefinition[];
	resourcePolicy: DesktopWorkspaceResourcePolicy;
	pinned?: boolean;
	createdAt: string;
	updatedAt: string;
	lastOpenedAt?: string;
	lastActivityAt?: string;
}

export type DesktopWorkspaceRuntimeStatus = "archived" | "error" | "paused" | "running" | "unavailable";

export interface DesktopWorkspaceRuntimePane {
	role: DesktopWorkspacePaneRole;
	title: string;
	windowName: string;
	paneId?: string;
	currentCommand?: string;
	currentPath?: string;
	dead: boolean;
	state: "missing" | "running" | "dead";
	controlOwner: DesktopWorkspacePaneControlOwner;
}

export type DesktopWorkspaceRuntimeWorkspace = Omit<DesktopWorkspace, "tmuxSessionName" | "tmuxSocketPath">;

export interface DesktopWorkspaceContextRedaction {
	kind: string;
	count: number;
}

export interface DesktopWorkspaceContextBlock {
	kind: "error" | "test-failure" | "warning" | string;
	text: string;
}

export interface DesktopWorkspacePaneSnapshotSummary {
	id: string;
	workspaceId: string;
	paneId: string;
	paneRole?: DesktopWorkspacePaneRole;
	capturedAt: string;
	lineCount: number;
	redactions: DesktopWorkspaceContextRedaction[];
	extractedBlocks: DesktopWorkspaceContextBlock[];
	reason?: string;
}

export interface DesktopWorkspaceRuntimeSummary {
	workspace: DesktopWorkspaceRuntimeWorkspace;
	runtimeStatus: DesktopWorkspaceRuntimeStatus;
	tmuxAvailable: boolean;
	panes: DesktopWorkspaceRuntimePane[];
	latestSnapshots: DesktopWorkspacePaneSnapshotSummary[];
	errorMessage?: string;
}

export interface DesktopWorkspaceRuntimeCaptureRequest {
	workspaceId: string;
	roles?: DesktopWorkspacePaneRole[];
	linesPerPane?: number;
	reason?: string;
}

export interface DesktopWorkspaceRuntimeCreateDebugRequest {
	projectId?: string;
	repoPath?: string;
	taskTitle?: string;
	issue?: string;
}

export interface DesktopWorkspaceRuntimePaneControlRequest {
	workspaceId: string;
	role: DesktopWorkspacePaneRole;
}

export interface DesktopWorkspaceRuntimePaneTextRequest extends DesktopWorkspaceRuntimePaneControlRequest {
	text: string;
	pressEnter?: boolean;
}

export interface DesktopWorkspaceRuntimeCaptureResult {
	workspaceId: string;
	capturedAt: string;
	snapshots: DesktopWorkspacePaneSnapshotSummary[];
	combinedText: string;
	failures: Array<{ role?: DesktopWorkspacePaneRole; message: string }>;
}

export const DESKTOP_ENVIRONMENT_RESOURCE_KINDS = ["tmux_session", "tmux_window", "subagent"] as const;
export type DesktopEnvironmentResourceKind = (typeof DESKTOP_ENVIRONMENT_RESOURCE_KINDS)[number];
export type DesktopEnvironmentResourceProvider = "subagent" | "tmux";
export type DesktopEnvironmentResourceStatus = "completed" | "detached" | "failed" | "running" | "stale" | "unknown";

export const DESKTOP_SUBAGENT_STATUSES = ["running", "completed", "failed"] as const;
export type DesktopSubagentStatus = (typeof DESKTOP_SUBAGENT_STATUSES)[number];
export type DesktopSubagentLimitReason = "max_turns";

export interface DesktopSubagentToolResultDetails {
	title: string;
	task: string;
	contextSummary: string;
	scope: string;
	successCriteria: string;
	expectedOutput: string;
	knownFacts?: string;
	suggestedApproach?: string;
	subagentId: string;
	transcriptPath?: string;
	status: DesktopSubagentStatus;
	startedAt: string;
	completedAt?: string;
	durationMs?: number;
	maxTurns: number;
	timeoutSeconds: number;
	summaryMaxChars: number;
	turnCount: number;
	limitReached?: boolean;
	limitReason?: DesktopSubagentLimitReason;
	summary?: string;
	errorMessage?: string;
}

export interface DesktopSubagentSnapshotRequest {
	parentSessionId: string;
	subagentId: string;
}

export interface DesktopSubagentOpenRequest extends DesktopSubagentSnapshotRequest {
	nonce: number;
	title?: string;
}

export interface DesktopSubagentSnapshot {
	parentSessionId: string;
	subagentId: string;
	resource: DesktopEnvironmentResource;
	sessionId: string;
	cwd: string;
	agentMode: DesktopAgentMode;
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

export interface DesktopSubagentRuntimeEvent extends DesktopSubagentSnapshotRequest {
	event: SerializedAgentEventPayload;
}

export interface DesktopEnvironmentResource {
	id: string;
	sessionId: string;
	projectId?: string;
	cwd: string;
	kind: DesktopEnvironmentResourceKind;
	provider: DesktopEnvironmentResourceProvider;
	parentId?: string;
	title: string;
	status: DesktopEnvironmentResourceStatus;
	metadata: Record<string, string>;
	createdAt: string;
	updatedAt: string;
	lastSeenAt: string;
}

export interface DesktopEnvironmentResourceListRequest {
	sessionId?: string;
}

export interface DesktopEnvironmentResourceDetachRequest {
	resourceId: string;
}

export type DesktopEnvironmentEvent =
	| {
			type: "environment_resources_updated";
			resources: DesktopEnvironmentResource[];
			updatedAt: string;
	  }
	| {
			type: "environment_resource_detached";
			resource: DesktopEnvironmentResource;
			updatedAt: string;
	  };

export type DesktopWorkspaceRuntimeEvent =
	| {
			type: "runtime_updated";
			summary: DesktopWorkspaceRuntimeSummary;
			updatedAt: string;
	  }
	| {
			type: "snapshot_created";
			workspaceId: string;
			capturedAt: string;
			snapshots: DesktopWorkspacePaneSnapshotSummary[];
	  }
	| {
			type: "audit_recorded";
			workspaceId: string;
			actionType: "return-pane-control" | "send-text" | "takeover-pane";
			recordedAt: string;
	  };

export interface DesktopSessionSummary {
	id: string;
	title: string;
	cwd: string;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
	agentMode: DesktopAgentMode;
	provider?: string;
	modelId?: string;
	isStreaming?: boolean;
	runStartedAt?: string;
}

export interface DesktopPersistedSession {
	id: string;
	sessionFilePath?: string;
	title: string;
	cwd: string;
	createdAt: string;
	updatedAt: string;
	agentMode?: DesktopAgentMode;
	consumedProposedPlanMessageIds?: string[];
	taskProgress?: DesktopTaskProgress;
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	messages: AgentMessage[];
}

export interface DesktopRuntimeCatalogModel {
	id: string;
	name: string;
	reasoning: boolean;
	contextWindow: number;
}

export interface DesktopRuntimeCatalogProvider {
	id: string;
	name: string;
	configured: boolean;
	authMethods: DesktopProviderAuthMethod[];
	models: DesktopRuntimeCatalogModel[];
}

export interface DesktopRuntimeCatalog {
	providers: DesktopRuntimeCatalogProvider[];
	defaultTools: string[];
}

export interface DesktopWorkspaceOverview {
	settings: DesktopSettingsData;
	projects: DesktopProjectSummary[];
	sessionsByProjectId: Record<string, DesktopSessionSummary[]>;
	activeProjectId?: string;
	activeSessionId?: string;
}

export type DesktopReviewStatus = "unavailable" | "not_git" | "clean" | "changed" | "error";

export type DesktopReviewFileStatus = "added" | "deleted" | "modified" | "renamed" | "untracked";

export interface DesktopReviewTotals {
	files: number;
	additions: number;
	deletions: number;
}

export interface DesktopReviewFile {
	path: string;
	previousPath?: string;
	status: DesktopReviewFileStatus;
	additions: number;
	deletions: number;
	staged: boolean;
	unstaged: boolean;
	isBinary: boolean;
	isTooLarge: boolean;
	patch?: string;
}

export interface DesktopReviewActionAvailability {
	commit: false;
	push: false;
	createPullRequest: false;
	createBranch: false;
	reason: string;
}

export interface DesktopReviewSnapshot {
	status: DesktopReviewStatus;
	cwd?: string;
	repositoryRoot?: string;
	branch?: string;
	files: DesktopReviewFile[];
	totals: DesktopReviewTotals;
	patch?: string;
	errorMessage?: string;
	generatedAt: string;
	actions: DesktopReviewActionAvailability;
}

export type DesktopPreviewFileKind = "text" | "html" | "svg" | "image" | "unsupported" | "too_large";

export interface DesktopPreviewFileRequest {
	path: string;
}

export interface DesktopPreviewFile {
	path: string;
	name: string;
	mimeType: string;
	size: number;
	kind: DesktopPreviewFileKind;
	updatedAt: string;
	content?: string;
	dataUrl?: string;
	previewUrl?: string;
	errorMessage?: string;
}

export type DesktopCapabilityScope = "project" | "global";

export interface DesktopCapabilitySource {
	label: string;
	path?: string;
	scope?: DesktopCapabilityScope | "external" | "package";
	readOnly?: boolean;
}

export interface DesktopSkillSummary {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	disableModelInvocation: boolean;
	source: DesktopCapabilitySource;
}

export interface DesktopPromptTemplateSummary {
	name: string;
	description: string;
	argumentHint?: string;
	filePath: string;
	source: DesktopCapabilitySource;
}

export interface DesktopCapabilityDetailRequest {
	type: "skill" | "prompt_template";
	filePath: string;
}

export type DesktopCapabilityDetail =
	| {
			type: "skill";
			name: string;
			description: string;
			body: string;
			filePath: string;
			source: DesktopCapabilitySource;
			disableModelInvocation: boolean;
	  }
	| {
			type: "prompt_template";
			name: string;
			description: string;
			body: string;
			filePath: string;
			source: DesktopCapabilitySource;
			argumentHint?: string;
	  };

export type DesktopSlashCommandSource = "extension" | "prompt" | "skill" | "builtin";

export interface DesktopSlashCommandSummary {
	name: string;
	description?: string;
	source: DesktopSlashCommandSource;
	sourcePath?: string;
}

export type DesktopMcpServerStatus = "disabled" | "connecting" | "connected" | "error";

export interface DesktopMcpToolSummary {
	name: string;
	adapterName: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export interface DesktopMcpServerSummary {
	id: string;
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
	cwd?: string;
	enabled: boolean;
	status: DesktopMcpServerStatus;
	tools: DesktopMcpToolSummary[];
	lastError?: string;
	updatedAt: string;
}

export interface DesktopResourceDiagnosticSummary {
	type: "error" | "warning" | "collision";
	message: string;
	path?: string;
}

export interface DesktopCapabilityCatalog {
	skills: DesktopSkillSummary[];
	prompts: DesktopPromptTemplateSummary[];
	slashCommands: DesktopSlashCommandSummary[];
	mcpServers: DesktopMcpServerSummary[];
	diagnostics: DesktopResourceDiagnosticSummary[];
}

export type DesktopCapabilityEvent =
	| { type: "catalog_changed"; catalog: DesktopCapabilityCatalog }
	| { type: "mcp_status_changed"; server: DesktopMcpServerSummary };

export interface DesktopCreateSkillRequest {
	name: string;
	description: string;
	content: string;
	scope?: DesktopCapabilityScope;
	overwrite?: boolean;
}

export interface DesktopPromptTemplateUpsertRequest {
	name: string;
	description: string;
	content: string;
	argumentHint?: string;
	scope?: DesktopCapabilityScope;
	overwrite?: boolean;
}

export interface DesktopPromptTemplateDeleteRequest {
	filePath: string;
}

export interface DesktopMcpServerUpsertRequest {
	id?: string;
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	enabled?: boolean;
	connectNow?: boolean;
}

export interface DesktopTerminalSize {
	cols: number;
	rows: number;
}

export type DesktopTerminalSource =
	| {
			type: "shell";
			cwd: string;
	  }
	| {
			type: "environment_resource";
			resourceId: string;
			readOnly: true;
	  };

export interface DesktopTerminalCreateRequest extends DesktopTerminalSize {
	terminalId: string;
	sessionId: string;
	source: DesktopTerminalSource;
}

export interface DesktopTerminalWriteRequest {
	terminalId: string;
	data: string;
}

export interface DesktopTerminalResizeRequest extends DesktopTerminalSize {
	terminalId: string;
}

export interface DesktopTerminalDisposeRequest {
	terminalId: string;
}
