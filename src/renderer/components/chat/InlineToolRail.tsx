import { useState } from "react";
import type { ToolCallActivity } from "../../lib/conversation-timeline-projection.ts";
import { Task, TaskContent } from "../ai-elements/task.tsx";
import {
	getToolCallImagePreviewItems,
	type ThreadImagePreview,
	ThreadImagePreviewGrid,
} from "./ThreadImagePreviewGrid.tsx";
import {
	ToolTaskActivity,
	type ToolTaskActivityProps,
	ToolTaskSummary,
	type ToolTaskSummaryProps,
} from "./ToolTaskActivity.tsx";

export interface InlineToolRailProps {
	toolCalls: ToolCallActivity[];
	defaultExpanded?: boolean;
	isRunActive?: boolean;
	onPreviewImage?: (image: ThreadImagePreview) => void;
	runEndedAt?: number;
	runStartedAt?: number;
}

export type ToolRunSummaryProps = ToolTaskSummaryProps;

export type ToolActivityRowsProps = Pick<ToolTaskActivityProps, "className" | "isRunActive" | "toolCalls">;

export function ToolRunSummary(props: ToolRunSummaryProps) {
	return <ToolTaskSummary {...props} />;
}

export function ToolActivityRows(props: ToolActivityRowsProps) {
	return <ToolTaskActivity {...props} />;
}

export function InlineToolRail({
	toolCalls,
	defaultExpanded = true,
	isRunActive = false,
	onPreviewImage,
	runEndedAt,
	runStartedAt,
}: InlineToolRailProps) {
	const [isRailExpanded, setIsRailExpanded] = useState(defaultExpanded);
	const imagePreviewItems = getToolCallImagePreviewItems(toolCalls);

	if (toolCalls.length === 0) {
		return null;
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
				<ToolActivityRows isRunActive={isRunActive} toolCalls={toolCalls} />
				<ThreadImagePreviewGrid
					className="mt-3"
					isRunActive={isRunActive}
					items={imagePreviewItems}
					onPreviewImage={onPreviewImage}
				/>
			</TaskContent>
		</Task>
	);
}
