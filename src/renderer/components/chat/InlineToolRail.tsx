import { useState } from "react";
import type { ToolCallActivity } from "../../lib/conversation-timeline-projection.ts";
import { Task, TaskContent } from "../ai-elements/task.tsx";
import {
	ToolTaskActivity,
	type ToolTaskActivityProps,
	ToolTaskSummary,
	type ToolTaskSummaryProps,
} from "./ToolTaskActivity.tsx";

export interface InlineToolRailProps {
	toolCalls: ToolCallActivity[];
	defaultExpanded?: boolean;
	defaultExpandedToolCallId?: string;
	isRunActive?: boolean;
	runEndedAt?: number;
	runStartedAt?: number;
}

export type ToolRunSummaryProps = ToolTaskSummaryProps;

export type ToolActivityRowsProps = Pick<
	ToolTaskActivityProps,
	"className" | "expandedToolCallIds" | "onToggleToolCall" | "toolCalls"
>;

export function ToolRunSummary(props: ToolRunSummaryProps) {
	return <ToolTaskSummary {...props} />;
}

export function ToolActivityRows(props: ToolActivityRowsProps) {
	return <ToolTaskActivity {...props} />;
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
		<Task
			className="my-4 space-y-2 [overflow-anchor:none]"
			data-slot="tool-task"
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

			<TaskContent className="pl-3 [overflow-anchor:none]">
				<ToolActivityRows
					expandedToolCallIds={expandedToolCallIds}
					onToggleToolCall={toggleToolCall}
					toolCalls={toolCalls}
				/>
			</TaskContent>
		</Task>
	);
}
