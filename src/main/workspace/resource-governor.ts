import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getErrorMessage } from "../../shared/errors.ts";
import type { DesktopWorkspace, DesktopWorkspacePaneRole } from "../../shared/types.ts";
import { isMissingFileError } from "../storage/fs-errors.ts";
import type { TmuxRuntime } from "../tmux/tmux-runtime.ts";
import { isPathInside } from "../util/path-scope.ts";
import type { WorkspaceRuntimeState } from "./workspace-runtime-orchestrator.ts";
import type { DesktopWorkspaceStore } from "./workspace-store.ts";

export interface RuntimeActivity {
	workspaceId: string;
	runtimeStatus: WorkspaceRuntimeState["status"];
	pinned: boolean;
	hasPendingApproval: boolean;
	lastActivityAt?: string;
	idleMinutes: number;
	activePaneCount: number;
	activeLongRunningPaneCount: number;
	deadPaneCount: number;
	pauseCandidate: boolean;
	reason?: string;
}

export interface DeadPaneReport {
	workspaceId: string;
	paneRole: DesktopWorkspacePaneRole;
	paneId?: string;
	windowName: string;
}

export interface OrphanSession {
	socketPath: string;
	sessionName: string;
	paneCount: number;
}

export interface ReconcileReport {
	checkedWorkspaceIds: string[];
	pausedMissingWorkspaces: string[];
	deadPanes: DeadPaneReport[];
	orphanSessions: OrphanSession[];
	errors: string[];
}

export interface PauseIdleWorkspacesReport {
	checkedWorkspaceIds: string[];
	pausedWorkspaceIds: string[];
	skippedWorkspaceIds: string[];
	errors: string[];
}

export interface ResourceGovernorReport {
	reconcile: ReconcileReport;
	pauseIdle: PauseIdleWorkspacesReport;
}

export interface SnapshotRetentionReport {
	workspaceId: string;
	retentionDays: number;
	deletedSnapshots: number;
	skipped: boolean;
	reason?: string;
}

export interface WorkspaceResourceGovernorOptions {
	workspaceStore: DesktopWorkspaceStore;
	workspaceRuntime: {
		getWorkspaceRuntimeState(workspaceId: string): Promise<WorkspaceRuntimeState>;
		pauseWorkspace(workspaceId: string): Promise<void>;
	};
	tmuxRuntime: Pick<TmuxRuntime, "listPanes">;
	runtimeRootDir: string;
	listRuntimeSocketPaths?: () => Promise<string[]>;
	listPendingRuntimeApprovals?: (workspaceId: string) => Promise<readonly { id: string }[]>;
	snapshotStore?: {
		pruneWorkspaceSnapshots(workspaceId: string, before: string): Promise<number>;
	};
	now?: () => Date;
}

const DEFAULT_SNAPSHOT_RETENTION_DAYS = 7;
const INTERACTIVE_SHELL_COMMANDS = new Set([
	"bash",
	"cmd",
	"dash",
	"fish",
	"ksh",
	"login",
	"nu",
	"powershell",
	"pwsh",
	"sh",
	"tmux",
	"zsh",
]);

function toTimestamp(date: Date): string {
	return date.toISOString();
}

function getWorkspaceLastActivity(workspace: DesktopWorkspace): string | undefined {
	return workspace.lastActivityAt ?? workspace.lastOpenedAt ?? workspace.updatedAt;
}

function getIdleMinutes(lastActivityAt: string | undefined, now: Date): number {
	if (!lastActivityAt) {
		return Number.POSITIVE_INFINITY;
	}
	const timestamp = Date.parse(lastActivityAt);
	if (!Number.isFinite(timestamp)) {
		return Number.POSITIVE_INFINITY;
	}
	return Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000));
}

function getSnapshotRetentionDays(workspace: DesktopWorkspace): number {
	return "snapshotRetentionDays" in workspace.resourcePolicy &&
		typeof workspace.resourcePolicy.snapshotRetentionDays === "number"
		? workspace.resourcePolicy.snapshotRetentionDays
		: DEFAULT_SNAPSHOT_RETENTION_DAYS;
}

function getRetentionCutoff(now: Date, retentionDays: number): string {
	const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
	return toTimestamp(cutoff);
}

function sortActivitiesByLeastRecent(left: RuntimeActivity, right: RuntimeActivity): number {
	const leftTime = left.lastActivityAt ? Date.parse(left.lastActivityAt) : 0;
	const rightTime = right.lastActivityAt ? Date.parse(right.lastActivityAt) : 0;
	return leftTime - rightTime;
}

function normalizeCommandName(currentCommand: string | undefined): string {
	const commandName = currentCommand?.trim().split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
	return commandName.replace(/^-+/, "");
}

function isInteractiveShellCommand(currentCommand: string | undefined): boolean {
	const commandName = normalizeCommandName(currentCommand);
	return commandName.length === 0 || INTERACTIVE_SHELL_COMMANDS.has(commandName);
}

