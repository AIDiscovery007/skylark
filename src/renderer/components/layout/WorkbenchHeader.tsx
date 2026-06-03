import { GitCompareArrows, Info, SquareTerminal } from "lucide-react";
import { type Ref, useState } from "react";
import { AgentStatusIndicator } from "@/components/layout/AgentStatusIndicator";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentRuntimeStatus } from "@/lib/agent-runtime-state";

interface WorkbenchHeaderProps {
	workspaceLabel: string;
	sessionTitle: string;
	sessionMeta?: string;
	runtimeState?: AgentRuntimeStatus;
	isReviewOpen?: boolean;
	isTerminalOpen?: boolean;
	isWorkspacePanelOpen?: boolean;
	terminalAvailable?: boolean;
	workspacePanelAvailable?: boolean;
	onOpenReview: () => void;
	onToggleTerminal?: () => void;
	onToggleWorkspacePanel?: () => void;
	reviewButtonRef?: Ref<HTMLButtonElement>;
}

export function WorkbenchHeader({
	workspaceLabel,
	sessionTitle,
	sessionMeta,
	runtimeState,
	isReviewOpen = false,
	isTerminalOpen = false,
	isWorkspacePanelOpen = false,
	terminalAvailable = false,
	workspacePanelAvailable = false,
	onOpenReview,
	onToggleTerminal,
	onToggleWorkspacePanel,
	reviewButtonRef,
}: WorkbenchHeaderProps) {
	const [isReviewTooltipOpen, setIsReviewTooltipOpen] = useState(false);
	const [isTerminalTooltipOpen, setIsTerminalTooltipOpen] = useState(false);
	const [isWorkspaceTooltipOpen, setIsWorkspaceTooltipOpen] = useState(false);
	const terminalLabel = isTerminalOpen ? "收起 Terminal" : "展开 Terminal";
	const workspacePanelLabel = isWorkspacePanelOpen ? "隐藏 Workspace 面板" : "显示 Workspace 面板";

	function handleOpenReview(): void {
		setIsReviewTooltipOpen(false);
		onOpenReview();
	}

	function handleToggleTerminal(): void {
		if (!terminalAvailable || !onToggleTerminal) {
			return;
		}
		setIsTerminalTooltipOpen(false);
		onToggleTerminal();
	}

	function handleToggleWorkspacePanel(): void {
		if (!workspacePanelAvailable || !onToggleWorkspacePanel) {
			return;
		}
		setIsWorkspaceTooltipOpen(false);
		onToggleWorkspacePanel();
	}

	return (
		<div
			className="workbench-header relative grid h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 md:px-7"
			data-slot="panel-header"
		>
			<div
				aria-hidden="true"
				className="workbench-header-drag-region desktop-window-drag-region pointer-events-auto absolute inset-y-0 right-0 z-0"
				data-slot="workbench-header-drag-region"
			/>
			<div
				className="desktop-window-drag-region relative z-10 min-w-0 space-y-0.5"
				data-slot="workbench-header-title-region"
			>
				<h1 className="truncate text-[13px] font-medium leading-5 tracking-tight text-foreground">
					{sessionTitle}
				</h1>
				<p className="truncate text-xs leading-4 text-muted-foreground">{sessionMeta ?? workspaceLabel}</p>
			</div>

			<div
				className="desktop-window-drag-region relative z-10 flex h-full shrink-0 items-center justify-end gap-2"
				data-slot="workbench-header-actions"
			>
				<AgentStatusIndicator runtimeState={runtimeState} />
				<Tooltip
					onOpenChange={(nextOpen: boolean) => {
						if (!nextOpen) {
							setIsTerminalTooltipOpen(false);
						}
					}}
					open={isTerminalTooltipOpen}
				>
					<TooltipTrigger asChild data-slot="icon-button">
						<IconButton
							aria-label={terminalLabel}
							aria-pressed={terminalAvailable ? isTerminalOpen : false}
							className={
								isTerminalOpen ? "bg-[color:var(--surface-2)] text-[color:var(--text-primary)]" : undefined
							}
							data-slot="terminal-toggle"
							data-tooltip-trigger-mode="hover"
							disabled={!terminalAvailable || !onToggleTerminal}
							onBlur={() => setIsTerminalTooltipOpen(false)}
							onClick={handleToggleTerminal}
							onFocus={() => setIsTerminalTooltipOpen(false)}
							onPointerDown={() => setIsTerminalTooltipOpen(false)}
							onPointerEnter={() => setIsTerminalTooltipOpen(true)}
							onPointerLeave={() => setIsTerminalTooltipOpen(false)}
							variant="ghost"
						>
							<SquareTerminal className="size-4" />
						</IconButton>
					</TooltipTrigger>
					<TooltipContent>{terminalAvailable ? terminalLabel : "暂无 Terminal"}</TooltipContent>
				</Tooltip>
				<Tooltip
					onOpenChange={(nextOpen: boolean) => {
						if (!nextOpen) {
							setIsWorkspaceTooltipOpen(false);
						}
					}}
					open={isWorkspaceTooltipOpen}
				>
					<TooltipTrigger asChild data-slot="icon-button">
						<IconButton
							aria-label={workspacePanelLabel}
							aria-pressed={workspacePanelAvailable ? isWorkspacePanelOpen : false}
							className={
								isWorkspacePanelOpen
									? "bg-[color:var(--surface-2)] text-[color:var(--text-primary)]"
									: undefined
							}
							data-slot="workspace-status-toggle"
							data-tooltip-trigger-mode="hover"
							disabled={!workspacePanelAvailable || !onToggleWorkspacePanel}
							onBlur={() => setIsWorkspaceTooltipOpen(false)}
							onClick={handleToggleWorkspacePanel}
							onFocus={() => setIsWorkspaceTooltipOpen(false)}
							onPointerDown={() => setIsWorkspaceTooltipOpen(false)}
							onPointerEnter={() => setIsWorkspaceTooltipOpen(true)}
							onPointerLeave={() => setIsWorkspaceTooltipOpen(false)}
							variant="ghost"
						>
							<Info className="size-4" />
						</IconButton>
					</TooltipTrigger>
					<TooltipContent>{workspacePanelAvailable ? workspacePanelLabel : "暂无 Workspace 面板"}</TooltipContent>
				</Tooltip>
				{!isReviewOpen ? (
					<Tooltip
						onOpenChange={(nextOpen: boolean) => {
							if (!nextOpen) {
								setIsReviewTooltipOpen(false);
							}
						}}
						open={isReviewTooltipOpen}
					>
						<TooltipTrigger asChild data-slot="icon-button">
							<IconButton
								aria-label="审查"
								aria-pressed={false}
								data-tooltip-trigger-mode="hover"
								onBlur={() => setIsReviewTooltipOpen(false)}
								onClick={handleOpenReview}
								onFocus={() => setIsReviewTooltipOpen(false)}
								onPointerDown={() => setIsReviewTooltipOpen(false)}
								onPointerEnter={() => setIsReviewTooltipOpen(true)}
								onPointerLeave={() => setIsReviewTooltipOpen(false)}
								ref={reviewButtonRef}
								variant="ghost"
							>
								<GitCompareArrows className="size-4" />
							</IconButton>
						</TooltipTrigger>
						<TooltipContent>打开工作区差异审查</TooltipContent>
					</Tooltip>
				) : null}
			</div>
		</div>
	);
}
