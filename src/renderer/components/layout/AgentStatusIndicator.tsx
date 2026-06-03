import { AlertCircle, CheckCircle2, Clock3 } from "lucide-react";
import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { StatusDot } from "@/components/ui/status-dot";
import type { AgentRuntimeState, AgentRuntimeStatus } from "@/lib/agent-runtime-state";
import { cn } from "@/lib/utils";

interface AgentStatusIndicatorProps {
	className?: string;
	runtimeState?: AgentRuntimeStatus;
}

interface RuntimeBadgeProps extends Omit<ComponentProps<typeof Badge>, "variant"> {
	state: AgentRuntimeState;
}

type ProcessingIndicatorProps = Omit<RuntimeBadgeProps, "children" | "state"> & {
	label?: string;
	state?: Extract<AgentRuntimeState, "thinking" | "running" | "streaming">;
};

type QueuedChipProps = Omit<RuntimeBadgeProps, "children" | "state"> & { label?: string };

export function getRuntimeStatusLabel(state: AgentRuntimeState): string {
	switch (state) {
		case "queued":
			return "Queued";
		case "waiting_for_user":
			return "Waiting for approval";
		case "completed":
			return "Completed";
		case "error":
			return "Failed";
		case "cancelled":
			return "Cancelled";
		case "idle":
			return "Idle";
		case "thinking":
		case "running":
		case "streaming":
			return "Working";
	}
}

function getRuntimeStatusVariant(state: AgentRuntimeState): "neutral" | "info" | "success" | "warning" | "error" {
	switch (state) {
		case "error":
		case "cancelled":
			return "error";
		case "waiting_for_user":
			return "warning";
		case "completed":
			return "success";
		case "queued":
		case "thinking":
		case "running":
		case "streaming":
			return "info";
		case "idle":
			return "neutral";
	}
}

function RuntimeStatusIcon({ state }: { state: AgentRuntimeState }) {
	switch (state) {
		case "queued":
			return <Clock3 aria-hidden="true" className="size-3" />;
		case "waiting_for_user":
			return <StatusDot className="size-1.5" status="warning" />;
		case "completed":
			return <CheckCircle2 aria-hidden="true" className="size-3" />;
		case "error":
		case "cancelled":
			return <AlertCircle aria-hidden="true" className="size-3" />;
		case "idle":
			return <StatusDot className="size-1.5" status="idle" />;
		case "thinking":
		case "running":
		case "streaming":
			return <Spinner aria-hidden="true" className="size-3" label="Working" />;
	}
}

export function RuntimeBadge({ className, state, ...props }: RuntimeBadgeProps) {
	return (
		<Badge
			className={cn("max-w-52 gap-1.5 px-2 text-[11px] font-medium", className)}
			data-slot="runtime-badge"
			data-state={state}
			variant={getRuntimeStatusVariant(state)}
			{...props}
		/>
	);
}

export function ProcessingIndicator({
	className,
	label = "Working",
	state = "running",
	...props
}: ProcessingIndicatorProps) {
	return (
		<RuntimeBadge aria-label={label} className={className} state={state} {...props}>
			<Spinner aria-hidden="true" className="size-3" label={label} />
			<span className="truncate">{label}</span>
		</RuntimeBadge>
	);
}

export function QueuedChip({ className, label = "Queued", ...props }: QueuedChipProps) {
	return (
		<RuntimeBadge aria-label={label} className={className} state="queued" {...props}>
			<Clock3 aria-hidden="true" className="size-3" />
			<span className="truncate">{label}</span>
		</RuntimeBadge>
	);
}

export function AgentStatusIndicator({ className, runtimeState }: AgentStatusIndicatorProps) {
	if (!runtimeState || runtimeState.state === "idle") {
		return null;
	}

	const label = runtimeState.message ?? getRuntimeStatusLabel(runtimeState.state);
	if (runtimeState.state === "thinking" || runtimeState.state === "running" || runtimeState.state === "streaming") {
		return (
			<ProcessingIndicator
				className={className}
				data-slot="agent-status-indicator"
				label={label}
				state={runtimeState.state}
			/>
		);
	}

	if (runtimeState.state === "queued") {
		return <QueuedChip className={className} data-slot="agent-status-indicator" label={label} />;
	}

	return (
		<RuntimeBadge
			aria-label={label}
			className={className}
			data-slot="agent-status-indicator"
			state={runtimeState.state}
		>
			<RuntimeStatusIcon state={runtimeState.state} />
			<span className="truncate">{label}</span>
		</RuntimeBadge>
	);
}
