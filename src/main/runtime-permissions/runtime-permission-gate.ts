import { randomUUID } from "node:crypto";
import type { DesktopApprovalDecision, DesktopApprovalRequest, DesktopWorkspacePaneRole } from "../../shared/types.ts";
import { redactTerminalText } from "../context/context-harvester.ts";
import type { DesktopApprovalRequester, DesktopApprovalRequestInput } from "../security/approval-broker.ts";
import { JsonFileStore } from "../storage/json-file-store.ts";
import type { TmuxRuntime } from "../tmux/tmux-runtime.ts";
import type { WorkspaceRuntimeState } from "../workspace/workspace-runtime-orchestrator.ts";

export const RUNTIME_ACTION_TYPES = [
	"archive-workspace",
	"pause-workspace",
	"resume-workspace",
	"send-text",
	"restart-pane",
	"kill-session",
	"stop-pane",
	"takeover-pane",
	"return-pane-control",
	"other",
] as const;
export const RUNTIME_ACTION_REQUESTERS = ["agent", "user", "system"] as const;
export const RUNTIME_ACTION_RISK_LEVELS = ["low", "medium", "high"] as const;

export type RuntimeActionType = (typeof RUNTIME_ACTION_TYPES)[number];
export type RuntimeActionRequester = (typeof RUNTIME_ACTION_REQUESTERS)[number];
export type RuntimeActionRiskLevel = (typeof RUNTIME_ACTION_RISK_LEVELS)[number];
export type RuntimeActionDecisionKind = "approved" | "auto-allowed" | "blocked" | "denied";
export type RuntimeActionResultStatus = "denied" | "executed" | "failed";

export interface RuntimeActionRequest {
	workspaceId: string;
	actionType: RuntimeActionType;
	requestedBy: RuntimeActionRequester;
	riskLevel: RuntimeActionRiskLevel;
	paneId?: string;
	paneRole?: DesktopWorkspacePaneRole;
	text?: string;
	pressEnter?: boolean;
	payloadPreview?: string;
	reason?: string;
}

export interface RuntimeActionDecision {
	approvalId?: string;
	approved: boolean;
	decision: RuntimeActionDecisionKind;
	decidedAt: string;
	reason?: string;
}

export interface RuntimeActionResult {
	status: RuntimeActionResultStatus;
	decision: RuntimeActionDecision;
	auditEvent: RuntimeAuditEvent;
	message?: string;
}

export interface PendingRuntimeApproval {
	id: string;
	workspaceId: string;
	actionType: RuntimeActionType;
	requestedBy: RuntimeActionRequester;
	riskLevel: RuntimeActionRiskLevel;
	paneId?: string;
	paneRole?: DesktopWorkspacePaneRole;
	payloadPreview: string;
	reason?: string;
	createdAt: string;
}

export interface RuntimeAuditEvent {
	id: string;
	workspaceId: string;
	actionType: RuntimeActionType;
	requestedBy: RuntimeActionRequester;
	riskLevel: RuntimeActionRiskLevel;
	paneId?: string;
	paneRole?: DesktopWorkspacePaneRole;
	payloadPreview: string;
	reason?: string;
	decision: RuntimeActionDecisionKind;
	resultStatus: RuntimeActionResultStatus;
	errorMessage?: string;
	requestedAt: string;
	decidedAt: string;
	completedAt: string;
	approvalId?: string;
}

export interface RuntimeAuditStore {
	recordRuntimeAuditEvent(event: RuntimeAuditEvent): Promise<void>;
}

export interface RuntimeApprovalBroker extends DesktopApprovalRequester {
	requestApprovalDecision(request: DesktopApprovalRequestInput): Promise<DesktopApprovalDecision>;
	listPendingApprovals(): DesktopApprovalRequest[];
	resolveApproval(decision: DesktopApprovalDecision): void;
}

export interface RuntimePermissionGateOptions {
	approvalBroker: RuntimeApprovalBroker;
	auditStore: RuntimeAuditStore;
	tmuxRuntime: Pick<TmuxRuntime, "killSession" | "sendText">;
	workspaceRuntime: {
		getWorkspaceRuntimeState(workspaceId: string): Promise<WorkspaceRuntimeState>;
		archiveWorkspaceRuntime?(workspaceId: string): Promise<void>;
		pauseWorkspace?(workspaceId: string): Promise<void>;
		restartPane?(workspaceId: string, role: DesktopWorkspacePaneRole): Promise<WorkspaceRuntimeState>;
		resumeWorkspace?(workspaceId: string): Promise<WorkspaceRuntimeState>;
		stopPane?(workspaceId: string, role: DesktopWorkspacePaneRole): Promise<WorkspaceRuntimeState>;
	};
	now?: () => Date;
}

