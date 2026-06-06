import { describe, expect, it, vi } from "vitest";
import {
	type BridgeIpcRenderer,
	type BridgeMessageChannel,
	type BridgeMessageEvent,
	type BridgeMessagePort,
	createDesktopAgentBridge,
} from "../../src/preload/create-bridge.ts";
import { IPC_CHANNELS } from "../../src/shared/ipc-contract.ts";
import type { SerializedAgentEvent } from "../../src/shared/serialized-agent-event.ts";
import type { SerializedTerminalEvent } from "../../src/shared/serialized-terminal-event.ts";
import type {
	DesktopApprovalEvent,
	DesktopEnvironmentEvent,
	DesktopEventEvent,
	DesktopSettingsEvent,
	DesktopWorkspaceRuntimeEvent,
} from "../../src/shared/types.ts";

class FakeMessagePort<TData> implements BridgeMessagePort<TData> {
	private listeners = new Set<(event: BridgeMessageEvent<TData>) => void>();
	readonly start = vi.fn();

	addEventListener(_type: "message", listener: (event: BridgeMessageEvent<TData>) => void): void {
		this.listeners.add(listener);
	}

	removeEventListener(_type: "message", listener: (event: BridgeMessageEvent<TData>) => void): void {
		this.listeners.delete(listener);
	}

	emit(data: TData): void {
		for (const listener of this.listeners) {
			listener({ data });
		}
	}
}

