import { ChevronRight } from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	DESKTOP_RUN_ACTIVITY_METADATA_KEY,
	type DesktopRunActivityMetadata,
	type DesktopThreadContentPart,
	type DesktopThreadMessageStatus,
	type DesktopToolCallArtifact,
} from "../../lib/assistant-runtime-adapter.ts";
import type { ToolCallActivity } from "../../lib/conversation-timeline-projection.ts";
import { activityDrawerTransition } from "../../lib/motion.ts";
import { cn } from "../../lib/utils.ts";
import { ChainOfThought, ChainOfThoughtHeader, ChainOfThoughtStep } from "../ai-elements/chain-of-thought.tsx";
import { getToolActivitySections, ToolActivityDetails } from "./ToolCallCard.tsx";

const ACTIVITY_DRAWER_ANIMATION_MS = 400;
const FINAL_ANSWER_DOMINANT_VIEWPORT_RATIO = 0.4;
const TOOL_AUTO_COLLAPSE_ANIMATION_MS = 160;
const TOOL_AUTO_COLLAPSE_STAGGER_MS = 28;
const MIN_REASONABLE_EPOCH_MS = 946_684_800_000;
const COMPLETED_ACTIVITY_TITLE = "Agent activity";
const COMPLETED_ACTIVITY_STATUS_LABEL = "Completed";
const RUNNING_ACTIVITY_TITLE = "Working";
const RUNNING_ACTIVITY_STATUS_LABEL = "Running";

type ActivityPushDirection = "down" | "up";
type AgentChainOfThoughtPart = Extract<DesktopThreadContentPart, { type: "reasoning" | "tool-call" }>;
type AgentReasoningChainOfThoughtPart = Extract<AgentChainOfThoughtPart, { type: "reasoning" }>;
type AgentToolCallChainOfThoughtPart = Extract<AgentChainOfThoughtPart, { type: "tool-call" }>;
type AgentActivityStatus = { type: "complete" | "incomplete" | "requires-action" | "running" };

interface PendingPushCompensation {
	direction: ActivityPushDirection;
	open: boolean;
}

