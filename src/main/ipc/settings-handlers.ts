import type { MessagePortMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import type { DesktopSettingsData } from "../../shared/types.ts";
import type { DesktopInstructionStore } from "../storage/instruction-store.ts";
import type { DesktopSettingsStore } from "../storage/settings-store.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import { type ValidatedDesktopSetting, validateSettingInput } from "./validate-ipc.ts";

export interface DesktopSettingsBridgeStores {
	instructionStore?: DesktopInstructionStore;
	settingsStore: DesktopSettingsStore;
}

function setValidatedSetting(
	store: DesktopSettingsStore,
	instructionStore: DesktopInstructionStore | undefined,
	setting: ValidatedDesktopSetting,
): Promise<void> {
	switch (setting.key) {
		case "appearance":
			return store.set("appearance", setting.value);
		case "defaultProvider":
			return store.set("defaultProvider", setting.value);
		case "defaultModel":
			return store.set("defaultModel", setting.value);
		case "defaultThinkingLevel":
			return store.set("defaultThinkingLevel", setting.value);
		case "showThinkingBlocks":
			return store.set("showThinkingBlocks", setting.value);
		case "compactInstruction":
			if (!instructionStore) {
				throw new Error("Instruction resource storage is not configured.");
			}
			return instructionStore.setCompactInstruction(setting.value);
		case "globalAgentsInstruction":
			if (!instructionStore) {
				throw new Error("Instruction resource storage is not configured.");
			}
			return instructionStore.setGlobalAgentsInstruction(setting.value);
		case "permissionApprovals":
			return store.set("permissionApprovals", setting.value);
		case "lastOpenedProjectId":
			return store.set("lastOpenedProjectId", setting.value);
		case "lastOpenedSessionId":
			return store.set("lastOpenedSessionId", setting.value);
		case "windowStates":
			return store.set("windowStates", setting.value);
	}
}

export async function readDesktopSettings({
	instructionStore,
	settingsStore,
}: DesktopSettingsBridgeStores): Promise<DesktopSettingsData> {
	return {
		...(await settingsStore.getAll()),
		...(instructionStore ? await instructionStore.getAll() : {}),
	};
}

export function createSettingsBridgeGroup(stores: DesktopSettingsBridgeStores): DesktopBridgeGroupDescriptor {
	const ports = new Set<MessagePortMain>();

	const publishSettingsUpdated = async (): Promise<void> => {
		const settings = await readDesktopSettings(stores);
		for (const port of ports) {
			port.postMessage({
				type: "settings_updated",
				settings,
			});
		}
	};

	return {
		commands: [
			{
				channel: IPC_CHANNELS.getSettings,
				handle: async () => readDesktopSettings(stores),
			},
			{
				channel: IPC_CHANNELS.setSetting,
				handle: async (_event, key: unknown, value: unknown) => {
					await setValidatedSetting(
						stores.settingsStore,
						stores.instructionStore,
						validateSettingInput(key, value),
					);
					await publishSettingsUpdated();
				},
			},
		],
		streams: [
			{
				channel: IPC_CHANNELS.openSettingsStream,
				open: (port) => {
					ports.add(port);
					port.start();
					port.on("close", () => {
						ports.delete(port);
					});
				},
			},
		],
	};
}
