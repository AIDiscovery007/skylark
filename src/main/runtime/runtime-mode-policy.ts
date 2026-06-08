import type { DesktopAgentMode } from "../../shared/types.ts";
import { DESKTOP_SUBAGENT_TOOL_NAME, DESKTOP_TASK_PROGRESS_TOOL_NAME } from "../../shared/types.ts";

export const DESKTOP_CREATE_EVENTS_TOOL_NAME = "create_events";
export const DEFAULT_DESKTOP_TOOL_NAMES = [
	"read",
	"find",
	"grep",
	"ls",
	"bash",
	"edit",
	"write",
	DESKTOP_CREATE_EVENTS_TOOL_NAME,
	DESKTOP_SUBAGENT_TOOL_NAME,
] as const;
const DESKTOP_CAPABILITY_TOOL_NAMES = [
	"create_skill",
	"create_prompt_template",
	"configure_mcp_server",
	"reload_capabilities",
] as const;
export const DESKTOP_BASELINE_TOOL_NAMES = [...DEFAULT_DESKTOP_TOOL_NAMES, ...DESKTOP_CAPABILITY_TOOL_NAMES] as const;

export const DESKTOP_READ_EXACT_OUTPUT_GUIDELINES = [
	"When the user asks for local file content only, use read and return exactly the local file text with no extra commentary.",
	"Do not refuse to quote local workspace file content that the user explicitly asked to read.",
] as const;
export const DESKTOP_IMAGE_INSPECTION_GUIDELINES = [
	"For local image discovery, use ls, find, grep, or conservative bash only to locate image paths or basic metadata.",
	"For local image understanding, call read on the image path so the image pixels are sent to the vision-capable model. Do not write Python scripts or use image libraries to visually inspect images unless the user explicitly asks for OCR or image processing.",
	"Use sips only for image dimensions or other basic metadata; do not treat metadata extraction as visual understanding.",
] as const;

export const PLAN_MODE_PROMPT_GUIDELINES = [
	"Plan mode is active for this session.",
	"Plan mode is a safe conversation, exploration, and planning mode; it does not require every reply to be a plan.",
	"Reply normally to greetings, casual conversation, conceptual questions, status checks, and discussion that does not ask for a concrete work plan.",
	"Do not wrap normal conversational replies in <proposed_plan> tags.",
	"Only produce a <proposed_plan>...</proposed_plan> block when the user explicitly asks for a plan or clearly asks for concrete implementation, debugging, investigation, or workspace work that needs an actionable plan.",
	"Before writing a proposed plan, understand the user's intent.",
	"If important product or implementation intent is unclear, ask clarifying questions before proposing a plan.",
	"Investigate relevant files and project context before writing a proposed plan for code or workspace changes.",
	"Do not modify local files, create capabilities, configure MCP servers, install packages, run builds, run tests, or perform destructive commands in Plan mode.",
	"If the user asks to create persistent events in Plan mode, explain that event creation requires Execute mode.",
	"When producing a proposed plan, the final response must contain exactly one <proposed_plan>...</proposed_plan> block.",
	"When producing a proposed plan, the <proposed_plan> block must contain Markdown with a title, Summary, Key Changes, Test Plan, and Assumptions when relevant.",
] as const;

export const EXECUTE_MODE_PROMPT_GUIDELINES = [
	"Execute mode is active for this session. You may use the available tools to implement, verify, and report the requested change.",
	"Before finalizing, compare the user's core requested actions with what actually happened; if a requested action was not completed, say why instead of presenting a draft as completed work.",
	"For project surveys, summaries, context files, or documentation drafts, start with a bounded survey of top-level structure, key manifests, README/context files, and essential config. Do not perform unbounded recursive scans unless the user asks for exhaustive analysis.",
	"When reporting command or tool output, treat the latest matching tool result as authoritative; copy exact requested values and do not mix in Skylark storage or session paths unless the tool output contains them.",
	"For multi-step implementation or verification work, call update_task_progress before making changes to create the full task list.",
	"After finishing each task, call update_task_progress again with completed/current statuses before moving on.",
	"Keep progress tasks concise, stable, and user-facing; append necessary tasks instead of rewriting completed history.",
	"Use create_events only when the user explicitly asks to persistently record, create, or save event items. Do not turn ordinary planning, discussion, or vague future work into events.",
	"When creating multiple events, split only clear lists, numbered items, or independent goals. Keep normal compound descriptions as one event.",
] as const;

