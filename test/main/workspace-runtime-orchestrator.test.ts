import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TmuxPaneInfo, TmuxRuntime } from "../../src/main/tmux/tmux-runtime.ts";
import { WorkspaceRuntimeOrchestrator } from "../../src/main/workspace/workspace-runtime-orchestrator.ts";
import { DesktopWorkspaceStore } from "../../src/main/workspace/workspace-store.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-workspace-runtime-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

class FakeTmuxRuntime implements TmuxRuntime {
	readonly events: string[] = [];
	readonly ensureSessionCalls: Array<{ socketPath: string; sessionName: string; cwd: string; historyLimit?: number }> =
		[];
	readonly newWindowCalls: Array<{
		socketPath: string;
		sessionName: string;
		windowName: string;
		cwd: string;
		command?: string;
	}> = [];
	readonly killSessionCalls: Array<{ socketPath: string; sessionName: string }> = [];
	readonly killWindowCalls: Array<{ socketPath: string; sessionName: string; windowName: string }> = [];
	readonly listPanesCalls: Array<{ socketPath: string; sessionName?: string }> = [];
	private readonly sessions = new Set<string>();
	private readonly windowsBySession = new Map<string, Set<string>>();

	async isTmuxAvailable(): Promise<boolean> {
		return true;
	}

	async hasSession(input: { socketPath: string; sessionName: string }): Promise<boolean> {
		void input.socketPath;
		return this.sessions.has(input.sessionName);
	}

	async ensureSession(input: {
		socketPath: string;
		sessionName: string;
		cwd: string;
		historyLimit?: number;
	}): Promise<{ created: boolean; sessionName: string }> {
		this.ensureSessionCalls.push(input);
		const created = !this.sessions.has(input.sessionName);
		this.sessions.add(input.sessionName);
		this.windowsBySession.set(input.sessionName, this.windowsBySession.get(input.sessionName) ?? new Set());
		return { created, sessionName: input.sessionName };
	}

	async newWindow(input: {
		socketPath: string;
		sessionName: string;
		windowName: string;
		cwd: string;
		command?: string;
	}): Promise<void> {
		this.newWindowCalls.push(input);
		this.windowsBySession.get(input.sessionName)?.add(input.windowName);
	}

	async listPanes(input: { socketPath: string; sessionName?: string }): Promise<TmuxPaneInfo[]> {
		this.listPanesCalls.push(input);
		const sessions = input.sessionName ? [input.sessionName] : [...this.sessions];
		return sessions.flatMap((sessionName) =>
			[...(this.windowsBySession.get(sessionName) ?? new Set())].map((windowName, paneIndex) => ({
				sessionName,
				windowId: `@${paneIndex + 1}`,
				windowName,
				paneId: `%${paneIndex + 1}`,
				paneIndex,
				currentCommand: "zsh",
				currentPath: "/workspace/project",
				dead: false,
			})),
		);
	}

	async capturePane(): Promise<string> {
		return "";
	}

	async sendText(): Promise<void> {}

	async killWindow(input: { socketPath: string; sessionName: string; windowName: string }): Promise<void> {
		this.events.push(`kill-window:${input.windowName}`);
		this.killWindowCalls.push(input);
		this.windowsBySession.get(input.sessionName)?.delete(input.windowName);
	}

	async killSession(input: { socketPath: string; sessionName: string }): Promise<void> {
		this.events.push("kill-session");
		this.killSessionCalls.push(input);
		this.sessions.delete(input.sessionName);
		this.windowsBySession.delete(input.sessionName);
	}
}

