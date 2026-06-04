import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { stripPromptFileBlocks } from "../../shared/prompt-file-blocks.ts";
import {
	DESKTOP_TASK_PROGRESS_TOOL_NAME,
	type DesktopPromptAttachmentDisplay,
	type DesktopPromptCapabilityInvocation,
} from "../../shared/types.ts";
import type { RunActivityTiming, ToolCallActivity } from "./conversation-timeline-projection.ts";

export type DesktopThreadMessageStatus =
	| { type: "running" }
	| { type: "requires-action"; reason: "tool-calls" | "interrupt" }
	| { type: "complete"; reason: "stop" | "unknown" }
	| {
			type: "incomplete";
			reason: "cancelled" | "tool-calls" | "length" | "content-filter" | "other" | "error";
			error?: unknown;
	  };

export interface DesktopMessageTiming {
	streamStartTime: number;
	firstTokenTime?: number;
	totalStreamTime?: number;
	tokenCount?: number;
	tokensPerSecond?: number;
	totalChunks: number;
	toolCallCount: number;
}

export interface DesktopTextPart {
	type: "text";
	text: string;
	parentId?: string;
}

export interface DesktopReasoningPart {
	type: "reasoning";
	text: string;
	parentId?: string;
}

export interface DesktopSourcePart {
	type: "source";
	sourceType: "url";
	id: string;
	url: string;
	title?: string;
	parentId?: string;
}

export interface DesktopThreadImagePart {
	type: "image";
	image: string;
	filename?: string;
}

export interface DesktopFilePart {
	type: "file";
	data?: string;
	filename?: string;
	mimeType?: string;
	parentId?: string;
}

export interface DesktopDataPart {
	type: "data";
	name: string;
	data: unknown;
}

export interface DesktopThreadToolCallPart {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	args?: Record<string, unknown>;
	argsText?: string;
	artifact?: unknown;
	result?: unknown;
	isError?: boolean;
	parentId?: string;
	messages?: readonly DesktopThreadMessage[];
}

export type DesktopThreadContentPart =
	| DesktopTextPart
	| DesktopReasoningPart
	| DesktopSourcePart
	| DesktopThreadImagePart
	| DesktopFilePart
	| DesktopDataPart
	| DesktopThreadToolCallPart;

export interface DesktopThreadMessage {
	role: "assistant" | "user" | "system";
	content: string | readonly DesktopThreadContentPart[];
	id?: string;
	createdAt?: Date;
	status?: DesktopThreadMessageStatus;
	attachments?: readonly unknown[];
	metadata?: {
		unstable_state?: unknown;
		unstable_annotations?: readonly unknown[];
		unstable_data?: readonly unknown[];
		steps?: readonly {
			messageId?: string;
			usage?: {
				inputTokens: number;
				outputTokens: number;
			};
		}[];
		timing?: DesktopMessageTiming;
		submittedFeedback?: { type: "positive" | "negative" };
		custom?: Record<string, unknown>;
	};
}

export interface DesktopAppendMessage extends Omit<DesktopThreadMessage, "id"> {
	parentId: string | null;
	sourceId: string | null;
	runConfig: { custom?: Record<string, unknown> } | undefined;
	startRun?: boolean;
}

type ThreadContentPart = DesktopThreadContentPart;
type ThreadToolCallPart = DesktopThreadToolCallPart;
type ThreadImagePart = DesktopThreadImagePart;
type ThreadMessageStatus = DesktopThreadMessageStatus;

export interface AssistantRuntimeAdapterInput {
	isStreaming?: boolean;
	messages: readonly AgentMessage[];
	runActivityTiming?: RunActivityTiming;
	streamingMessage?: AgentMessage;
	toolCalls?: readonly ToolCallActivity[];
	showThinkingBlocks: boolean;
}

interface ToolResultRecord {
	toolCallId: string;
	toolName: string;
	result: unknown;
	isError: boolean;
	timestamp: number;
}

export interface DesktopToolCallArtifact {
	desktopToolCall: ToolCallActivity;
}

