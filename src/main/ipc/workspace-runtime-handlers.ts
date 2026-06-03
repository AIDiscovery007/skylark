import { randomUUID } from "node:crypto";
import type { MessagePortMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import type {
	DesktopProjectSummary,
	DesktopWorkspace,
	DesktopWorkspacePaneControlOwner,
	DesktopWorkspacePaneDefinition,
	DesktopWorkspacePaneRole,
	DesktopWorkspacePaneSnapshotSummary,
	DesktopWorkspaceRuntimeCaptureRequest,
	DesktopWorkspaceRuntimeCaptureResult,
	DesktopWorkspaceRuntimeEvent,
	DesktopWorkspaceRuntimeSummary,
	DesktopWorkspaceRuntimeWorkspace,
} from "../../shared/types.ts";
import type {
	ContextHarvester,
	PaneSnapshot,
	PaneSnapshotSummary,
	WorkspaceContextSnapshot,
} from "../context/context-harvester.ts";
import type { RuntimeAuditEvent, RuntimePermissionGate } from "../runtime-permissions/runtime-permission-gate.ts";
import type { DesktopProjectStore } from "../storage/project-store.ts";
import { createDebugWorkspaceInputFromProject } from "../workspace/debug-workspace.ts";
import type {
	WorkspaceRuntimeOrchestrator,
	WorkspaceRuntimeState,
} from "../workspace/workspace-runtime-orchestrator.ts";
import type { DesktopWorkspaceStore } from "../workspace/workspace-store.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import {
	validateWorkspaceRuntimeCaptureRequest,
	validateWorkspaceRuntimeCreateDebugRequest,
	validateWorkspaceRuntimeId,
	validateWorkspaceRuntimePaneControlRequest,
	validateWorkspaceRuntimePaneTextRequest,
} from "./validate-ipc.ts";

export interface WorkspaceRuntimeHandlerServices {
	contextHarvester: Pick<ContextHarvester, "captureWorkspaceContext" | "listPaneSnapshots">;
	runtimePermissionGate: Pick<RuntimePermissionGate, "executeRuntimeActionWithPermission" | "recordRuntimeAuditEvent">;
	workspaceRuntime: Pick<
		WorkspaceRuntimeOrchestrator,
		"archiveWorkspaceRuntime" | "getWorkspaceRuntimeState" | "openWorkspace" | "pauseWorkspace" | "resumeWorkspace"
	>;
	workspaceStore: Pick<
		DesktopWorkspaceStore,
		"createWorkspace" | "getWorkspace" | "listWorkspaces" | "updateWorkspace"
	>;
}

export interface WorkspaceRuntimeBridgeGroupOptions {
	projectStore: Pick<DesktopProjectStore, "get">;
	services: WorkspaceRuntimeHandlerServices;
}

function toRuntimeWorkspace(workspace: DesktopWorkspace): DesktopWorkspaceRuntimeWorkspace {
	const { tmuxSessionName, tmuxSocketPath, ...runtimeWorkspace } = workspace;
	void tmuxSessionName;
	void tmuxSocketPath;
	return runtimeWorkspace;
}

function toPaneSnapshotSummary(snapshot: PaneSnapshot | PaneSnapshotSummary): DesktopWorkspacePaneSnapshotSummary {
	return {
		id: snapshot.id,
		workspaceId: snapshot.workspaceId,
		paneId: snapshot.paneId,
		...(snapshot.paneRole ? { paneRole: snapshot.paneRole } : {}),
		capturedAt: snapshot.capturedAt,
		lineCount: snapshot.lineCount,
		redactions: snapshot.redactions,
		extractedBlocks: snapshot.extractedBlocks,
		...(snapshot.reason ? { reason: snapshot.reason } : {}),
	};
}

