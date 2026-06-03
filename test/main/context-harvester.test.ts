import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ContextHarvester,
	JsonPaneSnapshotStore,
	redactTerminalText,
} from "../../src/main/context/context-harvester.ts";
import type { TmuxPaneInfo, TmuxRuntime } from "../../src/main/tmux/tmux-runtime.ts";
import { DesktopWorkspaceStore } from "../../src/main/workspace/workspace-store.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-context-harvester-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

class FakeTmuxRuntime implements TmuxRuntime {
	readonly capturePane = vi.fn<TmuxRuntime["capturePane"]>(async () =>
		[
			"OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890",
			"Authorization: Bearer github_pat_abcdefghijklmnopqrstuvwxyz1234567890",
			"postgres://user:super-secret@localhost:5432/app",
			"Error: login failed",
			"expected 200 received 500",
		].join("\n"),
	);

	async isTmuxAvailable(): Promise<boolean> {
		return true;
	}

	async hasSession(): Promise<boolean> {
		return true;
	}

	async ensureSession(): Promise<{ created: boolean; sessionName: string }> {
		return { created: false, sessionName: "ws_demo" };
	}

	async newWindow(): Promise<void> {}

	async listPanes(): Promise<TmuxPaneInfo[]> {
		return [
			{
				sessionName: "ws_demo",
				windowId: "@1",
				windowName: "test",
				paneId: "%1",
				paneIndex: 0,
				currentCommand: "vitest",
				currentPath: "/workspace/project",
				dead: false,
			},
		];
	}

	async sendText(): Promise<void> {}

	async killWindow(): Promise<void> {}

	async killSession(): Promise<void> {}
}

describe("redactTerminalText", () => {
	it("redacts common terminal secrets while preserving useful surrounding text", () => {
		const result = redactTerminalText(
			[
				"OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890",
				"Authorization: Bearer github_pat_abcdefghijklmnopqrstuvwxyz1234567890",
				"DATABASE_URL=postgres://user:super-secret@localhost:5432/app",
				"-----BEGIN OPENSSH PRIVATE KEY-----",
				"secret-key-body",
				"-----END OPENSSH PRIVATE KEY-----",
			].join("\n"),
		);

		expect(result.text).toContain("OPENAI_API_KEY=[REDACTED:env-secret]");
		expect(result.text).toContain("Authorization: Bearer [REDACTED:bearer-token]");
		expect(result.text).toContain("postgres://user:[REDACTED:database-url]@localhost:5432/app");
		expect(result.text).toContain("[REDACTED:ssh-private-key]");
		expect(result.redactions).toEqual(
			expect.arrayContaining([
				{ kind: "env-secret", count: 1 },
				{ kind: "bearer-token", count: 1 },
				{ kind: "database-url", count: 1 },
				{ kind: "ssh-private-key", count: 1 },
			]),
		);
	});
});

describe("ContextHarvester", () => {
	it("captures bounded pane output by role, redacts it, extracts errors, and persists snapshots", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const snapshotStore = new JsonPaneSnapshotStore(join(directoryPath, "workspaces", "snapshots", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		const harvester = new ContextHarvester({
			now: () => new Date("2026-05-19T11:00:00.000Z"),
			snapshotStore,
			tmuxRuntime,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "debug-login",
		});
		await workspaceStore.updateWorkspace(workspace.id, {
			tmuxSocketPath: "/tmp/pi-desktop/ws.sock",
			tmuxSessionName: "ws_debug_login",
		});

		const snapshot = await harvester.captureWorkspacePane({
			workspaceId: workspace.id,
			paneRole: "test",
			lines: 2000,
			reason: "debug failing login test",
		});

		expect(tmuxRuntime.capturePane).toHaveBeenCalledWith({
			socketPath: "/tmp/pi-desktop/ws.sock",
			paneId: "%1",
			lines: 1000,
			joinWrappedLines: true,
		});
		expect(snapshot).toEqual(
			expect.objectContaining({
				workspaceId: workspace.id,
				paneId: "%1",
				paneRole: "test",
				capturedAt: "2026-05-19T11:00:00.000Z",
				rawTextStored: false,
				reason: "debug failing login test",
			}),
		);
		expect(snapshot.text).not.toContain("super-secret");
		expect(snapshot.text).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz1234567890");
		expect(snapshot.extractedBlocks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "test-failure", text: expect.stringContaining("login failed") }),
			]),
		);
		expect(await harvester.listPaneSnapshots(workspace.id)).toEqual([
			expect.objectContaining({ id: snapshot.id, workspaceId: workspace.id, paneRole: "test" }),
		]);
		expect(await harvester.getPaneSnapshot(snapshot.id)).toEqual(snapshot);
	});

	it("captures workspace context while isolating per-pane failures", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const snapshotStore = new JsonPaneSnapshotStore(join(directoryPath, "workspaces", "snapshots", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		const harvester = new ContextHarvester({
			now: () => new Date("2026-05-19T11:05:00.000Z"),
			snapshotStore,
			tmuxRuntime,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "workspace-context",
		});
		await workspaceStore.updateWorkspace(workspace.id, {
			tmuxSocketPath: "/tmp/pi-desktop/ws.sock",
			tmuxSessionName: "ws_context",
		});

		const context = await harvester.captureWorkspaceContext({
			workspaceId: workspace.id,
			roles: ["test", "logs"],
			linesPerPane: 50,
			reason: "debug context",
		});

		expect(context.snapshots).toHaveLength(1);
		expect(context.combinedText).toContain("# test");
		expect(context.failures).toEqual([{ role: "logs", message: "No pane found for role 'logs'." }]);
	});

	it("rejects direct pane ids that do not belong to the workspace runtime session", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const snapshotStore = new JsonPaneSnapshotStore(join(directoryPath, "workspaces", "snapshots", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		const harvester = new ContextHarvester({
			snapshotStore,
			tmuxRuntime,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "cross-workspace-pane",
		});
		await workspaceStore.updateWorkspace(workspace.id, {
			tmuxSocketPath: "/tmp/pi-desktop/ws.sock",
			tmuxSessionName: "ws_context",
		});

		await expect(
			harvester.captureWorkspacePane({
				workspaceId: workspace.id,
				paneId: "%99",
			}),
		).rejects.toThrow("does not belong to workspace");
		expect(tmuxRuntime.capturePane).not.toHaveBeenCalled();
	});

	it("refuses to capture workspace context from sockets outside app-owned storage", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const snapshotStore = new JsonPaneSnapshotStore(join(directoryPath, "workspaces", "snapshots", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		const harvester = new ContextHarvester({
			runtimeRootDir: join(directoryPath, "runtime"),
			snapshotStore,
			tmuxRuntime,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "external-socket-capture",
		});
		await workspaceStore.updateWorkspace(workspace.id, {
			tmuxSocketPath: "/tmp/user-owned-tmux.sock",
			tmuxSessionName: "user_session",
		});

		await expect(
			harvester.captureWorkspacePane({
				workspaceId: workspace.id,
				paneRole: "test",
			}),
		).rejects.toThrow("outside app-owned runtime storage");
		expect(tmuxRuntime.capturePane).not.toHaveBeenCalled();
	});
});
