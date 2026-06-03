import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import type {
	DesktopWorkspace,
	DesktopWorkspacePaneControlOwner,
	DesktopWorkspacePaneDefinition,
	DesktopWorkspacePaneRole,
} from "../../shared/types.ts";
import type { TmuxPaneInfo, TmuxRuntime } from "../tmux/tmux-runtime.ts";
import { TmuxRuntimeError } from "../tmux/tmux-runtime.ts";
import { type DesktopWorkspaceStore, deriveTmuxSessionName } from "./workspace-store.ts";

export type WorkspaceRuntimeStatus = "archived" | "error" | "paused" | "running" | "unavailable";

export interface WorkspacePaneState {
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

export interface WorkspaceRuntimeState {
	workspaceId: string;
	status: WorkspaceRuntimeStatus;
	tmuxAvailable: boolean;
	socketPath?: string;
	sessionName?: string;
	panes: WorkspacePaneState[];
	errorMessage?: string;
}

export interface WorkspaceRuntimeOrchestratorOptions {
	workspaceStore: DesktopWorkspaceStore;
	tmuxRuntime: TmuxRuntime;
	runtimeRootDir: string;
	tmuxSocketRootDir?: string;
	snapshotBeforePause?: (workspaceId: string) => Promise<void>;
	now?: () => Date;
}

interface ResolvedWorkspaceRuntime {
	workspace: DesktopWorkspace;
	socketPath: string;
	sessionName: string;
	cwd: string;
}

function toTimestamp(now: () => Date): string {
	return now().toISOString();
}

function getPaneWindowName(paneDefinition: DesktopWorkspacePaneDefinition): string {
	return paneDefinition.role;
}

function resolveWorkspaceCwd(workspace: DesktopWorkspace): string {
	return workspace.worktreePath ?? workspace.repoPath;
}

function isPathInside(parentPath: string, childPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath));
	return relativePath.length === 0 || (!relativePath.startsWith("..") && !relativePath.startsWith(`..${sep}`));
}

function getUnmanagedRuntimeMessage(workspaceId: string): string {
	return `Workspace '${workspaceId}' runtime metadata points outside app-owned runtime storage.`;
}

function deriveShortSocketFileName(workspaceId: string): string {
	return `${createHash("sha256").update(workspaceId).digest("hex").slice(0, 16)}.sock`;
}

function mapPaneDefinitionToState(
	paneDefinition: DesktopWorkspacePaneDefinition,
	paneInfo: TmuxPaneInfo | undefined,
): WorkspacePaneState {
	const windowName = getPaneWindowName(paneDefinition);
	if (!paneInfo) {
		return {
			role: paneDefinition.role,
			title: paneDefinition.title,
			windowName,
			controlOwner: paneDefinition.controlOwner ?? "none",
			dead: false,
			state: "missing",
		};
	}

	return {
		role: paneDefinition.role,
		title: paneDefinition.title,
		windowName,
		controlOwner: paneDefinition.controlOwner ?? "none",
		paneId: paneInfo.paneId,
		currentCommand: paneInfo.currentCommand,
		currentPath: paneInfo.currentPath,
		dead: paneInfo.dead,
		state: paneInfo.dead ? "dead" : "running",
	};
}

export class WorkspaceRuntimeOrchestrator {
	private readonly now: () => Date;

	constructor(private readonly options: WorkspaceRuntimeOrchestratorOptions) {
		this.now = options.now ?? (() => new Date());
	}

	private async getWorkspace(workspaceId: string): Promise<DesktopWorkspace> {
		const workspace = await this.options.workspaceStore.getWorkspace(workspaceId);
		if (!workspace) {
			throw new Error(`Workspace '${workspaceId}' does not exist.`);
		}
		return workspace;
	}

	private getDefaultSocketPath(workspaceId: string): string {
		if (this.options.tmuxSocketRootDir) {
			return join(this.options.tmuxSocketRootDir, deriveShortSocketFileName(workspaceId));
		}
		return join(this.options.runtimeRootDir, "tmux", `${workspaceId}.sock`);
	}

