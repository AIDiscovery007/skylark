import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopAuthService } from "../../src/main/auth/desktop-auth-service.ts";
import type { DesktopEventStore } from "../../src/main/events/event-store.ts";
import { registerDesktopAgentHandlers } from "../../src/main/ipc/register-handlers.ts";
import type { DesktopMcpManager } from "../../src/main/mcp/mcp-manager.ts";
import type { DesktopRuntimeHost } from "../../src/main/runtime/desktop-runtime-host.ts";
import type { DesktopApprovalBroker } from "../../src/main/security/approval-broker.ts";
import { DesktopInstructionStore } from "../../src/main/storage/instruction-store.ts";
import type { DesktopProjectStore } from "../../src/main/storage/project-store.ts";
import type { DesktopProviderKeysStore } from "../../src/main/storage/provider-keys-store.ts";
import type { DesktopSessionStore } from "../../src/main/storage/session-store.ts";
import { DesktopSettingsStore } from "../../src/main/storage/settings-store.ts";
import type { DesktopPtyManager } from "../../src/main/terminal/pty-manager.ts";
import { IPC_CHANNELS } from "../../src/shared/ipc-contract.ts";
import { DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS } from "../../src/shared/types.ts";

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

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
	electronMocks.handlers.clear();
	electronMocks.listeners.clear();
});

describe("settings IPC handlers", () => {
	it("stores instruction settings as visible Agent Home resources", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "desktop-settings-handlers-"));
		tempDirectories.push(agentDir);
		const settingsStore = new DesktopSettingsStore(join(agentDir, "settings.json"));
		const instructionStore = new DesktopInstructionStore({ agentDir });

		registerDesktopAgentHandlers(
			{} as DesktopRuntimeHost,
			{} as DesktopAuthService,
			{} as DesktopPtyManager,
			{} as DesktopMcpManager,
			{} as DesktopApprovalBroker,
			async () => ({ defaultTools: [], providers: [] }),
			{
				eventStore: {} as DesktopEventStore,
				instructionStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore,
			},
			undefined,
		);
		const port = new FakeMessagePort();
		getListener(IPC_CHANNELS.openSettingsStream)({ ports: [port] });

		await getHandler(IPC_CHANNELS.setSetting)(undefined, "defaultProvider", "anthropic");
		await getHandler(IPC_CHANNELS.setSetting)(undefined, "compactInstruction", "Preserve validation state.");
		await getHandler(IPC_CHANNELS.setSetting)(undefined, "globalAgentsInstruction", "Keep replies concise.");

		expect(await readFile(join(agentDir, "COMPACT.md"), "utf8")).toBe("Preserve validation state.\n");
		expect(await readFile(join(agentDir, "AGENTS.md"), "utf8")).toBe("Keep replies concise.\n");
		const persistedSettings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as Record<
			string,
			unknown
		>;
		expect(persistedSettings).not.toHaveProperty("compactInstruction");
		expect(persistedSettings).not.toHaveProperty("globalAgentsInstruction");
		expect(persistedSettings.defaultProvider).toBe("anthropic");
		expect(await getHandler(IPC_CHANNELS.getSettings)(undefined)).toEqual({
			compactInstruction: "Preserve validation state.",
			defaultProvider: "anthropic",
			globalAgentsInstruction: "Keep replies concise.",
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
			showThinkingBlocks: false,
		});
		expect(port.messages.at(-1)).toEqual({
			type: "settings_updated",
			settings: {
				compactInstruction: "Preserve validation state.",
				defaultProvider: "anthropic",
				globalAgentsInstruction: "Keep replies concise.",
				permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
				showThinkingBlocks: false,
			},
		});
	});

	it("tests provider key connections through the settings handler", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "desktop-settings-handlers-"));
		tempDirectories.push(agentDir);
		const settingsStore = new DesktopSettingsStore(join(agentDir, "settings.json"));
		const testProviderKey = vi.fn(async (provider: string) => ({
			provider,
			ok: true as const,
			message: "连接正常",
		}));

		registerDesktopAgentHandlers(
			{} as DesktopRuntimeHost,
			{} as DesktopAuthService,
			{} as DesktopPtyManager,
			{} as DesktopMcpManager,
			{} as DesktopApprovalBroker,
			async () => ({ defaultTools: [], providers: [] }),
			{
				eventStore: {} as DesktopEventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore,
			},
			undefined,
			{ testProviderKey },
		);

		await expect(getHandler(IPC_CHANNELS.testProviderKey)(undefined, "anthropic")).resolves.toEqual({
			provider: "anthropic",
			ok: true,
			message: "连接正常",
		});
		expect(testProviderKey).toHaveBeenCalledWith("anthropic");
	});

	it("publishes auth credential changes after provider key mutations", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "desktop-settings-handlers-"));
		tempDirectories.push(agentDir);
		const settingsStore = new DesktopSettingsStore(join(agentDir, "settings.json"));
		const providerKeysStore = {
			set: vi.fn(async () => undefined),
			delete: vi.fn(async () => undefined),
		};
		const authService = {
			notifyCredentialsChanged: vi.fn(),
		};

		registerDesktopAgentHandlers(
			{} as DesktopRuntimeHost,
			authService as unknown as DesktopAuthService,
			{} as DesktopPtyManager,
			{} as DesktopMcpManager,
			{} as DesktopApprovalBroker,
			async () => ({ defaultTools: [], providers: [] }),
			{
				eventStore: {} as DesktopEventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: providerKeysStore as unknown as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore,
			},
			undefined,
		);

		await getHandler(IPC_CHANNELS.setProviderKey)(undefined, "anthropic", "secret");
		await getHandler(IPC_CHANNELS.deleteProviderKey)(undefined, "anthropic");

		expect(authService.notifyCredentialsChanged).toHaveBeenCalledTimes(2);
		expect(authService.notifyCredentialsChanged).toHaveBeenNthCalledWith(1, "anthropic");
		expect(authService.notifyCredentialsChanged).toHaveBeenNthCalledWith(2, "anthropic");
	});
});
