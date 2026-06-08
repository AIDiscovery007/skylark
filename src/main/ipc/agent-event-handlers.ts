import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import { DESKTOP_SUBAGENT_TOOL_NAME } from "../../shared/types.ts";
import type { DesktopRuntimeHost } from "../runtime/desktop-runtime-host.ts";
import { pipeSubscriptionToPort } from "../util/port-fanout.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";

const subscribedHosts = new WeakSet<object>();

export interface DesktopAgentLifecycleSideEffects {
	host: Partial<Pick<DesktopRuntimeHost, "subscribe">>;
	onAgentEnd(sessionId: string): Promise<void>;
	onSubagentActivity(): Promise<unknown>;
}

export function createAgentStreamBridgeGroup(host: DesktopRuntimeHost): DesktopBridgeGroupDescriptor {
	return {
		streams: [
			{
				channel: IPC_CHANNELS.openStream,
				open: (port) => pipeSubscriptionToPort((listener) => host.subscribe(listener), port),
			},
		],
	};
}

export function installAgentLifecycleSideEffects(options: DesktopAgentLifecycleSideEffects): void {
	if (typeof options.host.subscribe !== "function") {
		return;
	}
	if (subscribedHosts.has(options.host)) {
		return;
	}
	subscribedHosts.add(options.host);

	void options.host.subscribe((event) => {
		if (
			(event.type === "tool_execution_update" || event.type === "tool_execution_end") &&
			event.toolName === DESKTOP_SUBAGENT_TOOL_NAME
		) {
			void options.onSubagentActivity().catch(() => undefined);
			return;
		}
		if (event.type !== "agent_end") {
			return;
		}
		void options.onAgentEnd(event.sessionId).catch(() => undefined);
		void options.onSubagentActivity().catch(() => undefined);
	});
}
