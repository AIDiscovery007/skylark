import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import type { DesktopApprovalBroker } from "../security/approval-broker.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import { openApprovalStream } from "./open-approval-stream.ts";
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
				open: (port) => openApprovalStream(approvalBroker, port),
			},
		],
	};
}