	private isAppManagedSocketPath(socketPath: string): boolean {
		return (
			isPathInside(this.options.runtimeRootDir, socketPath) ||
			Boolean(this.options.tmuxSocketRootDir && isPathInside(this.options.tmuxSocketRootDir, socketPath))
		);
	}

	private resolveRuntime(workspace: DesktopWorkspace): ResolvedWorkspaceRuntime {
		const defaultSocketPath = this.getDefaultSocketPath(workspace.id);
		const socketPath =
			workspace.tmuxSocketPath && this.isAppManagedSocketPath(workspace.tmuxSocketPath)
				? workspace.tmuxSocketPath.length > 100
					? defaultSocketPath
					: workspace.tmuxSocketPath
				: (workspace.tmuxSocketPath ?? defaultSocketPath);
		return {
			workspace,
			socketPath,
			sessionName: workspace.tmuxSessionName ?? deriveTmuxSessionName(workspace.id),
			cwd: resolveWorkspaceCwd(workspace),
		};
	}

	private async persistRuntimeFields(runtime: ResolvedWorkspaceRuntime): Promise<DesktopWorkspace> {
		const updated = await this.options.workspaceStore.updateWorkspace(runtime.workspace.id, {
			tmuxSessionName: runtime.sessionName,
			tmuxSocketPath: runtime.socketPath,
		});
		return updated ?? runtime.workspace;
	}

	private isManagedRuntime(runtime: ResolvedWorkspaceRuntime): boolean {
		return this.isAppManagedSocketPath(runtime.socketPath);
	}

	private async createUnmanagedRuntimeState(
		workspaceId: string,
		runtime: ResolvedWorkspaceRuntime,
	): Promise<WorkspaceRuntimeState> {
		return {
			workspaceId,
			status: "error",
			tmuxAvailable: await this.options.tmuxRuntime.isTmuxAvailable().catch(() => false),
			socketPath: runtime.socketPath,
			sessionName: runtime.sessionName,
			panes: runtime.workspace.paneDefinitions.map((paneDefinition) =>
				mapPaneDefinitionToState(paneDefinition, undefined),
			),
			errorMessage: getUnmanagedRuntimeMessage(workspaceId),
		};
	}

	private async listPaneStates(runtime: ResolvedWorkspaceRuntime): Promise<WorkspacePaneState[]> {
		const panes = await this.options.tmuxRuntime.listPanes({
			socketPath: runtime.socketPath,
			sessionName: runtime.sessionName,
		});
		return runtime.workspace.paneDefinitions.map((paneDefinition) =>
			mapPaneDefinitionToState(
				paneDefinition,
				panes.find((paneInfo) => paneInfo.windowName === getPaneWindowName(paneDefinition)),
			),
		);
	}

	private getPaneDefinition(
		workspace: DesktopWorkspace,
		role: DesktopWorkspacePaneRole,
	): DesktopWorkspacePaneDefinition {
		const paneDefinition = workspace.paneDefinitions.find((candidate) => candidate.role === role);
		if (!paneDefinition) {
			throw new Error(`Workspace pane '${role}' does not exist.`);
		}
		return paneDefinition;
	}

	private async assertRuntimeSession(runtime: ResolvedWorkspaceRuntime): Promise<void> {
		if (!this.isManagedRuntime(runtime)) {
			throw new Error(getUnmanagedRuntimeMessage(runtime.workspace.id));
		}
		if (!(await this.options.tmuxRuntime.isTmuxAvailable())) {
			throw new Error("tmux is not installed or unavailable.");
		}
		if (
			!(await this.options.tmuxRuntime.hasSession({
				socketPath: runtime.socketPath,
				sessionName: runtime.sessionName,
			}))
		) {
			throw new Error("Workspace runtime session is missing.");
		}
	}

