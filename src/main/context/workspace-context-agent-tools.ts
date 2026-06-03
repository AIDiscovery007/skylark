import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { DesktopWorkspace, DesktopWorkspacePaneRole } from "../../shared/types.ts";
import type { RuntimeActionResult, RuntimePermissionGate } from "../runtime-permissions/runtime-permission-gate.ts";
import { createDebugWorkspaceInputFromProject } from "../workspace/debug-workspace.ts";
import type { WorkspaceRuntimeState } from "../workspace/workspace-runtime-orchestrator.ts";
import type { DesktopWorkspaceCreateInput, DesktopWorkspaceStore } from "../workspace/workspace-store.ts";
import type {
	ContextHarvester,
	PaneSnapshot,
	PaneSnapshotSummary,
	RedactionCount,
	WorkspaceContextSnapshot,
} from "./context-harvester.ts";

const LATEST_SNAPSHOT_LIMIT = 5;
const MAX_PANE_CONTEXT_CHARS = 60_000;
const MAX_WORKSPACE_CONTEXT_CHARS = 120_000;
const DEFAULT_WORKSPACE_RUNTIME_TASK_TITLE = "Workspace";
const GENERIC_SESSION_TITLES = new Set(["", "New Session"]);

const paneRoleSchema = Type.Union([
	Type.Literal("agent"),
	Type.Literal("shell"),
	Type.Literal("dev-server"),
	Type.Literal("test"),
	Type.Literal("logs"),
]);

const listWorkspacePanesSchema = Type.Object(
	{
		workspaceId: Type.Optional(
			Type.String({
				minLength: 1,
				description: "App-owned workspace id to inspect. Omit to use the current session workspace runtime.",
			}),
		),
	},
	{ additionalProperties: false },
);

const workspaceRuntimePrepareSchema = Type.Object(
	{
		taskTitle: Type.Optional(Type.String({ description: "Short title for the current agent task." })),
	},
	{ additionalProperties: false },
);

const workspaceRuntimeStatusSchema = Type.Object(
	{
		workspaceId: Type.Optional(
			Type.String({
				minLength: 1,
				description: "App-owned workspace id to inspect. Omit to use the current session workspace runtime.",
			}),
		),
	},
	{ additionalProperties: false },
);

const workspaceRuntimeControlSchema = Type.Object(
	{
		workspaceId: Type.Optional(
			Type.String({
				minLength: 1,
				description: "App-owned workspace id to control. Omit to use the current session workspace runtime.",
			}),
		),
		reason: Type.Optional(Type.String({ description: "Why this workspace runtime action is needed." })),
	},
	{ additionalProperties: false },
);

const workspaceRuntimeSendTextSchema = Type.Object(
	{
		workspaceId: Type.Optional(
			Type.String({
				minLength: 1,
				description: "App-owned workspace id to control. Omit to use the current session workspace runtime.",
			}),
		),
		paneRole: paneRoleSchema,
		paneId: Type.Optional(Type.String({ minLength: 1, description: "Optional pane id guard, for example %1." })),
		text: Type.String({ minLength: 1, description: "Literal text to send to the pane." }),
		pressEnter: Type.Optional(Type.Boolean({ description: "Whether to press Enter after sending the text." })),
		reason: Type.Optional(Type.String({ description: "Why this pane input is needed." })),
	},
	{ additionalProperties: false },
);

const workspaceRuntimePaneControlSchema = Type.Object(
	{
		workspaceId: Type.Optional(
			Type.String({
				minLength: 1,
				description: "App-owned workspace id to control. Omit to use the current session workspace runtime.",
			}),
		),
		paneRole: paneRoleSchema,
		paneId: Type.Optional(Type.String({ minLength: 1, description: "Optional pane id guard, for example %1." })),
		reason: Type.Optional(Type.String({ description: "Why this pane control action is needed." })),
	},
	{ additionalProperties: false },
);

const capturePaneContextSchema = Type.Object(
	{
		workspaceId: Type.Optional(
			Type.String({
				minLength: 1,
				description: "App-owned workspace id to inspect. Omit to use the current session workspace runtime.",
			}),
		),
		paneRole: Type.Optional(paneRoleSchema),
		paneId: Type.Optional(Type.String({ minLength: 1, description: "tmux pane id, for example %1." })),
		lines: Type.Optional(Type.Number({ minimum: 1, description: "Maximum recent lines to capture." })),
		reason: Type.Optional(Type.String({ description: "Why the terminal context is needed." })),
	},
	{ additionalProperties: false },
);

const captureWorkspaceContextSchema = Type.Object(
	{
		workspaceId: Type.Optional(
			Type.String({
				minLength: 1,
				description: "App-owned workspace id to inspect. Omit to use the current session workspace runtime.",
			}),
		),
		roles: Type.Optional(Type.Array(paneRoleSchema, { minItems: 1 })),
		linesPerPane: Type.Optional(Type.Number({ minimum: 1, description: "Maximum recent lines per pane." })),
		reason: Type.Optional(Type.String({ description: "Why the workspace terminal context is needed." })),
	},
	{ additionalProperties: false },
);