function toWorkspaceRuntimeSummary(input: {
	latestSnapshots: PaneSnapshotSummary[];
	runtimeState: WorkspaceRuntimeState;
	workspace: DesktopWorkspace;
}): DesktopWorkspaceRuntimeSummary {
	return {
		workspace: toRuntimeWorkspace(input.workspace),
		runtimeStatus: input.runtimeState.status,
		tmuxAvailable: input.runtimeState.tmuxAvailable,
		panes: input.runtimeState.panes,
		latestSnapshots: input.latestSnapshots.map(toPaneSnapshotSummary),
		...(input.runtimeState.errorMessage ? { errorMessage: input.runtimeState.errorMessage } : {}),
	};
}

function toCaptureInput(request: DesktopWorkspaceRuntimeCaptureRequest): {
	workspaceId: string;
	roles?: DesktopWorkspacePaneRole[];
	linesPerPane?: number;
	reason?: string;
} {
	return {
		workspaceId: request.workspaceId,
		...(request.roles ? { roles: request.roles } : {}),
		...(request.linesPerPane === undefined ? {} : { linesPerPane: request.linesPerPane }),
		...(request.reason ? { reason: request.reason } : {}),
	};
}

function toCaptureResult(result: WorkspaceContextSnapshot): DesktopWorkspaceRuntimeCaptureResult {
	return {
		workspaceId: result.workspaceId,
		capturedAt: result.capturedAt,
		snapshots: result.snapshots.map(toPaneSnapshotSummary),
		combinedText: result.combinedText,
		failures: result.failures,
	};
}

function createUserPaneAuditEvent(input: {
	actionType: "return-pane-control" | "takeover-pane";
	paneRole: DesktopWorkspacePaneRole;
	workspaceId: string;
}): RuntimeAuditEvent {
	const timestamp = new Date().toISOString();
	return {
		id: randomUUID(),
		workspaceId: input.workspaceId,
		actionType: input.actionType,
		requestedBy: "user",
		riskLevel: "low",
		paneRole: input.paneRole,
		payloadPreview: input.actionType,
		decision: "auto-allowed",
		resultStatus: "executed",
		requestedAt: timestamp,
		decidedAt: timestamp,
		completedAt: timestamp,
	};
}

