import type { MessagePortMain } from "electron";
import type { DesktopPtyManager } from "../terminal/pty-manager.ts";

export function openTerminalStream(ptyManager: DesktopPtyManager, port: MessagePortMain): void {
	port.start();
	const unsubscribe = ptyManager.subscribe((event) => {
		port.postMessage(event);
	});

	port.on("close", () => {
		unsubscribe();
	});
}
