import type * as React from "react";
import { cn } from "@/lib/utils";

interface EntityRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
	actions?: React.ReactNode;
	as?: "button" | "div";
	disabled?: boolean;
	icon?: React.ReactNode;
	selected?: boolean;
	subtitle?: React.ReactNode;
	title: React.ReactNode;
	trailing?: React.ReactNode;
	type?: React.ButtonHTMLAttributes<HTMLButtonElement>["type"];
}

function EntityRow({
	actions,
	as = "button",
	className,
	disabled,
	icon,
	selected = false,
	subtitle,
	title,
	trailing,
	type = "button",
	...props
}: EntityRowProps) {
	const rowClassName = cn(
		"group/entity-row relative flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-[background-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-transparent hover:bg-[color:var(--surface-2)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)] disabled:pointer-events-none disabled:opacity-45",
		selected &&
			"bg-[color:var(--surface-2)] text-[color:var(--text-primary)] shadow-[var(--shadow-minimal)] before:bg-[color:var(--accent)]",
		className,
	);
	const content = (
		<>
			{icon ? (
				<span className="grid size-6 shrink-0 place-items-center text-[color:var(--text-tertiary)] group-hover/entity-row:text-[color:var(--text-secondary)]">
					{icon}
				</span>
			) : null}
			<span className="min-w-0 flex-1">
				<span className="block truncate font-medium text-[color:var(--text-primary)]">{title}</span>
				{subtitle ? <span className="block truncate text-[color:var(--text-tertiary)]">{subtitle}</span> : null}
			</span>
			{trailing ? <span className="shrink-0 text-[color:var(--text-tertiary)]">{trailing}</span> : null}
			{actions ? (
				<span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/entity-row:opacity-100 group-focus-within/entity-row:opacity-100">
					{actions}
				</span>
			) : null}
		</>
	);

	if (as === "div") {
		return (
			<div className={rowClassName} data-selected={selected} data-slot="entity-row" {...props}>
				{content}
			</div>
		);
	}

	return (
		<button
			className={rowClassName}
			data-selected={selected}
			data-slot="entity-row"
			disabled={disabled}
			type={type}
			{...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
		>
			{content}
		</button>
	);
}

export { EntityRow };
