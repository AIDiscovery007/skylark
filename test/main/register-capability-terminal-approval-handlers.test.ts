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

function registerHandlers(
	overrides: {
		approvalBroker?: Partial<DesktopApprovalBroker>;
		host?: Partial<DesktopRuntimeHost>;
		mcpManager?: Partial<DesktopMcpManager>;
		ptyManager?: Partial<DesktopPtyManager>;
	} = {},
) {
	registerDesktopAgentHandlers({
		host: {
			...overrides.host,
		} as DesktopRuntimeHost,
		authService: {} as DesktopAuthService,
		ptyManager: {
			disposeSession: vi.fn(),
			...overrides.ptyManager,
		} as unknown as DesktopPtyManager,
		mcpManager: {
			...overrides.mcpManager,
		} as DesktopMcpManager,
		approvalBroker: {
			...overrides.approvalBroker,
		} as DesktopApprovalBroker,
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
	});
}

describe("capability, terminal, and approval IPC handlers", () => {
	it("requests approval before capability mutations and stops when approval is denied", async () => {
		const createSkill = vi.fn();
		const requestApproval = vi.fn(async () => {
			throw new Error("Denied.");
		});
		registerHandlers({
			host: { createSkill },
			approvalBroker: { requestApproval },
		});

		await expect(
			getHandler(IPC_CHANNELS.createSkill)(undefined, {
				name: "reviewer",
				description: "Review code",
				content: "Read the diff carefully.",
			}),
		).rejects.toThrow("Denied.");

		expect(requestApproval).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "create_skill",
				category: "capability_mutation",
				subject: "reviewer",
			}),
		);
		expect(createSkill).not.toHaveBeenCalled();
	});

	it("requests terminal approval before creating a PTY", async () => {
		const create = vi.fn(async () => undefined);
		const requestApproval = vi.fn(async () => undefined);
		registerHandlers({
			approvalBroker: { requestApproval },
			ptyManager: { create },
		});

		await getHandler(IPC_CHANNELS.createTerminal)(undefined, {
			cols: 100,
			rows: 28,
			sessionId: "session-1",
			source: { type: "shell", cwd: "/workspace/project" },
			terminalId: "terminal-1",
		});

		expect(requestApproval).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "create_terminal",
				category: "terminal",
				cwd: "/workspace/project",
			}),
		);
		expect(create).toHaveBeenCalled();
		expect(requestApproval.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
	});

	it("resolves approvals and wires approval stream ports", async () => {
		const unsubscribe = vi.fn();
		let approvalListener: ((event: unknown) => void) | undefined;
		const approvalBroker = {
			resolveApproval: vi.fn(),
			subscribe: vi.fn((listener: (event: unknown) => void) => {
				approvalListener = listener;
				return unsubscribe;
			}),
		};
		registerHandlers({ approvalBroker });
		const port = new FakeMessagePort();

		getListener(IPC_CHANNELS.openApprovalStream)({ ports: [port] });
		approvalListener?.({ type: "approval_created", request: { id: "approval-1" } });
		port.close();
		await getHandler(IPC_CHANNELS.resolveApproval)(undefined, {
			requestId: "approval-1",
			approved: true,
		});

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(port.messages).toEqual([{ type: "approval_created", request: { id: "approval-1" } }]);
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(approvalBroker.resolveApproval).toHaveBeenCalledWith({
			requestId: "approval-1",
			approved: true,
		});
	});

	it("wires terminal and capability streams and ignores missing ports", async () => {
		const unsubscribeTerminal = vi.fn();
		const unsubscribeCapability = vi.fn();
		const ptyManager = {
			subscribe: vi.fn(() => unsubscribeTerminal),
		};
		const mcpManager = {
			subscribe: vi.fn(() => unsubscribeCapability),
		};
		registerHandlers({
			approvalBroker: { requestApproval: vi.fn() },
			mcpManager,
			ptyManager,
		});
		const terminalPort = new FakeMessagePort();
		const capabilityPort = new FakeMessagePort();

		getListener(IPC_CHANNELS.openTerminalStream)({ ports: [] });
		getListener(IPC_CHANNELS.openCapabilityStream)({ ports: [] });
		getListener(IPC_CHANNELS.openTerminalStream)({ ports: [terminalPort] });
		getListener(IPC_CHANNELS.openCapabilityStream)({ ports: [capabilityPort] });
		terminalPort.close();
		capabilityPort.close();

		expect(ptyManager.subscribe).toHaveBeenCalledTimes(1);
		expect(mcpManager.subscribe).toHaveBeenCalledTimes(1);
		expect(terminalPort.start).toHaveBeenCalledTimes(1);
		expect(capabilityPort.start).toHaveBeenCalledTimes(1);
		expect(unsubscribeTerminal).toHaveBeenCalledTimes(1);
		expect(unsubscribeCapability).toHaveBeenCalledTimes(1);
	});
});
