import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent, ThinkingContent, ToolCall, Usage } from "@earendil-works/pi-ai";
import type { DesktopAgentModel } from "../../../shared/serialized-agent-event.ts";
import type { DesktopRuntimeCatalog } from "../../../shared/types.ts";

export interface ContextWindowUsage {
	usedTokens: number;
	totalTokens?: number;
}

export interface ChatShellNoticeState {
	persistentTopNotice?: string;
	abortNoticeKey?: string;
}

function isAbortNotice(message?: string): boolean {
	return message !== undefined && /\babort(?:ed)?\b/i.test(message);
}

function getLatestAssistantErrorKey(messages: AgentMessage[], errorMessage?: string): string | undefined {
	if (!errorMessage) {
		return undefined;
	}

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "assistant" && message.errorMessage === errorMessage) {
			return `${message.timestamp}:${errorMessage}`;
		}
	}

	return errorMessage;
}

function calculateUsageTokens(usage?: Usage): number {
	if (!usage) {
		return 0;
	}

	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function getAssistantUsage(message: AgentMessage): Usage | undefined {
	if (message.role !== "assistant" || message.stopReason === "aborted" || message.stopReason === "error") {
		return undefined;
	}

	const tokens = calculateUsageTokens(message.usage);
	return tokens > 0 && message.usage ? message.usage : undefined;
}

function getMessageTimestamp(message: AgentMessage): number | undefined {
	const timestamp = (message as { timestamp?: unknown }).timestamp;
	return typeof timestamp === "number" ? timestamp : undefined;
}

function isCompactionSummaryMessage(message: AgentMessage): boolean {
	return (message as { role?: string }).role === "compactionSummary";
}

function getLatestCompactionSummaryInfo(messages: AgentMessage[]): { index: number; timestamp?: number } | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message && isCompactionSummaryMessage(message)) {
			return { index, timestamp: getMessageTimestamp(message) };
		}
	}
	return undefined;
}

function getLastAssistantUsageInfo(
	messages: AgentMessage[],
	minIndex = 0,
	minTimestampExclusive?: number,
): { index: number; usage: Usage } | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (index < minIndex) {
			break;
		}
		const message = messages[index];
		if (!message) {
			continue;
		}
		const timestamp = getMessageTimestamp(message);
		if (minTimestampExclusive !== undefined && (timestamp === undefined || timestamp <= minTimestampExclusive)) {
			continue;
		}

		const usage = getAssistantUsage(message);
		if (usage) {
			return { index, usage };
		}
	}

	return undefined;
}

function safeJsonLength(value: unknown): number {
	try {
		return JSON.stringify(value)?.length ?? 0;
	} catch {
		return 0;
	}
}

function estimateTextAndImageContentTokens(content: (TextContent | ImageContent)[]): number {
	let chars = 0;
	for (const block of content) {
		if (block.type === "text" && typeof block.text === "string") {
			chars += block.text.length;
			continue;
		}

		if (block.type === "image") {
			chars += 4800;
		}
	}

	return Math.ceil(chars / 4);
}

function estimateAssistantContentTokens(content?: (TextContent | ThinkingContent | ToolCall)[]): number {
	if (!Array.isArray(content)) {
		return 0;
	}

	let chars = 0;
	for (const block of content) {
		if (block.type === "text" && typeof block.text === "string") {
			chars += block.text.length;
			continue;
		}

		if (block.type === "thinking" && typeof block.thinking === "string") {
			chars += block.thinking.length;
			continue;
		}

		if (block.type === "toolCall" && typeof block.name === "string") {
			chars += block.name.length + safeJsonLength(block.arguments);
		}
	}

	return Math.ceil(chars / 4);
}