function isActiveLongRunningPane(pane: WorkspaceRuntimeState["panes"][number]): boolean {
	return pane.state === "running" && !pane.dead && !isInteractiveShellCommand(pane.currentCommand);
}

function getActivityReason(input: {
	pinned: boolean;
	hasPendingApproval: boolean;
	activeLongRunningPaneCount: number;
}): string | undefined {
	if (input.pinned) {
		return "pinned workspace";
	}
	if (input.hasPendingApproval) {
		return "pending runtime approval";
	}
	if (input.activeLongRunningPaneCount > 0) {
		return "active runtime pane";
	}
	return undefined;
}

export class WorkspaceResourceGovernor {
	private readonly now: () => Date;

	constructor(private readonly options: WorkspaceResourceGovernorOptions) {
		this.now = options.now ?? (() => new Date());
	}

	async reconcileWorkspacesOnStartup(): Promise<ReconcileReport> {
		const workspaces = (await this.options.workspaceStore.listWorkspaces()).filter(
			(workspace) =>
				workspace.status === "running" || workspace.status === "starting" || workspace.status === "paused",
		);
		const report: ReconcileReport = {
			checkedWorkspaceIds: workspaces.map((workspace) => workspace.id),
			pausedMissingWorkspaces: [],
			deadPanes: [],
			orphanSessions: [],
			errors: [],
		};

		for (const workspace of workspaces) {
			try {
				const state = await this.options.workspaceRuntime.getWorkspaceRuntimeState(workspace.id);
				if (workspace.status === "running" && state.status !== "running") {
					await this.options.workspaceStore.updateWorkspace(workspace.id, {
						status: "paused",
						lastActivityAt: toTimestamp(this.now()),
					});
					report.pausedMissingWorkspaces.push(workspace.id);
				}
				for (const pane of state.panes.filter((candidate) => candidate.dead)) {
					report.deadPanes.push({
						workspaceId: workspace.id,
						paneRole: pane.role,
						windowName: pane.windowName,
						...(pane.paneId ? { paneId: pane.paneId } : {}),
					});
				}
			} catch (error) {
				report.errors.push(getErrorMessage(error));
			}
		}

		report.orphanSessions = await this.findOrphanTmuxSessions();
		return report;
	}

	async resourceGovernorTick(): Promise<ResourceGovernorReport> {
		return {
			reconcile: await this.reconcileWorkspacesOnStartup(),
			pauseIdle: await this.pauseIdleWorkspaces(),
		};
	}

	async getWorkspaceRuntimeActivity(workspaceId: string): Promise<RuntimeActivity> {
		const workspace = await this.options.workspaceStore.getWorkspace(workspaceId);
		if (!workspace) {
			throw new Error(`Workspace '${workspaceId}' does not exist.`);
		}
		const state = await this.options.workspaceRuntime.getWorkspaceRuntimeState(workspaceId);
		const pendingApprovals = await this.options.listPendingRuntimeApprovals?.(workspaceId);
		const hasPendingApproval = (pendingApprovals?.length ?? 0) > 0;
		const lastActivityAt = getWorkspaceLastActivity(workspace);
		const idleMinutes = getIdleMinutes(lastActivityAt, this.now());
		const pinned = workspace.pinned === true;
		const activePaneCount = state.panes.filter((pane) => pane.state === "running").length;
		const activeLongRunningPaneCount = state.panes.filter(isActiveLongRunningPane).length;
		const deadPaneCount = state.panes.filter((pane) => pane.dead).length;
		const pauseCandidate =
			state.status === "running" &&
			!pinned &&
			!hasPendingApproval &&
			activeLongRunningPaneCount === 0 &&
			idleMinutes >= workspace.resourcePolicy.idlePauseMinutes;
		const reason = getActivityReason({ pinned, hasPendingApproval, activeLongRunningPaneCount });
		return {
			workspaceId,
			runtimeStatus: state.status,
			pinned,
			hasPendingApproval,
			idleMinutes,
			activePaneCount,
			activeLongRunningPaneCount,
			deadPaneCount,
			pauseCandidate,
			...(lastActivityAt ? { lastActivityAt } : {}),
			...(reason ? { reason } : {}),
		};
	}

	async markDeadPanes(workspaceId: string): Promise<void> {
		await this.options.workspaceRuntime.getWorkspaceRuntimeState(workspaceId);
	}