const latestContextSummarySchema = Type.Object(
	{
		workspaceId: Type.Optional(
			Type.String({
				minLength: 1,
				description: "App-owned workspace id to inspect. Omit to use the current session workspace runtime.",
			}),
		),
	},
	{ additionalProperties: false },
);

type ListWorkspacePanesInput = Static<typeof listWorkspacePanesSchema>;
type WorkspaceRuntimePrepareInput = Static<typeof workspaceRuntimePrepareSchema>;
type WorkspaceRuntimeStatusInput = Static<typeof workspaceRuntimeStatusSchema>;
type WorkspaceRuntimeControlInput = Static<typeof workspaceRuntimeControlSchema>;
type WorkspaceRuntimeSendTextInput = Static<typeof workspaceRuntimeSendTextSchema>;
type WorkspaceRuntimePaneControlInput = Static<typeof workspaceRuntimePaneControlSchema>;
type CapturePaneContextInput = Static<typeof capturePaneContextSchema>;
type CaptureWorkspaceContextInput = Static<typeof captureWorkspaceContextSchema>;
type LatestContextSummaryInput = Static<typeof latestContextSummarySchema>;

export const WORKSPACE_CONTEXT_TOOL_NAMES = {
	prepare: "workspace_runtime_prepare",
	status: "workspace_runtime_status",
	resume: "workspace_runtime_resume",
	pause: "workspace_runtime_pause",
	archive: "workspace_runtime_archive",
	sendText: "workspace_runtime_send_text",
	restartPane: "workspace_runtime_restart_pane",
	stopPane: "workspace_runtime_stop_pane",
	listPanes: "workspace_runtime_list_panes",
	capturePane: "workspace_runtime_capture_pane_context",
	captureWorkspace: "workspace_runtime_capture_context",
	latestSummary: "workspace_runtime_latest_context_summary",
} as const;

type WorkspaceContextToolName = (typeof WORKSPACE_CONTEXT_TOOL_NAMES)[keyof typeof WORKSPACE_CONTEXT_TOOL_NAMES];
// ToolDefinition is invariant in its parameter schema through render callbacks; the exported heterogeneous list must erase
// the per-tool parameter type so callers can handle it as one tool array.
type WorkspaceRuntimeToolDefinition = ToolDefinition<any, WorkspaceContextToolDetails>;
type WorkspaceContextOperation =
	| "archive_workspace_runtime"
	| "capture_pane_context"
	| "capture_workspace_context"
	| "pause_workspace_runtime"
	| "prepare_workspace_runtime"
	| "get_latest_context_summary"
	| "list_workspace_panes"
	| "restart_workspace_pane"
	| "resume_workspace_runtime"
	| "send_workspace_pane_text"
	| "status_workspace_runtime"
	| "stop_workspace_pane";

export interface WorkspaceContextToolAuditEvent {
	type: "workspace_terminal_context";
	operation: WorkspaceContextOperation;
	toolName: WorkspaceContextToolName;
	workspaceId: string;
	capturedAt: string;
	paneRole?: DesktopWorkspacePaneRole;
	paneId?: string;
	reason?: string;
	snapshotIds: string[];
}

export interface WorkspaceContextToolDetails {
	auditEvent: WorkspaceContextToolAuditEvent;
	runtimeStatus?: WorkspaceRuntimeState["status"];
	snapshotIds: string[];
	redactions: RedactionCount[];
	extractedBlockCount: number;
	truncated: boolean;
}

export interface WorkspaceContextToolDependencies {
	currentWorkspace?: {
		cwd: string;
		piSessionId?: string;
		piSessionPath?: string;
		sessionTitle?: string;
	};
	workspaceRuntime: {
		archiveWorkspaceRuntime?(workspaceId: string): Promise<void>;
		getWorkspaceRuntimeState(workspaceId: string): Promise<WorkspaceRuntimeState>;
		openWorkspace?(workspaceId: string): Promise<WorkspaceRuntimeState>;
		pauseWorkspace?(workspaceId: string): Promise<void>;
		restartPane?(workspaceId: string, role: DesktopWorkspacePaneRole): Promise<WorkspaceRuntimeState>;
		resumeWorkspace?(workspaceId: string): Promise<WorkspaceRuntimeState>;
		stopPane?(workspaceId: string, role: DesktopWorkspacePaneRole): Promise<WorkspaceRuntimeState>;
	};
	workspaceStore?: Pick<DesktopWorkspaceStore, "createWorkspace" | "listWorkspaces" | "updateWorkspace">;
	runtimePermissionGate?: Pick<RuntimePermissionGate, "executeRuntimeActionWithPermission">;
	contextHarvester: Pick<
		ContextHarvester,
		"captureWorkspaceContext" | "captureWorkspacePane" | "getPaneSnapshot" | "listPaneSnapshots"
	>;
	now?: () => Date;
}

interface LimitedText {
	text: string;
	truncated: boolean;
	originalChars: number;
	maxChars: number;
}

function toTimestamp(now: () => Date): string {
	return now().toISOString();
}

