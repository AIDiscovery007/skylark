import { Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { EntityRow } from "@/components/ui/entity-row";
import { StatusDot } from "@/components/ui/status-dot";
import { collapsibleTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { DesktopSessionSummary } from "../../../shared/types.ts";

export const COLLAPSED_SESSION_LIMIT = 5;
const SESSION_ROW_HEIGHT = 32;
const SESSION_ROW_GAP = 4;

export function formatRelativeUpdatedAt(value: string, now = new Date()): string {
	const timestamp = Date.parse(value);
	if (Number.isNaN(timestamp)) {
		return "未知";
	}

	const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - timestamp) / 60000));
	if (elapsedMinutes < 60) {
		return `${Math.max(1, elapsedMinutes)} 分`;
	}

	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 24) {
		return `${elapsedHours} 小时`;
	}

	const elapsedDays = Math.floor(elapsedHours / 24);
	if (elapsedDays < 7) {
		return `${elapsedDays} 天`;
	}

	return `${Math.max(1, Math.floor(elapsedDays / 7))} 周`;
}

function getSessionTitle(session: DesktopSessionSummary): string {
	if (session.messageCount === 0) {
		return "新对话";
	}

	return session.title;
}

function getVisibleSessions(sessions: DesktopSessionSummary[]): DesktopSessionSummary[] {
	return sessions.filter((session) => session.messageCount > 0 || session.isStreaming);
}

interface SessionListProps {
	sessions: DesktopSessionSummary[];
	activeSessionId?: string;
	disabled?: boolean;
	isExpanded?: boolean;
	now?: Date;
	onDeleteSession?: (sessionId: string, projectId?: string) => Promise<void>;
	onToggleExpanded?: () => void;
	onSelectSession: (sessionId: string, projectId?: string) => Promise<void>;
	projectId?: string;
}

interface SessionRowProps {
	activeSessionId?: string;
	confirmDeleteSessionId?: string;
	deletingSessionId?: string;
	disabled: boolean;
	hasDeleteAction: boolean;
	now?: Date;
	onCancelDelete: () => void;
	onConfirmDelete: (sessionId: string, projectId?: string) => Promise<void>;
	onRequestDelete: (sessionId: string) => void;
	onSelectSession: (sessionId: string, projectId?: string) => Promise<void>;
	projectId?: string;
	session: DesktopSessionSummary;
}

function getOverflowPlaceholderHeight(sessionCount: number): number {
	if (sessionCount <= 0) {
		return 0;
	}

	return sessionCount * SESSION_ROW_HEIGHT + (sessionCount - 1) * SESSION_ROW_GAP;
}

function findDeleteRegion(target: EventTarget | null): HTMLElement | null {
	if (!(target instanceof Element)) {
		return null;
	}

	return target.closest<HTMLElement>("[data-session-delete-region]");
}

