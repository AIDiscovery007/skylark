import { randomUUID } from "node:crypto";
import { BrowserWindow, dialog, ipcMain, type MessagePortMain, type OpenDialogOptions, shell } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import type {
	DesktopEnvironmentEvent,
	DesktopEnvironmentResource,
	DesktopNativeAppearance,
	DesktopProviderKeyTestResult,
	DesktopRuntimeCatalog,
} from "../../shared/types.ts";
import { DESKTOP_SUBAGENT_TOOL_NAME } from "../../shared/types.ts";
import { createDesktopNativeAppearance } from "../appearance/native-appearance.ts";
import type { DesktopAuthService } from "../auth/desktop-auth-service.ts";
import { testDesktopProviderKey } from "../auth/provider-key-test-service.ts";
import type { JsonEnvironmentResourceStore } from "../environment/environment-resource-store.ts";
import { copyDesktopEventAttachments, prepareDesktopEventAttachments } from "../events/event-attachment-service.ts";
import {
	createDesktopEventManagementProposal,
	type DesktopEventManagementGenerateText,
	readDesktopEventManagementCriteria,
	writeDesktopEventManagementCriteria,
} from "../events/event-management-service.ts";
import { runDesktopEvent } from "../events/event-run-service.ts";
import type { DesktopEventStore } from "../events/event-store.ts";
import { DesktopEventStreamBroker } from "../events/event-stream-broker.ts";
import type { DesktopMcpManager } from "../mcp/mcp-manager.ts";
import { measureMainAsync } from "../performance.ts";
import { readDesktopPreviewFile } from "../preview/preview-file-service.ts";
import { readWorkspacePreviewFile } from "../preview/workspace-preview-file-service.ts";
import { prepareDesktopPromptAttachments } from "../prompt/prompt-attachment-service.ts";
import { createGitReviewSnapshot } from "../review/git-review-service.ts";
import type { DesktopRuntimeHost } from "../runtime/desktop-runtime-host.ts";
import type { DesktopSubagentRuntimeBroker } from "../runtime/subagent-runtime-broker.ts";
import { readSubagentSnapshot } from "../runtime/subagent-snapshot.ts";
import type { DesktopApprovalBroker } from "../security/approval-broker.ts";
import type { DesktopInstructionStore } from "../storage/instruction-store.ts";
import type { DesktopProjectStore } from "../storage/project-store.ts";
import type { DesktopProviderKeysStore } from "../storage/provider-keys-store.ts";
import type { DesktopSessionStore } from "../storage/session-store.ts";
import type { DesktopSettingsStore } from "../storage/settings-store.ts";
import type { DesktopPtyManager } from "../terminal/pty-manager.ts";
import type { DesktopWindowManager } from "../window/desktop-window-manager.ts";
import { registerDesktopBridgeGroup } from "./desktop-bridge-registry.ts";
import { openAgentStream } from "./open-agent-stream.ts";
import { openApprovalStream } from "./open-approval-stream.ts";
import { openAuthStream } from "./open-auth-stream.ts";
import { openCapabilityStream } from "./open-capability-stream.ts";
import { openTerminalStream } from "./open-terminal-stream.ts";
import {
	type ValidatedDesktopSetting,
	validateApprovalDecision,
	validateCapabilityDetailRequest,
	validateCompactRequest,
	validateConsumeProposedPlanRequest,
	validateCreateSkillRequest,
	validateEnvironmentResourceDetachRequest,
	validateEnvironmentResourceListRequest,
	validateEventCommentCreateRequest,
	validateEventCreateRequest,
	validateEventDeleteRequest,
	validateEventListRequest,
	validateEventManagementApplyRequest,
	validateEventManagementCriteriaUpdateRequest,
	validateEventManagementProposalRequest,
	validateEventRunRequest,
	validateEventStatusUpdateRequest,
	validateEventUpdateRequest,
	validateExecutePlanRequest,
	validateExternalUrl,
	validateMcpServerUpsertRequest,
	validateOAuthCode,
	validateOpenEventAttachmentsRequest,
	validateOpenPromptAttachmentsRequest,
	validateOptionalProjectId,
	validatePrepareEventAttachmentsRequest,
	validatePreparePromptAttachmentsRequest,
	validatePreviewFileRequest,
	validateProjectId,
	validatePromptRequest,
	validatePromptTemplateDeleteRequest,
	validatePromptTemplateUpsertRequest,
	validateProviderId,
	validateProviderKey,
	validateReviewSnapshotRequest,
	validateSessionId,
	validateSessionModeUpdateRequest,
	validateSessionProfileUpdateRequest,
	validateSettingInput,
	validateSettingsOpenRequest,
	validateSubagentSnapshotRequest,
	validateTerminalCreateRequest,
	validateTerminalDisposeRequest,
	validateTerminalResizeRequest,
	validateTerminalWriteRequest,
	validateWorkspacePreviewFileRequest,
} from "./validate-ipc.ts";
import {
	createWorkspaceRuntimeBridgeGroup,
	type WorkspaceRuntimeHandlerServices,
} from "./workspace-runtime-handlers.ts";

interface EnvironmentHandlerServices {
	environmentResourceStore: Pick<JsonEnvironmentResourceStore, "detachResource" | "listResources">;
	refreshEnvironmentResources?: () => Promise<DesktopEnvironmentResource[]>;
	subagentRuntimeBroker?: Pick<DesktopSubagentRuntimeBroker, "openPort">;
	subagentSessionsDir?: string;
}

