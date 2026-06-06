import { shell } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import type { DesktopNativeAppearance } from "../../shared/types.ts";
import { createDesktopNativeAppearance } from "../appearance/native-appearance.ts";
import type { DesktopWindowManager } from "../window/desktop-window-manager.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import { validateExternalUrl, validateSettingsOpenRequest } from "./validate-ipc.ts";

export interface DesktopAppShellBridgeServices {
	getNativeAppearance?: () => DesktopNativeAppearance;
	openExternalUrl?: (url: string) => Promise<void>;
	windowManager?: DesktopWindowManager;
}

export function createAppShellBridgeGroup(services: DesktopAppShellBridgeServices = {}): DesktopBridgeGroupDescriptor {
	const getNativeAppearance = services.getNativeAppearance ?? createDesktopNativeAppearance;
	const openExternalUrl = services.openExternalUrl ?? ((url: string) => shell.openExternal(url));

	return {
		commands: [
			{
				channel: IPC_CHANNELS.getNativeAppearance,
				handle: async () => getNativeAppearance(),
			},
			{
				channel: IPC_CHANNELS.openSettingsWindow,
				handle: async (_event, request: unknown) => {
					services.windowManager?.openSettingsWindow(validateSettingsOpenRequest(request));
				},
			},
			{
				channel: IPC_CHANNELS.notifyFirstInteractive,
				handle: async (event) => {
					const senderId = typeof event.sender.id === "number" ? event.sender.id : undefined;
					if (senderId !== undefined) {
						services.windowManager?.notifyFirstInteractive(senderId);
					}
				},
			},
			{
				channel: IPC_CHANNELS.openExternalUrl,
				handle: async (_event, url: unknown) => openExternalUrl(validateExternalUrl(url)),
			},
		],
	};
}
