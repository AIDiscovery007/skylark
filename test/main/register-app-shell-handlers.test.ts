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

describe("app shell IPC handlers", () => {
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

		registerDesktopAgentHandlers({
			host: {} as unknown as DesktopRuntimeHost,
			authService: {} as unknown as DesktopAuthService,
			ptyManager: { disposeSession: vi.fn() } as unknown as DesktopPtyManager,
			mcpManager: {} as unknown as DesktopMcpManager,
			approvalBroker: {} as unknown as DesktopApprovalBroker,
			getRuntimeCatalog: async () => ({ defaultTools: [], providers: [] }),
			stores: {
				eventStore: {} as DesktopEventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore: {} as DesktopSettingsStore,
			},
			shellServices: {
				getNativeAppearance: () => nativeAppearance,
				openExternalUrl,
				windowManager: {
					focusMainWindow: vi.fn(),
					notifyFirstInteractive,
					openMainWindow: vi.fn(),
					openSettingsWindow,
				},
			},
		});

		await getHandler(IPC_CHANNELS.openSettingsWindow)(undefined, { section: "credentials", providerId: "openai" });
		await getHandler(IPC_CHANNELS.notifyFirstInteractive)({ sender: { id: 42 } });
		await expect(getHandler(IPC_CHANNELS.getNativeAppearance)(undefined)).resolves.toBe(nativeAppearance);
		await getHandler(IPC_CHANNELS.openExternalUrl)(undefined, "https://example.com/docs");

		expect(openSettingsWindow).toHaveBeenCalledWith({ section: "credentials", providerId: "openai" });
		expect(notifyFirstInteractive).toHaveBeenCalledWith(42);
		expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/docs");
	});
});