function limitText(text: string, maxChars: number): LimitedText {
	if (text.length <= maxChars) {
		return { text, truncated: false, originalChars: text.length, maxChars };
	}
	const omittedChars = text.length - maxChars;
	return {
		text: `${text.slice(0, maxChars)}\n\n[truncated: omitted ${omittedChars} chars]`,
		truncated: true,
		originalChars: text.length,
		maxChars,
	};
}

function sumRedactions(snapshots: readonly PaneSnapshot[]): RedactionCount[] {
	const counts = new Map<string, number>();
	for (const snapshot of snapshots) {
		for (const redaction of snapshot.redactions) {
			counts.set(redaction.kind, (counts.get(redaction.kind) ?? 0) + redaction.count);
		}
	}
	return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
}

function countExtractedBlocks(snapshots: readonly PaneSnapshot[]): number {
	return snapshots.reduce((count, snapshot) => count + snapshot.extractedBlocks.length, 0);
}

function summarizeSnapshot(snapshot: PaneSnapshot): PaneSnapshotSummary {
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

function buildAuditEvent(input: {
	operation: WorkspaceContextOperation;
	toolName: WorkspaceContextToolName;
	workspaceId: string;
	capturedAt: string;
	snapshotIds?: readonly string[];
	paneRole?: DesktopWorkspacePaneRole;
	paneId?: string;
	reason?: string;
}): WorkspaceContextToolAuditEvent {
	return {
		type: "workspace_terminal_context",
		operation: input.operation,
		toolName: input.toolName,
		workspaceId: input.workspaceId,
		capturedAt: input.capturedAt,
		...(input.paneRole ? { paneRole: input.paneRole } : {}),
		...(input.paneId ? { paneId: input.paneId } : {}),
		...(input.reason ? { reason: input.reason } : {}),
		snapshotIds: [...(input.snapshotIds ?? [])],
	};
}

function createToolResult(
	payload: unknown,
	details: WorkspaceContextToolDetails,
): AgentToolResult<WorkspaceContextToolDetails> {
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		details,
	};
}

function createUnavailableResult(input: {
	toolName: WorkspaceContextToolName;
	operation: WorkspaceContextOperation;
	runtimeState: WorkspaceRuntimeState;
	latestSnapshots: readonly PaneSnapshotSummary[];
	capturedAt: string;
	reason?: string;
}): AgentToolResult<WorkspaceContextToolDetails> {
	const snapshotIds = input.latestSnapshots.map((snapshot) => snapshot.id);
	return createToolResult(
		{
			status: "runtime_unavailable",
			workspaceId: input.runtimeState.workspaceId,
			runtimeStatus: input.runtimeState.status,
			tmuxAvailable: input.runtimeState.tmuxAvailable,
			message:
				input.runtimeState.errorMessage ??
				"Workspace runtime is not running. Latest redacted snapshots are available if present.",
			panes: input.runtimeState.panes,
			latestSnapshots: input.latestSnapshots,
		},
		{
			auditEvent: buildAuditEvent({
				capturedAt: input.capturedAt,
				operation: input.operation,
				reason: input.reason,
				snapshotIds,
				toolName: input.toolName,
				workspaceId: input.runtimeState.workspaceId,
			}),
			extractedBlockCount: input.latestSnapshots.reduce(
				(count, snapshot) => count + snapshot.extractedBlocks.length,
				0,
			),
			redactions: [],
			runtimeStatus: input.runtimeState.status,
			snapshotIds,
			truncated: false,
		},
	);
}

async function listLatestSnapshots(
	contextHarvester: WorkspaceContextToolDependencies["contextHarvester"],
	workspaceId: string,
): Promise<PaneSnapshotSummary[]> {
	return (await contextHarvester.listPaneSnapshots(workspaceId)).slice(0, LATEST_SNAPSHOT_LIMIT);
}

function ensureWorkspaceStore(
	dependencies: WorkspaceContextToolDependencies,
): NonNullable<WorkspaceContextToolDependencies["workspaceStore"]> {
	if (!dependencies.workspaceStore) {
		throw new Error("Workspace runtime store is not available.");
	}
	return dependencies.workspaceStore;
}

function ensureRuntimePermissionGate(
	dependencies: WorkspaceContextToolDependencies,
): NonNullable<WorkspaceContextToolDependencies["runtimePermissionGate"]> {
	if (!dependencies.runtimePermissionGate) {
		throw new Error("Workspace runtime permission gate is not available.");
	}
	return dependencies.runtimePermissionGate;
}

function ensureCurrentWorkspaceContext(dependencies: WorkspaceContextToolDependencies) {
	const currentWorkspace = dependencies.currentWorkspace;
	if (!currentWorkspace?.cwd) {
		throw new Error("No current workspace context is available for workspace runtime tools.");
	}
	return currentWorkspace;
}

function isActiveWorkspace(workspace: DesktopWorkspace): boolean {
	return workspace.status !== "archived";
}

function matchesCurrentWorkspace(workspace: DesktopWorkspace, currentWorkspace: { cwd: string; piSessionId?: string }) {
	if (workspace.repoPath !== currentWorkspace.cwd && workspace.worktreePath !== currentWorkspace.cwd) {
		return false;
	}
	if (currentWorkspace.piSessionId && workspace.piSessionId !== currentWorkspace.piSessionId) {
		return false;
	}
	return isActiveWorkspace(workspace);
}

