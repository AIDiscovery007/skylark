import { join } from "node:path";
import type { AgentMessage, AgentState, AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import type { Model, Transport } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionServices,
	createAgentSessionFromServices,
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createWriteToolDefinition,
	SessionManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
	DesktopAgentCreateEventInput,
	DesktopAgentMode,
	DesktopCreateEventsToolResultDetails,
	DesktopEventDetail,
	DesktopEventSummary,
	DesktopSubagentRuntimeEvent,
	DesktopSubagentToolResultDetails,
	DesktopTaskProgress,
	DesktopTaskProgressItem,
	DesktopTaskProgressToolResultDetails,
} from "../../shared/types.ts";
import {
	DESKTOP_SUBAGENT_TOOL_NAME,
	DESKTOP_TASK_PROGRESS_STATUSES,
	DESKTOP_TASK_PROGRESS_TOOL_NAME,
	isDesktopTaskProgressStatus,
} from "../../shared/types.ts";
import type { JsonEnvironmentResourceStore } from "../environment/environment-resource-store.ts";
import { createDesktopReadToolDefinition } from "./desktop-read-tool.ts";
import { serializeAgentEvent } from "./serialize-agent-event.ts";

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

const DEFAULT_PROVIDER_TRANSPORT: Transport = "auto";
const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 45_000;
export const DESKTOP_READ_EXACT_OUTPUT_GUIDELINES = [
	"When the user asks for local file content only, use read and return exactly the local file text with no extra commentary.",
	"Do not refuse to quote local workspace file content that the user explicitly asked to read.",
] as const;
const DESKTOP_IMAGE_INSPECTION_GUIDELINES = [
	"For local image discovery, use ls, find, grep, or conservative bash only to locate image paths or basic metadata.",
	"For local image understanding, call read on the image path so the image pixels are sent to the vision-capable model. Do not write Python scripts or use image libraries to visually inspect images unless the user explicitly asks for OCR or image processing.",
	"Use sips only for image dimensions or other basic metadata; do not treat metadata extraction as visual understanding.",
] as const;
const PLAN_MODE_TOOL_NAMES = ["read", "find", "grep", "ls", "bash", DESKTOP_SUBAGENT_TOOL_NAME] as const;
const SUBAGENT_CHILD_TOOL_NAMES = ["read", "find", "grep", "ls", "bash"] as const;
const SUBAGENT_DEFAULT_MAX_TURNS = 4;
const SUBAGENT_HARD_MAX_TURNS = 8;
const SUBAGENT_DEFAULT_TIMEOUT_SECONDS = 120;
const SUBAGENT_HARD_TIMEOUT_SECONDS = 300;
const SUBAGENT_DEFAULT_SUMMARY_MAX_CHARS = 2_000;
const SUBAGENT_HARD_SUMMARY_MAX_CHARS = 6_000;
const PLAN_MODE_BLOCKED_TOOL_NAMES = new Set([
	"edit",
	"write",
	DESKTOP_TASK_PROGRESS_TOOL_NAME,
	DESKTOP_CREATE_EVENTS_TOOL_NAME,
	"create_skill",
	"create_prompt_template",
	"configure_mcp_server",
]);

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
];

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
];

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
type DesktopToolDefinition = ToolDefinition<any, any, any>;

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