	async openWorkspace(workspaceId: string): Promise<WorkspaceRuntimeState> {
		return this.ensureWorkspaceRuntime(workspaceId);
	}

	async resumeWorkspace(workspaceId: string): Promise<WorkspaceRuntimeState> {
		await this.options.workspaceStore.updateWorkspaceStatus(workspaceId, "starting");
		return this.ensureWorkspaceRuntime(workspaceId);
	}

	async pauseWorkspace(workspaceId: string): Promise<void> {
		const workspace = await this.getWorkspace(workspaceId);
		const runtime = this.resolveRuntime(workspace);
		if (!this.isAppManagedSocketPath(runtime.socketPath)) {
			throw new Error(`Refusing to pause workspace '${workspaceId}' with unmanaged tmux socket.`);
		}
		let snapshotErrorMessage: string | undefined;
		try {
			await this.options.snapshotBeforePause?.(workspaceId);
		} catch (error) {
			snapshotErrorMessage = error instanceof Error ? error.message : String(error);
		}
		if (
			await this.options.tmuxRuntime.hasSession({ socketPath: runtime.socketPath, sessionName: runtime.sessionName })
		) {
			await this.options.tmuxRuntime.killSession({
				socketPath: runtime.socketPath,
				sessionName: runtime.sessionName,
			});
		}
		await this.options.workspaceStore.updateWorkspace(workspaceId, {
			status: "paused",
			lastActivityAt: toTimestamp(this.now),
			tmuxSessionName: runtime.sessionName,
			tmuxSocketPath: runtime.socketPath,
		});
		if (snapshotErrorMessage) {
			throw new Error(`Workspace runtime paused, but snapshot before pause failed: ${snapshotErrorMessage}`);
		}
	}

	async archiveWorkspaceRuntime(workspaceId: string): Promise<void> {
		const workspace = await this.getWorkspace(workspaceId);
		const runtime = this.resolveRuntime(workspace);
		if (
			this.isAppManagedSocketPath(runtime.socketPath) &&
			(await this.options.tmuxRuntime.hasSession({
				socketPath: runtime.socketPath,
				sessionName: runtime.sessionName,
			}))
		) {
			await this.options.tmuxRuntime.killSession({
				socketPath: runtime.socketPath,
				sessionName: runtime.sessionName,
			});
		}
		await this.options.workspaceStore.archiveWorkspace(workspaceId);
	}

