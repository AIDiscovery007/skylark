import { describe, expect, it, vi } from "vitest";
import {
	type RuntimeAuditEvent,
	RuntimePermissionGate,
} from "../../src/main/runtime-permissions/runtime-permission-gate.ts";
import { DesktopApprovalBroker } from "../../src/main/security/approval-broker.ts";
import type { WorkspaceRuntimeState } from "../../src/main/workspace/workspace-runtime-orchestrator.ts";
import { DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS } from "../../src/shared/types.ts";

async function waitForBrokerEmit(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

class InMemoryRuntimeAuditStore {
	readonly events: RuntimeAuditEvent[] = [];

	async recordRuntimeAuditEvent(event: RuntimeAuditEvent): Promise<void> {
		this.events.push(event);
	}
}

describe("RuntimePermissionGate", () => {
	it("requires approval before high-risk agent send-text reaches tmux and records a redacted audit event", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "running",
			tmuxAvailable: true,
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			sessionName: "ws_login",
			panes: [
				{
					role: "test",
					title: "Tests",
					windowName: "test",
					paneId: "%1",
					currentCommand: "zsh",
					currentPath: "/workspace/project",
					controlOwner: "none",
					dead: false,
					state: "running",
				},
			],
		};
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);
		const auditStore = new InMemoryRuntimeAuditStore();
		const tmuxRuntime = {
			sendText: vi.fn(async () => undefined),
			killSession: vi.fn(async () => undefined),
		};
		const gate = new RuntimePermissionGate({
			approvalBroker: broker,
			auditStore,
			now: () => new Date("2026-05-19T13:00:00.000Z"),
			tmuxRuntime,
			workspaceRuntime: {
				getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
				pauseWorkspace: vi.fn(async () => undefined),
			},
		});

		const resultPromise = gate.executeRuntimeActionWithPermission({
			actionType: "send-text",
			paneRole: "test",
			reason: "verify login fix",
			requestedBy: "agent",
			riskLevel: "high",
			text: "OPENAI_API_KEY=sk-proj-secretsecretsecretsecret pnpm test auth",
			workspaceId: "ws_login",
			pressEnter: true,
		});
		await waitForBrokerEmit();

		expect(tmuxRuntime.sendText).not.toHaveBeenCalled();
		const request = listener.mock.calls[0]?.[0].request;
		expect(request.category).toBe("terminal");
		expect(request.details.payloadPreview).toContain("[REDACTED:env-secret]");
		expect(request.details.payloadPreview).not.toContain("sk-proj-secretsecretsecretsecret");
		expect(await gate.listPendingRuntimeApprovals("ws_login")).toEqual([
			expect.objectContaining({ id: request.id, workspaceId: "ws_login", actionType: "send-text" }),
		]);

		await gate.approveRuntimeAction(request.id);
		const result = await resultPromise;

		expect(result.status).toBe("executed");
		expect(tmuxRuntime.sendText).toHaveBeenCalledWith({
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			paneId: "%1",
			text: "OPENAI_API_KEY=sk-proj-secretsecretsecretsecret pnpm test auth",
			pressEnter: true,
		});
		expect(auditStore.events).toEqual([
			expect.objectContaining({
				actionType: "send-text",
				decision: "approved",
				payloadPreview: expect.stringContaining("[REDACTED:env-secret]"),
				resultStatus: "executed",
				workspaceId: "ws_login",
			}),
		]);
	});

	it("auto-allows low-risk agent writes to agent-owned panes while auditing them", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "running",
			tmuxAvailable: true,
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			sessionName: "ws_login",
			panes: [
				{
					role: "test",
					title: "Tests",
					windowName: "test",
					paneId: "%1",
					currentCommand: "zsh",
					currentPath: "/workspace/project",
					controlOwner: "agent",
					dead: false,
					state: "running",
				},
			],
		};
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);
		const auditStore = new InMemoryRuntimeAuditStore();
		const tmuxRuntime = {
			sendText: vi.fn(async () => undefined),
			killSession: vi.fn(async () => undefined),
		};
		const gate = new RuntimePermissionGate({
			approvalBroker: broker,
			auditStore,
			tmuxRuntime,
			workspaceRuntime: {
				getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
			},
		});

		const result = await gate.executeRuntimeActionWithPermission({
			actionType: "send-text",
			paneRole: "test",
			requestedBy: "agent",
			riskLevel: "low",
			text: "npm run check",
			workspaceId: "ws_login",
			pressEnter: true,
		});

		expect(listener).not.toHaveBeenCalled();
		expect(result.status).toBe("executed");
		expect(tmuxRuntime.sendText).toHaveBeenCalledWith({
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			paneId: "%1",
			text: "npm run check",
			pressEnter: true,
		});
		expect(auditStore.events).toEqual([
			expect.objectContaining({ decision: "auto-allowed", requestedBy: "agent", resultStatus: "executed" }),
		]);
	});

	it("returns a denied result without writing to tmux when the approval is denied", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "running",
			tmuxAvailable: true,
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			sessionName: "ws_login",
			panes: [
				{
					role: "shell",
					title: "Shell",
					windowName: "shell",
					paneId: "%2",
					currentCommand: "zsh",
					currentPath: "/workspace/project",
					controlOwner: "none",
					dead: false,
					state: "running",
				},
			],
		};
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);
		const auditStore = new InMemoryRuntimeAuditStore();
		const tmuxRuntime = {
			sendText: vi.fn(async () => undefined),
			killSession: vi.fn(async () => undefined),
		};
		const gate = new RuntimePermissionGate({
			approvalBroker: broker,
			auditStore,
			tmuxRuntime,
			workspaceRuntime: {
				getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
			},
		});

		const resultPromise = gate.executeRuntimeActionWithPermission({
			actionType: "send-text",
			paneRole: "shell",
			reason: "try a destructive command",
			requestedBy: "agent",
			riskLevel: "high",
			text: "rm -rf tmp",
			workspaceId: "ws_login",
		});
		await waitForBrokerEmit();
		const request = listener.mock.calls[0]?.[0].request;

		await gate.denyRuntimeAction(request.id, "Do not run destructive commands.");
		const result = await resultPromise;

		expect(result.status).toBe("denied");
		expect(result.message).toBe("Do not run destructive commands.");
		expect(tmuxRuntime.sendText).not.toHaveBeenCalled();
		expect(auditStore.events).toEqual([
			expect.objectContaining({
				decision: "denied",
				resultStatus: "denied",
				errorMessage: "Do not run destructive commands.",
			}),
		]);
	});

	it("auto-allows user-requested terminal writes while still auditing them", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "running",
			tmuxAvailable: true,
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			sessionName: "ws_login",
			panes: [
				{
					role: "shell",
					title: "Shell",
					windowName: "shell",
					paneId: "%3",
					currentCommand: "zsh",
					currentPath: "/workspace/project",
					controlOwner: "none",
					dead: false,
					state: "running",
				},
			],
		};
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);
		const auditStore = new InMemoryRuntimeAuditStore();
		const tmuxRuntime = {
			sendText: vi.fn(async () => undefined),
			killSession: vi.fn(async () => undefined),
		};
		const gate = new RuntimePermissionGate({
			approvalBroker: broker,
			auditStore,
			tmuxRuntime,
			workspaceRuntime: {
				getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
			},
		});

		const result = await gate.executeRuntimeActionWithPermission({
			actionType: "send-text",
			paneRole: "shell",
			requestedBy: "user",
			riskLevel: "low",
			text: "pwd",
			workspaceId: "ws_login",
		});

		expect(listener).not.toHaveBeenCalled();
		expect(result.status).toBe("executed");
		expect(tmuxRuntime.sendText).toHaveBeenCalledWith({
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			paneId: "%3",
			text: "pwd",
		});
		expect(auditStore.events).toEqual([
			expect.objectContaining({ decision: "auto-allowed", requestedBy: "user", resultStatus: "executed" }),
		]);
	});

	it("fails write actions before approval when the workspace runtime is paused", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "paused",
			tmuxAvailable: true,
			panes: [],
		};
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);
		const auditStore = new InMemoryRuntimeAuditStore();
		const tmuxRuntime = {
			sendText: vi.fn(async () => undefined),
			killSession: vi.fn(async () => undefined),
		};
		const gate = new RuntimePermissionGate({
			approvalBroker: broker,
			auditStore,
			tmuxRuntime,
			workspaceRuntime: {
				getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
			},
		});

		const result = await gate.executeRuntimeActionWithPermission({
			actionType: "send-text",
			paneRole: "test",
			requestedBy: "agent",
			riskLevel: "medium",
			text: "pnpm test auth",
			workspaceId: "ws_login",
		});

		expect(result.status).toBe("failed");
		expect(result.message).toContain("Resume it before writing");
		expect(listener).not.toHaveBeenCalled();
		expect(tmuxRuntime.sendText).not.toHaveBeenCalled();
		expect(auditStore.events).toEqual([expect.objectContaining({ decision: "blocked", resultStatus: "failed" })]);
	});

	it("blocks agent writes while a pane is under user control", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "running",
			tmuxAvailable: true,
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			sessionName: "ws_login",
			panes: [
				{
					role: "shell",
					title: "Shell",
					windowName: "shell",
					paneId: "%3",
					currentCommand: "zsh",
					currentPath: "/workspace/project",
					controlOwner: "user",
					dead: false,
					state: "running",
				},
			],
		};
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);
		const auditStore = new InMemoryRuntimeAuditStore();
		const tmuxRuntime = {
			sendText: vi.fn(async () => undefined),
			killSession: vi.fn(async () => undefined),
		};
		const gate = new RuntimePermissionGate({
			approvalBroker: broker,
			auditStore,
			tmuxRuntime,
			workspaceRuntime: {
				getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
			},
		});

		const result = await gate.executeRuntimeActionWithPermission({
			actionType: "send-text",
			paneRole: "shell",
			requestedBy: "agent",
			riskLevel: "medium",
			text: "pnpm install",
			workspaceId: "ws_login",
		});

		expect(result.status).toBe("failed");
		expect(result.message).toContain("Pane is under user control");
		expect(listener).not.toHaveBeenCalled();
		expect(tmuxRuntime.sendText).not.toHaveBeenCalled();
		expect(auditStore.events).toEqual([
			expect.objectContaining({
				decision: "blocked",
				paneRole: "shell",
				payloadPreview: "pnpm install",
				resultStatus: "failed",
			}),
		]);
	});

	it("blocks writes to pane ids outside the workspace runtime state", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "running",
			tmuxAvailable: true,
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			sessionName: "ws_login",
			panes: [
				{
					role: "shell",
					title: "Shell",
					windowName: "shell",
					paneId: "%3",
					currentCommand: "zsh",
					currentPath: "/workspace/project",
					controlOwner: "none",
					dead: false,
					state: "running",
				},
			],
		};
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);
		const auditStore = new InMemoryRuntimeAuditStore();
		const tmuxRuntime = {
			sendText: vi.fn(async () => undefined),
			killSession: vi.fn(async () => undefined),
		};
		const gate = new RuntimePermissionGate({
			approvalBroker: broker,
			auditStore,
			tmuxRuntime,
			workspaceRuntime: {
				getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
			},
		});

		const result = await gate.executeRuntimeActionWithPermission({
			actionType: "send-text",
			paneId: "%99",
			requestedBy: "user",
			riskLevel: "low",
			text: "pwd",
			workspaceId: "ws_login",
		});

		expect(result.status).toBe("failed");
		expect(result.message).toContain("Workspace pane does not exist");
		expect(listener).not.toHaveBeenCalled();
		expect(tmuxRuntime.sendText).not.toHaveBeenCalled();
		expect(auditStore.events).toEqual([
			expect.objectContaining({
				decision: "blocked",
				paneId: "%99",
				resultStatus: "failed",
			}),
		]);
	});

	it("blocks writes to dead workspace panes before approval", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "running",
			tmuxAvailable: true,
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			sessionName: "ws_login",
			panes: [
				{
					role: "test",
					title: "Tests",
					windowName: "test",
					paneId: "%4",
					currentCommand: "vitest",
					currentPath: "/workspace/project",
					controlOwner: "none",
					dead: true,
					state: "dead",
				},
			],
		};
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);
		const auditStore = new InMemoryRuntimeAuditStore();
		const tmuxRuntime = {
			sendText: vi.fn(async () => undefined),
			killSession: vi.fn(async () => undefined),
		};
		const gate = new RuntimePermissionGate({
			approvalBroker: broker,
			auditStore,
			tmuxRuntime,
			workspaceRuntime: {
				getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
			},
		});

		const result = await gate.executeRuntimeActionWithPermission({
			actionType: "send-text",
			paneRole: "test",
			requestedBy: "agent",
			riskLevel: "medium",
			text: "pnpm test",
			workspaceId: "ws_login",
		});

		expect(result.status).toBe("failed");
		expect(result.message).toContain("Workspace pane is not running");
		expect(listener).not.toHaveBeenCalled();
		expect(tmuxRuntime.sendText).not.toHaveBeenCalled();
		expect(auditStore.events).toEqual([
			expect.objectContaining({
				decision: "blocked",
				paneRole: "test",
				resultStatus: "failed",
			}),
		]);
	});

	it("auto-allows agent stop and restart for agent-owned panes", async () => {
		const runtimeState: WorkspaceRuntimeState = {
			workspaceId: "ws_login",
			status: "running",
			tmuxAvailable: true,
			socketPath: "/tmp/pi-desktop/ws_login.sock",
			sessionName: "ws_login",
			panes: [
				{
					role: "test",
					title: "Tests",
					windowName: "test",
					paneId: "%4",
					currentCommand: "vitest",
					currentPath: "/workspace/project",
					controlOwner: "agent",
					dead: false,
					state: "running",
				},
			],
		};
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);
		const auditStore = new InMemoryRuntimeAuditStore();
		const tmuxRuntime = {
			sendText: vi.fn(async () => undefined),
			killSession: vi.fn(async () => undefined),
		};
		const workspaceRuntime = {
			getWorkspaceRuntimeState: vi.fn(async () => runtimeState),
			restartPane: vi.fn(async () => runtimeState),
			stopPane: vi.fn(async () => runtimeState),
		};
		const gate = new RuntimePermissionGate({
			approvalBroker: broker,
			auditStore,
			tmuxRuntime,
			workspaceRuntime,
		});

		const stopResult = await gate.executeRuntimeActionWithPermission({
			actionType: "stop-pane",
			paneRole: "test",
			requestedBy: "agent",
			riskLevel: "low",
			workspaceId: "ws_login",
		});
		const restartResult = await gate.executeRuntimeActionWithPermission({
			actionType: "restart-pane",
			paneRole: "test",
			requestedBy: "agent",
			riskLevel: "low",
			workspaceId: "ws_login",
		});

		expect(listener).not.toHaveBeenCalled();
		expect(stopResult.status).toBe("executed");
		expect(restartResult.status).toBe("executed");
		expect(workspaceRuntime.stopPane).toHaveBeenCalledWith("ws_login", "test");
		expect(workspaceRuntime.restartPane).toHaveBeenCalledWith("ws_login", "test");
		expect(auditStore.events).toEqual([
			expect.objectContaining({ actionType: "stop-pane", decision: "auto-allowed" }),
			expect.objectContaining({ actionType: "restart-pane", decision: "auto-allowed" }),
		]);
	});
});
