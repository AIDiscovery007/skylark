import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import type { DesktopRuntimeCatalog } from "../../shared/types.ts";
import { readDesktopPreviewFile } from "../preview/preview-file-service.ts";
import { readWorkspacePreviewFile } from "../preview/workspace-preview-file-service.ts";
import { prepareDesktopPromptAttachments } from "../prompt/prompt-attachment-service.ts";
import { createGitReviewSnapshot } from "../review/git-review-service.ts";
import type { DesktopRuntimeHost } from "../runtime/desktop-runtime-host.ts";
import type { DesktopInstructionStore } from "../storage/instruction-store.ts";
import type { DesktopSettingsStore } from "../storage/settings-store.ts";
import type { DesktopPtyManager } from "../terminal/pty-manager.ts";
import { listWorkspaceFiles } from "../workspace/workspace-file-list-service.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import { readDesktopSettings } from "./settings-handlers.ts";
import {
	validateCompactRequest,
	validateConsumeProposedPlanRequest,
	validateExecutePlanRequest,
	validateOpenPromptAttachmentsRequest,
	validateOptionalProjectId,
	validatePreparePromptAttachmentsRequest,
	validatePreviewFileRequest,
	validateProjectId,
	validatePromptRequest,
	validateReviewSnapshotRequest,
	validateSessionId,
	validateSessionModeUpdateRequest,
	validateSessionProfileUpdateRequest,
	validateWorkspaceFileListRequest,
	validateWorkspacePreviewFileRequest,
} from "./validate-ipc.ts";

export interface DesktopProjectBridgeGroupOptions {
	host: Pick<
		DesktopRuntimeHost,
		| "createProject"
		| "deleteSession"
		| "listProjects"
		| "listSessions"
		| "newSession"
		| "switchProject"
		| "switchSession"
	>;
	ptyManager: Pick<DesktopPtyManager, "disposeSession">;
}

export interface DesktopPromptBridgeGroupOptions {
	host: Pick<DesktopRuntimeHost, "prompt" | "resolveReviewWorkspaceCwd">;
	promptAttachmentsDir?: string;
}

export interface DesktopPreviewBridgeGroupOptions {
	host: Pick<DesktopRuntimeHost, "resolveReviewWorkspaceCwd">;
}

export interface DesktopSessionBridgeGroupOptions {
	getRuntimeCatalog: () => Promise<DesktopRuntimeCatalog>;
	host: Pick<
		DesktopRuntimeHost,
		| "abort"
		| "compact"
		| "consumeProposedPlan"
		| "executePlan"
		| "getSnapshot"
		| "getWorkspaceOverview"
		| "setSessionMode"
		| "updateSessionProfile"
	>;
	instructionStore?: DesktopInstructionStore;
	settingsStore: DesktopSettingsStore;
}

function getPreparePromptAttachmentOptions(promptAttachmentsDir: string | undefined) {
	return {
		...(promptAttachmentsDir ? { inlineImageAttachmentsDir: promptAttachmentsDir } : {}),
	};
}

