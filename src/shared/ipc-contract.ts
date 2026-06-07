import type {
	DesktopAgentSnapshot,
	DesktopSessionMessagesRequest,
	DesktopSessionMessagesResult,
	SerializedAgentEvent,
} from "./serialized-agent-event.ts";
import type { SerializedTerminalEvent } from "./serialized-terminal-event.ts";
import type {
	DesktopApprovalDecision,
	DesktopApprovalEvent,
	DesktopCapabilityCatalog,
	DesktopCapabilityDetail,
	DesktopCapabilityDetailRequest,
	DesktopCapabilityEvent,
	DesktopCompactRequest,
	DesktopConsumeProposedPlanRequest,
	DesktopCreateSkillRequest,
	DesktopEnvironmentEvent,
	DesktopEnvironmentResource,
	DesktopEnvironmentResourceDetachRequest,
	DesktopEnvironmentResourceListRequest,
	DesktopEventCommentCreateRequest,
	DesktopEventCreateRequest,
	DesktopEventDeleteRequest,
	DesktopEventDetail,
	DesktopEventEvent,
	DesktopEventListRequest,
	DesktopEventManagementApplyRequest,
	DesktopEventManagementCriteria,
	DesktopEventManagementCriteriaUpdateRequest,
	DesktopEventManagementProposal,
	DesktopEventManagementProposalRequest,
	DesktopEventRunRequest,
	DesktopEventRunResult,
	DesktopEventStatusUpdateRequest,
	DesktopEventSummary,
	DesktopEventUpdateRequest,
	DesktopExecutePlanRequest,
	DesktopMcpServerSummary,
	DesktopMcpServerUpsertRequest,
	DesktopNativeAppearance,
	DesktopOAuthLoginEvent,
	DesktopOAuthProviderStatus,
	DesktopOpenEventAttachmentsRequest,
	DesktopOpenPromptAttachmentsRequest,
	DesktopPrepareEventAttachmentsRequest,
	DesktopPrepareEventAttachmentsResult,
	DesktopPreparePromptAttachmentsRequest,
	DesktopPreparePromptAttachmentsResult,
	DesktopPreviewFile,
	DesktopPreviewFileRequest,
	DesktopProjectSummary,
	DesktopPromptRequest,
	DesktopPromptTemplateDeleteRequest,
	DesktopPromptTemplateUpsertRequest,
	DesktopProviderKeyStatus,
	DesktopProviderKeyTestResult,
	DesktopReviewFile,
	DesktopReviewFilePatchRequest,
	DesktopReviewSnapshot,
	DesktopReviewSnapshotRequest,
	DesktopRuntimeCatalog,
	DesktopSessionModeUpdateRequest,
	DesktopSessionProfileUpdateRequest,
	DesktopSessionSummary,
	DesktopSettingKey,
	DesktopSettingsData,
	DesktopSettingsEvent,
	DesktopSettingsOpenRequest,
	DesktopStorageSecurityState,
	DesktopSubagentRuntimeEvent,
	DesktopSubagentSnapshot,
	DesktopSubagentSnapshotRequest,
	DesktopTerminalCreateRequest,
	DesktopTerminalDisposeRequest,
	DesktopTerminalResizeRequest,
	DesktopTerminalWriteRequest,
	DesktopWebPreviewBoundsRequest,
	DesktopWebPreviewCloseRequest,
	DesktopWebPreviewControlRequest,
	DesktopWebPreviewEvent,
	DesktopWebPreviewSelectionModeRequest,
	DesktopWebPreviewShowRequest,
	DesktopWebPreviewSnapshot,
	DesktopWebPreviewState,
	DesktopWebPreviewStorageRequest,
	DesktopWorkspaceFileListRequest,
	DesktopWorkspaceFileListResult,
	DesktopWorkspaceOverview,
	DesktopWorkspacePreviewFileRequest,
	DesktopWorkspaceRuntimeCaptureRequest,
	DesktopWorkspaceRuntimeCaptureResult,
	DesktopWorkspaceRuntimeCreateDebugRequest,
	DesktopWorkspaceRuntimeEvent,
	DesktopWorkspaceRuntimePaneControlRequest,
	DesktopWorkspaceRuntimePaneTextRequest,
	DesktopWorkspaceRuntimeSummary,
} from "./types.ts";

