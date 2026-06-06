import { type DesktopAgentBridge, IPC_CHANNELS } from "../shared/ipc-contract.ts";
import type { DesktopAgentSnapshot, SerializedAgentEvent } from "../shared/serialized-agent-event.ts";
import type { SerializedTerminalEvent } from "../shared/serialized-terminal-event.ts";
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
} from "../shared/types.ts";

export interface BridgeMessageEvent<TData = unknown> {
	data: TData;
}

export interface BridgeMessagePort<TData = unknown> {
	start(): void;
	addEventListener(type: "message", listener: (event: BridgeMessageEvent<TData>) => void): void;
	removeEventListener(type: "message", listener: (event: BridgeMessageEvent<TData>) => void): void;
}

export interface BridgeMessageChannel<TData = unknown> {
	port1: BridgeMessagePort<TData>;
	port2: object;
}

export interface BridgeIpcRenderer {
	invoke(channel: string, ...args: unknown[]): Promise<unknown>;
	off?(channel: string, listener: (event: unknown, request: unknown) => void): void;
	on?(channel: string, listener: (event: unknown, request: unknown) => void): void;
	postMessage(channel: string, message: unknown, transfer: object[]): void;
}

function createDefaultMessageChannel(): BridgeMessageChannel {
	return new MessageChannel() as unknown as BridgeMessageChannel;
}