export const DESKTOP_RUN_ACTIVITY_METADATA_KEY = "desktopRunActivity";
export const DESKTOP_CAPABILITY_INVOCATIONS_METADATA_KEY = "desktopCapabilityInvocations";
export const DESKTOP_FILE_REFERENCES_METADATA_KEY = "desktopFileReferences";
export const DESKTOP_PROPOSED_PLAN_METADATA_KEY = "desktopProposedPlan";
export const DESKTOP_PROMPT_ATTACHMENTS_METADATA_KEY = "desktopPromptAttachments";
export const DESKTOP_PROMPT_VISIBLE_TEXT_METADATA_KEY = "desktopPromptVisibleText";
const PROMPT_FILE_NAME_PATTERN = /<file\b[^>]*\bname=(["'])(.*?)\1[^>]*>/gi;
const FALLBACK_PROMPT_ATTACHMENT_MIME_TYPES = new Map<string, string>([
	[".csv", "text/csv"],
	[".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
	[".gif", "image/gif"],
	[".jpeg", "image/jpeg"],
	[".jpg", "image/jpeg"],
	[".json", "application/json"],
	[".md", "text/markdown"],
	[".png", "image/png"],
	[".txt", "text/plain"],
	[".webp", "image/webp"],
	[".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
]);
export const DESKTOP_COMPACTION_NOTICE_METADATA_KEY = "desktopCompactionNotice";

export interface DesktopRunActivityMetadata {
	runId: string;
	startedAt: number;
	endedAt?: number;
	toolCount: number;
	hasReasoning: boolean;
	phase?: "waiting_for_response";
}

export interface DesktopProposedPlanMetadata {
	text: string;
}

export interface DesktopCompactionNoticeMetadata {
	status: "completed";
	tokensBefore: number;
}

export type DesktopThreadFileReferenceKind = "changed" | "found";

export interface DesktopThreadFileReference {
	displayPath: string;
	kind: DesktopThreadFileReferenceKind;
	path: string;
	toolName: string;
}

const DIRECT_FOUND_REFERENCE_LIMIT = 6;

interface AssistantRunToolCallRecord {
	args: unknown;
	toolCallId: string;
	toolName: string;
}

type AssistantContentPart = Extract<AgentMessage, { role: "assistant" }>["content"][number];
type UserContentPart = Exclude<Extract<AgentMessage, { role: "user" }>["content"], string>[number];

function isHiddenThreadToolName(toolName: string): boolean {
	return toolName === DESKTOP_TASK_PROGRESS_TOOL_NAME;
}

function isDesktopCompactionSummaryMessage(message: AgentMessage): boolean {
	return (message as { role?: string }).role === "compactionSummary";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAssistantContentPart(value: unknown): value is AssistantContentPart {
	if (!isObjectRecord(value)) {
		return false;
	}

	if (value.type === "text") {
		return typeof value.text === "string";
	}

	if (value.type === "thinking") {
		return typeof value.thinking === "string";
	}

	if (value.type === "toolCall") {
		return typeof value.id === "string" && typeof value.name === "string";
	}

	return false;
}

function getAssistantContentParts(message: Extract<AgentMessage, { role: "assistant" }>): AssistantContentPart[] {
	const content = (message as { content?: unknown }).content;
	return Array.isArray(content) ? content.filter(isAssistantContentPart) : [];
}

function isUserContentPart(value: unknown): value is UserContentPart {
	if (!isObjectRecord(value)) {
		return false;
	}

	if (value.type === "text") {
		return typeof value.text === "string";
	}

	if (value.type === "image") {
		return typeof value.mimeType === "string" && typeof value.data === "string";
	}

	return false;
}

interface DesktopCompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	tokensBefore: number;
	timestamp: number;
}

export function createAssistantUiRuntimeMessages({
	isStreaming = false,
	messages,
	runActivityTiming,
	streamingMessage,
	toolCalls = [],
	showThinkingBlocks,
}: AssistantRuntimeAdapterInput): DesktopThreadMessage[] {
	const visibleMessages =
		isStreaming && streamingMessage && streamingMessage.role !== "toolResult"
			? [...messages, streamingMessage]
			: [...messages];
	const toolResults = collectToolResults(messages);
	const toolActivityById = new Map(toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall]));
	const convertedMessages: DesktopThreadMessage[] = [];
	let currentAssistantRun:
		| {
				messages: Extract<AgentMessage, { role: "assistant" }>[];
				startIndex: number;
				isStreaming: boolean;
		  }
		| undefined;

	function flushAssistantRun(isLatestRun: boolean): void {
		if (!currentAssistantRun) {
			return;
		}

		const lastAssistantRunMessage = currentAssistantRun.messages.at(-1);
		const isActiveToolGap = isLatestRun && isStreaming && lastAssistantRunMessage?.stopReason === "toolUse";
		const isAssistantRunStreaming = currentAssistantRun.isStreaming || isActiveToolGap;
		const shouldUseRunTiming = isLatestRun && (isAssistantRunStreaming || !isStreaming);
		convertedMessages.push(
			convertAssistantRunToThreadMessage(currentAssistantRun.messages, {
				index: currentAssistantRun.startIndex,
				isStreaming: isAssistantRunStreaming,
				runActivityTiming: shouldUseRunTiming ? runActivityTiming : undefined,
				showThinkingBlocks,
				toolResults,
				toolActivityById,
			}),
		);
		currentAssistantRun = undefined;
	}

	for (const [index, message] of visibleMessages.entries()) {
		if (message.role === "toolResult") {
			continue;
		}

		if (message.role === "user") {
			flushAssistantRun(false);
			const customMetadata = getUserCustomMetadata(message);
			const capabilityInvocations = getUserCapabilityInvocations(message);
			const promptAttachments = getUserPromptAttachments(customMetadata);
			const fallbackPromptAttachments =
				promptAttachments.length === 0 ? createFallbackPromptAttachments(message.content) : [];
			const metadataCustom = {
				...customMetadata,
				...(fallbackPromptAttachments.length > 0
					? { [DESKTOP_PROMPT_ATTACHMENTS_METADATA_KEY]: fallbackPromptAttachments }
					: {}),
				...(capabilityInvocations.length > 0
					? { [DESKTOP_CAPABILITY_INVOCATIONS_METADATA_KEY]: capabilityInvocations }
					: {}),
			};
			convertedMessages.push({
				id: createMessageId(message, index),
				role: "user",
				content: convertUserContent(message.content, getUserPromptVisibleText(customMetadata)),
				createdAt: createMessageDate(message.timestamp, index),
				...(Object.keys(metadataCustom).length > 0
					? {
							metadata: {
								custom: metadataCustom,
							},
						}
					: {}),
			});
			continue;
		}

		if (isDesktopCompactionSummaryMessage(message)) {
			const compactionMessage = message as unknown as DesktopCompactionSummaryMessage;
			flushAssistantRun(false);
			convertedMessages.push({
				id: createMessageId(message, index),
				role: "system",
				content: [{ type: "text", text: "上下文已压缩" }],
				createdAt: createMessageDate(compactionMessage.timestamp, index),
				metadata: {
					custom: {
						[DESKTOP_COMPACTION_NOTICE_METADATA_KEY]: {
							status: "completed",
							tokensBefore: compactionMessage.tokensBefore,
						} satisfies DesktopCompactionNoticeMetadata,
					},
				},
			});
			continue;
		}

		if (message.role === "assistant") {
			currentAssistantRun ??= { messages: [], startIndex: index, isStreaming: false };
			currentAssistantRun.messages.push(message);
			currentAssistantRun.isStreaming = currentAssistantRun.isStreaming || message === streamingMessage;
		}
	}

	flushAssistantRun(true);
	const pendingAssistantRunActivityTiming = shouldAppendPendingAssistantActivity({
		isStreaming,
		messages: visibleMessages,
		runActivityTiming,
		streamingMessage,
	})
		? runActivityTiming
		: undefined;
	if (pendingAssistantRunActivityTiming) {
		convertedMessages.push(
			createPendingAssistantActivityThreadMessage({
				index: visibleMessages.length,
				runActivityTiming: pendingAssistantRunActivityTiming,
			}),
		);
	}
	return convertedMessages;
}

export function getAppendMessageText(message: DesktopAppendMessage): string {
	if (typeof message.content === "string") {
		return message.content.trim();
	}

	return message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

export function extractProposedPlan(text: string): string | undefined {
	let latestPlan: string | undefined;
	const pattern = /<proposed_plan>([\s\S]*?)<\/proposed_plan>/gi;
	for (const match of text.matchAll(pattern)) {
		const planText = match[1];
		if (planText !== undefined && planText.trim().length > 0) {
			latestPlan = planText;
		}
	}
	return latestPlan;
}

function stripProposedPlanBlocks(text: string): string {
	return text.replace(/<proposed_plan>[\s\S]*?<\/proposed_plan>/gi, "");
}

function shouldAppendPendingAssistantActivity({
	isStreaming,
	messages,
	runActivityTiming,
	streamingMessage,
}: {
	isStreaming: boolean;
	messages: readonly AgentMessage[];
	runActivityTiming?: RunActivityTiming;
	streamingMessage?: AgentMessage;
}): boolean {
	if (!isStreaming || !runActivityTiming || streamingMessage) {
		return false;
	}

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message || message.role === "toolResult") {
			continue;
		}
		return message.role === "user";
	}

	return false;
}

function createPendingAssistantActivityThreadMessage({
	index,
	runActivityTiming,
}: {
	index: number;
	runActivityTiming: RunActivityTiming;
}): DesktopThreadMessage {
	const runId = runActivityTiming.runId ?? createAssistantRunMessageId(index);
	const runActivityMetadata: DesktopRunActivityMetadata = {
		runId,
		startedAt: runActivityTiming.startedAt,
		endedAt: runActivityTiming.endedAt,
		toolCount: 0,
		hasReasoning: false,
		phase: "waiting_for_response",
	};

	return {
		id: runId,
		role: "assistant",
		content: [],
		createdAt: createMessageDate(runActivityTiming.startedAt, index),
		metadata: {
			timing: createMessageTimingMetadata({ runActivityMetadata, runActivityTiming }),
			custom: {
				[DESKTOP_RUN_ACTIVITY_METADATA_KEY]: runActivityMetadata,
			},
		},
		status: { type: "running" },
	};
}

function convertAssistantRunToThreadMessage(
	messages: Extract<AgentMessage, { role: "assistant" }>[],
	context: {
		index: number;
		isStreaming: boolean;
		runActivityTiming?: RunActivityTiming;
		showThinkingBlocks: boolean;
		toolResults: ReadonlyMap<string, ToolResultRecord>;
		toolActivityById: ReadonlyMap<string, ToolCallActivity>;
	},
): DesktopThreadMessage {
	const firstMessage = messages[0];
	const lastMessage = messages[messages.length - 1];
	if (!firstMessage || !lastMessage) {
		throw new Error("Cannot convert an empty assistant run.");
	}

	const messageId = createAssistantRunMessageId(context.index);
	const runId = context.runActivityTiming?.runId ?? messageId;
	const activityParts: ThreadContentPart[] = [];
	const assistantTextParts: string[] = [];
	const toolCallIds = new Set<string>();
	const toolCallRecords: AssistantRunToolCallRecord[] = [];
	let hasReasoning = false;

	for (const message of messages) {
		for (const part of getAssistantContentParts(message)) {
			if (part.type === "text" && part.text.trim().length > 0) {
				assistantTextParts.push(part.text);
			}
			if (part.type === "thinking" && context.showThinkingBlocks && part.thinking.trim().length > 0) {
				hasReasoning = true;
				activityParts.push({ type: "reasoning", text: part.thinking });
			}
			if (part.type === "toolCall") {
				if (!isHiddenThreadToolName(part.name)) {
					toolCallIds.add(part.id);
					toolCallRecords.push({ args: part.arguments, toolCallId: part.id, toolName: part.name });
					activityParts.push(convertToolCallPart(part, context.toolResults, context.toolActivityById));
				}
			}
		}
	}
	const runActivityMetadata = createRunActivityMetadata({
		hasReasoning,
		isStreaming: context.isStreaming,
		messages,
		runActivityTiming: context.runActivityTiming,
		runId,
		toolCallIds: [...toolCallIds],
		toolActivityById: context.toolActivityById,
		toolResults: context.toolResults,
	});
	const messageTiming = context.runActivityTiming
		? createMessageTimingMetadata({
				runActivityMetadata,
				runActivityTiming: context.runActivityTiming,
			})
		: undefined;
	const fileReferences = createFileReferences({
		assistantText: assistantTextParts.join("\n"),
		isStreaming: context.isStreaming,
		toolActivityById: context.toolActivityById,
		toolCallRecords,
		toolResults: context.toolResults,
	});
	const proposedPlan = context.isStreaming ? undefined : extractProposedPlan(assistantTextParts.join("\n"));
	const textParts: ThreadContentPart[] = assistantTextParts
		.map((text) => (context.isStreaming ? text : stripProposedPlanBlocks(text)))
		.filter((text) => text.trim().length > 0)
		.map((text) => ({ type: "text", text }));

	return {
		id: messageId,
		role: "assistant",
		content: [...activityParts, ...textParts],
		createdAt: createMessageDate(firstMessage.timestamp, context.index),
		metadata: {
			...(messageTiming ? { timing: messageTiming } : {}),
			custom: {
				[DESKTOP_RUN_ACTIVITY_METADATA_KEY]: runActivityMetadata,
				...(fileReferences.length > 0 ? { [DESKTOP_FILE_REFERENCES_METADATA_KEY]: fileReferences } : {}),
				...(proposedPlan ? { [DESKTOP_PROPOSED_PLAN_METADATA_KEY]: { text: proposedPlan } } : {}),
			},
		},
		status: resolveAssistantRunStatus(lastMessage, context.isStreaming),
	};
}

function createFileReferences({
	assistantText,
	isStreaming,
	toolActivityById,
	toolCallRecords,
	toolResults,
}: {
	assistantText: string;
	isStreaming: boolean;
	toolActivityById: ReadonlyMap<string, ToolCallActivity>;
	toolCallRecords: readonly AssistantRunToolCallRecord[];
	toolResults: ReadonlyMap<string, ToolResultRecord>;
}): DesktopThreadFileReference[] {
	if (isStreaming) {
		return [];
	}

	const references: DesktopThreadFileReference[] = [];
	const seenPaths = new Map<string, number>();
	for (const record of toolCallRecords) {
		const activity = toolActivityById.get(record.toolCallId);
		const persistedResult = toolResults.get(record.toolCallId);
		if (!isSuccessfulToolCall(activity, persistedResult)) {
			continue;
		}

		const toolName = activity?.toolName ?? persistedResult?.toolName ?? record.toolName;
		const args = activity?.args ?? record.args;
		const resultText = getToolResultText(activity?.result ?? persistedResult?.result);

		if (toolName === "edit" || toolName === "write") {
			const rawPath = getStringField(args, "path", "file_path");
			if (!rawPath) {
				continue;
			}
			addFileReference(references, seenPaths, {
				displayPath: rawPath,
				kind: "changed",
				path: rawPath,
				toolName,
			});
			continue;
		}

		if (toolName === "find") {
			for (const path of extractFindResultPaths(args, resultText)) {
				addFileReference(references, seenPaths, {
					displayPath: path,
					kind: "found",
					path,
					toolName,
				});
			}
			continue;
		}

		if (toolName === "grep") {
			for (const path of extractGrepResultPaths(args, resultText)) {
				addFileReference(references, seenPaths, {
					displayPath: path,
					kind: "found",
					path,
					toolName,
				});
			}
		}
	}
	return pruneFoundFileReferences(references, assistantText);
}

function isSuccessfulToolCall(
	activity: ToolCallActivity | undefined,
	persistedResult: ToolResultRecord | undefined,
): boolean {
	if (activity) {
		return activity.status === "completed";
	}
	return Boolean(persistedResult && !persistedResult.isError);
}

function addFileReference(
	references: DesktopThreadFileReference[],
	seenPaths: Map<string, number>,
	reference: DesktopThreadFileReference,
): void {
	const normalizedPath = reference.path.trim();
	if (!normalizedPath) {
		return;
	}
	const normalizedReference = { ...reference, displayPath: reference.displayPath.trim(), path: normalizedPath };
	const existingIndex = seenPaths.get(normalizedPath);
	if (existingIndex !== undefined) {
		const existingReference = references[existingIndex];
		if (
			existingReference &&
			getFileReferenceRank(normalizedReference.kind) > getFileReferenceRank(existingReference.kind)
		) {
			references[existingIndex] = normalizedReference;
		}
		return;
	}
	seenPaths.set(normalizedPath, references.length);
	references.push(normalizedReference);
}

function getFileReferenceRank(kind: DesktopThreadFileReferenceKind): number {
	return kind === "changed" ? 2 : 1;
}

function pruneFoundFileReferences(
	references: readonly DesktopThreadFileReference[],
	assistantText: string,
): DesktopThreadFileReference[] {
	const foundReferences = references.filter((reference) => reference.kind === "found");
	if (foundReferences.length <= DIRECT_FOUND_REFERENCE_LIMIT) {
		return [...references];
	}

	const directlyReferencedPaths = foundReferences.filter((reference) =>
		isDirectlyReferencedFile(reference, assistantText),
	);
	const directlyReferencedSet = new Set(directlyReferencedPaths.map((reference) => reference.path));
	return references.filter((reference) => reference.kind !== "found" || directlyReferencedSet.has(reference.path));
}

function isDirectlyReferencedFile(reference: DesktopThreadFileReference, assistantText: string): boolean {
	return [reference.path, reference.displayPath, getBaseName(reference.path)]
		.filter((value, index, values) => value.length > 0 && values.indexOf(value) === index)
		.some((candidate) => containsPathMention(assistantText, candidate));
}

function containsPathMention(text: string, path: string): boolean {
	const escapedPath = escapeRegExp(path);
	return new RegExp(`(^|[^\\p{L}\\p{N}_./-])${escapedPath}($|[^\\p{L}\\p{N}_./-])`, "u").test(text);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getStringField(value: unknown, ...keys: string[]): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	for (const key of keys) {
		const fieldValue = record[key];
		if (typeof fieldValue === "string" && fieldValue.trim().length > 0) {
			return fieldValue.trim();
		}
	}
	return undefined;
}

function getToolResultText(value: unknown): string {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return "";
	}
	const record = value as Record<string, unknown>;
	const content = record.content;
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) => {
			if (!part || typeof part !== "object" || Array.isArray(part)) {
				return "";
			}
			const partRecord = part as Record<string, unknown>;
			return typeof partRecord.text === "string" ? partRecord.text : "";
		})
		.filter((text) => text.length > 0)
		.join("\n");
}