export const IPC_CHANNELS = {
	getWorkspaceOverview: "desktop-agent:get-workspace-overview",
	getSnapshot: "desktop-agent:get-snapshot",
	getSessionMessages: "desktop-agent:get-session-messages",
	getSubagentSnapshot: "desktop-agent:get-subagent-snapshot",
	getRuntimeCatalog: "desktop-agent:get-runtime-catalog",
	prompt: "desktop-agent:prompt",
	preparePromptAttachments: "desktop-agent:prepare-prompt-attachments",
	openPromptAttachments: "desktop-agent:open-prompt-attachments",
	listEvents: "desktop-agent:list-events",
	getEvent: "desktop-agent:get-event",
	createEvent: "desktop-agent:create-event",
	updateEvent: "desktop-agent:update-event",
	addEventComment: "desktop-agent:add-event-comment",
	getEventManagementCriteria: "desktop-agent:get-event-management-criteria",
	saveEventManagementCriteria: "desktop-agent:save-event-management-criteria",
	createEventManagementProposal: "desktop-agent:create-event-management-proposal",
	applyEventManagementProposal: "desktop-agent:apply-event-management-proposal",
	setEventStatus: "desktop-agent:set-event-status",
	deleteEvent: "desktop-agent:delete-event",
	prepareEventAttachments: "desktop-agent:prepare-event-attachments",
	openEventAttachments: "desktop-agent:open-event-attachments",
	runEvent: "desktop-agent:run-event",
	compact: "desktop-agent:compact",
	updateSessionProfile: "desktop-agent:update-session-profile",
	setSessionMode: "desktop-agent:set-session-mode",
	consumeProposedPlan: "desktop-agent:consume-proposed-plan",
	executePlan: "desktop-agent:execute-plan",
	abort: "desktop-agent:abort",
	getReviewSnapshot: "desktop-agent:get-review-snapshot",
	getReviewFilePatch: "desktop-agent:get-review-file-patch",
	openPreviewFiles: "desktop-agent:open-preview-files",
	openWorkspacePreviewFile: "desktop-agent:open-workspace-preview-file",
	listWorkspaceFiles: "desktop-agent:list-workspace-files",
	refreshPreviewFile: "desktop-agent:refresh-preview-file",
	openStream: "desktop-agent:open-stream",
	getSettings: "desktop-agent:get-settings",
	setSetting: "desktop-agent:set-setting",
	listProviderKeys: "desktop-agent:list-provider-keys",
	setProviderKey: "desktop-agent:set-provider-key",
	deleteProviderKey: "desktop-agent:delete-provider-key",
	testProviderKey: "desktop-agent:test-provider-key",
	listOAuthProviders: "desktop-agent:list-oauth-providers",
	startOAuthLogin: "desktop-agent:start-oauth-login",
	submitOAuthLoginCode: "desktop-agent:submit-oauth-login-code",
	cancelOAuthLogin: "desktop-agent:cancel-oauth-login",
	logoutOAuthProvider: "desktop-agent:logout-oauth-provider",
	getStorageSecurityState: "desktop-agent:get-storage-security-state",
	listCapabilities: "desktop-agent:list-capabilities",
	getCapabilityDetail: "desktop-agent:get-capability-detail",
	createSkill: "desktop-agent:create-skill",
	upsertPromptTemplate: "desktop-agent:upsert-prompt-template",
	deletePromptTemplate: "desktop-agent:delete-prompt-template",
	upsertMcpServer: "desktop-agent:upsert-mcp-server",
	setMcpServerEnabled: "desktop-agent:set-mcp-server-enabled",
	testMcpServer: "desktop-agent:test-mcp-server",
	restartMcpServer: "desktop-agent:restart-mcp-server",
	reloadCapabilities: "desktop-agent:reload-capabilities",
	listProjects: "desktop-agent:list-projects",
	createProjectFromFolder: "desktop-agent:create-project-from-folder",
	switchProject: "desktop-agent:switch-project",
	listSessions: "desktop-agent:list-sessions",
	newSession: "desktop-agent:new-session",
	switchSession: "desktop-agent:switch-session",
	deleteSession: "desktop-agent:delete-session",
	listEnvironmentResources: "desktop-agent:list-environment-resources",
	detachEnvironmentResource: "desktop-agent:detach-environment-resource",
	listWorkspaceRuntimes: "desktop-agent:list-workspace-runtimes",
	createDebugWorkspaceRuntime: "desktop-agent:create-debug-workspace-runtime",
	openWorkspaceRuntime: "desktop-agent:open-workspace-runtime",
	pauseWorkspaceRuntime: "desktop-agent:pause-workspace-runtime",
	resumeWorkspaceRuntime: "desktop-agent:resume-workspace-runtime",
	archiveWorkspaceRuntime: "desktop-agent:archive-workspace-runtime",
	captureWorkspaceRuntimeContext: "desktop-agent:capture-workspace-runtime-context",
	takeOverWorkspaceRuntimePane: "desktop-agent:take-over-workspace-runtime-pane",
	sendWorkspaceRuntimePaneText: "desktop-agent:send-workspace-runtime-pane-text",
	returnWorkspaceRuntimePaneControl: "desktop-agent:return-workspace-runtime-pane-control",
	createTerminal: "desktop-agent:create-terminal",
	writeTerminal: "desktop-agent:write-terminal",
	resizeTerminal: "desktop-agent:resize-terminal",
	disposeTerminal: "desktop-agent:dispose-terminal",
	openTerminalStream: "desktop-agent:open-terminal-stream",
	openAuthStream: "desktop-agent:open-auth-stream",
	openCapabilityStream: "desktop-agent:open-capability-stream",
	openApprovalStream: "desktop-agent:open-approval-stream",
	openEventStream: "desktop-agent:open-event-stream",
	openSettingsStream: "desktop-agent:open-settings-stream",
	settingsNavigationRequest: "desktop-agent:settings-navigation-request",
	openEnvironmentStream: "desktop-agent:open-environment-stream",
	openSubagentStream: "desktop-agent:open-subagent-stream",
	openWorkspaceRuntimeStream: "desktop-agent:open-workspace-runtime-stream",
	resolveApproval: "desktop-agent:resolve-approval",
	getNativeAppearance: "desktop-agent:get-native-appearance",
	openSettingsWindow: "desktop-agent:open-settings-window",
	notifyFirstInteractive: "desktop-agent:notify-first-interactive",
	openExternalUrl: "desktop-agent:open-external-url",
	showWebPreview: "desktop-agent:show-web-preview",
	updateWebPreviewBounds: "desktop-agent:update-web-preview-bounds",
	controlWebPreview: "desktop-agent:control-web-preview",
	clearWebPreviewStorage: "desktop-agent:clear-web-preview-storage",
	setWebPreviewElementSelectionMode: "desktop-agent:set-web-preview-element-selection-mode",
	closeWebPreview: "desktop-agent:close-web-preview",
	openWebPreviewStream: "desktop-agent:open-web-preview-stream",
} as const;