function SessionRow({
	activeSessionId,
	confirmDeleteSessionId,
	deletingSessionId,
	disabled,
	hasDeleteAction,
	now,
	onCancelDelete,
	onConfirmDelete,
	onRequestDelete,
	onSelectSession,
	projectId,
	session,
}: SessionRowProps) {
	const isActive = session.id === activeSessionId;
	const isConfirmingDelete = confirmDeleteSessionId === session.id;
	const isDeleting = deletingSessionId === session.id;
	const canDelete = hasDeleteAction && !session.isStreaming;
	const title = getSessionTitle(session);

	return (
		<div className="group/session relative min-w-0 overflow-hidden px-3" key={session.id}>
			<EntityRow
				as="div"
				className={cn(
					"h-8 min-h-8 rounded-[9px] px-0 py-0 text-[13px] before:inset-y-1 before:left-0 hover:bg-[color:var(--color-sidebar-selected-hover)]",
					isActive &&
						"bg-[color:var(--color-sidebar-selected)] text-[color:var(--color-sidebar-active)] shadow-none before:bg-transparent hover:bg-[color:var(--color-sidebar-selected)]",
				)}
				selected={isActive}
				title={
					<button
						aria-current={isActive ? "page" : undefined}
						className={cn(
							"grid h-8 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[9px] pl-9 pr-3 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] disabled:pointer-events-none disabled:opacity-45",
							isActive
								? "text-[color:var(--color-sidebar-active)]"
								: "text-[color:var(--color-sidebar-ink)] hover:text-[color:var(--color-sidebar-active)]",
						)}
						disabled={disabled || isConfirmingDelete}
						onClick={() => {
							if (projectId) {
								void onSelectSession(session.id, projectId);
								return;
							}
							void onSelectSession(session.id);
						}}
						type="button"
					>
						<span className="min-w-0">
							<span className="block truncate text-[13px] font-normal leading-5">{title}</span>
						</span>
						<span
							className={cn(
								"flex min-w-[3.1rem] items-center justify-end gap-1.5 text-right text-[13px] font-normal leading-5 text-[color:var(--color-sidebar-muted)] transition-opacity duration-150",
								canDelete && "group-hover/session:opacity-0",
							)}
						>
							{session.isStreaming ? (
								<StatusDot className="size-1.5" label="Session running" status="running" />
							) : null}
							<span>{formatRelativeUpdatedAt(session.updatedAt, now)}</span>
						</span>
					</button>
				}
			/>
			{canDelete ? (
				<div className="absolute inset-y-0 right-4 flex items-center" data-session-delete-region={session.id}>
					{isConfirmingDelete ? (
						<motion.div
							animate={{ opacity: 1, x: 0 }}
							className="flex items-center gap-1 rounded-md bg-[color:var(--color-sidebar-surface)]/95 p-0.5 shadow-sm ring-1 ring-border/60"
							initial={{ opacity: 0, x: 4 }}
							transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
						>
							<button
								aria-label={`确认删除对话 ${title}`}
								className="h-6 rounded px-2 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:opacity-50"
								disabled={isDeleting}
								onClick={() => {
									void onConfirmDelete(session.id, projectId);
								}}
								type="button"
							>
								删除
							</button>
							<button
								aria-label={`取消删除对话 ${title}`}
								className="h-6 rounded px-2 text-[12px] font-medium text-[color:var(--color-sidebar-muted)] transition-colors hover:bg-[color:var(--color-sidebar-selected-hover)] hover:text-[color:var(--color-sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
								disabled={isDeleting}
								onClick={onCancelDelete}
								type="button"
							>
								取消
							</button>
						</motion.div>
					) : (
						<button
							aria-label={`删除对话 ${title}`}
							className="flex size-6 items-center justify-center rounded-md bg-[color:var(--color-sidebar-surface)]/90 text-[color:var(--color-sidebar-muted)] opacity-0 shadow-sm ring-1 ring-border/0 transition-[background-color,color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-destructive/10 hover:text-destructive hover:ring-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 group-hover/session:opacity-100"
							onClick={() => onRequestDelete(session.id)}
							title="删除"
							type="button"
						>
							<Trash2 className="size-3.5" />
						</button>
					)}
				</div>
			) : null}
		</div>
	);
}

