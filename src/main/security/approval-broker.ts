import { randomUUID } from "node:crypto";
import type {
	DesktopApprovalCategory,
	DesktopApprovalDecision,
	DesktopApprovalEvent,
	DesktopApprovalRequest,
	DesktopSettingsData,
} from "../../shared/types.ts";
import { resolveDesktopPermissionApprovalSettings } from "../../shared/types.ts";
import { Listeners } from "../util/port-fanout.ts";

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export interface DesktopApprovalRequestInput {
	category: DesktopApprovalCategory;
	action: string;
	title: string;
	description?: string;
	subject?: string;
	cwd?: string;
	details?: Record<string, unknown>;
}

export interface DesktopApprovalRequester {
	requestApproval(request: DesktopApprovalRequestInput): Promise<void>;
}

interface PendingApproval {
	request: DesktopApprovalRequest;
	resolve: (decision: DesktopApprovalDecision) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

function formatDeniedMessage(request: DesktopApprovalRequest, reason: string | undefined): string {
	return reason ? `Approval denied for ${request.title}: ${reason}` : `Approval denied for ${request.title}.`;
}

function categorySettingKey(
	category: DesktopApprovalCategory,
): keyof ReturnType<typeof resolveDesktopPermissionApprovalSettings> {
	switch (category) {
		case "bash":
			return "bash";
		case "file_mutation":
			return "fileMutation";
		case "capability_mutation":
			return "capabilityMutation";
		case "mcp_tool":
			return "mcpTool";
		case "mcp_server_lifecycle":
			return "mcpServerLifecycle";
		case "terminal":
			return "terminal";
	}
}

export class DesktopApprovalBroker implements DesktopApprovalRequester {
	private readonly listeners = new Listeners<DesktopApprovalEvent>();
	private readonly pending = new Map<string, PendingApproval>();

	constructor(private readonly getSettings: () => Promise<DesktopSettingsData> | DesktopSettingsData) {}

	subscribe(listener: (event: DesktopApprovalEvent) => void): () => void {
		return this.listeners.subscribe(listener);
	}

	async requestApproval(input: DesktopApprovalRequestInput): Promise<void> {
		const decision = await this.requestApprovalDecision(input);
		if (!decision.approved) {
			throw new Error(
				formatDeniedMessage(
					{ ...input, id: decision.requestId, createdAt: new Date().toISOString() },
					decision.reason,
				),
			);
		}
	}

	async requestApprovalDecision(input: DesktopApprovalRequestInput): Promise<DesktopApprovalDecision> {
		if (!(await this.requiresApproval(input.category))) {
			return {
				requestId: "auto-approved",
				approved: true,
			};
		}
		if (this.listeners.size === 0) {
			throw new Error(`Approval required for ${input.title}, but no approval surface is available.`);
		}

		const request: DesktopApprovalRequest = {
			...input,
			id: randomUUID(),
			createdAt: new Date().toISOString(),
		};

		return new Promise<DesktopApprovalDecision>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(request.id);
				const decision = {
					requestId: request.id,
					approved: false,
					reason: "Approval timed out.",
				};
				this.emit({ type: "approval_resolved", decision });
				resolve(decision);
			}, APPROVAL_TIMEOUT_MS);
			this.pending.set(request.id, {
				request,
				resolve,
				reject,
				timeout,
			});
			this.emit({ type: "approval_requested", request });
		});
	}

	listPendingApprovals(): DesktopApprovalRequest[] {
		return [...this.pending.values()].map((pending) => pending.request);
	}

	resolveApproval(decision: DesktopApprovalDecision): void {
		const pending = this.pending.get(decision.requestId);
		if (!pending) {
			return;
		}

		clearTimeout(pending.timeout);
		this.pending.delete(decision.requestId);
		this.emit({ type: "approval_resolved", decision });

		if (decision.approved) {
			pending.resolve(decision);
			return;
		}

		pending.resolve(decision);
	}

	dispose(reason = "Approval surface disposed."): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			const decision = {
				requestId: pending.request.id,
				approved: false,
				reason,
			};
			pending.resolve(decision);
			this.emit({ type: "approval_resolved", decision });
		}
		this.pending.clear();
		this.listeners.clear();
	}

	private async requiresApproval(category: DesktopApprovalCategory): Promise<boolean> {
		const settings = await this.getSettings();
		const approvals = resolveDesktopPermissionApprovalSettings(settings);
		return approvals[categorySettingKey(category)];
	}

	private emit(event: DesktopApprovalEvent): void {
		this.listeners.emit(event);
	}
}
