import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonPaneSnapshotStore } from "../../src/main/context/context-harvester.ts";
import type { TmuxPaneInfo, TmuxRuntime } from "../../src/main/tmux/tmux-runtime.ts";
import { WorkspaceResourceGovernor } from "../../src/main/workspace/resource-governor.ts";
import type { WorkspaceRuntimeState } from "../../src/main/workspace/workspace-runtime-orchestrator.ts";
import { DesktopWorkspaceStore } from "../../src/main/workspace/workspace-store.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-resource-governor-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

class FakeTmuxRuntime implements TmuxRuntime {
	readonly panesBySocketPath = new Map<string, TmuxPaneInfo[]>();

	async isTmuxAvailable(): Promise<boolean> {
		return true;
	}

	async hasSession(): Promise<boolean> {
		return true;
	}

	async ensureSession(): Promise<{ created: boolean; sessionName: string }> {
		return { created: false, sessionName: "unused" };
	}

	async newWindow(): Promise<void> {}

	async listPanes(input: { socketPath: string }): Promise<TmuxPaneInfo[]> {
		return this.panesBySocketPath.get(input.socketPath) ?? [];
	}

	async capturePane(): Promise<string> {
		return "";
	}

	async sendText(): Promise<void> {}

	async killWindow(): Promise<void> {}

	async killSession(): Promise<void> {}
}

