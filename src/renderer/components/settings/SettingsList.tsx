import type { LucideIcon } from "lucide-react";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SettingsGroupProps {
	children: ReactNode;
	className?: string;
}

export function SettingsGroup({ children, className }: SettingsGroupProps) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-lg border border-border/70 bg-[color:var(--color-workbench-panel)] shadow-xs",
				className,
			)}
		>
			{children}
		</div>
	);
}

interface SettingsRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "title"> {
	children?: ReactNode;
	className?: string;
	contentClassName?: string;
	description?: ReactNode;
	icon?: LucideIcon;
	id?: string;
	layout?: "inline" | "stacked";
	title: ReactNode;
}

export const SettingsRow = forwardRef<HTMLDivElement, SettingsRowProps>(function SettingsRow(
	{ children, className, contentClassName, description, icon: Icon, id, layout = "inline", title, ...rootProps },
	ref,
) {
	const isStacked = layout === "stacked";
	const titleNode = id ? (
		<Label className="text-[13px] font-medium leading-5 text-foreground" htmlFor={id}>
			{title}
		</Label>
	) : (
		<p className="text-[13px] font-medium leading-5 text-foreground">{title}</p>
	);

	return (
		<div
			{...rootProps}
			className={cn(
				"grid gap-4 border-t border-border/65 px-4 py-3.5 first:border-t-0 sm:px-5",
				isStacked
					? "sm:grid-cols-1 sm:items-start"
					: "sm:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] sm:items-center",
				className,
			)}
			data-settings-row-layout={layout}
			ref={ref}
		>
			<div className="flex min-w-0 items-start gap-3">
				{Icon ? (
					<div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background">
						<Icon className="size-4 text-muted-foreground" />
					</div>
				) : null}
				<div className="min-w-0 space-y-1">
					{titleNode}
					{description ? <div className="text-[12px] leading-5 text-muted-foreground">{description}</div> : null}
				</div>
			</div>
			{children ? (
				<div className={cn("min-w-0", isStacked ? "w-full" : "sm:justify-self-end", contentClassName)}>
					{children}
				</div>
			) : null}
		</div>
	);
});

interface SettingsActionBarProps {
	children: ReactNode;
	className?: string;
}

export function SettingsActionBar({ children, className }: SettingsActionBarProps) {
	return (
		<div className={cn("flex items-center justify-end gap-2 border-t border-border/65 px-4 py-3 sm:px-5", className)}>
			{children}
		</div>
	);
}
