import { join } from "node:path";
import type { AgentMessage, AgentState, AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import type { Model, Transport } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionServices,
	createAgentSessionFromServices,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	SessionManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getErrorMessage } from "../../shared/errors.ts";
import type { DesktopSubagentRuntimeEvent, DesktopSubagentToolResultDetails } from "../../shared/types.ts";
import { DESKTOP_SUBAGENT_TOOL_NAME } from "../../shared/types.ts";
import type { JsonEnvironmentResourceStore } from "../environment/environment-resource-store.ts";
import { createDesktopReadToolDefinition } from "./desktop-read-tool.ts";
import { DESKTOP_IMAGE_INSPECTION_GUIDELINES } from "./runtime-mode-policy.ts";
import { createReadOnlyBashToolDefinition, withPromptGuidelines } from "./runtime-tool-helpers.ts";
import { serializeAgentEvent } from "./serialize-agent-event.ts";

type DesktopToolDefinition = ToolDefinition<any, any, any>;

const SUBAGENT_CHILD_TOOL_NAMES = ["read", "find", "grep", "ls", "bash"] as const;
const SUBAGENT_DEFAULT_MAX_TURNS = 4;
const SUBAGENT_HARD_MAX_TURNS = 8;
const SUBAGENT_DEFAULT_TIMEOUT_SECONDS = 120;
const SUBAGENT_HARD_TIMEOUT_SECONDS = 300;
const SUBAGENT_DEFAULT_SUMMARY_MAX_CHARS = 2_000;
const SUBAGENT_HARD_SUMMARY_MAX_CHARS = 6_000;

export interface CreateSubagentToolDefinitionOptions {
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function createSubagentToolDefinition(options: CreateSubagentToolDefinitionOptions): DesktopToolDefinition {
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
				const errorMessage = getErrorMessage(error);
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