type RuntimeAuditIndex = RuntimeAuditEvent[];

const MAX_RUNTIME_AUDIT_EVENTS = 1000;

function toTimestamp(now: () => Date): string {
	return now().toISOString();
}

function redactPayloadPreview(input: RuntimeActionRequest): string {
	const preview = input.payloadPreview ?? input.text ?? input.actionType;
	return redactTerminalText(preview).text;
}

function detectDangerousPayloadHints(payloadPreview: string): string[] {
	const hints: string[] = [];
	if (/\brm\s+-rf\b/.test(payloadPreview)) {
		hints.push("rm -rf");
	}
	if (/\bsudo\b/.test(payloadPreview)) {
		hints.push("sudo");
	}
	if (/\bchmod\b|\bchown\b/.test(payloadPreview)) {
		hints.push("permission mutation");
	}
	if (/\bgit\s+push\b|\bgit\s+reset\b|\bgit\s+checkout\b/.test(payloadPreview)) {
		hints.push("git mutation");
	}
	if (/\bkill(?:all)?\b/.test(payloadPreview)) {
		hints.push("process kill");
	}
	return hints;
}

function runtimeActionRequiresApproval(input: RuntimeActionRequest, payloadPreview: string): boolean {
	if (input.requestedBy !== "agent") {
		return false;
	}
	if (input.actionType === "kill-session" || input.riskLevel === "high") {
		return true;
	}
	return detectDangerousPayloadHints(payloadPreview).length > 0;
}

function getRuntimeActionTitle(input: RuntimeActionRequest): string {
	switch (input.actionType) {
		case "archive-workspace":
			return "Archive workspace runtime";
		case "pause-workspace":
			return "Pause workspace runtime";
		case "resume-workspace":
			return "Resume workspace runtime";
		case "send-text":
			return "Send text to workspace terminal";
		case "kill-session":
			return "Kill workspace runtime";
		case "restart-pane":
			return "Restart workspace pane";
		case "stop-pane":
			return "Stop workspace pane";
		case "takeover-pane":
			return "Take over workspace pane";
		case "return-pane-control":
			return "Return workspace pane control";
		case "other":
			return "Run workspace runtime action";
	}
}

function getRuntimeActionDescription(input: RuntimeActionRequest, payloadPreview: string): string {
	const target = input.paneRole ?? input.paneId ?? "workspace runtime";
	const reason = input.reason ? ` Reason: ${input.reason}` : "";
	return `Runtime action '${input.actionType}' requested by ${input.requestedBy} for ${target}. Payload: ${payloadPreview}.${reason}`;
}

function resolvePaneId(input: RuntimeActionRequest, runtimeState: WorkspaceRuntimeState): string | undefined {
	return resolvePaneState(input, runtimeState)?.paneId;
}

function resolvePaneState(input: RuntimeActionRequest, runtimeState: WorkspaceRuntimeState) {
	if (input.paneId && input.paneRole) {
		return runtimeState.panes.find((pane) => pane.paneId === input.paneId && pane.role === input.paneRole);
	}
	if (input.paneId) {
		return runtimeState.panes.find((pane) => pane.paneId === input.paneId);
	}
	if (input.paneRole) {
		return runtimeState.panes.find((pane) => pane.role === input.paneRole);
	}
	return undefined;
}

function isRuntimeWritable(runtimeState: WorkspaceRuntimeState): boolean {
	return runtimeState.status === "running" && Boolean(runtimeState.socketPath);
}

function isPaneAction(actionType: RuntimeActionType): boolean {
	return actionType === "restart-pane" || actionType === "send-text" || actionType === "stop-pane";
}

function requiresRunningRuntime(actionType: RuntimeActionType): boolean {
	return actionType === "kill-session" || isPaneAction(actionType);
}

function getApprovalRequestAction(actionType: RuntimeActionType): string {
	return `runtime_${actionType.replace(/-/g, "_")}`;
}

export class JsonRuntimeAuditStore implements RuntimeAuditStore {
	private readonly store: JsonFileStore<RuntimeAuditIndex>;

