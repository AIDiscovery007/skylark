import { createHash } from "node:crypto";
import type {
	DesktopEnvironmentResource,
	DesktopEnvironmentResourceKind,
	DesktopEnvironmentResourceProvider,
	DesktopEnvironmentResourceStatus,
	DesktopWorkspace,
	DesktopWorkspacePaneDefinition,
} from "../../shared/types.ts";
import { JsonFileStore } from "../storage/json-file-store.ts";

type EnvironmentResourceIndex = Record<string, DesktopEnvironmentResource>;

export interface DesktopEnvironmentResourceListFilter {
	provider?: DesktopEnvironmentResourceProvider;
	sessionId?: string;
	status?: DesktopEnvironmentResourceStatus;
}

export interface EnvironmentResourceUpsertInput {
	id: string;
	sessionId: string;
	projectId?: string;
	cwd: string;
	kind: DesktopEnvironmentResourceKind;
	provider: DesktopEnvironmentResourceProvider;
	parentId?: string;
	title: string;
	status: DesktopEnvironmentResourceStatus;
	metadata?: Record<string, string | undefined>;
	createdAt?: string;
	updatedAt?: string;
	lastSeenAt?: string;
}

export interface TmuxDiscoveredWindow {
	windowName: string;
	options?: Record<string, string | undefined>;
	paneId?: string;
	currentCommand?: string;
	currentPath?: string;
}

export interface TmuxDiscoveredSession {
	sessionName: string;
	options?: Record<string, string | undefined>;
	socketPath?: string;
	windows: TmuxDiscoveredWindow[];
}

export interface EnvironmentResourceClock {
	now?: () => Date;
}

function toTimestamp(now: () => Date): string {
	return now().toISOString();
}

function createStableResourceId(kind: DesktopEnvironmentResourceKind, key: string): string {
	return `env_${createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 24)}`;
}

function compactMetadata(metadata: Record<string, string | undefined> | undefined): Record<string, string> {
	const compacted: Record<string, string> = {};
	for (const [key, value] of Object.entries(metadata ?? {})) {
		if (value !== undefined && value.length > 0) {
			compacted[key] = value;
		}
	}
	return compacted;
}