async function findCurrentWorkspace(
	dependencies: WorkspaceContextToolDependencies,
): Promise<DesktopWorkspace | undefined> {
	const workspaceStore = ensureWorkspaceStore(dependencies);
	const currentWorkspace = ensureCurrentWorkspaceContext(dependencies);
	const workspaces = await workspaceStore.listWorkspaces({ repoPath: currentWorkspace.cwd });
	return workspaces.find((workspace) => matchesCurrentWorkspace(workspace, currentWorkspace));
}

async function resolveWorkspaceId(
	dependencies: WorkspaceContextToolDependencies,
	workspaceId: string | undefined,
): Promise<string> {
	if (workspaceId) {
		return workspaceId;
	}
	const workspace = await findCurrentWorkspace(dependencies);
	if (!workspace) {
		throw new Error("No workspace runtime is prepared for this session. Call workspace_runtime_prepare first.");
	}
	return workspace.id;
}

function resolveTaskTitle(dependencies: WorkspaceContextToolDependencies, requestedTitle: string | undefined): string {
	const requested = requestedTitle?.trim();
	if (requested) {
		return requested;
	}
	const sessionTitle = dependencies.currentWorkspace?.sessionTitle?.trim() ?? "";
	if (!GENERIC_SESSION_TITLES.has(sessionTitle)) {
		return sessionTitle;
	}
	return DEFAULT_WORKSPACE_RUNTIME_TASK_TITLE;
}

async function createWorkspaceInput(
	dependencies: WorkspaceContextToolDependencies,
	params: WorkspaceRuntimePrepareInput,
): Promise<DesktopWorkspaceCreateInput> {
	const currentWorkspace = ensureCurrentWorkspaceContext(dependencies);
	const detected = await createDebugWorkspaceInputFromProject({
		repoPath: currentWorkspace.cwd,
		taskTitle: resolveTaskTitle(dependencies, params.taskTitle),
	});
	return {
		...detected,
		...(currentWorkspace.piSessionId ? { piSessionId: currentWorkspace.piSessionId } : {}),
		...(currentWorkspace.piSessionPath ? { piSessionPath: currentWorkspace.piSessionPath } : {}),
	};
}

function createRuntimeStatePayload(runtimeState: WorkspaceRuntimeState) {
	return {
		status: runtimeState.status,
		workspaceId: runtimeState.workspaceId,
		tmuxAvailable: runtimeState.tmuxAvailable,
		panes: runtimeState.panes,
		errorMessage: runtimeState.errorMessage,
	};
}

function isRuntimeCapturable(runtimeState: WorkspaceRuntimeState): boolean {
	return runtimeState.status === "running";
}

function createRuntimeActionToolResult(input: {
	actionResult?: RuntimeActionResult;
	capturedAt: string;
	operation: WorkspaceContextOperation;
	reason?: string;
	runtimeState: WorkspaceRuntimeState;
	toolName: WorkspaceContextToolName;
}): AgentToolResult<WorkspaceContextToolDetails> {
	return createToolResult(
		{
			...createRuntimeStatePayload(input.runtimeState),
			actionStatus: input.actionResult?.status ?? "executed",
			decision: input.actionResult?.decision.decision,
			message: input.actionResult?.message,
		},
		{
			auditEvent: buildAuditEvent({
				capturedAt: input.capturedAt,
				operation: input.operation,
				reason: input.reason,
				snapshotIds: [],
				toolName: input.toolName,
				workspaceId: input.runtimeState.workspaceId,
			}),
			extractedBlockCount: 0,
			redactions: [],
			runtimeStatus: input.runtimeState.status,
			snapshotIds: [],
			truncated: false,
		},
	);
}

function createPrepareWorkspaceRuntimeTool(
	dependencies: WorkspaceContextToolDependencies,
	now: () => Date,
): ToolDefinition<typeof workspaceRuntimePrepareSchema, WorkspaceContextToolDetails> {
	return {
		name: WORKSPACE_CONTEXT_TOOL_NAMES.prepare,
		label: "prepare workspace runtime",
		description: "Create or resume the current session workspace runtime for long-running agent work.",
		promptSnippet: "Prepare a workspace runtime before long-running shell, test, dev-server, or resumable work",
		promptGuidelines: [
			"Use workspace_runtime_prepare when a task needs shell execution, tests, dev servers, background logs, or resumable multi-step work.",
			"Do not create a workspace runtime for ordinary question answering.",
		],
		parameters: workspaceRuntimePrepareSchema,
		executionMode: "sequential",
		execute: async (_toolCallId, params: WorkspaceRuntimePrepareInput) => {
			const workspaceStore = ensureWorkspaceStore(dependencies);
			if (!dependencies.workspaceRuntime.openWorkspace) {
				throw new Error("Workspace runtime prepare is not available.");
			}
			const existingWorkspace = await findCurrentWorkspace(dependencies);
			const workspace =
				existingWorkspace ??
				(await workspaceStore.createWorkspace(await createWorkspaceInput(dependencies, params)));
			const runtimeState = await dependencies.workspaceRuntime.openWorkspace(workspace.id);
			return createRuntimeActionToolResult({
				capturedAt: toTimestamp(now),
				operation: "prepare_workspace_runtime",
				runtimeState,
				toolName: WORKSPACE_CONTEXT_TOOL_NAMES.prepare,
			});
		},
	};
}