function estimateCustomMessageTokens(message: AgentMessage): number {
	const record = message as unknown as Record<string, unknown>;
	const content = record.content;
	if (typeof content === "string") {
		return Math.ceil(content.length / 4);
	}

	if (Array.isArray(content)) {
		return estimateTextAndImageContentTokens(content as (TextContent | ImageContent)[]);
	}

	const summary = record.summary;
	if (typeof summary === "string") {
		return Math.ceil(summary.length / 4);
	}

	const command = typeof record.command === "string" ? record.command : "";
	const output = typeof record.output === "string" ? record.output : "";
	return Math.ceil((command.length + output.length) / 4);
}

function estimateMessageTokens(message: AgentMessage): number {
	switch (message.role) {
		case "user": {
			const content = (message as { content?: unknown }).content;
			if (typeof content === "string") {
				return Math.ceil(content.length / 4);
			}
			return Array.isArray(content)
				? estimateTextAndImageContentTokens(content as (TextContent | ImageContent)[])
				: 0;
		}
		case "assistant":
			return estimateAssistantContentTokens(
				(message as { content?: unknown }).content as (TextContent | ThinkingContent | ToolCall)[] | undefined,
			);
		case "toolResult": {
			const content = (message as { content?: unknown }).content;
			return Array.isArray(content)
				? estimateTextAndImageContentTokens(content as (TextContent | ImageContent)[])
				: 0;
		}
		default:
			return estimateCustomMessageTokens(message);
	}
}

export function resolveContextWindowUsage({
	contextWindow,
	messages,
	streamingMessage,
}: {
	contextWindow?: number;
	messages: AgentMessage[];
	streamingMessage?: AgentMessage;
}): ContextWindowUsage | undefined {
	const contextMessages = streamingMessage ? [...messages, streamingMessage] : messages;
	const latestCompactionInfo = getLatestCompactionSummaryInfo(contextMessages);
	const usageSearchStartIndex = latestCompactionInfo ? latestCompactionInfo.index + 1 : 0;
	const lastUsageInfo = getLastAssistantUsageInfo(
		contextMessages,
		usageSearchStartIndex,
		latestCompactionInfo?.timestamp,
	);
	const usageTokens = lastUsageInfo ? calculateUsageTokens(lastUsageInfo.usage) : 0;
	let trailingTokens = 0;

	const startIndex = lastUsageInfo ? lastUsageInfo.index + 1 : (latestCompactionInfo?.index ?? 0);
	for (let index = startIndex; index < contextMessages.length; index += 1) {
		const message = contextMessages[index];
		if (message) {
			trailingTokens += estimateMessageTokens(message);
		}
	}

	const usedTokens = usageTokens + trailingTokens;
	if (usedTokens === 0 && (!contextWindow || contextWindow <= 0)) {
		return undefined;
	}

	return {
		usedTokens,
		totalTokens: contextWindow && contextWindow > 0 ? contextWindow : undefined,
	};
}

export function resolveModelContextWindow({
	model,
	runtimeCatalog,
}: {
	model?: DesktopAgentModel;
	runtimeCatalog?: DesktopRuntimeCatalog;
}): number | undefined {
	if (model?.contextWindow && model.contextWindow > 0) {
		return model.contextWindow;
	}

	if (!model) {
		return undefined;
	}

	const catalogModel = runtimeCatalog?.providers
		.find((provider) => provider.id === model.provider)
		?.models.find((catalogEntry) => catalogEntry.id === model.id);

	return catalogModel?.contextWindow && catalogModel.contextWindow > 0 ? catalogModel.contextWindow : undefined;
}

export function resolveChatShellNoticeState({
	bridgeError,
	errorMessage,
	messages,
}: {
	bridgeError?: string;
	errorMessage?: string;
	messages: AgentMessage[];
}): ChatShellNoticeState {
	if (bridgeError) {
		return { persistentTopNotice: bridgeError };
	}

	if (errorMessage && isAbortNotice(errorMessage)) {
		return {
			abortNoticeKey: getLatestAssistantErrorKey(messages, errorMessage),
		};
	}

	return {
		persistentTopNotice: errorMessage,
	};
}
