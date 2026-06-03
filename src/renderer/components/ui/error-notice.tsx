import { AlertCircle } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

interface ErrorNoticeProps extends Omit<React.ComponentProps<"div">, "title"> {
	actions?: React.ReactNode;
	description?: React.ReactNode;
	title: React.ReactNode;
}

function ErrorNotice({ actions, className, description, title, ...props }: ErrorNoticeProps) {
	return (
		<div
			className={cn(
				"flex w-full items-start gap-3 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklch,var(--destructive)_22%,transparent)] bg-[color-mix(in_oklch,var(--destructive)_7%,var(--background))] px-3 py-2.5 text-[color:var(--text-primary)] shadow-[var(--shadow-minimal)]",
				className,
			)}
			data-slot="error-notice"
			role="alert"
			{...props}
		>
			<AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[color:var(--destructive)]" />
			<div className="min-w-0 flex-1">
				<div className="font-medium text-[color:var(--destructive)]">{title}</div>
				{description ? <div className="mt-0.5 text-[color:var(--text-secondary)]">{description}</div> : null}
				{actions ? <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div> : null}
			</div>
		</div>
	);
}

export { ErrorNotice };
