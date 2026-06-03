import type { MessagePortMain } from "electron";
import type { DesktopApprovalBroker } from "../security/approval-broker.ts";

export function openApprovalStream(approvalBroker: DesktopApprovalBroker, port: MessagePortMain): void {
	port.start();
	const unsubscribe = approvalBroker.subscribe((event) => {
		port.postMessage(event);
	});

	port.on("close", () => {
		unsubscribe();
	});
}