describe("createDesktopAgentBridge", () => {
	it("exposes only the intended desktop methods", () => {
		const ipcRenderer: BridgeIpcRenderer = {
			invoke: vi.fn(),
			postMessage: vi.fn(),
		};

		const bridge = createDesktopAgentBridge(ipcRenderer, () => ({
			port1: new FakeMessagePort<SerializedAgentEvent>(),
			port2: {},
		}));

		expect(Object.keys(bridge).sort()).toEqual([
			"abort",
			"addEventComment",
			"applyEventManagementProposal",
			"archiveWorkspaceRuntime",
			"cancelOAuthLogin",
			"captureWorkspaceRuntimeContext",
			"compact",
			"consumeProposedPlan",
			"createDebugWorkspaceRuntime",
			"createEvent",
			"createEventManagementProposal",
			"createProjectFromFolder",
			"createSkill",
			"createTerminal",
			"deleteEvent",
			"deletePromptTemplate",
			"deleteProviderKey",
			"deleteSession",
			"detachEnvironmentResource",
			"disposeTerminal",
			"executePlan",
			"getCapabilityDetail",
			"getEvent",
			"getEventManagementCriteria",
			"getNativeAppearance",
			"getReviewFilePatch",
			"getReviewSnapshot",
			"getRuntimeCatalog",
			"getSessionMessages",
			"getSettings",
			"getSnapshot",
			"getStorageSecurityState",
			"getSubagentSnapshot",
			"getWorkspaceOverview",
			"listCapabilities",
			"listEnvironmentResources",
			"listEvents",
			"listOAuthProviders",
			"listProjects",
			"listProviderKeys",
			"listSessions",
			"listWorkspaceFiles",
			"listWorkspaceRuntimes",
			"logoutOAuthProvider",
			"newSession",
			"notifyFirstInteractive",
			"openEventAttachments",
			"openExternalUrl",
			"openPreviewFiles",
			"openPromptAttachments",
			"openSettingsWindow",
			"openWorkspacePreviewFile",
			"openWorkspaceRuntime",
			"pauseWorkspaceRuntime",
			"prepareEventAttachments",
			"preparePromptAttachments",
			"prompt",
			"refreshPreviewFile",
			"reloadCapabilities",
			"resizeTerminal",
			"resolveApproval",
			"restartMcpServer",
			"resumeWorkspaceRuntime",
			"returnWorkspaceRuntimePaneControl",
			"runEvent",
			"saveEventManagementCriteria",
			"sendWorkspaceRuntimePaneText",
			"setEventStatus",
			"setMcpServerEnabled",
			"setProviderKey",
			"setSessionMode",
			"setSetting",
			"startOAuthLogin",
			"submitOAuthLoginCode",
			"subscribeToAgentEvents",
			"subscribeToApprovalEvents",
			"subscribeToAuthEvents",
			"subscribeToCapabilityEvents",
			"subscribeToEnvironmentEvents",
			"subscribeToEventEvents",
			"subscribeToSettingsEvents",
			"subscribeToSettingsOpenRequests",
			"subscribeToSubagentEvents",
			"subscribeToTerminalEvents",
			"subscribeToWorkspaceRuntimeEvents",
			"switchProject",
			"switchSession",
			"takeOverWorkspaceRuntimePane",
			"testMcpServer",
			"testProviderKey",
			"updateEvent",
			"updateSessionProfile",
			"upsertMcpServer",
			"upsertPromptTemplate",
			"writeTerminal",
		]);
		expect("invoke" in bridge).toBe(false);
	});

	it("invokes the session messages channel with the paging request", async () => {
		const ipcRenderer: BridgeIpcRenderer = {
			invoke: vi.fn(async () => ({
				sessionId: "session-1",
				messages: [],
				window: { start: 0, end: 0, total: 0, hasMoreBefore: false },
			})),
			postMessage: vi.fn(),
		};
		const bridge = createDesktopAgentBridge(ipcRenderer, () => ({
			port1: new FakeMessagePort<SerializedAgentEvent>(),
			port2: {},
		}));

		const request = { sessionId: "session-1", before: 120, limit: 80 };
		await bridge.getSessionMessages(request);

		expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.getSessionMessages, request);
	});

	it("opens the stream channel once and forwards events", async () => {
		const port = new FakeMessagePort<SerializedAgentEvent>();
		const ipcRenderer = {
			invoke: vi.fn(async (channel: string) => {
				if (channel === IPC_CHANNELS.getSnapshot) {
					return {
						sessionId: "session-1",
						cwd: "/workspace/project",
						agentMode: "execute",
						diagnostics: [],
						thinkingLevel: "off",
						availableTools: [],
						messages: [],
						pendingToolCalls: [],
						isStreaming: false,
					};
				}
				return undefined;
			}),
			postMessage: vi.fn(),
		};

		const bridge = createDesktopAgentBridge(
			ipcRenderer,
			(): BridgeMessageChannel<SerializedAgentEvent> => ({
				port1: port,
				port2: { id: "renderer-port" },
			}),
		);

		const listener = vi.fn();
		const unsubscribe = bridge.subscribeToAgentEvents(listener);
		port.emit({ type: "agent_start", sessionId: "session-1" });
		unsubscribe();
		port.emit({ type: "agent_end", sessionId: "session-1", messages: [] });

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(ipcRenderer.postMessage).toHaveBeenCalledWith(IPC_CHANNELS.openStream, null, [{ id: "renderer-port" }]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({ type: "agent_start", sessionId: "session-1" });
	});

	it("invokes the workspace overview channel", async () => {
		const overview = {
			settings: { lastOpenedProjectId: "project-1" },
			projects: [],
			sessionsByProjectId: {},
			activeProjectId: "project-1",
		};
		const ipcRenderer = {
			invoke: vi.fn(async () => overview),
			postMessage: vi.fn(),
		};
		const bridge = createDesktopAgentBridge(ipcRenderer, () => ({
			port1: new FakeMessagePort<SerializedAgentEvent>(),
			port2: {},
		}));

		await expect(bridge.getWorkspaceOverview()).resolves.toBe(overview);
		expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.getWorkspaceOverview);
	});

	it("invokes the review file patch channel", async () => {
		const ipcRenderer: BridgeIpcRenderer = {
			invoke: vi.fn(async () => ({ path: "src/App.tsx", patch: "diff --git" })),
			postMessage: vi.fn(),
		};
		const bridge = createDesktopAgentBridge(ipcRenderer, () => ({
			port1: new FakeMessagePort<SerializedAgentEvent>(),
			port2: {},
		}));

		await expect(bridge.getReviewFilePatch({ path: "src/App.tsx", projectId: "project-1" })).resolves.toEqual({
			path: "src/App.tsx",
			patch: "diff --git",
		});
		expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.getReviewFilePatch, {
			path: "src/App.tsx",
			projectId: "project-1",
		});
	});

	it("opens the terminal stream channel once and forwards terminal events", () => {
		const port = new FakeMessagePort<SerializedTerminalEvent>();
		const ipcRenderer = {
			invoke: vi.fn(),
			postMessage: vi.fn(),
		};

		const bridge = createDesktopAgentBridge(
			ipcRenderer,
			(): BridgeMessageChannel<SerializedTerminalEvent> => ({
				port1: port,
				port2: { id: "terminal-port" },
			}),
		);

		const listener = vi.fn();
		const unsubscribe = bridge.subscribeToTerminalEvents(listener);
		port.emit({ type: "terminal_data", terminalId: "terminal-1", sessionId: "session-1", data: "pwd\r\n" });
		unsubscribe();
		port.emit({ type: "terminal_exit", terminalId: "terminal-1", sessionId: "session-1", exitCode: 0 });

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(ipcRenderer.postMessage).toHaveBeenCalledWith(IPC_CHANNELS.openTerminalStream, null, [
			{ id: "terminal-port" },
		]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({
			type: "terminal_data",
			terminalId: "terminal-1",
			sessionId: "session-1",
			data: "pwd\r\n",
		});
	});

	it("opens the auth stream channel once and forwards auth events", () => {
		const port = new FakeMessagePort<{ type: "success"; provider: string }>();
		const ipcRenderer = {
			invoke: vi.fn(),
			postMessage: vi.fn(),
		};

		const bridge = createDesktopAgentBridge(
			ipcRenderer,
			(): BridgeMessageChannel<{ type: "success"; provider: string }> => ({
				port1: port,
				port2: { id: "auth-port" },
			}),
		);

		const listener = vi.fn();
		const unsubscribe = bridge.subscribeToAuthEvents(listener);
		port.emit({ type: "success", provider: "openai-codex" });
		unsubscribe();
		port.emit({ type: "cancelled", provider: "openai-codex" } as never);

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(ipcRenderer.postMessage).toHaveBeenCalledWith(IPC_CHANNELS.openAuthStream, null, [{ id: "auth-port" }]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({ type: "success", provider: "openai-codex" });
	});

	it("invokes and subscribes to settings open requests", async () => {
		const ipcListeners = new Map<string, (event: unknown, request: unknown) => void>();
		const ipcRenderer: BridgeIpcRenderer = {
			invoke: vi.fn(),
			on: vi.fn((channel: string, listener: (event: unknown, request: unknown) => void) => {
				ipcListeners.set(channel, listener);
			}),
			off: vi.fn((channel: string) => {
				ipcListeners.delete(channel);
			}),
			postMessage: vi.fn(),
		};
		const bridge = createDesktopAgentBridge(ipcRenderer, () => ({
			port1: new FakeMessagePort<SerializedAgentEvent>(),
			port2: {},
		}));
		const listener = vi.fn();

		const unsubscribe = bridge.subscribeToSettingsOpenRequests(listener);
		await bridge.openSettingsWindow({ section: "credentials", providerId: "openai" });
		ipcListeners.get(IPC_CHANNELS.settingsNavigationRequest)?.(undefined, {
			section: "credentials",
			providerId: "anthropic",
		});
		unsubscribe();

		expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.openSettingsWindow, {
			section: "credentials",
			providerId: "openai",
		});
		expect(listener).toHaveBeenCalledWith({ section: "credentials", providerId: "anthropic" });
		expect(ipcRenderer.off).toHaveBeenCalledWith(IPC_CHANNELS.settingsNavigationRequest, expect.any(Function));
	});

	it("opens the capability stream channel once and forwards capability events", () => {
		const port = new FakeMessagePort<{ type: "mcp_status_changed"; server: { id: string } }>();
		const ipcRenderer = {
			invoke: vi.fn(),
			postMessage: vi.fn(),
		};

		const bridge = createDesktopAgentBridge(
			ipcRenderer,
			(): BridgeMessageChannel<{ type: "mcp_status_changed"; server: { id: string } }> => ({
				port1: port,
				port2: { id: "capability-port" },
			}),
		);

		const listener = vi.fn();
		const unsubscribe = bridge.subscribeToCapabilityEvents(listener);
		port.emit({ type: "mcp_status_changed", server: { id: "server-1" } });
		unsubscribe();
		port.emit({ type: "mcp_status_changed", server: { id: "server-2" } });

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(ipcRenderer.postMessage).toHaveBeenCalledWith(IPC_CHANNELS.openCapabilityStream, null, [
			{ id: "capability-port" },
		]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({ type: "mcp_status_changed", server: { id: "server-1" } });
	});

	it("opens the approval stream channel once and forwards approval events", () => {
		const port = new FakeMessagePort<DesktopApprovalEvent>();
		const ipcRenderer = {
			invoke: vi.fn(),
			postMessage: vi.fn(),
		};

		const bridge = createDesktopAgentBridge(
			ipcRenderer,
			(): BridgeMessageChannel<DesktopApprovalEvent> => ({
				port1: port,
				port2: { id: "approval-port" },
			}),
		);

		const listener = vi.fn();
		const unsubscribe = bridge.subscribeToApprovalEvents(listener);
		port.emit({
			type: "approval_requested",
			request: {
				id: "approval-1",
				category: "bash",
				action: "bash",
				title: "Run shell command",
				createdAt: "2026-05-01T00:00:00.000Z",
			},
		});
		unsubscribe();
		port.emit({
			type: "approval_resolved",
			decision: { requestId: "approval-1", approved: true },
		});

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(ipcRenderer.postMessage).toHaveBeenCalledWith(IPC_CHANNELS.openApprovalStream, null, [
			{ id: "approval-port" },
		]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({
			type: "approval_requested",
			request: {
				id: "approval-1",
				category: "bash",
				action: "bash",
				title: "Run shell command",
				createdAt: "2026-05-01T00:00:00.000Z",
			},
		});
	});

	it("opens the event stream channel once and forwards event updates", () => {
		const port = new FakeMessagePort<DesktopEventEvent>();
		const ipcRenderer = {
			invoke: vi.fn(),
			postMessage: vi.fn(),
		};

		const bridge = createDesktopAgentBridge(
			ipcRenderer,
			(): BridgeMessageChannel<DesktopEventEvent> => ({
				port1: port,
				port2: { id: "event-port" },
			}),
		);

		const listener = vi.fn();
		const unsubscribe = bridge.subscribeToEventEvents(listener);
		port.emit({
			type: "event_deleted",
			eventId: "event-1",
			updatedAt: "2026-05-22T00:00:00.000Z",
		});
		unsubscribe();
		port.emit({
			type: "event_deleted",
			eventId: "event-2",
			updatedAt: "2026-05-22T00:00:01.000Z",
		});

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(ipcRenderer.postMessage).toHaveBeenCalledWith(IPC_CHANNELS.openEventStream, null, [{ id: "event-port" }]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({
			type: "event_deleted",
			eventId: "event-1",
			updatedAt: "2026-05-22T00:00:00.000Z",
		});
	});

	it("opens the settings stream channel once and forwards settings updates", () => {
		const port = new FakeMessagePort<DesktopSettingsEvent>();
		const ipcRenderer = {
			invoke: vi.fn(),
			postMessage: vi.fn(),
		};

		const bridge = createDesktopAgentBridge(
			ipcRenderer,
			(): BridgeMessageChannel<DesktopSettingsEvent> => ({
				port1: port,
				port2: { id: "settings-port" },
			}),
		);

		const listener = vi.fn();
		const unsubscribe = bridge.subscribeToSettingsEvents(listener);
		port.emit({
			type: "settings_updated",
			settings: { showThinkingBlocks: true },
		});
		unsubscribe();
		port.emit({
			type: "settings_updated",
			settings: { showThinkingBlocks: false },
		});

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(ipcRenderer.postMessage).toHaveBeenCalledWith(IPC_CHANNELS.openSettingsStream, null, [
			{ id: "settings-port" },
		]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({
			type: "settings_updated",
			settings: { showThinkingBlocks: true },
		});
	});

	it("opens the environment stream channel once and forwards environment updates", () => {
		const port = new FakeMessagePort<DesktopEnvironmentEvent>();
		const ipcRenderer = {
			invoke: vi.fn(),
			postMessage: vi.fn(),
		};

		const bridge = createDesktopAgentBridge(
			ipcRenderer,
			(): BridgeMessageChannel<DesktopEnvironmentEvent> => ({
				port1: port,
				port2: { id: "environment-port" },
			}),
		);

		const listener = vi.fn();
		const unsubscribe = bridge.subscribeToEnvironmentEvents(listener);
		port.emit({
			type: "environment_resources_updated",
			resources: [],
			updatedAt: "2026-05-22T00:00:00.000Z",
		});
		unsubscribe();
		port.emit({
			type: "environment_resources_updated",
			resources: [],
			updatedAt: "2026-05-22T00:00:01.000Z",
		});

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(ipcRenderer.postMessage).toHaveBeenCalledWith(IPC_CHANNELS.openEnvironmentStream, null, [
			{ id: "environment-port" },
		]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({
			type: "environment_resources_updated",
			resources: [],
			updatedAt: "2026-05-22T00:00:00.000Z",
		});
	});

	it("opens the workspace runtime stream channel once and forwards runtime events", () => {
		const port = new FakeMessagePort<DesktopWorkspaceRuntimeEvent>();
		const ipcRenderer = {
			invoke: vi.fn(),
			postMessage: vi.fn(),
		};

		const bridge = createDesktopAgentBridge(
			ipcRenderer,
			(): BridgeMessageChannel<DesktopWorkspaceRuntimeEvent> => ({
				port1: port,
				port2: { id: "workspace-runtime-port" },
			}),
		);

		const listener = vi.fn();
		const unsubscribe = bridge.subscribeToWorkspaceRuntimeEvents(listener);
		port.emit({
			type: "runtime_updated",
			summary: {
				errorMessage: "Workspace runtime session is missing.",
				latestSnapshots: [],
				panes: [],
				runtimeStatus: "error",
				tmuxAvailable: true,
				workspace: {
					createdAt: "2026-05-22T00:00:00.000Z",
					id: "ws-login",
					paneDefinitions: [],
					repoPath: "/workspace/project",
					resourcePolicy: {
						historyLimit: 20_000,
						idlePauseMinutes: 120,
						maxHotWorkspaces: 3,
						maxWorkspaceLogBytes: 200_000_000,
						snapshotRetentionDays: 7,
					},
					status: "running",
					updatedAt: "2026-05-22T00:00:00.000Z",
				},
			},
			updatedAt: "2026-05-22T00:00:00.000Z",
		});
		unsubscribe();
		port.emit({
			type: "audit_recorded",
			actionType: "send-text",
			recordedAt: "2026-05-22T00:00:01.000Z",
			workspaceId: "ws-login",
		});

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(ipcRenderer.postMessage).toHaveBeenCalledWith(IPC_CHANNELS.openWorkspaceRuntimeStream, null, [
			{ id: "workspace-runtime-port" },
		]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "runtime_updated",
				summary: expect.objectContaining({
					runtimeStatus: "error",
					workspace: expect.objectContaining({ id: "ws-login" }),
				}),
			}),
		);
	});

	it("proxies environment resource methods", async () => {
		const ipcRenderer = {
			invoke: vi.fn(async () => []),
			postMessage: vi.fn(),
		};
		const bridge = createDesktopAgentBridge(ipcRenderer, () => ({
			port1: new FakeMessagePort<SerializedAgentEvent>(),
			port2: {},
		}));

		await bridge.listEnvironmentResources({ sessionId: "session-1" });
		await bridge.detachEnvironmentResource({ resourceId: "env_tmux_1" });

		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.listEnvironmentResources, {
			sessionId: "session-1",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.detachEnvironmentResource, {
			resourceId: "env_tmux_1",
		});
	});

	it("proxies workspace runtime methods", async () => {
		const ipcRenderer = {
			invoke: vi.fn(async () => ({
				capturedAt: "2026-05-22T00:00:00.000Z",
				combinedText: "",
				failures: [],
				snapshots: [],
				workspaceId: "ws-login",
			})),
			postMessage: vi.fn(),
		};
		const bridge = createDesktopAgentBridge(ipcRenderer, () => ({
			port1: new FakeMessagePort<SerializedAgentEvent>(),
			port2: {},
		}));

		await bridge.listWorkspaceRuntimes();
		await bridge.createDebugWorkspaceRuntime({ projectId: "project-1" });
		await bridge.openWorkspaceRuntime("ws-login");
		await bridge.pauseWorkspaceRuntime("ws-login");
		await bridge.resumeWorkspaceRuntime("ws-login");
		await bridge.archiveWorkspaceRuntime("ws-login");
		await bridge.captureWorkspaceRuntimeContext({
			reason: "manual capture",
			roles: ["test"],
			workspaceId: "ws-login",
		});
		await bridge.takeOverWorkspaceRuntimePane({ role: "test", workspaceId: "ws-login" });
		await bridge.sendWorkspaceRuntimePaneText({
			pressEnter: true,
			role: "test",
			text: "npm test",
			workspaceId: "ws-login",
		});
		await bridge.returnWorkspaceRuntimePaneControl({ role: "test", workspaceId: "ws-login" });

		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.listWorkspaceRuntimes);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.createDebugWorkspaceRuntime, {
			projectId: "project-1",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.openWorkspaceRuntime, "ws-login");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(4, IPC_CHANNELS.pauseWorkspaceRuntime, "ws-login");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(5, IPC_CHANNELS.resumeWorkspaceRuntime, "ws-login");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(6, IPC_CHANNELS.archiveWorkspaceRuntime, "ws-login");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(7, IPC_CHANNELS.captureWorkspaceRuntimeContext, {
			reason: "manual capture",
			roles: ["test"],
			workspaceId: "ws-login",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(8, IPC_CHANNELS.takeOverWorkspaceRuntimePane, {
			role: "test",
			workspaceId: "ws-login",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(9, IPC_CHANNELS.sendWorkspaceRuntimePaneText, {
			pressEnter: true,
			role: "test",
			text: "npm test",
			workspaceId: "ws-login",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(10, IPC_CHANNELS.returnWorkspaceRuntimePaneControl, {
			role: "test",
			workspaceId: "ws-login",
		});
	});

	it("proxies invoke-based methods", async () => {
		const ipcRenderer = {
			invoke: vi.fn(async (channel: string) => {
				if (channel === IPC_CHANNELS.getSnapshot) {
					return {
						sessionId: "session-1",
						cwd: "/workspace/project",
						agentMode: "execute",
						diagnostics: [],
						thinkingLevel: "off",
						availableTools: [],
						messages: [],
						pendingToolCalls: [],
						isStreaming: false,
					};
				}
				return undefined;
			}),
			postMessage: vi.fn(),
		};

		const bridge = createDesktopAgentBridge(ipcRenderer, () => ({
			port1: new FakeMessagePort<SerializedAgentEvent>(),
			port2: {},
		}));

		await bridge.getSnapshot("session-1");
		await bridge.getRuntimeCatalog();
		await bridge.getSettings();
		await bridge.setSetting("defaultProvider", "anthropic");
		await bridge.listProviderKeys();
		await bridge.setProviderKey("anthropic", "secret");
		await bridge.deleteProviderKey("anthropic");
		await bridge.listOAuthProviders();
		await bridge.startOAuthLogin("openai-codex");
		await bridge.submitOAuthLoginCode("openai-codex", "http://localhost:1455/auth/callback?code=test");
		await bridge.cancelOAuthLogin("openai-codex");
		await bridge.logoutOAuthProvider("openai-codex");
		await bridge.getStorageSecurityState();
		await bridge.listCapabilities();
		await bridge.getCapabilityDetail({ type: "skill", filePath: "/workspace/project/.pi/skills/review/SKILL.md" });
		await bridge.createSkill({ name: "review", description: "Review code", content: "Review carefully." });
		await bridge.upsertPromptTemplate({ name: "brief", description: "Brief", content: "Summarize $ARGUMENTS" });
		await bridge.deletePromptTemplate({ filePath: "/workspace/project/.pi/prompts/brief.md" });
		await bridge.upsertMcpServer({ name: "filesystem", command: "node", args: ["server.js"] });
		await bridge.setMcpServerEnabled("server-1", true);
		await bridge.testMcpServer("server-1");
		await bridge.restartMcpServer("server-1");
		await bridge.reloadCapabilities();
		await bridge.listProjects();
		await bridge.createProjectFromFolder();
		await bridge.switchProject("project-1");
		await bridge.listSessions();
		await bridge.newSession();
		await bridge.switchSession("session-1");
		await bridge.deleteSession("session-1");
		await bridge.createTerminal({
			terminalId: "terminal-1",
			sessionId: "session-1",
			source: { type: "shell", cwd: "/workspace/project" },
			cols: 120,
			rows: 40,
		});
		await bridge.writeTerminal({ terminalId: "terminal-1", data: "ls\r" });
		await bridge.resizeTerminal({ terminalId: "terminal-1", cols: 100, rows: 30 });
		await bridge.disposeTerminal({ terminalId: "terminal-1" });
		await bridge.resolveApproval({ requestId: "approval-1", approved: true });
		await bridge.prompt({ sessionId: "session-1", text: "help" });
		await bridge.updateSessionProfile({ sessionId: "session-1", thinkingLevel: "high" });
		await bridge.setSessionMode({ sessionId: "session-1", agentMode: "plan" });
		await bridge.consumeProposedPlan({ sessionId: "session-1", planMessageId: "assistant-run-0" });
		await bridge.executePlan({ sessionId: "session-1" });
		await bridge.abort("session-1");
		await bridge.getReviewSnapshot({ projectId: "project-1" });
		await bridge.openPreviewFiles({ projectId: "project-1" });
		await bridge.openWorkspacePreviewFile({ path: "src/index.html", projectId: "project-1" });
		await bridge.refreshPreviewFile({ path: "/workspace/project/index.html" });
		await bridge.openPromptAttachments({ sessionId: "session-1" });
		await bridge.preparePromptAttachments({ candidates: [{ type: "path", path: "/workspace/project/notes.md" }] });
		await bridge.compact({ sessionId: "session-1", customInstructions: "preserve validation status" });
		await bridge.openSettingsWindow({ section: "credentials", providerId: "openai" });
		await bridge.notifyFirstInteractive();
		await bridge.getNativeAppearance();
		await bridge.openExternalUrl("https://example.com/docs");
		await bridge.listEvents({ includeDiscarded: true });
		await bridge.getEvent("event-1");
		await bridge.createEvent({ body: "Capture idea" });
		await bridge.updateEvent({ eventId: "event-1", title: "Capture" });
		await bridge.addEventComment({ eventId: "event-1", author: "user", body: "Comment" });
		await bridge.getEventManagementCriteria();
		await bridge.saveEventManagementCriteria({ content: "Use P0 for blockers." });
		await bridge.createEventManagementProposal({ includeCompleted: true });
		await bridge.applyEventManagementProposal({
			proposalId: "proposal-1",
			selectedItemIds: ["item-1"],
			items: [
				{
					id: "item-1",
					eventId: "event-1",
					priority: "P1",
					status: "ready",
					reason: "Important.",
					commentBody: "Move next.",
				},
			],
		});
		await bridge.setEventStatus({ eventId: "event-1", status: "ready" });
		await bridge.deleteEvent({ eventId: "event-1" });
		await bridge.openEventAttachments({ defaultPath: "/workspace" });
		await bridge.prepareEventAttachments({ candidates: [{ type: "path", path: "/workspace/idea.md" }] });
		await bridge.runEvent({
			eventId: "event-1",
			projectId: "project-1",
			promptText: "Run",
			attachmentIds: ["attachment-1"],
		});
		await bridge.testProviderKey("anthropic");
		await bridge.listWorkspaceFiles({ projectId: "project-1", limit: 200 });

		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.getSnapshot, "session-1");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.getRuntimeCatalog);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.getSettings);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(4, IPC_CHANNELS.setSetting, "defaultProvider", "anthropic");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(5, IPC_CHANNELS.listProviderKeys);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(6, IPC_CHANNELS.setProviderKey, "anthropic", "secret");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(7, IPC_CHANNELS.deleteProviderKey, "anthropic");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(8, IPC_CHANNELS.listOAuthProviders);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(9, IPC_CHANNELS.startOAuthLogin, "openai-codex");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
			10,
			IPC_CHANNELS.submitOAuthLoginCode,
			"openai-codex",
			"http://localhost:1455/auth/callback?code=test",
		);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(11, IPC_CHANNELS.cancelOAuthLogin, "openai-codex");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(12, IPC_CHANNELS.logoutOAuthProvider, "openai-codex");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(13, IPC_CHANNELS.getStorageSecurityState);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(14, IPC_CHANNELS.listCapabilities);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(15, IPC_CHANNELS.getCapabilityDetail, {
			type: "skill",
			filePath: "/workspace/project/.pi/skills/review/SKILL.md",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(16, IPC_CHANNELS.createSkill, {
			name: "review",
			description: "Review code",
			content: "Review carefully.",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(17, IPC_CHANNELS.upsertPromptTemplate, {
			name: "brief",
			description: "Brief",
			content: "Summarize $ARGUMENTS",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(18, IPC_CHANNELS.deletePromptTemplate, {
			filePath: "/workspace/project/.pi/prompts/brief.md",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(19, IPC_CHANNELS.upsertMcpServer, {
			name: "filesystem",
			command: "node",
			args: ["server.js"],
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(20, IPC_CHANNELS.setMcpServerEnabled, "server-1", true);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(21, IPC_CHANNELS.testMcpServer, "server-1");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(22, IPC_CHANNELS.restartMcpServer, "server-1");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(23, IPC_CHANNELS.reloadCapabilities);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(24, IPC_CHANNELS.listProjects);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(25, IPC_CHANNELS.createProjectFromFolder);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(26, IPC_CHANNELS.switchProject, "project-1");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(27, IPC_CHANNELS.listSessions);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(28, IPC_CHANNELS.newSession);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(29, IPC_CHANNELS.switchSession, "session-1");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(30, IPC_CHANNELS.deleteSession, "session-1");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(31, IPC_CHANNELS.createTerminal, {
			terminalId: "terminal-1",
			sessionId: "session-1",
			source: { type: "shell", cwd: "/workspace/project" },
			cols: 120,
			rows: 40,
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(32, IPC_CHANNELS.writeTerminal, {
			terminalId: "terminal-1",
			data: "ls\r",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(33, IPC_CHANNELS.resizeTerminal, {
			terminalId: "terminal-1",
			cols: 100,
			rows: 30,
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(34, IPC_CHANNELS.disposeTerminal, {
			terminalId: "terminal-1",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(35, IPC_CHANNELS.resolveApproval, {
			requestId: "approval-1",
			approved: true,
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(36, IPC_CHANNELS.prompt, {
			sessionId: "session-1",
			text: "help",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(37, IPC_CHANNELS.updateSessionProfile, {
			sessionId: "session-1",
			thinkingLevel: "high",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(38, IPC_CHANNELS.setSessionMode, {
			sessionId: "session-1",
			agentMode: "plan",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(39, IPC_CHANNELS.consumeProposedPlan, {
			sessionId: "session-1",
			planMessageId: "assistant-run-0",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(40, IPC_CHANNELS.executePlan, {
			sessionId: "session-1",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(41, IPC_CHANNELS.abort, "session-1");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(42, IPC_CHANNELS.getReviewSnapshot, {
			projectId: "project-1",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(43, IPC_CHANNELS.openPreviewFiles, {
			projectId: "project-1",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(44, IPC_CHANNELS.openWorkspacePreviewFile, {
			path: "src/index.html",
			projectId: "project-1",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(45, IPC_CHANNELS.refreshPreviewFile, {
			path: "/workspace/project/index.html",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(46, IPC_CHANNELS.openPromptAttachments, {
			sessionId: "session-1",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(47, IPC_CHANNELS.preparePromptAttachments, {
			candidates: [{ type: "path", path: "/workspace/project/notes.md" }],
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(48, IPC_CHANNELS.compact, {
			sessionId: "session-1",
			customInstructions: "preserve validation status",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(49, IPC_CHANNELS.openSettingsWindow, {
			section: "credentials",
			providerId: "openai",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(50, IPC_CHANNELS.notifyFirstInteractive);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(51, IPC_CHANNELS.getNativeAppearance);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(52, IPC_CHANNELS.openExternalUrl, "https://example.com/docs");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(53, IPC_CHANNELS.listEvents, { includeDiscarded: true });
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(54, IPC_CHANNELS.getEvent, "event-1");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(55, IPC_CHANNELS.createEvent, { body: "Capture idea" });
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(56, IPC_CHANNELS.updateEvent, {
			eventId: "event-1",
			title: "Capture",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(57, IPC_CHANNELS.addEventComment, {
			eventId: "event-1",
			author: "user",
			body: "Comment",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(58, IPC_CHANNELS.getEventManagementCriteria);
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(59, IPC_CHANNELS.saveEventManagementCriteria, {
			content: "Use P0 for blockers.",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(60, IPC_CHANNELS.createEventManagementProposal, {
			includeCompleted: true,
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(61, IPC_CHANNELS.applyEventManagementProposal, {
			proposalId: "proposal-1",
			selectedItemIds: ["item-1"],
			items: [
				{
					id: "item-1",
					eventId: "event-1",
					priority: "P1",
					status: "ready",
					reason: "Important.",
					commentBody: "Move next.",
				},
			],
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(62, IPC_CHANNELS.setEventStatus, {
			eventId: "event-1",
			status: "ready",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(63, IPC_CHANNELS.deleteEvent, { eventId: "event-1" });
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(64, IPC_CHANNELS.openEventAttachments, {
			defaultPath: "/workspace",
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(65, IPC_CHANNELS.prepareEventAttachments, {
			candidates: [{ type: "path", path: "/workspace/idea.md" }],
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(66, IPC_CHANNELS.runEvent, {
			eventId: "event-1",
			projectId: "project-1",
			promptText: "Run",
			attachmentIds: ["attachment-1"],
		});
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(67, IPC_CHANNELS.testProviderKey, "anthropic");
		expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(68, IPC_CHANNELS.listWorkspaceFiles, {
			projectId: "project-1",
			limit: 200,
		});
	});
});
