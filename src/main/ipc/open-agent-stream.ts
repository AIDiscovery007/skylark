import type { MessagePortMain } from "electron";
import type { DesktopRuntimeHost } from "../runtime/desktop-runtime-host.ts";

export async function openAgentStream(host: DesktopRuntimeHost, port: MessagePortMain): Promise<void> {
	port.start();
	const unsubscribe = await host.subscribe((event) => {
		port.postMessage(event);
	});

	port.on("close", () => {
		unsubscribe();
	});
}