export function SessionList({
	sessions,
	activeSessionId,
	disabled = false,
	isExpanded = false,
	now,
	onDeleteSession,
	onToggleExpanded,
	onSelectSession,
	projectId,
}: SessionListProps) {
	const visibleSessions = getVisibleSessions(sessions);
	const pinnedSessions = visibleSessions.slice(0, COLLAPSED_SESSION_LIMIT);
	const overflowSessions = visibleSessions.slice(COLLAPSED_SESSION_LIMIT);
	const canToggleSessionLimit = visibleSessions.length > COLLAPSED_SESSION_LIMIT;
	const overflowRef = useRef<HTMLDivElement | null>(null);
	const [collapseOverflowHeight, setCollapseOverflowHeight] = useState<number | undefined>();
	const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | undefined>();
	const [deletingSessionId, setDeletingSessionId] = useState<string | undefined>();

	useEffect(() => {
		if (isExpanded || overflowSessions.length === 0) {
			setCollapseOverflowHeight(undefined);
		}
	}, [isExpanded, overflowSessions.length]);

	useEffect(() => {
		if (!confirmDeleteSessionId) {
			return;
		}

		if (!visibleSessions.some((session) => session.id === confirmDeleteSessionId)) {
			setConfirmDeleteSessionId(undefined);
		}
	}, [confirmDeleteSessionId, visibleSessions]);

	useEffect(() => {
		if (!confirmDeleteSessionId) {
			return;
		}

		function handlePointerDown(event: PointerEvent): void {
			const deleteRegion = findDeleteRegion(event.target);
			if (deleteRegion?.dataset.sessionDeleteRegion === confirmDeleteSessionId) {
				return;
			}

			setConfirmDeleteSessionId(undefined);
		}

		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key === "Escape") {
				setConfirmDeleteSessionId(undefined);
			}
		}

		document.addEventListener("pointerdown", handlePointerDown, true);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown, true);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [confirmDeleteSessionId]);

	function handleToggleExpanded(): void {
		if (isExpanded) {
			const currentHeight = overflowRef.current?.offsetHeight ?? 0;
			setCollapseOverflowHeight(
				currentHeight > 0 ? currentHeight : getOverflowPlaceholderHeight(overflowSessions.length),
			);
		} else {
			setCollapseOverflowHeight(undefined);
		}
		onToggleExpanded?.();
	}

	async function handleConfirmDelete(sessionId: string, targetProjectId?: string): Promise<void> {
		if (!onDeleteSession) {
			return;
		}

		setDeletingSessionId(sessionId);
		try {
			await onDeleteSession(sessionId, targetProjectId);
			setConfirmDeleteSessionId(undefined);
		} finally {
			setDeletingSessionId(undefined);
		}
	}

	if (visibleSessions.length === 0) {
		return (
			<div className="px-3 py-1.5">
				<div className="h-8 rounded-[9px] px-9 py-1.5">
					<span className="sidebar-empty-hint text-[13px] leading-5">暂无对话</span>
				</div>
			</div>
		);
	}

	return (
		<div className="grid gap-1 pb-1" data-resize-motion="contents-static" data-slot="sidebar-session-list">
			{pinnedSessions.map((session) => (
				<SessionRow
					activeSessionId={activeSessionId}
					confirmDeleteSessionId={confirmDeleteSessionId}
					deletingSessionId={deletingSessionId}
					disabled={disabled}
					hasDeleteAction={Boolean(onDeleteSession)}
					key={session.id}
					now={now}
					onCancelDelete={() => setConfirmDeleteSessionId(undefined)}
					onConfirmDelete={handleConfirmDelete}
					onRequestDelete={setConfirmDeleteSessionId}
					onSelectSession={onSelectSession}
					projectId={projectId}
					session={session}
				/>
			))}

			{isExpanded ? (
				<motion.div
					animate={{ height: "auto", opacity: 1, y: 0 }}
					className="grid min-w-0 gap-1 overflow-hidden"
					data-slot="sidebar-session-overflow"
					initial={{ height: 0, opacity: 0, y: -3 }}
					ref={overflowRef}
					transition={collapsibleTransition}
				>
					{overflowSessions.map((session) => (
						<SessionRow
							activeSessionId={activeSessionId}
							confirmDeleteSessionId={confirmDeleteSessionId}
							deletingSessionId={deletingSessionId}
							disabled={disabled}
							hasDeleteAction={Boolean(onDeleteSession)}
							key={session.id}
							now={now}
							onCancelDelete={() => setConfirmDeleteSessionId(undefined)}
							onConfirmDelete={handleConfirmDelete}
							onRequestDelete={setConfirmDeleteSessionId}
							onSelectSession={onSelectSession}
							projectId={projectId}
							session={session}
						/>
					))}
				</motion.div>
			) : collapseOverflowHeight !== undefined ? (
				<motion.div
					animate={{ height: 0 }}
					aria-hidden
					className="min-w-0 overflow-hidden [overflow-anchor:none]"
					data-slot="sidebar-session-collapse-placeholder"
					initial={{ height: collapseOverflowHeight }}
					onAnimationComplete={() => setCollapseOverflowHeight(undefined)}
					transition={collapsibleTransition}
				/>
			) : null}

			{canToggleSessionLimit ? (
				<div className="px-3">
					<button
						className="ml-9 w-fit rounded-md px-0 py-1 text-[13px] font-normal leading-5 text-[color:var(--color-sidebar-muted)] transition-colors hover:text-[color:var(--color-sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
						onClick={handleToggleExpanded}
						type="button"
					>
						{isExpanded ? "折叠显示" : "展开显示"}
					</button>
				</div>
			) : null}
		</div>
	);
}