export function createProjectBridgeGroup(options: DesktopProjectBridgeGroupOptions): DesktopBridgeGroupDescriptor {
	return {
		commands: [
			{
				channel: IPC_CHANNELS.listProjects,
				handle: async () => options.host.listProjects(),
			},
			{
				channel: IPC_CHANNELS.createProjectFromFolder,
				handle: async (event) => {
					const browserWindow = BrowserWindow.fromWebContents(event.sender);
					const dialogOptions: OpenDialogOptions = { properties: ["openDirectory"] };
					const result = browserWindow
						? await dialog.showOpenDialog(browserWindow, dialogOptions)
						: await dialog.showOpenDialog(dialogOptions);
					const [folderPath] = result.filePaths;
					if (result.canceled || !folderPath) {
						return undefined;
					}

					return options.host.createProject(folderPath);
				},
			},
			{
				channel: IPC_CHANNELS.switchProject,
				handle: async (_event, projectId: unknown) => options.host.switchProject(validateProjectId(projectId)),
			},
			{
				channel: IPC_CHANNELS.listSessions,
				handle: async (_event, projectId?: unknown) =>
					options.host.listSessions(validateOptionalProjectId(projectId)),
			},
			{
				channel: IPC_CHANNELS.newSession,
				handle: async (_event, projectId?: unknown) =>
					options.host.newSession(validateOptionalProjectId(projectId)),
			},
			{
				channel: IPC_CHANNELS.switchSession,
				handle: async (_event, sessionId: unknown) => options.host.switchSession(validateSessionId(sessionId)),
			},
			{
				channel: IPC_CHANNELS.deleteSession,
				handle: async (_event, sessionId: unknown) => {
					const validatedSessionId = validateSessionId(sessionId);
					options.ptyManager.disposeSession(validatedSessionId);
					return options.host.deleteSession(validatedSessionId);
				},
			},
		],
	};
}

export function createPromptBridgeGroup(options: DesktopPromptBridgeGroupOptions): DesktopBridgeGroupDescriptor {
	return {
		commands: [
			{
				channel: IPC_CHANNELS.prompt,
				handle: async (_event, request: unknown) => {
					const promptRequest = validatePromptRequest(request);
					return options.host.prompt(promptRequest.sessionId, {
						text: promptRequest.text,
						...(promptRequest.capabilityInvocations
							? { capabilityInvocations: promptRequest.capabilityInvocations }
							: {}),
						...(promptRequest.attachments ? { attachments: promptRequest.attachments } : {}),
					});
				},
			},
			{
				channel: IPC_CHANNELS.preparePromptAttachments,
				handle: async (_event, request: unknown) => {
					const validatedRequest = validatePreparePromptAttachmentsRequest(request);
					return prepareDesktopPromptAttachments(
						validatedRequest.candidates,
						getPreparePromptAttachmentOptions(options.promptAttachmentsDir),
					);
				},
			},
			{
				channel: IPC_CHANNELS.openPromptAttachments,
				handle: async (event, request: unknown) => {
					const validatedRequest = validateOpenPromptAttachmentsRequest(request);
					const cwd = await options.host.resolveReviewWorkspaceCwd(validatedRequest);
					const browserWindow = BrowserWindow.fromWebContents(event.sender);
					const dialogOptions: OpenDialogOptions = {
						properties: ["openFile", "multiSelections"],
						...(cwd ? { defaultPath: cwd } : {}),
					};
					const result = browserWindow
						? await dialog.showOpenDialog(browserWindow, dialogOptions)
						: await dialog.showOpenDialog(dialogOptions);
					if (result.canceled) {
						return { attachments: [], errors: [] };
					}
					return prepareDesktopPromptAttachments(
						result.filePaths.map((filePath) => ({ type: "path", path: filePath })),
						getPreparePromptAttachmentOptions(options.promptAttachmentsDir),
					);
				},
			},
		],
	};
}