interface EventManagementHandlerServices {
	criteriaFilePath: string;
	eventBroker?: DesktopEventStreamBroker;
	generateText: DesktopEventManagementGenerateText;
}

export interface DesktopShellHandlerServices {
	getNativeAppearance?: () => DesktopNativeAppearance;
	openExternalUrl?: (url: string) => Promise<void>;
	testProviderKey?: (provider: string) => Promise<DesktopProviderKeyTestResult>;
	windowManager?: DesktopWindowManager;
}

function setValidatedSetting(
	store: DesktopSettingsStore,
	instructionStore: DesktopInstructionStore | undefined,
	setting: ValidatedDesktopSetting,
): Promise<void> {
	switch (setting.key) {
		case "appearance":
			return store.set("appearance", setting.value);
		case "defaultProvider":
			return store.set("defaultProvider", setting.value);
		case "defaultModel":
			return store.set("defaultModel", setting.value);
		case "defaultThinkingLevel":
			return store.set("defaultThinkingLevel", setting.value);
		case "showThinkingBlocks":
			return store.set("showThinkingBlocks", setting.value);
		case "compactInstruction":
			if (!instructionStore) {
				throw new Error("Instruction resource storage is not configured.");
			}
			return instructionStore.setCompactInstruction(setting.value);
		case "globalAgentsInstruction":
			if (!instructionStore) {
				throw new Error("Instruction resource storage is not configured.");
			}
			return instructionStore.setGlobalAgentsInstruction(setting.value);
		case "permissionApprovals":
			return store.set("permissionApprovals", setting.value);
		case "lastOpenedProjectId":
			return store.set("lastOpenedProjectId", setting.value);
		case "lastOpenedSessionId":
			return store.set("lastOpenedSessionId", setting.value);
		case "windowStates":
			return store.set("windowStates", setting.value);
	}
}

async function readDesktopSettings(
	settingsStore: DesktopSettingsStore,
	instructionStore: DesktopInstructionStore | undefined,
) {
	return {
		...(await settingsStore.getAll()),
		...(instructionStore ? await instructionStore.getAll() : {}),
	};
}