export function createDesktopAgentBridge(
	ipcRenderer: BridgeIpcRenderer,
	createMessageChannel: () => BridgeMessageChannel = createDefaultMessageChannel,
): DesktopAgentBridge {
	let agentStreamPort: BridgeMessagePort<SerializedAgentEvent> | undefined;
	let terminalStreamPort: BridgeMessagePort<SerializedTerminalEvent> | undefined;
	let authStreamPort: BridgeMessagePort<DesktopOAuthLoginEvent> | undefined;
	let capabilityStreamPort: BridgeMessagePort<DesktopCapabilityEvent> | undefined;
	let approvalStreamPort: BridgeMessagePort<DesktopApprovalEvent> | undefined;
	let eventStreamPort: BridgeMessagePort<DesktopEventEvent> | undefined;
	let settingsStreamPort: BridgeMessagePort<DesktopSettingsEvent> | undefined;
	let environmentStreamPort: BridgeMessagePort<DesktopEnvironmentEvent> | undefined;
	let subagentStreamPort: BridgeMessagePort<DesktopSubagentRuntimeEvent> | undefined;
	let workspaceRuntimeStreamPort: BridgeMessagePort<DesktopWorkspaceRuntimeEvent> | undefined;

	const ensureAgentStreamPort = (): BridgeMessagePort<SerializedAgentEvent> => {
		if (agentStreamPort) {
			return agentStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<SerializedAgentEvent>;
		agentStreamPort = channel.port1;
		agentStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openStream, null, [channel.port2]);
		return agentStreamPort;
	};

	const ensureTerminalStreamPort = (): BridgeMessagePort<SerializedTerminalEvent> => {
		if (terminalStreamPort) {
			return terminalStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<SerializedTerminalEvent>;
		terminalStreamPort = channel.port1;
		terminalStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openTerminalStream, null, [channel.port2]);
		return terminalStreamPort;
	};

	const ensureAuthStreamPort = (): BridgeMessagePort<DesktopOAuthLoginEvent> => {
		if (authStreamPort) {
			return authStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopOAuthLoginEvent>;
		authStreamPort = channel.port1;
		authStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openAuthStream, null, [channel.port2]);
		return authStreamPort;
	};

	const ensureCapabilityStreamPort = (): BridgeMessagePort<DesktopCapabilityEvent> => {
		if (capabilityStreamPort) {
			return capabilityStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopCapabilityEvent>;
		capabilityStreamPort = channel.port1;
		capabilityStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openCapabilityStream, null, [channel.port2]);
		return capabilityStreamPort;
	};

	const ensureApprovalStreamPort = (): BridgeMessagePort<DesktopApprovalEvent> => {
		if (approvalStreamPort) {
			return approvalStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopApprovalEvent>;
		approvalStreamPort = channel.port1;
		approvalStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openApprovalStream, null, [channel.port2]);
		return approvalStreamPort;
	};

	const ensureEventStreamPort = (): BridgeMessagePort<DesktopEventEvent> => {
		if (eventStreamPort) {
			return eventStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopEventEvent>;
		eventStreamPort = channel.port1;
		eventStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openEventStream, null, [channel.port2]);
		return eventStreamPort;
	};

	const ensureSettingsStreamPort = (): BridgeMessagePort<DesktopSettingsEvent> => {
		if (settingsStreamPort) {
			return settingsStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopSettingsEvent>;
		settingsStreamPort = channel.port1;
		settingsStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openSettingsStream, null, [channel.port2]);
		return settingsStreamPort;
	};

	const ensureEnvironmentStreamPort = (): BridgeMessagePort<DesktopEnvironmentEvent> => {
		if (environmentStreamPort) {
			return environmentStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopEnvironmentEvent>;
		environmentStreamPort = channel.port1;
		environmentStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openEnvironmentStream, null, [channel.port2]);
		return environmentStreamPort;
	};

	const ensureSubagentStreamPort = (): BridgeMessagePort<DesktopSubagentRuntimeEvent> => {
		if (subagentStreamPort) {
			return subagentStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopSubagentRuntimeEvent>;
		subagentStreamPort = channel.port1;
		subagentStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openSubagentStream, null, [channel.port2]);
		return subagentStreamPort;
	};

	const ensureWorkspaceRuntimeStreamPort = (): BridgeMessagePort<DesktopWorkspaceRuntimeEvent> => {
		if (workspaceRuntimeStreamPort) {
			return workspaceRuntimeStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopWorkspaceRuntimeEvent>;
		workspaceRuntimeStreamPort = channel.port1;
		workspaceRuntimeStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openWorkspaceRuntimeStream, null, [channel.port2]);
		return workspaceRuntimeStreamPort;
	};

	return {
		async getWorkspaceOverview(): Promise<DesktopWorkspaceOverview> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.getWorkspaceOverview)) as DesktopWorkspaceOverview;
		},
		async getSnapshot(sessionId: string): Promise<DesktopAgentSnapshot> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.getSnapshot, sessionId)) as DesktopAgentSnapshot;
		},
		async getSubagentSnapshot(request: DesktopSubagentSnapshotRequest): Promise<DesktopSubagentSnapshot> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.getSubagentSnapshot, request)) as DesktopSubagentSnapshot;
		},
		async getRuntimeCatalog(): Promise<DesktopRuntimeCatalog> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.getRuntimeCatalog)) as DesktopRuntimeCatalog;
		},
		async getSettings(): Promise<DesktopSettingsData> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.getSettings)) as DesktopSettingsData;
		},
		async setSetting<TKey extends DesktopSettingKey>(key: TKey, value: DesktopSettingsData[TKey]): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.setSetting, key, value);
		},
		async listProviderKeys(): Promise<DesktopProviderKeyStatus[]> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.listProviderKeys)) as DesktopProviderKeyStatus[];
		},
		async setProviderKey(provider: string, key: string): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.setProviderKey, provider, key);
		},
		async deleteProviderKey(provider: string): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.deleteProviderKey, provider);
		},
		async testProviderKey(provider: string): Promise<DesktopProviderKeyTestResult> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.testProviderKey, provider)) as DesktopProviderKeyTestResult;
		},
		async listOAuthProviders(): Promise<DesktopOAuthProviderStatus[]> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.listOAuthProviders)) as DesktopOAuthProviderStatus[];
		},
		async startOAuthLogin(provider: string): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.startOAuthLogin, provider);
		},
		async submitOAuthLoginCode(provider: string, code: string): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.submitOAuthLoginCode, provider, code);
		},
		async cancelOAuthLogin(provider: string): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.cancelOAuthLogin, provider);
		},
		async logoutOAuthProvider(provider: string): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.logoutOAuthProvider, provider);
		},
		async getStorageSecurityState(): Promise<DesktopStorageSecurityState> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.getStorageSecurityState)) as DesktopStorageSecurityState;
		},
		async listCapabilities(): Promise<DesktopCapabilityCatalog> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.listCapabilities)) as DesktopCapabilityCatalog;
		},
		async getCapabilityDetail(request: DesktopCapabilityDetailRequest): Promise<DesktopCapabilityDetail> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.getCapabilityDetail, request)) as DesktopCapabilityDetail;
		},
		async createSkill(request: DesktopCreateSkillRequest): Promise<DesktopCapabilityCatalog> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.createSkill, request)) as DesktopCapabilityCatalog;
		},
		async upsertPromptTemplate(request: DesktopPromptTemplateUpsertRequest): Promise<DesktopCapabilityCatalog> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.upsertPromptTemplate, request)) as DesktopCapabilityCatalog;
		},
		async deletePromptTemplate(request: DesktopPromptTemplateDeleteRequest): Promise<DesktopCapabilityCatalog> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.deletePromptTemplate, request)) as DesktopCapabilityCatalog;
		},
		async upsertMcpServer(request: DesktopMcpServerUpsertRequest): Promise<DesktopCapabilityCatalog> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.upsertMcpServer, request)) as DesktopCapabilityCatalog;
		},
		async setMcpServerEnabled(serverId: string, enabled: boolean): Promise<DesktopCapabilityCatalog> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.setMcpServerEnabled,
				serverId,
				enabled,
			)) as DesktopCapabilityCatalog;
		},
		async testMcpServer(serverId: string): Promise<DesktopMcpServerSummary> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.testMcpServer, serverId)) as DesktopMcpServerSummary;
		},
		async restartMcpServer(serverId: string): Promise<DesktopCapabilityCatalog> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.restartMcpServer, serverId)) as DesktopCapabilityCatalog;
		},
		async reloadCapabilities(): Promise<DesktopCapabilityCatalog> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.reloadCapabilities)) as DesktopCapabilityCatalog;
		},
		async listProjects(): Promise<DesktopProjectSummary[]> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.listProjects)) as DesktopProjectSummary[];
		},
		async createProjectFromFolder(): Promise<DesktopProjectSummary | undefined> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.createProjectFromFolder)) as DesktopProjectSummary | undefined;
		},
		async switchProject(projectId: string): Promise<DesktopProjectSummary | undefined> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.switchProject, projectId)) as DesktopProjectSummary | undefined;
		},
		async listSessions(projectId?: string): Promise<DesktopSessionSummary[]> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.listSessions,
				...(projectId === undefined ? [] : [projectId]),
			)) as DesktopSessionSummary[];
		},
		async newSession(projectId?: string): Promise<DesktopSessionSummary | undefined> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.newSession, ...(projectId === undefined ? [] : [projectId]))) as
				| DesktopSessionSummary
				| undefined;
		},
		async switchSession(sessionId: string): Promise<DesktopSessionSummary | undefined> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.switchSession, sessionId)) as DesktopSessionSummary | undefined;
		},
		async deleteSession(sessionId: string): Promise<DesktopSessionSummary | undefined> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.deleteSession, sessionId)) as DesktopSessionSummary | undefined;
		},
		async listEnvironmentResources(
			request?: DesktopEnvironmentResourceListRequest,
		): Promise<DesktopEnvironmentResource[]> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.listEnvironmentResources,
				...(request === undefined ? [] : [request]),
			)) as DesktopEnvironmentResource[];
		},
		async detachEnvironmentResource(
			request: DesktopEnvironmentResourceDetachRequest,
		): Promise<DesktopEnvironmentResource> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.detachEnvironmentResource,
				request,
			)) as DesktopEnvironmentResource;
		},
		async listWorkspaceRuntimes(): Promise<DesktopWorkspaceRuntimeSummary[]> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.listWorkspaceRuntimes)) as DesktopWorkspaceRuntimeSummary[];
		},
		async createDebugWorkspaceRuntime(
			request: DesktopWorkspaceRuntimeCreateDebugRequest,
		): Promise<DesktopWorkspaceRuntimeSummary> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.createDebugWorkspaceRuntime,
				request,
			)) as DesktopWorkspaceRuntimeSummary;
		},
		async openWorkspaceRuntime(workspaceId: string): Promise<DesktopWorkspaceRuntimeSummary> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.openWorkspaceRuntime,
				workspaceId,
			)) as DesktopWorkspaceRuntimeSummary;
		},
		async pauseWorkspaceRuntime(workspaceId: string): Promise<DesktopWorkspaceRuntimeSummary> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.pauseWorkspaceRuntime,
				workspaceId,
			)) as DesktopWorkspaceRuntimeSummary;
		},
		async resumeWorkspaceRuntime(workspaceId: string): Promise<DesktopWorkspaceRuntimeSummary> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.resumeWorkspaceRuntime,
				workspaceId,
			)) as DesktopWorkspaceRuntimeSummary;
		},
		async archiveWorkspaceRuntime(workspaceId: string): Promise<DesktopWorkspaceRuntimeSummary> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.archiveWorkspaceRuntime,
				workspaceId,
			)) as DesktopWorkspaceRuntimeSummary;
		},
		async captureWorkspaceRuntimeContext(
			request: DesktopWorkspaceRuntimeCaptureRequest,
		): Promise<DesktopWorkspaceRuntimeCaptureResult> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.captureWorkspaceRuntimeContext,
				request,
			)) as DesktopWorkspaceRuntimeCaptureResult;
		},
		async takeOverWorkspaceRuntimePane(
			request: DesktopWorkspaceRuntimePaneControlRequest,
		): Promise<DesktopWorkspaceRuntimeSummary> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.takeOverWorkspaceRuntimePane,
				request,
			)) as DesktopWorkspaceRuntimeSummary;
		},
		async sendWorkspaceRuntimePaneText(
			request: DesktopWorkspaceRuntimePaneTextRequest,
		): Promise<DesktopWorkspaceRuntimeSummary> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.sendWorkspaceRuntimePaneText,
				request,
			)) as DesktopWorkspaceRuntimeSummary;
		},
		async returnWorkspaceRuntimePaneControl(
			request: DesktopWorkspaceRuntimePaneControlRequest,
		): Promise<DesktopWorkspaceRuntimeCaptureResult> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.returnWorkspaceRuntimePaneControl,
				request,
			)) as DesktopWorkspaceRuntimeCaptureResult;
		},
		async createTerminal(request: DesktopTerminalCreateRequest): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.createTerminal, request);
		},
		async writeTerminal(request: DesktopTerminalWriteRequest): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.writeTerminal, request);
		},
		async resizeTerminal(request: DesktopTerminalResizeRequest): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.resizeTerminal, request);
		},
		async disposeTerminal(request: DesktopTerminalDisposeRequest): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.disposeTerminal, request);
		},
		async resolveApproval(decision: DesktopApprovalDecision): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.resolveApproval, decision);
		},
		async getNativeAppearance(): Promise<DesktopNativeAppearance> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.getNativeAppearance)) as DesktopNativeAppearance;
		},
		async openSettingsWindow(request?: DesktopSettingsOpenRequest): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.openSettingsWindow, ...(request === undefined ? [] : [request]));
		},
		subscribeToSettingsOpenRequests(listener: (request: DesktopSettingsOpenRequest) => void): () => void {
			if (!ipcRenderer.on) {
				return () => undefined;
			}
			const handler = (_event: unknown, request: unknown): void => {
				listener((request ?? {}) as DesktopSettingsOpenRequest);
			};
			ipcRenderer.on(IPC_CHANNELS.settingsNavigationRequest, handler);
			return () => ipcRenderer.off?.(IPC_CHANNELS.settingsNavigationRequest, handler);
		},
		async notifyFirstInteractive(): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.notifyFirstInteractive);
		},
		async openExternalUrl(url: string): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.openExternalUrl, url);
		},
		async prompt(request: DesktopPromptRequest): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.prompt, request);
		},
		async preparePromptAttachments(
			request: DesktopPreparePromptAttachmentsRequest,
		): Promise<DesktopPreparePromptAttachmentsResult> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.preparePromptAttachments,
				request,
			)) as DesktopPreparePromptAttachmentsResult;
		},
		async openPromptAttachments(
			request: DesktopOpenPromptAttachmentsRequest,
		): Promise<DesktopPreparePromptAttachmentsResult> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.openPromptAttachments,
				request,
			)) as DesktopPreparePromptAttachmentsResult;
		},
		async listEvents(request?: DesktopEventListRequest): Promise<DesktopEventSummary[]> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.listEvents,
				...(request === undefined ? [] : [request]),
			)) as DesktopEventSummary[];
		},
		async getEvent(eventId: string): Promise<DesktopEventDetail | undefined> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.getEvent, eventId)) as DesktopEventDetail | undefined;
		},
		async createEvent(request: DesktopEventCreateRequest): Promise<DesktopEventDetail> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.createEvent, request)) as DesktopEventDetail;
		},
		async updateEvent(request: DesktopEventUpdateRequest): Promise<DesktopEventDetail> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.updateEvent, request)) as DesktopEventDetail;
		},
		async addEventComment(request: DesktopEventCommentCreateRequest): Promise<DesktopEventDetail> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.addEventComment, request)) as DesktopEventDetail;
		},
		async getEventManagementCriteria(): Promise<DesktopEventManagementCriteria> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.getEventManagementCriteria)) as DesktopEventManagementCriteria;
		},
		async saveEventManagementCriteria(
			request: DesktopEventManagementCriteriaUpdateRequest,
		): Promise<DesktopEventManagementCriteria> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.saveEventManagementCriteria,
				request,
			)) as DesktopEventManagementCriteria;
		},
		async createEventManagementProposal(
			request?: DesktopEventManagementProposalRequest,
		): Promise<DesktopEventManagementProposal> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.createEventManagementProposal,
				...(request === undefined ? [] : [request]),
			)) as DesktopEventManagementProposal;
		},
		async applyEventManagementProposal(request: DesktopEventManagementApplyRequest): Promise<DesktopEventDetail[]> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.applyEventManagementProposal, request)) as DesktopEventDetail[];
		},
		async setEventStatus(request: DesktopEventStatusUpdateRequest): Promise<DesktopEventDetail> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.setEventStatus, request)) as DesktopEventDetail;
		},
		async deleteEvent(request: DesktopEventDeleteRequest): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.deleteEvent, request);
		},
		async prepareEventAttachments(
			request: DesktopPrepareEventAttachmentsRequest,
		): Promise<DesktopPrepareEventAttachmentsResult> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.prepareEventAttachments,
				request,
			)) as DesktopPrepareEventAttachmentsResult;
		},
		async openEventAttachments(
			request?: DesktopOpenEventAttachmentsRequest,
		): Promise<DesktopPrepareEventAttachmentsResult> {
			return (await ipcRenderer.invoke(
				IPC_CHANNELS.openEventAttachments,
				...(request === undefined ? [] : [request]),
			)) as DesktopPrepareEventAttachmentsResult;
		},
		async runEvent(request: DesktopEventRunRequest): Promise<DesktopEventRunResult> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.runEvent, request)) as DesktopEventRunResult;
		},
		async compact(request: DesktopCompactRequest): Promise<DesktopAgentSnapshot> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.compact, request)) as DesktopAgentSnapshot;
		},
		async updateSessionProfile(request: DesktopSessionProfileUpdateRequest): Promise<DesktopAgentSnapshot> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.updateSessionProfile, request)) as DesktopAgentSnapshot;
		},
		async setSessionMode(request: DesktopSessionModeUpdateRequest): Promise<DesktopAgentSnapshot> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.setSessionMode, request)) as DesktopAgentSnapshot;
		},
		async consumeProposedPlan(request: DesktopConsumeProposedPlanRequest): Promise<DesktopAgentSnapshot> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.consumeProposedPlan, request)) as DesktopAgentSnapshot;
		},
		async executePlan(request: DesktopExecutePlanRequest): Promise<DesktopAgentSnapshot> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.executePlan, request)) as DesktopAgentSnapshot;
		},
		async abort(sessionId: string): Promise<void> {
			await ipcRenderer.invoke(IPC_CHANNELS.abort, sessionId);
		},
		async getReviewSnapshot(request: DesktopReviewSnapshotRequest): Promise<DesktopReviewSnapshot> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.getReviewSnapshot, request)) as DesktopReviewSnapshot;
		},
		async openPreviewFiles(request: DesktopReviewSnapshotRequest): Promise<DesktopPreviewFile[]> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.openPreviewFiles, request)) as DesktopPreviewFile[];
		},
		async openWorkspacePreviewFile(request: DesktopWorkspacePreviewFileRequest): Promise<DesktopPreviewFile> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.openWorkspacePreviewFile, request)) as DesktopPreviewFile;
		},
		async listWorkspaceFiles(request: DesktopWorkspaceFileListRequest): Promise<DesktopWorkspaceFileListResult> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.listWorkspaceFiles, request)) as DesktopWorkspaceFileListResult;
		},
		async refreshPreviewFile(request: DesktopPreviewFileRequest): Promise<DesktopPreviewFile> {
			return (await ipcRenderer.invoke(IPC_CHANNELS.refreshPreviewFile, request)) as DesktopPreviewFile;
		},
		subscribeToAgentEvents(listener: (event: SerializedAgentEvent) => void): () => void {
			const port = ensureAgentStreamPort();
			const handleMessage = (event: BridgeMessageEvent<SerializedAgentEvent>) => {
				listener(event.data);
			};

			port.addEventListener("message", handleMessage);

			return () => {
				port.removeEventListener("message", handleMessage);
			};
		},
		subscribeToTerminalEvents(listener: (event: SerializedTerminalEvent) => void): () => void {
			const port = ensureTerminalStreamPort();
			const handleMessage = (event: BridgeMessageEvent<SerializedTerminalEvent>) => {
				listener(event.data);
			};

			port.addEventListener("message", handleMessage);

			return () => {
				port.removeEventListener("message", handleMessage);
			};
		},
		subscribeToAuthEvents(listener: (event: DesktopOAuthLoginEvent) => void): () => void {
			const port = ensureAuthStreamPort();
			const handleMessage = (event: BridgeMessageEvent<DesktopOAuthLoginEvent>) => {
				listener(event.data);
			};

			port.addEventListener("message", handleMessage);

			return () => {
				port.removeEventListener("message", handleMessage);
			};
		},
		subscribeToCapabilityEvents(listener: (event: DesktopCapabilityEvent) => void): () => void {
			const port = ensureCapabilityStreamPort();
			const handleMessage = (event: BridgeMessageEvent<DesktopCapabilityEvent>) => {
				listener(event.data);
			};

			port.addEventListener("message", handleMessage);

			return () => {
				port.removeEventListener("message", handleMessage);
			};
		},
		subscribeToApprovalEvents(listener: (event: DesktopApprovalEvent) => void): () => void {
			const port = ensureApprovalStreamPort();
			const handleMessage = (event: BridgeMessageEvent<DesktopApprovalEvent>) => {
				listener(event.data);
			};

			port.addEventListener("message", handleMessage);

			return () => {
				port.removeEventListener("message", handleMessage);
			};
		},
		subscribeToEventEvents(listener: (event: DesktopEventEvent) => void): () => void {
			const port = ensureEventStreamPort();
			const handleMessage = (event: BridgeMessageEvent<DesktopEventEvent>) => {
				listener(event.data);
			};

			port.addEventListener("message", handleMessage);

			return () => {
				port.removeEventListener("message", handleMessage);
			};
		},
		subscribeToSettingsEvents(listener: (event: DesktopSettingsEvent) => void): () => void {
			const port = ensureSettingsStreamPort();
			const handleMessage = (event: BridgeMessageEvent<DesktopSettingsEvent>) => {
				listener(event.data);
			};

			port.addEventListener("message", handleMessage);

			return () => {
				port.removeEventListener("message", handleMessage);
			};
		},
		subscribeToEnvironmentEvents(listener: (event: DesktopEnvironmentEvent) => void): () => void {
			const port = ensureEnvironmentStreamPort();
			const handleMessage = (event: BridgeMessageEvent<DesktopEnvironmentEvent>) => {
				listener(event.data);
			};

			port.addEventListener("message", handleMessage);

			return () => {
				port.removeEventListener("message", handleMessage);
			};
		},
		subscribeToSubagentEvents(listener: (event: DesktopSubagentRuntimeEvent) => void): () => void {
			const port = ensureSubagentStreamPort();
			const handleMessage = (event: BridgeMessageEvent<DesktopSubagentRuntimeEvent>) => {
				listener(event.data);
			};

			port.addEventListener("message", handleMessage);

			return () => {
				port.removeEventListener("message", handleMessage);
			};
		},
		subscribeToWorkspaceRuntimeEvents(listener: (event: DesktopWorkspaceRuntimeEvent) => void): () => void {
			const port = ensureWorkspaceRuntimeStreamPort();
			const handleMessage = (event: BridgeMessageEvent<DesktopWorkspaceRuntimeEvent>) => {
				listener(event.data);
			};

			port.addEventListener("message", handleMessage);

			return () => {
				port.removeEventListener("message", handleMessage);
			};
		},
	};
}
