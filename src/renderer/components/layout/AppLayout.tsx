import { PanelLeft } from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import { type CSSProperties, type ReactNode, useCallback, useRef, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { useDragResize } from "@/hooks/use-drag-resize";
import { noMotionTransition, sidebarWidthTransition } from "@/lib/motion";

export const SIDEBAR_WIDTH = {
	collapsed: 0,
	min: 220,
	default: 280,
	max: 420,
} as const;

export interface SidebarLayoutControls {
	isSidebarCollapsed: boolean;
	onToggleSidebar: () => void;
}

interface AppLayoutProps {
	sidebar: ReactNode | ((controls: SidebarLayoutControls) => ReactNode);
	titlebarControls?: ReactNode | ((controls: SidebarLayoutControls) => ReactNode);
	header?: ReactNode;
	children?: ReactNode | ((controls: SidebarLayoutControls) => ReactNode);
}

export function clampSidebarWidth(width: number): number {
	return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width));
}

export function AppLayout({ sidebar, titlebarControls, header, children }: AppLayoutProps) {
	const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_WIDTH.default);
	const [lastExpandedSidebarWidth, setLastExpandedSidebarWidth] = useState<number>(SIDEBAR_WIDTH.default);
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
	const [isResizingSidebar, setIsResizingSidebar] = useState(false);
	const shellRef = useRef<HTMLDivElement | null>(null);
	const resolvedExpandedWidth = clampSidebarWidth(sidebarWidth);
	const resolvedSidebarWidth = isSidebarCollapsed ? SIDEBAR_WIDTH.collapsed : resolvedExpandedWidth;
	const sidebarTransition = isResizingSidebar ? noMotionTransition : sidebarWidthTransition;

	function toggleSidebar(): void {
		setIsSidebarCollapsed((currentIsCollapsed) => {
			if (currentIsCollapsed) {
				setSidebarWidth(lastExpandedSidebarWidth);
			} else {
				setLastExpandedSidebarWidth(resolvedExpandedWidth);
			}

			return !currentIsCollapsed;
		});
	}

	const sidebarControls: SidebarLayoutControls = {
		isSidebarCollapsed,
		onToggleSidebar: toggleSidebar,
	};
	const sidebarContent = typeof sidebar === "function" ? sidebar(sidebarControls) : sidebar;
	const titlebarControlsContent =
		typeof titlebarControls === "function" ? titlebarControls(sidebarControls) : titlebarControls;
	const childrenContent = typeof children === "function" ? children(sidebarControls) : children;

	const setSidebarResizeActive = useCallback((active: boolean): void => {
		shellRef.current?.setAttribute("data-sidebar-resizing", String(active));
		setIsResizingSidebar(active);
	}, []);

	function setExpandedSidebarWidth(width: number): void {
		const nextWidth = clampSidebarWidth(width);
		setSidebarWidth(nextWidth);
		setLastExpandedSidebarWidth(nextWidth);
	}

	const sidebarResize = useDragResize({
		clampValue: clampSidebarWidth,
		getKeyValue: (key, currentWidth) => {
			if (isSidebarCollapsed) {
				return undefined;
			}
			if (key === "ArrowLeft") {
				return currentWidth - 16;
			}
			if (key === "ArrowRight") {
				return currentWidth + 16;
			}
			if (key === "Home") {
				return SIDEBAR_WIDTH.min;
			}
			if (key === "End") {
				return SIDEBAR_WIDTH.max;
			}
			return undefined;
		},
		getMotionValue: (startWidth, info) => startWidth + info.offset.x,
		onActiveChange: setSidebarResizeActive,
		setValue: setExpandedSidebarWidth,
		value: resolvedExpandedWidth,
	});

	return (
		<div
			className="workbench-app-shell relative flex h-[100dvh] select-none overflow-hidden text-foreground"
			data-sidebar-collapsed={isSidebarCollapsed}
			data-sidebar-resizing={isResizingSidebar}
			data-sidebar-width={Math.round(resolvedSidebarWidth)}
			data-slot="workbench-app-shell"
			ref={shellRef}
		>
			<div
				aria-hidden="true"
				className="desktop-window-drag-region pointer-events-auto absolute left-0 top-0 z-[var(--z-header)] h-[var(--desktop-titlebar-drag-height)] w-[var(--desktop-titlebar-native-control-reserve)]"
				data-chrome-layer="native-titlebar"
				data-slot="desktop-titlebar-native-drag-region"
			/>
			<div
				className="desktop-window-drag-region pointer-events-auto absolute left-[var(--desktop-titlebar-control-left)] top-[var(--desktop-titlebar-control-top)] z-[var(--z-popover)] flex h-8 min-w-[var(--desktop-titlebar-controls-safe-width)] items-center gap-1"
				data-chrome-layer="app-titlebar"
				data-chrome-owner="app-layout"
				data-sidebar-collapsed={isSidebarCollapsed}
				data-slot="desktop-titlebar-controls"
			>
				<IconButton
					aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
					className="size-7 rounded-lg text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"
					onClick={toggleSidebar}
					size="sm"
					title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
				>
					<PanelLeft className="size-3.5 translate-y-px stroke-[1.75]" />
				</IconButton>
				{titlebarControlsContent}
			</div>
			<MotionConfig reducedMotion="never">
				<motion.aside
					animate={{ width: resolvedSidebarWidth }}
					aria-hidden={isSidebarCollapsed ? true : undefined}
					aria-label="Workspace sidebar"
					className={`workbench-rail relative min-h-0 shrink-0 select-none overflow-hidden w-[var(--structural-drawer-size)] ${
						isSidebarCollapsed ? "border-r-0" : "border-r border-[color:var(--color-sidebar-border)]"
					}`}
					data-motion="structural-drawer"
					data-motion-engine="motion"
					data-motion-mode="drawer"
					data-motion-origin="left"
					data-motion-scope="structural"
					data-side="left"
					data-slot="workbench-sidebar"
					data-state={isSidebarCollapsed ? "closed" : "open"}
					inert={isSidebarCollapsed ? true : undefined}
					initial={false}
					style={{ "--structural-drawer-size": `${resolvedSidebarWidth}px` } as CSSProperties}
					transition={sidebarTransition}
				>
					<div
						className="h-full min-h-0"
						data-motion-owner="fixed-content"
						data-resize-motion="contents-static"
						data-slot="workbench-sidebar-inner"
						style={{ width: resolvedExpandedWidth }}
					>
						{sidebarContent}
					</div>
					{!isSidebarCollapsed ? (
						<motion.div
							aria-label="Resize sidebar"
							aria-orientation="vertical"
							aria-valuemax={SIDEBAR_WIDTH.max}
							aria-valuemin={SIDEBAR_WIDTH.min}
							aria-valuenow={Math.round(resolvedExpandedWidth)}
							className="group absolute inset-y-0 right-0 w-3 cursor-col-resize touch-none focus-visible:outline-none"
							drag="x"
							dragConstraints={{ left: 0, right: 0 }}
							dragElastic={0}
							dragMomentum={false}
							onDrag={(_event, info) => sidebarResize.handleMotionDrag(info)}
							onDragEnd={sidebarResize.handleMotionDragEnd}
							onDragStart={sidebarResize.handleMotionDragStart}
							onKeyDown={sidebarResize.handleKeyDown}
							onPointerDownCapture={sidebarResize.startResize}
							role="separator"
							style={{ x: 0 }}
							tabIndex={0}
						>
							<div className="ml-auto h-full w-px bg-transparent transition-colors group-hover:bg-[color:var(--color-sidebar-border)] group-focus-visible:bg-[color:var(--color-ring)]" />
						</motion.div>
					) : null}
				</motion.aside>
			</MotionConfig>
			<div className="soft-grid relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{header ? header : null}
				<main className="min-h-0 min-w-0 flex-1 overflow-hidden p-0">{childrenContent}</main>
			</div>
		</div>
	);
}
