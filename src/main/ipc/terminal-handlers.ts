import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import { measureMainAsync } from "../performance.ts";
import type { DesktopApprovalBroker } from "../security/approval-broker.ts";
import type { DesktopPtyManager } from "../terminal/pty-manager.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import { openTerminalStream } from "./open-terminal-stream.ts";
import {
	validateTerminalCreateRequest,
	validateTerminalDisposeRequest,
	validateTerminalResizeRequest,
	validateTerminalWriteRequest,
} from "./validate-ipc.ts";

export interface DesktopTerminalBridgeGroupOptions {
	approvalBroker: Pick<DesktopApprovalBroker, "requestApproval">;
	ptyManager: DesktopPtyManager;
}

export function createTerminalBridgeGroup(options: DesktopTerminalBridgeGroupOptions): DesktopBridgeGroupDescriptor {
	return {
		commands: [
			{
				channel: IPC_CHANNELS.createTerminal,
				handle: async (_event, request: unknown) => {
					const validatedRequest = validateTerminalCreateRequest(request);
					const terminalCwd = validatedRequest.source.type === "shell" ? validatedRequest.source.cwd : undefined;
					const terminalSubject =
						validatedRequest.source.type === "shell"
							? validatedRequest.source.cwd
							: validatedRequest.source.resourceId;
					await options.approvalBroker.requestApproval({
						category: "terminal",
						action: "create_terminal",
						title: "Start terminal",
						description: "Start a local interactive shell for this session.",
						subject: terminalSubject,
						...(terminalCwd ? { cwd: terminalCwd } : {}),
						details: {
							sessionId: validatedRequest.sessionId,
							terminalId: validatedRequest.terminalId,
							cols: validatedRequest.cols,
							rows: validatedRequest.rows,
							sourceType: validatedRequest.source.type,
						},
					});
					return measureMainAsync("main terminal open", async () => options.ptyManager.create(validatedRequest));
				},
			},
			{
				channel: IPC_CHANNELS.writeTerminal,
				handle: async (_event, request: unknown) => options.ptyManager.write(validateTerminalWriteRequest(request)),
			},
			{
				channel: IPC_CHANNELS.resizeTerminal,
				handle: async (_event, request: unknown) =>
					options.ptyManager.resize(validateTerminalResizeRequest(request)),
			},
			{
				channel: IPC_CHANNELS.disposeTerminal,
				handle: async (_event, request: unknown) =>
					options.ptyManager.dispose(validateTerminalDisposeRequest(request).terminalId),
			},
		],
		streams: [
			{
				channel: IPC_CHANNELS.openTerminalStream,
				open: (port) => openTerminalStream(options.ptyManager, port),
			},
		],
	};
}