function createWorkspaceRuntimeStatusTool(
	dependencies: WorkspaceContextToolDependencies,
	now: () => Date,
): ToolDefinition<typeof workspaceRuntimeStatusSchema, WorkspaceContextToolDetails> {
	return {
		name: WORKSPACE_CONTEXT_TOOL_NAMES.status,
		label: "workspace runtime status",
		description: "Return the current app-owned workspace runtime status without reading terminal scrollback.",
		promptSnippet: "Check workspace runtime status before controlling panes",
		promptGuidelines: [
			"Use workspace_runtime_status when you need the current workspace runtime id, pane roles, or runtime state.",
		],
		parameters: workspaceRuntimeStatusSchema,
		executionMode: "parallel",
		execute: async (_toolCallId, params: WorkspaceRuntimeStatusInput) => {
			const workspaceId = await resolveWorkspaceId(dependencies, params.workspaceId);
			const runtimeState = await dependencies.workspaceRuntime.getWorkspaceRuntimeState(workspaceId);
			return createRuntimeActionToolResult({
				capturedAt: toTimestamp(now),
				operation: "status_workspace_runtime",
				runtimeState,
				toolName: WORKSPACE_CONTEXT_TOOL_NAMES.status,
			});
		},
	};
}

function createWorkspaceRuntimeLifecycleTool(
	dependencies: WorkspaceContextToolDependencies,
	now: () => Date,
	input: {
		name: WorkspaceContextToolName;
		label: string;
		description: string;
		operation: WorkspaceContextOperation;
		actionType: "archive-workspace" | "pause-workspace" | "resume-workspace";
	},
): ToolDefinition<typeof workspaceRuntimeControlSchema, WorkspaceContextToolDetails> {
	return {
		name: input.name,
		label: input.label,
		description: input.description,
		promptSnippet: input.description,
		promptGuidelines: [
			"Use workspace runtime lifecycle tools only for app-owned runtimes tied to the current agent task.",
		],
		parameters: workspaceRuntimeControlSchema,
		executionMode: "sequential",
		execute: async (_toolCallId, params: WorkspaceRuntimeControlInput) => {
			const runtimePermissionGate = ensureRuntimePermissionGate(dependencies);
			const workspaceId = await resolveWorkspaceId(dependencies, params.workspaceId);
			const actionResult = await runtimePermissionGate.executeRuntimeActionWithPermission({
				actionType: input.actionType,
				...(params.reason ? { reason: params.reason } : {}),
				requestedBy: "agent",
				riskLevel: "low",
				workspaceId,
			});
			const runtimeState = await dependencies.workspaceRuntime.getWorkspaceRuntimeState(workspaceId);
			return createRuntimeActionToolResult({
				actionResult,
				capturedAt: toTimestamp(now),
				operation: input.operation,
				...(params.reason ? { reason: params.reason } : {}),
				runtimeState,
				toolName: input.name,
			});
		},
	};
}

function createWorkspaceRuntimeSendTextTool(
	dependencies: WorkspaceContextToolDependencies,
	now: () => Date,
): ToolDefinition<typeof workspaceRuntimeSendTextSchema, WorkspaceContextToolDetails> {
	return {
		name: WORKSPACE_CONTEXT_TOOL_NAMES.sendText,
		label: "send workspace pane text",
		description: "Send literal text to an agent-owned workspace runtime pane by semantic role.",
		promptSnippet: "Send text to an agent-owned workspace pane by role when continuing a runtime task",
		promptGuidelines: [
			"Prefer paneRole over paneId. Use paneId only as a guard after checking status.",
			"Do not write to user-controlled panes; ask in the main conversation for control to be returned first.",
		],
		parameters: workspaceRuntimeSendTextSchema,
		executionMode: "sequential",
		execute: async (_toolCallId, params: WorkspaceRuntimeSendTextInput) => {
			const runtimePermissionGate = ensureRuntimePermissionGate(dependencies);
			const workspaceId = await resolveWorkspaceId(dependencies, params.workspaceId);
			const actionResult = await runtimePermissionGate.executeRuntimeActionWithPermission({
				actionType: "send-text",
				paneRole: params.paneRole,
				...(params.paneId ? { paneId: params.paneId } : {}),
				...(params.pressEnter !== undefined ? { pressEnter: params.pressEnter } : {}),
				...(params.reason ? { reason: params.reason } : {}),
				requestedBy: "agent",
				riskLevel: "low",
				text: params.text,
				workspaceId,
			});
			const runtimeState = await dependencies.workspaceRuntime.getWorkspaceRuntimeState(workspaceId);
			return createRuntimeActionToolResult({
				actionResult,
				capturedAt: toTimestamp(now),
				operation: "send_workspace_pane_text",
				...(params.reason ? { reason: params.reason } : {}),
				runtimeState,
				toolName: WORKSPACE_CONTEXT_TOOL_NAMES.sendText,
			});
		},
	};
}