	async pauseIdleWorkspaces(): Promise<PauseIdleWorkspacesReport> {
		const runningWorkspaces = await this.options.workspaceStore.listWorkspaces({ status: "running" });
		const report: PauseIdleWorkspacesReport = {
			checkedWorkspaceIds: runningWorkspaces.map((workspace) => workspace.id),
			pausedWorkspaceIds: [],
			skippedWorkspaceIds: [],
			errors: [],
		};
		const activities: RuntimeActivity[] = [];

		for (const workspace of runningWorkspaces) {
			try {
				activities.push(await this.getWorkspaceRuntimeActivity(workspace.id));
			} catch (error) {
				report.errors.push(getErrorMessage(error));
			}
		}

		for (const activity of activities.filter((candidate) => candidate.pauseCandidate)) {
			await this.pauseWorkspaceForGovernance(activity.workspaceId, report);
		}

		const pausedIds = new Set(report.pausedWorkspaceIds);
		const hotActivities = activities
			.filter((activity) => !pausedIds.has(activity.workspaceId))
			.filter((activity) => activity.runtimeStatus === "running")
			.filter((activity) => !activity.pinned && !activity.hasPendingApproval)
			.filter((activity) => activity.activeLongRunningPaneCount === 0)
			.sort(sortActivitiesByLeastRecent);
		const maxHotWorkspaces = Math.min(
			...runningWorkspaces.map((workspace) => workspace.resourcePolicy.maxHotWorkspaces),
		);
		const excessHotWorkspaceCount = Math.max(0, hotActivities.length - maxHotWorkspaces);
		for (const activity of hotActivities.slice(0, excessHotWorkspaceCount)) {
			await this.pauseWorkspaceForGovernance(activity.workspaceId, report);
		}

		const skippedIds = activities
			.map((activity) => activity.workspaceId)
			.filter((workspaceId) => !report.pausedWorkspaceIds.includes(workspaceId));
		report.skippedWorkspaceIds = skippedIds;
		return report;
	}

	async enforceLogAndSnapshotLimits(workspaceId: string): Promise<SnapshotRetentionReport> {
		const workspace = await this.options.workspaceStore.getWorkspace(workspaceId);
		if (!workspace) {
			throw new Error(`Workspace '${workspaceId}' does not exist.`);
		}
		const retentionDays = getSnapshotRetentionDays(workspace);
		if (!this.options.snapshotStore) {
			return {
				workspaceId,
				retentionDays,
				deletedSnapshots: 0,
				skipped: true,
				reason: "No snapshot retention store is configured.",
			};
		}
		const before = getRetentionCutoff(this.now(), retentionDays);
		const deletedSnapshots = await this.options.snapshotStore.pruneWorkspaceSnapshots(workspaceId, before);
		return {
			workspaceId,
			retentionDays,
			deletedSnapshots,
			skipped: false,
		};
	}

	async findOrphanTmuxSessions(): Promise<OrphanSession[]> {
		const socketPaths = await this.listRuntimeSocketPaths();
		const workspaces = await this.options.workspaceStore.listWorkspaces();
		const knownRuntimes = new Set(
			workspaces.flatMap((workspace) => {
				const keys: string[] = [];
				if (workspace.tmuxSocketPath) {
					keys.push(`${workspace.tmuxSocketPath}::${workspace.tmuxSessionName ?? ""}`);
				}
				return keys;
			}),
		);
		const orphans: OrphanSession[] = [];
		for (const socketPath of socketPaths) {
			if (!isPathInside(this.options.runtimeRootDir, socketPath)) {
				continue;
			}
			try {
				const panes = await this.options.tmuxRuntime.listPanes({ socketPath });
				const sessions = new Map<string, number>();
				for (const pane of panes) {
					sessions.set(pane.sessionName, (sessions.get(pane.sessionName) ?? 0) + 1);
				}
				for (const [sessionName, paneCount] of sessions) {
					if (!knownRuntimes.has(`${socketPath}::${sessionName}`)) {
						orphans.push({ socketPath, sessionName, paneCount });
					}
				}
			} catch {
				// Reconcile reports only reachable app-owned sessions; stale sockets are ignored here.
			}
		}
		return orphans;
	}

	private async pauseWorkspaceForGovernance(
		workspaceId: string,
		report: Pick<PauseIdleWorkspacesReport, "errors" | "pausedWorkspaceIds">,
	): Promise<void> {
		if (report.pausedWorkspaceIds.includes(workspaceId)) {
			return;
		}
		try {
			await this.options.workspaceRuntime.pauseWorkspace(workspaceId);
			report.pausedWorkspaceIds.push(workspaceId);
		} catch (error) {
			report.errors.push(getErrorMessage(error));
		}
	}

	private async listRuntimeSocketPaths(): Promise<string[]> {
		if (this.options.listRuntimeSocketPaths) {
			return this.options.listRuntimeSocketPaths();
		}
		const socketDir = join(this.options.runtimeRootDir, "tmux");
		try {
			const entries = await readdir(socketDir, { withFileTypes: true });
			return entries
				.filter((entry) => entry.isSocket() || entry.name.endsWith(".sock"))
				.map((entry) => join(socketDir, entry.name));
		} catch (error) {
			if (isMissingFileError(error)) {
				return [];
			}
			throw error;
		}
	}
}
