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

describe("environment IPC handlers", () => {
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

		registerDesktopAgentHandlers(
			host,
			{} as unknown as DesktopAuthService,
			{ disposeSession: vi.fn() } as unknown as DesktopPtyManager,
			{} as unknown as DesktopMcpManager,
			{} as unknown as DesktopApprovalBroker,
			async () => ({ defaultTools: [], providers: [] }),
			{
				eventStore: {
					markRunAwaitingReviewForSession,
				} as unknown as DesktopEventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore: {} as DesktopSettingsStore,
			},
			undefined,
			{},
			{
				environmentResourceStore: {
					detachResource: vi.fn(),
					listResources: vi.fn(),
				},
				refreshEnvironmentResources,
			},
		);
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

		registerDesktopAgentHandlers(
			host,
			{} as unknown as DesktopAuthService,
			{ disposeSession: vi.fn() } as unknown as DesktopPtyManager,
			{} as unknown as DesktopMcpManager,
			{} as unknown as DesktopApprovalBroker,
			async () => ({ defaultTools: [], providers: [] }),
			{
				eventStore: {
					markRunAwaitingReviewForSession: vi.fn(async () => undefined),
				} as unknown as DesktopEventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore: {} as DesktopSettingsStore,
			},
			undefined,
			{},
			{
				environmentResourceStore: {
					detachResource: vi.fn(),
					listResources: vi.fn(),
				},
				refreshEnvironmentResources,
			},
		);
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
