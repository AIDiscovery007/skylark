import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import type { DesktopApprovalBroker } from "../security/approval-broker.ts";
import { pipeSubscriptionToPort } from "../util/port-fanout.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import { validateApprovalDecision } from "./validate-ipc.ts";

export function createApprovalBridgeGroup(approvalBroker: DesktopApprovalBroker): DesktopBridgeGroupDescriptor {
	return {
		commands: [
			{
				channel: IPC_CHANNELS.resolveApproval,
				handle: async (_event, decision: unknown) => {
					approvalBroker.resolveApproval(validateApprovalDecision(decision));
				},
			},
		],
		streams: [
			{
				channel: IPC_CHANNELS.openApprovalStream,
				open: (port) => pipeSubscriptionToPort((listener) => approvalBroker.subscribe(listener), port),
			},
		],
	};
}