function extractFindResultPaths(args: unknown, resultText: string): string[] {
	const searchBase = getStringField(args, "path") ?? ".";
	const paths: string[] = [];
	for (const rawLine of resultText.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("[") || line === "No files found matching pattern" || line.endsWith("/")) {
			continue;
		}
		paths.push(joinSearchResultPath(searchBase, line));
	}
	return paths;
}

function extractGrepResultPaths(args: unknown, resultText: string): string[] {
	const searchBase = getStringField(args, "path") ?? ".";
	const paths: string[] = [];
	for (const rawLine of resultText.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("[")) {
			continue;
		}
		const match = /^(.+?)(?::\d+:|-\d+-)/.exec(line);
		const matchedPath = match?.[1]?.trim();
		if (matchedPath) {
			paths.push(joinSearchResultPath(searchBase, matchedPath));
		}
	}
	return paths;
}

function joinSearchResultPath(searchBase: string, resultPath: string): string {
	const cleanResultPath = resultPath.trim();
	if (!cleanResultPath || isAbsoluteOrFileUrl(cleanResultPath)) {
		return cleanResultPath;
	}
	const cleanSearchBase = searchBase.trim();
	if (!cleanSearchBase || cleanSearchBase === ".") {
		return stripLeadingCurrentDirectory(cleanResultPath);
	}
	const normalizedBase = cleanSearchBase.replace(/[\\/]+$/, "");
	const normalizedResult = stripLeadingCurrentDirectory(cleanResultPath);
	if (getBaseName(normalizedBase) === normalizedResult) {
		return normalizedBase;
	}
	return `${normalizedBase}/${normalizedResult}`;
}