	async ensureWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntimeState> {
		const workspace = await this.getWorkspace(workspaceId);
		const runtime = this.resolveRuntime(workspace);
		if (!this.isManagedRuntime(runtime)) {
			await this.options.workspaceStore.updateWorkspaceStatus(workspaceId, "crashed");
			return this.createUnmanagedRuntimeState(workspaceId, runtime);
		}
		const tmuxAvailable = await this.options.tmuxRuntime.isTmuxAvailable();
		if (!tmuxAvailable) {
			return {
				workspaceId,
				status: "unavailable",
				tmuxAvailable: false,
				socketPath: runtime.socketPath,
				sessionName: runtime.sessionName,
				panes: workspace.paneDefinitions.map((paneDefinition) =>
					mapPaneDefinitionToState(paneDefinition, undefined),
				),
				errorMessage: "tmux is not installed or unavailable.",
			};
		}

		try {
			const workspaceWithRuntimeFields = await this.persistRuntimeFields(runtime);
			const nextRuntime = this.resolveRuntime(workspaceWithRuntimeFields);
			if (workspaceWithRuntimeFields.status !== "running") {
				await this.options.workspaceStore.updateWorkspaceStatus(workspaceId, "starting");
			}
			await this.options.tmuxRuntime.ensureSession({
				socketPath: nextRuntime.socketPath,
				sessionName: nextRuntime.sessionName,
				cwd: nextRuntime.cwd,
				historyLimit: nextRuntime.workspace.resourcePolicy.historyLimit,
			});
			const panes = await this.ensureWorkspacePanes(workspaceId);
			await this.options.workspaceStore.updateWorkspace(workspaceId, {
				status: "running",
				lastOpenedAt: toTimestamp(this.now),
				lastActivityAt: toTimestamp(this.now),
				tmuxSessionName: nextRuntime.sessionName,
				tmuxSocketPath: nextRuntime.socketPath,
			});
			return {
				workspaceId,
				status: "running",
				tmuxAvailable: true,
				socketPath: nextRuntime.socketPath,
				sessionName: nextRuntime.sessionName,
				panes,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (error instanceof TmuxRuntimeError && error.code === "tmux_unavailable") {
				return {
					workspaceId,
					status: "unavailable",
					tmuxAvailable: false,
					socketPath: runtime.socketPath,
					sessionName: runtime.sessionName,
					panes: workspace.paneDefinitions.map((paneDefinition) =>
						mapPaneDefinitionToState(paneDefinition, undefined),
					),
					errorMessage: message,
				};
			}
			await this.options.workspaceStore.updateWorkspaceStatus(workspaceId, "crashed");
			return {
				workspaceId,
				status: "error",
				tmuxAvailable: true,
				socketPath: runtime.socketPath,
				sessionName: runtime.sessionName,
				panes: workspace.paneDefinitions.map((paneDefinition) =>
					mapPaneDefinitionToState(paneDefinition, undefined),
				),
				errorMessage: message,
			};
		}
	}

	async ensureWorkspacePanes(workspaceId: string): Promise<WorkspacePaneState[]> {
		const workspace = await this.getWorkspace(workspaceId);
		const runtime = this.resolveRuntime(workspace);
		if (!this.isManagedRuntime(runtime)) {
			throw new Error(getUnmanagedRuntimeMessage(workspaceId));
		}
		const existingPanes = await this.options.tmuxRuntime.listPanes({
			socketPath: runtime.socketPath,
			sessionName: runtime.sessionName,
		});
		const existingWindowNames = new Set(existingPanes.map((paneInfo) => paneInfo.windowName));
		for (const paneDefinition of workspace.paneDefinitions) {
			const windowName = getPaneWindowName(paneDefinition);
			if (existingWindowNames.has(windowName)) {
				continue;
			}
			await this.options.tmuxRuntime.newWindow({
				socketPath: runtime.socketPath,
				sessionName: runtime.sessionName,
				windowName,
				cwd: paneDefinition.cwd ?? runtime.cwd,
				...(paneDefinition.command ? { command: paneDefinition.command } : {}),
			});
			existingWindowNames.add(windowName);
		}
		return this.listPaneStates(runtime);
	}

	async stopPane(workspaceId: string, role: DesktopWorkspacePaneRole): Promise<WorkspaceRuntimeState> {
		const workspace = await this.getWorkspace(workspaceId);
		const paneDefinition = this.getPaneDefinition(workspace, role);
		const runtime = this.resolveRuntime(workspace);
		await this.assertRuntimeSession(runtime);
		const panes = await this.listPaneStates(runtime);
		const pane = panes.find((candidate) => candidate.role === role);
		if (!pane || pane.state !== "running" || pane.dead) {
			throw new Error(`Workspace pane '${role}' is not running.`);
		}
		await this.options.tmuxRuntime.killWindow({
			socketPath: runtime.socketPath,
			sessionName: runtime.sessionName,
			windowName: getPaneWindowName(paneDefinition),
		});
		await this.options.workspaceStore.updateWorkspace(workspaceId, {
			lastActivityAt: toTimestamp(this.now),
		});
		return this.getWorkspaceRuntimeState(workspaceId);
	}

	async restartPane(workspaceId: string, role: DesktopWorkspacePaneRole): Promise<WorkspaceRuntimeState> {
		const workspace = await this.getWorkspace(workspaceId);
		const paneDefinition = this.getPaneDefinition(workspace, role);
		const runtime = this.resolveRuntime(workspace);
		if (!this.isManagedRuntime(runtime)) {
			throw new Error(getUnmanagedRuntimeMessage(workspaceId));
		}
		if (!(await this.options.tmuxRuntime.isTmuxAvailable())) {
			throw new Error("tmux is not installed or unavailable.");
		}
		const workspaceWithRuntimeFields = await this.persistRuntimeFields(runtime);
		const nextRuntime = this.resolveRuntime(workspaceWithRuntimeFields);
		await this.options.tmuxRuntime.ensureSession({
			socketPath: nextRuntime.socketPath,
			sessionName: nextRuntime.sessionName,
			cwd: nextRuntime.cwd,
			historyLimit: nextRuntime.workspace.resourcePolicy.historyLimit,
		});
		const panes = await this.options.tmuxRuntime.listPanes({
			socketPath: nextRuntime.socketPath,
			sessionName: nextRuntime.sessionName,
		});
		const windowName = getPaneWindowName(paneDefinition);
		if (panes.some((pane) => pane.windowName === windowName)) {
			await this.options.tmuxRuntime.killWindow({
				socketPath: nextRuntime.socketPath,
				sessionName: nextRuntime.sessionName,
				windowName,
			});
		}
		await this.options.tmuxRuntime.newWindow({
			socketPath: nextRuntime.socketPath,
			sessionName: nextRuntime.sessionName,
			windowName,
			cwd: paneDefinition.cwd ?? nextRuntime.cwd,
			...(paneDefinition.command ? { command: paneDefinition.command } : {}),
		});
		await this.options.workspaceStore.updateWorkspace(workspaceId, {
			status: "running",
			lastActivityAt: toTimestamp(this.now),
			lastOpenedAt: toTimestamp(this.now),
			tmuxSessionName: nextRuntime.sessionName,
			tmuxSocketPath: nextRuntime.socketPath,
		});
		return this.getWorkspaceRuntimeState(workspaceId);
	}

	async getWorkspaceRuntimeState(workspaceId: string): Promise<WorkspaceRuntimeState> {
		const workspace = await this.getWorkspace(workspaceId);
		const runtime = this.resolveRuntime(workspace);
		if (!this.isManagedRuntime(runtime)) {
			return this.createUnmanagedRuntimeState(workspaceId, runtime);
		}
		if (workspace.status === "archived") {
			return {
				workspaceId,
				status: "archived",
				tmuxAvailable: await this.options.tmuxRuntime.isTmuxAvailable(),
				socketPath: runtime.socketPath,
				sessionName: runtime.sessionName,
				panes: workspace.paneDefinitions.map((paneDefinition) =>
					mapPaneDefinitionToState(paneDefinition, undefined),
				),
			};
		}
		if (!(await this.options.tmuxRuntime.isTmuxAvailable())) {
			return {
				workspaceId,
				status: "unavailable",
				tmuxAvailable: false,
				socketPath: runtime.socketPath,
				sessionName: runtime.sessionName,
				panes: workspace.paneDefinitions.map((paneDefinition) =>
					mapPaneDefinitionToState(paneDefinition, undefined),
				),
				errorMessage: "tmux is not installed or unavailable.",
			};
		}
		if (
			!(await this.options.tmuxRuntime.hasSession({
				socketPath: runtime.socketPath,
				sessionName: runtime.sessionName,
			}))
		) {
			return {
				workspaceId,
				status: workspace.status === "running" ? "error" : "paused",
				tmuxAvailable: true,
				socketPath: runtime.socketPath,
				sessionName: runtime.sessionName,
				panes: workspace.paneDefinitions.map((paneDefinition) =>
					mapPaneDefinitionToState(paneDefinition, undefined),
				),
				...(workspace.status === "running" ? { errorMessage: "Workspace runtime session is missing." } : {}),
			};
		}
		return {
			workspaceId,
			status: "running",
			tmuxAvailable: true,
			socketPath: runtime.socketPath,
			sessionName: runtime.sessionName,
			panes: await this.listPaneStates(runtime),
		};
	}
}
