import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopAuthService } from "../../src/main/auth/desktop-auth-service.ts";
import type { DesktopEventStore } from "../../src/main/events/event-store.ts";
import { registerDesktopAgentHandlers } from "../../src/main/ipc/register-handlers.ts";
import type { DesktopMcpManager } from "../../src/main/mcp/mcp-manager.ts";
import type { DesktopRuntimeHost } from "../../src/main/runtime/desktop-runtime-host.ts";
import type { DesktopApprovalBroker } from "../../src/main/security/approval-broker.ts";
import type { DesktopProjectStore } from "../../src/main/storage/project-store.ts";
import type { DesktopProviderKeysStore } from "../../src/main/storage/provider-keys-store.ts";
import type { DesktopSessionStore } from "../../src/main/storage/session-store.ts";
import type { DesktopSettingsStore } from "../../src/main/storage/settings-store.ts";
import type { DesktopPtyManager } from "../../src/main/terminal/pty-manager.ts";
import { IPC_CHANNELS } from "../../src/shared/ipc-contract.ts";
import { DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS } from "../../src/shared/types.ts";

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
const execFileAsync = promisify(execFile);
const tempDirectories: string[] = [];

async function createTempDirectory(prefix: string): Promise<string> {
	const directoryPath = await mkdtemp(join(tmpdir(), prefix));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { maxBuffer: 8 * 1024 * 1024 });
	return stdout;
}

const electronMocks = vi.hoisted(() => {
	const handlers = new Map<string, IpcHandler>();
	return {
		handlers,
		ipcMain: {
			handle: vi.fn((channel: string, handler: IpcHandler) => {
				handlers.set(channel, handler);
			}),
			on: vi.fn(),
			removeAllListeners: vi.fn(),
			removeHandler: vi.fn((channel: string) => {
				handlers.delete(channel);
			}),
		},
	};
});

vi.mock("electron", () => ({
	BrowserWindow: { fromWebContents: vi.fn() },
	dialog: { showOpenDialog: vi.fn() },
	ipcMain: electronMocks.ipcMain,
	shell: { openExternal: vi.fn() },
}));

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

function getHandler(channel: string): IpcHandler {
	const handler = electronMocks.handlers.get(channel);
	if (!handler) {
		throw new Error(`Expected handler for ${channel}`);
	}
	return handler;
}

function registerHandlers(
	overrides: {
		host?: Partial<DesktopRuntimeHost>;
		previewUrlService?: { createPreviewUrl(path: string): Promise<string> };
		ptyManager?: Partial<DesktopPtyManager>;
		settingsStore?: Partial<DesktopSettingsStore>;
	} = {},
) {
	registerDesktopAgentHandlers({
		host: overrides.host as DesktopRuntimeHost,
		authService: {} as DesktopAuthService,
		ptyManager: {
			disposeSession: vi.fn(),
			...overrides.ptyManager,
		} as unknown as DesktopPtyManager,
		mcpManager: {} as DesktopMcpManager,
		approvalBroker: {} as DesktopApprovalBroker,
		getRuntimeCatalog: async () => ({ defaultTools: [], providers: [] }),
		previewUrlService: overrides.previewUrlService,
		stores: {
			eventStore: {
				markRunAwaitingReviewForSession: vi.fn(async () => undefined),
			} as unknown as DesktopEventStore,
			projectStore: {} as DesktopProjectStore,
			providerKeysStore: {} as DesktopProviderKeysStore,
			sessionStore: {} as DesktopSessionStore,
			settingsStore: {
				getAll: vi.fn(async () => ({
					permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
					showThinkingBlocks: false,
				})),
				...overrides.settingsStore,
			} as unknown as DesktopSettingsStore,
		},
	});
}

