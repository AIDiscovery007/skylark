import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
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

	it("authorizes preview refresh only after the file was opened in this app session", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-preview-ipc-"));
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
