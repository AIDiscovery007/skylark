import type { MessagePortMain } from "electron";
import type { DesktopSubagentRuntimeEvent } from "../../shared/types.ts";

export class DesktopSubagentRuntimeBroker {
	private readonly ports = new Set<MessagePortMain>();

	publish(event: DesktopSubagentRuntimeEvent): void {
		for (const port of this.ports) {
			port.postMessage(event);
		}
	}

	openPort(port: MessagePortMain): void {
		this.ports.add(port);
		port.start();
		port.on("close", () => {
			this.ports.delete(port);
		});
	}
}
