import { ChevronRight, FileTextIcon } from "lucide-react";
import type { CSSProperties, ReactNode, UIEvent } from "react";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { VirtualStack } from "@/components/ui/virtual-stack";
import { useNowTicker } from "@/hooks/use-now-ticker";
import { useStreamingPresentationFrame } from "@/hooks/use-streaming-presentation-frame";
import { cn } from "@/lib/utils";
import { isRecord } from "../../../shared/guards.ts";
import type { ToolCallActivity } from "../../lib/conversation-timeline-projection.ts";
import { TaskItem, TaskItemFile } from "../ai-elements/task.tsx";

export interface ToolTaskActivityProps {
	toolCalls: ToolCallActivity[];
	className?: string;
	isAutoCollapsing?: boolean;
	isRunActive?: boolean;
	itemSlot?: string;
	preserveOrder?: boolean;
	showInitialItemsImmediately?: boolean;
	statusLocale?: "en" | "zh";
}

export interface ToolTaskSummaryProps {
	toolCalls: ToolCallActivity[];
	isExpanded: boolean;
	isRunActive?: boolean;
	onToggle: () => void;
	runEndedAt?: number;
	runStartedAt?: number;
}

interface RipgrepSummary {
	pattern: string;
	target?: string;
}

type ToolTaskGroupKind = "read-file" | "read-image" | "search";

type ToolTaskDisplayItem =
	| {
			kind: "single";
			key: string;
			toolCall: ToolCallActivity;
	  }
	| {
			kind: "group";
			groupKind: ToolTaskGroupKind;
			key: string;
			toolCalls: ToolCallActivity[];
	  };

const TOOL_TASK_GROUP_MINIMUM = 3;
const IMAGE_FILE_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|bmp|tiff?|avif|heic|heif)$/i;

function getStringProperty(value: unknown, keys: string[]): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	for (const key of keys) {
		const property = value[key];
		if (typeof property === "string" && property.trim().length > 0) {
			return property.trim();
		}
	}

	return undefined;
}

function getToolArgsPath(args: unknown): string | undefined {
	return getStringProperty(args, ["path", "filePath", "file_path"]);
}

function getToolArgsCommand(args: unknown): string | undefined {
	return getStringProperty(args, ["command"]);
}

function getPathLabel(path: string): string {
	const segments = path.split(/[\\/]/).filter(Boolean);
	return segments[segments.length - 1] ?? path;
}

function isImagePath(path: string | undefined): boolean {
	return path ? IMAGE_FILE_EXTENSION_PATTERN.test(path) : false;
}

