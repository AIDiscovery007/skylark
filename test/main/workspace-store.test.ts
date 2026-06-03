import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_DESKTOP_WORKSPACE_RESOURCE_POLICY,
	DesktopWorkspaceStore,
} from "../../src/main/workspace/workspace-store.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-workspace-store-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

describe("DesktopWorkspaceStore", () => {
	it("creates stable workspace metadata and reuses the same repo task", async () => {
		const directoryPath = createTempDirectory();
		const indexFilePath = join(directoryPath, "workspaces", "index.json");
		const store = new DesktopWorkspaceStore(indexFilePath);

		const created = await store.createWorkspace({
			projectId: "project-1",
			repoPath: join(directoryPath, "repo"),
			taskTitle: "fix-login-500",
			piSessionId: "session-1",
		});
		const duplicate = await store.createWorkspace({
			projectId: "project-1",
			repoPath: join(directoryPath, "repo", "."),
			taskTitle: "fix-login-500",
			piSessionId: "session-1",
		});

		expect(duplicate.id).toBe(created.id);
		expect(created.status).toBe("created");
		expect(created.resourcePolicy).toEqual(DEFAULT_DESKTOP_WORKSPACE_RESOURCE_POLICY);
		expect(created.tmuxSessionName).toBe(`ws_${created.id.replace(/^ws_/, "")}`);
		expect(await store.getWorkspace(created.id)).toEqual(created);
		expect(await store.listWorkspaces()).toEqual([created]);
		expect(await store.findWorkspaceByRepoOrTask({ repoPath: created.repoPath, taskTitle: "fix-login-500" })).toEqual(
			created,
		);

		const reloadedStore = new DesktopWorkspaceStore(indexFilePath);
		expect(await reloadedStore.getWorkspace(created.id)).toEqual(created);
	});

	it("updates lifecycle state, marks activity, archives, and deletes workspaces", async () => {
		const directoryPath = createTempDirectory();
		const store = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const created = await store.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "long-running-build",
		});

		const running = await store.updateWorkspaceStatus(created.id, "running");
		expect(running).toEqual(expect.objectContaining({ id: created.id, status: "running" }));

		const active = await store.markWorkspaceActivity(created.id, "2026-05-19T10:00:00.000Z");
		expect(active).toEqual(
			expect.objectContaining({
				id: created.id,
				lastActivityAt: "2026-05-19T10:00:00.000Z",
				status: "running",
			}),
		);

		const archived = await store.archiveWorkspace(created.id);
		expect(archived).toEqual(expect.objectContaining({ id: created.id, status: "archived" }));
		await expect(store.updateWorkspaceStatus(created.id, "running")).rejects.toThrow("Invalid workspace status");
		expect(await store.deleteWorkspace(created.id)).toBe(true);
		expect(await store.getWorkspace(created.id)).toBeNull();
		expect(await store.deleteWorkspace(created.id)).toBe(false);
	});

	it("creates a fresh workspace after a matching workspace was archived", async () => {
		const directoryPath = createTempDirectory();
		const store = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const created = await store.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "Workspace",
			piSessionId: "session-1",
		});
		await store.archiveWorkspace(created.id);

		const next = await store.createWorkspace({
			repoPath: join(directoryPath, "repo"),
			taskTitle: "Workspace",
			piSessionId: "session-1",
		});

		expect(next.id).not.toBe(created.id);
		expect(await store.getWorkspace(created.id)).toEqual(expect.objectContaining({ status: "archived" }));
		expect(await store.getWorkspace(next.id)).toEqual(expect.objectContaining({ status: "created" }));
	});

	it("patches runtime metadata and filters workspaces by project, repo, and status", async () => {
		const directoryPath = createTempDirectory();
		const store = new DesktopWorkspaceStore(join(directoryPath, "workspaces", "index.json"));
		const repoPath = join(directoryPath, "repo");
		const workspace = await store.createWorkspace({
			projectId: "project-1",
			repoPath,
			taskTitle: "debug-api",
		});
		await store.createWorkspace({
			projectId: "project-2",
			repoPath: join(directoryPath, "other"),
			taskTitle: "other-task",
		});

		const updated = await store.updateWorkspace(workspace.id, {
			piSessionPath: "/tmp/pi-session.jsonl",
			tmuxSocketPath: "/tmp/pi-desktop/ws.sock",
			pinned: true,
			resourcePolicy: { historyLimit: 1000 },
			paneDefinitions: [{ id: "test", role: "test", title: "Tests", command: "npm run check" }],
			status: "paused",
		});

		expect(updated).toEqual(
			expect.objectContaining({
				id: workspace.id,
				piSessionPath: "/tmp/pi-session.jsonl",
				pinned: true,
				status: "paused",
				tmuxSocketPath: "/tmp/pi-desktop/ws.sock",
				resourcePolicy: {
					...DEFAULT_DESKTOP_WORKSPACE_RESOURCE_POLICY,
					historyLimit: 1000,
				},
				paneDefinitions: [{ id: "test", role: "test", title: "Tests", command: "npm run check" }],
			}),
		);
		expect(await store.listWorkspaces({ projectId: "project-1" })).toEqual([updated]);
		expect(await store.listWorkspaces({ repoPath: join(repoPath, ".") })).toEqual([updated]);
		expect(await store.listWorkspaces({ status: "paused" })).toEqual([updated]);
	});
});
