import type { MessagePortMain } from "electron";
import type { DesktopEventDetail, DesktopEventEvent } from "../../shared/types.ts";
import { PortFanout } from "../util/port-fanout.ts";

export class DesktopEventStreamBroker {
	private readonly ports = new PortFanout<DesktopEventEvent>();

	openPort(port: MessagePortMain): void {
		this.ports.add(port);
	}

	publish(event: DesktopEventEvent): void {
		this.ports.publish(event);
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
