import { ChevronDownIcon } from "lucide-react";
import type { DesktopThreadMessageStatus } from "../../lib/assistant-runtime-adapter.ts";
import { cn } from "../../lib/utils.ts";
import { Task, TaskContent, TaskItem, TaskTrigger } from "../ai-elements/task.tsx";

type ThreadRunStatusKind = "cancelled" | "limit" | "auth" | "network" | "failed";

interface ThreadRunStatusTaskModel {
	kind: ThreadRunStatusKind;
	summary: string;
	detail: string;
}

interface ThreadRunStatusTaskProps {
	className?: string;
	errorMessage?: unknown;
	status?: DesktopThreadMessageStatus;
}

const DEFAULT_ERROR_DETAIL = "The agent run did not complete.";
const MAX_DETAIL_LENGTH = 180;

function extractJsonErrorMessage(value: unknown): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	if ("message" in value && typeof value.message === "string") {
		return value.message;
	}
	if ("error" in value) {
		if (typeof value.error === "string") {
			return value.error;
		}
		const nestedMessage = extractJsonErrorMessage(value.error);
		if (nestedMessage) {
			return nestedMessage;
		}
	}
	if ("detail" in value && typeof value.detail === "string") {
		return value.detail;
	}

	return undefined;
}

function extractErrorText(error: unknown): string {
	if (typeof error !== "string") {
		return "";
	}

	const trimmed = error.trim();
	if (/^[{[]/u.test(trimmed)) {
		try {
			return extractJsonErrorMessage(JSON.parse(trimmed)) ?? "";
		} catch {
			return "";
		}
	}

	return (
		trimmed
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? ""
	);
}

function normalizeErrorDetail(error: unknown): string {
	const raw = extractErrorText(error);
	const detail = raw
		.trim()
		.replace(/^(?:[A-Z][A-Za-z]*Error|Error):\s*/u, "")
		.replace(/\bhttps?:\/\/[^\s)]+/giu, "[url]")
		.replace(/\s+/gu, " ")
		.trim();

	if (detail.length === 0) {
		return DEFAULT_ERROR_DETAIL;
	}

	if (detail.length <= MAX_DETAIL_LENGTH) {
		return detail;
	}

	return `${detail.slice(0, MAX_DETAIL_LENGTH - 1).trimEnd()}...`;
}

function classifyErrorDetail(detail: string): Omit<ThreadRunStatusTaskModel, "detail"> {
	if (/\b(rate\s*limit|quota|limit reached|too many requests)\b/iu.test(detail)) {
		return { kind: "limit", summary: "Provider limit reached" };
	}

	if (/\b(key missing|missing\b.*\bkey|api key|unauthorized|authentication|login)\b/iu.test(detail)) {
		return { kind: "auth", summary: "Authentication required" };
	}

	if (
		/\b(network|stream disconnected|error sending request|reconnecting|connection|timeout|fetch failed)\b/iu.test(
			detail,
		)
	) {
		return { kind: "network", summary: "Network interrupted" };
	}

	return { kind: "failed", summary: "Agent run failed" };
}

export function getThreadRunStatusTaskModel({
	errorMessage,
	status,
}: {
	errorMessage?: unknown;
	status?: DesktopThreadMessageStatus;
}): ThreadRunStatusTaskModel | undefined {
	if (status?.type === "incomplete" && status.reason === "cancelled") {
		return {
			kind: "cancelled",
			summary: "Run cancelled",
			detail: "The agent run was cancelled.",
		};
	}

	const error = status?.type === "incomplete" && status.reason === "error" ? status.error : errorMessage;
	if (error === undefined || error === null || String(error).trim().length === 0) {
		return undefined;
	}

	const detail = normalizeErrorDetail(error);
	return {
		...classifyErrorDetail(detail),
		detail,
	};
}

export function ThreadRunStatusTask({ className, errorMessage, status }: ThreadRunStatusTaskProps) {
	const model = getThreadRunStatusTaskModel({ errorMessage, status });
	if (!model) {
		return null;
	}

	return (
		<Task className={cn("text-[13px] leading-5", className)} data-slot="thread-run-status-task" defaultOpen={false}>
			<TaskTrigger title={model.summary}>
				<button
					aria-label={model.summary}
					className="group flex w-full cursor-pointer items-center gap-2 text-left text-muted-foreground transition-colors hover:text-foreground"
					data-kind={model.kind}
					data-slot="thread-run-status-trigger"
					type="button"
				>
					<span className="text-[13px]">{model.summary}</span>
					<ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
				</button>
			</TaskTrigger>
			<TaskContent className="[overflow-anchor:none]">
				<TaskItem className="text-[13px] leading-5" data-slot="thread-run-status-detail">
					{model.detail}
				</TaskItem>
			</TaskContent>
		</Task>
	);
}

export type { ThreadRunStatusTaskModel };