const PLAN_MODE_TOOL_NAMES = ["read", "find", "grep", "ls", "bash", DESKTOP_SUBAGENT_TOOL_NAME] as const;
const PLAN_MODE_BLOCKED_TOOL_NAMES = new Set([
	"edit",
	"write",
	DESKTOP_TASK_PROGRESS_TOOL_NAME,
	DESKTOP_CREATE_EVENTS_TOOL_NAME,
	"create_skill",
	"create_prompt_template",
	"configure_mcp_server",
]);

const PLAN_MODE_ALLOWED_READ_COMMANDS = new Set([
	"pwd",
	"ls",
	"find",
	"rg",
	"grep",
	"cat",
	"head",
	"tail",
	"wc",
	"sed",
]);
const PLAN_MODE_BLOCKED_SHELL_TOKENS = ["\n", "\r", ";", "&", "|", "<", ">", "`", "$(", "${", "\\"];
const PLAN_MODE_SAFE_GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show", "branch", "remote"]);
const PLAN_MODE_GIT_OUTPUT_FLAGS = new Set(["--output", "-o"]);

function tokenizePlanModeBashCommand(command: string): { tokens: string[] } | { reason: string } {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;

	for (const char of command) {
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else {
				current += char;
			}
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (quote) {
		return { reason: "unclosed quotes are not allowed in Plan mode bash commands" };
	}
	if (current) {
		tokens.push(current);
	}
	return { tokens };
}

function hasFlag(tokens: readonly string[], flag: string): boolean {
	return tokens.some((token) => token === flag || token.startsWith(`${flag}=`));
}

function hasGitOutputFlag(tokens: readonly string[]): boolean {
	return tokens.some((token) => PLAN_MODE_GIT_OUTPUT_FLAGS.has(token) || token.startsWith("--output="));
}

function stripGitGlobalReadOnlyOptions(args: readonly string[]): { args: string[] } | { reason: string } {
	const stripped: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--no-pager") {
			continue;
		}
		if (arg === "-C") {
			const gitCwd = args[index + 1];
			if (!gitCwd) {
				return { reason: "git -C requires a path" };
			}
			index += 1;
			continue;
		}
		stripped.push(arg);
	}
	return { args: stripped };
}

function validatePlanModeGitCommand(args: readonly string[]): string | undefined {
	const stripped = stripGitGlobalReadOnlyOptions(args);
	if ("reason" in stripped) {
		return stripped.reason;
	}
	const [subcommand, ...subcommandArgs] = stripped.args;
	if (!subcommand) {
		return undefined;
	}
	if (!PLAN_MODE_SAFE_GIT_SUBCOMMANDS.has(subcommand)) {
		return `git ${subcommand} is not allowed in Plan mode`;
	}
	if (hasGitOutputFlag(subcommandArgs)) {
		return "git output redirection flags are not allowed in Plan mode";
	}

	if (subcommand === "branch") {
		const allowedBranchFlags = new Set([
			"-a",
			"-r",
			"-v",
			"-vv",
			"--all",
			"--contains",
			"--list",
			"--merged",
			"--no-merged",
			"--points-at",
			"--remotes",
			"--show-current",
			"--verbose",
		]);
		if (subcommandArgs.some((arg) => !allowedBranchFlags.has(arg))) {
			return "git branch is limited to read-only listing flags in Plan mode";
		}
	}

	if (subcommand === "remote") {
		if (subcommandArgs.length === 0) {
			return undefined;
		}
		if (subcommandArgs.length === 1 && subcommandArgs[0] === "-v") {
			return undefined;
		}
		if (subcommandArgs[0] === "show" && subcommandArgs.length <= 2) {
			return undefined;
		}
		if (subcommandArgs[0] === "get-url" && subcommandArgs.length === 2) {
			return undefined;
		}
		return "git remote is limited to listing, show, and get-url in Plan mode";
	}

	if (
		(subcommand === "diff" || subcommand === "log" || subcommand === "show") &&
		hasFlag(subcommandArgs, "--ext-diff")
	) {
		return "git external diff commands are not allowed in Plan mode";
	}

	return undefined;
}