function createWorkspaceRuntimePaneActionTool(
	dependencies: WorkspaceContextToolDependencies,
	now: () => Date,
	input: {
		name: WorkspaceContextToolName;
		label: string;
		description: string;
		operation: WorkspaceContextOperation;
		actionType: "restart-pane" | "stop-pane";
	},
): ToolDefinition<typeof workspaceRuntimePaneControlSchema, WorkspaceContextToolDetails> {
	return {
		name: input.name,
		label: input.label,
		description: input.description,
		promptSnippet: input.description,
		promptGuidelines: [
			"Use pane role for workspace pane control. Pane id is only an optional guard.",
			"Do not control user-owned panes; ask in the main conversation for control to be returned first.",
		],
		parameters: workspaceRuntimePaneControlSchema,
		executionMode: "sequential",
		execute: async (_toolCallId, params: WorkspaceRuntimePaneControlInput) => {
			const runtimePermissionGate = ensureRuntimePermissionGate(dependencies);
			const workspaceId = await resolveWorkspaceId(dependencies, params.workspaceId);
			const actionResult = await runtimePermissionGate.executeRuntimeActionWithPermission({
				actionType: input.actionType,
				paneRole: params.paneRole,
				...(params.paneId ? { paneId: params.paneId } : {}),
				...(params.reason ? { reason: params.reason } : {}),
				requestedBy: "agent",
				riskLevel: "low",
				workspaceId,
			});
			const runtimeState = await dependencies.workspaceRuntime.getWorkspaceRuntimeState(workspaceId);
			return createRuntimeActionToolResult({
				actionResult,
				capturedAt: toTimestamp(now),
				operation: input.operation,
				...(params.reason ? { reason: params.reason } : {}),
				runtimeState,
				toolName: input.name,
			});
		},
	};
}

function createListWorkspacePanesTool(
	dependencies: WorkspaceContextToolDependencies,
	now: () => Date,
): ToolDefinition<typeof listWorkspacePanesSchema, WorkspaceContextToolDetails> {
	return {
		name: WORKSPACE_CONTEXT_TOOL_NAMES.listPanes,
		label: "list workspace panes",
		description: "List app-owned panes for a workspace runtime without reading terminal scrollback.",
		promptSnippet: "List app-owned workspace runtime panes before reading terminal context",
		promptGuidelines: [
			"Use workspace_runtime_list_panes before capturing terminal context when you need to inspect workspace runtime state.",
		],
		parameters: listWorkspacePanesSchema,
		executionMode: "parallel",
		execute: async (_toolCallId, params: ListWorkspacePanesInput) => {
			const workspaceId = await resolveWorkspaceId(dependencies, params.workspaceId);
			const runtimeState = await dependencies.workspaceRuntime.getWorkspaceRuntimeState(workspaceId);
			const capturedAt = toTimestamp(now);
			const latestSnapshots = await listLatestSnapshots(dependencies.contextHarvester, workspaceId);
			const snapshotIds = latestSnapshots.map((snapshot) => snapshot.id);
			return createToolResult(
				{
					status: runtimeState.status,
					workspaceId: runtimeState.workspaceId,
					tmuxAvailable: runtimeState.tmuxAvailable,
					panes: runtimeState.panes,
					latestSnapshots,
					errorMessage: runtimeState.errorMessage,
				},
				{
					auditEvent: buildAuditEvent({
						capturedAt,
						operation: "list_workspace_panes",
						snapshotIds,
						toolName: WORKSPACE_CONTEXT_TOOL_NAMES.listPanes,
						workspaceId: runtimeState.workspaceId,
					}),
					extractedBlockCount: latestSnapshots.reduce(
						(count, snapshot) => count + snapshot.extractedBlocks.length,
						0,
					),
					redactions: [],
					runtimeStatus: runtimeState.status,
					snapshotIds,
					truncated: false,
				},
			);
		},
	};
}