describe("session, project, prompt, and preview IPC handlers", () => {
	it("disposes session terminals before deleting the session", async () => {
		const disposeSession = vi.fn();
		const deleteSession = vi.fn(async () => ({
			agentMode: "execute" as const,
			createdAt: "2026-05-27T01:00:00.000Z",
			cwd: "/workspace/project",
			id: "session-1",
			messageCount: 0,
			title: "Session 1",
			updatedAt: "2026-05-27T01:00:00.000Z",
		}));
		registerHandlers({
			host: { deleteSession },
			ptyManager: { disposeSession },
		});

		await getHandler(IPC_CHANNELS.deleteSession)(undefined, "session-1");

		expect(disposeSession).toHaveBeenCalledWith("session-1");
		expect(deleteSession).toHaveBeenCalledWith("session-1");
		expect(disposeSession.mock.invocationCallOrder[0]).toBeLessThan(deleteSession.mock.invocationCallOrder[0]);
	});

	it("forwards validated prompt submissions without changing payload shape", async () => {
		const prompt = vi.fn(async () => undefined);
		registerHandlers({ host: { prompt } });

		await getHandler(IPC_CHANNELS.prompt)(undefined, {
			sessionId: "session-1",
			text: "Inspect the release notes.",
		});

		expect(prompt).toHaveBeenCalledWith("session-1", {
			text: "Inspect the release notes.",
		});
	});

	it("forwards validated session message page requests", async () => {
		const getSessionMessages = vi.fn(async () => ({
			sessionId: "session-1",
			messages: [],
			window: { start: 40, end: 80, total: 120, hasMoreBefore: true },
		}));
		registerHandlers({ host: { getSessionMessages } });

		const result = await getHandler(IPC_CHANNELS.getSessionMessages)(undefined, {
			sessionId: "session-1",
			before: 80,
			limit: 40,
		});

		expect(getSessionMessages).toHaveBeenCalledWith({ sessionId: "session-1", before: 80, limit: 40 });
		expect(result).toEqual({
			sessionId: "session-1",
			messages: [],
			window: { start: 40, end: 80, total: 120, hasMoreBefore: true },
		});
	});

	it("returns review snapshots without patch strings and loads selected file patches lazily", async () => {
		const repo = await createTempDirectory("desktop-review-ipc-");
		await git(repo, ["init", "-b", "main"]);
		await git(repo, ["config", "user.email", "desktop@example.com"]);
		await git(repo, ["config", "user.name", "Desktop Agent"]);
		await writeFile(join(repo, "tracked.ts"), "const value = 1;\n", "utf8");
		await git(repo, ["add", "tracked.ts"]);
		await git(repo, ["commit", "-m", "initial"]);
		await writeFile(join(repo, "tracked.ts"), "const value = 2;\nconst next = true;\n", "utf8");
		const resolveReviewWorkspaceCwd = vi.fn(async () => repo);
		registerHandlers({ host: { resolveReviewWorkspaceCwd } });

		const snapshot = (await getHandler(IPC_CHANNELS.getReviewSnapshot)(undefined, {
			projectId: "project-1",
		})) as { files: Array<{ path: string; patch?: string }>; patch?: string };
		const file = (await getHandler(IPC_CHANNELS.getReviewFilePatch)(undefined, {
			projectId: "project-1",
			path: "tracked.ts",
		})) as { path: string; patch?: string };

		expect(snapshot.patch).toBeUndefined();
		expect(snapshot.files.find((entry) => entry.path === "tracked.ts")?.patch).toBeUndefined();
		expect(file.path).toBe("tracked.ts");
		expect(file.patch).toContain("const next = true;");
		expect(resolveReviewWorkspaceCwd).toHaveBeenCalledWith({ projectId: "project-1", sessionId: undefined });
		expect(resolveReviewWorkspaceCwd).toHaveBeenCalledWith({
			path: "tracked.ts",
			projectId: "project-1",
			sessionId: undefined,
		});
	});

	it("authorizes preview refresh only after the file was opened in this app session", async () => {
		const workspaceDir = await createTempDirectory("desktop-preview-ipc-");
		await writeFile(join(workspaceDir, "README.md"), "# Preview\n\nRendered from workspace.");
		const resolveReviewWorkspaceCwd = vi.fn(async () => workspaceDir);
		registerHandlers({ host: { resolveReviewWorkspaceCwd } });

		await expect(
			getHandler(IPC_CHANNELS.refreshPreviewFile)(undefined, { path: join(workspaceDir, "README.md") }),
		).rejects.toThrow("file was not selected in this app session");

		const opened = (await getHandler(IPC_CHANNELS.openWorkspacePreviewFile)(undefined, {
			projectId: "project-1",
			path: "README.md",
		})) as { path: string };
		const refreshed = (await getHandler(IPC_CHANNELS.refreshPreviewFile)(undefined, { path: opened.path })) as {
			path: string;
		};

		expect(opened.path.endsWith("/README.md")).toBe(true);
		expect(refreshed.path).toBe(opened.path);
		expect(resolveReviewWorkspaceCwd).toHaveBeenCalledWith({ path: "README.md", projectId: "project-1" });
	});

	it("returns html preview urls through workspace preview IPC and refresh", async () => {
		const workspaceDir = await createTempDirectory("desktop-html-preview-ipc-");
		await writeFile(join(workspaceDir, "index.html"), "<!doctype html><button>Run</button>");
		const resolveReviewWorkspaceCwd = vi.fn(async () => workspaceDir);
		const createPreviewUrl = vi.fn(async (path: string) => `skylark-preview://preview/${path.split("/").pop()}`);
		registerHandlers({
			host: { resolveReviewWorkspaceCwd },
			previewUrlService: { createPreviewUrl },
		});

		const opened = (await getHandler(IPC_CHANNELS.openWorkspacePreviewFile)(undefined, {
			projectId: "project-1",
			path: "index.html",
		})) as { path: string; previewUrl?: string };
		const refreshed = (await getHandler(IPC_CHANNELS.refreshPreviewFile)(undefined, { path: opened.path })) as {
			path: string;
			previewUrl?: string;
		};

		expect(opened.previewUrl).toBe("skylark-preview://preview/index.html");
		expect(refreshed.previewUrl).toBe("skylark-preview://preview/index.html");
		expect(createPreviewUrl).toHaveBeenCalledTimes(2);
		expect(createPreviewUrl.mock.calls.map(([path]) => path)).toEqual([opened.path, opened.path]);
	});

	it("merges persisted settings into workspace overview responses", async () => {
		const getWorkspaceOverview = vi.fn(async () => ({
			activeProjectId: "project-1",
			projects: [],
			sessionsByProjectId: {},
			settings: {
				permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
				showThinkingBlocks: false,
			},
		}));
		registerHandlers({
			host: { getWorkspaceOverview },
			settingsStore: {
				getAll: vi.fn(async () => ({
					defaultProvider: "openai",
					permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
					showThinkingBlocks: true,
				})),
			},
		});

		await expect(getHandler(IPC_CHANNELS.getWorkspaceOverview)(undefined)).resolves.toEqual({
			activeProjectId: "project-1",
			projects: [],
			sessionsByProjectId: {},
			settings: {
				defaultProvider: "openai",
				permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
				showThinkingBlocks: true,
			},
		});
	});
});
