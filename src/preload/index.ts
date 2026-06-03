import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAgentBridge } from "../shared/ipc-contract.ts";
import { createDesktopAgentBridge } from "./create-bridge.ts";

const desktopAgent = createDesktopAgentBridge({
	invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
	postMessage: (channel, message, transfer) => ipcRenderer.postMessage(channel, message, transfer as MessagePort[]),
});

contextBridge.exposeInMainWorld("desktopAgent", desktopAgent);

declare global {
	interface Window {
		desktopAgent: DesktopAgentBridge;
	}
}