function parseCssPixels(value: string): number {
	const parsedValue = Number.parseFloat(value);
	return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function getElementVisualHeight(element: HTMLElement | null): number {
	if (!element) {
		return 0;
	}

	const rectHeight = element.getBoundingClientRect().height;
	const styles = window.getComputedStyle(element);
	const marginHeight = parseCssPixels(styles.marginTop) + parseCssPixels(styles.marginBottom);
	const measuredHeight =
		(rectHeight || element.offsetHeight || element.clientHeight || element.scrollHeight) + marginHeight;
	return Number.isFinite(measuredHeight) ? Math.max(0, Math.ceil(measuredHeight)) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getNumberProperty(value: unknown, key: string): number | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const property = value[key];
	return typeof property === "number" && Number.isFinite(property) ? property : undefined;
}

function getActivityViewport(activityElement: HTMLElement | null): HTMLDivElement | undefined {
	const viewport = activityElement?.closest("[data-slot='assistant-thread-viewport']");
	return viewport instanceof HTMLDivElement ? viewport : undefined;
}

function getVisibleHeightInViewport(element: HTMLElement, viewport: HTMLDivElement): number {
	const elementRect = element.getBoundingClientRect();
	const viewportRect = viewport.getBoundingClientRect();
	const viewportHeight = viewportRect.height || viewport.clientHeight;
	if (viewportHeight <= 0 || elementRect.height <= 0) {
		return 0;
	}

	const viewportTop = viewportRect.height > 0 ? viewportRect.top : 0;
	const viewportBottom = viewportRect.height > 0 ? viewportRect.bottom : viewportTop + viewportHeight;
	return Math.max(0, Math.min(elementRect.bottom, viewportBottom) - Math.max(elementRect.top, viewportTop));
}

function getFollowingFinalAnswer(activityElement: HTMLElement): HTMLElement | undefined {
	const messageElement = activityElement.closest("[data-slot='assistant-message']");
	if (!messageElement) {
		return undefined;
	}

	const markdownElements = Array.from(
		messageElement.querySelectorAll<HTMLElement>("[data-slot='assistant-markdown-content']"),
	);
	return markdownElements.find(
		(markdownElement) =>
			(activityElement.compareDocumentPosition(markdownElement) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
	);
}

function resolveActivityPushDirection(activityElement: HTMLElement | null): ActivityPushDirection {
	if (!activityElement) {
		return "down";
	}

	const viewport = getActivityViewport(activityElement);
	const finalAnswer = getFollowingFinalAnswer(activityElement);
	if (!viewport || !finalAnswer) {
		return "down";
	}

	const viewportRect = viewport.getBoundingClientRect();
	const viewportHeight = viewportRect.height || viewport.clientHeight;
	if (viewportHeight <= 0) {
		return "down";
	}

	const finalAnswerVisibleHeight = getVisibleHeightInViewport(finalAnswer, viewport);
	return finalAnswerVisibleHeight >= viewportHeight * FINAL_ANSWER_DOMINANT_VIEWPORT_RATIO ? "up" : "down";
}

function scrollViewportTo(viewport: HTMLDivElement, top: number): void {
	if (typeof viewport.scrollTo === "function") {
		try {
			viewport.scrollTo({ behavior: "smooth", top });
			return;
		} catch {
			// jsdom exposes scrollTo without implementing it.
		}
	}
	viewport.scrollTop = top;
}

function getActivityDrawerHeight(contentSpacer: HTMLDivElement | null): number {
	if (!contentSpacer) {
		return 0;
	}

	const measuredHeight = contentSpacer.scrollHeight || contentSpacer.getBoundingClientRect().height;
	return Number.isFinite(measuredHeight) ? Math.max(0, measuredHeight) : 0;
}

function compensateActivityPush({
	activityElement,
	contentSpacer,
	pendingPush,
}: {
	activityElement: HTMLElement | null;
	contentSpacer: HTMLDivElement | null;
	pendingPush: PendingPushCompensation;
}): void {
	if (pendingPush.direction !== "up") {
		return;
	}

	const viewport = getActivityViewport(activityElement);
	if (!viewport) {
		return;
	}

	const drawerHeight = getActivityDrawerHeight(contentSpacer);
	if (drawerHeight <= 0) {
		return;
	}

	const scrollDelta = pendingPush.open ? drawerHeight : -drawerHeight;
	scrollViewportTo(viewport, Math.max(0, viewport.scrollTop + scrollDelta));
}

function getRunActivityMetadata(value: unknown): DesktopRunActivityMetadata | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const metadata = value[DESKTOP_RUN_ACTIVITY_METADATA_KEY];
	if (!isRecord(metadata)) {
		return undefined;
	}

	const startedAt = getNumberProperty(metadata, "startedAt");
	const toolCount = getNumberProperty(metadata, "toolCount");
	if (startedAt === undefined || toolCount === undefined) {
		return undefined;
	}

	return {
		runId: typeof metadata.runId === "string" ? metadata.runId : `assistant-run-${startedAt}-${toolCount}`,
		startedAt,
		endedAt: getNumberProperty(metadata, "endedAt"),
		toolCount,
		hasReasoning: metadata.hasReasoning === true,
		...(metadata.phase === "waiting_for_response" ? { phase: "waiting_for_response" as const } : {}),
	};
}

function getToolCallArtifact(value: unknown): ToolCallActivity | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const artifact = value as Partial<DesktopToolCallArtifact>;
	const toolCall = artifact.desktopToolCall;
	if (!isRecord(toolCall)) {
		return undefined;
	}

	if (
		typeof toolCall.toolCallId === "string" &&
		typeof toolCall.toolName === "string" &&
		(toolCall.status === "running" || toolCall.status === "completed" || toolCall.status === "error")
	) {
		return toolCall as ToolCallActivity;
	}

	return undefined;
}