	constructor(
		indexFilePath: string,
		private readonly maxEvents = MAX_RUNTIME_AUDIT_EVENTS,
	) {
		this.store = new JsonFileStore(indexFilePath, []);
	}

	async recordRuntimeAuditEvent(event: RuntimeAuditEvent): Promise<void> {
		await this.store.update((current) => [...current, event].slice(-this.maxEvents));
	}

	async listRuntimeAuditEvents(workspaceId?: string): Promise<RuntimeAuditEvent[]> {
		const events = await this.store.read();
		return workspaceId ? events.filter((event) => event.workspaceId === workspaceId) : events;
	}
}

export class RuntimePermissionGate {
	private readonly now: () => Date;

	constructor(private readonly options: RuntimePermissionGateOptions) {
		this.now = options.now ?? (() => new Date());
	}

	async requestRuntimeAction(input: RuntimeActionRequest): Promise<RuntimeActionDecision> {
		const decidedAt = toTimestamp(this.now);
		const payloadPreview = redactPayloadPreview(input);
		if (!runtimeActionRequiresApproval(input, payloadPreview)) {
			return {
				approved: true,
				decision: "auto-allowed",
				decidedAt,
			};
		}

		const decision = await this.options.approvalBroker.requestApprovalDecision({
			category: "terminal",
			action: getApprovalRequestAction(input.actionType),
			title: getRuntimeActionTitle(input),
			description: getRuntimeActionDescription(input, payloadPreview),
			subject: input.paneRole ?? input.paneId ?? input.workspaceId,
			details: {
				runtimeAction: true,
				workspaceId: input.workspaceId,
				actionType: input.actionType,
				requestedBy: input.requestedBy,
				riskLevel: input.riskLevel,
				payloadPreview,
				dangerousPayloadHints: detectDangerousPayloadHints(payloadPreview),
				...(input.paneRole ? { paneRole: input.paneRole } : {}),
				...(input.paneId ? { paneId: input.paneId } : {}),
				...(input.reason ? { reason: input.reason } : {}),
			},
		});

		return {
			approvalId: decision.requestId,
			approved: decision.approved,
			decision: decision.approved ? "approved" : "denied",
			decidedAt: toTimestamp(this.now),
			...(decision.reason ? { reason: decision.reason } : {}),
		};
	}

	async executeRuntimeActionWithPermission(input: RuntimeActionRequest): Promise<RuntimeActionResult> {
		const requestedAt = toTimestamp(this.now);
		const payloadPreview = redactPayloadPreview(input);
		const runtimeState = await this.options.workspaceRuntime.getWorkspaceRuntimeState(input.workspaceId);
		if (requiresRunningRuntime(input.actionType) && !isRuntimeWritable(runtimeState)) {
			const decision: RuntimeActionDecision = {
				approved: false,
				decision: "blocked",
				decidedAt: toTimestamp(this.now),
				reason: runtimeState.errorMessage ?? "Workspace runtime is not running. Resume it before writing to panes.",
			};
			return this.recordResult(input, payloadPreview, requestedAt, decision, "failed", decision.reason);
		}
		const paneState = resolvePaneState(input, runtimeState);
		if (isPaneAction(input.actionType)) {
			if (!input.paneId && !input.paneRole) {
				const decision: RuntimeActionDecision = {
					approved: false,
					decision: "blocked",
					decidedAt: toTimestamp(this.now),
					reason: `${input.actionType} requires a workspace pane role or pane id.`,
				};
				return this.recordResult(input, payloadPreview, requestedAt, decision, "failed", decision.reason);
			}
			if (!paneState) {
				const decision: RuntimeActionDecision = {
					approved: false,
					decision: "blocked",
					decidedAt: toTimestamp(this.now),
					reason: "Workspace pane does not exist. Refresh runtime state before writing to this pane.",
				};
				return this.recordResult(input, payloadPreview, requestedAt, decision, "failed", decision.reason);
			}
			if (input.actionType !== "restart-pane" && !paneState.paneId) {
				const decision: RuntimeActionDecision = {
					approved: false,
					decision: "blocked",
					decidedAt: toTimestamp(this.now),
					reason: "Workspace pane does not exist. Refresh runtime state before writing to this pane.",
				};
				return this.recordResult(input, payloadPreview, requestedAt, decision, "failed", decision.reason);
			}
			if (input.actionType !== "restart-pane" && (paneState.state !== "running" || paneState.dead)) {
				const decision: RuntimeActionDecision = {
					approved: false,
					decision: "blocked",
					decidedAt: toTimestamp(this.now),
					reason: "Workspace pane is not running. Resume or restart it before writing to this pane.",
				};
				return this.recordResult(input, payloadPreview, requestedAt, decision, "failed", decision.reason);
			}
		}
		if (input.requestedBy === "agent" && isPaneAction(input.actionType) && paneState?.controlOwner === "user") {
			const decision: RuntimeActionDecision = {
				approved: false,
				decision: "blocked",
				decidedAt: toTimestamp(this.now),
				reason: "Pane is under user control. Return control before agent writes to this pane.",
			};
			return this.recordResult(input, payloadPreview, requestedAt, decision, "failed", decision.reason);
		}

		const decision = await this.requestRuntimeAction(input);
		if (!decision.approved) {
			return this.recordResult(
				input,
				payloadPreview,
				requestedAt,
				decision,
				"denied",
				decision.reason ?? "Permission denied by user.",
			);
		}

		try {
			await this.executeApprovedRuntimeAction(input, runtimeState);
			return this.recordResult(input, payloadPreview, requestedAt, decision, "executed");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return this.recordResult(input, payloadPreview, requestedAt, decision, "failed", message);
		}
	}