function createCapturePaneContextTool(
	dependencies: WorkspaceContextToolDependencies,
	now: () => Date,
): ToolDefinition<typeof capturePaneContextSchema, WorkspaceContextToolDetails> {
	return {
		name: WORKSPACE_CONTEXT_TOOL_NAMES.capturePane,
		label: "capture pane context",
		description:
			"Capture bounded, redacted terminal context from one app-owned workspace pane and persist a snapshot.",
		promptSnippet: "Capture redacted terminal context from one workspace pane when logs or tests are needed",
		promptGuidelines: [
			"Use workspace_runtime_capture_pane_context only when terminal output is needed; do not request more lines than necessary.",
			"Mention which pane context you used when it affects your answer.",
		],
		parameters: capturePaneContextSchema,
		executionMode: "parallel",
		execute: async (_toolCallId, params: CapturePaneContextInput) => {
			const workspaceId = await resolveWorkspaceId(dependencies, params.workspaceId);
			const runtimeState = await dependencies.workspaceRuntime.getWorkspaceRuntimeState(workspaceId);
			const capturedAt = toTimestamp(now);
			if (!isRuntimeCapturable(runtimeState)) {
				return createUnavailableResult({
					capturedAt,
					latestSnapshots: await listLatestSnapshots(dependencies.contextHarvester, workspaceId),
					operation: "capture_pane_context",
					reason: params.reason,
					runtimeState,
					toolName: WORKSPACE_CONTEXT_TOOL_NAMES.capturePane,
				});
			}

			const snapshot = await dependencies.contextHarvester.captureWorkspacePane({
				workspaceId,
				...(params.paneRole ? { paneRole: params.paneRole } : {}),
				...(params.paneId ? { paneId: params.paneId } : {}),
				...(params.lines ? { lines: params.lines } : {}),
				...(params.reason ? { reason: params.reason } : {}),
			});
			const limitedText = limitText(snapshot.text, MAX_PANE_CONTEXT_CHARS);
			return createToolResult(
				{
					status: "captured",
					workspaceId: snapshot.workspaceId,
					paneId: snapshot.paneId,
					paneRole: snapshot.paneRole,
					snapshotId: snapshot.id,
					capturedAt: snapshot.capturedAt,
					lineCount: snapshot.lineCount,
					text: limitedText.text,
					redactions: snapshot.redactions,
					extractedBlocks: snapshot.extractedBlocks,
					truncation: limitedText.truncated
						? { originalChars: limitedText.originalChars, maxChars: limitedText.maxChars }
						: undefined,
				},
				{
					auditEvent: buildAuditEvent({
						capturedAt: snapshot.capturedAt,
						operation: "capture_pane_context",
						paneId: snapshot.paneId,
						paneRole: snapshot.paneRole,
						reason: params.reason,
						snapshotIds: [snapshot.id],
						toolName: WORKSPACE_CONTEXT_TOOL_NAMES.capturePane,
						workspaceId: snapshot.workspaceId,
					}),
					extractedBlockCount: snapshot.extractedBlocks.length,
					redactions: snapshot.redactions,
					runtimeStatus: runtimeState.status,
					snapshotIds: [snapshot.id],
					truncated: limitedText.truncated,
				},
			);
		},
	};
}

function createCaptureWorkspaceContextTool(
	dependencies: WorkspaceContextToolDependencies,
	now: () => Date,
): ToolDefinition<typeof captureWorkspaceContextSchema, WorkspaceContextToolDetails> {
	return {
		name: WORKSPACE_CONTEXT_TOOL_NAMES.captureWorkspace,
		label: "capture workspace context",
		description:
			"Capture bounded, redacted terminal context from selected app-owned workspace panes and persist snapshots.",
		promptSnippet: "Capture redacted dev-server, test, or log context for the current workspace",
		promptGuidelines: [
			"Use workspace_runtime_capture_context for multi-pane debugging and keep roles scoped to the panes you need.",
			"Mention terminal context sources used when summarizing findings.",
		],
		parameters: captureWorkspaceContextSchema,
		executionMode: "parallel",
		execute: async (_toolCallId, params: CaptureWorkspaceContextInput) => {
			const workspaceId = await resolveWorkspaceId(dependencies, params.workspaceId);
			const runtimeState = await dependencies.workspaceRuntime.getWorkspaceRuntimeState(workspaceId);
			const capturedAt = toTimestamp(now);
			if (!isRuntimeCapturable(runtimeState)) {
				return createUnavailableResult({
					capturedAt,
					latestSnapshots: await listLatestSnapshots(dependencies.contextHarvester, workspaceId),
					operation: "capture_workspace_context",
					reason: params.reason,
					runtimeState,
					toolName: WORKSPACE_CONTEXT_TOOL_NAMES.captureWorkspace,
				});
			}

			const context = await dependencies.contextHarvester.captureWorkspaceContext({
				workspaceId,
				...(params.roles ? { roles: params.roles } : {}),
				...(params.linesPerPane ? { linesPerPane: params.linesPerPane } : {}),
				...(params.reason ? { reason: params.reason } : {}),
			});
			return createWorkspaceContextResult(context, params.reason, runtimeState.status);
		},
	};
}

function createWorkspaceContextResult(
	context: WorkspaceContextSnapshot,
	reason: string | undefined,
	runtimeStatus: WorkspaceRuntimeState["status"],
): AgentToolResult<WorkspaceContextToolDetails> {
	const limitedText = limitText(context.combinedText, MAX_WORKSPACE_CONTEXT_CHARS);
	const snapshotSummaries = context.snapshots.map(summarizeSnapshot);
	const snapshotIds = context.snapshots.map((snapshot) => snapshot.id);
	return createToolResult(
		{
			status: "captured",
			workspaceId: context.workspaceId,
			capturedAt: context.capturedAt,
			combinedText: limitedText.text,
			snapshots: snapshotSummaries,
			failures: context.failures,
			redactions: sumRedactions(context.snapshots),
			truncation: limitedText.truncated
				? { originalChars: limitedText.originalChars, maxChars: limitedText.maxChars }
				: undefined,
		},
		{
			auditEvent: buildAuditEvent({
				capturedAt: context.capturedAt,
				operation: "capture_workspace_context",
				reason,
				snapshotIds,
				toolName: WORKSPACE_CONTEXT_TOOL_NAMES.captureWorkspace,
				workspaceId: context.workspaceId,
			}),
			extractedBlockCount: countExtractedBlocks(context.snapshots),
			redactions: sumRedactions(context.snapshots),
			runtimeStatus,
			snapshotIds,
			truncated: limitedText.truncated,
		},
	);
}