export function createPreviewBridgeGroup(options: DesktopPreviewBridgeGroupOptions): DesktopBridgeGroupDescriptor {
	const previewFilePaths = new Set<string>();

	return {
		commands: [
			{
				channel: IPC_CHANNELS.getReviewSnapshot,
				handle: async (_event, request: unknown) => {
					const reviewRequest = validateReviewSnapshotRequest(request);
					const cwd = await options.host.resolveReviewWorkspaceCwd(reviewRequest);
					return createGitReviewSnapshot(cwd);
				},
			},
			{
				channel: IPC_CHANNELS.openPreviewFiles,
				handle: async (event, request: unknown) => {
					const previewRequest = validateReviewSnapshotRequest(request);
					const cwd = await options.host.resolveReviewWorkspaceCwd(previewRequest);
					const browserWindow = BrowserWindow.fromWebContents(event.sender);
					const dialogOptions: OpenDialogOptions = {
						properties: ["openFile", "multiSelections"],
						...(cwd ? { defaultPath: cwd } : {}),
					};
					const result = browserWindow
						? await dialog.showOpenDialog(browserWindow, dialogOptions)
						: await dialog.showOpenDialog(dialogOptions);
					if (result.canceled) {
						return [];
					}

					for (const filePath of result.filePaths) {
						previewFilePaths.add(filePath);
					}
					return Promise.all(result.filePaths.map((filePath) => readDesktopPreviewFile(filePath)));
				},
			},
			{
				channel: IPC_CHANNELS.openWorkspacePreviewFile,
				handle: async (_event, request: unknown) => {
					const previewRequest = validateWorkspacePreviewFileRequest(request);
					const cwd = await options.host.resolveReviewWorkspaceCwd(previewRequest);
					const file = await readWorkspacePreviewFile(cwd, previewRequest.path);
					if (!file.errorMessage) {
						previewFilePaths.add(file.path);
					}
					return file;
				},
			},
			{
				channel: IPC_CHANNELS.listWorkspaceFiles,
				handle: async (_event, request: unknown) => {
					const listRequest = validateWorkspaceFileListRequest(request);
					const cwd = await options.host.resolveReviewWorkspaceCwd(listRequest);
					return listWorkspaceFiles(cwd, { limit: listRequest.limit });
				},
			},
			{
				channel: IPC_CHANNELS.refreshPreviewFile,
				handle: async (_event, request: unknown) => {
					const { path } = validatePreviewFileRequest(request);
					if (!previewFilePaths.has(path)) {
						throw new TypeError("Invalid preview file request: file was not selected in this app session");
					}
					return readDesktopPreviewFile(path);
				},
			},
		],
	};
}

export function createSessionBridgeGroup(options: DesktopSessionBridgeGroupOptions): DesktopBridgeGroupDescriptor {
	return {
		commands: [
			{
				channel: IPC_CHANNELS.getWorkspaceOverview,
				handle: async () => {
					const [overview, settings] = await Promise.all([
						options.host.getWorkspaceOverview(),
						readDesktopSettings({
							instructionStore: options.instructionStore,
							settingsStore: options.settingsStore,
						}),
					]);
					return {
						...overview,
						settings,
					};
				},
			},
			{
				channel: IPC_CHANNELS.getSnapshot,
				handle: async (_event, sessionId: unknown) => options.host.getSnapshot(validateSessionId(sessionId)),
			},
			{
				channel: IPC_CHANNELS.getRuntimeCatalog,
				handle: async () => options.getRuntimeCatalog(),
			},
			{
				channel: IPC_CHANNELS.compact,
				handle: async (_event, request: unknown) => {
					const compactRequest = validateCompactRequest(request);
					return options.host.compact(compactRequest.sessionId, compactRequest.customInstructions);
				},
			},
			{
				channel: IPC_CHANNELS.updateSessionProfile,
				handle: async (_event, request: unknown) =>
					options.host.updateSessionProfile(validateSessionProfileUpdateRequest(request)),
			},
			{
				channel: IPC_CHANNELS.setSessionMode,
				handle: async (_event, request: unknown) =>
					options.host.setSessionMode(validateSessionModeUpdateRequest(request)),
			},
			{
				channel: IPC_CHANNELS.consumeProposedPlan,
				handle: async (_event, request: unknown) =>
					options.host.consumeProposedPlan(validateConsumeProposedPlanRequest(request)),
			},
			{
				channel: IPC_CHANNELS.executePlan,
				handle: async (_event, request: unknown) => options.host.executePlan(validateExecutePlanRequest(request)),
			},
			{
				channel: IPC_CHANNELS.abort,
				handle: async (_event, sessionId: unknown) => options.host.abort(validateSessionId(sessionId)),
			},
		],
	};
}
