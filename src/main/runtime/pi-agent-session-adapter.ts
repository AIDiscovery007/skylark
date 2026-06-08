import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";

export function setAgentSessionBaseSystemPrompt(session: AgentSession, systemPrompt: string): void {
	(session as unknown as { _baseSystemPrompt?: string })._baseSystemPrompt = systemPrompt;
}

export function refreshAgentSessionCustomTools(
	session: AgentSession,
	options: { activeToolNames: string[]; customTools: ToolDefinition[] },
): void {
	const sessionInternals = session as unknown as {
		_customTools?: ToolDefinition[];
		_refreshToolRegistry?: (options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean }) => void;
	};
	sessionInternals._customTools = options.customTools;
	sessionInternals._refreshToolRegistry?.({
		activeToolNames: options.activeToolNames,
		includeAllExtensionTools: true,
	});
}