	listPendingRuntimeApprovals(workspaceId: string): Promise<PendingRuntimeApproval[]> {
		const approvals = this.options.approvalBroker
			.listPendingApprovals()
			.map((approval) => this.mapPendingApproval(approval))
			.filter((approval): approval is PendingRuntimeApproval => approval !== undefined)
			.filter((approval) => approval.workspaceId === workspaceId);
		return Promise.resolve(approvals);
	}

	approveRuntimeAction(approvalId: string): Promise<void> {
		this.options.approvalBroker.resolveApproval({ requestId: approvalId, approved: true });
		return Promise.resolve();
	}

	denyRuntimeAction(approvalId: string, reason?: string): Promise<void> {
		this.options.approvalBroker.resolveApproval({
			requestId: approvalId,
			approved: false,
			...(reason ? { reason } : {}),
		});
		return Promise.resolve();
	}

	recordRuntimeAuditEvent(event: RuntimeAuditEvent): Promise<void> {
		return this.options.auditStore.recordRuntimeAuditEvent(event);
	}

	private async executeApprovedRuntimeAction(
		input: RuntimeActionRequest,
		runtimeState: WorkspaceRuntimeState,
	): Promise<void> {
		switch (input.actionType) {
			case "send-text": {
				const socketPath = runtimeState.socketPath;
				if (!socketPath) {
					throw new Error("Workspace runtime has no tmux socket path.");
				}
				const paneId = resolvePaneId(input, runtimeState);
				if (!paneId) {
					throw new Error("Workspace pane does not exist. Refresh runtime state before sending text.");
				}
				if (!input.text) {
					throw new Error("send-text requires text.");
				}
				await this.options.tmuxRuntime.sendText({
					socketPath,
					paneId,
					text: input.text,
					...(input.pressEnter !== undefined ? { pressEnter: input.pressEnter } : {}),
				});
				return;
			}
			case "kill-session": {
				const socketPath = runtimeState.socketPath;
				if (!socketPath) {
					throw new Error("Workspace runtime has no tmux socket path.");
				}
				if (this.options.workspaceRuntime.pauseWorkspace) {
					await this.options.workspaceRuntime.pauseWorkspace(input.workspaceId);
					return;
				}
				if (!runtimeState.sessionName) {
					throw new Error("Workspace runtime has no tmux session name.");
				}
				await this.options.tmuxRuntime.killSession({
					socketPath,
					sessionName: runtimeState.sessionName,
				});
				return;
			}
			case "archive-workspace": {
				if (!this.options.workspaceRuntime.archiveWorkspaceRuntime) {
					throw new Error("Workspace runtime archive is not available.");
				}
				await this.options.workspaceRuntime.archiveWorkspaceRuntime(input.workspaceId);
				return;
			}
			case "pause-workspace": {
				if (!this.options.workspaceRuntime.pauseWorkspace) {
					throw new Error("Workspace runtime pause is not available.");
				}
				await this.options.workspaceRuntime.pauseWorkspace(input.workspaceId);
				return;
			}
			case "resume-workspace": {
				if (!this.options.workspaceRuntime.resumeWorkspace) {
					throw new Error("Workspace runtime resume is not available.");
				}
				await this.options.workspaceRuntime.resumeWorkspace(input.workspaceId);
				return;
			}
			case "restart-pane": {
				if (!this.options.workspaceRuntime.restartPane) {
					throw new Error("Workspace pane restart is not available.");
				}
				if (!input.paneRole) {
					throw new Error("restart-pane requires a pane role.");
				}
				await this.options.workspaceRuntime.restartPane(input.workspaceId, input.paneRole);
				return;
			}
			case "stop-pane": {
				if (!this.options.workspaceRuntime.stopPane) {
					throw new Error("Workspace pane stop is not available.");
				}
				if (!input.paneRole) {
					throw new Error("stop-pane requires a pane role.");
				}
				await this.options.workspaceRuntime.stopPane(input.workspaceId, input.paneRole);
				return;
			}
			case "takeover-pane":
			case "return-pane-control":
			case "other":
				throw new Error(`Runtime action '${input.actionType}' is not implemented yet.`);
		}
	}