function stripLeadingCurrentDirectory(path: string): string {
	return path.replace(/^\.?[\\/]+/, "");
}

function getBaseName(path: string): string {
	const parts = path.split(/[\\/]+/).filter((part) => part.length > 0);
	return parts.at(-1) ?? path;
}

function isAbsoluteOrFileUrl(path: string): boolean {
	return path.startsWith("/") || /^file:/i.test(path);
}

function convertUserContent(
	content: Extract<AgentMessage, { role: "user" }>["content"],
	visibleText?: string,
): string | ThreadContentPart[] {
	if (visibleText !== undefined) {
		return visibleText.length > 0 ? [{ type: "text", text: visibleText }] : [];
	}
	if (typeof content === "string") {
		const safeContent = stripPromptFileBlocks(content);
		return safeContent === content ? content : safeContent.length > 0 ? [{ type: "text", text: safeContent }] : [];
	}
	if (!Array.isArray(content)) return [];

	const parts: ThreadContentPart[] = [];
	for (const part of content.filter(isUserContentPart)) {
		if (part.type === "text") {
			const text = stripPromptFileBlocks(part.text);
			if (text.length > 0) {
				parts.push({ type: "text", text });
			}
		}
		if (part.type === "image") {
			const imagePart: ThreadImagePart = {
				type: "image",
				image: `data:${part.mimeType};base64,${part.data}`,
			};
			parts.push(imagePart);
		}
	}
	return parts;
}

