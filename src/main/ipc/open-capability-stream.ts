import type { MessagePortMain } from "electron";
import type { DesktopMcpManager } from "../mcp/mcp-manager.ts";

export function openCapabilityStream(mcpManager: DesktopMcpManager, port: MessagePortMain): void {
	port.start();
	const unsubscribe = mcpManager.subscribe((event) => {
		port.postMessage(event);
	});

	port.on("close", () => {
		unsubscribe();
	});
}
