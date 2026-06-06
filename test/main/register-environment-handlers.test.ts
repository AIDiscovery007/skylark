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
import type { SerializedAgentEvent } from "../../src/shared/serialized-agent-event.ts";
import type { DesktopEnvironmentResource } from "../../src/shared/types.ts";

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
			removeAllListeners: vi.fn((channel: string) => {
				listeners.delete(channel);
			}),
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

function getListener(channel: string): IpcListener {
	const listener = electronMocks.listeners.get(channel);
	if (!listener) {
		throw new Error(`Expected listener for ${channel}`);
	}
	return listener;
}

function getHandler(channel: string): IpcHandler {
	const handler = electronMocks.handlers.get(channel);
	if (!handler) {
		throw new Error(`Expected handler for ${channel}`);
	}
	return handler;
}

describe("environment IPC handlers", () => {
	it("returns filtered resources while broadcasting the unfiltered environment snapshot", async () => {
		const sessionResource: DesktopEnvironmentResource = {
			createdAt: "2026-05-27T01:00:00.000Z",
			cwd: "/workspace/project",
			id: "tmux-session-1",
			kind: "tmux_session",
			lastSeenAt: "2026-05-27T01:00:00.000Z",
			metadata: { tmuxSessionName: "skylark_session_1" },
			provider: "tmux",
			sessionId: "session-1",
			status: "running",
			title: "Session 1",
			updatedAt: "2026-05-27T01:00:00.000Z",
		};
		const otherResource: DesktopEnvironmentResource = {
			...sessionResource,
			id: "tmux-session-2",
			metadata: { tmuxSessionName: "skylark_session_2" },
			sessionId: "session-2",
			title: "Session 2",
		};

		registerDesktopAgentHandlers({
			host: {} as unknown as DesktopRuntimeHost,
			authService: {} as unknown as DesktopAuthService,
			ptyManager: { disposeSession: vi.fn() } as unknown as DesktopPtyManager,
			mcpManager: {} as unknown as DesktopMcpManager,
			approvalBroker: {} as unknown as DesktopApprovalBroker,
			getRuntimeCatalog: async () => ({ defaultTools: [], providers: [] }),
			stores: {
				eventStore: {
					markRunAwaitingReviewForSession: vi.fn(async () => undefined),
				} as unknown as DesktopEventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore: {} as DesktopSettingsStore,
			},
			environmentServices: {
				environmentResourceStore: {
					detachResource: vi.fn(),
					listResources: vi.fn(async () => [sessionResource, otherResource]),
				},
			},
		});
		const port = new FakeMessagePort();
		getListener(IPC_CHANNELS.openEnvironmentStream)({ ports: [port] });

		const result = await getHandler(IPC_CHANNELS.listEnvironmentResources)(undefined, { sessionId: "session-1" });

		expect(result).toEqual([sessionResource]);
		expect(port.messages).toEqual([
			{
				resources: [sessionResource, otherResource],
				type: "environment_resources_updated",
				updatedAt: expect.any(String),
			},
		]);
	});

	it("publishes detached environment resources and forwards subagent stream ports", async () => {
		const resource: DesktopEnvironmentResource = {
			createdAt: "2026-05-27T01:00:00.000Z",
			cwd: "/workspace/project",
			id: "tmux-session-1",
			kind: "tmux_session",
			lastSeenAt: "2026-05-27T01:00:00.000Z",
			metadata: { tmuxSessionName: "skylark_session_1" },
			provider: "tmux",
			sessionId: "session-1",
			status: "detached",
			title: "Session 1",
			updatedAt: "2026-05-27T01:00:00.000Z",
		};
		const openPort = vi.fn();

		registerDesktopAgentHandlers({
			host: {} as unknown as DesktopRuntimeHost,
			authService: {} as unknown as DesktopAuthService,
			ptyManager: { disposeSession: vi.fn() } as unknown as DesktopPtyManager,
			mcpManager: {} as unknown as DesktopMcpManager,
			approvalBroker: {} as unknown as DesktopApprovalBroker,
			getRuntimeCatalog: async () => ({ defaultTools: [], providers: [] }),
			stores: {
				eventStore: {
					markRunAwaitingReviewForSession: vi.fn(async () => undefined),
				} as unknown as DesktopEventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore: {} as DesktopSettingsStore,
			},
			environmentServices: {
				environmentResourceStore: {
					detachResource: vi.fn(async () => resource),
					listResources: vi.fn(),
				},
				subagentRuntimeBroker: { openPort },
			},
		});
		const environmentPort = new FakeMessagePort();
		const subagentPort = new FakeMessagePort();
		getListener(IPC_CHANNELS.openEnvironmentStream)({ ports: [environmentPort] });
		getListener(IPC_CHANNELS.openSubagentStream)({ ports: [subagentPort] });

		await expect(
			getHandler(IPC_CHANNELS.detachEnvironmentResource)(undefined, { resourceId: "tmux-session-1" }),
		).resolves.toBe(resource);

		expect(openPort).toHaveBeenCalledWith(subagentPort);
		expect(environmentPort.messages).toEqual([
			{
				resource,
				type: "environment_resource_detached",
				updatedAt: expect.any(String),
			},
		]);
	});

	it("rejects subagent snapshot requests when subagent storage is unavailable", async () => {
		registerDesktopAgentHandlers({
			host: {} as unknown as DesktopRuntimeHost,
			authService: {} as unknown as DesktopAuthService,
			ptyManager: { disposeSession: vi.fn() } as unknown as DesktopPtyManager,
			mcpManager: {} as unknown as DesktopMcpManager,
			approvalBroker: {} as unknown as DesktopApprovalBroker,
			getRuntimeCatalog: async () => ({ defaultTools: [], providers: [] }),
			stores: {
				eventStore: {
					markRunAwaitingReviewForSession: vi.fn(async () => undefined),
				} as unknown as DesktopEventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore: {} as DesktopSettingsStore,
			},
			environmentServices: {
				environmentResourceStore: {
					detachResource: vi.fn(),
					listResources: vi.fn(),
				},
			},
		});

		await expect(
			getHandler(IPC_CHANNELS.getSubagentSnapshot)(undefined, {
				parentSessionId: "session-1",
				subagentId: "subagent-1",
			}),
		).rejects.toThrow("Subagent snapshots are not available.");
	});

	it("refreshes and publishes environment resources after an agent run ends", async () => {
		const resource: DesktopEnvironmentResource = {
			createdAt: "2026-05-27T01:00:00.000Z",
			cwd: "/workspace/project",
			id: "tmux-session-session-1-keepalive",
			kind: "tmux_session",
			lastSeenAt: "2026-05-27T01:00:00.000Z",
			metadata: { tmuxSessionName: "skylark_27126ea4f7_keepalive" },
			provider: "tmux",
			sessionId: "session-1",
			status: "running",
			title: "keepalive",
			updatedAt: "2026-05-27T01:00:00.000Z",
		};
		let agentListener: ((event: SerializedAgentEvent) => void) | undefined;
		const refreshEnvironmentResources = vi.fn(async () => [resource]);
		const markRunAwaitingReviewForSession = vi.fn(async () => undefined);
		const host = {
			subscribe: vi.fn((listener: (event: SerializedAgentEvent) => void) => {
				agentListener = listener;
				return () => undefined;
			}),
		} as unknown as DesktopRuntimeHost;

		registerDesktopAgentHandlers({
			host,
			authService: {} as unknown as DesktopAuthService,
			ptyManager: { disposeSession: vi.fn() } as unknown as DesktopPtyManager,
			mcpManager: {} as unknown as DesktopMcpManager,
			approvalBroker: {} as unknown as DesktopApprovalBroker,
			getRuntimeCatalog: async () => ({ defaultTools: [], providers: [] }),
			stores: {
				eventStore: {
					markRunAwaitingReviewForSession,
				} as unknown as DesktopEventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore: {} as DesktopSettingsStore,
			},
			environmentServices: {
				environmentResourceStore: {
					detachResource: vi.fn(),
					listResources: vi.fn(),
				},
				refreshEnvironmentResources,
			},
		});
		const port = new FakeMessagePort();
		getListener(IPC_CHANNELS.openEnvironmentStream)({ ports: [port] });

		agentListener?.({ messages: [], sessionId: "session-1", type: "agent_end" });

		await vi.waitFor(() => expect(refreshEnvironmentResources).toHaveBeenCalledTimes(1));
		expect(markRunAwaitingReviewForSession).toHaveBeenCalledWith("session-1");
		expect(port.messages).toEqual([
			{
				resources: [resource],
				type: "environment_resources_updated",
				updatedAt: expect.any(String),
			},
		]);
	});

	it("refreshes and publishes environment resources when subagent activity changes", async () => {
		const resource: DesktopEnvironmentResource = {
			createdAt: "2026-05-27T01:00:00.000Z",
			cwd: "/workspace/project",
			id: "env_subagent_session_1",
			kind: "subagent",
			lastSeenAt: "2026-05-27T01:01:00.000Z",
			metadata: { subagentId: "subagent-session-1" },
			provider: "subagent",
			sessionId: "session-1",
			status: "running",
			title: "Inspect auth flow",
			updatedAt: "2026-05-27T01:01:00.000Z",
		};
		let agentListener: ((event: SerializedAgentEvent) => void) | undefined;
		const refreshEnvironmentResources = vi.fn(async () => [resource]);
		const host = {
			subscribe: vi.fn((listener: (event: SerializedAgentEvent) => void) => {
				agentListener = listener;
				return () => undefined;
			}),
		} as unknown as DesktopRuntimeHost;

		registerDesktopAgentHandlers({
			host,
			authService: {} as unknown as DesktopAuthService,
			ptyManager: { disposeSession: vi.fn() } as unknown as DesktopPtyManager,
			mcpManager: {} as unknown as DesktopMcpManager,
			approvalBroker: {} as unknown as DesktopApprovalBroker,
			getRuntimeCatalog: async () => ({ defaultTools: [], providers: [] }),
			stores: {
				eventStore: {
					markRunAwaitingReviewForSession: vi.fn(async () => undefined),
				} as unknown as DesktopEventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore: {} as DesktopSettingsStore,
			},
			environmentServices: {
				environmentResourceStore: {
					detachResource: vi.fn(),
					listResources: vi.fn(),
				},
				refreshEnvironmentResources,
			},
		});
		const port = new FakeMessagePort();
		getListener(IPC_CHANNELS.openEnvironmentStream)({ ports: [port] });

		agentListener?.({
			args: {},
			partialResult: {},
			sessionId: "session-1",
			toolCallId: "subagent-1",
			toolName: "subagent",
			type: "tool_execution_update",
		});

		await vi.waitFor(() => expect(refreshEnvironmentResources).toHaveBeenCalledTimes(1));
		expect(port.messages).toEqual([
			{
				resources: [resource],
				type: "environment_resources_updated",
				updatedAt: expect.any(String),
			},
		]);
	});
});
