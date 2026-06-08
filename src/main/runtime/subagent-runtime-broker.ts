import type { MessagePortMain } from "electron";
import type { DesktopSubagentRuntimeEvent } from "../../shared/types.ts";
import { PortFanout } from "../util/port-fanout.ts";

export class DesktopSubagentRuntimeBroker {
	private readonly ports = new PortFanout<DesktopSubagentRuntimeEvent>();

	publish(event: DesktopSubagentRuntimeEvent): void {
		this.ports.publish(event);
	}

	openPort(port: MessagePortMain): void {
		this.ports.add(port);
	}
}
