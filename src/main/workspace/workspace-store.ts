import { createHash } from "node:crypto";
import { normalize, resolve } from "node:path";
import type {
	DesktopWorkspace,
	DesktopWorkspacePaneDefinition,
	DesktopWorkspaceResourcePolicy,
	DesktopWorkspaceStatus,
} from "../../shared/types.ts";
import { JsonFileStore } from "../storage/json-file-store.ts";

type WorkspaceIndex = Record<string, DesktopWorkspace>;

export interface DesktopWorkspaceCreateInput {
	id?: string;
	taskTitle?: string;
	projectId?: string;
	repoPath: string;
	worktreePath?: string;
	piSessionId?: string;
	piSessionPath?: string;
	tmuxSocketPath?: string;
	tmuxSessionName?: string;
	status?: DesktopWorkspaceStatus;
	paneDefinitions?: DesktopWorkspacePaneDefinition[];
	resourcePolicy?: Partial<DesktopWorkspaceResourcePolicy>;
	pinned?: boolean;
}

export interface DesktopWorkspaceLookupInput {
	repoPath: string;
	taskTitle?: string;
	projectId?: string;
	piSessionId?: string;
}

export interface DesktopWorkspaceListFilter {
	projectId?: string;
	repoPath?: string;
	status?: DesktopWorkspaceStatus;
}

export interface DesktopWorkspacePatch {
	lastActivityAt?: string;
	lastOpenedAt?: string;
	paneDefinitions?: DesktopWorkspacePaneDefinition[];
	piSessionId?: string;
	piSessionPath?: string;
	pinned?: boolean;
	resourcePolicy?: Partial<DesktopWorkspaceResourcePolicy>;
	status?: DesktopWorkspaceStatus;
	taskTitle?: string;
	tmuxSessionName?: string;
	tmuxSocketPath?: string;
	worktreePath?: string;
}

export const DEFAULT_DESKTOP_WORKSPACE_RESOURCE_POLICY: DesktopWorkspaceResourcePolicy = {
	historyLimit: 20_000,
	idlePauseMinutes: 120,
	maxWorkspaceLogBytes: 200 * 1024 * 1024,
	maxHotWorkspaces: 3,
	snapshotRetentionDays: 7,
};

export const DEFAULT_DESKTOP_WORKSPACE_PANE_DEFINITIONS: DesktopWorkspacePaneDefinition[] = [
	{ id: "agent", role: "agent", title: "Agent" },
	{ id: "shell", role: "shell", title: "Shell" },
	{ id: "dev-server", role: "dev-server", title: "Dev Server" },
	{ id: "test", role: "test", title: "Test" },
	{ id: "logs", role: "logs", title: "Logs" },
];

const ALLOWED_STATUS_TRANSITIONS: Record<DesktopWorkspaceStatus, readonly DesktopWorkspaceStatus[]> = {
	created: ["created", "starting", "running", "paused", "archived", "crashed"],
	starting: ["starting", "running", "paused", "archived", "crashed"],
	running: ["running", "paused", "archived", "crashed"],
	paused: ["paused", "starting", "running", "archived", "crashed"],
	archived: ["archived"],
	crashed: ["crashed", "starting", "running", "paused", "archived"],
};

function normalizePath(path: string): string {
	return normalize(resolve(path));
}

function normalizeTaskTitle(taskTitle: string | undefined): string | undefined {
	const normalized = taskTitle?.trim().replace(/\s+/g, " ");
	return normalized ? normalized : undefined;
}

function normalizeWorkspaceId(id: string): string {
	const sanitized = id
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 80);
	return sanitized.startsWith("ws_") ? sanitized : `ws_${sanitized || "workspace"}`;
}

function deriveWorkspaceId(input: DesktopWorkspaceLookupInput): string {
	const hash = createHash("sha256")
		.update(
			JSON.stringify({
				projectId: input.projectId,
				repoPath: normalizePath(input.repoPath),
				taskTitle: normalizeTaskTitle(input.taskTitle),
				piSessionId: input.piSessionId,
			}),
		)
		.digest("hex")
		.slice(0, 16);
	return `ws_${hash}`;
}

export function deriveTmuxSessionName(workspaceId: string): string {
	return normalizeWorkspaceId(workspaceId);
}

