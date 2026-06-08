import type { AgentState } from "@earendil-works/pi-agent-core";
import type { Model, Transport } from "@earendil-works/pi-ai";
import type { AgentSessionServices } from "@earendil-works/pi-coding-agent";
import type {
	DesktopAgentCreateEventInput,
	DesktopAgentMode,
	DesktopEventDetail,
	DesktopSubagentRuntimeEvent,
	DesktopTaskProgress,
} from "../../shared/types.ts";
import type { JsonEnvironmentResourceStore } from "../environment/environment-resource-store.ts";
import { createModeAwareBuiltInToolDefinitions, type DesktopToolDefinition } from "./builtin-tools.ts";
import {
	getPlanModeToolBlockReason,
	resolveInitialActiveToolNames,
	resolveRefreshedActiveToolNames,
} from "./runtime-mode-policy.ts";

export {
	DEFAULT_DESKTOP_TOOL_NAMES,
	DESKTOP_BASELINE_TOOL_NAMES,
	DESKTOP_CREATE_EVENTS_TOOL_NAME,
	DESKTOP_READ_EXACT_OUTPUT_GUIDELINES,
	EXECUTE_MODE_PROMPT_GUIDELINES,
	PLAN_MODE_PROMPT_GUIDELINES,
	validatePlanModeBashCommand,
} from "./runtime-mode-policy.ts";

export interface ModeAwareRuntimePolicyOptions {
	agentDir?: string;
	agentMode: DesktopAgentMode;
	cwd: string;
	createEvents?: (events: DesktopAgentCreateEventInput[]) => Promise<DesktopEventDetail[]>;
	desktopSessionId?: string;
	environmentResourceStore?: Pick<JsonEnvironmentResourceStore, "upsertResource">;
	getModel?: () => Model<any>;
	getThinkingLevel?: () => AgentState["thinkingLevel"];
	providerRequestTimeoutMs?: number;
	providerTransport?: Transport;
	publishSubagentEvent?: (event: DesktopSubagentRuntimeEvent) => void;
	services?: AgentSessionServices;
	subagentSessionsDir?: string;
	updateTaskProgress?: (taskProgress: DesktopTaskProgress) => void;
}

export interface ModeAwareRuntimePolicy {
	builtInTools: DesktopToolDefinition[];
	getToolBlockReason(toolName: string, args: unknown): string | undefined;
	resolveInitialActiveToolNames(sessionActiveToolNames: readonly string[]): string[];
	resolveRefreshedActiveToolNames(options: {
		builtInToolNames: readonly string[];
		capabilityToolNames: readonly string[];
		mcpToolNames: readonly string[];
	}): string[];
}

export function createModeAwareRuntimePolicy(options: ModeAwareRuntimePolicyOptions): ModeAwareRuntimePolicy {
	const builtInTools = createModeAwareBuiltInToolDefinitions(options);
	return {
		builtInTools,
		getToolBlockReason: (toolName, args) =>
			options.agentMode === "plan" ? getPlanModeToolBlockReason(toolName, args) : undefined,
		resolveInitialActiveToolNames: (sessionActiveToolNames) =>
			resolveInitialActiveToolNames(options.agentMode, sessionActiveToolNames),
		resolveRefreshedActiveToolNames: (toolNames) => resolveRefreshedActiveToolNames(options.agentMode, toolNames),
	};
}