function createFallbackPromptAttachments(
	content: Extract<AgentMessage, { role: "user" }>["content"],
): DesktopPromptAttachmentDisplay[] {
	const text = getUserContentText(content);
	if (!text.includes("<file")) {
		return [];
	}

	const attachments: DesktopPromptAttachmentDisplay[] = [];
	for (const match of text.matchAll(PROMPT_FILE_NAME_PATTERN)) {
		const pathOrName = match[2]?.trim();
		if (!pathOrName) {
			continue;
		}
		const name = getDisplayFileName(pathOrName);
		const mimeType = getFallbackPromptAttachmentMimeType(name);
		attachments.push({
			id: `prompt-file-${attachments.length}-${name}`,
			kind: mimeType.startsWith("image/") ? "image" : "text",
			name,
			...(pathOrName.startsWith("/") ? { path: pathOrName } : {}),
			mimeType,
			size: 0,
		});
	}
	return attachments;
}

function getUserContentText(content: Extract<AgentMessage, { role: "user" }>["content"]): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function getDisplayFileName(pathOrName: string): string {
	return (
		pathOrName
			.split(/[\\/]+/)
			.filter(Boolean)
			.at(-1) ?? pathOrName
	);
}

function getFallbackPromptAttachmentMimeType(name: string): string {
	const extensionMatch = /\.[^.]+$/.exec(name.toLowerCase());
	return extensionMatch
		? (FALLBACK_PROMPT_ATTACHMENT_MIME_TYPES.get(extensionMatch[0]) ?? "text/plain")
		: "text/plain";
}

