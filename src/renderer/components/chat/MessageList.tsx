import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent, ThinkingContent, ToolCall } from "@earendil-works/pi-ai";
import { AlertTriangle, ArrowDown, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { softRevealTransition, subtleReveal } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { DesktopThreadMessageStatus } from "../../lib/assistant-runtime-adapter.ts";
import { getMessageToolCalls, type ToolCallActivity } from "../../lib/conversation-timeline-projection.ts";
import { MessageResponse } from "../ai-elements/message.tsx";
import { Task } from "../ai-elements/task.tsx";
import { PiMarkIcon } from "../ui/Icons.tsx";
import { ToolActivityRows, ToolRunSummary } from "./InlineToolRail.tsx";
import { stripStandaloneReasoningHeadings } from "./reasoning-content.ts";
import {
	getToolCallImagePreviewItems,
	type ThreadImagePreview,
	ThreadImagePreviewGrid,
} from "./ThreadImagePreviewGrid.tsx";
import { ThreadRunStatusTask } from "./ThreadRunStatusTask.tsx";

interface MessageListProps {
	messages: AgentMessage[];
	streamingMessage?: AgentMessage;
	showThinkingBlocks: boolean;
	toolCalls: ToolCallActivity[];
	emptyState?: {
		label: string;
		title: string;
		description: string;
		detail?: string;
		tone?: "idle" | "error";
		actionLabel?: string;
	};
	onEmptyAction?: () => void;
	defaultExpandedToolRailMessageIndex?: number;
	isStreaming?: boolean;
	onPreviewImage?: (image: ThreadImagePreview) => void;
	bottomInset?: number;
}

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 96;

function messageKey(message: AgentMessage, index: number): string {
	const timestamp = "timestamp" in message ? message.timestamp : index;
	return `${message.role}-${timestamp}-${index}`;
}

function contentKey(type: string, index: number): string {
	return `${type}-${index}`;
}

function isViewportPinnedToBottom(viewport: HTMLDivElement): boolean {
	return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
}

function getScrollViewport(root: HTMLDivElement | null): HTMLDivElement | null {
	return root?.querySelector("[data-slot='scroll-area-viewport']") as HTMLDivElement | null;
}

function isVisibleTranscriptMessage(message: AgentMessage): boolean {
	return message.role !== "toolResult";
}

function getPersistedToolResultMap(
	messages: AgentMessage[],
): Map<string, Extract<AgentMessage, { role: "toolResult" }>> {
	const toolResultMap = new Map<string, Extract<AgentMessage, { role: "toolResult" }>>();

	for (const message of messages) {
		if (message.role === "toolResult") {
			toolResultMap.set(message.toolCallId, message);
		}
	}

	return toolResultMap;
}

function getPersistedToolCalls(
	message: Extract<AgentMessage, { role: "assistant" }>,
	messages: AgentMessage[],
): ToolCallActivity[] {
	const toolResultMap = getPersistedToolResultMap(messages);
	const persistedToolCalls: ToolCallActivity[] = [];

	for (const content of message.content) {
		if (content.type !== "toolCall") {
			continue;
		}

		const toolResult = toolResultMap.get(content.id);
		const completedAt = toolResult?.timestamp ?? message.timestamp;

		persistedToolCalls.push({
			toolCallId: content.id,
			toolName: content.name,
			args: content.arguments,
			status: toolResult?.isError ? "error" : "completed",
			startedAt: message.timestamp,
			updatedAt: completedAt,
			completedAt,
			result: toolResult
				? {
						content: toolResult.content,
						toolName: toolResult.toolName,
						toolCallId: toolResult.toolCallId,
						isError: toolResult.isError,
					}
				: undefined,
		});
	}

	return persistedToolCalls;
}

function renderTextBlocks(content: (TextContent | ImageContent)[]): ReactNode[] {
	return content.map((block, index) => {
		if (block.type === "text") {
			return (
				<p key={contentKey(block.type, index)} className="whitespace-pre-wrap break-words">
					{block.text}
				</p>
			);
		}

		return (
			<img
				key={contentKey(block.type, index)}
				alt="Attached content"
				className="max-h-80 rounded-2xl border object-contain"
				src={`data:${block.mimeType};base64,${block.data}`}
			/>
		);
	});
}

function renderThinkingBlock(block: ThinkingContent, index: number, showThinkingBlocks: boolean): ReactNode {
	if (!showThinkingBlocks) {
		return null;
	}

	const thinkingText = stripStandaloneReasoningHeadings(block.thinking);
	if (thinkingText.length === 0) {
		return null;
	}

	return (
		<div
			key={contentKey(block.type, index)}
			className="rounded-lg border bg-muted/40 px-4 py-4 text-[13px] leading-6 text-muted-foreground"
		>
			<div className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
				<Sparkles className="size-3.5" />
				<span>Thinking</span>
			</div>
			<MessageResponse className="min-w-0 break-words text-[13px] leading-6 [&_p]:m-0">
				{thinkingText}
			</MessageResponse>
		</div>
	);
}

function renderAssistantBlocks(
	content: (TextContent | ThinkingContent | ToolCall)[],
	showThinkingBlocks: boolean,
): ReactNode[] {
	return content.flatMap((block, index) => {
		if (block.type === "text") {
			return (
				<p key={contentKey(block.type, index)} className="whitespace-pre-wrap break-words">
					{block.text}
				</p>
			);
		}

		if (block.type === "thinking") {
			return renderThinkingBlock(block, index, showThinkingBlocks);
		}

		return [];
	});
}

function renderUserMessage(message: Extract<AgentMessage, { role: "user" }>): ReactNode {
	return typeof message.content === "string" ? (
		<p className="whitespace-pre-wrap break-words">{message.content}</p>
	) : (
		<div className="space-y-3">{renderTextBlocks(message.content)}</div>
	);
}

function renderAssistantMessage(
	message: Extract<AgentMessage, { role: "assistant" }>,
	showThinkingBlocks: boolean,
): ReactNode | null {
	const blocks = renderAssistantBlocks(message.content, showThinkingBlocks).filter((block) => block !== null);
	if (blocks.length === 0) {
		return null;
	}

	return <div className="space-y-3 text-[13px] leading-6 text-[color:var(--color-workbench-ink)]">{blocks}</div>;
}

function renderAssistantThinkingStatus(key?: string): ReactNode {
	return (
		<div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite" key={key}>
			<span className="flex items-center gap-1" aria-hidden="true">
				<span className="motion-thinking-dot size-1.5 rounded-full bg-muted-foreground/60" />
				<span className="motion-thinking-dot size-1.5 rounded-full bg-muted-foreground/60 [animation-delay:140ms]" />
				<span className="motion-thinking-dot size-1.5 rounded-full bg-muted-foreground/60 [animation-delay:280ms]" />
			</span>
			<span>正在思考</span>
		</div>
	);
}

interface UserTranscriptItem {
	kind: "user";
	message: Extract<AgentMessage, { role: "user" }>;
	messageIndex: number;
}

interface AssistantRunTranscriptItem {
	kind: "assistantRun";
	messages: Extract<AgentMessage, { role: "assistant" }>[];
	messageIndexes: number[];
}

type TranscriptItem = UserTranscriptItem | AssistantRunTranscriptItem;

function createTranscriptItems(messages: AgentMessage[]): TranscriptItem[] {
	const transcriptItems: TranscriptItem[] = [];
	let currentAssistantRun: AssistantRunTranscriptItem | undefined;

	function flushAssistantRun(): void {
		if (!currentAssistantRun) {
			return;
		}

		transcriptItems.push(currentAssistantRun);
		currentAssistantRun = undefined;
	}

	for (const [messageIndex, message] of messages.entries()) {
		if (message.role === "toolResult") {
			continue;
		}

		if (message.role === "user") {
			flushAssistantRun();
			transcriptItems.push({ kind: "user", message, messageIndex });
			continue;
		}

		if (message.role === "assistant") {
			currentAssistantRun ??= { kind: "assistantRun", messages: [], messageIndexes: [] };
			currentAssistantRun.messages.push(message);
			currentAssistantRun.messageIndexes.push(messageIndex);
		}
	}

	flushAssistantRun();
	return transcriptItems;
}

function getAssistantRunKey(run: AssistantRunTranscriptItem, itemIndex: number): string {
	const firstMessageIndex = run.messageIndexes[0] ?? itemIndex;
	return `assistant-run-${firstMessageIndex}-${itemIndex}`;
}

function hasToolCallBlocks(messages: Extract<AgentMessage, { role: "assistant" }>[]): boolean {
	return messages.some((message) => message.content.some((content) => content.type === "toolCall"));
}

function getAssistantRunToolCalls(
	run: AssistantRunTranscriptItem,
	toolCalls: ToolCallActivity[],
	messages: AgentMessage[],
): ToolCallActivity[] {
	const runToolCalls: ToolCallActivity[] = [];
	const seenToolCallIds = new Set<string>();

	for (const message of run.messages) {
		const hydratedToolCalls = getMessageToolCalls(message, toolCalls);
		const messageToolCalls =
			hydratedToolCalls.length > 0 ? hydratedToolCalls : getPersistedToolCalls(message, messages);

		for (const toolCall of messageToolCalls) {
			if (seenToolCallIds.has(toolCall.toolCallId)) {
				continue;
			}

			seenToolCallIds.add(toolCall.toolCallId);
			runToolCalls.push(toolCall);
		}
	}

	return runToolCalls;
}

function getAssistantMessageToolCalls(
	message: Extract<AgentMessage, { role: "assistant" }>,
	toolCalls: ToolCallActivity[],
	messages: AgentMessage[],
): ToolCallActivity[] {
	const hydratedToolCalls = getMessageToolCalls(message, toolCalls);
	return hydratedToolCalls.length > 0 ? hydratedToolCalls : getPersistedToolCalls(message, messages);
}

function getAssistantRunStartedAt(run: AssistantRunTranscriptItem): number | undefined {
	for (const message of run.messages) {
		if ("timestamp" in message) {
			return message.timestamp;
		}
	}

	return undefined;
}

function getAssistantRunEndedAt(run: AssistantRunTranscriptItem, toolCalls: ToolCallActivity[]): number | undefined {
	const timestamps = run.messages
		.map((message) => ("timestamp" in message ? message.timestamp : undefined))
		.filter((timestamp): timestamp is number => timestamp !== undefined);
	const toolCallTimestamps = toolCalls.map(
		(toolCall) => toolCall.completedAt ?? toolCall.updatedAt ?? toolCall.startedAt,
	);
	const allTimestamps = [...timestamps, ...toolCallTimestamps];

	return allTimestamps.length > 0 ? Math.max(...allTimestamps) : undefined;
}

function getAssistantRunStatus(run: AssistantRunTranscriptItem): DesktopThreadMessageStatus | undefined {
	for (let index = run.messages.length - 1; index >= 0; index -= 1) {
		const message = run.messages[index];
		if (message?.errorMessage) {
			return { type: "incomplete", reason: "error", error: message.errorMessage };
		}
		if (message?.stopReason === "aborted") {
			return { type: "incomplete", reason: "cancelled" };
		}
	}

	return undefined;
}

interface AssistantRunViewProps {
	run: AssistantRunTranscriptItem;
	itemIndex: number;
	toolCalls: ToolCallActivity[];
	messages: AgentMessage[];
	showThinkingBlocks: boolean;
	defaultExpandedToolRailMessageIndex?: number;
	isRunActive: boolean;
	onPreviewImage?: (image: ThreadImagePreview) => void;
}

function AssistantRunView({
	run,
	itemIndex,
	toolCalls,
	messages,
	showThinkingBlocks,
	defaultExpandedToolRailMessageIndex,
	isRunActive,
	onPreviewImage,
}: AssistantRunViewProps) {
	const runToolCalls = getAssistantRunToolCalls(run, toolCalls, messages);
	const [isRunToolsExpanded, setIsRunToolsExpanded] = useState(() =>
		defaultExpandedToolRailMessageIndex === undefined
			? true
			: run.messageIndexes.includes(defaultExpandedToolRailMessageIndex),
	);
	const runStartedAt = getAssistantRunStartedAt(run);
	const runEndedAt = getAssistantRunEndedAt(run, runToolCalls);
	const runHasToolCallBlocks = hasToolCallBlocks(run.messages);
	const runStatus = getAssistantRunStatus(run);
	let didRenderToolSummary = false;

	function renderToolSummary(): ReactNode {
		didRenderToolSummary = true;
		return (
			<ToolRunSummary
				isExpanded={isRunToolsExpanded}
				isRunActive={isRunActive}
				key="assistant-run-tool-summary"
				onToggle={() => setIsRunToolsExpanded((isExpanded) => !isExpanded)}
				runEndedAt={runEndedAt}
				runStartedAt={runStartedAt}
				toolCalls={runToolCalls}
			/>
		);
	}

	function renderToolSegment(
		message: Extract<AgentMessage, { role: "assistant" }>,
		messageIndex: number,
	): ReactNode[] {
		const messageToolCalls = getAssistantMessageToolCalls(message, toolCalls, messages);
		if (messageToolCalls.length === 0) {
			return [];
		}

		const segmentContent: ReactNode[] = [];
		if (!didRenderToolSummary && runToolCalls.length > 0) {
			segmentContent.push(renderToolSummary());
		}

		if (isRunToolsExpanded) {
			segmentContent.push(
				<div
					className="border-l border-border/70 pl-3 [overflow-anchor:none]"
					key={`assistant-tool-segment-${message.timestamp}-${messageIndex}`}
				>
					<ToolActivityRows
						className="max-h-none overflow-visible pr-0 [scrollbar-gutter:auto]"
						isRunActive={isRunActive}
						toolCalls={messageToolCalls}
					/>
					<ThreadImagePreviewGrid
						className="mt-3"
						isRunActive={isRunActive}
						items={getToolCallImagePreviewItems(messageToolCalls)}
						onPreviewImage={onPreviewImage}
					/>
				</div>,
			);
		}

		return segmentContent;
	}

	const assistantRunContent = run.messages.flatMap((message, messageOffset) => {
		const assistantBody = renderAssistantMessage(message, showThinkingBlocks);
		const messageKeySuffix = `${message.timestamp}-${messageOffset}`;
		const content: ReactNode[] = [];

		if (assistantBody) {
			content.push(<div key={`assistant-body-${messageKeySuffix}`}>{assistantBody}</div>);
		}

		content.push(...renderToolSegment(message, messageOffset));
		return content;
	});

	if (!didRenderToolSummary && runToolCalls.length > 0) {
		assistantRunContent.unshift(renderToolSummary());
		if (isRunToolsExpanded) {
			assistantRunContent.splice(
				1,
				0,
				<div className="border-l border-border/70 pl-3 [overflow-anchor:none]" key="assistant-run-tool-fallback">
					<ToolActivityRows
						className="max-h-none overflow-visible pr-0 [scrollbar-gutter:auto]"
						isRunActive={isRunActive}
						toolCalls={runToolCalls}
					/>
					<ThreadImagePreviewGrid
						className="mt-3"
						isRunActive={isRunActive}
						items={getToolCallImagePreviewItems(runToolCalls)}
						onPreviewImage={onPreviewImage}
					/>
				</div>,
			);
		}
	}

	if (isRunActive) {
		assistantRunContent.unshift(renderAssistantThinkingStatus("assistant-run-thinking-status"));
	}

	const runContent =
		runToolCalls.length > 0 ? (
			<Task
				className="space-y-5"
				data-slot="tool-task"
				onOpenChange={setIsRunToolsExpanded}
				open={isRunToolsExpanded}
			>
				{assistantRunContent.length > 0
					? assistantRunContent
					: !runHasToolCallBlocks
						? renderAssistantThinkingStatus()
						: null}
			</Task>
		) : (
			<div className="space-y-5">
				{assistantRunContent.length > 0
					? assistantRunContent
					: !runHasToolCallBlocks
						? renderAssistantThinkingStatus()
						: null}
			</div>
		);

	return (
		<motion.article className="w-full" key={getAssistantRunKey(run, itemIndex)} layout {...subtleReveal}>
			<div className="min-w-0 space-y-3">
				<ThreadRunStatusTask status={runStatus} />
				{runContent}
			</div>
		</motion.article>
	);
}

function renderEmptyState(
	emptyState: NonNullable<MessageListProps["emptyState"]>,
	onEmptyAction?: () => void,
): ReactNode {
	const tone = emptyState.tone ?? "idle";

	return (
		<motion.div
			className="boundary-state mx-auto grid min-h-full w-full place-items-center py-14"
			data-boundary-state={tone}
			data-slot="conversation-boundary-state"
			role={tone === "error" ? "alert" : undefined}
			{...subtleReveal}
		>
			<Card
				className={cn("boundary-state-card w-full py-0 text-center", tone === "error" && "boundary-state-error")}
			>
				<CardContent className="space-y-5 px-5 py-8">
					<div className="grid justify-items-center gap-4">
						<div className="boundary-state-icon flex items-center justify-center rounded-xl border bg-background/70 text-foreground">
							{tone === "error" ? <AlertTriangle className="size-5" /> : <PiMarkIcon className="size-5" />}
						</div>
						<div className="space-y-1.5">
							<p className="ui-detail-label">{emptyState.label}</p>
							<h2 className="text-balance text-[13px] font-medium tracking-tight text-foreground">
								{emptyState.title}
							</h2>
						</div>
					</div>
					<p className="mx-auto max-w-[42ch] text-sm leading-7 text-[color:var(--color-workbench-ink)]">
						{emptyState.description}
					</p>
					{emptyState.detail ? (
						<div className="boundary-state-detail mx-auto rounded-lg border bg-muted/35 px-3 py-2 font-mono text-[12px] text-muted-foreground">
							{emptyState.detail}
						</div>
					) : null}
					{emptyState.actionLabel ? (
						<Button className="rounded-full px-4" onClick={onEmptyAction} type="button" variant="ghost">
							{emptyState.actionLabel}
						</Button>
					) : null}
				</CardContent>
			</Card>
		</motion.div>
	);
}

export function MessageList({
	messages,
	streamingMessage,
	showThinkingBlocks,
	toolCalls,
	emptyState,
	onEmptyAction,
	defaultExpandedToolRailMessageIndex,
	isStreaming = false,
	onPreviewImage,
	bottomInset = 24,
}: MessageListProps) {
	const scrollAreaRef = useRef<HTMLDivElement | null>(null);
	const shouldAutoScrollRef = useRef(true);
	const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
	const visibleMessages = messages.filter(isVisibleTranscriptMessage);
	const renderedMessages =
		streamingMessage !== undefined && isVisibleTranscriptMessage(streamingMessage)
			? [...visibleMessages, streamingMessage]
			: visibleMessages;
	const isTranscriptEmpty = renderedMessages.length === 0;
	const transcriptItems = createTranscriptItems(renderedMessages);
	const shouldRenderPendingAssistantStatus =
		isStreaming && transcriptItems[transcriptItems.length - 1]?.kind === "user";

	useEffect(() => {
		if (isTranscriptEmpty) {
			shouldAutoScrollRef.current = true;
			setIsPinnedToBottom(true);
		}

		const viewport = getScrollViewport(scrollAreaRef.current);
		if (!viewport) {
			return;
		}

		function handleScroll(): void {
			if (!viewport) {
				return;
			}

			const nextIsPinned = isViewportPinnedToBottom(viewport);
			shouldAutoScrollRef.current = nextIsPinned;
			setIsPinnedToBottom((currentIsPinned) => (currentIsPinned === nextIsPinned ? currentIsPinned : nextIsPinned));
		}

		viewport.addEventListener("scroll", handleScroll, { passive: true });
		return () => viewport.removeEventListener("scroll", handleScroll);
	}, [isTranscriptEmpty]);

	useEffect(() => {
		const viewport = getScrollViewport(scrollAreaRef.current);
		if (!viewport) {
			return;
		}

		const lastRenderedMessage = renderedMessages[renderedMessages.length - 1];
		if (lastRenderedMessage?.role === "user") {
			shouldAutoScrollRef.current = true;
		}

		if (!shouldAutoScrollRef.current) {
			return;
		}

		viewport.scrollTop = viewport.scrollHeight;
		setIsPinnedToBottom(true);
	});

	function scrollToLatestMessage(): void {
		const viewport = getScrollViewport(scrollAreaRef.current);
		if (!viewport) {
			return;
		}

		shouldAutoScrollRef.current = true;
		viewport.scrollTop = viewport.scrollHeight;
		setIsPinnedToBottom(true);
	}

	if (isTranscriptEmpty) {
		const resolvedEmptyState = emptyState ?? {
			label: "Skylark",
			title: "Start a new session.",
			description: "Ask Skylark to inspect files, explain code, or propose the next change.",
			tone: "idle" as const,
			actionLabel: "Focus composer",
		};

		return (
			<div ref={scrollAreaRef} className="h-full min-h-0 flex-1">
				<ScrollArea className="h-full" scrollHideDelay={600} type="scroll">
					<div className="min-h-full" style={{ paddingBottom: bottomInset }}>
						{renderEmptyState(resolvedEmptyState, onEmptyAction)}
					</div>
				</ScrollArea>
			</div>
		);
	}

	return (
		<div ref={scrollAreaRef} className="relative h-full min-h-0 flex-1">
			<ScrollArea className="h-full" scrollHideDelay={600} type="scroll">
				<div
					className="mx-auto flex min-h-full w-full max-w-[860px] select-text flex-col gap-8 px-2 pt-6 md:px-4"
					data-selectable-text="true"
					style={{ paddingBottom: bottomInset }}
				>
					<AnimatePresence initial={false}>
						{transcriptItems.map((item, index) => {
							if (item.kind === "user") {
								const message = item.message;

								return (
									<motion.article
										className="flex justify-end"
										key={messageKey(message, item.messageIndex)}
										layout
										{...subtleReveal}
									>
										<div className="max-w-[70%]">
											<div className="rounded-2xl bg-[color:var(--color-user-bubble)] px-4 py-3 text-[13px] leading-6 text-[color:var(--color-user-bubble-foreground)]">
												{renderUserMessage(message)}
											</div>
										</div>
									</motion.article>
								);
							}

							const isRunActive = isStreaming && index === transcriptItems.length - 1;

							return (
								<AssistantRunView
									defaultExpandedToolRailMessageIndex={defaultExpandedToolRailMessageIndex}
									isRunActive={isRunActive}
									itemIndex={index}
									key={getAssistantRunKey(item, index)}
									messages={messages}
									onPreviewImage={onPreviewImage}
									run={item}
									showThinkingBlocks={showThinkingBlocks}
									toolCalls={toolCalls}
								/>
							);
						})}
					</AnimatePresence>
					{shouldRenderPendingAssistantStatus ? (
						<motion.article className="w-full" key="assistant-run-pending-status" layout {...subtleReveal}>
							<div className="min-w-0 space-y-3">
								<div className="space-y-5">{renderAssistantThinkingStatus()}</div>
							</div>
						</motion.article>
					) : null}
				</div>
			</ScrollArea>
			<AnimatePresence initial={false}>
				{!isPinnedToBottom ? (
					<motion.div
						animate={{ opacity: 1, scale: 1, x: "-50%", y: 0 }}
						className="absolute left-1/2 z-20"
						exit={{ opacity: 0, scale: 0.96, x: "-50%", y: 4 }}
						initial={{ opacity: 0, scale: 0.96, x: "-50%", y: 4 }}
						key="jump-to-latest"
						style={{ bottom: Math.max(16, bottomInset) }}
						transition={softRevealTransition}
					>
						<Button
							aria-label="Jump to latest message"
							className="size-10 rounded-full border border-border bg-background/95 text-muted-foreground shadow-lg backdrop-blur hover:bg-background hover:text-foreground"
							onClick={scrollToLatestMessage}
							size="icon"
							type="button"
							variant="outline"
						>
							<ArrowDown className="size-4" />
						</Button>
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}
