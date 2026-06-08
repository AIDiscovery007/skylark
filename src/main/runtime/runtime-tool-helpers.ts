import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { getBashCommand, validatePlanModeBashCommand } from "./runtime-mode-policy.ts";

export function withPromptGuidelines<TTool extends { promptGuidelines?: string[] }>(
	tool: TTool,
	promptGuidelines: readonly string[],
): TTool {
	return {
		...tool,
		promptGuidelines: [...(tool.promptGuidelines ?? []), ...promptGuidelines],
	} as TTool;
}

export function createDesktopBashToolDefinition(
	cwd: string,
	desktopSessionId: string | undefined,
): ReturnType<typeof createBashToolDefinition> {
	return createBashToolDefinition(cwd, {
		spawnHook: (context) => ({
			...context,
			env: {
				...context.env,
				SKYLARK_DESKTOP_CWD: cwd,
				...(desktopSessionId ? { SKYLARK_DESKTOP_SESSION_ID: desktopSessionId } : {}),
				PI_DESKTOP_CWD: cwd,
				...(desktopSessionId ? { PI_DESKTOP_SESSION_ID: desktopSessionId } : {}),
			},
		}),
	});
}

export function createReadOnlyBashToolDefinition(
	cwd: string,
	desktopSessionId: string | undefined,
): ReturnType<typeof createBashToolDefinition> {
	const bashTool = createDesktopBashToolDefinition(cwd, desktopSessionId);
	const execute: typeof bashTool.execute = async (toolCallId, params, signal, onUpdate, ctx) => {
		const command = getBashCommand(params);
		const blockReason = command ? validatePlanModeBashCommand(command) : "bash command must be a string";
		if (blockReason) {
			throw new Error(`Read-only bash blocked command: ${blockReason}`);
		}
		return bashTool.execute(toolCallId, params, signal, onUpdate, ctx);
	};
	return {
		...bashTool,
		description:
			"Execute a conservative read-only bash command in the current working directory. Only simple inspection commands are allowed.",
		promptSnippet: "Execute read-only bash commands for inspection only",
		execute,
	};
}