function getBashCommand(params: unknown): string | undefined {
	if (typeof params !== "object" || params === null || Array.isArray(params)) {
		return undefined;
	}
	const command = (params as Record<string, unknown>).command;
	return typeof command === "string" ? command : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProgressString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} must be a string.`);
	}
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`${label} must not be empty.`);
	}
	return normalized;
}

function createDesktopTaskProgressFromToolParams(params: unknown, updatedAt: string): DesktopTaskProgress {
	if (!isPlainRecord(params)) {
		throw new Error("Task progress input must be an object.");
	}
	if (!Array.isArray(params.tasks) || params.tasks.length === 0) {
		throw new Error("Task progress requires at least one task.");
	}

	const items: DesktopTaskProgressItem[] = [];
	const seenIds = new Set<string>();
	for (const [index, task] of params.tasks.entries()) {
		if (!isPlainRecord(task)) {
			throw new Error(`Task ${index + 1} must be an object.`);
		}
		const id = normalizeProgressString(task.id, `Task ${index + 1} id`);
		if (seenIds.has(id)) {
			throw new Error(`Task id '${id}' must be unique.`);
		}
		if (!isDesktopTaskProgressStatus(task.status)) {
			throw new Error(`Task ${index + 1} status must be one of ${DESKTOP_TASK_PROGRESS_STATUSES.join(", ")}.`);
		}
		seenIds.add(id);
		items.push({
			id,
			label: normalizeProgressString(task.label, `Task ${index + 1} label`),
			status: task.status,
		});
	}

	const completedAt = items.every((item) => item.status === "completed") ? updatedAt : undefined;
	return {
		...(typeof params.title === "string" && params.title.trim().length > 0 ? { title: params.title.trim() } : {}),
		items,
		updatedAt,
		...(completedAt ? { completedAt } : {}),
	};
}

const MAX_CREATE_EVENTS_TOOL_ITEMS = 20;
const MAX_CREATE_EVENT_TITLE_LENGTH = 160;
const MAX_CREATE_EVENT_BODY_LENGTH = 512_000;

function normalizeOptionalToolString(value: unknown, label: string, maxLength: number): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`${label} must be a string.`);
	}
	if (value.length > maxLength) {
		throw new Error(`${label} must be ${maxLength} characters or fewer.`);
	}
	const normalized = value.trim();
	return normalized ? normalized : undefined;
}

function createEventsToolInputFromParams(params: unknown): DesktopAgentCreateEventInput[] {
	if (!isPlainRecord(params)) {
		throw new Error("Event creation input must be an object.");
	}
	if (!Array.isArray(params.events) || params.events.length === 0) {
		throw new Error("create_events requires at least one event.");
	}
	if (params.events.length > MAX_CREATE_EVENTS_TOOL_ITEMS) {
		throw new Error(`create_events accepts ${MAX_CREATE_EVENTS_TOOL_ITEMS} events or fewer.`);
	}

	return params.events.map((item, index): DesktopAgentCreateEventInput => {
		if (!isPlainRecord(item)) {
			throw new Error(`Event ${index + 1} must be an object.`);
		}
		const title = normalizeOptionalToolString(item.title, `Event ${index + 1} title`, MAX_CREATE_EVENT_TITLE_LENGTH);
		const body = normalizeOptionalToolString(item.body, `Event ${index + 1} body`, MAX_CREATE_EVENT_BODY_LENGTH);
		if (!title && !body) {
			throw new Error(`Event ${index + 1} must include a title or body.`);
		}
		return {
			...(title ? { title } : {}),
			...(body ? { body } : {}),
		};
	});
}

function desktopEventDetailToSummary(event: DesktopEventDetail): DesktopEventSummary {
	const { attachments: _attachments, body: _body, comments: _comments, runs: _runs, ...summary } = event;
	return summary;
}

function createEventsToolResultText(events: readonly DesktopEventSummary[]): string {
	const noun = events.length === 1 ? "event" : "events";
	const lines = events.map((event) => `- ${event.title} (${event.id})`);
	return [`Created ${events.length} ${noun}.`, ...lines].join("\n");
}

function createEventsToolDefinition(
	createEvents: (events: DesktopAgentCreateEventInput[]) => Promise<DesktopEventDetail[]>,
): DesktopToolDefinition {
	return {
		name: DESKTOP_CREATE_EVENTS_TOOL_NAME,
		label: "Create events",
		description:
			"Create one or more persistent Events board items from explicit user requests to record or save independent event items.",
		promptSnippet: "Create persistent event records when the user explicitly asks to record events",
		promptGuidelines: [
			"Use create_events only for explicit persistent event creation requests such as creating, recording, saving, or adding events.",
			"Do not use create_events for ordinary planning, brainstorming, todos mentioned in passing, or vague future work.",
			"Create multiple events only for clear lists, numbered items, or independent goals. Keep normal compound descriptions as one event.",
			"Set only title and body. Do not set priority, comments, attachments, source metadata, or duplicate checks.",
		],
		parameters: {
			type: "object",
			properties: {
				events: {
					type: "array",
					minItems: 1,
					maxItems: MAX_CREATE_EVENTS_TOOL_ITEMS,
					items: {
						type: "object",
						properties: {
							title: { type: "string" },
							body: { type: "string" },
						},
						additionalProperties: false,
					},
				},
			},
			required: ["events"],
			additionalProperties: false,
		},
		executionMode: "sequential",
		execute: async (_toolCallId, params) => {
			const inputEvents = createEventsToolInputFromParams(params);
			const createdEvents = (await createEvents(inputEvents)).map(desktopEventDetailToSummary);
			const details: DesktopCreateEventsToolResultDetails = { events: createdEvents };
			return {
				content: [
					{
						type: "text",
						text: createEventsToolResultText(createdEvents),
					},
				],
				details,
			};
		},
	};
}

function createTaskProgressToolDefinition(
	updateTaskProgress: (taskProgress: DesktopTaskProgress) => void,
): DesktopToolDefinition {
	return {
		name: DESKTOP_TASK_PROGRESS_TOOL_NAME,
		label: "Update task progress",
		description: "Update the live execution progress panel with the complete current task list and each task status.",
		promptSnippet: "Update the live execution progress panel for multi-step work",
		promptGuidelines: [
			"Use update_task_progress for multi-step Execute mode work before implementation starts and after each step completes.",
			"Always send the complete task list, preserving stable task ids and completed task statuses.",
			"Use short user-facing task labels and exactly one active task while work is in progress.",
		],
		parameters: {
			type: "object",
			properties: {
				title: { type: "string" },
				tasks: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							label: { type: "string" },
							status: { type: "string", enum: DESKTOP_TASK_PROGRESS_STATUSES },
						},
						required: ["id", "label", "status"],
						additionalProperties: false,
					},
				},
			},
			required: ["tasks"],
			additionalProperties: false,
		},
		executionMode: "sequential",
		execute: async (_toolCallId, params) => {
			const taskProgress = createDesktopTaskProgressFromToolParams(params, new Date().toISOString());
			updateTaskProgress(taskProgress);
			const completedCount = taskProgress.items.filter((item) => item.status === "completed").length;
			const details: DesktopTaskProgressToolResultDetails = { taskProgress };
			return {
				content: [
					{
						type: "text",
						text: `Task progress updated: ${completedCount}/${taskProgress.items.length} tasks completed.`,
					},
				],
				details,
			};
		},
	};
}

interface CreateSubagentToolDefinitionOptions {
	agentDir: string;
	cwd: string;
	environmentResourceStore?: Pick<JsonEnvironmentResourceStore, "upsertResource">;
	getModel: () => Model<any>;
	getThinkingLevel: () => AgentState["thinkingLevel"];
	parentSessionId: string;
	providerRequestTimeoutMs: number;
	providerTransport: Transport;
	publishSubagentEvent?: (event: DesktopSubagentRuntimeEvent) => void;
	services: AgentSessionServices;
	subagentSessionsDir?: string;
}

interface NormalizedSubagentInput {
	contextSummary: string;
	expectedOutput: string;
	knownFacts?: string;
	maxTurns: number;
	scope: string;
	successCriteria: string;
	suggestedApproach?: string;
	summaryMaxChars: number;
	task: string;
	timeoutSeconds: number;
	title: string;
}

function normalizeSubagentText(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} must be a string.`);
	}
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`${label} must not be empty.`);
	}
	return normalized;
}

