import { motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { subtleReveal } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface WorkbenchPageHeaderProps {
	actions?: ReactNode;
	className?: string;
	description?: ReactNode;
	divider?: WorkbenchPageHeaderDivider;
	embedded?: boolean;
	headerSlot?: string;
	title: string;
	titlebarInset?: WorkbenchPageHeaderTitlebarInset;
	titlebarSlot?: string;
	toolbar?: ReactNode;
	toolbarSlot?: string;
}

type WorkbenchPageHeaderDivider = "none" | "subtle";
type WorkbenchPageHeaderTitlebarInset = "none" | "app-titlebar-controls";

function getTitlebarInsetStyle(inset: WorkbenchPageHeaderTitlebarInset): CSSProperties | undefined {
	if (inset === "app-titlebar-controls") {
		return { paddingLeft: "var(--desktop-titlebar-content-inset)" };
	}
	return undefined;
}

function getTitlebarInsetAttribute(inset: WorkbenchPageHeaderTitlebarInset): string | undefined {
	return inset === "none" ? undefined : inset;
}

function getTitlebarDragRegionClass(inset: WorkbenchPageHeaderTitlebarInset): string {
	return inset === "app-titlebar-controls" ? "left-[var(--desktop-titlebar-content-inset)]" : "left-0";
}

export function WorkbenchPageHeader({
	actions,
	className,
	description,
	divider = "subtle",
	embedded = false,
	headerSlot = "workbench-page-header",
	title,
	titlebarInset = "none",
	titlebarSlot = "workbench-page-header-titlebar",
	toolbar,
	toolbarSlot = "workbench-page-header-toolbar",
}: WorkbenchPageHeaderProps) {
	const titlebarInsetStyle = getTitlebarInsetStyle(titlebarInset);
	const titlebarInsetAttribute = getTitlebarInsetAttribute(titlebarInset);
	const titlebarDragRegion = !embedded;

	return (
		<motion.header
			className={cn(
				embedded
					? "grid gap-4 rounded-lg border border-border/70 bg-[color:var(--color-workbench-panel)] p-4 shadow-xs"
					: divider === "subtle"
						? "border-b border-[color:var(--border-subtle)]"
						: undefined,
				className,
			)}
			data-layout={embedded ? undefined : "panel-header"}
			data-page-header="workbench"
			data-slot={headerSlot}
			{...subtleReveal}
		>
			<div
				className={cn(
					embedded
						? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
						: "relative grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 md:px-7",
				)}
				data-titlebar-inset={titlebarInsetAttribute}
				data-slot={titlebarSlot}
				style={titlebarInsetStyle}
			>
				{titlebarDragRegion ? (
					<div
						aria-hidden="true"
						className={cn(
							"desktop-window-drag-region pointer-events-auto absolute inset-y-0 right-0 z-0",
							getTitlebarDragRegionClass(titlebarInset),
						)}
						data-slot="workbench-page-header-drag-region"
					/>
				) : null}
				<div
					className={cn("relative z-10 min-w-0 space-y-0.5", titlebarDragRegion && "desktop-window-drag-region")}
					data-titlebar-drag-region={titlebarDragRegion ? "enabled" : "disabled"}
					data-slot="workbench-page-header-title-region"
				>
					<h1
						className="truncate text-[13px] font-medium leading-5 tracking-tight text-foreground"
						data-slot="workbench-page-header-title"
					>
						{title}
					</h1>
					{description ? (
						<p
							className="truncate text-xs leading-4 text-muted-foreground"
							data-slot="workbench-page-header-description"
						>
							{description}
						</p>
					) : null}
				</div>
				{actions ? (
					<div
						className="desktop-window-no-drag relative z-10 flex min-w-0 items-center justify-end gap-2 justify-self-end"
						data-slot="workbench-page-header-actions"
					>
						{actions}
					</div>
				) : null}
			</div>

			{toolbar ? (
				<div
					className={cn(
						embedded
							? "grid gap-3"
							: "grid gap-3 px-5 pb-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:px-7",
					)}
					data-titlebar-inset={titlebarInsetAttribute}
					data-slot={toolbarSlot}
					style={titlebarInsetStyle}
				>
					{toolbar}
				</div>
			) : null}
		</motion.header>
	);
}
