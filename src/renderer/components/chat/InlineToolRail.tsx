import { ChevronDown, ChevronUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { UIEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { StatusDot, type StatusDotStatus } from "@/components/ui/status-dot";
import { subtleReveal } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ToolCallActivity } from "../../lib/conversation-timeline-projection.ts";
import { ToolActivityDetails } from "./ToolCallCard.tsx";

export interface InlineToolRailProps {
	toolCalls: ToolCallActivity[];
	defaultExpanded?: boolean;
	defaultExpandedToolCallId?: string;
	isRunActive?: boolean;
	runEndedAt?: number;
	runStartedAt?: number;
}

export interface ToolRunSummaryProps {
	toolCalls: ToolCallActivity[];
	isExpanded: boolean;
	isRunActive?: boolean;
	onToggle: () => void;
	runEndedAt?: number;
	runStartedAt?: number;
}

export interface ToolActivityRowsProps {
	toolCalls: ToolCallActivity[];
	expandedToolCallIds: ReadonlySet<string>;
	onToggleToolCall: (toolCallId: string) => void;
	className?: string;
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

function getToolPillText(toolCall: ToolCallActivity): string {
	const command = getToolArgsCommand(toolCall.args);
	if (command) {
		return truncateInline(command, 96);
	}

	const path = getToolArgsPath(toolCall.args);
	if (path) {
		return truncateInline(path, 80);
	}

	return toolCall.toolName;
}

function getToolActivityLabel(toolCall: ToolCallActivity): string {
	const path = getToolArgsPath(toolCall.args);
	const command = getToolArgsCommand(toolCall.args);

	switch (toolCall.toolName) {
		case "read":
			return path ? `Read ${getPathLabel(path)}` : "Read file";
		case "bash":
			return command ? (getRipgrepActivityLabel(command) ?? "Ran command") : "Ran command";
		case "edit":
			return path ? `Edited ${getPathLabel(path)}` : "Edited file";
		case "write":
			return path ? `Wrote ${getPathLabel(path)}` : "Wrote file";
		default:
			return `Used ${toolCall.toolName}`;
	}
}

function formatDuration(durationMs: number): string {
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

function getRailDurationMs(toolCalls: ToolCallActivity[], runStartedAt?: number, runEndedAt?: number): number {
	if (toolCalls.length === 0) {
		return 0;
	}

	const startedAt = runStartedAt ?? Math.min(...toolCalls.map((toolCall) => toolCall.startedAt));
	const endedAt =
		runEndedAt ??
		Math.max(...toolCalls.map((toolCall) => toolCall.completedAt ?? toolCall.updatedAt ?? toolCall.startedAt));

	return Math.max(0, endedAt - startedAt);
}

function getRailSummary(toolCalls: ToolCallActivity[], durationMs: number): string {
	const duration = formatDuration(durationMs);
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

function useRailDurationMs(
	toolCalls: ToolCallActivity[],
	isRunActive: boolean,
	runStartedAt?: number,
	runEndedAt?: number,
): number {
	const timestampDurationMs = getRailDurationMs(toolCalls, runStartedAt, runEndedAt);
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

function getRowStatusLabel(status: ToolCallActivity["status"]): string {
	switch (status) {
		case "completed":
			return "完成";
		case "error":
			return "错误";
		case "running":
			return "运行中";
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

export function ToolRunSummary({
	toolCalls,
	isRunActive = false,
	isExpanded,
	onToggle,
	runEndedAt,
	runStartedAt,
}: ToolRunSummaryProps) {
	const sortedToolCalls = useMemo(() => sortToolCalls(toolCalls), [toolCalls]);
	const durationMs = useRailDurationMs(sortedToolCalls, isRunActive, runStartedAt, runEndedAt);

	if (sortedToolCalls.length === 0) {
		return null;
	}

	const summary = getRailSummary(sortedToolCalls, durationMs);

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
				{isExpanded ? (
					<ChevronUp className="size-4 shrink-0 translate-y-px" />
				) : (
					<ChevronDown className="size-4 shrink-0 translate-y-px" />
				)}
			</Button>
			<div className="mt-[0.82rem] h-px min-w-0 flex-1 bg-border" data-slot="tool-rail-divider" />
		</div>
	);
}

function sortToolCalls(toolCalls: ToolCallActivity[]): ToolCallActivity[] {
	return [...toolCalls].sort((left, right) => {
		if (left.startedAt !== right.startedAt) {
			return left.startedAt - right.startedAt;
		}

		return left.updatedAt - right.updatedAt;
	});
}

export function ToolActivityRows({
	toolCalls,
	expandedToolCallIds,
	onToggleToolCall,
	className,
}: ToolActivityRowsProps) {
	const activityListRef = useRef<HTMLUListElement | null>(null);
	const shouldFollowActivityRef = useRef(true);
	const sortedToolCalls = useMemo(() => sortToolCalls(toolCalls), [toolCalls]);

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
				{sortedToolCalls.map((toolCall) => {
					const isActive = expandedToolCallIds.has(toolCall.toolCallId);

					return (
						<motion.li className="grid gap-2" key={toolCall.toolCallId} {...subtleReveal}>
							<Button
								aria-expanded={isActive}
								className={cn(
									"group/tool-row h-auto w-full justify-start gap-0 rounded-lg px-1.5 py-1.5 text-left transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-muted/35 hover:text-foreground",
									isActive && "bg-muted/30 text-foreground",
								)}
								onClick={() => onToggleToolCall(toolCall.toolCallId)}
								type="button"
								variant="ghost"
							>
								<span className="grid w-full grid-cols-[auto_minmax(0,1fr)_minmax(0,45%)_3rem] items-center gap-2">
									<StatusDot
										className="size-2"
										label={getRowStatusLabel(toolCall.status)}
										status={getStatusDotStatus(toolCall.status)}
									/>
									<span className="min-w-0 truncate text-sm text-[color:var(--color-workbench-ink)] transition-colors duration-150 group-hover/tool-row:text-foreground">
										{getToolActivityLabel(toolCall)}
									</span>
									<span className="min-w-0 w-full justify-self-end truncate rounded-md bg-muted/55 px-2 py-0.5 font-mono text-[12px] text-foreground transition-colors duration-150 group-hover/tool-row:bg-muted/80">
										{getToolPillText(toolCall)}
									</span>
									<span className="justify-self-end text-right text-[13px] text-muted-foreground transition-colors duration-150 group-hover/tool-row:text-foreground">
										{getRowStatusLabel(toolCall.status)}
									</span>
								</span>
							</Button>

							{isActive ? (
								<div className="overflow-hidden [overflow-anchor:none]" data-slot="tool-activity-row-details">
									<Card className="ml-4 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
										<CardContent className="px-3 py-3">
											<ToolActivityDetails toolCall={toolCall} />
										</CardContent>
									</Card>
								</div>
							) : null}
						</motion.li>
					);
				})}
			</AnimatePresence>
		</ul>
	);
}

export function InlineToolRail({
	toolCalls,
	defaultExpanded = true,
	defaultExpandedToolCallId,
	isRunActive = false,
	runEndedAt,
	runStartedAt,
}: InlineToolRailProps) {
	const [isRailExpanded, setIsRailExpanded] = useState(defaultExpanded);
	const [expandedToolCallIds, setExpandedToolCallIds] = useState<ReadonlySet<string>>(
		() => new Set(defaultExpandedToolCallId ? [defaultExpandedToolCallId] : []),
	);

	if (toolCalls.length === 0) {
		return null;
	}

	function toggleToolCall(toolCallId: string): void {
		setExpandedToolCallIds((currentIds) => {
			const nextIds = new Set(currentIds);
			if (nextIds.has(toolCallId)) {
				nextIds.delete(toolCallId);
			} else {
				nextIds.add(toolCallId);
			}
			return nextIds;
		});
	}

	return (
		<Collapsible
			className="my-4 space-y-2 [overflow-anchor:none]"
			onOpenChange={setIsRailExpanded}
			open={isRailExpanded}
		>
			<ToolRunSummary
				isExpanded={isRailExpanded}
				isRunActive={isRunActive}
				onToggle={() => setIsRailExpanded((isExpanded) => !isExpanded)}
				runEndedAt={runEndedAt}
				runStartedAt={runStartedAt}
				toolCalls={toolCalls}
			/>

			<CollapsibleContent className="pl-3 [overflow-anchor:none]">
				<ToolActivityRows
					expandedToolCallIds={expandedToolCallIds}
					onToggleToolCall={toggleToolCall}
					toolCalls={toolCalls}
				/>
			</CollapsibleContent>
		</Collapsible>
	);
}
