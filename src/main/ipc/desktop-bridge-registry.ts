import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, MessagePortMain } from "electron";
import type { IPC_CHANNELS } from "../../shared/ipc-contract.ts";

export type DesktopBridgeChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface DesktopBridgeCommandDescriptor {
	readonly channel: DesktopBridgeChannel;
	readonly handle: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
}

export interface DesktopBridgeStreamDescriptor {
	readonly channel: DesktopBridgeChannel;
	readonly open: (port: MessagePortMain) => Promise<void> | void;
}

export interface DesktopBridgeGroupDescriptor {
	readonly commands?: readonly DesktopBridgeCommandDescriptor[];
	readonly streams?: readonly DesktopBridgeStreamDescriptor[];
}

export function registerDesktopBridgeGroup(ipcMain: IpcMain, group: DesktopBridgeGroupDescriptor): void {
	for (const command of group.commands ?? []) {
		ipcMain.removeHandler(command.channel);
		ipcMain.handle(command.channel, command.handle);
	}

	for (const stream of group.streams ?? []) {
		ipcMain.removeAllListeners(stream.channel);
		ipcMain.on(stream.channel, (event: IpcMainEvent) => {
			const port = event.ports[0];
			if (!port) {
				return;
			}
			void Promise.resolve(stream.open(port)).catch(() => undefined);
		});
	}
}
