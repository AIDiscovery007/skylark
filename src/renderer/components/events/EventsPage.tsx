import {
	ArchiveRestore,
	Check,
	CircleDashed,
	Clock3,
	Eye,
	EyeOff,
	FileText,
	FolderPlus,
	Inbox,
	ListChecks,
	MessageSquare,
	Paperclip,
	Play,
	RefreshCw,
	Trash2,
	WandSparkles,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type {
	DesktopEventDetail,
	DesktopEventManagementApplyRequest,
	DesktopEventManagementProposal,
	DesktopEventManagementProposalRequest,
	DesktopEventPriority,
	DesktopEventRun,
	DesktopEventRunRequest,
	DesktopEventRunResult,
	DesktopEventStatus,
	DesktopEventSummary,
	DesktopProjectSummary,
} from "../../../shared/types.ts";
import { MessageResponse } from "../ai-elements/message.tsx";
import { WorkbenchPageHeader } from "../layout/WorkbenchPageHeader.tsx";
import { formatRelativeUpdatedAt } from "../sidebar/SessionList.tsx";
import { Button } from "../ui/button.tsx";
import { IconButton } from "../ui/icon-button.tsx";
import { ScrollArea } from "../ui/scroll-area.tsx";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "../ui/sheet.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { StatusDot } from "../ui/status-dot.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { VirtualStack } from "../ui/virtual-stack.tsx";

const EVENT_STATUS_LABELS: Record<DesktopEventStatus, string> = {
	inbox: "待评估",
	ready: "待处理",
	running: "进行中",
	completed: "已完成",
	discarded: "已丢弃",
};

const EVENT_RUN_STATUS_LABELS: Record<DesktopEventRun["status"], string> = {
	running: "运行中",
	awaiting_review: "待确认",
	failed: "失败",
	aborted: "已中止",
};

const DEFAULT_COLUMNS: DesktopEventStatus[] = ["inbox", "ready", "running", "completed"];
const DISCARDED_COLUMNS: DesktopEventStatus[] = [...DEFAULT_COLUMNS, "discarded"];
const EVENT_PRIORITIES: DesktopEventPriority[] = ["P0", "P1", "P2", "P3"];

type EventManagementProgress =
	| { status: "running"; startedAt: Date }
	| { status: "completed"; itemCount: number; startedAt: Date }
	| { status: "failed"; startedAt: Date };

interface EventsPageProps {
	activeEvent?: DesktopEventDetail;
	activeEventId?: string;
	activeProjectId?: string;
	errorMessage?: string;
	eventManagementProposal?: DesktopEventManagementProposal;
	events: DesktopEventSummary[];
	isLoading: boolean;
	isManagingEvents: boolean;
	isRunning: boolean;
	isSaving: boolean;
	isSidebarCollapsed?: boolean;
	onAddEventComment: (input: { eventId: string; body: string }) => Promise<DesktopEventDetail | undefined>;
	onApplyEventManagementProposal: (
		request: DesktopEventManagementApplyRequest,
	) => Promise<DesktopEventDetail[] | undefined>;
	onClearEventManagementProposal: () => void;
	onCreateProjectFromFolder: () => Promise<void>;
	onCreateEventManagementProposal: (
		request?: DesktopEventManagementProposalRequest,
	) => Promise<DesktopEventManagementProposal | undefined>;
	onDeleteEvent: (eventId: string) => Promise<void>;
	onOpenSession: (sessionId: string, projectId: string) => Promise<void>;
	onRefreshEvents: () => Promise<void>;
	onRunEvent: (request: DesktopEventRunRequest) => Promise<DesktopEventRunResult | undefined>;
	onSelectEvent: (eventId: string) => Promise<void>;
	onSetEventStatus: (eventId: string, status: DesktopEventStatus) => Promise<DesktopEventDetail | undefined>;
	onUpdateEvent: (
		eventId: string,
		input: { title?: string; body?: string },
	) => Promise<DesktopEventDetail | undefined>;
	projects: DesktopProjectSummary[];
}

function getStatusIcon(status: DesktopEventStatus) {
	switch (status) {
		case "inbox":
			return Inbox;
		case "ready":
			return ListChecks;
		case "running":
			return CircleDashed;
		case "completed":
			return Check;
		case "discarded":
			return X;
	}
}

function getPriorityRank(priority: DesktopEventPriority | undefined): number {
	return priority ? EVENT_PRIORITIES.indexOf(priority) : EVENT_PRIORITIES.length;
}

function sortEventSummaries(events: DesktopEventSummary[]): DesktopEventSummary[] {
	return [...events].sort((left, right) => {
		const priorityDelta = getPriorityRank(left.priority) - getPriorityRank(right.priority);
		if (priorityDelta !== 0) {
			return priorityDelta;
		}
		const updatedDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
		if (updatedDelta !== 0) {
			return updatedDelta;
		}
		return right.id.localeCompare(left.id);
	});
}

function formatElapsedSeconds(startedAt: Date, now: Date): string {
	const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
	return `${elapsedSeconds} 秒`;
}

function EventManagementProgressFloat({
	now,
	onDismiss,
	progress,
}: {
	now: Date;
	onDismiss: () => void;
	progress?: EventManagementProgress;
}) {
	if (!progress) {
		return null;
	}
	const isRunning = progress.status === "running";
	const isCompleted = progress.status === "completed";
	const canDismiss = !isRunning;
	const label = isRunning ? "正在整理事件" : isCompleted ? "整理事件完成" : "整理事件失败";
	const detail = isRunning
		? `根据 EVENTS.md 评估活跃事件，已用时 ${formatElapsedSeconds(progress.startedAt, now)}`
		: isCompleted
			? `已生成 ${progress.itemCount} 条整理建议`
			: "整理失败，查看上方错误信息";

	return (
		<div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center">
			<div
				className={cn(
					"group pointer-events-auto grid max-w-[min(420px,100%)] items-center gap-3 rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] py-2.5 text-left shadow-[var(--shadow-modal)]",
					canDismiss
						? "grid-cols-[auto_minmax(0,1fr)_1.5rem] pr-2 pl-3.5"
						: "grid-cols-[auto_minmax(0,1fr)] px-3.5",
				)}
				data-slot="event-management-progress-float"
			>
				{isRunning ? (
					<Spinner className="size-4 text-[color:var(--info)]" label="整理事件中" />
				) : (
					<StatusDot className="size-2.5" label={label} status={isCompleted ? "success" : "error"} />
				)}
				<output aria-label={label} aria-live="polite" className="grid min-w-0 gap-0.5">
					<span className="truncate text-[12px] font-medium text-[color:var(--text-primary)]">{label}</span>
					<span className="truncate text-[11px] text-[color:var(--text-tertiary)]">{detail}</span>
				</output>
				{canDismiss ? (
					<button
						aria-label="关闭整理状态"
						className="grid size-6 place-items-center rounded-[6px] text-[color:var(--text-tertiary)] opacity-0 transition-[background-color,color,opacity] duration-[var(--duration-fast)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] group-hover:opacity-100 group-focus-within:opacity-100"
						onClick={onDismiss}
						title="关闭整理状态"
						type="button"
					>
						<X className="size-3.5" />
					</button>
				) : null}
			</div>
		</div>
	);
}

const EVENT_RUN_THINKING_PROMPT = "请先深入思考目标、约束和风险，再给出清晰的下一步行动。";

function createEventRunPrompt(problem: string): string {
	const sections = [problem.trim() || undefined, EVENT_RUN_THINKING_PROMPT].filter((section): section is string =>
		Boolean(section),
	);
	return sections.join("\n\n");
}

function getLatestRun(event: DesktopEventDetail | undefined): DesktopEventRun | undefined {
	return event?.runs.at(-1);
}

function getUsableAttachmentIds(event: DesktopEventDetail | undefined): string[] {
	return (
		event?.attachments
			.filter((attachment) => attachment.textSnapshot && !attachment.extractionError)
			.map((attachment) => attachment.id) ?? []
	);
}

function EventCard({
	event,
	isActive,
	now,
	onSelect,
}: {
	event: DesktopEventSummary;
	isActive: boolean;
	now: Date;
	onSelect: (eventId: string) => Promise<void>;
}) {
	const hasRun = Boolean(event.latestRunStatus);
	return (
		<button
			aria-current={isActive ? "true" : undefined}
			className={cn(
				"grid min-h-[86px] w-full gap-2 rounded-[8px] border border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] px-3.5 py-3 text-left shadow-[var(--shadow-minimal)] transition-[background-color,border-color,color] duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
				isActive &&
					"border-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_10%,var(--surface-1))]",
			)}
			onClick={() => {
				void onSelect(event.id);
			}}
			type="button"
		>
			<span className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
				<span className="line-clamp-2 text-[13px] font-medium leading-5 text-[color:var(--text-primary)]">
					{event.title}
				</span>
				{event.priority ? (
					<span className="h-5 rounded-[6px] bg-[color:var(--surface-3)] px-1.5 text-[11px] font-medium leading-5 text-[color:var(--text-secondary)]">
						{event.priority}
					</span>
				) : null}
			</span>
			<span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[12px] leading-4 text-[color:var(--text-tertiary)]">
				<span className="flex min-w-0 items-center gap-1.5">
					<Clock3 className="size-3.5 shrink-0" />
					<span className="truncate">记录 {formatRelativeUpdatedAt(event.createdAt, now)}</span>
				</span>
				<span />
				<span className="flex items-center gap-1.5">
					{event.attachmentCount > 0 ? (
						<span className="flex items-center gap-1">
							<Paperclip className="size-3.5" />
							<span className="tabular-nums">{event.attachmentCount}</span>
						</span>
					) : null}
					{event.commentCount > 0 ? (
						<span className="flex items-center gap-1">
							<MessageSquare className="size-3.5" />
							<span className="tabular-nums">{event.commentCount}</span>
						</span>
					) : null}
					{hasRun ? (
						<StatusDot
							className="size-1.5"
							label={EVENT_RUN_STATUS_LABELS[event.latestRunStatus!]}
							status={
								event.latestRunStatus === "failed"
									? "error"
									: event.latestRunStatus === "running"
										? "running"
										: "idle"
							}
						/>
					) : null}
				</span>
			</span>
		</button>
	);
}

function EventColumn({
	events,
	now,
	status,
	activeEventId,
	onSelectEvent,
}: {
	activeEventId?: string;
	events: DesktopEventSummary[];
	now: Date;
	onSelectEvent: (eventId: string) => Promise<void>;
	status: DesktopEventStatus;
}) {
	const Icon = getStatusIcon(status);
	return (
		<section className="grid min-h-0 min-w-[190px] grid-rows-[auto_minmax(0,1fr)] gap-2" data-event-status={status}>
			<header className="grid h-8 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 text-[12px] text-[color:var(--text-secondary)]">
				<Icon className="size-3.5" />
				<h2 className="truncate font-medium">{EVENT_STATUS_LABELS[status]}</h2>
				<span className="tabular-nums text-[color:var(--text-tertiary)]">{events.length}</span>
			</header>
			{events.length === 0 ? (
				<div className="grid min-h-0 pr-2">
					<div className="grid h-[86px] place-items-center rounded-[8px] border border-dashed border-[color:var(--border-subtle)] px-3 py-3 text-[12px] text-[color:var(--text-tertiary)]">
						空
					</div>
				</div>
			) : (
				<VirtualStack
					ariaLabel={`${EVENT_STATUS_LABELS[status]} events`}
					className="native-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain"
					dataSlot={`event-column-${status}-virtual-list`}
					estimateSize={() => 94}
					gap={8}
					getKey={(event) => event.id}
					initialViewportHeight={520}
					itemClassName="pr-2"
					items={events}
					measureItems
					overscan={5}
					paddingEnd={16}
					renderItem={({ item: event }) => (
						<EventCard event={event} isActive={event.id === activeEventId} now={now} onSelect={onSelectEvent} />
					)}
				/>
			)}
		</section>
	);
}

function EventInspector({
	activeEvent,
	activeProjectId,
	isRunning,
	isSaving,
	onAddEventComment,
	onCreateProjectFromFolder,
	onDeleteEvent,
	onOpenSession,
	onRunEvent,
	onSetEventStatus,
	onUpdateEvent,
	projects,
}: Pick<
	EventsPageProps,
	| "activeEvent"
	| "activeProjectId"
	| "isRunning"
	| "isSaving"
	| "onAddEventComment"
	| "onCreateProjectFromFolder"
	| "onDeleteEvent"
	| "onOpenSession"
	| "onRunEvent"
	| "onSetEventStatus"
	| "onUpdateEvent"
	| "projects"
>) {
	const [body, setBody] = useState("");
	const [savedBody, setSavedBody] = useState("");
	const [projectId, setProjectId] = useState(activeProjectId ?? "");
	const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
	const [commentDraft, setCommentDraft] = useState("");
	const [confirmDelete, setConfirmDelete] = useState(false);
	const activeRun = activeEvent?.runs.find((run) => run.status === "running");
	const latestRun = getLatestRun(activeEvent);
	const hasChanges = Boolean(activeEvent && body !== savedBody);
	const canRun = Boolean(activeEvent && projectId && !activeRun && (body.trim() || selectedAttachmentIds.length > 0));

	useEffect(() => {
		if (!activeEvent) {
			setBody("");
			setSavedBody("");
			setSelectedAttachmentIds([]);
			setCommentDraft("");
			return;
		}
		setBody(activeEvent.body);
		setSavedBody(activeEvent.body);
		setSelectedAttachmentIds(getUsableAttachmentIds(activeEvent));
		setCommentDraft("");
		setConfirmDelete(false);
	}, [activeEvent]);

	useEffect(() => {
		setProjectId((current) => current || activeProjectId || projects[0]?.id || "");
	}, [activeProjectId, projects]);

	if (!activeEvent) {
		return (
			<aside className="grid min-h-0 bg-[color:var(--surface-1)]">
				<div className="grid place-items-center px-5 text-center text-[13px] leading-6 text-[color:var(--text-tertiary)]">
					选择一个事件
				</div>
			</aside>
		);
	}

	async function persistEventBodyIfNeeded(): Promise<string | undefined> {
		if (!activeEvent) {
			return undefined;
		}
		if (!hasChanges) {
			return body;
		}
		const updatedEvent = await onUpdateEvent(activeEvent.id, { body });
		if (!updatedEvent) {
			return undefined;
		}
		const updatedProblem = updatedEvent.body;
		setBody(updatedProblem);
		setSavedBody(updatedProblem);
		return updatedProblem;
	}

	async function saveEvent(): Promise<void> {
		await persistEventBodyIfNeeded();
	}

	async function runEvent(): Promise<void> {
		if (!activeEvent || !canRun) {
			return;
		}
		const problem = await persistEventBodyIfNeeded();
		if (problem === undefined) {
			return;
		}
		await onRunEvent({
			eventId: activeEvent.id,
			projectId,
			promptText: createEventRunPrompt(problem),
			attachmentIds: selectedAttachmentIds,
		});
	}

	async function addComment(): Promise<void> {
		if (!activeEvent || !commentDraft.trim()) {
			return;
		}
		const updatedEvent = await onAddEventComment({ eventId: activeEvent.id, body: commentDraft });
		if (updatedEvent) {
			setCommentDraft("");
		}
	}

	return (
		<aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-[color:var(--surface-1)]">
			<header className="grid gap-2 px-5 pt-4 pb-3">
				<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
					<h2
						className="line-clamp-2 min-h-10 pt-1 pr-2 text-[14px] font-semibold leading-5 text-[color:var(--text-primary)]"
						data-slot="event-inspector-title"
						title={activeEvent.title}
					>
						{activeEvent.title}
					</h2>
					<SheetClose asChild>
						<Button
							aria-label="关闭事件详情"
							className="size-9 rounded-[9px] bg-transparent text-[color:var(--text-tertiary)] shadow-none hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)]"
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<X className="size-4" />
						</Button>
					</SheetClose>
				</div>
				<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-1">
					<span className="text-[12px] text-[color:var(--text-tertiary)]">
						记录 {formatRelativeUpdatedAt(activeEvent.createdAt)}
					</span>
					<Button
						className="h-7 border-transparent bg-[color:var(--surface-2)] px-3 shadow-none hover:bg-[color:var(--surface-3)]"
						disabled={!hasChanges || isSaving}
						onClick={() => void saveEvent()}
						size="xs"
						variant="outline"
					>
						保存
					</Button>
				</div>
			</header>
			<ScrollArea className="min-h-0">
				<div className="grid gap-5 px-5 pt-2 pb-5">
					<section className="grid gap-2">
						<h3 className="px-1 text-[12px] font-medium text-[color:var(--text-secondary)]">运行</h3>
						<div className="grid gap-3 rounded-[12px] bg-[color:var(--surface-2)] p-3">
							<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
								<select
									aria-label="选择运行项目"
									className="h-8 min-w-0 rounded-[8px] border border-transparent bg-[color:var(--surface-1)] px-3 text-[13px] text-[color:var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
									onChange={(event) => setProjectId(event.currentTarget.value)}
									value={projectId}
								>
									{projects.map((project) => (
										<option key={project.id} value={project.id}>
											{project.name}
										</option>
									))}
								</select>
								<Button
									aria-label="添加本地文件夹项目"
									className="border-transparent bg-[color:var(--surface-1)] shadow-none hover:bg-[color:var(--surface-3)]"
									disabled={isSaving}
									onClick={() => {
										void onCreateProjectFromFolder();
									}}
									size="icon-sm"
									type="button"
									variant="outline"
								>
									<FolderPlus className="size-3.5" />
								</Button>
							</div>
							<Textarea
								aria-label="事件问题"
								className="min-h-40 resize-none border-transparent bg-[color:var(--surface-1)] px-3.5 py-3 text-[13px] leading-5 shadow-none focus-visible:border-transparent focus-visible:ring-2"
								onChange={(event) => setBody(event.currentTarget.value)}
								value={body}
							/>
							{activeEvent.attachments.length > 0 ? (
								<div className="grid gap-1">
									{activeEvent.attachments.map((attachment) => {
										const disabled = Boolean(attachment.extractionError || !attachment.textSnapshot);
										const checked = selectedAttachmentIds.includes(attachment.id);
										return (
											<label
												className={cn(
													"grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-[7px] px-2 py-1.5 text-[12px] text-[color:var(--text-secondary)]",
													disabled && "text-[color:var(--text-tertiary)]",
												)}
												key={attachment.id}
											>
												<input
													checked={checked}
													className="size-3.5 accent-[color:var(--accent)]"
													disabled={disabled}
													onChange={(event) => {
														const nextChecked = event.currentTarget.checked;
														setSelectedAttachmentIds((current) =>
															nextChecked
																? [...current, attachment.id]
																: current.filter((id) => id !== attachment.id),
														);
													}}
													type="checkbox"
												/>
												<span className="truncate">{attachment.name}</span>
											</label>
										);
									})}
								</div>
							) : null}
							<Button
								disabled={!canRun || isRunning || isSaving}
								onClick={() => void runEvent()}
								size="sm"
								type="button"
							>
								<Play className="size-3.5" />
								运行事件
							</Button>
						</div>
					</section>

					<section className="grid gap-2">
						<h3 className="px-1 text-[12px] font-medium text-[color:var(--text-secondary)]">状态</h3>
						<div className="grid grid-cols-2 gap-2">
							{(["inbox", "ready", "completed", "discarded"] as const).map((status) => (
								<Button
									aria-pressed={activeEvent.status === status}
									className={cn(
										"h-8 rounded-[8px] border-transparent bg-[color:var(--surface-2)] text-[12px] text-[color:var(--text-secondary)] shadow-none hover:bg-[color:var(--surface-3)] hover:text-[color:var(--text-primary)]",
										activeEvent.status === status &&
											"bg-[color:var(--surface-3)] text-[color:var(--text-primary)]",
									)}
									disabled={isSaving}
									key={status}
									onClick={() => {
										if (activeEvent.status === status) {
											return;
										}
										void onSetEventStatus(activeEvent.id, status);
									}}
									size="xs"
									type="button"
									variant="ghost"
								>
									{status === "discarded" && activeEvent.status === "discarded" ? (
										<ArchiveRestore className="size-3" />
									) : null}
									{EVENT_STATUS_LABELS[status]}
								</Button>
							))}
						</div>
					</section>

					<section className="grid gap-2">
						<h3 className="px-1 text-[12px] font-medium text-[color:var(--text-secondary)]">附件</h3>
						<div className="grid gap-1.5">
							{activeEvent.attachments.length === 0 ? (
								<p className="rounded-[10px] bg-[color:var(--surface-2)] px-3.5 py-3 text-[12px] text-[color:var(--text-tertiary)]">
									无附件
								</p>
							) : (
								activeEvent.attachments.map((attachment) => (
									<div
										className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-[10px] bg-[color:var(--surface-2)] px-3.5 py-3 text-[12px]"
										key={attachment.id}
									>
										<FileText className="size-3.5 text-[color:var(--text-tertiary)]" />
										<span className="min-w-0">
											<span className="block truncate text-[color:var(--text-secondary)]">
												{attachment.name}
											</span>
											<span className="block truncate text-[color:var(--text-tertiary)]">
												{attachment.extractionError ? attachment.extractionError : "文本快照可用"}
											</span>
										</span>
									</div>
								))
							)}
						</div>
					</section>

					<section className="grid gap-2">
						<h3 className="px-1 text-[12px] font-medium text-[color:var(--text-secondary)]">历史</h3>
						{activeEvent.runs.length === 0 ? (
							<p className="rounded-[10px] bg-[color:var(--surface-2)] px-3.5 py-3 text-[12px] text-[color:var(--text-tertiary)]">
								尚未运行
							</p>
						) : (
							<div className="grid gap-2">
								{activeEvent.runs
									.slice()
									.reverse()
									.map((run) => (
										<div
											className="grid gap-2 rounded-[10px] bg-[color:var(--surface-2)] px-3.5 py-3 text-[12px]"
											key={run.id}
										>
											<div className="flex items-center justify-between gap-2">
												<span className="flex min-w-0 items-center gap-1.5 text-[color:var(--text-secondary)]">
													<StatusDot
														className="size-1.5"
														label={EVENT_RUN_STATUS_LABELS[run.status]}
														status={
															run.status === "failed"
																? "error"
																: run.status === "running"
																	? "running"
																	: "idle"
														}
													/>
													<span>{EVENT_RUN_STATUS_LABELS[run.status]}</span>
												</span>
												<span className="shrink-0 text-[color:var(--text-tertiary)]">
													{formatRelativeUpdatedAt(run.updatedAt)}
												</span>
											</div>
											{run.errorMessage ? (
												<p className="line-clamp-2 text-destructive">{run.errorMessage}</p>
											) : null}
											{run.sessionId ? (
												<Button
													className="h-8 border-transparent bg-[color:var(--surface-1)] shadow-none hover:bg-[color:var(--surface-3)]"
													onClick={() => {
														void onOpenSession(run.sessionId!, run.projectId);
													}}
													size="xs"
													type="button"
													variant="outline"
												>
													打开 session
												</Button>
											) : null}
										</div>
									))}
							</div>
						)}
					</section>

					<section className="grid gap-2">
						<h3 className="px-1 text-[12px] font-medium text-[color:var(--text-secondary)]">评论</h3>
						<div className="grid gap-2">
							{activeEvent.comments.length === 0 ? (
								<p className="rounded-[10px] bg-[color:var(--surface-2)] px-3.5 py-3 text-[12px] text-[color:var(--text-tertiary)]">
									暂无评论
								</p>
							) : (
								activeEvent.comments.map((comment) => (
									<div
										className="grid gap-1 rounded-[10px] bg-[color:var(--surface-2)] px-3.5 py-3 text-[12px]"
										key={comment.id}
									>
										<div className="flex items-center justify-between gap-2 text-[color:var(--text-tertiary)]">
											<span>{comment.author === "agent" ? "Agent" : "用户"}</span>
											<span>{formatRelativeUpdatedAt(comment.createdAt)}</span>
										</div>
										<p className="whitespace-pre-wrap leading-5 text-[color:var(--text-secondary)]">
											{comment.body}
										</p>
									</div>
								))
							)}
							<Textarea
								aria-label="事件评论"
								className="min-h-20 resize-none border-transparent bg-[color:var(--surface-2)] px-3.5 py-3 text-[13px] leading-5 shadow-none focus-visible:border-transparent focus-visible:ring-2"
								onChange={(event) => setCommentDraft(event.currentTarget.value)}
								value={commentDraft}
							/>
							<Button
								className="h-8 border-transparent bg-[color:var(--surface-2)] shadow-none hover:bg-[color:var(--surface-3)]"
								disabled={!commentDraft.trim() || isSaving}
								onClick={() => void addComment()}
								size="sm"
								type="button"
								variant="outline"
							>
								<MessageSquare className="size-3.5" />
								添加评论
							</Button>
						</div>
					</section>

					<section className="grid gap-2">
						{latestRun?.sessionId ? (
							<Button
								className="h-8 border-transparent bg-[color:var(--surface-2)] shadow-none hover:bg-[color:var(--surface-3)]"
								onClick={() => {
									void onOpenSession(latestRun.sessionId!, latestRun.projectId);
								}}
								size="sm"
								type="button"
								variant="outline"
							>
								打开最新 session
							</Button>
						) : null}
						<Button
							className={cn(
								"h-8 border-transparent shadow-none",
								confirmDelete
									? "bg-[color:var(--destructive)]"
									: "bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-3)]",
							)}
							disabled={isSaving}
							onClick={() => {
								if (!confirmDelete) {
									setConfirmDelete(true);
									return;
								}
								void onDeleteEvent(activeEvent.id);
							}}
							size="sm"
							type="button"
							variant={confirmDelete ? "destructive" : "outline"}
						>
							<Trash2 className="size-3.5" />
							{confirmDelete ? "确认删除" : "彻底删除"}
						</Button>
					</section>
				</div>
			</ScrollArea>
		</aside>
	);
}

export function EventsPage({
	activeEvent,
	activeEventId,
	activeProjectId,
	errorMessage,
	eventManagementProposal,
	events,
	isLoading,
	isManagingEvents,
	isRunning,
	isSaving,
	isSidebarCollapsed = false,
	onAddEventComment,
	onApplyEventManagementProposal,
	onClearEventManagementProposal,
	onCreateProjectFromFolder,
	onCreateEventManagementProposal,
	onDeleteEvent,
	onOpenSession,
	onRefreshEvents,
	onRunEvent,
	onSelectEvent,
	onSetEventStatus,
	onUpdateEvent,
	projects,
}: EventsPageProps) {
	const [isInspectorOpen, setIsInspectorOpen] = useState(false);
	const [showDiscarded, setShowDiscarded] = useState(false);
	const [isManagementConfirmOpen, setIsManagementConfirmOpen] = useState(false);
	const [selectedProposalItemIds, setSelectedProposalItemIds] = useState<string[]>([]);
	const [managementProgress, setManagementProgress] = useState<EventManagementProgress | undefined>();
	const [now, setNow] = useState(() => new Date());
	const managementConfirmRegionRef = useRef<HTMLDivElement | null>(null);
	const columns = showDiscarded ? DISCARDED_COLUMNS : DEFAULT_COLUMNS;
	const visibleEvents = useMemo(
		() => sortEventSummaries(events.filter((event) => showDiscarded || event.status !== "discarded")),
		[events, showDiscarded],
	);
	const eventsByStatus = useMemo(
		() =>
			Object.fromEntries(
				columns.map((status) => [status, visibleEvents.filter((event) => event.status === status)]),
			) as Record<DesktopEventStatus, DesktopEventSummary[]>,
		[columns, visibleEvents],
	);
	const eventsById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
	const activeCount = events.filter((event) => event.status === "running").length;
	const discardedToggleLabel = showDiscarded ? "隐藏丢弃" : "显示丢弃";
	const isManagementWorking = isManagingEvents || managementProgress?.status === "running";
	const visibleManagementProgress =
		managementProgress ?? (isManagingEvents ? { status: "running" as const, startedAt: now } : undefined);

	useEffect(() => {
		const intervalMs = managementProgress?.status === "running" ? 1_000 : 60_000;
		const intervalId = window.setInterval(() => setNow(new Date()), intervalMs);
		return () => window.clearInterval(intervalId);
	}, [managementProgress?.status]);

	useEffect(() => {
		if (!activeEvent) {
			setIsInspectorOpen(false);
		}
	}, [activeEvent]);

	useEffect(() => {
		setSelectedProposalItemIds(eventManagementProposal?.items.map((item) => item.id) ?? []);
	}, [eventManagementProposal]);

	useEffect(() => {
		if (!isManagementConfirmOpen) {
			return;
		}

		function closeManagementConfirmOnOutsidePointerDown(event: PointerEvent): void {
			const target = event.target;
			if (!(target instanceof Node) || managementConfirmRegionRef.current?.contains(target)) {
				return;
			}
			setIsManagementConfirmOpen(false);
		}

		window.addEventListener("pointerdown", closeManagementConfirmOnOutsidePointerDown, true);
		return () => {
			window.removeEventListener("pointerdown", closeManagementConfirmOnOutsidePointerDown, true);
		};
	}, [isManagementConfirmOpen]);

	async function selectEvent(eventId: string): Promise<void> {
		setIsInspectorOpen(true);
		await onSelectEvent(eventId);
	}

	async function createManagementProposal(): Promise<void> {
		const startedAt = new Date();
		setIsManagementConfirmOpen(false);
		setNow(startedAt);
		setManagementProgress({ status: "running", startedAt });
		try {
			const proposal = await onCreateEventManagementProposal();
			setManagementProgress(
				proposal
					? { status: "completed", itemCount: proposal.items.length, startedAt }
					: { status: "failed", startedAt },
			);
		} catch {
			setManagementProgress({ status: "failed", startedAt });
		}
	}

	async function applySelectedProposalItems(): Promise<void> {
		if (!eventManagementProposal || selectedProposalItemIds.length === 0) {
			return;
		}
		await onApplyEventManagementProposal({
			proposalId: eventManagementProposal.id,
			selectedItemIds: selectedProposalItemIds,
			items: eventManagementProposal.items,
		});
	}

	return (
		<div
			className="relative grid h-full min-h-0 select-none grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-[color:var(--border-subtle)] bg-[color:var(--background)] shadow-[var(--shadow-middle)]"
			data-slot="events-workbench"
		>
			<WorkbenchPageHeader
				actions={
					<>
						{isManagementConfirmOpen ? (
							<div
								className="flex items-center gap-1 rounded-[7px] bg-[color:var(--surface-1)]/95 p-0.5 shadow-[var(--shadow-minimal)] ring-1 ring-[color:var(--border-subtle)]"
								data-event-management-confirm-region="true"
								ref={managementConfirmRegionRef}
							>
								<button
									aria-label="确认整理事件"
									className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-[color:var(--accent)] transition-colors hover:bg-[color:color-mix(in_oklch,var(--accent)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] disabled:opacity-50"
									disabled={isManagementWorking}
									onClick={() => void createManagementProposal()}
									type="button"
								>
									<WandSparkles className="size-3" />
									整理
								</button>
								<button
									aria-label="取消整理事件"
									className="h-7 rounded-[6px] px-2 text-[12px] font-medium text-[color:var(--text-tertiary)] transition-colors hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] disabled:opacity-50"
									disabled={isManagementWorking}
									onClick={() => setIsManagementConfirmOpen(false)}
									type="button"
								>
									取消
								</button>
							</div>
						) : (
							<IconButton
								aria-label="整理事件"
								disabled={isManagementWorking}
								onClick={() => setIsManagementConfirmOpen(true)}
								title="整理事件"
							>
								<WandSparkles className="size-3.5" />
							</IconButton>
						)}
						<IconButton
							aria-label={discardedToggleLabel}
							aria-pressed={showDiscarded}
							className={cn(showDiscarded && "bg-[color:var(--surface-2)] text-[color:var(--text-primary)]")}
							onClick={() => setShowDiscarded((current) => !current)}
							title={discardedToggleLabel}
						>
							{showDiscarded ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
						</IconButton>
						<IconButton
							aria-label="刷新事件"
							disabled={isLoading}
							onClick={() => {
								void onRefreshEvents();
							}}
							title="刷新事件"
						>
							<RefreshCw className="size-3.5" />
						</IconButton>
					</>
				}
				description={`${events.length} 个记录，${activeCount} 个进行中`}
				divider="none"
				headerSlot="events-panel-header"
				title="事件"
				titlebarInset={isSidebarCollapsed ? "app-titlebar-controls" : "none"}
				titlebarSlot="events-titlebar-row"
			/>

			<div className="min-h-0 overflow-hidden">
				<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden px-4 py-3">
					<div className="grid gap-3">
						{errorMessage ? (
							<p className="rounded-[8px] bg-destructive/8 px-3 py-2 text-[12px] text-destructive">
								{errorMessage}
							</p>
						) : null}
						{eventManagementProposal ? (
							<section className="grid gap-3 rounded-[8px] border border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] p-3">
								<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
									<h2 className="truncate text-[13px] font-medium text-[color:var(--text-primary)]">
										整理建议
									</h2>
									<div className="flex items-center gap-2">
										<Button
											className="h-7"
											onClick={onClearEventManagementProposal}
											size="xs"
											type="button"
											variant="ghost"
										>
											取消
										</Button>
										<Button
											className="h-7"
											disabled={selectedProposalItemIds.length === 0 || isSaving}
											onClick={() => void applySelectedProposalItems()}
											size="xs"
											type="button"
										>
											应用选中
										</Button>
									</div>
								</div>
								<div className="grid max-h-56 gap-2 overflow-auto pr-1">
									{eventManagementProposal.items.map((item) => {
										const event = eventsById.get(item.eventId);
										const selected = selectedProposalItemIds.includes(item.id);
										return (
											<label
												className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-[7px] bg-[color:var(--surface-2)] px-3 py-2 text-[12px]"
												key={item.id}
											>
												<input
													checked={selected}
													className="mt-1 size-3.5 accent-[color:var(--accent)]"
													onChange={(event) => {
														const checked = event.currentTarget.checked;
														setSelectedProposalItemIds((current) =>
															checked ? [...current, item.id] : current.filter((id) => id !== item.id),
														);
													}}
													type="checkbox"
												/>
												<div className="grid gap-1">
													<span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[color:var(--text-primary)]">
														<span className="truncate font-medium">{event?.title ?? item.eventId}</span>
														{item.priority ? (
															<span className="rounded-[5px] bg-[color:var(--surface-3)] px-1.5 text-[11px] leading-5">
																{item.priority}
															</span>
														) : null}
														{item.status ? (
															<span
																className={cn(
																	"rounded-[5px] bg-[color:var(--surface-3)] px-1.5 text-[11px] leading-5",
																	item.status === "discarded" && "bg-destructive/8 text-destructive",
																)}
															>
																{EVENT_STATUS_LABELS[item.status]}
															</span>
														) : null}
													</span>
													<MessageResponse className="size-auto leading-5 text-[color:var(--text-secondary)] text-[12px]">
														{item.reason}
													</MessageResponse>
													<MessageResponse className="size-auto leading-5 text-[color:var(--text-tertiary)] text-[12px]">
														{item.commentBody}
													</MessageResponse>
												</div>
											</label>
										);
									})}
								</div>
							</section>
						) : null}
					</div>
					<div
						className="grid h-full min-h-0 gap-3"
						style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(190px, 1fr))` }}
					>
						{columns.map((status) => (
							<EventColumn
								activeEventId={activeEventId}
								events={eventsByStatus[status] ?? []}
								key={status}
								now={now}
								onSelectEvent={selectEvent}
								status={status}
							/>
						))}
					</div>
					<EventManagementProgressFloat
						now={now}
						onDismiss={() => setManagementProgress(undefined)}
						progress={visibleManagementProgress}
					/>
				</div>
			</div>
			<Sheet onOpenChange={setIsInspectorOpen} open={isInspectorOpen && Boolean(activeEvent)}>
				<SheetContent
					className="w-[368px] gap-0 border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] p-0 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)] sm:max-w-[368px]"
					showCloseButton={false}
				>
					<SheetTitle className="sr-only">事件详情</SheetTitle>
					<SheetDescription className="sr-only">查看和处理选中的事件。</SheetDescription>
					<EventInspector
						activeEvent={activeEvent}
						activeProjectId={activeProjectId}
						isRunning={isRunning}
						isSaving={isSaving}
						onAddEventComment={onAddEventComment}
						onCreateProjectFromFolder={onCreateProjectFromFolder}
						onDeleteEvent={onDeleteEvent}
						onOpenSession={onOpenSession}
						onRunEvent={onRunEvent}
						onSetEventStatus={onSetEventStatus}
						onUpdateEvent={onUpdateEvent}
						projects={projects}
					/>
				</SheetContent>
			</Sheet>
		</div>
	);
}