function normalizeOptionalSubagentText(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeSubagentLimit(value: unknown, label: string, defaultValue: number, hardCap: number): number {
	if (value === undefined) {
		return defaultValue;
	}
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`${label} must be a positive number.`);
	}
	return Math.max(1, Math.min(Math.floor(value), hardCap));
}

function defaultSubagentTitle(task: string): string {
	const firstLine =
		task
			.split("\n")
			.find((line) => line.trim().length > 0)
			?.trim() ?? "Subagent";
	return firstLine.length <= 64 ? firstLine : `${firstLine.slice(0, 61)}...`;
}

function normalizeSubagentInput(params: unknown): NormalizedSubagentInput {
	if (!isPlainRecord(params)) {
		throw new Error("Subagent input must be an object.");
	}
	const task = normalizeSubagentText(params.task, "task");
	const title =
		typeof params.title === "string" && params.title.trim().length > 0
			? params.title.trim()
			: defaultSubagentTitle(task);
	return {
		contextSummary: normalizeSubagentText(params.contextSummary, "contextSummary"),
		expectedOutput: normalizeSubagentText(params.expectedOutput, "expectedOutput"),
		knownFacts: normalizeOptionalSubagentText(params.knownFacts),
		maxTurns: normalizeSubagentLimit(
			params.maxTurns,
			"maxTurns",
			SUBAGENT_DEFAULT_MAX_TURNS,
			SUBAGENT_HARD_MAX_TURNS,
		),
		scope: normalizeSubagentText(params.scope, "scope"),
		successCriteria: normalizeSubagentText(params.successCriteria, "successCriteria"),
		suggestedApproach: normalizeOptionalSubagentText(params.suggestedApproach),
		summaryMaxChars: normalizeSubagentLimit(
			params.summaryMaxChars,
			"summaryMaxChars",
			SUBAGENT_DEFAULT_SUMMARY_MAX_CHARS,
			SUBAGENT_HARD_SUMMARY_MAX_CHARS,
		),
		task,
		timeoutSeconds: normalizeSubagentLimit(
			params.timeoutSeconds,
			"timeoutSeconds",
			SUBAGENT_DEFAULT_TIMEOUT_SECONDS,
			SUBAGENT_HARD_TIMEOUT_SECONDS,
		),
		title,
	};
}