export function registerDesktopAgentHandlers(
	host: DesktopRuntimeHost,
	authService: DesktopAuthService,
	ptyManager: DesktopPtyManager,
	mcpManager: DesktopMcpManager,
	approvalBroker: DesktopApprovalBroker,
	getRuntimeCatalog: () => Promise<DesktopRuntimeCatalog>,
	stores: {
		settingsStore: DesktopSettingsStore;
		instructionStore?: DesktopInstructionStore;
		providerKeysStore: DesktopProviderKeysStore;
		projectStore: DesktopProjectStore;
		eventStore: DesktopEventStore;
		sessionStore: DesktopSessionStore;
	},
	workspaceRuntimeServices?: WorkspaceRuntimeHandlerServices,
	desktopShellServices: DesktopShellHandlerServices = {},
	environmentServices?: EnvironmentHandlerServices,
	eventManagementServices?: EventManagementHandlerServices,
): void {
	const getNativeAppearance = desktopShellServices.getNativeAppearance ?? createDesktopNativeAppearance;
	const openExternalUrl = desktopShellServices.openExternalUrl ?? ((url: string) => shell.openExternal(url));
	const testProviderKey =
		desktopShellServices.testProviderKey ??
		(async (provider: string) =>
			testDesktopProviderKey({
				provider,
				providerKeysStore: stores.providerKeysStore,
				runtimeCatalog: await getRuntimeCatalog(),
			}));
	ipcMain.removeHandler(IPC_CHANNELS.getSnapshot);
	ipcMain.removeHandler(IPC_CHANNELS.getSubagentSnapshot);
	ipcMain.removeHandler(IPC_CHANNELS.getWorkspaceOverview);
	ipcMain.removeHandler(IPC_CHANNELS.getRuntimeCatalog);
	ipcMain.removeHandler(IPC_CHANNELS.prompt);
	ipcMain.removeHandler(IPC_CHANNELS.updateSessionProfile);
	ipcMain.removeHandler(IPC_CHANNELS.setSessionMode);
	ipcMain.removeHandler(IPC_CHANNELS.consumeProposedPlan);
	ipcMain.removeHandler(IPC_CHANNELS.executePlan);
	ipcMain.removeHandler(IPC_CHANNELS.abort);
	ipcMain.removeHandler(IPC_CHANNELS.getReviewSnapshot);
	ipcMain.removeHandler(IPC_CHANNELS.openPreviewFiles);
	ipcMain.removeHandler(IPC_CHANNELS.openWorkspacePreviewFile);
	ipcMain.removeHandler(IPC_CHANNELS.refreshPreviewFile);
	ipcMain.removeHandler(IPC_CHANNELS.getSettings);
	ipcMain.removeHandler(IPC_CHANNELS.setSetting);
	ipcMain.removeHandler(IPC_CHANNELS.listProviderKeys);
	ipcMain.removeHandler(IPC_CHANNELS.setProviderKey);
	ipcMain.removeHandler(IPC_CHANNELS.deleteProviderKey);
	ipcMain.removeHandler(IPC_CHANNELS.testProviderKey);
	ipcMain.removeHandler(IPC_CHANNELS.listOAuthProviders);
	ipcMain.removeHandler(IPC_CHANNELS.startOAuthLogin);
	ipcMain.removeHandler(IPC_CHANNELS.submitOAuthLoginCode);
	ipcMain.removeHandler(IPC_CHANNELS.cancelOAuthLogin);
	ipcMain.removeHandler(IPC_CHANNELS.logoutOAuthProvider);
	ipcMain.removeHandler(IPC_CHANNELS.getStorageSecurityState);
	ipcMain.removeHandler(IPC_CHANNELS.listCapabilities);
	ipcMain.removeHandler(IPC_CHANNELS.getCapabilityDetail);
	ipcMain.removeHandler(IPC_CHANNELS.createSkill);
	ipcMain.removeHandler(IPC_CHANNELS.upsertPromptTemplate);
	ipcMain.removeHandler(IPC_CHANNELS.deletePromptTemplate);
	ipcMain.removeHandler(IPC_CHANNELS.upsertMcpServer);
	ipcMain.removeHandler(IPC_CHANNELS.setMcpServerEnabled);
	ipcMain.removeHandler(IPC_CHANNELS.testMcpServer);
	ipcMain.removeHandler(IPC_CHANNELS.restartMcpServer);
	ipcMain.removeHandler(IPC_CHANNELS.reloadCapabilities);
	ipcMain.removeHandler(IPC_CHANNELS.listProjects);
	ipcMain.removeHandler(IPC_CHANNELS.createProjectFromFolder);
	ipcMain.removeHandler(IPC_CHANNELS.switchProject);
	ipcMain.removeHandler(IPC_CHANNELS.listSessions);
	ipcMain.removeHandler(IPC_CHANNELS.newSession);
	ipcMain.removeHandler(IPC_CHANNELS.switchSession);
	ipcMain.removeHandler(IPC_CHANNELS.deleteSession);
	ipcMain.removeHandler(IPC_CHANNELS.listEnvironmentResources);
	ipcMain.removeHandler(IPC_CHANNELS.detachEnvironmentResource);
	ipcMain.removeHandler(IPC_CHANNELS.listWorkspaceRuntimes);
	ipcMain.removeHandler(IPC_CHANNELS.createDebugWorkspaceRuntime);
	ipcMain.removeHandler(IPC_CHANNELS.openWorkspaceRuntime);
	ipcMain.removeHandler(IPC_CHANNELS.pauseWorkspaceRuntime);
	ipcMain.removeHandler(IPC_CHANNELS.resumeWorkspaceRuntime);
	ipcMain.removeHandler(IPC_CHANNELS.archiveWorkspaceRuntime);
	ipcMain.removeHandler(IPC_CHANNELS.captureWorkspaceRuntimeContext);
	ipcMain.removeHandler(IPC_CHANNELS.takeOverWorkspaceRuntimePane);
	ipcMain.removeHandler(IPC_CHANNELS.sendWorkspaceRuntimePaneText);
	ipcMain.removeHandler(IPC_CHANNELS.returnWorkspaceRuntimePaneControl);
	ipcMain.removeHandler(IPC_CHANNELS.createTerminal);
	ipcMain.removeHandler(IPC_CHANNELS.writeTerminal);
	ipcMain.removeHandler(IPC_CHANNELS.resizeTerminal);
	ipcMain.removeHandler(IPC_CHANNELS.disposeTerminal);
	ipcMain.removeHandler(IPC_CHANNELS.resolveApproval);
	ipcMain.removeHandler(IPC_CHANNELS.preparePromptAttachments);
	ipcMain.removeHandler(IPC_CHANNELS.openPromptAttachments);
	ipcMain.removeHandler(IPC_CHANNELS.listEvents);
	ipcMain.removeHandler(IPC_CHANNELS.getEvent);
	ipcMain.removeHandler(IPC_CHANNELS.createEvent);
	ipcMain.removeHandler(IPC_CHANNELS.updateEvent);
	ipcMain.removeHandler(IPC_CHANNELS.addEventComment);
	ipcMain.removeHandler(IPC_CHANNELS.getEventManagementCriteria);
	ipcMain.removeHandler(IPC_CHANNELS.saveEventManagementCriteria);
	ipcMain.removeHandler(IPC_CHANNELS.createEventManagementProposal);
	ipcMain.removeHandler(IPC_CHANNELS.applyEventManagementProposal);
	ipcMain.removeHandler(IPC_CHANNELS.setEventStatus);
	ipcMain.removeHandler(IPC_CHANNELS.deleteEvent);
	ipcMain.removeHandler(IPC_CHANNELS.prepareEventAttachments);
	ipcMain.removeHandler(IPC_CHANNELS.openEventAttachments);
	ipcMain.removeHandler(IPC_CHANNELS.runEvent);
	ipcMain.removeHandler(IPC_CHANNELS.compact);
	ipcMain.removeHandler(IPC_CHANNELS.getNativeAppearance);
	ipcMain.removeHandler(IPC_CHANNELS.openSettingsWindow);
	ipcMain.removeHandler(IPC_CHANNELS.notifyFirstInteractive);
	ipcMain.removeHandler(IPC_CHANNELS.openExternalUrl);
	ipcMain.removeAllListeners(IPC_CHANNELS.openStream);
	ipcMain.removeAllListeners(IPC_CHANNELS.openTerminalStream);
	ipcMain.removeAllListeners(IPC_CHANNELS.openAuthStream);
	ipcMain.removeAllListeners(IPC_CHANNELS.openCapabilityStream);
	ipcMain.removeAllListeners(IPC_CHANNELS.openApprovalStream);
	ipcMain.removeAllListeners(IPC_CHANNELS.openEventStream);
	ipcMain.removeAllListeners(IPC_CHANNELS.openSettingsStream);
	ipcMain.removeAllListeners(IPC_CHANNELS.openEnvironmentStream);
	ipcMain.removeAllListeners(IPC_CHANNELS.openSubagentStream);
	ipcMain.removeAllListeners(IPC_CHANNELS.openWorkspaceRuntimeStream);

	if (workspaceRuntimeServices) {
		registerDesktopBridgeGroup(
			ipcMain,
			createWorkspaceRuntimeBridgeGroup({
				projectStore: stores.projectStore,
				services: workspaceRuntimeServices,
			}),
		);
	}

	const previewFilePaths = new Set<string>();
	const eventBroker = eventManagementServices?.eventBroker ?? new DesktopEventStreamBroker();
	const settingsPorts = new Set<MessagePortMain>();
	const environmentPorts = new Set<MessagePortMain>();
	const publishEventUpdate = (event: Awaited<ReturnType<DesktopEventStore["getEvent"]>> | undefined): void => {
		eventBroker.publishEventUpdate(event);
	};
	const requireEventManagementServices = (): EventManagementHandlerServices => {
		if (!eventManagementServices) {
			throw new Error("Event management services are not configured.");
		}
		return eventManagementServices;
	};
	const publishEnvironmentEvent = (event: DesktopEnvironmentEvent): void => {
		for (const port of environmentPorts) {
			port.postMessage(event);
		}
	};
	const publishSettingsUpdated = async (): Promise<void> => {
		const settings = await readDesktopSettings(stores.settingsStore, stores.instructionStore);
		for (const port of settingsPorts) {
			port.postMessage({
				type: "settings_updated",
				settings,
			});
		}
	};
	const refreshAndPublishEnvironmentResources = async (
		request?: Parameters<EnvironmentHandlerServices["environmentResourceStore"]["listResources"]>[0],
	): Promise<DesktopEnvironmentResource[]> => {
		if (!environmentServices) {
			return [];
		}
		const resources = environmentServices.refreshEnvironmentResources
			? await environmentServices.refreshEnvironmentResources()
			: await environmentServices.environmentResourceStore.listResources();
		const filtered = request
			? resources.filter((resource) => !request.sessionId || resource.sessionId === request.sessionId)
			: resources;
		publishEnvironmentEvent({
			type: "environment_resources_updated",
			resources,
			updatedAt: new Date().toISOString(),
		});
		return filtered;
	};
	if (typeof host.subscribe === "function") {
		void host.subscribe((event) => {
			if (
				(event.type === "tool_execution_update" || event.type === "tool_execution_end") &&
				event.toolName === DESKTOP_SUBAGENT_TOOL_NAME
			) {
				void refreshAndPublishEnvironmentResources().catch(() => undefined);
				return;
			}
			if (event.type !== "agent_end") {
				return;
			}
			void stores.eventStore
				.markRunAwaitingReviewForSession(event.sessionId)
				.then((updatedEvent) => publishEventUpdate(updatedEvent))
				.catch(() => undefined);
			void refreshAndPublishEnvironmentResources().catch(() => undefined);
		});
	}

	ipcMain.handle(IPC_CHANNELS.getNativeAppearance, async () => getNativeAppearance());
	ipcMain.handle(IPC_CHANNELS.openSettingsWindow, async (_event, request: unknown) => {
		desktopShellServices.windowManager?.openSettingsWindow(validateSettingsOpenRequest(request));
	});
	ipcMain.handle(IPC_CHANNELS.notifyFirstInteractive, async (event) => {
		const senderId = typeof event.sender.id === "number" ? event.sender.id : undefined;
		if (senderId !== undefined) {
			desktopShellServices.windowManager?.notifyFirstInteractive(senderId);
		}
	});
	ipcMain.handle(IPC_CHANNELS.openExternalUrl, async (_event, url: unknown) =>
		openExternalUrl(validateExternalUrl(url)),
	);

	ipcMain.handle(IPC_CHANNELS.getWorkspaceOverview, async () => {
		const [overview, settings] = await Promise.all([
			host.getWorkspaceOverview(),
			readDesktopSettings(stores.settingsStore, stores.instructionStore),
		]);
		return {
			...overview,
			settings,
		};
	});
	ipcMain.handle(IPC_CHANNELS.getSnapshot, async (_event, sessionId: unknown) =>
		host.getSnapshot(validateSessionId(sessionId)),
	);
	ipcMain.handle(IPC_CHANNELS.getSubagentSnapshot, async (_event, request: unknown) => {
		if (!environmentServices?.subagentSessionsDir) {
			throw new Error("Subagent snapshots are not available.");
		}
		return readSubagentSnapshot({
			environmentResourceStore: environmentServices.environmentResourceStore,
			request: validateSubagentSnapshotRequest(request),
			subagentSessionsDir: environmentServices.subagentSessionsDir,
		});
	});
	ipcMain.handle(IPC_CHANNELS.getRuntimeCatalog, async () => getRuntimeCatalog());
	ipcMain.handle(IPC_CHANNELS.prompt, async (_event, request: unknown) => {
		const promptRequest = validatePromptRequest(request);
		return host.prompt(promptRequest.sessionId, {
			text: promptRequest.text,
			...(promptRequest.capabilityInvocations ? { capabilityInvocations: promptRequest.capabilityInvocations } : {}),
			...(promptRequest.attachments ? { attachments: promptRequest.attachments } : {}),
		});
	});
	ipcMain.handle(IPC_CHANNELS.preparePromptAttachments, async (_event, request: unknown) => {
		const validatedRequest = validatePreparePromptAttachmentsRequest(request);
		return prepareDesktopPromptAttachments(validatedRequest.candidates);
	});
	ipcMain.handle(IPC_CHANNELS.openPromptAttachments, async (event, request: unknown) => {
		const validatedRequest = validateOpenPromptAttachmentsRequest(request);
		const cwd = await host.resolveReviewWorkspaceCwd(validatedRequest);
		const browserWindow = BrowserWindow.fromWebContents(event.sender);
		const options: OpenDialogOptions = {
			properties: ["openFile", "multiSelections"],
			...(cwd ? { defaultPath: cwd } : {}),
		};
		const result = browserWindow
			? await dialog.showOpenDialog(browserWindow, options)
			: await dialog.showOpenDialog(options);
		if (result.canceled) {
			return { attachments: [], errors: [] };
		}
		return prepareDesktopPromptAttachments(result.filePaths.map((filePath) => ({ type: "path", path: filePath })));
	});
	ipcMain.handle(IPC_CHANNELS.listEvents, async (_event, request: unknown) =>
		stores.eventStore.listEvents(validateEventListRequest(request)),
	);
	ipcMain.handle(IPC_CHANNELS.getEvent, async (_event, eventId: unknown) => {
		const event = await stores.eventStore.getEvent(validateSessionId(eventId));
		return event ?? undefined;
	});
	ipcMain.handle(IPC_CHANNELS.prepareEventAttachments, async (_event, request: unknown) => {
		const validatedRequest = validatePrepareEventAttachmentsRequest(request);
		return prepareDesktopEventAttachments(validatedRequest.candidates);
	});
	ipcMain.handle(IPC_CHANNELS.openEventAttachments, async (event, request: unknown) => {
		const validatedRequest = validateOpenEventAttachmentsRequest(request);
		const browserWindow = BrowserWindow.fromWebContents(event.sender);
		const options: OpenDialogOptions = {
			filters: [{ name: "Event documents", extensions: ["txt", "md", "docx"] }],
			properties: ["openFile", "multiSelections"],
			...(validatedRequest.defaultPath ? { defaultPath: validatedRequest.defaultPath } : {}),
		};
		const result = browserWindow
			? await dialog.showOpenDialog(browserWindow, options)
			: await dialog.showOpenDialog(options);
		if (result.canceled) {
			return { attachments: [], errors: [] };
		}
		return prepareDesktopEventAttachments(result.filePaths.map((filePath) => ({ type: "path", path: filePath })));
	});
	ipcMain.handle(IPC_CHANNELS.createEvent, async (_event, request: unknown) => {
		const validatedRequest = validateEventCreateRequest(request);
		const eventId = randomUUID();
		const attachments = validatedRequest.attachments
			? await copyDesktopEventAttachments({
					eventId,
					attachmentsRootDir: stores.eventStore.attachmentsRootDir,
					drafts: validatedRequest.attachments,
				})
			: [];
		const event = await stores.eventStore.createEvent({
			title: validatedRequest.title,
			body: validatedRequest.body,
			priority: validatedRequest.priority,
			...(attachments.length > 0 ? { attachments } : {}),
			id: eventId,
		});
		publishEventUpdate(event);
		return event;
	});
	ipcMain.handle(IPC_CHANNELS.updateEvent, async (_event, request: unknown) => {
		const validatedRequest = validateEventUpdateRequest(request);
		const event = await stores.eventStore.updateEvent(validatedRequest.eventId, validatedRequest);
		publishEventUpdate(event);
		return event;
	});
	ipcMain.handle(IPC_CHANNELS.addEventComment, async (_event, request: unknown) => {
		const validatedRequest = validateEventCommentCreateRequest(request);
		const event = await stores.eventStore.addEventComment(validatedRequest.eventId, {
			author: validatedRequest.author,
			body: validatedRequest.body,
			source: "manual",
		});
		publishEventUpdate(event);
		return event;
	});
	ipcMain.handle(IPC_CHANNELS.getEventManagementCriteria, async () => {
		const services = requireEventManagementServices();
		return readDesktopEventManagementCriteria(services.criteriaFilePath);
	});
	ipcMain.handle(IPC_CHANNELS.saveEventManagementCriteria, async (_event, request: unknown) => {
		const services = requireEventManagementServices();
		return writeDesktopEventManagementCriteria(
			services.criteriaFilePath,
			validateEventManagementCriteriaUpdateRequest(request).content,
		);
	});
	ipcMain.handle(IPC_CHANNELS.createEventManagementProposal, async (_event, request: unknown) => {
		const services = requireEventManagementServices();
		return createDesktopEventManagementProposal({
			criteriaFilePath: services.criteriaFilePath,
			eventStore: stores.eventStore,
			generateText: services.generateText,
			request: validateEventManagementProposalRequest(request),
		});
	});
	ipcMain.handle(IPC_CHANNELS.applyEventManagementProposal, async (_event, request: unknown) => {
		const validatedRequest = validateEventManagementApplyRequest(request);
		const events = await stores.eventStore.applyEventManagementProposal(validatedRequest);
		for (const event of events) {
			publishEventUpdate(event);
		}
		return events;
	});
	ipcMain.handle(IPC_CHANNELS.setEventStatus, async (_event, request: unknown) => {
		const validatedRequest = validateEventStatusUpdateRequest(request);
		const event = await stores.eventStore.setEventStatus(validatedRequest.eventId, validatedRequest.status);
		publishEventUpdate(event);
		return event;
	});
	ipcMain.handle(IPC_CHANNELS.deleteEvent, async (_event, request: unknown) => {
		const validatedRequest = validateEventDeleteRequest(request);
		await stores.eventStore.deleteEvent(validatedRequest.eventId);
		eventBroker.publishEventDelete(validatedRequest.eventId);
	});
	ipcMain.handle(IPC_CHANNELS.runEvent, async (_event, request: unknown) => {
		const validatedRequest = validateEventRunRequest(request);
		try {
			const result = await runDesktopEvent({
				eventStore: stores.eventStore,
				host,
				request: validatedRequest,
			});
			publishEventUpdate(result.event);
			return result;
		} catch (error) {
			publishEventUpdate(await stores.eventStore.getEvent(validatedRequest.eventId));
			throw error;
		}
	});
	ipcMain.handle(IPC_CHANNELS.compact, async (_event, request: unknown) => {
		const compactRequest = validateCompactRequest(request);
		return host.compact(compactRequest.sessionId, compactRequest.customInstructions);
	});
	ipcMain.handle(IPC_CHANNELS.updateSessionProfile, async (_event, request: unknown) =>
		host.updateSessionProfile(validateSessionProfileUpdateRequest(request)),
	);
	ipcMain.handle(IPC_CHANNELS.setSessionMode, async (_event, request: unknown) =>
		host.setSessionMode(validateSessionModeUpdateRequest(request)),
	);
	ipcMain.handle(IPC_CHANNELS.consumeProposedPlan, async (_event, request: unknown) =>
		host.consumeProposedPlan(validateConsumeProposedPlanRequest(request)),
	);
	ipcMain.handle(IPC_CHANNELS.executePlan, async (_event, request: unknown) =>
		host.executePlan(validateExecutePlanRequest(request)),
	);
	ipcMain.handle(IPC_CHANNELS.abort, async (_event, sessionId: unknown) => host.abort(validateSessionId(sessionId)));
	ipcMain.handle(IPC_CHANNELS.getReviewSnapshot, async (_event, request: unknown) => {
		const reviewRequest = validateReviewSnapshotRequest(request);
		const cwd = await host.resolveReviewWorkspaceCwd(reviewRequest);
		return createGitReviewSnapshot(cwd);
	});
	ipcMain.handle(IPC_CHANNELS.openPreviewFiles, async (event, request: unknown) => {
		const previewRequest = validateReviewSnapshotRequest(request);
		const cwd = await host.resolveReviewWorkspaceCwd(previewRequest);
		const browserWindow = BrowserWindow.fromWebContents(event.sender);
		const options: OpenDialogOptions = {
			properties: ["openFile", "multiSelections"],
			...(cwd ? { defaultPath: cwd } : {}),
		};
		const result = browserWindow
			? await dialog.showOpenDialog(browserWindow, options)
			: await dialog.showOpenDialog(options);
		if (result.canceled) {
			return [];
		}

		for (const filePath of result.filePaths) {
			previewFilePaths.add(filePath);
		}
		return Promise.all(result.filePaths.map((filePath) => readDesktopPreviewFile(filePath)));
	});
	ipcMain.handle(IPC_CHANNELS.openWorkspacePreviewFile, async (_event, request: unknown) => {
		const previewRequest = validateWorkspacePreviewFileRequest(request);
		const cwd = await host.resolveReviewWorkspaceCwd(previewRequest);
		const file = await readWorkspacePreviewFile(cwd, previewRequest.path);
		if (!file.errorMessage) {
			previewFilePaths.add(file.path);
		}
		return file;
	});
	ipcMain.handle(IPC_CHANNELS.refreshPreviewFile, async (_event, request: unknown) => {
		const { path } = validatePreviewFileRequest(request);
		if (!previewFilePaths.has(path)) {
			throw new TypeError("Invalid preview file request: file was not selected in this app session");
		}
		return readDesktopPreviewFile(path);
	});
	ipcMain.handle(IPC_CHANNELS.getSettings, async () =>
		readDesktopSettings(stores.settingsStore, stores.instructionStore),
	);
	ipcMain.handle(IPC_CHANNELS.setSetting, async (_event, key: unknown, value: unknown) => {
		await setValidatedSetting(stores.settingsStore, stores.instructionStore, validateSettingInput(key, value));
		await publishSettingsUpdated();
	});
	ipcMain.handle(IPC_CHANNELS.listProviderKeys, async () => stores.providerKeysStore.list());
	ipcMain.handle(IPC_CHANNELS.setProviderKey, async (_event, provider: unknown, key: unknown) => {
		const providerId = validateProviderId(provider);
		await stores.providerKeysStore.set(providerId, validateProviderKey(key));
		authService.notifyCredentialsChanged(providerId);
	});
	ipcMain.handle(IPC_CHANNELS.deleteProviderKey, async (_event, provider: unknown) => {
		const providerId = validateProviderId(provider);
		await stores.providerKeysStore.delete(providerId);
		authService.notifyCredentialsChanged(providerId);
	});
	ipcMain.handle(IPC_CHANNELS.testProviderKey, async (_event, provider: unknown) =>
		testProviderKey(validateProviderId(provider)),
	);
	ipcMain.handle(IPC_CHANNELS.listOAuthProviders, async () => authService.listOAuthProviders());
	ipcMain.handle(IPC_CHANNELS.startOAuthLogin, async (_event, provider: unknown) =>
		authService.startOAuthLogin(validateProviderId(provider)),
	);
	ipcMain.handle(IPC_CHANNELS.submitOAuthLoginCode, async (_event, provider: unknown, code: unknown) =>
		authService.submitOAuthLoginCode(validateProviderId(provider), validateOAuthCode(code)),
	);
	ipcMain.handle(IPC_CHANNELS.cancelOAuthLogin, async (_event, provider: unknown) =>
		authService.cancelOAuthLogin(validateProviderId(provider)),
	);
	ipcMain.handle(IPC_CHANNELS.logoutOAuthProvider, async (_event, provider: unknown) =>
		authService.logoutOAuthProvider(validateProviderId(provider)),
	);
	ipcMain.handle(IPC_CHANNELS.getStorageSecurityState, async () => stores.providerKeysStore.getSecurityState());
	ipcMain.handle(IPC_CHANNELS.listCapabilities, async () => host.listCapabilities());
	ipcMain.handle(IPC_CHANNELS.getCapabilityDetail, async (_event, request: unknown) =>
		host.getCapabilityDetail(validateCapabilityDetailRequest(request)),
	);
	ipcMain.handle(IPC_CHANNELS.createSkill, async (_event, request: unknown) => {
		const validatedRequest = validateCreateSkillRequest(request);
		await approvalBroker.requestApproval({
			category: "capability_mutation",
			action: "create_skill",
			title: "Create skill",
			description: "Create or overwrite a local desktop skill.",
			subject: validatedRequest.name,
			details: {
				name: validatedRequest.name,
				scope: validatedRequest.scope ?? "project",
				overwrite: validatedRequest.overwrite === true,
			},
		});
		return host.createSkill(validatedRequest);
	});
	ipcMain.handle(IPC_CHANNELS.upsertPromptTemplate, async (_event, request: unknown) => {
		const validatedRequest = validatePromptTemplateUpsertRequest(request);
		await approvalBroker.requestApproval({
			category: "capability_mutation",
			action: "create_prompt_template",
			title: "Create prompt template",
			description: "Create or overwrite a local prompt template.",
			subject: validatedRequest.name,
			details: {
				name: validatedRequest.name,
				scope: validatedRequest.scope ?? "project",
				overwrite: validatedRequest.overwrite ?? true,
			},
		});
		return host.upsertPromptTemplate(validatedRequest);
	});
	ipcMain.handle(IPC_CHANNELS.deletePromptTemplate, async (_event, request: unknown) => {
		const validatedRequest = validatePromptTemplateDeleteRequest(request);
		await approvalBroker.requestApproval({
			category: "capability_mutation",
			action: "delete_prompt_template",
			title: "Delete prompt template",
			description: "Delete a local prompt template file.",
			subject: validatedRequest.filePath,
			details: {
				filePath: validatedRequest.filePath,
			},
		});
		return host.deletePromptTemplate(validatedRequest);
	});
	ipcMain.handle(IPC_CHANNELS.upsertMcpServer, async (_event, request: unknown) => {
		const validatedRequest = validateMcpServerUpsertRequest(request);
		await approvalBroker.requestApproval({
			category: "mcp_server_lifecycle",
			action: "upsert_mcp_server",
			title: "Configure MCP server",
			description: "Add or update a stdio MCP server configuration.",
			subject: validatedRequest.name,
			cwd: validatedRequest.cwd,
			details: {
				command: validatedRequest.command,
				args: validatedRequest.args ?? [],
				connectNow: validatedRequest.connectNow === true,
				enabled: validatedRequest.enabled === true,
			},
		});
		return host.upsertMcpServer(validatedRequest);
	});
	ipcMain.handle(IPC_CHANNELS.setMcpServerEnabled, async (_event, serverId: unknown, enabled: unknown) => {
		if (typeof enabled !== "boolean") {
			throw new TypeError("Invalid MCP enabled value: expected a boolean");
		}
		const validatedServerId = validateSessionId(serverId);
		await approvalBroker.requestApproval({
			category: "mcp_server_lifecycle",
			action: enabled ? "enable_mcp_server" : "disable_mcp_server",
			title: enabled ? "Enable MCP server" : "Disable MCP server",
			description: "Change MCP server lifecycle state.",
			subject: validatedServerId,
			details: { enabled },
		});
		return host.setMcpServerEnabled(validatedServerId, enabled);
	});
	ipcMain.handle(IPC_CHANNELS.testMcpServer, async (_event, serverId: unknown) => {
		const validatedServerId = validateSessionId(serverId);
		await approvalBroker.requestApproval({
			category: "mcp_server_lifecycle",
			action: "test_mcp_server",
			title: "Test MCP server",
			description: "Start a stdio MCP server process to validate its tools.",
			subject: validatedServerId,
		});
		return host.testMcpServer(validatedServerId);
	});
	ipcMain.handle(IPC_CHANNELS.restartMcpServer, async (_event, serverId: unknown) => {
		const validatedServerId = validateSessionId(serverId);
		await approvalBroker.requestApproval({
			category: "mcp_server_lifecycle",
			action: "restart_mcp_server",
			title: "Restart MCP server",
			description: "Restart a stdio MCP server process.",
			subject: validatedServerId,
		});
		return host.restartMcpServer(validatedServerId);
	});
	ipcMain.handle(IPC_CHANNELS.reloadCapabilities, async () => host.reloadCapabilities());
	ipcMain.handle(IPC_CHANNELS.listProjects, async () => host.listProjects());
	ipcMain.handle(IPC_CHANNELS.createProjectFromFolder, async (event) => {
		const browserWindow = BrowserWindow.fromWebContents(event.sender);
		const options: OpenDialogOptions = { properties: ["openDirectory"] };
		const result = browserWindow
			? await dialog.showOpenDialog(browserWindow, options)
			: await dialog.showOpenDialog(options);
		const [folderPath] = result.filePaths;
		if (result.canceled || !folderPath) {
			return undefined;
		}

		return host.createProject(folderPath);
	});
	ipcMain.handle(IPC_CHANNELS.switchProject, async (_event, projectId: unknown) =>
		host.switchProject(validateProjectId(projectId)),
	);
	ipcMain.handle(IPC_CHANNELS.listSessions, async (_event, projectId?: unknown) =>
		host.listSessions(validateOptionalProjectId(projectId)),
	);
	ipcMain.handle(IPC_CHANNELS.newSession, async (_event, projectId?: unknown) =>
		host.newSession(validateOptionalProjectId(projectId)),
	);
	ipcMain.handle(IPC_CHANNELS.switchSession, async (_event, sessionId: unknown) =>
		host.switchSession(validateSessionId(sessionId)),
	);
	ipcMain.handle(IPC_CHANNELS.deleteSession, async (_event, sessionId: unknown) => {
		const validatedSessionId = validateSessionId(sessionId);
		ptyManager.disposeSession(validatedSessionId);
		return host.deleteSession(validatedSessionId);
	});
	ipcMain.handle(IPC_CHANNELS.listEnvironmentResources, async (_event, request?: unknown) => {
		const validatedRequest = validateEnvironmentResourceListRequest(request);
		return refreshAndPublishEnvironmentResources(validatedRequest);
	});
	ipcMain.handle(IPC_CHANNELS.detachEnvironmentResource, async (_event, request: unknown) => {
		if (!environmentServices) {
			throw new Error("Environment resources are not available.");
		}
		const validatedRequest = validateEnvironmentResourceDetachRequest(request);
		const resource = await environmentServices.environmentResourceStore.detachResource(validatedRequest.resourceId);
		publishEnvironmentEvent({
			type: "environment_resource_detached",
			resource,
			updatedAt: new Date().toISOString(),
		});
		return resource;
	});
	ipcMain.handle(IPC_CHANNELS.createTerminal, async (_event, request: unknown) => {
		const validatedRequest = validateTerminalCreateRequest(request);
		const terminalCwd = validatedRequest.source.type === "shell" ? validatedRequest.source.cwd : undefined;
		const terminalSubject =
			validatedRequest.source.type === "shell" ? validatedRequest.source.cwd : validatedRequest.source.resourceId;
		await approvalBroker.requestApproval({
			category: "terminal",
			action: "create_terminal",
			title: "Start terminal",
			description: "Start a local interactive shell for this session.",
			subject: terminalSubject,
			...(terminalCwd ? { cwd: terminalCwd } : {}),
			details: {
				sessionId: validatedRequest.sessionId,
				terminalId: validatedRequest.terminalId,
				cols: validatedRequest.cols,
				rows: validatedRequest.rows,
				sourceType: validatedRequest.source.type,
			},
		});
		return measureMainAsync("main terminal open", async () => ptyManager.create(validatedRequest));
	});
	ipcMain.handle(IPC_CHANNELS.writeTerminal, async (_event, request: unknown) =>
		ptyManager.write(validateTerminalWriteRequest(request)),
	);
	ipcMain.handle(IPC_CHANNELS.resizeTerminal, async (_event, request: unknown) =>
		ptyManager.resize(validateTerminalResizeRequest(request)),
	);
	ipcMain.handle(IPC_CHANNELS.disposeTerminal, async (_event, request: unknown) =>
		ptyManager.dispose(validateTerminalDisposeRequest(request).terminalId),
	);
	ipcMain.handle(IPC_CHANNELS.resolveApproval, async (_event, decision: unknown) => {
		approvalBroker.resolveApproval(validateApprovalDecision(decision));
	});

	ipcMain.on(IPC_CHANNELS.openStream, (event) => {
		const port = event.ports[0];
		if (!port) {
			return;
		}

		void openAgentStream(host, port);
	});

	ipcMain.on(IPC_CHANNELS.openTerminalStream, (event) => {
		const port = event.ports[0];
		if (!port) {
			return;
		}

		openTerminalStream(ptyManager, port);
	});

	ipcMain.on(IPC_CHANNELS.openAuthStream, (event) => {
		const port = event.ports[0];
		if (!port) {
			return;
		}

		openAuthStream(authService, port);
	});

	ipcMain.on(IPC_CHANNELS.openCapabilityStream, (event) => {
		const port = event.ports[0];
		if (!port) {
			return;
		}

		openCapabilityStream(mcpManager, port);
	});

	ipcMain.on(IPC_CHANNELS.openApprovalStream, (event) => {
		const port = event.ports[0];
		if (!port) {
			return;
		}

		openApprovalStream(approvalBroker, port);
	});

	ipcMain.on(IPC_CHANNELS.openEventStream, (event) => {
		const port = event.ports[0];
		if (!port) {
			return;
		}

		eventBroker.openPort(port);
	});

	ipcMain.on(IPC_CHANNELS.openSettingsStream, (event) => {
		const port = event.ports[0];
		if (!port) {
			return;
		}

		settingsPorts.add(port);
		port.start();
		port.on("close", () => {
			settingsPorts.delete(port);
		});
	});

	ipcMain.on(IPC_CHANNELS.openEnvironmentStream, (event) => {
		const port = event.ports[0];
		if (!port) {
			return;
		}

		environmentPorts.add(port);
		port.start();
		port.on("close", () => {
			environmentPorts.delete(port);
		});
	});

	ipcMain.on(IPC_CHANNELS.openSubagentStream, (event) => {
		const port = event.ports[0];
		if (!port || !environmentServices?.subagentRuntimeBroker) {
			return;
		}

		environmentServices.subagentRuntimeBroker.openPort(port);
	});
}
