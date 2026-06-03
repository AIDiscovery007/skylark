export type AgentRuntimeState =
	| "idle"
	| "queued"
	| "thinking"
	| "running"
	| "streaming"
	| "waiting_for_user"
	| "completed"
	| "error"
	| "cancelled";

export interface AgentRuntimeStatus {
	message?: string;
	state: AgentRuntimeState;
}

export interface AgentRuntimeStateInput {
	bridgeError?: string;
	errorMessage?: string;
	hasPendingApproval?: boolean;
	isQueued?: boolean;
	isStreaming?: boolean;
	showCompleted?: boolean;
}

export function getAgentRuntimeState(input: AgentRuntimeStateInput): AgentRuntimeStatus | undefined {
	if (input.bridgeError || input.errorMessage) {
		return { state: "error" };
	}

	if (input.hasPendingApproval) {
		return { state: "waiting_for_user" };
	}

	if (input.isQueued) {
		return { state: "queued" };
	}

	if (input.isStreaming) {
		return { state: "running" };
	}

	if (input.showCompleted) {
		return { state: "completed" };
	}

	return undefined;
}
