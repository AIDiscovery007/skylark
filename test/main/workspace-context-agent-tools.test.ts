import { describe, expect, it, vi } from "vitest";
import type {
	PaneSnapshot,
	PaneSnapshotSummary,
	WorkspaceContextSnapshot,
} from "../../src/main/context/context-harvester.ts";
import {
	createWorkspaceContextToolDefinitions,
	WORKSPACE_CONTEXT_TOOL_NAMES,
} from "../../src/main/context/workspace-context-agent-tools.ts";
import type { WorkspaceRuntimeState } from "../../src/main/workspace/workspace-runtime-orchestrator.ts";
import type { DesktopWorkspaceCreateInput } from "../../src/main/workspace/workspace-store.ts";
import type { DesktopWorkspace } from "../../src/shared/types.ts";

function getTextContent(result: { content: Array<{ type: string; text?: string }> }): string {
	const [content] = result.content;
	if (!content || content.type !== "text" || typeof content.text !== "string") {
		throw new Error("Expected text tool result.");
	}
	return content.text;
}

describe("workspace context agent tools", () => {
	it("prepares a current-session workspace runtime without the old debug title", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_session",
			status: "running",
			tmuxAvailable: true,
			panes: [],
		};
		const createdWorkspace: DesktopWorkspace = {
			id: "ws_session",
			taskTitle: "Implement runtime tools",
			repoPath: "/workspace/project",
			piSessionId: "session-1",
			status: "created",
			paneDefinitions: [],
			resourcePolicy: {
				historyLimit: 20_000,
				idlePauseMinutes: 120,
				maxHotWorkspaces: 3,
				maxWorkspaceLogBytes: 1024,
				snapshotRetentionDays: 7,
			},
			createdAt: "2026-05-19T12:00:00.000Z",
			updatedAt: "2026-05-19T12:00:00.000Z",
		};
		const workspaceStore = {
			createWorkspace: vi.fn(async (input: DesktopWorkspaceCreateInput) => {
				void input;
				return createdWorkspace;
			}),
			listWorkspaces: vi.fn(async () => []),
			updateWorkspace: vi.fn(),
		};
		const tools = createWorkspaceContextToolDefinitions({
			contextHarvester: {
				captureWorkspaceContext: vi.fn(),
				captureWorkspacePane: vi.fn(),
				getPaneSnapshot: vi.fn(),
				listPaneSnapshots: vi.fn(async () => []),
			},
			currentWorkspace: {
				cwd: "/workspace/project",
				piSessionId: "session-1",
				sessionTitle: "Implement runtime tools",
			},
			workspaceRuntime: {
				getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
				openWorkspace: vi.fn(async () => runtimeState),
			},
			workspaceStore,
		});
		const prepareTool = tools.find((tool) => tool.name === WORKSPACE_CONTEXT_TOOL_NAMES.prepare);
		if (!prepareTool) {
			throw new Error("Expected prepare tool.");
		}

		const result = await prepareTool.execute("call-prepare", {}, undefined, undefined, undefined as never);
		const parsed = JSON.parse(getTextContent(result)) as { status: string; workspaceId: string };

		expect(parsed).toEqual(expect.objectContaining({ status: "running", workspaceId: "ws_session" }));
		expect(workspaceStore.createWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({
				piSessionId: "session-1",
				repoPath: "/workspace/project",
				taskTitle: "Implement runtime tools",
			}),
		);
		expect(JSON.stringify(workspaceStore.createWorkspace.mock.calls[0]?.[0])).not.toContain("fix-login-500");
	});

	it("sends text through the current session runtime with role-first addressing", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_session",
			status: "running",
			tmuxAvailable: true,
			panes: [
				{
					role: "test",
					title: "Tests",
					windowName: "test",
					paneId: "%1",
					controlOwner: "agent",
					dead: false,
					state: "running",
				},
			],
		};
		const workspace: DesktopWorkspace = {
			id: "ws_session",
			taskTitle: "Runtime tools",
			repoPath: "/workspace/project",
			piSessionId: "session-1",
			status: "running",
			paneDefinitions: [],
			resourcePolicy: {
				historyLimit: 20_000,
				idlePauseMinutes: 120,
				maxHotWorkspaces: 3,
				maxWorkspaceLogBytes: 1024,
				snapshotRetentionDays: 7,
			},
			createdAt: "2026-05-19T12:00:00.000Z",
			updatedAt: "2026-05-19T12:00:00.000Z",
		};
		const runtimePermissionGate = {
			executeRuntimeActionWithPermission: vi.fn(async () => ({
				status: "executed" as const,
				decision: {
					approved: true,
					decision: "auto-allowed" as const,
					decidedAt: "2026-05-19T12:00:00.000Z",
				},
				auditEvent: {
					id: "audit-1",
					workspaceId: "ws_session",
					actionType: "send-text" as const,
					requestedBy: "agent" as const,
					riskLevel: "low" as const,
					payloadPreview: "npm run check",
					decision: "auto-allowed" as const,
					resultStatus: "executed" as const,
					requestedAt: "2026-05-19T12:00:00.000Z",
					decidedAt: "2026-05-19T12:00:00.000Z",
					completedAt: "2026-05-19T12:00:00.000Z",
				},
			})),
		};
		const tools = createWorkspaceContextToolDefinitions({
			contextHarvester: {
				captureWorkspaceContext: vi.fn(),
				captureWorkspacePane: vi.fn(),
				getPaneSnapshot: vi.fn(),
				listPaneSnapshots: vi.fn(async () => []),
			},
			currentWorkspace: {
				cwd: "/workspace/project",
				piSessionId: "session-1",
			},
			now: () => new Date("2026-05-19T12:00:00.000Z"),
			runtimePermissionGate,
			workspaceRuntime: {
				getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
			},
			workspaceStore: {
				createWorkspace: vi.fn(),
				listWorkspaces: vi.fn(async () => [workspace]),
				updateWorkspace: vi.fn(),
			},
		});
		const sendTextTool = tools.find((tool) => tool.name === WORKSPACE_CONTEXT_TOOL_NAMES.sendText);
		if (!sendTextTool) {
			throw new Error("Expected send text tool.");
		}

		const result = await sendTextTool.execute(
			"call-send",
			{ paneRole: "test", text: "npm run check", pressEnter: true },
			undefined,
			undefined,
			undefined as never,
		);
		const parsed = JSON.parse(getTextContent(result)) as { actionStatus: string; workspaceId: string };

		expect(parsed).toEqual(expect.objectContaining({ actionStatus: "executed", workspaceId: "ws_session" }));
		expect(runtimePermissionGate.executeRuntimeActionWithPermission).toHaveBeenCalledWith({
			actionType: "send-text",
			paneRole: "test",
			pressEnter: true,
			requestedBy: "agent",
			riskLevel: "low",
			text: "npm run check",
			workspaceId: "ws_session",
		});
	});

	it("lists app-owned workspace panes with an audit detail payload", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "running",
			tmuxAvailable: true,
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			sessionName: "ws_login",
			panes: [
				{
					role: "dev-server",
					title: "Dev Server",
					windowName: "dev-server",
					paneId: "%1",
					currentCommand: "node",
					currentPath: "/workspace/project",
					controlOwner: "none",
					dead: false,
					state: "running",
				},
			],
		};
		const workspaceRuntime = {
			getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
		};
		const contextHarvester = {
			captureWorkspaceContext: vi.fn(),
			captureWorkspacePane: vi.fn(),
			getPaneSnapshot: vi.fn(),
			listPaneSnapshots: vi.fn(async () => []),
		};
		const tools = createWorkspaceContextToolDefinitions({
			contextHarvester,
			now: () => new Date("2026-05-19T12:00:00.000Z"),
			workspaceRuntime,
		});

		const listTool = tools.find((tool) => tool.name === WORKSPACE_CONTEXT_TOOL_NAMES.listPanes);
		if (!listTool) {
			throw new Error("Expected list panes tool.");
		}
		const result = await listTool.execute(
			"call-1",
			{ workspaceId: "ws_login" },
			undefined,
			undefined,
			undefined as never,
		);
		const parsed = JSON.parse(getTextContent(result)) as {
			status: string;
			panes: Array<{ role: string; paneId?: string; currentCommand?: string }>;
		};

		expect(parsed.status).toBe("running");
		expect(parsed).not.toHaveProperty("socketPath");
		expect(parsed).not.toHaveProperty("sessionName");
		expect(parsed.panes).toEqual([
			expect.objectContaining({ role: "dev-server", paneId: "%1", currentCommand: "node" }),
		]);
		expect(result.details).toEqual(
			expect.objectContaining({
				auditEvent: expect.objectContaining({
					operation: "list_workspace_panes",
					toolName: "workspace_runtime_list_panes",
					workspaceId: "ws_login",
					capturedAt: "2026-05-19T12:00:00.000Z",
				}),
			}),
		);
		expect(workspaceRuntime.getWorkspaceRuntimeState).toHaveBeenCalledWith("ws_login");
	});

	it("captures redacted pane context and records the snapshot in audit details", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "running",
			tmuxAvailable: true,
			panes: [],
		};
		const snapshot: PaneSnapshot = {
			id: "snapshot-1",
			workspaceId: "ws_login",
			paneId: "%2",
			paneRole: "logs",
			capturedAt: "2026-05-19T12:05:00.000Z",
			lineCount: 3,
			text: "Error: login failed\nTOKEN=[REDACTED:env-secret]",
			rawTextStored: false,
			redactions: [{ kind: "env-secret", count: 1 }],
			extractedBlocks: [{ kind: "error", text: "Error: login failed" }],
			reason: "debug login 500",
		};
		const workspaceRuntime = {
			getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
		};
		const contextHarvester = {
			captureWorkspaceContext: vi.fn<() => Promise<WorkspaceContextSnapshot>>(),
			captureWorkspacePane: vi.fn(async () => snapshot),
			getPaneSnapshot: vi.fn(),
			listPaneSnapshots: vi.fn(async () => []),
		};
		const tools = createWorkspaceContextToolDefinitions({
			contextHarvester,
			workspaceRuntime,
		});

		const captureTool = tools.find((tool) => tool.name === WORKSPACE_CONTEXT_TOOL_NAMES.capturePane);
		if (!captureTool) {
			throw new Error("Expected capture pane tool.");
		}
		expect(captureTool.name).toBe(WORKSPACE_CONTEXT_TOOL_NAMES.capturePane);
		const result = await captureTool.execute(
			"call-2",
			{ workspaceId: "ws_login", paneRole: "logs", lines: 800, reason: "debug login 500" },
			undefined,
			undefined,
			undefined as never,
		);
		const parsed = JSON.parse(getTextContent(result)) as {
			status: string;
			snapshotId: string;
			text: string;
			redactions: Array<{ kind: string; count: number }>;
		};

		expect(parsed.status).toBe("captured");
		expect(parsed.snapshotId).toBe("snapshot-1");
		expect(parsed.text).toContain("[REDACTED:env-secret]");
		expect(parsed.text).not.toContain("super-secret");
		expect(parsed.redactions).toEqual([{ kind: "env-secret", count: 1 }]);
		expect(contextHarvester.captureWorkspacePane).toHaveBeenCalledWith({
			workspaceId: "ws_login",
			paneRole: "logs",
			lines: 800,
			reason: "debug login 500",
		});
		expect(result.details).toEqual(
			expect.objectContaining({
				auditEvent: expect.objectContaining({
					operation: "capture_pane_context",
					paneRole: "logs",
					paneId: "%2",
					snapshotIds: ["snapshot-1"],
					workspaceId: "ws_login",
				}),
				extractedBlockCount: 1,
				redactions: [{ kind: "env-secret", count: 1 }],
			}),
		);
	});

	it("falls back to latest snapshots when workspace runtime is paused", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "paused",
			tmuxAvailable: true,
			panes: [
				{
					role: "test",
					title: "Tests",
					windowName: "test",
					controlOwner: "none",
					dead: false,
					state: "missing",
				},
			],
		};
		const latestSnapshot: PaneSnapshotSummary = {
			id: "snapshot-paused",
			workspaceId: "ws_login",
			paneId: "%3",
			paneRole: "test",
			capturedAt: "2026-05-19T12:03:00.000Z",
			lineCount: 10,
			redactions: [],
			extractedBlocks: [{ kind: "test-failure", text: "expected 200 received 500" }],
		};
		const workspaceRuntime = {
			getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
		};
		const contextHarvester = {
			captureWorkspaceContext: vi.fn(),
			captureWorkspacePane: vi.fn(),
			getPaneSnapshot: vi.fn(),
			listPaneSnapshots: vi.fn(async () => [latestSnapshot]),
		};
		const tools = createWorkspaceContextToolDefinitions({
			contextHarvester,
			now: () => new Date("2026-05-19T12:10:00.000Z"),
			workspaceRuntime,
		});
		expect(tools.map((tool) => tool.name)).toEqual(
			expect.arrayContaining(Object.values(WORKSPACE_CONTEXT_TOOL_NAMES)),
		);
		expect(tools.map((tool) => tool.name).join(" ")).not.toContain("tmux_");

		const captureTool = tools.find((tool) => tool.name === WORKSPACE_CONTEXT_TOOL_NAMES.captureWorkspace);
		if (!captureTool) {
			throw new Error("Expected capture workspace tool.");
		}
		expect(captureTool.name).toBe(WORKSPACE_CONTEXT_TOOL_NAMES.captureWorkspace);
		const result = await captureTool.execute(
			"call-3",
			{ workspaceId: "ws_login", roles: ["test"], reason: "resume debug" },
			undefined,
			undefined,
			undefined as never,
		);
		const parsed = JSON.parse(getTextContent(result)) as {
			status: string;
			runtimeStatus: string;
			latestSnapshots: Array<{ id: string }>;
		};

		expect(parsed.status).toBe("runtime_unavailable");
		expect(parsed.runtimeStatus).toBe("paused");
		expect(parsed.latestSnapshots).toEqual([expect.objectContaining({ id: "snapshot-paused" })]);
		expect(contextHarvester.captureWorkspaceContext).not.toHaveBeenCalled();
		expect(result.details).toEqual(
			expect.objectContaining({
				runtimeStatus: "paused",
				snapshotIds: ["snapshot-paused"],
				auditEvent: expect.objectContaining({
					operation: "capture_workspace_context",
					capturedAt: "2026-05-19T12:10:00.000Z",
				}),
			}),
		);
	});
});