function createLatestContextSummaryTool(
	dependencies: WorkspaceContextToolDependencies,
	now: () => Date,
): ToolDefinition<typeof latestContextSummarySchema, WorkspaceContextToolDetails> {
	return {
		name: WORKSPACE_CONTEXT_TOOL_NAMES.latestSummary,
		label: "latest context summary",
		description:
			"Return the latest redacted terminal snapshots and lightweight runtime summary for an app-owned workspace.",
		promptSnippet: "Get latest redacted terminal snapshot summaries without capturing new output",
		promptGuidelines: [
			"Use workspace_runtime_latest_context_summary before recapturing terminal output if recent snapshots may be enough.",
		],
		parameters: latestContextSummarySchema,
		executionMode: "parallel",
		execute: async (_toolCallId, params: LatestContextSummaryInput) => {
			const workspaceId = await resolveWorkspaceId(dependencies, params.workspaceId);
			const [runtimeState, latestSnapshots] = await Promise.all([
				dependencies.workspaceRuntime.getWorkspaceRuntimeState(workspaceId),
				listLatestSnapshots(dependencies.contextHarvester, workspaceId),
			]);
			const capturedAt = toTimestamp(now);
			const snapshotIds = latestSnapshots.map((snapshot) => snapshot.id);
			return createToolResult(
				{
					status: runtimeState.status,
					workspaceId: runtimeState.workspaceId,
					tmuxAvailable: runtimeState.tmuxAvailable,
					panes: runtimeState.panes,
					latestSnapshots,
					errorMessage: runtimeState.errorMessage,
				},
				{
					auditEvent: buildAuditEvent({
						capturedAt,
						operation: "get_latest_context_summary",
						snapshotIds,
						toolName: WORKSPACE_CONTEXT_TOOL_NAMES.latestSummary,
						workspaceId: runtimeState.workspaceId,
					}),
					extractedBlockCount: latestSnapshots.reduce(
						(count, snapshot) => count + snapshot.extractedBlocks.length,
						0,
					),
					redactions: [],
					runtimeStatus: runtimeState.status,
					snapshotIds,
					truncated: false,
				},
			);
		},
	};
}

export function createWorkspaceContextToolDefinitions(
	dependencies: WorkspaceContextToolDependencies,
): WorkspaceRuntimeToolDefinition[] {
	const now = dependencies.now ?? (() => new Date());
	return [
		createPrepareWorkspaceRuntimeTool(dependencies, now),
		createWorkspaceRuntimeStatusTool(dependencies, now),
		createWorkspaceRuntimeLifecycleTool(dependencies, now, {
			actionType: "resume-workspace",
			description: "Resume the current app-owned workspace runtime.",
			label: "resume workspace runtime",
			name: WORKSPACE_CONTEXT_TOOL_NAMES.resume,
			operation: "resume_workspace_runtime",
		}),
		createWorkspaceRuntimeLifecycleTool(dependencies, now, {
			actionType: "pause-workspace",
			description: "Pause the current app-owned workspace runtime.",
			label: "pause workspace runtime",
			name: WORKSPACE_CONTEXT_TOOL_NAMES.pause,
			operation: "pause_workspace_runtime",
		}),
		createWorkspaceRuntimeLifecycleTool(dependencies, now, {
			actionType: "archive-workspace",
			description: "Archive the current app-owned workspace runtime when it is no longer needed.",
			label: "archive workspace runtime",
			name: WORKSPACE_CONTEXT_TOOL_NAMES.archive,
			operation: "archive_workspace_runtime",
		}),
		createWorkspaceRuntimeSendTextTool(dependencies, now),
		createWorkspaceRuntimePaneActionTool(dependencies, now, {
			actionType: "restart-pane",
			description: "Restart one agent-owned workspace pane by role.",
			label: "restart workspace pane",
			name: WORKSPACE_CONTEXT_TOOL_NAMES.restartPane,
			operation: "restart_workspace_pane",
		}),
		createWorkspaceRuntimePaneActionTool(dependencies, now, {
			actionType: "stop-pane",
			description: "Stop one agent-owned workspace pane by role.",
			label: "stop workspace pane",
			name: WORKSPACE_CONTEXT_TOOL_NAMES.stopPane,
			operation: "stop_workspace_pane",
		}),
		createListWorkspacePanesTool(dependencies, now),
		createCapturePaneContextTool(dependencies, now),
		createCaptureWorkspaceContextTool(dependencies, now),
		createLatestContextSummaryTool(dependencies, now),
	];
}
