import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	JsonEnvironmentResourceStore,
	migrateWorkspaceRuntimeToEnvironmentResources,
	reconcileTmuxEnvironmentResources,
} from "../../src/main/environment/environment-resource-store.ts";
import type { DesktopWorkspace } from "../../src/shared/types.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-environment-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

afterEach(() => {
	for (const directoryPath of tempDirectories.splice(0)) {
		rmSync(directoryPath, { recursive: true, force: true });
	}
});

describe("environment resource store", () => {
	it("migrates legacy workspace runtime records into tmux environment resources", async () => {
		const store = new JsonEnvironmentResourceStore(join(createTempDirectory(), "environment.json"));
		const workspace: DesktopWorkspace = {
			createdAt: "2026-05-20T08:00:00.000Z",
			id: "ws-login",
			paneDefinitions: [
				{ id: "test", role: "test", title: "Tests" },
				{ id: "dev-server", role: "dev-server", title: "Dev Server" },
			],
			piSessionId: "session-1",
			repoPath: "/workspace/project",
			resourcePolicy: {
				historyLimit: 20_000,
				idlePauseMinutes: 60,
				maxHotWorkspaces: 2,
				maxWorkspaceLogBytes: 10_000_000,
				snapshotRetentionDays: 7,
			},
			status: "running",
			taskTitle: "fix-login-500",
			tmuxSessionName: "ws_login",
			tmuxSocketPath: "/tmp/pda-tmux/ws-login.sock",
			updatedAt: "2026-05-20T08:30:00.000Z",
		};

		await migrateWorkspaceRuntimeToEnvironmentResources(store, workspace, {
			now: () => new Date("2026-05-20T09:00:00.000Z"),
		});

		const resources = await store.listResources({ sessionId: "session-1" });
		expect(resources).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "tmux_session",
					provider: "tmux",
					sessionId: "session-1",
					status: "running",
					title: "fix-login-500",
					metadata: expect.objectContaining({
						tmuxSessionName: "ws_login",
						tmuxSocketPath: "/tmp/pda-tmux/ws-login.sock",
						workspaceId: "ws-login",
					}),
				}),
				expect.objectContaining({
					kind: "tmux_window",
					parentId: expect.any(String),
					title: "Tests",
					metadata: expect.objectContaining({
						paneRole: "test",
						tmuxWindowName: "test",
					}),
				}),
			]),
		);
		expect(resources).toHaveLength(3);
	});

	it("reconciles tmux user-option discovery into session and window resources", async () => {
		const store = new JsonEnvironmentResourceStore(join(createTempDirectory(), "environment.json"));

		await reconcileTmuxEnvironmentResources(
			store,
			[
				{
					sessionName: "skylark_abcd1234_tests",
					options: {
						"@skylark-cwd": "/workspace/project",
						"@skylark-resource-kind": "tmux_session",
						"@skylark-session-id": "session-1",
						"@skylark-title": "Test runtime",
					},
					windows: [
						{
							paneId: "%2",
							currentCommand: "vitest",
							currentPath: "/workspace/project",
							options: {
								"@skylark-preview-url": "http://localhost:5173",
								"@skylark-resource-kind": "tmux_window",
								"@skylark-title": "Tests",
							},
							windowName: "tests",
						},
					],
				},
			],
			{ now: () => new Date("2026-05-21T10:00:00.000Z") },
		);

		const resources = await store.listResources({ sessionId: "session-1" });
		expect(resources.map((resource) => resource.kind).sort()).toEqual(["tmux_session", "tmux_window"]);
		expect(resources.find((resource) => resource.kind === "tmux_window")).toEqual(
			expect.objectContaining({
				cwd: "/workspace/project",
				provider: "tmux",
				status: "running",
				title: "Tests",
				metadata: expect.objectContaining({
					currentCommand: "vitest",
					paneId: "%2",
					previewUrl: "http://localhost:5173",
					tmuxSessionName: "skylark_abcd1234_tests",
					tmuxWindowName: "tests",
				}),
			}),
		);

		await reconcileTmuxEnvironmentResources(store, [], {
			now: () => new Date("2026-05-21T10:01:00.000Z"),
		});

		const staleResources = await store.listResources({ sessionId: "session-1" });
		expect(staleResources.every((resource) => resource.status === "stale")).toBe(true);
	});

	it("reconciles legacy pi tmux user options while preferring Skylark metadata", async () => {
		const store = new JsonEnvironmentResourceStore(join(createTempDirectory(), "environment.json"));

		await reconcileTmuxEnvironmentResources(
			store,
			[
				{
					sessionName: "pi_abcd1234_legacy",
					options: {
						"@pi-cwd": "/workspace/legacy",
						"@pi-session-id": "legacy-session",
						"@pi-title": "Legacy runtime",
					},
					windows: [],
				},
			],
			{ now: () => new Date("2026-05-21T10:00:00.000Z") },
		);

		expect(await store.listResources({ sessionId: "legacy-session" })).toEqual([
			expect.objectContaining({
				cwd: "/workspace/legacy",
				status: "running",
				title: "Legacy runtime",
			}),
		]);
	});
});