function getUserCustomMetadata(message: Extract<AgentMessage, { role: "user" }>): Record<string, unknown> {
	const metadata = (
		message as Extract<AgentMessage, { role: "user" }> & {
			metadata?: { custom?: Record<string, unknown> };
		}
	).metadata;
	return metadata?.custom ?? {};
}

function getUserPromptVisibleText(customMetadata: Record<string, unknown>): string | undefined {
	const value = customMetadata[DESKTOP_PROMPT_VISIBLE_TEXT_METADATA_KEY];
	return typeof value === "string" ? value : undefined;
}

export function getUserPromptAttachments(customMetadata: unknown): DesktopPromptAttachmentDisplay[] {
	if (!customMetadata || typeof customMetadata !== "object") {
		return [];
	}
	const value = (customMetadata as Record<string, unknown>)[DESKTOP_PROMPT_ATTACHMENTS_METADATA_KEY];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is DesktopPromptAttachmentDisplay => {
		if (!item || typeof item !== "object") {
			return false;
		}
		const record = item as Record<string, unknown>;
		return (
			typeof record.id === "string" &&
			(record.kind === "text" || record.kind === "image") &&
			typeof record.name === "string" &&
			typeof record.mimeType === "string" &&
			typeof record.size === "number"
		);
	});
}