function sortByRecency(resources: DesktopEnvironmentResource[]): DesktopEnvironmentResource[] {
	return resources.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function mapWorkspaceStatus(status: DesktopWorkspace["status"]): DesktopEnvironmentResourceStatus {
	if (status === "archived") {
		return "detached";
	}
	if (status === "running") {
		return "running";
	}
	return "stale";
}

function getWorkspaceCwd(workspace: DesktopWorkspace): string {
	return workspace.worktreePath ?? workspace.repoPath;
}

function getWorkspaceTitle(workspace: DesktopWorkspace): string {
	return (
		workspace.taskTitle?.trim() ||
		workspace.repoPath
			.split(/[\\/]/)
			.filter((part) => part.length > 0)
			.at(-1) ||
		"Workspace"
	);
}

function createLegacySessionResourceId(workspace: DesktopWorkspace): string {
	return createStableResourceId(
		"tmux_session",
		`${workspace.piSessionId ?? ""}:${workspace.tmuxSocketPath ?? ""}:${workspace.tmuxSessionName ?? workspace.id}`,
	);
}

function createLegacyWindowResourceId(
	workspace: DesktopWorkspace,
	paneDefinition: DesktopWorkspacePaneDefinition,
): string {
	return createStableResourceId(
		"tmux_window",
		`${workspace.piSessionId ?? ""}:${workspace.tmuxSocketPath ?? ""}:${workspace.tmuxSessionName ?? workspace.id}:${paneDefinition.role}`,
	);
}

function createTmuxSessionResourceId(sessionName: string, sessionId: string): string {
	return createStableResourceId("tmux_session", `${sessionId}:${sessionName}`);
}

function createTmuxWindowResourceId(sessionName: string, windowName: string, sessionId: string): string {
	return createStableResourceId("tmux_window", `${sessionId}:${sessionName}:${windowName}`);
}

function getTmuxOption(
	options: Record<string, string | undefined> | undefined,
	skylarkKey: string,
	legacyPiKey: string,
): string | undefined {
	return options?.[skylarkKey] ?? options?.[legacyPiKey];
}

export class JsonEnvironmentResourceStore {
	private readonly store: JsonFileStore<EnvironmentResourceIndex>;

	constructor(indexFilePath: string) {
		this.store = new JsonFileStore(indexFilePath, {});
	}

	async upsertResource(
		input: EnvironmentResourceUpsertInput,
		clock: EnvironmentResourceClock = {},
	): Promise<DesktopEnvironmentResource> {
		const now = toTimestamp(clock.now ?? (() => new Date()));
		let upserted: DesktopEnvironmentResource | undefined;
		await this.store.update((current) => {
			const existing = current[input.id];
			const next: DesktopEnvironmentResource = {
				id: input.id,
				sessionId: input.sessionId,
				...(input.projectId ? { projectId: input.projectId } : {}),
				cwd: input.cwd,
				kind: input.kind,
				provider: input.provider,
				...(input.parentId ? { parentId: input.parentId } : {}),
				title: input.title,
				status: input.status,
				metadata: compactMetadata(input.metadata),
				createdAt: input.createdAt ?? existing?.createdAt ?? now,
				updatedAt: input.updatedAt ?? now,
				lastSeenAt: input.lastSeenAt ?? now,
			};
			upserted = next;
			return {
				...current,
				[input.id]: next,
			};
		});
		if (!upserted) {
			throw new Error("Failed to upsert environment resource.");
		}
		return upserted;
	}

	async listResources(filter: DesktopEnvironmentResourceListFilter = {}): Promise<DesktopEnvironmentResource[]> {
		const index = await this.store.read();
		return sortByRecency(
			Object.values(index).filter((resource) => {
				if (filter.provider && resource.provider !== filter.provider) {
					return false;
				}
				if (filter.sessionId && resource.sessionId !== filter.sessionId) {
					return false;
				}
				if (filter.status && resource.status !== filter.status) {
					return false;
				}
				return true;
			}),
		);
	}

	async getResource(resourceId: string): Promise<DesktopEnvironmentResource | null> {
		const index = await this.store.read();
		return index[resourceId] ?? null;
	}

	async detachResource(resourceId: string, clock: EnvironmentResourceClock = {}): Promise<DesktopEnvironmentResource> {
		const now = toTimestamp(clock.now ?? (() => new Date()));
		let detached: DesktopEnvironmentResource | undefined;
		await this.store.update((current) => {
			const existing = current[resourceId];
			if (!existing) {
				return current;
			}
			detached = {
				...existing,
				status: "detached",
				updatedAt: now,
			};
			return {
				...current,
				[resourceId]: detached,
			};
		});
		if (!detached) {
			throw new Error(`Environment resource '${resourceId}' does not exist.`);
		}
		return detached;
	}

	async markMissingTmuxResourcesStale(
		seenResourceIds: Set<string>,
		clock: EnvironmentResourceClock = {},
	): Promise<void> {
		const now = toTimestamp(clock.now ?? (() => new Date()));
		await this.store.update((current) => {
			const next: EnvironmentResourceIndex = {};
			for (const [resourceId, resource] of Object.entries(current)) {
				if (resource.provider === "tmux" && resource.status !== "detached" && !seenResourceIds.has(resourceId)) {
					next[resourceId] = {
						...resource,
						status: "stale",
						updatedAt: now,
					};
				} else {
					next[resourceId] = resource;
				}
			}
			return next;
		});
	}
}

export async function migrateWorkspaceRuntimeToEnvironmentResources(
	store: JsonEnvironmentResourceStore,
	workspace: DesktopWorkspace,
	clock: EnvironmentResourceClock = {},
): Promise<DesktopEnvironmentResource[]> {
	if (!workspace.piSessionId || !workspace.tmuxSessionName) {
		return [];
	}
	const now = toTimestamp(clock.now ?? (() => new Date()));
	const cwd = getWorkspaceCwd(workspace);
	const status = mapWorkspaceStatus(workspace.status);
	const sessionResource = await store.upsertResource(
		{
			id: createLegacySessionResourceId(workspace),
			sessionId: workspace.piSessionId,
			...(workspace.projectId ? { projectId: workspace.projectId } : {}),
			cwd,
			kind: "tmux_session",
			provider: "tmux",
			title: getWorkspaceTitle(workspace),
			status,
			metadata: {
				tmuxSessionName: workspace.tmuxSessionName,
				tmuxSocketPath: workspace.tmuxSocketPath,
				workspaceId: workspace.id,
			},
			createdAt: workspace.createdAt,
			updatedAt: now,
			lastSeenAt: now,
		},
		clock,
	);
	const migrated = [sessionResource];
	for (const paneDefinition of workspace.paneDefinitions) {
		migrated.push(
			await store.upsertResource(
				{
					id: createLegacyWindowResourceId(workspace, paneDefinition),
					sessionId: workspace.piSessionId,
					...(workspace.projectId ? { projectId: workspace.projectId } : {}),
					cwd: paneDefinition.cwd ?? cwd,
					kind: "tmux_window",
					provider: "tmux",
					parentId: sessionResource.id,
					title: paneDefinition.title,
					status,
					metadata: {
						paneRole: paneDefinition.role,
						tmuxSessionName: workspace.tmuxSessionName,
						tmuxSocketPath: workspace.tmuxSocketPath,
						tmuxWindowName: paneDefinition.role,
						workspaceId: workspace.id,
					},
					createdAt: workspace.createdAt,
					updatedAt: now,
					lastSeenAt: now,
				},
				clock,
			),
		);
	}
	return migrated;
}

export async function reconcileTmuxEnvironmentResources(
	store: JsonEnvironmentResourceStore,
	sessions: readonly TmuxDiscoveredSession[],
	clock: EnvironmentResourceClock = {},
): Promise<DesktopEnvironmentResource[]> {
	const now = toTimestamp(clock.now ?? (() => new Date()));
	const upserted: DesktopEnvironmentResource[] = [];
	const seenResourceIds = new Set<string>();
	for (const session of sessions) {
		const sessionId = getTmuxOption(session.options, "@skylark-session-id", "@pi-session-id");
		const cwd = getTmuxOption(session.options, "@skylark-cwd", "@pi-cwd");
		if (!sessionId || !cwd) {
			continue;
		}
		const sessionResourceId = createTmuxSessionResourceId(session.sessionName, sessionId);
		const sessionResource = await store.upsertResource(
			{
				id: sessionResourceId,
				sessionId,
				cwd,
				kind: "tmux_session",
				provider: "tmux",
				title: getTmuxOption(session.options, "@skylark-title", "@pi-title") ?? session.sessionName,
				status: "running",
				metadata: {
					tmuxSessionName: session.sessionName,
					tmuxSocketPath: session.socketPath,
				},
				updatedAt: now,
				lastSeenAt: now,
			},
			clock,
		);
		upserted.push(sessionResource);
		seenResourceIds.add(sessionResource.id);

		for (const window of session.windows) {
			const windowResourceId = createTmuxWindowResourceId(session.sessionName, window.windowName, sessionId);
			const windowResource = await store.upsertResource(
				{
					id: windowResourceId,
					sessionId,
					cwd: window.currentPath ?? cwd,
					kind: "tmux_window",
					provider: "tmux",
					parentId: sessionResource.id,
					title: getTmuxOption(window.options, "@skylark-title", "@pi-title") ?? window.windowName,
					status: "running",
					metadata: {
						currentCommand: window.currentCommand,
						currentPath: window.currentPath,
						paneId: window.paneId,
						tmuxSessionName: session.sessionName,
						tmuxSocketPath: session.socketPath,
						tmuxWindowName: window.windowName,
					},
					updatedAt: now,
					lastSeenAt: now,
				},
				clock,
			);
			upserted.push(windowResource);
			seenResourceIds.add(windowResource.id);
		}
	}
	await store.markMissingTmuxResourcesStale(seenResourceIds, clock);
	return upserted;
}