function mergeResourcePolicy(
	policy: Partial<DesktopWorkspaceResourcePolicy> | undefined,
): DesktopWorkspaceResourcePolicy {
	return {
		...DEFAULT_DESKTOP_WORKSPACE_RESOURCE_POLICY,
		...(policy ?? {}),
	};
}

function clonePaneDefinitions(
	paneDefinitions: readonly DesktopWorkspacePaneDefinition[] | undefined,
): DesktopWorkspacePaneDefinition[] {
	return (paneDefinitions ?? DEFAULT_DESKTOP_WORKSPACE_PANE_DEFINITIONS).map((paneDefinition) => ({
		...paneDefinition,
	}));
}

function sortWorkspacesByRecency(workspaces: DesktopWorkspace[]): DesktopWorkspace[] {
	return workspaces.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function matchesWorkspaceLookup(workspace: DesktopWorkspace, input: DesktopWorkspaceLookupInput): boolean {
	if (normalizePath(workspace.repoPath) !== normalizePath(input.repoPath)) {
		return false;
	}
	if (input.projectId && workspace.projectId !== input.projectId) {
		return false;
	}
	if (input.piSessionId && workspace.piSessionId !== input.piSessionId) {
		return false;
	}
	const taskTitle = normalizeTaskTitle(input.taskTitle);
	return normalizeTaskTitle(workspace.taskTitle) === taskTitle;
}

function assertAllowedStatusTransition(current: DesktopWorkspaceStatus, next: DesktopWorkspaceStatus): void {
	if (!ALLOWED_STATUS_TRANSITIONS[current].includes(next)) {
		throw new Error(`Invalid workspace status transition from '${current}' to '${next}'.`);
	}
}

export class DesktopWorkspaceStore {
	private readonly indexStore: JsonFileStore<WorkspaceIndex>;

	constructor(indexFilePath: string) {
		this.indexStore = new JsonFileStore(indexFilePath, {});
	}

	async createWorkspace(input: DesktopWorkspaceCreateInput): Promise<DesktopWorkspace> {
		let workspace: DesktopWorkspace | undefined;
		await this.indexStore.update((current) => {
			const lookupInput: DesktopWorkspaceLookupInput = {
				projectId: input.projectId,
				repoPath: input.repoPath,
				taskTitle: input.taskTitle,
				piSessionId: input.piSessionId,
			};
			const existingWorkspace = Object.values(current).find(
				(candidate) => candidate.status !== "archived" && matchesWorkspaceLookup(candidate, lookupInput),
			);
			if (existingWorkspace) {
				workspace = existingWorkspace;
				return current;
			}

			const timestamp = new Date().toISOString();
			const baseId = input.id ? normalizeWorkspaceId(input.id) : deriveWorkspaceId(lookupInput);
			const id =
				current[baseId]?.status === "archived"
					? normalizeWorkspaceId(`${baseId}_${timestamp.replace(/[^0-9]+/g, "").slice(0, 14)}`)
					: baseId;
			const nextWorkspace: DesktopWorkspace = {
				id,
				...(normalizeTaskTitle(input.taskTitle) ? { taskTitle: normalizeTaskTitle(input.taskTitle) } : {}),
				...(input.projectId ? { projectId: input.projectId } : {}),
				repoPath: normalizePath(input.repoPath),
				...(input.worktreePath ? { worktreePath: normalizePath(input.worktreePath) } : {}),
				...(input.piSessionId ? { piSessionId: input.piSessionId } : {}),
				...(input.piSessionPath ? { piSessionPath: input.piSessionPath } : {}),
				...(input.tmuxSocketPath ? { tmuxSocketPath: input.tmuxSocketPath } : {}),
				tmuxSessionName: input.tmuxSessionName ?? deriveTmuxSessionName(id),
				status: input.status ?? "created",
				paneDefinitions: clonePaneDefinitions(input.paneDefinitions),
				resourcePolicy: mergeResourcePolicy(input.resourcePolicy),
				...(input.pinned === undefined ? {} : { pinned: input.pinned }),
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			workspace = nextWorkspace;
			return {
				...current,
				[nextWorkspace.id]: nextWorkspace,
			};
		});

		if (!workspace) {
			throw new Error("Failed to create workspace.");
		}
		return workspace;
	}

	async getWorkspace(workspaceId: string): Promise<DesktopWorkspace | null> {
		const index = await this.indexStore.read();
		return index[normalizeWorkspaceId(workspaceId)] ?? null;
	}

	async listWorkspaces(filter: DesktopWorkspaceListFilter = {}): Promise<DesktopWorkspace[]> {
		const repoPath = filter.repoPath ? normalizePath(filter.repoPath) : undefined;
		const index = await this.indexStore.read();
		return sortWorkspacesByRecency(
			Object.values(index).filter((workspace) => {
				if (filter.projectId && workspace.projectId !== filter.projectId) {
					return false;
				}
				if (filter.status && workspace.status !== filter.status) {
					return false;
				}
				if (repoPath && normalizePath(workspace.repoPath) !== repoPath) {
					return false;
				}
				return true;
			}),
		);
	}

	async findWorkspaceByRepoOrTask(input: DesktopWorkspaceLookupInput): Promise<DesktopWorkspace | null> {
		const index = await this.indexStore.read();
		return Object.values(index).find((workspace) => matchesWorkspaceLookup(workspace, input)) ?? null;
	}

	async updateWorkspace(workspaceId: string, patch: DesktopWorkspacePatch): Promise<DesktopWorkspace | null> {
		const normalizedId = normalizeWorkspaceId(workspaceId);
		let updatedWorkspace: DesktopWorkspace | null = null;
		await this.indexStore.update((current) => {
			const workspace = current[normalizedId];
			if (!workspace) {
				return current;
			}

			const nextStatus = patch.status ?? workspace.status;
			assertAllowedStatusTransition(workspace.status, nextStatus);
			const nextWorkspace: DesktopWorkspace = {
				...workspace,
				...(patch.lastActivityAt !== undefined ? { lastActivityAt: patch.lastActivityAt } : {}),
				...(patch.lastOpenedAt !== undefined ? { lastOpenedAt: patch.lastOpenedAt } : {}),
				...(patch.paneDefinitions ? { paneDefinitions: clonePaneDefinitions(patch.paneDefinitions) } : {}),
				...(patch.piSessionId !== undefined ? { piSessionId: patch.piSessionId } : {}),
				...(patch.piSessionPath !== undefined ? { piSessionPath: patch.piSessionPath } : {}),
				...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
				...(patch.resourcePolicy ? { resourcePolicy: mergeResourcePolicy(patch.resourcePolicy) } : {}),
				...(patch.taskTitle !== undefined ? { taskTitle: normalizeTaskTitle(patch.taskTitle) } : {}),
				...(patch.tmuxSessionName !== undefined ? { tmuxSessionName: patch.tmuxSessionName } : {}),
				...(patch.tmuxSocketPath !== undefined ? { tmuxSocketPath: patch.tmuxSocketPath } : {}),
				...(patch.worktreePath !== undefined
					? { worktreePath: patch.worktreePath ? normalizePath(patch.worktreePath) : undefined }
					: {}),
				status: nextStatus,
				updatedAt: new Date().toISOString(),
			};
			updatedWorkspace = nextWorkspace;
			return {
				...current,
				[normalizedId]: nextWorkspace,
			};
		});
		return updatedWorkspace;
	}

	async updateWorkspaceStatus(workspaceId: string, status: DesktopWorkspaceStatus): Promise<DesktopWorkspace | null> {
		return this.updateWorkspace(workspaceId, { status });
	}

	async markWorkspaceActivity(
		workspaceId: string,
		activityAt: string = new Date().toISOString(),
	): Promise<DesktopWorkspace | null> {
		return this.updateWorkspace(workspaceId, { lastActivityAt: activityAt });
	}

	async archiveWorkspace(workspaceId: string): Promise<DesktopWorkspace | null> {
		return this.updateWorkspace(workspaceId, { status: "archived" });
	}

	async deleteWorkspace(workspaceId: string): Promise<boolean> {
		const normalizedId = normalizeWorkspaceId(workspaceId);
		let deleted = false;
		await this.indexStore.update((current) => {
			if (!Object.hasOwn(current, normalizedId)) {
				return current;
			}
			const next = { ...current };
			delete next[normalizedId];
			deleted = true;
			return next;
		});
		return deleted;
	}
}