	private async recordResult(
		input: RuntimeActionRequest,
		payloadPreview: string,
		requestedAt: string,
		decision: RuntimeActionDecision,
		resultStatus: RuntimeActionResultStatus,
		errorMessage?: string,
	): Promise<RuntimeActionResult> {
		const event: RuntimeAuditEvent = {
			id: randomUUID(),
			workspaceId: input.workspaceId,
			actionType: input.actionType,
			requestedBy: input.requestedBy,
			riskLevel: input.riskLevel,
			payloadPreview,
			decision: decision.decision,
			resultStatus,
			requestedAt,
			decidedAt: decision.decidedAt,
			completedAt: toTimestamp(this.now),
			...(input.paneId ? { paneId: input.paneId } : {}),
			...(input.paneRole ? { paneRole: input.paneRole } : {}),
			...(input.reason ? { reason: input.reason } : {}),
			...(decision.approvalId ? { approvalId: decision.approvalId } : {}),
			...(errorMessage ? { errorMessage } : {}),
		};
		await this.recordRuntimeAuditEvent(event);
		return {
			status: resultStatus,
			decision,
			auditEvent: event,
			...(errorMessage ? { message: errorMessage } : {}),
		};
	}

	private mapPendingApproval(approval: DesktopApprovalRequest): PendingRuntimeApproval | undefined {
		const details = approval.details;
		if (!details || details.runtimeAction !== true) {
			return undefined;
		}
		const workspaceId = typeof details.workspaceId === "string" ? details.workspaceId : undefined;
		const actionType = isRuntimeActionType(details.actionType) ? details.actionType : undefined;
		const requestedBy = isRuntimeActionRequester(details.requestedBy) ? details.requestedBy : undefined;
		const riskLevel = isRuntimeActionRiskLevel(details.riskLevel) ? details.riskLevel : undefined;
		const payloadPreview = typeof details.payloadPreview === "string" ? details.payloadPreview : undefined;
		if (!workspaceId || !actionType || !requestedBy || !riskLevel || payloadPreview === undefined) {
			return undefined;
		}
		const paneRole = isDesktopWorkspacePaneRole(details.paneRole) ? details.paneRole : undefined;
		const paneId = typeof details.paneId === "string" ? details.paneId : undefined;
		const reason = typeof details.reason === "string" ? details.reason : undefined;
		return {
			id: approval.id,
			workspaceId,
			actionType,
			requestedBy,
			riskLevel,
			payloadPreview,
			createdAt: approval.createdAt,
			...(paneRole ? { paneRole } : {}),
			...(paneId ? { paneId } : {}),
			...(reason ? { reason } : {}),
		};
	}
}

function isRuntimeActionType(value: unknown): value is RuntimeActionType {
	return typeof value === "string" && RUNTIME_ACTION_TYPES.includes(value as RuntimeActionType);
}

function isRuntimeActionRequester(value: unknown): value is RuntimeActionRequester {
	return typeof value === "string" && RUNTIME_ACTION_REQUESTERS.includes(value as RuntimeActionRequester);
}

function isRuntimeActionRiskLevel(value: unknown): value is RuntimeActionRiskLevel {
	return typeof value === "string" && RUNTIME_ACTION_RISK_LEVELS.includes(value as RuntimeActionRiskLevel);
}

function isDesktopWorkspacePaneRole(value: unknown): value is DesktopWorkspacePaneRole {
	return value === "agent" || value === "shell" || value === "dev-server" || value === "test" || value === "logs";
}