export function createWorkspaceRuntimeBridgeGroup(
	options: WorkspaceRuntimeBridgeGroupOptions,
): DesktopBridgeGroupDescriptor {
	const ports = new Set<MessagePortMain>();
	const { contextHarvester, runtimePermissionGate, workspaceRuntime, workspaceStore } = options.services;

	const publish = (event: DesktopWorkspaceRuntimeEvent): void => {
		for (const port of ports) {
			port.postMessage(event);
		}
	};

	const readWorkspaceRuntimeSummary = async (workspaceId: string): Promise<DesktopWorkspaceRuntimeSummary> => {
		const workspace = await workspaceStore.getWorkspace(workspaceId);
		if (!workspace) {
			throw new Error(`Workspace '${workspaceId}' does not exist.`);
		}
		const [runtimeState, latestSnapshots] = await Promise.all([
			workspaceRuntime.getWorkspaceRuntimeState(workspaceId),
			contextHarvester.listPaneSnapshots(workspaceId),
		]);
		return toWorkspaceRuntimeSummary({ workspace, runtimeState, latestSnapshots });
	};

	const publishRuntimeUpdate = async (workspaceId: string): Promise<DesktopWorkspaceRuntimeSummary> => {
		const summary = await readWorkspaceRuntimeSummary(workspaceId);
		publish({
			type: "runtime_updated",
			summary,
			updatedAt: new Date().toISOString(),
		});
		return summary;
	};

	const publishAuditRecorded = (
		workspaceId: string,
		actionType: "return-pane-control" | "send-text" | "takeover-pane",
		recordedAt: string,
	): void => {
		publish({
			type: "audit_recorded",
			workspaceId,
			actionType,
			recordedAt,
		});
	};

	const captureWorkspaceContext = async (
		request: DesktopWorkspaceRuntimeCaptureRequest,
	): Promise<DesktopWorkspaceRuntimeCaptureResult> => {
		const result = toCaptureResult(await contextHarvester.captureWorkspaceContext(toCaptureInput(request)));
		publish({
			type: "snapshot_created",
			workspaceId: result.workspaceId,
			capturedAt: result.capturedAt,
			snapshots: result.snapshots,
		});
		return result;
	};

	const setPaneControlOwner = async (
		workspaceId: string,
		role: DesktopWorkspacePaneRole,
		controlOwner: DesktopWorkspacePaneControlOwner,
	): Promise<void> => {
		const workspace = await workspaceStore.getWorkspace(workspaceId);
		if (!workspace) {
			throw new Error(`Workspace '${workspaceId}' does not exist.`);
		}
		let matched = false;
		const paneDefinitions: DesktopWorkspacePaneDefinition[] = workspace.paneDefinitions.map((paneDefinition) => {
			if (paneDefinition.role !== role) {
				return paneDefinition;
			}
			matched = true;
			return {
				...paneDefinition,
				controlOwner,
			};
		});
		if (!matched) {
			throw new Error(`Workspace pane '${role}' does not exist.`);
		}
		const updatedWorkspace = await workspaceStore.updateWorkspace(workspaceId, { paneDefinitions });
		if (!updatedWorkspace) {
			throw new Error(`Workspace '${workspaceId}' does not exist.`);
		}
	};

	const recordUserPaneAuditEvent = async (input: {
		actionType: "return-pane-control" | "takeover-pane";
		paneRole: DesktopWorkspacePaneRole;
		workspaceId: string;
	}): Promise<RuntimeAuditEvent> => {
		const auditEvent = createUserPaneAuditEvent(input);
		await runtimePermissionGate.recordRuntimeAuditEvent(auditEvent);
		publishAuditRecorded(input.workspaceId, input.actionType, auditEvent.completedAt);
		return auditEvent;
	};

	const createDebugWorkspaceRuntime = async (request: unknown): Promise<DesktopWorkspaceRuntimeSummary> => {
		const validatedRequest = validateWorkspaceRuntimeCreateDebugRequest(request);
		let project: DesktopProjectSummary | null = null;
		if (validatedRequest.projectId) {
			project = await options.projectStore.get(validatedRequest.projectId);
			if (!project) {
				throw new Error(`Project '${validatedRequest.projectId}' does not exist.`);
			}
		}
		const repoPath = validatedRequest.repoPath ?? project?.cwd;
		if (!repoPath) {
			throw new Error("Debug workspace requires a project or repo path.");
		}
		const workspaceInput = await createDebugWorkspaceInputFromProject({
			...(validatedRequest.issue ? { issue: validatedRequest.issue } : {}),
			...(validatedRequest.projectId ? { projectId: validatedRequest.projectId } : {}),
			repoPath,
			...(validatedRequest.taskTitle ? { taskTitle: validatedRequest.taskTitle } : {}),
		});
		const workspace = await workspaceStore.createWorkspace(workspaceInput);
		await workspaceStore.updateWorkspace(workspace.id, { paneDefinitions: workspaceInput.paneDefinitions });
		await workspaceRuntime.openWorkspace(workspace.id);
		return publishRuntimeUpdate(workspace.id);
	};

	return {
		commands: [
			{
				channel: IPC_CHANNELS.listWorkspaceRuntimes,
				handle: async () => {
					const workspaces = await workspaceStore.listWorkspaces();
					return Promise.all(workspaces.map((workspace) => readWorkspaceRuntimeSummary(workspace.id)));
				},
			},
			{
				channel: IPC_CHANNELS.createDebugWorkspaceRuntime,
				handle: async (_event, request) => createDebugWorkspaceRuntime(request),
			},
			{
				channel: IPC_CHANNELS.openWorkspaceRuntime,
				handle: async (_event, workspaceId) => {
					const validatedWorkspaceId = validateWorkspaceRuntimeId(workspaceId);
					await workspaceRuntime.openWorkspace(validatedWorkspaceId);
					return publishRuntimeUpdate(validatedWorkspaceId);
				},
			},
			{
				channel: IPC_CHANNELS.pauseWorkspaceRuntime,
				handle: async (_event, workspaceId) => {
					const validatedWorkspaceId = validateWorkspaceRuntimeId(workspaceId);
					await workspaceRuntime.pauseWorkspace(validatedWorkspaceId);
					return publishRuntimeUpdate(validatedWorkspaceId);
				},
			},
			{
				channel: IPC_CHANNELS.resumeWorkspaceRuntime,
				handle: async (_event, workspaceId) => {
					const validatedWorkspaceId = validateWorkspaceRuntimeId(workspaceId);
					await workspaceRuntime.resumeWorkspace(validatedWorkspaceId);
					return publishRuntimeUpdate(validatedWorkspaceId);
				},
			},
			{
				channel: IPC_CHANNELS.archiveWorkspaceRuntime,
				handle: async (_event, workspaceId) => {
					const validatedWorkspaceId = validateWorkspaceRuntimeId(workspaceId);
					await workspaceRuntime.archiveWorkspaceRuntime(validatedWorkspaceId);
					return publishRuntimeUpdate(validatedWorkspaceId);
				},
			},
			{
				channel: IPC_CHANNELS.captureWorkspaceRuntimeContext,
				handle: async (_event, request) => captureWorkspaceContext(validateWorkspaceRuntimeCaptureRequest(request)),
			},
			{
				channel: IPC_CHANNELS.takeOverWorkspaceRuntimePane,
				handle: async (_event, request) => {
					const validatedRequest = validateWorkspaceRuntimePaneControlRequest(request);
					await setPaneControlOwner(validatedRequest.workspaceId, validatedRequest.role, "user");
					await recordUserPaneAuditEvent({
						actionType: "takeover-pane",
						paneRole: validatedRequest.role,
						workspaceId: validatedRequest.workspaceId,
					});
					return publishRuntimeUpdate(validatedRequest.workspaceId);
				},
			},
			{
				channel: IPC_CHANNELS.sendWorkspaceRuntimePaneText,
				handle: async (_event, request) => {
					const validatedRequest = validateWorkspaceRuntimePaneTextRequest(request);
					const result = await runtimePermissionGate.executeRuntimeActionWithPermission({
						actionType: "send-text",
						paneRole: validatedRequest.role,
						...(validatedRequest.pressEnter === undefined ? {} : { pressEnter: validatedRequest.pressEnter }),
						reason: "user takeover pane input",
						requestedBy: "user",
						riskLevel: "low",
						text: validatedRequest.text,
						workspaceId: validatedRequest.workspaceId,
					});
					publishAuditRecorded(validatedRequest.workspaceId, "send-text", result.auditEvent.completedAt);
					return publishRuntimeUpdate(validatedRequest.workspaceId);
				},
			},
			{
				channel: IPC_CHANNELS.returnWorkspaceRuntimePaneControl,
				handle: async (_event, request) => {
					const validatedRequest = validateWorkspaceRuntimePaneControlRequest(request);
					await setPaneControlOwner(validatedRequest.workspaceId, validatedRequest.role, "agent");
					await recordUserPaneAuditEvent({
						actionType: "return-pane-control",
						paneRole: validatedRequest.role,
						workspaceId: validatedRequest.workspaceId,
					});
					await publishRuntimeUpdate(validatedRequest.workspaceId);
					return captureWorkspaceContext({
						workspaceId: validatedRequest.workspaceId,
						roles: [validatedRequest.role],
						reason: "return workspace pane control",
					});
				},
			},
		],
		streams: [
			{
				channel: IPC_CHANNELS.openWorkspaceRuntimeStream,
				open: (port) => {
					ports.add(port);
					port.start();
					port.on("close", () => {
						ports.delete(port);
					});
				},
			},
		],
	};
}