function getUserCapabilityInvocations(
	message: Extract<AgentMessage, { role: "user" }>,
): DesktopPromptCapabilityInvocation[] {
	const value = getUserCustomMetadata(message)[DESKTOP_CAPABILITY_INVOCATIONS_METADATA_KEY];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is DesktopPromptCapabilityInvocation => {
		if (!item || typeof item !== "object") {
			return false;
		}
		const record = item as Record<string, unknown>;
		return (
			(record.type === "skill" || record.type === "prompt_template") &&
			typeof record.name === "string" &&
			record.name.length > 0
		);
	});
}

function convertToolCallPart(
	part: Extract<Extract<AgentMessage, { role: "assistant" }>["content"][number], { type: "toolCall" }>,
	toolResults: ReadonlyMap<string, ToolResultRecord>,
	toolActivityById: ReadonlyMap<string, ToolCallActivity>,
): ThreadToolCallPart {
	const persistedResult = toolResults.get(part.id);
	const activity = toolActivityById.get(part.id);
	const result = activity?.result ?? persistedResult?.result;
	const isError = activity?.status === "error" || persistedResult?.isError === true;

	return {
		type: "tool-call",
		toolCallId: part.id,
		toolName: part.name,
		args: normalizeToolArgs(part.arguments),
		argsText: stringifyJson(part.arguments),
		result,
		isError,
		artifact: activity ? ({ desktopToolCall: activity } satisfies DesktopToolCallArtifact) : undefined,
	};
}

function collectToolResults(messages: readonly AgentMessage[]): Map<string, ToolResultRecord> {
	const results = new Map<string, ToolResultRecord>();
	for (const message of messages) {
		if (message.role !== "toolResult") continue;
		results.set(message.toolCallId, {
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			result: {
				content: message.content,
				details: message.details,
				isError: message.isError,
				toolCallId: message.toolCallId,
				toolName: message.toolName,
			},
			isError: Boolean(message.isError),
			timestamp: message.timestamp,
		});
	}
	return results;
}

function resolveAssistantRunStatus(
	message: Extract<AgentMessage, { role: "assistant" }>,
	isStreaming: boolean,
): ThreadMessageStatus {
	if (isStreaming) return { type: "running" };
	if (message.errorMessage) {
		return {
			type: "incomplete",
			reason: "error",
			error: message.errorMessage,
		};
	}
	if (message.stopReason === "aborted") {
		return { type: "incomplete", reason: "cancelled" };
	}
	return { type: "complete", reason: "stop" };
}

