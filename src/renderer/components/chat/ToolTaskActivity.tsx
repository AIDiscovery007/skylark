import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, UIEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusDot, type StatusDotStatus } from "@/components/ui/status-dot";
import { subtleReveal } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ToolCallActivity } from "../../lib/conversation-timeline-projection.ts";
import { activityDrawerTransition } from "../../lib/motion.ts";
import { ChainOfThoughtImage } from "../ai-elements/chain-of-thought.tsx";
import { TaskItem, TaskItemFile } from "../ai-elements/task.tsx";
import { ToolActivityDetails } from "./ToolCallCard.tsx";

const ACTIVITY_DRAWER_ANIMATION_MS = 400;

export interface ToolTaskImagePreview {
	alt: string;
	src: string;
	title?: string;
}

interface ToolResultImage {
	alt: string;
	caption?: string;
	src: string;
}

export interface ToolTaskActivityProps {
	toolCalls: ToolCallActivity[];
	expandedToolCallIds: ReadonlySet<string>;
	onToggleToolCall: (toolCallId: string) => void;
	className?: string;
	detailsMode?: "animated" | "static";
	detailsSlot?: string;
	detailsSpacerSlot?: string;
	isAutoCollapsing?: boolean;
	itemSlot?: string;
	onBeforeToolToggle?: () => void;
	onOpenSubagentToolCall?: (toolCall: ToolCallActivity) => void;
	onPreviewImage?: (image: ToolTaskImagePreview) => void;
	preserveOrder?: boolean;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

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

function getPathBasename(value: string): string {
	const normalized = value.replace(/\\/g, "/");
	const lastSegment = normalized.split("/").filter(Boolean).pop();
	return lastSegment ?? value;
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

function getRipgrepActivityLabel(command: string): string | undefined {
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

	const target = positionalArgs[1];
	return target ? `Searched for ${pattern} in ${getPathLabel(target)}` : `Searched for ${pattern}`;
}

function getSubagentSummary(toolCall: ToolCallActivity): string | undefined {
	return getStringProperty(toolCall.args, ["title"]) ?? getStringProperty(toolCall.args, ["task"]);
}

export function getToolTaskActionLabel(toolCall: ToolCallActivity): string {
	const path = getToolArgsPath(toolCall.args);
	const command = getToolArgsCommand(toolCall.args);

	if (toolCall.toolName.startsWith("mcp__")) {
		const [serverId, ...toolNameParts] = toolCall.toolName.slice("mcp__".length).split("__");
		const toolName = toolNameParts.join("__");
		return serverId && toolName ? `Used ${serverId} / ${toolName}` : `Used ${toolCall.toolName}`;
	}

	switch (toolCall.toolName) {
		case "read":
			return path ? `Read ${getPathLabel(path)}` : "Read file";
		case "bash":
			return command ? (getRipgrepActivityLabel(command) ?? "Ran command") : "Ran command";
		case "edit":
			return path ? `Edited ${getPathLabel(path)}` : "Edited file";
		case "write":
			return path ? `Wrote ${getPathLabel(path)}` : "Wrote file";
		case "subagent":
			return truncateInline(getSubagentSummary(toolCall) ?? "Run subagent", 96);
		default:
			return `Used ${toolCall.toolName}`;
	}
}

function getToolTaskDetailLabel(toolCall: ToolCallActivity): string {
	const command = getToolArgsCommand(toolCall.args);
	if (command) {
		return truncateInline(command, 96);
	}

	const path = getToolArgsPath(toolCall.args);
	if (path) {
		return truncateInline(path, 96);
	}

	const subagentSummary = getSubagentSummary(toolCall);
	if (subagentSummary) {
		return truncateInline(subagentSummary, 96);
	}

	if (toolCall.toolName.startsWith("mcp__")) {
		return toolCall.toolName.replace(/^mcp__/, "").replace(/__/g, " / ");
	}

	return toolCall.toolName;
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
	const [now, setNow] = useState(() => Date.now());

	if (isRunActive && liveStartedAtRef.current === undefined) {
		liveStartedAtRef.current = Date.now() - timestampDurationMs;
		frozenDurationMsRef.current = undefined;
	}

	useEffect(() => {
		if (!isRunActive) {
			return;
		}

		setNow(Date.now());
		const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(intervalId);
	}, [isRunActive]);

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

function getRowStatusLabel(status: ToolCallActivity["status"], locale: "en" | "zh"): string {
	if (locale === "zh") {
		switch (status) {
			case "completed":
				return "完成";
			case "error":
				return "错误";
			case "running":
				return "运行中";
		}
	}

	switch (status) {
		case "completed":
			return "Completed";
		case "error":
			return "Error";
		case "running":
			return "Running";
	}
}

function getStatusDotStatus(status: ToolCallActivity["status"]): StatusDotStatus {
	switch (status) {
		case "completed":
			return "success";
		case "error":
			return "error";
		case "running":
			return "running";
	}
}

function getToolResultContent(value: unknown): unknown[] {
	if (!isRecord(value) || !Array.isArray(value.content)) {
		return [];
	}

	return value.content;
}

function getImageMimeType(record: Record<string, unknown>): string | undefined {
	return getStringProperty(record, ["mimeType", "mime_type", "mediaType", "media_type"]);
}

function getDataUrlImageSource(record: Record<string, unknown>): string | undefined {
	const source = getStringProperty(record, ["image", "url"]);
	return source?.startsWith("data:image/") ? source : undefined;
}

function getBase64ImageSource(record: Record<string, unknown>): string | undefined {
	const mimeType = getImageMimeType(record);
	if (!mimeType?.toLowerCase().startsWith("image/")) {
		return undefined;
	}

	const data = getStringProperty(record, ["data", "base64"]);
	return data ? `data:${mimeType};base64,${data}` : undefined;
}

function getToolResultImage(record: unknown, fallbackName: string | undefined): ToolResultImage | undefined {
	if (!isRecord(record)) {
		return undefined;
	}

	const source = getDataUrlImageSource(record) ?? getBase64ImageSource(record);
	if (!source) {
		return undefined;
	}

	const caption = getStringProperty(record, ["caption", "name", "filename", "fileName"]) ?? fallbackName;
	return {
		alt: caption ?? "Tool result image",
		caption,
		src: source,
	};
}

function getToolResultImages(toolCall: ToolCallActivity): ToolResultImage[] {
	const fallbackPath = getStringProperty(toolCall.args, ["path", "filePath", "file_path"]);
	const fallbackName = fallbackPath ? getPathBasename(fallbackPath) : undefined;
	const resultImages = getToolResultContent(toolCall.result)
		.map((part) => getToolResultImage(part, fallbackName))
		.filter((image): image is ToolResultImage => image !== undefined);

	if (resultImages.length > 0) {
		return resultImages;
	}

	return getToolResultContent(toolCall.partialResult)
		.map((part) => getToolResultImage(part, fallbackName))
		.filter((image): image is ToolResultImage => image !== undefined);
}

function getElementVisualHeight(element: HTMLElement | null): number {
	if (!element) {
		return 0;
	}

	const rectHeight = element.getBoundingClientRect().height;
	const styles = window.getComputedStyle(element);
	const marginTop = Number.parseFloat(styles.marginTop);
	const marginBottom = Number.parseFloat(styles.marginBottom);
	const marginHeight =
		(Number.isFinite(marginTop) ? marginTop : 0) + (Number.isFinite(marginBottom) ? marginBottom : 0);
	const measuredHeight =
		(rectHeight || element.offsetHeight || element.clientHeight || element.scrollHeight) + marginHeight;
	return Number.isFinite(measuredHeight) ? Math.max(0, Math.ceil(measuredHeight)) : 0;
}

export function sortToolCalls(toolCalls: ToolCallActivity[]): ToolCallActivity[] {
	return [...toolCalls].sort((left, right) => {
		if (left.startedAt !== right.startedAt) {
			return left.startedAt - right.startedAt;
		}

		return left.updatedAt - right.updatedAt;
	});
}

function ToolTaskImages({
	images,
	onPreviewImage,
}: {
	images: ToolResultImage[];
	onPreviewImage?: (image: ToolTaskImagePreview) => void;
}) {
	if (images.length === 0) {
		return null;
	}

	return (
		<div className="grid max-w-full gap-2" data-slot="assistant-tool-call-cot-images">
			{images.map((image, index) => (
				<ChainOfThoughtImage
					caption={image.caption}
					className="max-w-[min(100%,20rem)]"
					data-slot="assistant-tool-call-cot-image"
					key={`${image.src.slice(0, 96)}-${index}`}
					title={image.caption}
				>
					<button
						aria-label={`Open image preview for ${image.alt}`}
						className="block max-w-full cursor-zoom-in rounded-[calc(var(--radius-md)-2px)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
						onClick={() => onPreviewImage?.({ alt: image.alt, src: image.src, title: image.caption })}
						type="button"
					>
						<img
							alt={image.alt}
							className="max-h-56 max-w-full rounded-[calc(var(--radius-md)-2px)] object-contain"
							src={image.src}
						/>
					</button>
				</ChainOfThoughtImage>
			))}
		</div>
	);
}

function ToolTaskDetails({
	detailsMode,
	detailsSlot,
	detailsSpacerSlot,
	isOpen,
	toolCall,
}: {
	detailsMode: "animated" | "static";
	detailsSlot: string;
	detailsSpacerSlot: string;
	isOpen: boolean;
	toolCall: ToolCallActivity;
}) {
	const [shouldRenderDetails, setShouldRenderDetails] = useState(isOpen);
	const [isDrawerOpen, setIsDrawerOpen] = useState(isOpen);
	const [drawerHeight, setDrawerHeight] = useState(0);
	const detailsRef = useRef<HTMLDivElement | null>(null);
	const drawerMotionPhase = isOpen ? (isDrawerOpen ? "open" : "opening") : "closed";

	useLayoutEffect(() => {
		if (detailsMode !== "animated") {
			return undefined;
		}

		if (isOpen) {
			setShouldRenderDetails(true);
			setIsDrawerOpen(false);
			setDrawerHeight(0);
			const animationFrameId = window.requestAnimationFrame(() => {
				setDrawerHeight(getElementVisualHeight(detailsRef.current));
				setIsDrawerOpen(true);
			});
			return () => window.cancelAnimationFrame(animationFrameId);
		}

		setIsDrawerOpen(false);
		return undefined;
	}, [detailsMode, isOpen]);

	useLayoutEffect(() => {
		if (detailsMode !== "animated" || !isOpen || !shouldRenderDetails) {
			return undefined;
		}

		const updateDrawerHeight = (): void => {
			setDrawerHeight(getElementVisualHeight(detailsRef.current));
		};

		updateDrawerHeight();
		const detailsElement = detailsRef.current;
		if (!detailsElement || typeof ResizeObserver === "undefined") {
			return undefined;
		}

		const resizeObserver = new ResizeObserver(updateDrawerHeight);
		resizeObserver.observe(detailsElement);
		return () => resizeObserver.disconnect();
	}, [detailsMode, isOpen, shouldRenderDetails]);

	useEffect(() => {
		if (detailsMode !== "animated" || isOpen || !shouldRenderDetails) {
			return;
		}

		const timeoutId = window.setTimeout(() => {
			setShouldRenderDetails(false);
		}, ACTIVITY_DRAWER_ANIMATION_MS);
		return () => window.clearTimeout(timeoutId);
	}, [detailsMode, isOpen, shouldRenderDetails]);

	if (detailsMode === "static") {
		if (!isOpen) {
			return null;
		}
		return (
			<div className="overflow-hidden [overflow-anchor:none]" data-slot="tool-activity-row-details">
				<div className="ml-4 overflow-hidden rounded-lg border border-border/70 bg-[color:var(--surface-1)] px-3 py-3 shadow-none">
					<ToolActivityDetails toolCall={toolCall} />
				</div>
			</div>
		);
	}

	return (
		<motion.div
			animate={{ height: isDrawerOpen ? drawerHeight : 0 }}
			className="overflow-hidden"
			data-motion="structural-drawer"
			data-motion-engine="motion"
			data-motion-mode="drawer"
			data-motion-origin="top"
			data-motion-owner="spacer"
			data-motion-phase={drawerMotionPhase}
			data-motion-scope="structural"
			data-motion-target-height={isOpen ? drawerHeight : 0}
			data-slot={detailsSpacerSlot}
			data-state={isOpen ? "open" : "closed"}
			data-structural-layout-driver="height"
			initial={false}
			transition={activityDrawerTransition}
		>
			{shouldRenderDetails ? (
				<div
					aria-hidden={!isOpen}
					className="mt-1 block min-w-0 max-w-full overflow-x-hidden px-2 pb-1 [overflow-anchor:none]"
					data-layout="timeline-flow"
					data-motion="structural-drawer"
					data-motion-engine="motion"
					data-motion-mode="drawer"
					data-motion-origin="top"
					data-motion-owner="fixed-content"
					data-motion-scope="structural"
					data-slot={detailsSlot}
					ref={detailsRef}
				>
					<ToolActivityDetails toolCall={toolCall} />
				</div>
			) : null}
		</motion.div>
	);
}

function ToolTaskActivityItem({
	autoCollapseIndex,
	detailsMode,
	detailsSlot,
	detailsSpacerSlot,
	isAutoCollapsing,
	isOpen,
	itemSlot,
	onBeforeToolToggle,
	onOpenSubagentToolCall,
	onPreviewImage,
	onToggleToolCall,
	statusLocale,
	toolCall,
}: {
	autoCollapseIndex: number;
	detailsMode: "animated" | "static";
	detailsSlot: string;
	detailsSpacerSlot: string;
	isAutoCollapsing: boolean;
	isOpen: boolean;
	itemSlot: string;
	onBeforeToolToggle?: () => void;
	onOpenSubagentToolCall?: (toolCall: ToolCallActivity) => void;
	onPreviewImage?: (image: ToolTaskImagePreview) => void;
	onToggleToolCall: (toolCallId: string) => void;
	statusLocale: "en" | "zh";
	toolCall: ToolCallActivity;
}) {
	const actionLabel = getToolTaskActionLabel(toolCall);
	const detailLabel = getToolTaskDetailLabel(toolCall);
	const visibleDetailLabel = detailLabel === actionLabel ? undefined : detailLabel;
	const statusLabel = getRowStatusLabel(toolCall.status, statusLocale);
	const images = getToolResultImages(toolCall);

	function handleToolCallToggle(): void {
		onBeforeToolToggle?.();
		if (toolCall.toolName === "subagent" && onOpenSubagentToolCall) {
			onOpenSubagentToolCall(toolCall);
			return;
		}
		onToggleToolCall(toolCall.toolCallId);
	}

	return (
		<TaskItem
			className={cn("grid min-w-0 max-w-full gap-2 overflow-x-hidden [overflow-anchor:none]")}
			data-auto-collapse={isAutoCollapsing ? "closing" : undefined}
			data-auto-collapse-index={isAutoCollapsing ? autoCollapseIndex : undefined}
			data-slot={itemSlot}
			style={
				isAutoCollapsing ? ({ "--runtime-tool-collapse-index": autoCollapseIndex } as CSSProperties) : undefined
			}
		>
			<Button
				aria-expanded={isOpen}
				aria-label={[actionLabel, toolCall.toolName, visibleDetailLabel, statusLabel]
					.filter((label): label is string => label !== undefined)
					.join(" ")}
				className={cn(
					"group/tool-row h-auto w-full justify-start gap-0 rounded-lg px-1.5 py-1.5 text-left transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-muted/35 hover:text-foreground",
					isOpen && "bg-muted/30 text-foreground",
				)}
				onClick={handleToolCallToggle}
				type="button"
				variant="ghost"
			>
				<span className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2">
					<StatusDot className="size-2" label={statusLabel} status={getStatusDotStatus(toolCall.status)} />
					<span className="grid min-w-0 gap-0.5">
						<span className="min-w-0 truncate text-sm text-[color:var(--color-workbench-ink)] transition-colors duration-150 group-hover/tool-row:text-foreground">
							{actionLabel}
						</span>
						{visibleDetailLabel ? (
							<span className="min-w-0 truncate text-muted-foreground text-xs transition-colors duration-150 group-hover/tool-row:text-foreground">
								{visibleDetailLabel}
							</span>
						) : null}
					</span>
					<TaskItemFile className="max-w-28 truncate font-mono text-[11px]">{toolCall.toolName}</TaskItemFile>
					<span className="shrink-0 text-right text-[13px] text-muted-foreground transition-colors duration-150 group-hover/tool-row:text-foreground">
						{statusLabel}
					</span>
					<ChevronRight
						className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")}
						data-slot="assistant-tool-call-chevron"
					/>
				</span>
			</Button>
			<ToolTaskImages images={images} onPreviewImage={onPreviewImage} />
			<ToolTaskDetails
				detailsMode={detailsMode}
				detailsSlot={detailsSlot}
				detailsSpacerSlot={detailsSpacerSlot}
				isOpen={isOpen}
				toolCall={toolCall}
			/>
		</TaskItem>
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
	expandedToolCallIds,
	onToggleToolCall,
	className,
	detailsMode = "static",
	detailsSlot = "tool-activity-row-details",
	detailsSpacerSlot = "tool-activity-row-details-spacer",
	isAutoCollapsing = false,
	itemSlot = "tool-task-item",
	onBeforeToolToggle,
	onOpenSubagentToolCall,
	onPreviewImage,
	preserveOrder = false,
	statusLocale = "zh",
}: ToolTaskActivityProps) {
	const activityListRef = useRef<HTMLUListElement | null>(null);
	const shouldFollowActivityRef = useRef(true);
	const sortedToolCalls = useMemo(
		() => (preserveOrder ? [...toolCalls] : sortToolCalls(toolCalls)),
		[preserveOrder, toolCalls],
	);

	useEffect(() => {
		const activityList = activityListRef.current;
		if (!activityList || !shouldFollowActivityRef.current) {
			return;
		}

		activityList.scrollTop = activityList.scrollHeight;
	});

	if (sortedToolCalls.length === 0) {
		return null;
	}

	function handleActivityScroll(event: UIEvent<HTMLUListElement>): void {
		const activityList = event.currentTarget;
		shouldFollowActivityRef.current =
			activityList.scrollHeight - activityList.clientHeight - activityList.scrollTop <= 48;
	}

	return (
		<ul
			aria-label="Tool activity"
			className={cn(
				"native-scrollbar grid max-h-[min(48vh,32rem)] list-none gap-1.5 overflow-y-auto overscroll-contain pr-1 [overflow-anchor:none]",
				className,
			)}
			onScroll={handleActivityScroll}
			ref={activityListRef}
		>
			<AnimatePresence initial={false}>
				{sortedToolCalls.map((toolCall, index) => (
					<motion.li className="grid gap-2" key={toolCall.toolCallId} {...subtleReveal}>
						<ToolTaskActivityItem
							autoCollapseIndex={index}
							detailsMode={detailsMode}
							detailsSlot={detailsSlot}
							detailsSpacerSlot={detailsSpacerSlot}
							isAutoCollapsing={isAutoCollapsing}
							isOpen={expandedToolCallIds.has(toolCall.toolCallId)}
							itemSlot={itemSlot}
							onBeforeToolToggle={onBeforeToolToggle}
							onOpenSubagentToolCall={onOpenSubagentToolCall}
							onPreviewImage={onPreviewImage}
							onToggleToolCall={onToggleToolCall}
							statusLocale={statusLocale}
							toolCall={toolCall}
						/>
					</motion.li>
				))}
			</AnimatePresence>
		</ul>
	);
}

export type ToolTaskActivityComponent = typeof ToolTaskActivity;