function truncateSubagentSummary(summary: string, maxChars: number): string {
	if (summary.length <= maxChars) {
		return summary;
	}
	return `${summary.slice(0, Math.max(0, maxChars - 32)).trimEnd()}\n\n[Summary truncated]`;
}

function getLatestAssistantSummary(messages: readonly AgentMessage[]): string | undefined {
	const message = getLatestAssistantMessage(messages);
	if (!message) {
		return undefined;
	}
	const text = message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("")
		.trim();
	return text.length > 0 ? text : undefined;
}

function getLatestAssistantMessage(
	messages: readonly AgentMessage[],
): Extract<AgentMessage, { role: "assistant" }> | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "assistant") {
			return message;
		}
	}
	return undefined;
}

function buildSubagentPrompt(input: NormalizedSubagentInput): string {
	return [
		"You are a Skylark subagent running a focused read-only investigation for the parent agent.",
		"Use only the available read-only inspection tools. Do not modify files, install packages, configure services, or spawn other agents.",
		"Execution protocol: identify the smallest useful inspection path, use tools in deliberate order, stop once the success criteria are satisfied, and avoid repeating blocked or aborted tool calls.",
		"Tool strategy: use ls for directory inventory, find or grep for discovery, read for evidence, and bash only for conservative read-only commands when the dedicated tools are insufficient.",
		"Return only a concise Markdown summary for the parent agent. Include conclusions, relevant paths, and blockers. Do not include raw logs or the full transcript.",
		`Keep the summary under ${input.summaryMaxChars} characters.`,
		`<context_summary>\n${input.contextSummary}\n</context_summary>`,
		`<scope>\n${input.scope}\n</scope>`,
		`<success_criteria>\n${input.successCriteria}\n</success_criteria>`,
		`<expected_output>\n${input.expectedOutput}\n</expected_output>`,
		input.knownFacts ? `<known_facts>\n${input.knownFacts}\n</known_facts>` : undefined,
		input.suggestedApproach ? `<suggested_approach>\n${input.suggestedApproach}\n</suggested_approach>` : undefined,
		`<task>\n${input.task}\n</task>`,
	]
		.filter((section): section is string => section !== undefined)
		.join("\n\n");
}