export interface DesktopAgentBridge {
	getWorkspaceOverview(): Promise<DesktopWorkspaceOverview>;
	getSnapshot(sessionId: string): Promise<DesktopAgentSnapshot>;
	getSessionMessages(request: DesktopSessionMessagesRequest): Promise<DesktopSessionMessagesResult>;
	getSubagentSnapshot(request: DesktopSubagentSnapshotRequest): Promise<DesktopSubagentSnapshot>;
	getRuntimeCatalog(): Promise<DesktopRuntimeCatalog>;
	getSettings(): Promise<DesktopSettingsData>;
	setSetting<TKey extends DesktopSettingKey>(key: TKey, value: DesktopSettingsData[TKey]): Promise<void>;
	listProviderKeys(): Promise<DesktopProviderKeyStatus[]>;
	setProviderKey(provider: string, key: string): Promise<void>;
	deleteProviderKey(provider: string): Promise<void>;
	testProviderKey(provider: string): Promise<DesktopProviderKeyTestResult>;
	listOAuthProviders(): Promise<DesktopOAuthProviderStatus[]>;
	startOAuthLogin(provider: string): Promise<void>;
	submitOAuthLoginCode(provider: string, code: string): Promise<void>;
	cancelOAuthLogin(provider: string): Promise<void>;
	logoutOAuthProvider(provider: string): Promise<void>;
	getStorageSecurityState(): Promise<DesktopStorageSecurityState>;
	listCapabilities(): Promise<DesktopCapabilityCatalog>;
	getCapabilityDetail(request: DesktopCapabilityDetailRequest): Promise<DesktopCapabilityDetail>;
	createSkill(request: DesktopCreateSkillRequest): Promise<DesktopCapabilityCatalog>;
	upsertPromptTemplate(request: DesktopPromptTemplateUpsertRequest): Promise<DesktopCapabilityCatalog>;
	deletePromptTemplate(request: DesktopPromptTemplateDeleteRequest): Promise<DesktopCapabilityCatalog>;
	upsertMcpServer(request: DesktopMcpServerUpsertRequest): Promise<DesktopCapabilityCatalog>;
	setMcpServerEnabled(serverId: string, enabled: boolean): Promise<DesktopCapabilityCatalog>;
	testMcpServer(serverId: string): Promise<DesktopMcpServerSummary>;
	restartMcpServer(serverId: string): Promise<DesktopCapabilityCatalog>;
	reloadCapabilities(): Promise<DesktopCapabilityCatalog>;
	listProjects(): Promise<DesktopProjectSummary[]>;
	createProjectFromFolder(): Promise<DesktopProjectSummary | undefined>;
	switchProject(projectId: string): Promise<DesktopProjectSummary | undefined>;
	listSessions(projectId?: string): Promise<DesktopSessionSummary[]>;
	newSession(projectId?: string): Promise<DesktopSessionSummary | undefined>;
	switchSession(sessionId: string): Promise<DesktopSessionSummary | undefined>;
	deleteSession(sessionId: string): Promise<DesktopSessionSummary | undefined>;
	listEnvironmentResources(request?: DesktopEnvironmentResourceListRequest): Promise<DesktopEnvironmentResource[]>;
	detachEnvironmentResource(request: DesktopEnvironmentResourceDetachRequest): Promise<DesktopEnvironmentResource>;
	listWorkspaceRuntimes(): Promise<DesktopWorkspaceRuntimeSummary[]>;
	createDebugWorkspaceRuntime(
		request: DesktopWorkspaceRuntimeCreateDebugRequest,
	): Promise<DesktopWorkspaceRuntimeSummary>;
	openWorkspaceRuntime(workspaceId: string): Promise<DesktopWorkspaceRuntimeSummary>;
	pauseWorkspaceRuntime(workspaceId: string): Promise<DesktopWorkspaceRuntimeSummary>;
	resumeWorkspaceRuntime(workspaceId: string): Promise<DesktopWorkspaceRuntimeSummary>;
	archiveWorkspaceRuntime(workspaceId: string): Promise<DesktopWorkspaceRuntimeSummary>;
	captureWorkspaceRuntimeContext(
		request: DesktopWorkspaceRuntimeCaptureRequest,
	): Promise<DesktopWorkspaceRuntimeCaptureResult>;
	takeOverWorkspaceRuntimePane(
		request: DesktopWorkspaceRuntimePaneControlRequest,
	): Promise<DesktopWorkspaceRuntimeSummary>;
	sendWorkspaceRuntimePaneText(
		request: DesktopWorkspaceRuntimePaneTextRequest,
	): Promise<DesktopWorkspaceRuntimeSummary>;
	returnWorkspaceRuntimePaneControl(
		request: DesktopWorkspaceRuntimePaneControlRequest,
	): Promise<DesktopWorkspaceRuntimeCaptureResult>;
	createTerminal(request: DesktopTerminalCreateRequest): Promise<void>;
	writeTerminal(request: DesktopTerminalWriteRequest): Promise<void>;
	resizeTerminal(request: DesktopTerminalResizeRequest): Promise<void>;
	disposeTerminal(request: DesktopTerminalDisposeRequest): Promise<void>;
	resolveApproval(decision: DesktopApprovalDecision): Promise<void>;
	getNativeAppearance(): Promise<DesktopNativeAppearance>;
	openSettingsWindow(request?: DesktopSettingsOpenRequest): Promise<void>;
	subscribeToSettingsOpenRequests(listener: (request: DesktopSettingsOpenRequest) => void): () => void;
	notifyFirstInteractive(): Promise<void>;
	openExternalUrl(url: string): Promise<void>;
	showWebPreview(request: DesktopWebPreviewShowRequest): Promise<DesktopWebPreviewState>;
	updateWebPreviewBounds(request: DesktopWebPreviewBoundsRequest): Promise<DesktopWebPreviewSnapshot | undefined>;
	controlWebPreview(request: DesktopWebPreviewControlRequest): Promise<DesktopWebPreviewState>;
	clearWebPreviewStorage(request: DesktopWebPreviewStorageRequest): Promise<DesktopWebPreviewState>;
	setWebPreviewElementSelectionMode(request: DesktopWebPreviewSelectionModeRequest): Promise<DesktopWebPreviewState>;
	closeWebPreview(request: DesktopWebPreviewCloseRequest): Promise<void>;
	subscribeToWebPreviewEvents(listener: (event: DesktopWebPreviewEvent) => void): () => void;
	prompt(request: DesktopPromptRequest): Promise<void>;
	preparePromptAttachments(
		request: DesktopPreparePromptAttachmentsRequest,
	): Promise<DesktopPreparePromptAttachmentsResult>;
	openPromptAttachments(request: DesktopOpenPromptAttachmentsRequest): Promise<DesktopPreparePromptAttachmentsResult>;
	listEvents(request?: DesktopEventListRequest): Promise<DesktopEventSummary[]>;
	getEvent(eventId: string): Promise<DesktopEventDetail | undefined>;
	createEvent(request: DesktopEventCreateRequest): Promise<DesktopEventDetail>;
	updateEvent(request: DesktopEventUpdateRequest): Promise<DesktopEventDetail>;
	addEventComment(request: DesktopEventCommentCreateRequest): Promise<DesktopEventDetail>;
	getEventManagementCriteria(): Promise<DesktopEventManagementCriteria>;
	saveEventManagementCriteria(
		request: DesktopEventManagementCriteriaUpdateRequest,
	): Promise<DesktopEventManagementCriteria>;
	createEventManagementProposal(
		request?: DesktopEventManagementProposalRequest,
	): Promise<DesktopEventManagementProposal>;
	applyEventManagementProposal(request: DesktopEventManagementApplyRequest): Promise<DesktopEventDetail[]>;
	setEventStatus(request: DesktopEventStatusUpdateRequest): Promise<DesktopEventDetail>;
	deleteEvent(request: DesktopEventDeleteRequest): Promise<void>;
	prepareEventAttachments(
		request: DesktopPrepareEventAttachmentsRequest,
	): Promise<DesktopPrepareEventAttachmentsResult>;
	openEventAttachments(request?: DesktopOpenEventAttachmentsRequest): Promise<DesktopPrepareEventAttachmentsResult>;
	runEvent(request: DesktopEventRunRequest): Promise<DesktopEventRunResult>;
	compact(request: DesktopCompactRequest): Promise<DesktopAgentSnapshot>;
	updateSessionProfile(request: DesktopSessionProfileUpdateRequest): Promise<DesktopAgentSnapshot>;
	setSessionMode(request: DesktopSessionModeUpdateRequest): Promise<DesktopAgentSnapshot>;
	consumeProposedPlan(request: DesktopConsumeProposedPlanRequest): Promise<DesktopAgentSnapshot>;
	executePlan(request: DesktopExecutePlanRequest): Promise<DesktopAgentSnapshot>;
	abort(sessionId: string): Promise<void>;
	getReviewSnapshot(request: DesktopReviewSnapshotRequest): Promise<DesktopReviewSnapshot>;
	getReviewFilePatch(request: DesktopReviewFilePatchRequest): Promise<DesktopReviewFile>;
	openPreviewFiles(request: DesktopReviewSnapshotRequest): Promise<DesktopPreviewFile[]>;
	openWorkspacePreviewFile(request: DesktopWorkspacePreviewFileRequest): Promise<DesktopPreviewFile>;
	listWorkspaceFiles(request: DesktopWorkspaceFileListRequest): Promise<DesktopWorkspaceFileListResult>;
	refreshPreviewFile(request: DesktopPreviewFileRequest): Promise<DesktopPreviewFile>;
	subscribeToAgentEvents(listener: (event: SerializedAgentEvent) => void): () => void;
	subscribeToTerminalEvents(listener: (event: SerializedTerminalEvent) => void): () => void;
	subscribeToAuthEvents(listener: (event: DesktopOAuthLoginEvent) => void): () => void;
	subscribeToCapabilityEvents(listener: (event: DesktopCapabilityEvent) => void): () => void;
	subscribeToApprovalEvents(listener: (event: DesktopApprovalEvent) => void): () => void;
	subscribeToEventEvents(listener: (event: DesktopEventEvent) => void): () => void;
	subscribeToSettingsEvents(listener: (event: DesktopSettingsEvent) => void): () => void;
	subscribeToEnvironmentEvents(listener: (event: DesktopEnvironmentEvent) => void): () => void;
	subscribeToSubagentEvents(listener: (event: DesktopSubagentRuntimeEvent) => void): () => void;
	subscribeToWorkspaceRuntimeEvents(listener: (event: DesktopWorkspaceRuntimeEvent) => void): () => void;
}

declare global {
	interface Window {
		desktopAgent: DesktopAgentBridge;
	}
}