function resolveToolCallStatus(status: AgentActivityStatus, isError?: boolean): ToolCallActivity["status"] {
	if (status.type === "running" || status.type === "requires-action") {
		return "running";
	}
	if (isError || status.type === "incomplete") {
		return "error";
	}
	return "completed";
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

function truncateInline(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

function getCommandSummary(command: string): string {
	const trimmedCommand = command.trim();
	const findTarget = trimmedCommand.match(/(?:^|[;&|]\s*)find\s+([^\s;&|]+)/);
	if (findTarget?.[1]) {
		return `find ${findTarget[1]}`;
	}

	const firstCommand = trimmedCommand.split(/[;&|\n]/)[0]?.trim() ?? trimmedCommand;
	const tokens = firstCommand.match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+/g) ?? [];
	const executable = tokens[0]?.replace(/^["']|["']$/g, "");
	if (!executable) {
		return truncateInline(trimmedCommand, 72);
	}

	if (executable === "python3" || executable === "python") {
		return executable;
	}

	const target = tokens
		.slice(1)
		.map((token) => token.replace(/^["']|["']$/g, ""))
		.find((token) => token.length > 0 && !token.startsWith("-") && token !== "<<'PY'" && token !== '<<"PY"');

	return truncateInline(target ? `${executable} ${target}` : executable, 72);
}

function getToolSummary(toolCall: ToolCallActivity): string {
	if (toolCall.toolName.startsWith("mcp__")) {
		const [serverId, ...toolNameParts] = toolCall.toolName.slice("mcp__".length).split("__");
		const toolName = toolNameParts.join("__");
		if (serverId && toolName) {
			return truncateInline(`${serverId} / ${toolName}`, 96);
		}
	}

	if (toolCall.toolName === "subagent") {
		const title = getStringProperty(toolCall.args, ["title"]);
		const task = getStringProperty(toolCall.args, ["task"]);
		return truncateInline(title ?? task ?? "Subagent task", 96);
	}

	const path = getStringProperty(toolCall.args, ["path", "filePath", "file_path"]);
	if (path) {
		return truncateInline(path, 96);
	}

	const command = getStringProperty(toolCall.args, ["command"]);
	if (command) {
		return getCommandSummary(command);
	}

	const sections = getToolActivitySections(toolCall);
	const preferredSection = sections.find((section) => section.label === "Change Set") ?? sections[0];
	return preferredSection ? truncateInline(preferredSection.value.split("\n")[0] ?? "", 96) : toolCall.toolName;
}

function getToolStatusLabel(status: ToolCallActivity["status"]): string {
	switch (status) {
		case "completed":
			return "Completed";
		case "error":
			return "Error";
		case "running":
			return "Running";
	}
}

function getStepStatus(status: AgentActivityStatus): "active" | "complete" {
	return status.type === "running" || status.type === "requires-action" ? "active" : "complete";
}

function AgentReasoningPart({ part, status }: { part: AgentReasoningChainOfThoughtPart; status: AgentActivityStatus }) {
	return (
		<ChainOfThoughtStep
			className="min-w-0 max-w-full overflow-hidden text-[13px] leading-6"
			data-slot="assistant-reasoning-part"
			label={<span className="whitespace-pre-wrap break-words">{part.text}</span>}
			status={getStepStatus(status)}
		>
			{null}
		</ChainOfThoughtStep>
	);
}

function AgentToolCall({
	autoCollapseIndex,
	isAutoCollapsing,
	onBeforeToggle,
	onOpenSubagentToolCall,
	part,
	status,
}: {
	autoCollapseIndex: number;
	isAutoCollapsing: boolean;
	onBeforeToggle: () => void;
	onOpenSubagentToolCall?: (toolCall: ToolCallActivity) => void;
	part: AgentToolCallChainOfThoughtPart;
	status: AgentActivityStatus;
}) {
	const fallbackToolCallId = part.toolCallId ?? `${part.toolName}-${autoCollapseIndex}`;
	const toolCall =
		getToolCallArtifact(part.artifact) ??
		({
			toolCallId: fallbackToolCallId,
			toolName: part.toolName,
			args: part.args,
			status: resolveToolCallStatus(status, part.isError),
			startedAt: 0,
			updatedAt: 0,
			result: part.result,
		} satisfies ToolCallActivity);
	const statusLabel = getToolStatusLabel(toolCall.status);
	const toolSummary = getToolSummary(toolCall);
	const [isOpen, setIsOpen] = useState(false);
	const [shouldRenderDetails, setShouldRenderDetails] = useState(isOpen);
	const [isDrawerOpen, setIsDrawerOpen] = useState(isOpen);
	const [drawerHeight, setDrawerHeight] = useState(0);
	const detailsRef = useRef<HTMLDivElement | null>(null);
	const drawerMotionPhase = isOpen ? (isDrawerOpen ? "open" : "opening") : "closed";

	function handleToolCallToggle(): void {
		onBeforeToggle();
		if (toolCall.toolName === "subagent" && onOpenSubagentToolCall) {
			onOpenSubagentToolCall(toolCall);
			return;
		}
		setIsOpen((current) => !current);
	}

	useLayoutEffect(() => {
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
	}, [isOpen]);

	useLayoutEffect(() => {
		if (!isOpen || !shouldRenderDetails) {
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
	}, [isOpen, shouldRenderDetails]);

	useEffect(() => {
		if (isOpen) {
			return;
		}

		if (!shouldRenderDetails) {
			return;
		}

		const timeoutId = window.setTimeout(() => {
			setShouldRenderDetails(false);
		}, ACTIVITY_DRAWER_ANIMATION_MS);
		return () => window.clearTimeout(timeoutId);
	}, [isOpen, shouldRenderDetails]);

	return (
		<div className="min-w-0 max-w-full overflow-x-hidden [overflow-anchor:none]">
			<ChainOfThoughtStep
				className={cn("min-w-0 max-w-full", isAutoCollapsing && "runtime-tool-call-auto-collapse")}
				data-auto-collapse={isAutoCollapsing ? "closing" : undefined}
				data-auto-collapse-index={isAutoCollapsing ? autoCollapseIndex : undefined}
				data-slot="assistant-tool-call-step"
				style={
					isAutoCollapsing ? ({ "--runtime-tool-collapse-index": autoCollapseIndex } as CSSProperties) : undefined
				}
				label={
					<button
						aria-expanded={isOpen}
						aria-label={`${toolCall.toolName} ${toolSummary} ${statusLabel}`}
						className="flex w-full min-w-0 items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
						onClick={handleToolCallToggle}
						type="button"
					>
						<span className="min-w-0">
							<span className="flex min-w-0 items-baseline gap-2">
								<span className="truncate font-medium">{toolCall.toolName}</span>
								<span className="truncate text-muted-foreground">{toolSummary}</span>
							</span>
						</span>
						<span className="flex shrink-0 items-center gap-2 text-muted-foreground">
							<ChevronRight
								className={cn("size-4 transition-transform", isOpen && "rotate-90")}
								data-slot="assistant-tool-call-chevron"
							/>
						</span>
					</button>
				}
				status={toolCall.status === "running" ? "active" : "complete"}
			>
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
					data-slot="assistant-tool-call-details-spacer"
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
							data-slot="assistant-tool-call-details"
							ref={detailsRef}
						>
							<ToolActivityDetails toolCall={toolCall} />
						</div>
					) : null}
				</motion.div>
			</ChainOfThoughtStep>
		</div>
	);
}

function isActivityPartRunning(part: AgentChainOfThoughtPart, status: AgentActivityStatus): boolean {
	const toolCall = part.type === "tool-call" ? getToolCallArtifact(part.artifact) : undefined;
	return toolCall?.status === "running" || status.type === "running" || status.type === "requires-action";
}

function formatActivityDuration(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);

	if (hours > 0) {
		return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	}

	if (minutes > 0) {
		return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
	}

	return `${seconds}s`;
}

function getActivityDurationMs({ metadata }: { metadata?: DesktopRunActivityMetadata }): number {
	if (!metadata) {
		return 0;
	}

	const endedAt = metadata.endedAt ?? metadata.startedAt;
	return Math.max(0, endedAt - metadata.startedAt);
}

function getReasonableTimestamp(timestamp?: number): number | undefined {
	return timestamp !== undefined && timestamp >= MIN_REASONABLE_EPOCH_MS ? timestamp : undefined;
}

function getRunActivityDurationMs({
	activeStartedAt,
	isRunning,
	metadata,
	now,
}: {
	activeStartedAt: number;
	isRunning: boolean;
	metadata?: DesktopRunActivityMetadata;
	now: number;
}): number {
	if (isRunning) {
		return Math.max(0, now - activeStartedAt);
	}

	return getActivityDurationMs({ metadata });
}

function getActivityLabels(isRunning: boolean, phase?: DesktopRunActivityMetadata["phase"]) {
	if (isRunning && phase === "waiting_for_response") {
		return {
			title: "Waiting for response",
			statusLabel: "Responding",
		};
	}

	return {
		title: isRunning ? RUNNING_ACTIVITY_TITLE : COMPLETED_ACTIVITY_TITLE,
		statusLabel: isRunning ? RUNNING_ACTIVITY_STATUS_LABEL : COMPLETED_ACTIVITY_STATUS_LABEL,
	};
}

function renderActivityPart({
	autoCollapseIndex,
	isAutoCollapsing,
	index,
	onBeforeToolToggle,
	onOpenSubagentToolCall,
	part,
	status,
}: {
	autoCollapseIndex: number;
	isAutoCollapsing: boolean;
	index: number;
	onBeforeToolToggle: () => void;
	onOpenSubagentToolCall?: (toolCall: ToolCallActivity) => void;
	part: AgentChainOfThoughtPart;
	status: AgentActivityStatus;
}) {
	if (part.type === "reasoning") {
		return <AgentReasoningPart key={`reasoning-${index}`} part={part} status={status} />;
	}

	return (
		<AgentToolCall
			autoCollapseIndex={autoCollapseIndex}
			isAutoCollapsing={isAutoCollapsing}
			key={part.toolCallId ?? `tool-call-${index}`}
			onBeforeToggle={onBeforeToolToggle}
			onOpenSubagentToolCall={onOpenSubagentToolCall}
			part={part}
			status={status}
		/>
	);
}

function getActivityStatus(messageStatus: DesktopThreadMessageStatus | undefined): AgentActivityStatus {
	if (messageStatus?.type === "running" || messageStatus?.type === "requires-action") {
		return { type: messageStatus.type };
	}
	if (messageStatus?.type === "incomplete") {
		return { type: "incomplete" };
	}
	return { type: "complete" };
}

export function AgentRunActivity({
	messageCustomMetadata,
	messageId,
	messageStatus,
	onOpenSubagentToolCall,
	parts,
}: {
	messageCustomMetadata: unknown;
	messageId: string;
	messageStatus?: DesktopThreadMessageStatus;
	onOpenSubagentToolCall?: (toolCall: ToolCallActivity) => void;
	parts: AgentChainOfThoughtPart[];
}) {
	const metadata = useMemo(() => getRunActivityMetadata(messageCustomMetadata), [messageCustomMetadata]);
	const activityId = messageId;
	const activityContentId = metadata?.runId ?? messageId;
	const status = getActivityStatus(messageStatus);
	const isRunning =
		messageStatus?.type === "running" ||
		messageStatus?.type === "requires-action" ||
		status.type === "running" ||
		status.type === "requires-action" ||
		parts.some((part) => isActivityPartRunning(part, status));
	const [collapsed, setCollapsed] = useState(!isRunning);
	const isOpen = !collapsed;
	const activityRef = useRef<HTMLDivElement | null>(null);
	const contentSpacerRef = useRef<HTMLDivElement | null>(null);
	const pendingPushCompensationRef = useRef<PendingPushCompensation | undefined>(undefined);
	const previousActivityIdRef = useRef(activityId);
	const previousAutoCollapseStateRef = useRef<{ activityId: string; isRunning: boolean } | undefined>(undefined);
	const activeStartedAtRef = useRef(getReasonableTimestamp(metadata?.startedAt) ?? Date.now());
	const autoCollapseTimeoutRef = useRef<number | undefined>(undefined);
	const [now, setNow] = useState(() => Date.now());
	const [isAutoCollapsing, setIsAutoCollapsing] = useState(false);
	const [pushDirection, setPushDirection] = useState<ActivityPushDirection>("down");
	const [shouldRenderActivityContent, setShouldRenderActivityContent] = useState(isOpen);
	const activeStartedAt = getReasonableTimestamp(metadata?.startedAt) ?? activeStartedAtRef.current;
	const toolCallCount = parts.filter((part) => part.type === "tool-call").length;
	const durationMs = getRunActivityDurationMs({
		activeStartedAt,
		isRunning,
		metadata,
		now,
	});
	const duration = formatActivityDuration(durationMs);
	const activityLabels = getActivityLabels(isRunning, metadata?.phase);
	const activityTitle = activityLabels.title;
	const activityStatusLabel = activityLabels.statusLabel;
	const contentMotionOrigin = pushDirection === "up" ? "bottom" : "top";
	const shouldShowActivityContent = isOpen || shouldRenderActivityContent;

	useEffect(() => {
		if (previousActivityIdRef.current !== activityId) {
			previousActivityIdRef.current = activityId;
			activeStartedAtRef.current = getReasonableTimestamp(metadata?.startedAt) ?? Date.now();
			setNow(Date.now());
			setCollapsed(!isRunning);
		}
	}, [activityId, isRunning, metadata]);

	const clearAutoCollapseTimeout = useCallback((): void => {
		if (autoCollapseTimeoutRef.current === undefined) {
			return;
		}
		window.clearTimeout(autoCollapseTimeoutRef.current);
		autoCollapseTimeoutRef.current = undefined;
	}, []);

	useEffect(() => {
		const previousAutoCollapseState = previousAutoCollapseStateRef.current;
		if (previousAutoCollapseState?.activityId === activityId && previousAutoCollapseState.isRunning === isRunning) {
			return;
		}

		previousAutoCollapseStateRef.current = { activityId, isRunning };
		clearAutoCollapseTimeout();

		if (isRunning) {
			setIsAutoCollapsing(false);
			setCollapsed(false);
			return;
		}

		if (
			previousAutoCollapseState?.activityId === activityId &&
			previousAutoCollapseState.isRunning &&
			toolCallCount > 0
		) {
			const autoCollapseDuration =
				TOOL_AUTO_COLLAPSE_ANIMATION_MS + Math.max(0, toolCallCount - 1) * TOOL_AUTO_COLLAPSE_STAGGER_MS;
			setIsAutoCollapsing(true);
			setCollapsed(false);
			autoCollapseTimeoutRef.current = window.setTimeout(() => {
				autoCollapseTimeoutRef.current = undefined;
				setIsAutoCollapsing(false);
				setCollapsed(true);
			}, autoCollapseDuration);
			return;
		}

		setIsAutoCollapsing(false);
		setCollapsed(true);
	}, [activityId, clearAutoCollapseTimeout, isRunning, toolCallCount]);

	useEffect(() => clearAutoCollapseTimeout, [clearAutoCollapseTimeout]);

	useEffect(() => {
		if (!isRunning) {
			return;
		}

		setNow(Date.now());
		const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(intervalId);
	}, [isRunning]);

	useEffect(() => {
		if (isOpen) {
			setShouldRenderActivityContent(true);
			return;
		}

		if (!shouldRenderActivityContent) {
			return;
		}

		const timeoutId = window.setTimeout(() => {
			setShouldRenderActivityContent(false);
		}, ACTIVITY_DRAWER_ANIMATION_MS);
		return () => window.clearTimeout(timeoutId);
	}, [isOpen, shouldRenderActivityContent]);

	useLayoutEffect(() => {
		const pendingPush = pendingPushCompensationRef.current;
		if (!pendingPush) {
			return;
		}

		pendingPushCompensationRef.current = undefined;
		compensateActivityPush({
			activityElement: activityRef.current,
			contentSpacer: contentSpacerRef.current,
			pendingPush,
		});
	});

	const handleOpenChange = useCallback(
		(open: boolean): void => {
			clearAutoCollapseTimeout();
			setIsAutoCollapsing(false);
			const nextPushDirection = open ? resolveActivityPushDirection(activityRef.current) : pushDirection;
			setPushDirection(nextPushDirection);
			if (open) {
				setShouldRenderActivityContent(true);
			}
			pendingPushCompensationRef.current = {
				direction: nextPushDirection,
				open,
			};
			setCollapsed(!open);
		},
		[clearAutoCollapseTimeout, pushDirection],
	);

	return (
		<div
			className="my-3 min-w-0 max-w-full overflow-x-hidden [overflow-anchor:none]"
			data-auto-collapsing={isAutoCollapsing ? "true" : undefined}
			data-slot="assistant-run-activity"
			ref={activityRef}
		>
			<ChainOfThought
				data-slot="assistant-run-activity-chain-of-thought"
				onOpenChange={handleOpenChange}
				open={isOpen}
			>
				<ChainOfThoughtHeader
					aria-expanded={isOpen}
					aria-label={`${activityTitle} ${activityStatusLabel} ${duration}`}
					data-slot="assistant-run-activity-trigger"
				>
					<span className="flex min-w-0 items-center justify-between gap-3">
						<span className="truncate">{activityTitle}</span>
						<span className="shrink-0 tabular-nums text-muted-foreground text-xs">
							{activityStatusLabel} {duration}
						</span>
					</span>
				</ChainOfThoughtHeader>
				<MotionConfig reducedMotion="never">
					<motion.div
						animate={{ height: isOpen ? "auto" : 0 }}
						className="overflow-hidden"
						data-motion="structural-drawer"
						data-motion-engine="motion"
						data-motion-mode="drawer"
						data-motion-origin={contentMotionOrigin}
						data-motion-owner="spacer"
						data-motion-scope="structural"
						data-push-direction={pushDirection}
						data-slot="assistant-run-activity-content-spacer"
						data-state={isOpen ? "open" : "closed"}
						data-structural-layout-driver="height"
						initial={false}
						ref={contentSpacerRef}
						transition={activityDrawerTransition}
					>
						{shouldShowActivityContent ? (
							<div
								aria-busy={isRunning}
								aria-hidden={!isOpen}
								className="mt-2 space-y-3 text-popover-foreground outline-none"
								data-motion="structural-drawer"
								data-motion-engine="motion"
								data-motion-mode="drawer"
								data-motion-origin={contentMotionOrigin}
								data-motion-owner="fixed-content"
								data-motion-scope="structural"
								data-push-direction={pushDirection}
								data-slot="assistant-run-activity-content"
								key={`${activityContentId}-content`}
							>
								{parts.map((part, index) => {
									const autoCollapseIndex = parts
										.slice(0, index)
										.filter((previousPart) => previousPart.type === "tool-call").length;
									return renderActivityPart({
										autoCollapseIndex,
										index,
										isAutoCollapsing,
										onBeforeToolToggle: () => undefined,
										onOpenSubagentToolCall,
										part,
										status,
									});
								})}
							</div>
						) : null}
					</motion.div>
				</MotionConfig>
			</ChainOfThought>
		</div>
	);
}