describe("WorkspaceRuntimeOrchestrator", () => {
	it("opens, reopens, pauses, and resumes a workspace runtime without duplicating panes", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		const orchestrator = new WorkspaceRuntimeOrchestrator({
			now: () => new Date("2026-05-19T10:00:00.000Z"),
			runtimeRootDir: join(directoryPath, "runtime"),
			tmuxRuntime,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			projectId: "project-1",
			repoPath: join(directoryPath, "repo"),
			taskTitle: "fix-login-500",
		});

		const firstOpen = await orchestrator.openWorkspace(workspace.id);
		const secondOpen = await orchestrator.openWorkspace(workspace.id);

		expect(firstOpen.status).toBe("running");
		expect(secondOpen.status).toBe("running");
		expect(secondOpen.panes.map((pane) => pane.role)).toEqual(["agent", "shell", "dev-server", "test", "logs"]);
		expect(tmuxRuntime.ensureSessionCalls).toHaveLength(2);
		expect(tmuxRuntime.newWindowCalls.map((call) => call.windowName)).toEqual([
			"agent",
			"shell",
			"dev-server",
			"test",
			"logs",
		]);

		const storedRunningWorkspace = await workspaceStore.getWorkspace(workspace.id);
		expect(storedRunningWorkspace).toEqual(
			expect.objectContaining({
				status: "running",
				lastOpenedAt: "2026-05-19T10:00:00.000Z",
				lastActivityAt: "2026-05-19T10:00:00.000Z",
				tmuxSessionName: workspace.tmuxSessionName,
				tmuxSocketPath: join(directoryPath, "runtime", "tmux", `${workspace.id}.sock`),
			}),
		);

		await orchestrator.pauseWorkspace(workspace.id);
		expect(tmuxRuntime.killSessionCalls).toEqual([
			{
				socketPath: join(directoryPath, "runtime", "tmux", `${workspace.id}.sock`),
				sessionName: workspace.tmuxSessionName,
			},
		]);
		expect(await workspaceStore.getWorkspace(workspace.id)).toEqual(expect.objectContaining({ status: "paused" }));

		const resumed = await orchestrator.resumeWorkspace(workspace.id);
		expect(resumed.status).toBe("running");
		expect(resumed.panes.map((pane) => pane.role)).toEqual(["agent", "shell", "dev-server", "test", "logs"]);
	});

	it("returns unavailable state when tmux is missing", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		tmuxRuntime.isTmuxAvailable = async () => false;
		const orchestrator = new WorkspaceRuntimeOrchestrator({
			runtimeRootDir: join(directoryPath, "runtime"),
			tmuxRuntime,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "missing-tmux",
		});

		const state = await orchestrator.openWorkspace(workspace.id);

		expect(state.status).toBe("unavailable");
		expect(state.tmuxAvailable).toBe(false);
		expect(state.panes).toHaveLength(5);
		expect(tmuxRuntime.ensureSessionCalls).toEqual([]);
		expect(await workspaceStore.getWorkspace(workspace.id)).toEqual(expect.objectContaining({ status: "created" }));
	});

	it("uses a short app-owned tmux socket root when configured", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		const tmuxSocketRootDir = join("/tmp", `pda-test-${process.pid}`);
		const orchestrator = new WorkspaceRuntimeOrchestrator({
			runtimeRootDir: join(directoryPath, "a-very-long-runtime-root-that-should-not-hold-tmux-sockets"),
			tmuxRuntime,
			tmuxSocketRootDir,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "short-socket",
		});

		await orchestrator.openWorkspace(workspace.id);

		const socketPath = tmuxRuntime.ensureSessionCalls[0]?.socketPath;
		expect(socketPath).toContain(tmuxSocketRootDir);
		expect(socketPath).not.toContain(workspace.id);
		expect(socketPath?.length).toBeLessThan(100);
		expect(await workspaceStore.getWorkspace(workspace.id)).toEqual(
			expect.objectContaining({ tmuxSocketPath: socketPath }),
		);
	});

	it("refuses to read runtime metadata that points outside app-owned storage", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		const orchestrator = new WorkspaceRuntimeOrchestrator({
			runtimeRootDir: join(directoryPath, "runtime"),
			tmuxRuntime,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			status: "running",
			taskTitle: "external-socket",
			tmuxSocketPath: "/tmp/user-owned-tmux.sock",
			tmuxSessionName: "user_session",
		});

		const state = await orchestrator.getWorkspaceRuntimeState(workspace.id);

		expect(state.status).toBe("error");
		expect(state.errorMessage).toContain("outside app-owned runtime storage");
		expect(tmuxRuntime.listPanesCalls).toEqual([]);
	});

	it("archives runtime metadata without deleting workspace records", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		const orchestrator = new WorkspaceRuntimeOrchestrator({
			runtimeRootDir: join(directoryPath, "runtime"),
			tmuxRuntime,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "archive-me",
		});

		await orchestrator.openWorkspace(workspace.id);
		await orchestrator.archiveWorkspaceRuntime(workspace.id);

		expect(tmuxRuntime.killSessionCalls).toHaveLength(1);
		expect(await workspaceStore.getWorkspace(workspace.id)).toEqual(expect.objectContaining({ status: "archived" }));
	});

	it("stops one workspace pane without archiving or deleting other panes", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		const orchestrator = new WorkspaceRuntimeOrchestrator({
			now: () => new Date("2026-05-19T10:30:00.000Z"),
			runtimeRootDir: join(directoryPath, "runtime"),
			tmuxRuntime,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "stop-pane",
		});

		await orchestrator.openWorkspace(workspace.id);
		const state = await orchestrator.stopPane(workspace.id, "test");

		expect(tmuxRuntime.killWindowCalls).toEqual([
			{
				socketPath: join(directoryPath, "runtime", "tmux", `${workspace.id}.sock`),
				sessionName: workspace.tmuxSessionName,
				windowName: "test",
			},
		]);
		expect(state.panes.find((pane) => pane.role === "test")).toEqual(expect.objectContaining({ state: "missing" }));
		expect(state.panes.find((pane) => pane.role === "agent")).toEqual(expect.objectContaining({ state: "running" }));
		expect(await workspaceStore.getWorkspace(workspace.id)).toEqual(
			expect.objectContaining({ lastActivityAt: "2026-05-19T10:30:00.000Z", status: "running" }),
		);
	});

	it("restarts only the requested pane and leaves other missing panes missing", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		const orchestrator = new WorkspaceRuntimeOrchestrator({
			now: () => new Date("2026-05-19T10:45:00.000Z"),
			runtimeRootDir: join(directoryPath, "runtime"),
			tmuxRuntime,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "restart-pane",
		});

		await orchestrator.openWorkspace(workspace.id);
		await orchestrator.stopPane(workspace.id, "logs");
		tmuxRuntime.newWindowCalls.splice(0);
		const state = await orchestrator.restartPane(workspace.id, "test");

		expect(tmuxRuntime.newWindowCalls.map((call) => call.windowName)).toEqual(["test"]);
		expect(tmuxRuntime.killWindowCalls.map((call) => call.windowName)).toEqual(["logs", "test"]);
		expect(state.panes.find((pane) => pane.role === "test")).toEqual(expect.objectContaining({ state: "running" }));
		expect(state.panes.find((pane) => pane.role === "logs")).toEqual(expect.objectContaining({ state: "missing" }));
	});

	it("still pauses app-owned runtime but reports snapshot hook failures", async () => {
		const directoryPath = createTempDirectory();
		const workspaceStore = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const tmuxRuntime = new FakeTmuxRuntime();
		const orchestrator = new WorkspaceRuntimeOrchestrator({
			runtimeRootDir: join(directoryPath, "runtime"),
			snapshotBeforePause: async () => {
				tmuxRuntime.events.push("snapshot-before-pause");
				throw new Error("snapshot failed");
			},
			tmuxRuntime,
			workspaceStore,
		});
		const workspace = await workspaceStore.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "pause-with-snapshot",
		});

		await orchestrator.openWorkspace(workspace.id);
		await expect(orchestrator.pauseWorkspace(workspace.id)).rejects.toThrow(
			"Workspace runtime paused, but snapshot before pause failed: snapshot failed",
		);

		expect(tmuxRuntime.events).toEqual(["snapshot-before-pause", "kill-session"]);
		expect(await workspaceStore.getWorkspace(workspace.id)).toEqual(expect.objectContaining({ status: "paused" }));
	});
});
