import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JsonPaneSnapshotStore } from "../../src/main/context/context-harvester.ts";
import { createDesktopStoragePaths } from "../../src/main/storage/paths.ts";
import type { WorkspaceRuntimeState } from "../../src/main/workspace/workspace-runtime-orchestrator.ts";
import { DesktopWorkspaceStore } from "../../src/main/workspace/workspace-store.ts";
import { runWorkspaceRuntimeCli, type WorkspaceRuntimeCliServices } from "../../src/main/workspace-runtime-cli.ts";

describe("workspace runtime CLI", () => {
	it("prints workspace runtime status as JSON from a temp desktop storage root", async () => {
		const userDataDir = await mkdtemp(join(tmpdir(), "pi-desktop-runtime-cli-"));
		const agentHomeDir = join(userDataDir, ".skylark");
		const paths = createDesktopStoragePaths(userDataDir, { agentRootDir: agentHomeDir });
		const workspaceStore = new DesktopWorkspaceStore(paths.workspaceIndexFilePath);
		const workspace = await workspaceStore.createWorkspace({
			id: "ws_cli",
			repoPath: userDataDir,
			status: "paused",
			taskTitle: "cli-debug",
		});

		const result = await runWorkspaceRuntimeCli([
			"status",
			"--user-data-dir",
			userDataDir,
			"--agent-home",
			agentHomeDir,
		]);
		const parsed = JSON.parse(result.stdout) as {
			workspaces: Array<{ runtime: { workspaceId: string }; workspace: { id: string; taskTitle?: string } }>;
		};

		expect(result.exitCode).toBe(0);
		expect(parsed.workspaces).toEqual([
			expect.objectContaining({
				runtime: expect.objectContaining({ workspaceId: workspace.id }),
				workspace: expect.objectContaining({ id: workspace.id, taskTitle: "cli-debug" }),
			}),
		]);
		expect(result.stdout).not.toContain("tmuxSocketPath");
	});

	it("returns latest summaries without capturing new pane output", async () => {
		const userDataDir = await mkdtemp(join(tmpdir(), "pi-desktop-runtime-cli-"));
		const agentHomeDir = join(userDataDir, ".skylark");
		const paths = createDesktopStoragePaths(userDataDir, { agentRootDir: agentHomeDir });
		const workspaceStore = new DesktopWorkspaceStore(paths.workspaceIndexFilePath);
		await workspaceStore.createWorkspace({
			id: "ws_cli_summary",
			repoPath: userDataDir,
			status: "paused",
			taskTitle: "summary",
		});
		await new JsonPaneSnapshotStore(paths.workspaceSnapshotIndexFilePath).save({
			capturedAt: "2026-05-20T08:00:00.000Z",
			extractedBlocks: [{ kind: "error", text: "redacted summary only" }],
			id: "snap-cli",
			lineCount: 1,
			paneId: "%1",
			paneRole: "test",
			rawTextStored: false,
			redactions: [],
			text: "hidden full text",
			workspaceId: "ws_cli_summary",
		});

		const result = await runWorkspaceRuntimeCli([
			"latest-summary",
			"--workspace",
			"ws_cli_summary",
			"--user-data-dir",
			userDataDir,
			"--agent-home",
			agentHomeDir,
		]);
		const parsed = JSON.parse(result.stdout) as { latestSnapshots: Array<{ id: string; paneRole?: string }> };

		expect(result.exitCode).toBe(0);
		expect(parsed.latestSnapshots).toEqual([expect.objectContaining({ id: "snap-cli", paneRole: "test" })]);
		expect(result.stdout).not.toContain("hidden full text");
	});

	it("runs read-only capture through the supplied services and rejects write commands", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			panes: [],
			status: "running",
			tmuxAvailable: true,
			workspaceId: "ws_cli_capture",
		};
		const services: WorkspaceRuntimeCliServices = {
			contextHarvester: {
				captureWorkspaceContext: vi.fn(async () => ({
					capturedAt: "2026-05-20T08:00:00.000Z",
					combinedText: "test output",
					failures: [],
					snapshots: [],
					workspaceId: "ws_cli_capture",
				})),
				captureWorkspacePane: vi.fn(async () => ({
					capturedAt: "2026-05-20T08:00:00.000Z",
					extractedBlocks: [],
					id: "snap-capture",
					lineCount: 1,
					paneId: "%1",
					paneRole: "test" as const,
					rawTextStored: false as const,
					redactions: [],
					text: "test output",
					workspaceId: "ws_cli_capture",
				})),
				listPaneSnapshots: vi.fn(async () => []),
			},
			workspaceRuntime: {
				getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
			},
			workspaceStore: {
				listWorkspaces: vi.fn(async () => []),
			},
		};

		const captureResult = await runWorkspaceRuntimeCli(
			["capture", "--workspace", "ws_cli_capture", "--role", "test", "--lines", "20"],
			{ createServices: () => services },
		);
		const rejected = await runWorkspaceRuntimeCli(["pause", "--workspace", "ws_cli_capture"], {
			createServices: () => services,
		});

		expect(captureResult.exitCode).toBe(0);
		expect(services.contextHarvester.captureWorkspacePane).toHaveBeenCalledWith({
			lines: 20,
			paneRole: "test",
			reason: "workspace runtime CLI capture",
			workspaceId: "ws_cli_capture",
		});
		expect(rejected.exitCode).toBe(1);
		expect(rejected.stderr).toContain("read-only CLI");
	});
});
