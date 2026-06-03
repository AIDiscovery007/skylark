import type { MessagePortMain } from "electron";
import type { DesktopEventDetail, DesktopEventEvent } from "../../shared/types.ts";

export class DesktopEventStreamBroker {
	private readonly ports = new Set<MessagePortMain>();

	openPort(port: MessagePortMain): void {
		this.ports.add(port);
		port.start();
		port.on("close", () => {
			this.ports.delete(port);
		});
	}

	publish(event: DesktopEventEvent): void {
		for (const port of this.ports) {
			port.postMessage(event);
		}
	}

	publishEventUpdate(event: DesktopEventDetail | null | undefined): void {
		if (!event) {
			return;
		}
		this.publish({
			type: "event_updated",
			event,
			updatedAt: new Date().toISOString(),
		});
	}

	publishEventDelete(eventId: string): void {
		this.publish({
			type: "event_deleted",
			eventId,
			updatedAt: new Date().toISOString(),
		});
	}
}