function buildSubagentFinalizationPrompt(input: NormalizedSubagentInput, turnCount: number): string {
	return [
		`Turn budget reached after ${turnCount}/${input.maxTurns} exploration turns.`,
		"Do not use tools again. Produce the best concise Markdown summary now from the evidence already available in this subagent transcript.",
		"Include conclusions, relevant paths, blockers or uncertainty, and whether the success criteria were fully met.",
		`<success_criteria>\n${input.successCriteria}\n</success_criteria>`,
		`<expected_output>\n${input.expectedOutput}\n</expected_output>`,
		`Keep the summary under ${input.summaryMaxChars} characters.`,
	].join("\n\n");
}

function withPromptGuidelines<TTool extends { promptGuidelines?: string[] }>(
	tool: TTool,
	promptGuidelines: readonly string[],
): TTool {
	return {
		...tool,
		promptGuidelines: [...(tool.promptGuidelines ?? []), ...promptGuidelines],
	} as TTool;
}

function createDesktopBashToolDefinition(
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

function createReadOnlyBashToolDefinition(
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

function createPlanModeBashToolDefinition(
	cwd: string,
	desktopSessionId: string | undefined,
): ReturnType<typeof createBashToolDefinition> {
	return withPromptGuidelines(
		{
			...createReadOnlyBashToolDefinition(cwd, desktopSessionId),
			description:
				"Execute a conservative read-only bash command in the current working directory. Plan mode allows simple inspection commands only.",
			promptSnippet: "Execute read-only bash commands for inspection only",
		},
		PLAN_MODE_PROMPT_GUIDELINES,
	);
}

function createSubagentChildToolDefinitions(cwd: string, desktopSessionId: string): DesktopToolDefinition[] {
	const promptGuidelines = [
		"Subagent mode is active. Investigate the assigned task only.",
		"First choose the smallest inspection path that can satisfy the success criteria.",
		"Use ls for directory inventory, find or grep for discovery, read for evidence, and bash only for conservative read-only commands when the dedicated tools are insufficient.",
		...DESKTOP_IMAGE_INSPECTION_GUIDELINES,
		"Stop exploring once the success criteria are satisfied. Do not repeat blocked or aborted tool calls.",
		"Return a concise Markdown summary with conclusions, relevant paths, and blockers.",
	];
	return [
		withPromptGuidelines(createDesktopReadToolDefinition(cwd), promptGuidelines) as unknown as DesktopToolDefinition,
		withPromptGuidelines(createFindToolDefinition(cwd), promptGuidelines) as unknown as DesktopToolDefinition,
		withPromptGuidelines(createGrepToolDefinition(cwd), promptGuidelines) as unknown as DesktopToolDefinition,
		withPromptGuidelines(createLsToolDefinition(cwd), promptGuidelines) as unknown as DesktopToolDefinition,
		withPromptGuidelines(
			createReadOnlyBashToolDefinition(cwd, desktopSessionId),
			promptGuidelines,
		) as unknown as DesktopToolDefinition,
	];
}

function createSubagentToolResult(
	summary: string,
	details: DesktopSubagentToolResultDetails,
): AgentToolResult<DesktopSubagentToolResultDetails> {
	return {
		content: [{ type: "text", text: summary }],
		details,
	};
}

function createSubagentToolDefinition(options: CreateSubagentToolDefinitionOptions): DesktopToolDefinition {
	return {
		name: DESKTOP_SUBAGENT_TOOL_NAME,
		label: "Run subagent",
		description:
			"Create a focused read-only subagent to investigate a bounded task and return only a concise summary.",
		promptSnippet: "Create a focused read-only subagent for bounded investigations",
		promptGuidelines: [
			"Use subagent when a bounded investigation would add too much detail to the main context.",
			"Before calling subagent, extract the user's original intent into a precise brief: task, contextSummary, scope, successCriteria, knownFacts, suggestedApproach, and expectedOutput.",
			"Provide dense but bounded context. Include only facts the subagent needs, explicit scope boundaries, and concrete success criteria.",
			"Keep task specific. The subagent returns only a concise Markdown summary; full context is persisted in its transcript.",
			"Use maxTurns as a soft exploration budget. The subagent will summarize best-effort findings when the budget is reached.",
		],
		parameters: {
			type: "object",
			properties: {
				title: { type: "string" },
				task: { type: "string" },
				contextSummary: { type: "string" },
				scope: { type: "string" },
				successCriteria: { type: "string" },
				expectedOutput: { type: "string" },
				knownFacts: { type: "string" },
				suggestedApproach: { type: "string" },
				maxTurns: { type: "number" },
				timeoutSeconds: { type: "number" },
				summaryMaxChars: { type: "number" },
			},
			required: ["task", "contextSummary", "scope", "successCriteria", "expectedOutput"],
			additionalProperties: false,
		},
		executionMode: "sequential",
		execute: async (
			toolCallId,
			params,
			signal,
			onUpdate: AgentToolUpdateCallback<DesktopSubagentToolResultDetails> | undefined,
		) => {
			const input = normalizeSubagentInput(params);
			const startedAtDate = new Date();
			const startedAt = startedAtDate.toISOString();
			const parentSessionId = options.parentSessionId;
			const subagentRootDir = options.subagentSessionsDir ?? join(options.agentDir, "subagents");
			const subagentSessionManager = SessionManager.create(options.cwd, join(subagentRootDir, parentSessionId));
			const subagentId = subagentSessionManager.getSessionId();
			const transcriptPath = subagentSessionManager.getSessionFile();
			const baseDetails: DesktopSubagentToolResultDetails = {
				contextSummary: input.contextSummary,
				expectedOutput: input.expectedOutput,
				...(input.knownFacts ? { knownFacts: input.knownFacts } : {}),
				maxTurns: input.maxTurns,
				scope: input.scope,
				status: "running",
				subagentId,
				successCriteria: input.successCriteria,
				...(input.suggestedApproach ? { suggestedApproach: input.suggestedApproach } : {}),
				summaryMaxChars: input.summaryMaxChars,
				task: input.task,
				timeoutSeconds: input.timeoutSeconds,
				title: input.title,
				turnCount: 0,
				startedAt,
				...(transcriptPath ? { transcriptPath } : {}),
			};
			const resourceId = `env_subagent_${subagentId}`;
			const upsertSubagentResource = async (
				status: "completed" | "failed" | "running",
				details: DesktopSubagentToolResultDetails,
			): Promise<void> => {
				await options.environmentResourceStore?.upsertResource({
					id: resourceId,
					sessionId: parentSessionId,
					cwd: options.cwd,
					kind: "subagent",
					provider: "subagent",
					title: input.title,
					status,
					metadata: {
						contextSummary: input.contextSummary,
						errorMessage: details.errorMessage,
						expectedOutput: input.expectedOutput,
						knownFacts: input.knownFacts,
						limitReached: details.limitReached ? "true" : undefined,
						limitReason: details.limitReason,
						maxTurns: String(input.maxTurns),
						scope: input.scope,
						subagentId,
						successCriteria: input.successCriteria,
						summary: details.summary,
						suggestedApproach: input.suggestedApproach,
						summaryMaxChars: String(input.summaryMaxChars),
						task: input.task,
						timeoutSeconds: String(input.timeoutSeconds),
						toolCallId,
						turnCount: String(details.turnCount),
						transcriptPath,
					},
					updatedAt: details.completedAt ?? startedAt,
					lastSeenAt: details.completedAt ?? startedAt,
				});
			};
			const publishUpdate = (details: DesktopSubagentToolResultDetails, text: string): void => {
				onUpdate?.(createSubagentToolResult(text, details));
			};

			await upsertSubagentResource("running", baseDetails);
			publishUpdate(baseDetails, `Subagent created: ${input.title}`);

			let childSession: AgentSession | undefined;
			let timedOut = false;
			let limitReached = false;
			let turnCount = 0;
			let timeout: NodeJS.Timeout | undefined;
			let unsubscribe: (() => void) | undefined;
			const abortChild = (): void => {
				childSession?.agent.abort();
			};

			try {
				const childSessionResult = await createAgentSessionFromServices({
					services: options.services,
					sessionManager: subagentSessionManager,
					model: options.getModel(),
					thinkingLevel: options.getThinkingLevel(),
					tools: [...SUBAGENT_CHILD_TOOL_NAMES],
					customTools: createSubagentChildToolDefinitions(options.cwd, parentSessionId),
				});
				childSession = childSessionResult.session;
				const activeChildSession = childSession;
				activeChildSession.setActiveToolsByName([...SUBAGENT_CHILD_TOOL_NAMES]);
				const previousPrepareNextTurn = activeChildSession.agent.prepareNextTurn;
				activeChildSession.agent.prepareNextTurn = async (signal) => {
					const nextTurnSnapshot = await previousPrepareNextTurn?.(signal);
					if (!limitReached) {
						return nextTurnSnapshot;
					}
					return {
						...nextTurnSnapshot,
						context: {
							systemPrompt: nextTurnSnapshot?.context?.systemPrompt ?? activeChildSession.state.systemPrompt,
							messages: nextTurnSnapshot?.context?.messages ?? [...activeChildSession.state.messages],
							tools: [],
						},
					};
				};
				unsubscribe = activeChildSession.agent.subscribe((event) => {
					options.publishSubagentEvent?.({
						parentSessionId,
						subagentId,
						event: serializeAgentEvent(event),
					});
					if (event.type !== "turn_end") {
						return;
					}
					if (limitReached || event.message.role !== "assistant") {
						return;
					}
					turnCount += 1;
					if (turnCount >= input.maxTurns && event.message.stopReason !== "stop") {
						limitReached = true;
						childSession?.setActiveToolsByName([]);
						childSession?.agent.steer({
							role: "user",
							content: [{ type: "text", text: buildSubagentFinalizationPrompt(input, turnCount) }],
							timestamp: Date.now(),
						});
					}
				});
				if (signal?.aborted) {
					throw new Error("Subagent was aborted before it started.");
				}
				signal?.addEventListener("abort", abortChild, { once: true });
				timeout = setTimeout(() => {
					timedOut = true;
					childSession?.agent.abort();
				}, input.timeoutSeconds * 1_000);
				timeout.unref();

				await childSession.prompt(buildSubagentPrompt(input), {
					expandPromptTemplates: false,
					source: "interactive",
				});
				await childSession.agent.waitForIdle();

				if (timedOut) {
					throw new Error(`Subagent timed out after ${input.timeoutSeconds}s.`);
				}
				const latestAssistantMessage = getLatestAssistantMessage(childSession.state.messages);
				if (latestAssistantMessage?.stopReason === "error" || latestAssistantMessage?.stopReason === "aborted") {
					throw new Error(latestAssistantMessage.errorMessage ?? `Subagent ${latestAssistantMessage.stopReason}.`);
				}
				const summary = truncateSubagentSummary(
					getLatestAssistantSummary(childSession.state.messages) ?? "Subagent completed without a text summary.",
					input.summaryMaxChars,
				);
				const completedAt = new Date().toISOString();
				const details: DesktopSubagentToolResultDetails = {
					...baseDetails,
					completedAt,
					durationMs: Date.parse(completedAt) - startedAtDate.getTime(),
					...(limitReached ? { limitReached: true, limitReason: "max_turns" as const } : {}),
					status: "completed",
					summary,
					turnCount,
				};
				await upsertSubagentResource("completed", details);
				publishUpdate(details, summary);
				return createSubagentToolResult(summary, details);
			} catch (error) {
				const completedAt = new Date().toISOString();
				const errorMessage = error instanceof Error ? error.message : String(error);
				const details: DesktopSubagentToolResultDetails = {
					...baseDetails,
					completedAt,
					durationMs: Date.parse(completedAt) - startedAtDate.getTime(),
					errorMessage,
					status: "failed",
					turnCount,
				};
				await upsertSubagentResource("failed", details);
				publishUpdate(details, errorMessage);
				throw new Error(errorMessage);
			} finally {
				if (timeout) {
					clearTimeout(timeout);
				}
				signal?.removeEventListener("abort", abortChild);
				unsubscribe?.();
				childSession?.dispose();
			}
		},
	};
}

function createModeAwareBuiltInToolDefinitions(options: ModeAwareRuntimePolicyOptions): DesktopToolDefinition[] {
	const promptGuidelines = options.agentMode === "plan" ? PLAN_MODE_PROMPT_GUIDELINES : EXECUTE_MODE_PROMPT_GUIDELINES;
	const sharedPromptGuidelines = [...DESKTOP_IMAGE_INSPECTION_GUIDELINES, ...promptGuidelines];
	const bashTool =
		options.agentMode === "plan"
			? createPlanModeBashToolDefinition(options.cwd, options.desktopSessionId)
			: createDesktopBashToolDefinition(options.cwd, options.desktopSessionId);
	const tools: DesktopToolDefinition[] = [
		withPromptGuidelines(createDesktopReadToolDefinition(options.cwd), [
			...DESKTOP_READ_EXACT_OUTPUT_GUIDELINES,
			...sharedPromptGuidelines,
		]) as unknown as DesktopToolDefinition,
		withPromptGuidelines(
			createFindToolDefinition(options.cwd),
			sharedPromptGuidelines,
		) as unknown as DesktopToolDefinition,
		withPromptGuidelines(
			createGrepToolDefinition(options.cwd),
			sharedPromptGuidelines,
		) as unknown as DesktopToolDefinition,
		withPromptGuidelines(
			createLsToolDefinition(options.cwd),
			sharedPromptGuidelines,
		) as unknown as DesktopToolDefinition,
		withPromptGuidelines(
			bashTool,
			options.agentMode === "plan" ? DESKTOP_IMAGE_INSPECTION_GUIDELINES : sharedPromptGuidelines,
		) as unknown as DesktopToolDefinition,
	];
	if (options.agentMode === "execute") {
		tools.push(
			withPromptGuidelines(
				createEditToolDefinition(options.cwd),
				sharedPromptGuidelines,
			) as unknown as DesktopToolDefinition,
			withPromptGuidelines(
				createWriteToolDefinition(options.cwd),
				sharedPromptGuidelines,
			) as unknown as DesktopToolDefinition,
			withPromptGuidelines(
				createTaskProgressToolDefinition(options.updateTaskProgress ?? (() => undefined)),
				sharedPromptGuidelines,
			),
			withPromptGuidelines(
				createEventsToolDefinition(
					options.createEvents ??
						(async () => {
							throw new Error("Event creation is not configured.");
						}),
				),
				sharedPromptGuidelines,
			),
		);
	}
	if (options.services && options.agentDir && options.getModel && options.getThinkingLevel) {
		tools.push(
			withPromptGuidelines(
				createSubagentToolDefinition({
					agentDir: options.agentDir,
					cwd: options.cwd,
					environmentResourceStore: options.environmentResourceStore,
					getModel: options.getModel,
					getThinkingLevel: options.getThinkingLevel,
					parentSessionId: options.desktopSessionId ?? "desktop-session",
					providerRequestTimeoutMs: options.providerRequestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
					providerTransport: options.providerTransport ?? DEFAULT_PROVIDER_TRANSPORT,
					publishSubagentEvent: options.publishSubagentEvent,
					services: options.services,
					subagentSessionsDir: options.subagentSessionsDir,
				}),
				sharedPromptGuidelines,
			),
		);
	}
	return tools;
}

function getPlanModeToolBlockReason(toolName: string, args: unknown): string | undefined {
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

function resolveInitialActiveToolNames(
	agentMode: DesktopAgentMode,
	sessionActiveToolNames: readonly string[],
): string[] {
	if (agentMode === "plan") {
		return [...new Set([...PLAN_MODE_TOOL_NAMES])];
	}
	return [...new Set([...DEFAULT_DESKTOP_TOOL_NAMES, DESKTOP_TASK_PROGRESS_TOOL_NAME, ...sessionActiveToolNames])];
}

function resolveRefreshedActiveToolNames(
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