describe("WorkspaceResourceGovernor", () => {
	it("reconciles missing running sessions and reports orphan app-owned tmux sessions", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const missing = await workspaceStore.createWorkspace({
			id: "missing-runtime",
			repoPath: join(directoryPath, "repo-a"),
			status: "running",
			tmuxSocketPath: join(directoryPath, "runtime", "tmux", "ws_missing-runtime.sock"),
			tmuxSessionName: "ws_missing_runtime",
		});
		const healthy = await workspaceStore.createWorkspace({
			id: "healthy-runtime",
			repoPath: join(directoryPath, "repo-b"),
			status: "running",
			tmuxSocketPath: join(directoryPath, "runtime", "tmux", "ws_healthy-runtime.sock"),
			tmuxSessionName: "ws_healthy_runtime",
		});
		const orphanSocketPath = join(directoryPath, "runtime", "tmux", "ws_orphan.sock");
		const tmuxRuntime = new FakeTmuxRuntime();
		tmuxRuntime.panesBySocketPath.set(orphanSocketPath, [
			{
				sessionName: "ws_orphan",
				windowId: "@1",
				windowName: "shell",
				paneId: "%1",
				paneIndex: 0,
				currentCommand: "zsh",
				currentPath: "/workspace/orphan",
				dead: false,
			},
		]);
		const workspaceRuntime = {
			getWorkspaceRuntimeState: vi.fn(async (workspaceId: string): Promise<WorkspaceRuntimeState> => {
				if (workspaceId === missing.id) {
					return {
						workspaceId,
						status: "error",
						tmuxAvailable: true,
						panes: [],
						errorMessage: "Workspace runtime session is missing.",
					};
				}
				return {
					workspaceId,
					status: "running",
					tmuxAvailable: true,
					panes: [
						{
							role: "test",
							title: "Tests",
							windowName: "test",
							paneId: "%2",
							controlOwner: "none",
							dead: true,
							state: "dead",
						},
					],
				};
			}),
			pauseWorkspace: vi.fn(async () => undefined),
		};
		const governor = new WorkspaceResourceGovernor({
			listRuntimeSocketPaths: async () => [missing.tmuxSocketPath!, healthy.tmuxSocketPath!, orphanSocketPath],
			runtimeRootDir: join(directoryPath, "runtime"),
			tmuxRuntime,
			workspaceRuntime,
			workspaceStore,
		});

		const report = await governor.reconcileWorkspacesOnStartup();

		expect(report.pausedMissingWorkspaces).toEqual([missing.id]);
		expect(report.deadPanes).toEqual([
			expect.objectContaining({ workspaceId: healthy.id, paneRole: "test", paneId: "%2" }),
		]);
		expect(report.orphanSessions).toEqual([
			expect.objectContaining({ socketPath: orphanSocketPath, sessionName: "ws_orphan" }),
		]);
		expect(await workspaceStore.getWorkspace(missing.id)).toEqual(expect.objectContaining({ status: "paused" }));
		expect(await workspaceStore.getWorkspace(healthy.id)).toEqual(expect.objectContaining({ status: "running" }));
	});

	it("pauses idle unpinned workspaces but skips pinned and pending-approval workspaces", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const idle = await workspaceStore.createWorkspace({
			id: "idle",
			repoPath: join(directoryPath, "idle"),
			status: "running",
			resourcePolicy: { idlePauseMinutes: 10 },
		});
		const pinned = await workspaceStore.createWorkspace({
			id: "pinned",
			pinned: true,
			repoPath: join(directoryPath, "pinned"),
			status: "running",
			resourcePolicy: { idlePauseMinutes: 10 },
		});
		const pending = await workspaceStore.createWorkspace({
			id: "pending",
			repoPath: join(directoryPath, "pending"),
			status: "running",
			resourcePolicy: { idlePauseMinutes: 10 },
		});
		await workspaceStore.updateWorkspace(idle.id, { lastActivityAt: "2026-05-19T09:00:00.000Z" });
		await workspaceStore.updateWorkspace(pinned.id, { lastActivityAt: "2026-05-19T09:00:00.000Z" });
		await workspaceStore.updateWorkspace(pending.id, { lastActivityAt: "2026-05-19T09:00:00.000Z" });
		const workspaceRuntime = {
			getWorkspaceRuntimeState: vi.fn(
				async (workspaceId: string): Promise<WorkspaceRuntimeState> => ({
					workspaceId,
					status: "running",
					tmuxAvailable: true,
					panes: [],
				}),
			),
			pauseWorkspace: vi.fn(async () => undefined),
		};
		const governor = new WorkspaceResourceGovernor({
			listPendingRuntimeApprovals: async (workspaceId) => (workspaceId === pending.id ? [{ id: "approval-1" }] : []),
			now: () => new Date("2026-05-19T10:00:00.000Z"),
			runtimeRootDir: join(directoryPath, "runtime"),
			tmuxRuntime: new FakeTmuxRuntime(),
			workspaceRuntime,
			workspaceStore,
		});

		const report = await governor.pauseIdleWorkspaces();

		expect(report.pausedWorkspaceIds).toEqual([idle.id]);
		expect(workspaceRuntime.pauseWorkspace).toHaveBeenCalledWith(idle.id);
		expect(workspaceRuntime.pauseWorkspace).not.toHaveBeenCalledWith(pinned.id);
		expect(workspaceRuntime.pauseWorkspace).not.toHaveBeenCalledWith(pending.id);
	});

	it("keeps idle workspaces with active long-running panes alive", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const longRunning = await workspaceStore.createWorkspace({
			id: "long-running",
			repoPath: join(directoryPath, "long-running"),
			status: "running",
			resourcePolicy: { idlePauseMinutes: 10 },
		});
		const idleShell = await workspaceStore.createWorkspace({
			id: "idle-shell",
			repoPath: join(directoryPath, "idle-shell"),
			status: "running",
			resourcePolicy: { idlePauseMinutes: 10 },
		});
		await workspaceStore.updateWorkspace(longRunning.id, { lastActivityAt: "2026-05-19T09:00:00.000Z" });
		await workspaceStore.updateWorkspace(idleShell.id, { lastActivityAt: "2026-05-19T09:00:00.000Z" });
		const workspaceRuntime = {
			getWorkspaceRuntimeState: vi.fn(async (workspaceId: string): Promise<WorkspaceRuntimeState> => {
				const currentCommand = workspaceId === longRunning.id ? "vitest" : "zsh";
				return {
					workspaceId,
					status: "running",
					tmuxAvailable: true,
					panes: [
						{
							role: workspaceId === longRunning.id ? "test" : "shell",
							title: workspaceId === longRunning.id ? "Tests" : "Shell",
							windowName: workspaceId === longRunning.id ? "test" : "shell",
							paneId: "%1",
							currentCommand,
							controlOwner: "none",
							dead: false,
							state: "running",
						},
					],
				};
			}),
			pauseWorkspace: vi.fn(async () => undefined),
		};
		const governor = new WorkspaceResourceGovernor({
			now: () => new Date("2026-05-19T10:00:00.000Z"),
			runtimeRootDir: join(directoryPath, "runtime"),
			tmuxRuntime: new FakeTmuxRuntime(),
			workspaceRuntime,
			workspaceStore,
		});

		const longRunningActivity = await governor.getWorkspaceRuntimeActivity(longRunning.id);
		const report = await governor.pauseIdleWorkspaces();

		expect(longRunningActivity).toEqual(
			expect.objectContaining({
				activeLongRunningPaneCount: 1,
				pauseCandidate: false,
				reason: "active runtime pane",
			}),
		);
		expect(report.pausedWorkspaceIds).toEqual([idleShell.id]);
		expect(report.skippedWorkspaceIds).toEqual([longRunning.id]);
		expect(workspaceRuntime.pauseWorkspace).toHaveBeenCalledWith(idleShell.id);
		expect(workspaceRuntime.pauseWorkspace).not.toHaveBeenCalledWith(longRunning.id);
	});

	it("pauses least-recent unpinned workspaces when hot runtime count exceeds policy", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const created = [];
		for (const id of ["oldest", "older", "newer", "newest"]) {
			created.push(
				await workspaceStore.createWorkspace({
					id,
					repoPath: join(directoryPath, id),
					status: "running",
					resourcePolicy: { idlePauseMinutes: 1000, maxHotWorkspaces: 2 },
				}),
			);
		}
		await workspaceStore.updateWorkspace(created[0]!.id, { lastActivityAt: "2026-05-19T09:00:00.000Z" });
		await workspaceStore.updateWorkspace(created[1]!.id, { lastActivityAt: "2026-05-19T09:10:00.000Z" });
		await workspaceStore.updateWorkspace(created[2]!.id, { lastActivityAt: "2026-05-19T09:20:00.000Z" });
		await workspaceStore.updateWorkspace(created[3]!.id, { lastActivityAt: "2026-05-19T09:30:00.000Z" });
		const workspaceRuntime = {
			getWorkspaceRuntimeState: vi.fn(
				async (workspaceId: string): Promise<WorkspaceRuntimeState> => ({
					workspaceId,
					status: "running",
					tmuxAvailable: true,
					panes: [],
				}),
			),
			pauseWorkspace: vi.fn(async () => undefined),
		};
		const governor = new WorkspaceResourceGovernor({
			now: () => new Date("2026-05-19T10:00:00.000Z"),
			runtimeRootDir: join(directoryPath, "runtime"),
			tmuxRuntime: new FakeTmuxRuntime(),
			workspaceRuntime,
			workspaceStore,
		});

		const report = await governor.pauseIdleWorkspaces();

		expect(report.pausedWorkspaceIds).toEqual([created[0]!.id, created[1]!.id]);
	});

	it("does not pause active long-running panes to satisfy the hot workspace limit", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const longRunning = await workspaceStore.createWorkspace({
			id: "long-running-hot",
			repoPath: join(directoryPath, "long-running-hot"),
			status: "running",
			resourcePolicy: { idlePauseMinutes: 1000, maxHotWorkspaces: 1 },
		});
		const older = await workspaceStore.createWorkspace({
			id: "older-hot",
			repoPath: join(directoryPath, "older-hot"),
			status: "running",
			resourcePolicy: { idlePauseMinutes: 1000, maxHotWorkspaces: 1 },
		});
		const newer = await workspaceStore.createWorkspace({
			id: "newer-hot",
			repoPath: join(directoryPath, "newer-hot"),
			status: "running",
			resourcePolicy: { idlePauseMinutes: 1000, maxHotWorkspaces: 1 },
		});
		await workspaceStore.updateWorkspace(longRunning.id, { lastActivityAt: "2026-05-19T09:00:00.000Z" });
		await workspaceStore.updateWorkspace(older.id, { lastActivityAt: "2026-05-19T09:10:00.000Z" });
		await workspaceStore.updateWorkspace(newer.id, { lastActivityAt: "2026-05-19T09:20:00.000Z" });
		const workspaceRuntime = {
			getWorkspaceRuntimeState: vi.fn(
				async (workspaceId: string): Promise<WorkspaceRuntimeState> => ({
					workspaceId,
					status: "running",
					tmuxAvailable: true,
					panes: [
						{
							role: "test",
							title: "Tests",
							windowName: "test",
							paneId: "%1",
							currentCommand: workspaceId === longRunning.id ? "node" : "zsh",
							controlOwner: "none",
							dead: false,
							state: "running",
						},
					],
				}),
			),
			pauseWorkspace: vi.fn(async () => undefined),
		};
		const governor = new WorkspaceResourceGovernor({
			now: () => new Date("2026-05-19T10:00:00.000Z"),
			runtimeRootDir: join(directoryPath, "runtime"),
			tmuxRuntime: new FakeTmuxRuntime(),
			workspaceRuntime,
			workspaceStore,
		});

		const report = await governor.pauseIdleWorkspaces();

		expect(report.pausedWorkspaceIds).toEqual([older.id]);
		expect(report.skippedWorkspaceIds).toHaveLength(2);
		expect(report.skippedWorkspaceIds).toEqual(expect.arrayContaining([longRunning.id, newer.id]));
		expect(workspaceRuntime.pauseWorkspace).not.toHaveBeenCalledWith(longRunning.id);
	});

	it("prunes snapshots older than the workspace retention policy", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const snapshotStore = new JsonPaneSnapshotStore(join(directoryPath, "workspaces", "snapshots", "index.json"));
		const workspace = await workspaceStore.createWorkspace({
			id: "snapshots",
			repoPath: join(directoryPath, "snapshots"),
			resourcePolicy: { snapshotRetentionDays: 7 },
		});
		await snapshotStore.save({
			id: "old",
			workspaceId: workspace.id,
			paneId: "%1",
			capturedAt: "2026-05-01T00:00:00.000Z",
			lineCount: 1,
			text: "old",
			rawTextStored: false,
			redactions: [],
			extractedBlocks: [],
		});
		await snapshotStore.save({
			id: "recent",
			workspaceId: workspace.id,
			paneId: "%1",
			capturedAt: "2026-05-18T00:00:00.000Z",
			lineCount: 1,
			text: "recent",
			rawTextStored: false,
			redactions: [],
			extractedBlocks: [],
		});
		const workspaceRuntime = {
			getWorkspaceRuntimeState: vi.fn(
				async (workspaceId: string): Promise<WorkspaceRuntimeState> => ({
					workspaceId,
					status: "paused",
					tmuxAvailable: true,
					panes: [],
				}),
			),
			pauseWorkspace: vi.fn(async () => undefined),
		};
		const governor = new WorkspaceResourceGovernor({
			now: () => new Date("2026-05-19T10:00:00.000Z"),
			runtimeRootDir: join(directoryPath, "runtime"),
			snapshotStore,
			tmuxRuntime: new FakeTmuxRuntime(),
			workspaceRuntime,
			workspaceStore,
		});

		const report = await governor.enforceLogAndSnapshotLimits(workspace.id);

		expect(report.deletedSnapshots).toBe(1);
		expect(await snapshotStore.list(workspace.id)).toEqual([expect.objectContaining({ id: "recent" })]);
	});
});