function validatePlanModeReadCommand(commandName: string, args: readonly string[]): string | undefined {
	if (commandName === "sed" && args.some((arg) => arg === "-i" || arg.startsWith("-i") || arg === "--in-place")) {
		return "sed in-place edits are not allowed in Plan mode";
	}
	if (
		commandName === "find" &&
		args.some(
			(arg) =>
				["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(arg) ||
				arg.startsWith("-fprint") ||
				arg.startsWith("-fprintf"),
		)
	) {
		return "find mutation and exec flags are not allowed in Plan mode";
	}
	if (commandName === "rg" && args.some((arg) => arg === "--pre" || arg.startsWith("--pre="))) {
		return "rg preprocessors are not allowed in Plan mode";
	}
	return undefined;
}

export function validatePlanModeBashCommand(command: string): string | undefined {
	const trimmedCommand = command.trim();
	if (!trimmedCommand) {
		return "empty bash commands are not allowed in Plan mode";
	}

	for (const blockedToken of PLAN_MODE_BLOCKED_SHELL_TOKENS) {
		if (trimmedCommand.includes(blockedToken)) {
			return `shell syntax '${blockedToken}' is not allowed in Plan mode`;
		}
	}

	const tokenized = tokenizePlanModeBashCommand(trimmedCommand);
	if ("reason" in tokenized) {
		return tokenized.reason;
	}
	const [program, ...args] = tokenized.tokens;
	if (!program) {
		return "empty bash commands are not allowed in Plan mode";
	}
	if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(program)) {
		return "environment assignment commands are not allowed in Plan mode";
	}
	if (program.includes("/")) {
		return "commands must use simple program names in Plan mode";
	}

	if (program === "git") {
		return validatePlanModeGitCommand(args);
	}

	if (!PLAN_MODE_ALLOWED_READ_COMMANDS.has(program)) {
		return `${program} is not allowed in Plan mode bash commands`;
	}

	return validatePlanModeReadCommand(program, args);
}

export function getBashCommand(params: unknown): string | undefined {
	if (typeof params !== "object" || params === null || Array.isArray(params)) {
		return undefined;
	}
	const command = (params as Record<string, unknown>).command;
	return typeof command === "string" ? command : undefined;
}

export function getPlanModeToolBlockReason(toolName: string, args: unknown): string | undefined {
	if (PLAN_MODE_BLOCKED_TOOL_NAMES.has(toolName)) {
		return `Plan mode blocks mutating tool '${toolName}'. Switch this session to Execute to modify files or capabilities.`;
	}
	if (toolName !== "bash") {
		return undefined;
	}
	const command = getBashCommand(args);
	if (!command) {
		return "Plan mode requires bash command to be a string.";
	}
	const blockReason = validatePlanModeBashCommand(command);
	return blockReason ? `Plan mode blocked bash command: ${blockReason}` : undefined;
}

export function resolveInitialActiveToolNames(
	agentMode: DesktopAgentMode,
	sessionActiveToolNames: readonly string[],
): string[] {
	if (agentMode === "plan") {
		return [...new Set([...PLAN_MODE_TOOL_NAMES])];
	}
	return [...new Set([...DEFAULT_DESKTOP_TOOL_NAMES, DESKTOP_TASK_PROGRESS_TOOL_NAME, ...sessionActiveToolNames])];
}

export function resolveRefreshedActiveToolNames(
	agentMode: DesktopAgentMode,
	options: {
		builtInToolNames: readonly string[];
		capabilityToolNames: readonly string[];
		mcpToolNames: readonly string[];
	},
): string[] {
	if (agentMode === "plan") {
		return [...new Set([...PLAN_MODE_TOOL_NAMES])];
	}
	return [...new Set([...options.builtInToolNames, ...options.capabilityToolNames, ...options.mcpToolNames])];
}