function truncateInline(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, maxLength - 1)}...`;
}

function tokenizeCommand(command: string): string[] {
	return (
		command.match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) ?? []
	);
}

function getRipgrepSummary(command: string): RipgrepSummary | undefined {
	const tokens = tokenizeCommand(command);
	const rgIndex = tokens.findIndex((token) => token === "rg" || token.endsWith("/rg"));
	if (rgIndex === -1) {
		return undefined;
	}

	const args = tokens.slice(rgIndex + 1);
	const positionalArgs: string[] = [];
	const flagsWithValues = new Set([
		"-A",
		"-B",
		"-C",
		"-e",
		"-g",
		"-m",
		"-t",
		"-T",
		"--after-context",
		"--before-context",
		"--context",
		"--glob",
		"--max-count",
		"--regexp",
		"--type",
		"--type-not",
	]);

	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];
		if (token === "--") {
			positionalArgs.push(...args.slice(index + 1));
			break;
		}

		if (token.startsWith("-")) {
			if (token === "-e" || token === "--regexp") {
				const pattern = args[index + 1];
				if (pattern) {
					positionalArgs.push(pattern);
				}
				index += 1;
			} else if (flagsWithValues.has(token)) {
				index += 1;
			}
			continue;
		}

		positionalArgs.push(token);
	}

	const pattern = positionalArgs[0];
	if (!pattern) {
		return undefined;
	}

	return { pattern, target: positionalArgs[1] };
}

function getSubagentSummary(toolCall: ToolCallActivity): string | undefined {
	return getStringProperty(toolCall.args, ["title"]) ?? getStringProperty(toolCall.args, ["task"]);
}

function getMcpToolLabel(toolName: string): string | undefined {
	if (!toolName.startsWith("mcp__")) {
		return undefined;
	}

	const [serverId, ...toolNameParts] = toolName.slice("mcp__".length).split("__");
	const mcpToolName = toolNameParts.join("__");
	return serverId && mcpToolName ? `${serverId} / ${mcpToolName}` : toolName;
}

function TaskFilePill({ label }: { label: string }) {
	return (
		<TaskItemFile className="max-w-full text-[12px]">
			<FileTextIcon className="size-3.5 text-muted-foreground" />
			<span className="truncate">{label}</span>
		</TaskItemFile>
	);
}

function InlineCode({ children }: { children: ReactNode }) {
	return <span className="rounded bg-muted/50 px-1 py-0.5 font-mono text-[12px] text-foreground">{children}</span>;
}

function getBashTaskLabel(command: string | undefined): ReactNode {
	if (!command) {
		return <span>Ran command</span>;
	}

	const ripgrepSummary = getRipgrepSummary(command);
	if (ripgrepSummary) {
		return (
			<>
				<span>Searching</span>
				<InlineCode>"{truncateInline(ripgrepSummary.pattern, 48)}"</InlineCode>
				{ripgrepSummary.target ? <TaskFilePill label={getPathLabel(ripgrepSummary.target)} /> : null}
			</>
		);
	}

	return <span>Ran command</span>;
}

function getToolTaskGroupKind(toolCall: ToolCallActivity): ToolTaskGroupKind | undefined {
	const path = getToolArgsPath(toolCall.args);
	const command = getToolArgsCommand(toolCall.args);

	switch (toolCall.toolName) {
		case "read":
			return isImagePath(path) ? "read-image" : "read-file";
		case "bash":
			return command && getRipgrepSummary(command) ? "search" : undefined;
		case "find":
		case "grep":
			return "search";
		default:
			return undefined;
	}
}

function createSingleDisplayItem(toolCall: ToolCallActivity): ToolTaskDisplayItem {
	return { kind: "single", key: toolCall.toolCallId, toolCall };
}

function flushToolTaskGroup(
	items: ToolTaskDisplayItem[],
	pendingToolCalls: ToolCallActivity[],
	pendingGroupKind: ToolTaskGroupKind | undefined,
): void {
	if (pendingToolCalls.length === 0) {
		return;
	}

	if (pendingGroupKind && pendingToolCalls.length >= TOOL_TASK_GROUP_MINIMUM) {
		const firstToolCall = pendingToolCalls[0];
		items.push({
			kind: "group",
			groupKind: pendingGroupKind,
			key: `group:${pendingGroupKind}:${firstToolCall?.toolCallId}`,
			toolCalls: pendingToolCalls,
		});
		return;
	}

	for (const toolCall of pendingToolCalls) {
		items.push(createSingleDisplayItem(toolCall));
	}
}

function getToolTaskDisplayItems(toolCalls: ToolCallActivity[]): ToolTaskDisplayItem[] {
	const items: ToolTaskDisplayItem[] = [];
	let pendingToolCalls: ToolCallActivity[] = [];
	let pendingGroupKey: string | undefined;
	let pendingGroupKind: ToolTaskGroupKind | undefined;

	for (const toolCall of toolCalls) {
		const groupKind = getToolTaskGroupKind(toolCall);
		const groupKey = groupKind;
		if (!groupKey || groupKey !== pendingGroupKey) {
			flushToolTaskGroup(items, pendingToolCalls, pendingGroupKind);
			pendingToolCalls = [];
			pendingGroupKey = groupKey;
			pendingGroupKind = groupKind;
		}

		if (!groupKey) {
			items.push(createSingleDisplayItem(toolCall));
			pendingGroupKey = undefined;
			pendingGroupKind = undefined;
			continue;
		}

		pendingToolCalls.push(toolCall);
	}

	flushToolTaskGroup(items, pendingToolCalls, pendingGroupKind);
	return items;
}

export function getToolTaskActionLabel(toolCall: ToolCallActivity): string {
	const path = getToolArgsPath(toolCall.args);
	const command = getToolArgsCommand(toolCall.args);
	const mcpToolLabel = getMcpToolLabel(toolCall.toolName);

	if (mcpToolLabel) {
		return `Used ${mcpToolLabel}`;
	}

	switch (toolCall.toolName) {
		case "read":
			return path ? `Read ${getPathLabel(path)}` : "Read file";
		case "bash": {
			const ripgrepSummary = command ? getRipgrepSummary(command) : undefined;
			if (ripgrepSummary) {
				return ripgrepSummary.target
					? `Searching "${ripgrepSummary.pattern}" in ${getPathLabel(ripgrepSummary.target)}`
					: `Searching "${ripgrepSummary.pattern}"`;
			}
			return "Ran command";
		}
		case "edit":
			return path ? `Edited ${getPathLabel(path)}` : "Edited file";
		case "write":
			return path ? `Wrote ${getPathLabel(path)}` : "Wrote file";
		case "subagent": {
			const subagentSummary = getSubagentSummary(toolCall);
			return subagentSummary ? `Ran subagent ${truncateInline(subagentSummary, 80)}` : "Ran subagent";
		}
		default:
			return `Used ${toolCall.toolName}`;
	}
}

function getToolTaskContent(toolCall: ToolCallActivity): ReactNode {
	const path = getToolArgsPath(toolCall.args);
	const command = getToolArgsCommand(toolCall.args);
	const mcpToolLabel = getMcpToolLabel(toolCall.toolName);

	if (mcpToolLabel) {
		return (
			<>
				<span>Used</span>
				<TaskFilePill label={mcpToolLabel} />
			</>
		);
	}

	switch (toolCall.toolName) {
		case "read":
			return path ? (
				<>
					<span>Read</span>
					<TaskFilePill label={getPathLabel(path)} />
				</>
			) : (
				<span>Read file</span>
			);
		case "bash":
			return getBashTaskLabel(command);
		case "edit":
			return path ? (
				<>
					<span>Edited</span>
					<TaskFilePill label={getPathLabel(path)} />
				</>
			) : (
				<span>Edited file</span>
			);
		case "write":
			return path ? (
				<>
					<span>Wrote</span>
					<TaskFilePill label={getPathLabel(path)} />
				</>
			) : (
				<span>Wrote file</span>
			);
		case "subagent": {
			const subagentSummary = getSubagentSummary(toolCall);
			return subagentSummary ? (
				<>
					<span>Ran subagent</span>
					<InlineCode>{truncateInline(subagentSummary, 64)}</InlineCode>
				</>
			) : (
				<span>Ran subagent</span>
			);
		}
		default:
			return <span>{getToolTaskActionLabel(toolCall)}</span>;
	}
}

export function formatToolTaskDuration(durationMs: number): string {
	const seconds = Math.max(0, Math.floor(durationMs / 1000));
	if (seconds < 60) {
		return `${seconds}s`;
	}

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (remainingSeconds === 0) {
		return `${minutes}m`;
	}

	return `${minutes}m ${remainingSeconds}s`;
}

function getTaskDurationMs(toolCalls: ToolCallActivity[], runStartedAt?: number, runEndedAt?: number): number {
	if (toolCalls.length === 0) {
		return 0;
	}

	const startedAt = runStartedAt ?? Math.min(...toolCalls.map((toolCall) => toolCall.startedAt));
	const endedAt =
		runEndedAt ??
		Math.max(...toolCalls.map((toolCall) => toolCall.completedAt ?? toolCall.updatedAt ?? toolCall.startedAt));

	return Math.max(0, endedAt - startedAt);
}

function getTaskSummary(toolCalls: ToolCallActivity[], durationMs: number): string {
	const duration = formatToolTaskDuration(durationMs);
	const hasRunningTool = toolCalls.some((toolCall) => toolCall.status === "running");
	const hasErroredTool = toolCalls.some((toolCall) => toolCall.status === "error");

	if (hasRunningTool) {
		return `正在运行 ${duration}`;
	}

	if (hasErroredTool) {
		return `处理失败 ${duration}`;
	}

	return `已处理 ${duration}`;
}

export function useToolTaskDurationMs(
	toolCalls: ToolCallActivity[],
	isRunActive: boolean,
	runStartedAt?: number,
	runEndedAt?: number,
): number {
	const timestampDurationMs = getTaskDurationMs(toolCalls, runStartedAt, runEndedAt);
	const liveStartedAtRef = useRef<number | undefined>(undefined);
	const frozenDurationMsRef = useRef<number | undefined>(undefined);
	const now = useNowTicker({ enabled: isRunActive, getNow: Date.now, intervalMs: 1000 });

	if (isRunActive && liveStartedAtRef.current === undefined) {
		liveStartedAtRef.current = Date.now() - timestampDurationMs;
		frozenDurationMsRef.current = undefined;
	}

	useEffect(() => {
		if (isRunActive || liveStartedAtRef.current === undefined) {
			return;
		}

		frozenDurationMsRef.current = Math.max(frozenDurationMsRef.current ?? 0, Date.now() - liveStartedAtRef.current);
		liveStartedAtRef.current = undefined;
	}, [isRunActive]);

	if (liveStartedAtRef.current !== undefined) {
		return Math.max(frozenDurationMsRef.current ?? 0, now - liveStartedAtRef.current);
	}

	return frozenDurationMsRef.current ?? timestampDurationMs;
}

function getTaskStatusLabel(status: ToolCallActivity["status"], locale: "en" | "zh"): string | undefined {
	switch (status) {
		case "completed":
			return undefined;
		case "error":
			return locale === "zh" ? "错误" : "Error";
		case "running":
			return locale === "zh" ? "运行中" : "Running";
	}
}

export function sortToolCalls(toolCalls: ToolCallActivity[]): ToolCallActivity[] {
	return [...toolCalls].sort((left, right) => {
		if (left.startedAt !== right.startedAt) {
			return left.startedAt - right.startedAt;
		}

		return left.updatedAt - right.updatedAt;
	});
}

function getToolTaskGroupActionLabel(displayItem: Extract<ToolTaskDisplayItem, { kind: "group" }>): string {
	const totalCount = displayItem.toolCalls.length;
	const failedCount = displayItem.toolCalls.filter((toolCall) => toolCall.status === "error").length;
	const suffix = failedCount > 0 ? `, ${failedCount} failed` : "";

	switch (displayItem.groupKind) {
		case "read-image":
			return `Read ${totalCount} images${suffix}`;
		case "read-file":
			return `Read ${totalCount} files${suffix}`;
		case "search":
			return `Searched ${totalCount} times${suffix}`;
	}
}

function getToolTaskGroupStatus(toolCalls: ToolCallActivity[]): ToolCallActivity["status"] {
	if (toolCalls.some((toolCall) => toolCall.status === "running")) {
		return "running";
	}
	if (toolCalls.some((toolCall) => toolCall.status === "error")) {
		return "error";
	}
	return "completed";
}

function ToolTaskGroupItem({
	autoCollapseIndex,
	displayItem,
	isAutoCollapsing,
	itemSlot,
	statusLocale,
}: {
	autoCollapseIndex: number;
	displayItem: Extract<ToolTaskDisplayItem, { kind: "group" }>;
	isAutoCollapsing: boolean;
	itemSlot: string;
	statusLocale: "en" | "zh";
}) {
	const groupStatus = getToolTaskGroupStatus(displayItem.toolCalls);
	const statusLabel = getTaskStatusLabel(groupStatus, statusLocale);
	const actionLabel = getToolTaskGroupActionLabel(displayItem);

	return (
		<TaskItem
			aria-label={[actionLabel, statusLabel].filter(Boolean).join(" ")}
			className={cn(
				"flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 overflow-x-hidden [overflow-anchor:none]",
				groupStatus === "error" && "text-[color:var(--destructive)]",
			)}
			data-auto-collapse={isAutoCollapsing ? "closing" : undefined}
			data-auto-collapse-index={isAutoCollapsing ? autoCollapseIndex : undefined}
			data-slot={itemSlot}
			style={
				isAutoCollapsing ? ({ "--runtime-tool-collapse-index": autoCollapseIndex } as CSSProperties) : undefined
			}
		>
			<span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">{actionLabel}</span>
			{statusLabel ? <span className="text-muted-foreground text-xs">{statusLabel}</span> : null}
		</TaskItem>
	);
}

function ToolTaskActivityItem({
	autoCollapseIndex,
	isAutoCollapsing,
	itemSlot,
	statusLocale,
	toolCall,
}: {
	autoCollapseIndex: number;
	isAutoCollapsing: boolean;
	itemSlot: string;
	statusLocale: "en" | "zh";
	toolCall: ToolCallActivity;
}) {
	const statusLabel = getTaskStatusLabel(toolCall.status, statusLocale);

	return (
		<TaskItem
			aria-label={[getToolTaskActionLabel(toolCall), statusLabel].filter(Boolean).join(" ")}
			className={cn(
				"flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 overflow-x-hidden [overflow-anchor:none]",
				toolCall.status === "error" && "text-[color:var(--destructive)]",
			)}
			data-auto-collapse={isAutoCollapsing ? "closing" : undefined}
			data-auto-collapse-index={isAutoCollapsing ? autoCollapseIndex : undefined}
			data-slot={itemSlot}
			style={
				isAutoCollapsing ? ({ "--runtime-tool-collapse-index": autoCollapseIndex } as CSSProperties) : undefined
			}
		>
			<span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
				{getToolTaskContent(toolCall)}
			</span>
			{statusLabel ? <span className="text-muted-foreground text-xs">{statusLabel}</span> : null}
		</TaskItem>
	);
}

function ToolTaskDisplayItemView({
	autoCollapseIndex,
	displayItem,
	isAutoCollapsing,
	itemSlot,
	statusLocale,
}: {
	autoCollapseIndex: number;
	displayItem: ToolTaskDisplayItem;
	isAutoCollapsing: boolean;
	itemSlot: string;
	statusLocale: "en" | "zh";
}) {
	if (displayItem.kind === "group") {
		return (
			<ToolTaskGroupItem
				autoCollapseIndex={autoCollapseIndex}
				displayItem={displayItem}
				isAutoCollapsing={isAutoCollapsing}
				itemSlot={itemSlot}
				statusLocale={statusLocale}
			/>
		);
	}

	return (
		<ToolTaskActivityItem
			autoCollapseIndex={autoCollapseIndex}
			isAutoCollapsing={isAutoCollapsing}
			itemSlot={itemSlot}
			statusLocale={statusLocale}
			toolCall={displayItem.toolCall}
		/>
	);
}

export function ToolTaskSummary({
	toolCalls,
	isRunActive = false,
	isExpanded,
	onToggle,
	runEndedAt,
	runStartedAt,
}: ToolTaskSummaryProps) {
	const sortedToolCalls = useMemo(() => sortToolCalls(toolCalls), [toolCalls]);
	const durationMs = useToolTaskDurationMs(sortedToolCalls, isRunActive, runStartedAt, runEndedAt);

	if (sortedToolCalls.length === 0) {
		return null;
	}

	const summary = getTaskSummary(sortedToolCalls, durationMs);

	return (
		<div className="sticky top-0 z-10 flex h-9 items-start gap-2 bg-background/95 py-1 backdrop-blur">
			<Button
				aria-expanded={isExpanded}
				className="h-7 shrink-0 justify-start gap-1 rounded-md px-0 py-0 pr-1 text-sm font-medium text-muted-foreground tabular-nums hover:bg-transparent hover:text-foreground"
				data-slot="tool-rail-summary"
				onClick={onToggle}
				type="button"
				variant="ghost"
			>
				<span className="shrink-0 whitespace-nowrap text-left">{summary}</span>
				<ChevronRight className={cn("size-4 shrink-0 transition-transform", isExpanded && "rotate-90")} />
			</Button>
			<div className="mt-[0.82rem] h-px min-w-0 flex-1 bg-border" data-slot="tool-rail-divider" />
		</div>
	);
}

export function ToolTaskActivity({
	toolCalls,
	className,
	isAutoCollapsing = false,
	isRunActive = false,
	itemSlot = "tool-task-item",
	preserveOrder = false,
	showInitialItemsImmediately = false,
	statusLocale = "zh",
}: ToolTaskActivityProps) {
	const activityListRef = useRef<HTMLDivElement | null>(null);
	const shouldFollowActivityRef = useRef(true);
	const sortedToolCalls = useMemo(
		() => (preserveOrder ? [...toolCalls] : sortToolCalls(toolCalls)),
		[preserveOrder, toolCalls],
	);
	const displayItems = useMemo(() => getToolTaskDisplayItems(sortedToolCalls), [sortedToolCalls]);
	const streamedDisplayItems = useStreamingPresentationFrame(displayItems, isRunActive);
	const presentedDisplayItems =
		showInitialItemsImmediately && isRunActive && streamedDisplayItems.length === 0 && displayItems.length > 0
			? displayItems
			: streamedDisplayItems;

	useEffect(() => {
		const activityList = activityListRef.current;
		if (!activityList || !shouldFollowActivityRef.current) {
			return;
		}

		activityList.scrollTop = activityList.scrollHeight;
	});

	if (presentedDisplayItems.length === 0) {
		return null;
	}

	function handleActivityScroll(event: UIEvent<HTMLDivElement>): void {
		const activityList = event.currentTarget;
		shouldFollowActivityRef.current =
			activityList.scrollHeight - activityList.clientHeight - activityList.scrollTop <= 48;
	}

	return (
		<VirtualStack
			ariaLabel="Tool activity"
			className={cn(
				"native-scrollbar max-h-[min(48vh,32rem)] overflow-y-auto overscroll-contain [overflow-anchor:none]",
				className,
			)}
			dataSlot="tool-task-activity-virtual-list"
			estimateSize={() => 78}
			gap={8}
			getKey={(displayItem) => displayItem.key}
			initialViewportHeight={384}
			itemClassName="grid gap-2 pr-1"
			items={presentedDisplayItems}
			measureItems
			onScroll={handleActivityScroll}
			overscan={5}
			paddingEnd={4}
			renderItem={({ index, item }) => (
				<ToolTaskDisplayItemView
					autoCollapseIndex={index}
					displayItem={item}
					isAutoCollapsing={isAutoCollapsing}
					itemSlot={itemSlot}
					statusLocale={statusLocale}
				/>
			)}
			viewportRef={activityListRef}
		/>
	);
}