function createRunActivityMetadata({
	hasReasoning,
	isStreaming,
	messages,
	runActivityTiming,
	runId,
	toolCallIds,
	toolActivityById,
	toolResults,
}: {
	hasReasoning: boolean;
	isStreaming: boolean;
	messages: Extract<AgentMessage, { role: "assistant" }>[];
	runActivityTiming?: RunActivityTiming;
	runId: string;
	toolCallIds: string[];
	toolActivityById: ReadonlyMap<string, ToolCallActivity>;
	toolResults: ReadonlyMap<string, ToolResultRecord>;
}): DesktopRunActivityMetadata {
	const messageTimestamps = messages.map((message) => message.timestamp);
	const fallbackStartedAt = Math.min(...messageTimestamps);
	const toolTimestamps = toolCallIds
		.map((toolCallId) => {
			const activity = toolActivityById.get(toolCallId);
			if (activity) {
				return activity.completedAt ?? activity.updatedAt ?? activity.startedAt;
			}
			return toolResults.get(toolCallId)?.timestamp;
		})
		.filter((timestamp): timestamp is number => timestamp !== undefined);
	const fallbackEndedAt = Math.max(...messageTimestamps, ...toolTimestamps);
	const startedAt = runActivityTiming?.startedAt ?? fallbackStartedAt;
	const endedAt = isStreaming ? runActivityTiming?.endedAt : (runActivityTiming?.endedAt ?? fallbackEndedAt);
	const phase = resolveRunActivityPhase({
		isStreaming,
		messages,
		toolCallIds,
		toolActivityById,
		toolResults,
	});

	return {
		runId,
		startedAt,
		endedAt,
		toolCount: toolCallIds.length,
		hasReasoning,
		...(phase ? { phase } : {}),
	};
}

function resolveRunActivityPhase({
	isStreaming,
	messages,
	toolCallIds,
	toolActivityById,
	toolResults,
}: {
	isStreaming: boolean;
	messages: Extract<AgentMessage, { role: "assistant" }>[];
	toolCallIds: string[];
	toolActivityById: ReadonlyMap<string, ToolCallActivity>;
	toolResults: ReadonlyMap<string, ToolResultRecord>;
}): DesktopRunActivityMetadata["phase"] {
	if (!isStreaming || toolCallIds.length === 0 || messages.at(-1)?.stopReason !== "toolUse") {
		return undefined;
	}

	const hasRunningTool = toolCallIds.some((toolCallId) => toolActivityById.get(toolCallId)?.status === "running");
	if (hasRunningTool) {
		return undefined;
	}

	const allToolsCompleted = toolCallIds.every((toolCallId) => {
		const activity = toolActivityById.get(toolCallId);
		return activity?.status === "completed" || activity?.status === "error" || toolResults.has(toolCallId);
	});

	return allToolsCompleted ? "waiting_for_response" : undefined;
}

function createMessageTimingMetadata({
	runActivityMetadata,
	runActivityTiming,
}: {
	runActivityMetadata: DesktopRunActivityMetadata;
	runActivityTiming: RunActivityTiming;
}): DesktopMessageTiming {
	const totalStreamTime =
		runActivityMetadata.endedAt !== undefined
			? Math.max(0, runActivityMetadata.endedAt - runActivityMetadata.startedAt)
			: undefined;
	const firstTokenTime =
		runActivityTiming.firstTokenAt !== undefined
			? Math.max(0, runActivityTiming.firstTokenAt - runActivityMetadata.startedAt)
			: undefined;

	return {
		streamStartTime: runActivityMetadata.startedAt,
		firstTokenTime,
		totalStreamTime,
		totalChunks: runActivityTiming.totalChunks ?? 0,
		toolCallCount: runActivityMetadata.toolCount,
	};
}

function createMessageId(message: AgentMessage, index: number): string {
	const timestamp = "timestamp" in message && typeof message.timestamp === "number" ? message.timestamp : index;
	return `${message.role}-${timestamp}-${index}`;
}

function createAssistantRunMessageId(index: number): string {
	return `assistant-run-${index}`;
}

function createMessageDate(timestamp: unknown, index: number): Date {
	return new Date(typeof timestamp === "number" ? timestamp : index);
}

function normalizeToolArgs(value: unknown): ThreadToolCallPart["args"] {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as ThreadToolCallPart["args"];
	}
	return { value } as ThreadToolCallPart["args"];
}

function stringifyJson(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}
