import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dialog } from "electron";
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
import type { DesktopWorkspacePatch } from "../../src/main/workspace/workspace-store.ts";
import { IPC_CHANNELS } from "../../src/shared/ipc-contract.ts";
import type { DesktopProjectSummary, DesktopWorkspace } from "../../src/shared/types.ts";

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
type IpcListener = (event: { ports: FakeMessagePort[] }) => void;

class FakeMessagePort {
	readonly messages: unknown[] = [];
	readonly start = vi.fn();
	private closeListener: (() => void) | undefined;

	postMessage(message: unknown): void {
		this.messages.push(message);
	}

	on(event: "close", listener: () => void): void {
		if (event === "close") {
			this.closeListener = listener;
		}
	}

	close(): void {
		this.closeListener?.();
	}
}

const electronMocks = vi.hoisted(() => {
	const handlers = new Map<string, IpcHandler>();
	const listeners = new Map<string, IpcListener>();
	return {
		handlers,
		listeners,
		ipcMain: {
			handle: vi.fn((channel: string, handler: IpcHandler) => {
				handlers.set(channel, handler);
			}),
			on: vi.fn((channel: string, listener: IpcListener) => {
				listeners.set(channel, listener);
			}),
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

function getListener(channel: string): IpcListener {
	const listener = electronMocks.listeners.get(channel);
	if (!listener) {
		throw new Error(`Expected listener for ${channel}`);
	}
	return listener;
}

function createWorkspace(overrides: Partial<DesktopWorkspace> = {}): DesktopWorkspace {
	return {
		createdAt: "2026-05-19T10:00:00.000Z",
		id: "ws-login",
		lastActivityAt: "2026-05-19T10:10:00.000Z",
		paneDefinitions: [
			{ id: "pane-agent", role: "agent", title: "Agent" },
			{ id: "pane-test", role: "test", title: "Tests" },
		],
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
		tmuxSessionName: "pi-ws-login",
		tmuxSocketPath: "/tmp/pi-secret/ws-login.sock",
		updatedAt: "2026-05-19T10:10:00.000Z",
		...overrides,
	};
}

function registerHandlersForWorkspaceRuntime(
	workspace: DesktopWorkspace = createWorkspace(),
	runtimeStateOverrides: Record<string, unknown> = {},
	desktopShellServices: Parameters<typeof registerDesktopAgentHandlers>[8] = {},
) {
	let currentWorkspace = workspace;
	const workspaceStore = {
		createWorkspace: vi.fn(async () => currentWorkspace),
		getWorkspace: vi.fn(async () => currentWorkspace),
		listWorkspaces: vi.fn(async () => [currentWorkspace]),
		updateWorkspace: vi.fn(async (_workspaceId: string, patch: DesktopWorkspacePatch) => {
			currentWorkspace = {
				...currentWorkspace,
				...(patch.paneDefinitions ? { paneDefinitions: patch.paneDefinitions } : {}),
				...(patch.status ? { status: patch.status } : {}),
			};
			return currentWorkspace;
		}),
	};
	const runtimeState = {
		errorMessage: "Workspace runtime session is missing.",
		panes: [
			{
				currentCommand: "vitest",
				currentPath: "/workspace/project",
				controlOwner: "none" as const,
				dead: false,
				paneId: "%2",
				role: "test" as const,
				state: "running" as const,
				title: "Tests",
				windowName: "test",
			},
		],
		sessionName: "pi-ws-login",
		socketPath: "/tmp/pi-secret/ws-login.sock",
		status: "error" as const,
		tmuxAvailable: true,
		workspaceId: workspace.id,
		...runtimeStateOverrides,
	};
	const workspaceRuntime = {
		archiveWorkspaceRuntime: vi.fn(async () => undefined),
		getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
		openWorkspace: vi.fn(async () => runtimeState),
		pauseWorkspace: vi.fn(async () => undefined),
		resumeWorkspace: vi.fn(async () => runtimeState),
	};
	const contextHarvester = {
		captureWorkspaceContext: vi.fn(async () => ({
			capturedAt: "2026-05-19T10:12:00.000Z",
			combinedText: "# test\nFAIL login.spec.ts\n[REDACTED:env-secret]",
			failures: [],
			snapshots: [
				{
					capturedAt: "2026-05-19T10:12:00.000Z",
					extractedBlocks: [{ kind: "test-failure", text: "FAIL login.spec.ts" }],
					id: "snap-2",
					lineCount: 2,
					paneId: "%2",
					paneRole: "test" as const,
					rawTextStored: false as const,
					redactions: [{ count: 1, kind: "env-secret" }],
					text: "FAIL login.spec.ts\n[REDACTED:env-secret]",
					workspaceId: workspace.id,
				},
			],
			workspaceId: workspace.id,
		})),
		listPaneSnapshots: vi.fn(async () => [
			{
				capturedAt: "2026-05-19T10:11:00.000Z",
				extractedBlocks: [{ kind: "test-failure", text: "FAIL login.spec.ts" }],
				id: "snap-1",
				lineCount: 1,
				paneId: "%2",
				paneRole: "test" as const,
				redactions: [{ count: 1, kind: "env-secret" }],
				workspaceId: workspace.id,
			},
		]),
	};
	const runtimePermissionGate = {
		executeRuntimeActionWithPermission: vi.fn(async () => ({
			status: "executed" as const,
			decision: {
				approved: true,
				decision: "auto-allowed" as const,
				decidedAt: "2026-05-19T10:12:00.000Z",
			},
			auditEvent: {
				id: "audit-send",
				workspaceId: currentWorkspace.id,
				actionType: "send-text" as const,
				requestedBy: "user" as const,
				riskLevel: "low" as const,
				payloadPreview: "echo USER_FIXED_ENV",
				decision: "auto-allowed" as const,
				resultStatus: "executed" as const,
				requestedAt: "2026-05-19T10:12:00.000Z",
				decidedAt: "2026-05-19T10:12:00.000Z",
				completedAt: "2026-05-19T10:12:00.000Z",
			},
		})),
		recordRuntimeAuditEvent: vi.fn(async () => undefined),
	};

	registerDesktopAgentHandlers(
		{} as unknown as DesktopRuntimeHost,
		{} as unknown as DesktopAuthService,
		{ disposeSession: vi.fn() } as unknown as DesktopPtyManager,
		{} as unknown as DesktopMcpManager,
		{} as unknown as DesktopApprovalBroker,
		async () => ({ defaultTools: [], providers: [] }),
		{
			eventStore: {} as DesktopEventStore,
			projectStore: {} as DesktopProjectStore,
			providerKeysStore: {} as DesktopProviderKeysStore,
			sessionStore: {} as DesktopSessionStore,
			settingsStore: {} as DesktopSettingsStore,
		},
		{
			contextHarvester,
			runtimePermissionGate,
			workspaceRuntime,
			workspaceStore,
		},
		desktopShellServices,
	);

	return { contextHarvester, runtimePermissionGate, workspaceRuntime, workspaceStore };
}

describe("workspace runtime IPC handlers", () => {
	it("handles desktop shell channels without exposing Electron primitives to the renderer", async () => {
		const openSettingsWindow = vi.fn();
		const notifyFirstInteractive = vi.fn();
		const openExternalUrl = vi.fn(async () => undefined);
		const nativeAppearance = {
			accentColor: "#0a84ff",
			colorScheme: "dark" as const,
			forcedColors: false,
			highContrast: false,
			invertedColors: false,
			reducedTransparency: true,
		};
		registerHandlersForWorkspaceRuntime(
			createWorkspace(),
			{},
			{
				getNativeAppearance: () => nativeAppearance,
				openExternalUrl,
				windowManager: {
					focusMainWindow: vi.fn(),
					notifyFirstInteractive,
					openMainWindow: vi.fn(),
					openSettingsWindow,
				},
			},
		);

		await getHandler(IPC_CHANNELS.openSettingsWindow)(undefined, { section: "credentials", providerId: "openai" });
		await getHandler(IPC_CHANNELS.notifyFirstInteractive)({ sender: { id: 42 } });
		await expect(getHandler(IPC_CHANNELS.getNativeAppearance)(undefined)).resolves.toBe(nativeAppearance);
		await getHandler(IPC_CHANNELS.openExternalUrl)(undefined, "https://example.com/docs");

		expect(openSettingsWindow).toHaveBeenCalledWith({ section: "credentials", providerId: "openai" });
		expect(notifyFirstInteractive).toHaveBeenCalledWith(42);
		expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/docs");
	});

	it("opens native event attachments and prepares selected document snapshots", async () => {
		const projectDir = await mkdtemp(join(tmpdir(), "event-attachments-ipc-"));
		const attachmentPath = join(projectDir, "idea.md");
		await writeFile(attachmentPath, "# Idea\n\nShip event attachments.");
		vi.mocked(dialog.showOpenDialog).mockResolvedValue({
			canceled: false,
			filePaths: [attachmentPath],
		});
		registerHandlersForWorkspaceRuntime();

		const result = await getHandler(IPC_CHANNELS.openEventAttachments)({ sender: {} }, { defaultPath: projectDir });

		expect(dialog.showOpenDialog).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultPath: projectDir,
				filters: [{ name: "Event documents", extensions: ["txt", "md", "docx"] }],
				properties: ["openFile", "multiSelections"],
			}),
		);
		expect(result).toEqual({
			attachments: [
				expect.objectContaining({
					mimeType: "text/markdown",
					name: "idea.md",
					sourcePath: attachmentPath,
					textSnapshot: "# Idea\n\nShip event attachments.",
				}),
			],
			errors: [],
		});
	});

	it("publishes workspace runtime events after runtime mutations and captures", async () => {
		registerHandlersForWorkspaceRuntime();
		const port = new FakeMessagePort();

		getListener(IPC_CHANNELS.openWorkspaceRuntimeStream)({ ports: [port] });
		await getHandler(IPC_CHANNELS.openWorkspaceRuntime)(undefined, "ws-login");
		await getHandler(IPC_CHANNELS.captureWorkspaceRuntimeContext)(undefined, {
			reason: "manual runtime panel capture",
			roles: ["test"],
			workspaceId: "ws-login",
		});

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(port.messages).toEqual([
			expect.objectContaining({
				summary: expect.objectContaining({
					runtimeStatus: "error",
					workspace: expect.objectContaining({ id: "ws-login" }),
				}),
				type: "runtime_updated",
			}),
			expect.objectContaining({
				snapshots: [expect.objectContaining({ id: "snap-2" })],
				type: "snapshot_created",
				workspaceId: "ws-login",
			}),
		]);
	});

	it("summarizes workspaces without exposing app-owned tmux socket details", async () => {
		registerHandlersForWorkspaceRuntime();

		const result = await getHandler(IPC_CHANNELS.listWorkspaceRuntimes)(undefined);

		expect(result).toEqual([
			expect.objectContaining({
				errorMessage: "Workspace runtime session is missing.",
				runtimeStatus: "error",
				tmuxAvailable: true,
				workspace: expect.objectContaining({
					id: "ws-login",
					taskTitle: "fix-login-500",
				}),
			}),
		]);
		expect(JSON.stringify(result)).not.toContain("/tmp/pi-secret/ws-login.sock");
		expect(JSON.stringify(result)).not.toContain("pi-ws-login");
	});

	it("routes actions through the workspace runtime services and returns fresh summaries", async () => {
		const { workspaceRuntime } = registerHandlersForWorkspaceRuntime();

		await getHandler(IPC_CHANNELS.openWorkspaceRuntime)(undefined, "ws-login");
		await getHandler(IPC_CHANNELS.pauseWorkspaceRuntime)(undefined, "ws-login");
		await getHandler(IPC_CHANNELS.resumeWorkspaceRuntime)(undefined, "ws-login");
		await getHandler(IPC_CHANNELS.archiveWorkspaceRuntime)(undefined, "ws-login");

		expect(workspaceRuntime.openWorkspace).toHaveBeenCalledWith("ws-login");
		expect(workspaceRuntime.pauseWorkspace).toHaveBeenCalledWith("ws-login");
		expect(workspaceRuntime.resumeWorkspace).toHaveBeenCalledWith("ws-login");
		expect(workspaceRuntime.archiveWorkspaceRuntime).toHaveBeenCalledWith("ws-login");
		expect(workspaceRuntime.getWorkspaceRuntimeState).toHaveBeenCalledTimes(4);
	});

	it("validates and forwards context capture requests to the context harvester", async () => {
		const { contextHarvester } = registerHandlersForWorkspaceRuntime();

		const result = await getHandler(IPC_CHANNELS.captureWorkspaceRuntimeContext)(undefined, {
			linesPerPane: 200,
			reason: "manual runtime panel capture",
			roles: ["test"],
			workspaceId: "ws-login",
		});

		expect(contextHarvester.captureWorkspaceContext).toHaveBeenCalledWith({
			linesPerPane: 200,
			reason: "manual runtime panel capture",
			roles: ["test"],
			workspaceId: "ws-login",
		});
		expect(result).toEqual({
			capturedAt: "2026-05-19T10:12:00.000Z",
			combinedText: "# test\nFAIL login.spec.ts\n[REDACTED:env-secret]",
			failures: [],
			snapshots: [
				expect.objectContaining({
					extractedBlocks: [{ kind: "test-failure", text: "FAIL login.spec.ts" }],
					id: "snap-2",
					redactions: [{ count: 1, kind: "env-secret" }],
				}),
			],
			workspaceId: "ws-login",
		});
	});

	it("supports user takeover, audited user input, and return-control capture", async () => {
		const workspace = createWorkspace({
			paneDefinitions: [{ id: "pane-shell", role: "shell", title: "Shell" }],
		});
		const { contextHarvester, runtimePermissionGate, workspaceStore } = registerHandlersForWorkspaceRuntime(
			workspace,
			{
				errorMessage: undefined,
				panes: [
					{
						currentCommand: "zsh",
						currentPath: "/workspace/project",
						controlOwner: "none" as const,
						dead: false,
						paneId: "%3",
						role: "shell" as const,
						state: "running" as const,
						title: "Shell",
						windowName: "shell",
					},
				],
				status: "running" as const,
			},
		);

		await getHandler(IPC_CHANNELS.takeOverWorkspaceRuntimePane)(undefined, {
			role: "shell",
			workspaceId: "ws-login",
		});
		await getHandler(IPC_CHANNELS.sendWorkspaceRuntimePaneText)(undefined, {
			pressEnter: true,
			role: "shell",
			text: "echo USER_FIXED_ENV",
			workspaceId: "ws-login",
		});
		await getHandler(IPC_CHANNELS.returnWorkspaceRuntimePaneControl)(undefined, {
			role: "shell",
			workspaceId: "ws-login",
		});

		expect(workspaceStore.updateWorkspace).toHaveBeenNthCalledWith(1, "ws-login", {
			paneDefinitions: [{ controlOwner: "user", id: "pane-shell", role: "shell", title: "Shell" }],
		});
		expect(runtimePermissionGate.recordRuntimeAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ actionType: "takeover-pane", paneRole: "shell", requestedBy: "user" }),
		);
		expect(runtimePermissionGate.executeRuntimeActionWithPermission).toHaveBeenCalledWith({
			actionType: "send-text",
			paneRole: "shell",
			pressEnter: true,
			reason: "user takeover pane input",
			requestedBy: "user",
			riskLevel: "low",
			text: "echo USER_FIXED_ENV",
			workspaceId: "ws-login",
		});
		expect(workspaceStore.updateWorkspace).toHaveBeenNthCalledWith(2, "ws-login", {
			paneDefinitions: [{ controlOwner: "agent", id: "pane-shell", role: "shell", title: "Shell" }],
		});
		expect(runtimePermissionGate.recordRuntimeAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ actionType: "return-pane-control", paneRole: "shell", requestedBy: "user" }),
		);
		expect(contextHarvester.captureWorkspaceContext).toHaveBeenCalledWith({
			reason: "return workspace pane control",
			roles: ["shell"],
			workspaceId: "ws-login",
		});
	});

	it("creates and opens a debug workspace using detected project package scripts", async () => {
		const projectDir = await mkdtemp(join(tmpdir(), "debug-workspace-ipc-"));
		await writeFile(
			join(projectDir, "package.json"),
			JSON.stringify({
				scripts: {
					dev: "vite",
					logs: "tail -f logs/app.log",
					test: "vitest --run",
				},
			}),
		);
		await writeFile(join(projectDir, "yarn.lock"), "");
		const createdWorkspace = createWorkspace({
			id: "ws-created",
			paneDefinitions: [],
			projectId: "project-1",
			repoPath: projectDir,
			status: "created",
		});
		const project: DesktopProjectSummary = {
			createdAt: "2026-05-19T09:00:00.000Z",
			cwd: projectDir,
			id: "project-1",
			name: "project",
			sessionCount: 0,
			updatedAt: "2026-05-19T09:00:00.000Z",
		};
		const workspaceStore = {
			createWorkspace: vi.fn(async (input) => ({
				...createdWorkspace,
				paneDefinitions: input.paneDefinitions ?? [],
				projectId: input.projectId,
				repoPath: input.repoPath,
				taskTitle: input.taskTitle,
			})),
			getWorkspace: vi.fn(async () => ({
				...createdWorkspace,
				paneDefinitions: [
					{ id: "agent", role: "agent" as const, title: "Agent" },
					{ id: "shell", role: "shell" as const, title: "Shell" },
					{
						command: "yarn run dev",
						cwd: projectDir,
						id: "dev-server",
						role: "dev-server" as const,
						title: "Dev Server",
					},
					{ command: "yarn run test", cwd: projectDir, id: "test", role: "test" as const, title: "Test" },
					{ command: "yarn run logs", cwd: projectDir, id: "logs", role: "logs" as const, title: "Logs" },
				],
				projectId: "project-1",
				repoPath: projectDir,
				taskTitle: "Workspace",
			})),
			listWorkspaces: vi.fn(async () => []),
			updateWorkspace: vi.fn(async (_workspaceId: string, patch: DesktopWorkspacePatch) => ({
				...createdWorkspace,
				paneDefinitions: patch.paneDefinitions ?? [],
				projectId: "project-1",
				repoPath: projectDir,
				taskTitle: "fix-login-500",
			})),
		};
		const runtimeState = {
			panes: [],
			status: "paused" as const,
			tmuxAvailable: true,
			workspaceId: createdWorkspace.id,
		};
		const workspaceRuntime = {
			archiveWorkspaceRuntime: vi.fn(async () => undefined),
			getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
			openWorkspace: vi.fn(async () => runtimeState),
			pauseWorkspace: vi.fn(async () => undefined),
			resumeWorkspace: vi.fn(async () => runtimeState),
		};
		const contextHarvester = {
			captureWorkspaceContext: vi.fn(),
			listPaneSnapshots: vi.fn(async () => []),
		};
		const runtimePermissionGate = {
			executeRuntimeActionWithPermission: vi.fn(),
			recordRuntimeAuditEvent: vi.fn(),
		};

		registerDesktopAgentHandlers(
			{} as unknown as DesktopRuntimeHost,
			{} as unknown as DesktopAuthService,
			{ disposeSession: vi.fn() } as unknown as DesktopPtyManager,
			{} as unknown as DesktopMcpManager,
			{} as unknown as DesktopApprovalBroker,
			async () => ({ defaultTools: [], providers: [] }),
			{
				eventStore: {} as DesktopEventStore,
				projectStore: { get: vi.fn(async () => project) } as unknown as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore: {} as DesktopSettingsStore,
			},
			{
				contextHarvester,
				runtimePermissionGate,
				workspaceRuntime,
				workspaceStore,
			},
		);

		const result = await getHandler(IPC_CHANNELS.createDebugWorkspaceRuntime)(undefined, {
			issue: "/api/login 一直 500，帮我定位并修掉。",
			projectId: "project-1",
		});

		expect(workspaceStore.createWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "project-1",
				repoPath: projectDir,
				taskTitle: "Workspace",
			}),
		);
		expect(workspaceStore.createWorkspace.mock.calls[0]?.[0].paneDefinitions).toEqual([
			{ id: "agent", role: "agent", title: "Agent" },
			{ id: "shell", role: "shell", title: "Shell" },
			{ command: "yarn run dev", cwd: projectDir, id: "dev-server", role: "dev-server", title: "Dev Server" },
			{ command: "yarn run test", cwd: projectDir, id: "test", role: "test", title: "Test" },
			{ command: "yarn run logs", cwd: projectDir, id: "logs", role: "logs", title: "Logs" },
		]);
		expect(workspaceStore.updateWorkspace).toHaveBeenCalledWith("ws-created", {
			paneDefinitions: [
				{ id: "agent", role: "agent", title: "Agent" },
				{ id: "shell", role: "shell", title: "Shell" },
				{ command: "yarn run dev", cwd: projectDir, id: "dev-server", role: "dev-server", title: "Dev Server" },
				{ command: "yarn run test", cwd: projectDir, id: "test", role: "test", title: "Test" },
				{ command: "yarn run logs", cwd: projectDir, id: "logs", role: "logs", title: "Logs" },
			],
		});
		expect(workspaceRuntime.openWorkspace).toHaveBeenCalledWith("ws-created");
		expect(result).toEqual(
			expect.objectContaining({
				runtimeStatus: "paused",
				workspace: expect.objectContaining({
					id: "ws-created",
					projectId: "project-1",
					taskTitle: "Workspace",
				}),
			}),
		);
		expect(JSON.stringify(result)).not.toContain("tmuxSocketPath");
	});
});
