import type { AgentState } from "@earendil-works/pi-agent-core";
import type { Model, Transport } from "@earendil-works/pi-ai";
import {
	type AgentSessionServices,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createWriteToolDefinition,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
	DesktopAgentCreateEventInput,
	DesktopAgentMode,
	DesktopCreateEventsToolResultDetails,
	DesktopEventDetail,
	DesktopEventSummary,
	DesktopSubagentRuntimeEvent,
	DesktopTaskProgress,
	DesktopTaskProgressItem,
	DesktopTaskProgressToolResultDetails,
} from "../../shared/types.ts";
import {
	DESKTOP_TASK_PROGRESS_STATUSES,
	DESKTOP_TASK_PROGRESS_TOOL_NAME,
	isDesktopTaskProgressStatus,
} from "../../shared/types.ts";
import type { JsonEnvironmentResourceStore } from "../environment/environment-resource-store.ts";
import { createDesktopReadToolDefinition } from "./desktop-read-tool.ts";
import {
	DESKTOP_CREATE_EVENTS_TOOL_NAME,
	DESKTOP_IMAGE_INSPECTION_GUIDELINES,
	DESKTOP_READ_EXACT_OUTPUT_GUIDELINES,
	EXECUTE_MODE_PROMPT_GUIDELINES,
	PLAN_MODE_PROMPT_GUIDELINES,
} from "./runtime-mode-policy.ts";
import {
	createDesktopBashToolDefinition,
	createReadOnlyBashToolDefinition,
	withPromptGuidelines,
} from "./runtime-tool-helpers.ts";
import { createSubagentToolDefinition } from "./subagent-engine.ts";

export type DesktopToolDefinition = ToolDefinition<any, any, any>;

const DEFAULT_PROVIDER_TRANSPORT: Transport = "auto";
const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 45_000;

export interface CreateModeAwareBuiltInToolDefinitionsOptions {
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

function createPlanModeBashToolDefinition(
	cwd: string,
	desktopSessionId: string | undefined,
): ReturnType<typeof createDesktopBashToolDefinition> {
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

export function createModeAwareBuiltInToolDefinitions(
	options: CreateModeAwareBuiltInToolDefinitionsOptions,
): DesktopToolDefinition[] {
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
