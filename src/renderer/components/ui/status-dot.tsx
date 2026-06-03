import type * as React from "react";
import { cn } from "@/lib/utils";

type StatusDotStatus = "idle" | "running" | "success" | "warning" | "error" | "unread";

interface StatusDotProps extends Omit<React.ComponentProps<"span">, "children"> {
	label?: string;
	status?: StatusDotStatus;
}

const statusClassName: Record<StatusDotStatus, string> = {
	error: "bg-[color:var(--destructive)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--destructive)_16%,transparent)]",
	idle: "bg-[color:var(--text-tertiary)]",
	running:
		"motion-breathing-dot bg-[color:var(--info)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--info)_16%,transparent)]",
	success: "bg-[color:var(--success)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--success)_14%,transparent)]",
	unread: "bg-[color:var(--accent)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--accent)_14%,transparent)]",
	warning: "bg-[color:var(--warning)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--warning)_16%,transparent)]",
};

function StatusDot({ className, label, status = "idle", ...props }: StatusDotProps) {
	const dotClassName = cn("inline-block size-2 shrink-0 rounded-full", statusClassName[status], className);
	if (label) {
		return (
			<span
				aria-label={label}
				className={dotClassName}
				data-slot="status-dot"
				data-status={status}
				role="img"
				{...props}
			/>
		);
	}

	return <span aria-hidden="true" className={dotClassName} data-slot="status-dot" data-status={status} {...props} />;
}

export { StatusDot };
export type { StatusDotStatus };
