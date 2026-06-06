import {
	Blocks,
	ChevronRight,
	ClipboardList,
	Eye,
	EyeOff,
	Folder,
	FolderPlus,
	Maximize2,
	MessageSquare,
	Minimize2,
	Paperclip,
	PencilLine,
	Search,
	Settings2,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	FloatingDialog,
	FloatingDialogCloseButton,
	FloatingDialogHeader,
	FloatingDialogTitle,
} from "@/components/ui/floating-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusDot } from "@/components/ui/status-dot";
import { Textarea } from "@/components/ui/textarea";
import { VirtualStack } from "@/components/ui/virtual-stack";
import { sidebarContentTransition, subtleReveal } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type {
	DesktopEventAttachmentDraft,
	DesktopEventDetail,
	DesktopOpenEventAttachmentsRequest,
	DesktopPrepareEventAttachmentsResult,
	DesktopProjectSummary,
	DesktopSessionSummary,
} from "../../../shared/types.ts";
import { formatRelativeUpdatedAt, SessionList } from "./SessionList.tsx";

interface SidebarProps {
	projects: DesktopProjectSummary[];
	sessionsByProjectId: Record<string, DesktopSessionSummary[]>;
	activeProjectId?: string;
	activeSessionId?: string;
	selectedPrimaryItem?: "capabilities" | "events";
	eventCount?: number;
	runningEventCount?: number;
	isSidebarCollapsed?: boolean;
	isLoading: boolean;
	isBusy: boolean;
	errorMessage?: string;
	isPreparingEventAttachments?: boolean;
	isSavingEvent?: boolean;
	onCreateEvent?: (request: {
		body?: string;
		attachments?: DesktopEventAttachmentDraft[];
	}) => Promise<DesktopEventDetail | undefined>;
	onCreateProjectFromFolder: () => Promise<void>;
	onCreatePrimarySession?: () => Promise<void>;
	onCreateSession: (projectId?: string) => Promise<DesktopSessionSummary | undefined>;
	onDeleteSession?: (sessionId: string, projectId?: string) => Promise<void>;
	onEnsureProjectSessions?: (projectId: string) => Promise<void>;
	onOpenCapabilities?: () => void;
	onOpenEventAttachments?: (
		request?: DesktopOpenEventAttachmentsRequest,
	) => Promise<DesktopPrepareEventAttachmentsResult>;
	onOpenEvents?: () => void;
	onOpenSettings?: () => void;
	onSelectProject: (projectId: string) => Promise<void>;
	onSelectSession: (sessionId: string, projectId?: string) => Promise<void>;
}

function getProjectSessionCount(project: DesktopProjectSummary, sessions: DesktopSessionSummary[]): number {
	if (sessions.length === 0) {
		return project.sessionCount;
	}

	return sessions.filter((session) => session.messageCount > 0 || session.isStreaming).length;
}

function splitProjectPath(cwd: string): string[] {
	return cwd.split(/[\\/]+/).filter(Boolean);
}

function getTrailingPath(segments: string[], depth: number): string {
	return segments.slice(Math.max(0, segments.length - depth)).join("/");
}

function getDuplicateProjectSuffix(project: DesktopProjectSummary, duplicateProjects: DesktopProjectSummary[]): string {
	const parentSegments = splitProjectPath(project.cwd).slice(0, -1);
	if (parentSegments.length === 0) {
		return project.cwd;
	}

	for (let depth = 1; depth <= parentSegments.length; depth += 1) {
		const suffix = getTrailingPath(parentSegments, depth);
		const isUnique = duplicateProjects.every((duplicateProject) => {
			if (duplicateProject.id === project.id) {
				return true;
			}
			return getTrailingPath(splitProjectPath(duplicateProject.cwd).slice(0, -1), depth) !== suffix;
		});
		if (isUnique) {
			return suffix;
		}
	}

	return project.cwd;
}

function getProjectDisplayNames(projects: DesktopProjectSummary[]): Map<string, string> {
	const projectsByName = new Map<string, DesktopProjectSummary[]>();
	for (const project of projects) {
		projectsByName.set(project.name, [...(projectsByName.get(project.name) ?? []), project]);
	}

	const displayNames = new Map<string, string>();
	for (const project of projects) {
		const duplicateProjects = projectsByName.get(project.name) ?? [];
		displayNames.set(
			project.id,
			duplicateProjects.length > 1
				? `${project.name} · ${getDuplicateProjectSuffix(project, duplicateProjects)}`
				: project.name,
		);
	}
	return displayNames;
}

function getSearchableSessionTitle(session: DesktopSessionSummary): string {
	return session.messageCount === 0 ? "新对话" : session.title;
}

type SidebarSearchResult =
	| {
			type: "project";
			project: DesktopProjectSummary;
			sessionCount: number;
	  }
	| {
			type: "session";
			project: DesktopProjectSummary;
			session: DesktopSessionSummary;
	  };

function getSidebarSearchResults({
	projects,
	query,
	sessionsByProjectId,
}: {
	projects: DesktopProjectSummary[];
	query: string;
	sessionsByProjectId: Record<string, DesktopSessionSummary[]>;
}): SidebarSearchResult[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return [];
	}

	const results: SidebarSearchResult[] = [];
	for (const project of projects) {
		const sessions = sessionsByProjectId[project.id] ?? [];
		const matchesProject =
			project.name.toLowerCase().includes(normalizedQuery) || project.cwd.toLowerCase().includes(normalizedQuery);
		if (matchesProject) {
			results.push({
				type: "project",
				project,
				sessionCount: getProjectSessionCount(project, sessions),
			});
		}

		for (const session of sessions) {
			if (getSearchableSessionTitle(session).toLowerCase().includes(normalizedQuery)) {
				results.push({ type: "session", project, session });
			}
		}
	}

	return results;
}

interface SidebarSearchDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onQueryChange: (query: string) => void;
	onSelectProject: (projectId: string) => Promise<void>;
	onSelectSession: (sessionId: string, projectId: string) => Promise<void>;
	projects: DesktopProjectSummary[];
	query: string;
	sessionsByProjectId: Record<string, DesktopSessionSummary[]>;
}

function SidebarSearchDialog({
	isOpen,
	onClose,
	onQueryChange,
	onSelectProject,
	onSelectSession,
	projects,
	query,
	sessionsByProjectId,
}: SidebarSearchDialogProps) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const results = useMemo(
		() => getSidebarSearchResults({ projects, query, sessionsByProjectId }),
		[projects, query, sessionsByProjectId],
	);
	const hasQuery = query.trim().length > 0;

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const focusId = window.setTimeout(() => inputRef.current?.focus(), 0);
		return () => window.clearTimeout(focusId);
	}, [isOpen]);

	async function handleProjectSelect(projectId: string): Promise<void> {
		onClose();
		await onSelectProject(projectId);
	}

	async function handleSessionSelect(sessionId: string, projectId: string): Promise<void> {
		onClose();
		await onSelectSession(sessionId, projectId);
	}

	return (
		<FloatingDialog
			dataSlot="sidebar-search-dialog"
			isOpen={isOpen}
			labelledBy="sidebar-search-title"
			onClose={onClose}
		>
			<FloatingDialogHeader className="grid-cols-[minmax(0,1fr)_auto]" data-slot="sidebar-search-header">
				<div
					className="uix-flat-field grid h-10 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-[var(--uix-flat-field-padding-x)]"
					data-slot="sidebar-search-input-surface"
				>
					<Search className="size-4 text-[color:var(--text-tertiary)]" />
					<label className="sr-only" htmlFor="sidebar-search-input">
						搜索项目和对话
					</label>
					<input
						aria-label="搜索项目和对话"
						className="sidebar-search-input h-9 min-w-0 bg-transparent text-[13px] font-medium text-foreground outline-none placeholder:text-[color:var(--text-tertiary)]"
						id="sidebar-search-input"
						onChange={(event) => onQueryChange(event.currentTarget.value)}
						placeholder="搜索项目和对话"
						ref={inputRef}
						type="search"
						value={query}
					/>
					{hasQuery ? (
						<button
							aria-label="清空搜索"
							className="flex size-7 items-center justify-center rounded-[var(--uix-flat-radius-control)] text-[color:var(--text-tertiary)] transition-colors hover:bg-background/75 hover:text-[color:var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--uix-flat-focus-ring)]"
							onClick={() => onQueryChange("")}
							type="button"
						>
							<X className="size-3.5" />
						</button>
					) : null}
				</div>
				<FloatingDialogCloseButton aria-label="关闭搜索" onClick={onClose} />
			</FloatingDialogHeader>
			<h2 className="sr-only" id="sidebar-search-title">
				搜索
			</h2>
			<div
				className="uix-flat-field max-h-[min(62vh,520px)] min-h-52 overflow-hidden"
				data-slot="sidebar-search-results"
			>
				{!hasQuery ? (
					<div className="grid min-h-52 place-items-center px-6 text-center text-[13px] leading-6 text-[color:var(--text-tertiary)]">
						输入项目名、路径或对话标题进行搜索。
					</div>
				) : results.length === 0 ? (
					<div className="grid min-h-52 place-items-center px-6 text-center text-[13px] leading-6 text-[color:var(--text-tertiary)]">
						没有找到匹配结果。
					</div>
				) : (
					<VirtualStack
						className="native-scrollbar max-h-[min(62vh,520px)] min-h-52"
						dataSlot="sidebar-search-virtual-results"
						estimateSize={() => 48}
						gap={4}
						getKey={(result) =>
							result.type === "project"
								? `project-${result.project.id}`
								: `session-${result.project.id}-${result.session.id}`
						}
						initialViewportHeight={360}
						itemClassName="px-2"
						items={results}
						overscan={6}
						paddingEnd={8}
						paddingStart={8}
						renderItem={({ item: result }) => {
							if (result.type === "project") {
								return (
									<button
										aria-label={`打开项目 ${result.project.name}`}
										className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--uix-flat-radius-control)] px-3 py-2 text-left transition-colors hover:bg-background/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--uix-flat-focus-ring)]"
										onClick={() => {
											void handleProjectSelect(result.project.id);
										}}
										type="button"
									>
										<Folder className="size-4 text-[color:var(--text-tertiary)]" />
										<span className="min-w-0">
											<span className="block truncate font-medium text-foreground">
												{result.project.name}
											</span>
											<span className="block truncate text-[color:var(--text-tertiary)]">
												{result.project.cwd}
											</span>
										</span>
										<span className="shrink-0 tabular-nums text-[color:var(--text-tertiary)]">
											{result.sessionCount} 对话
										</span>
									</button>
								);
							}

							return (
								<button
									aria-label={`打开对话 ${getSearchableSessionTitle(result.session)}，项目 ${result.project.name}`}
									className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--uix-flat-radius-control)] px-3 py-2 text-left transition-colors hover:bg-background/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--uix-flat-focus-ring)]"
									onClick={() => {
										void handleSessionSelect(result.session.id, result.project.id);
									}}
									type="button"
								>
									<MessageSquare className="size-4 text-[color:var(--text-tertiary)]" />
									<span className="min-w-0">
										<span className="block truncate font-medium text-foreground">
											{getSearchableSessionTitle(result.session)}
										</span>
										<span className="block truncate text-[color:var(--text-tertiary)]">
											{result.project.name}
										</span>
									</span>
									<span className="shrink-0 tabular-nums text-[color:var(--text-tertiary)]">
										{formatRelativeUpdatedAt(result.session.updatedAt)}
									</span>
								</button>
							);
						}}
					/>
				)}
			</div>
		</FloatingDialog>
	);
}

interface SidebarEventCreateDialogProps {
	activeProjectId?: string;
	isOpen: boolean;
	isPreparingAttachments: boolean;
	isSaving: boolean;
	onClose: () => void;
	onCreateEvent: (request: {
		body?: string;
		attachments?: DesktopEventAttachmentDraft[];
	}) => Promise<DesktopEventDetail | undefined>;
	onOpenEventAttachments: (
		request?: DesktopOpenEventAttachmentsRequest,
	) => Promise<DesktopPrepareEventAttachmentsResult>;
	projects: DesktopProjectSummary[];
}

function SidebarEventCreateDialog({
	activeProjectId,
	isOpen,
	isPreparingAttachments,
	isSaving,
	onClose,
	onCreateEvent,
	onOpenEventAttachments,
	projects,
}: SidebarEventCreateDialogProps) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [draftBody, setDraftBody] = useState("");
	const [draftAttachments, setDraftAttachments] = useState<DesktopEventAttachmentDraft[]>([]);
	const [attachmentError, setAttachmentError] = useState<string | undefined>();
	const canCreate = Boolean(draftBody.trim() || draftAttachments.length > 0);

	useEffect(() => {
		if (!isOpen) {
			return undefined;
		}
		const focusId = window.setTimeout(() => textareaRef.current?.focus(), 0);
		return () => window.clearTimeout(focusId);
	}, [isOpen]);

	async function openAttachments(): Promise<void> {
		const activeProject = projects.find((project) => project.id === activeProjectId);
		const result = await onOpenEventAttachments(activeProject ? { defaultPath: activeProject.cwd } : undefined);
		setDraftAttachments((current) => [...current, ...result.attachments]);
		setAttachmentError(result.errors.map((error) => error.message).join("；") || undefined);
	}

	async function createEvent(): Promise<void> {
		if (!canCreate || isSaving) {
			return;
		}
		const event = await onCreateEvent({
			body: draftBody.trim() || undefined,
			...(draftAttachments.length > 0 ? { attachments: draftAttachments } : {}),
		});
		if (event) {
			setDraftBody("");
			setDraftAttachments([]);
			setAttachmentError(undefined);
			onClose();
		}
	}

	return (
		<FloatingDialog
			as="form"
			dataSlot="sidebar-event-create-dialog"
			isOpen={isOpen}
			labelledBy="sidebar-event-create-title"
			onClose={onClose}
			onKeyDown={(event) => {
				if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					void createEvent();
				}
			}}
			onSubmit={(event) => {
				event.preventDefault();
				void createEvent();
			}}
		>
			<FloatingDialogHeader data-slot="sidebar-event-create-header">
				<ClipboardList className="size-4 text-[color:var(--text-tertiary)]" />
				<FloatingDialogTitle id="sidebar-event-create-title">记录事件</FloatingDialogTitle>
				<FloatingDialogCloseButton aria-label="关闭记录事件" onClick={onClose} />
			</FloatingDialogHeader>
			<div className="grid gap-2.5">
				<Textarea
					aria-label="记录事件内容"
					className="uix-flat-field min-h-28 resize-none border-transparent bg-[color:var(--uix-flat-control-surface)] px-[var(--uix-flat-field-padding-x)] py-[var(--uix-flat-field-padding-y)] text-[13px] leading-5 shadow-none focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-[color:var(--uix-flat-focus-ring)]"
					onChange={(event) => setDraftBody(event.currentTarget.value)}
					placeholder="记录一个事件"
					ref={textareaRef}
					value={draftBody}
				/>
				<div
					className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-1.5 pb-1"
					data-slot="sidebar-event-create-footer"
				>
					<div className="min-w-0 truncate text-[12px] text-[color:var(--text-tertiary)]">
						{draftAttachments.length > 0
							? draftAttachments.map((attachment) => attachment.name).join("，")
							: (attachmentError ?? "Command+Enter 快速记录")}
					</div>
					<Button
						className="uix-flat-action border-transparent shadow-none"
						disabled={isPreparingAttachments}
						onClick={() => {
							void openAttachments();
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						<Paperclip className="size-3.5" />
						添加附件
					</Button>
					<Button className="shadow-none" disabled={!canCreate || isSaving} size="sm" type="submit">
						记录
					</Button>
				</div>
			</div>
		</FloatingDialog>
	);
}

export function Sidebar({
	projects,
	sessionsByProjectId,
	activeProjectId,
	activeSessionId,
	selectedPrimaryItem,
	eventCount = 0,
	runningEventCount = 0,
	isSidebarCollapsed = false,
	isLoading,
	isBusy,
	errorMessage,
	isPreparingEventAttachments = false,
	isSavingEvent = false,
	onCreateEvent,
	onCreateProjectFromFolder,
	onCreatePrimarySession,
	onCreateSession,
	onDeleteSession,
	onEnsureProjectSessions,
	onOpenCapabilities = () => undefined,
	onOpenEventAttachments,
	onOpenEvents = () => undefined,
	onOpenSettings = () => undefined,
	onSelectProject,
	onSelectSession,
}: SidebarProps) {
	const [collapsedProjectIds, setCollapsedProjectIds] = useState<ReadonlySet<string>>(() => new Set());
	const [expandedSessionProjectIds, setExpandedSessionProjectIds] = useState<ReadonlySet<string>>(() => new Set());
	const [isEventCreateOpen, setIsEventCreateOpen] = useState(false);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [showEmptyProjects, setShowEmptyProjects] = useState(true);
	const [creatingSessionTarget, setCreatingSessionTarget] = useState<"primary" | string | undefined>();
	const creatingSessionTargetRef = useRef<"primary" | string | undefined>(undefined);
	const projectDisplayNames = useMemo(() => getProjectDisplayNames(projects), [projects]);

	const visibleProjects = useMemo(
		() =>
			projects.filter((project) => {
				const sessions = sessionsByProjectId[project.id] ?? [];
				const hasSessions = getProjectSessionCount(project, sessions) > 0;
				const canShowEmptyProject = showEmptyProjects || project.id === activeProjectId || hasSessions;
				if (!canShowEmptyProject) {
					return false;
				}

				return true;
			}),
		[activeProjectId, projects, sessionsByProjectId, showEmptyProjects],
	);
	const allProjectsCollapsed =
		visibleProjects.length > 0 && visibleProjects.every((project) => collapsedProjectIds.has(project.id));

	const toggleAllProjects = () => {
		setCollapsedProjectIds(() =>
			allProjectsCollapsed ? new Set() : new Set(visibleProjects.map((project) => project.id)),
		);
	};

	const toggleProjectCollapsed = (projectId: string) => {
		setCollapsedProjectIds((current) => {
			const next = new Set(current);
			if (next.has(projectId)) {
				next.delete(projectId);
			} else {
				next.add(projectId);
			}
			return next;
		});
	};

	const toggleSessionsForProject = (projectId: string) => {
		const isExpanding = !expandedSessionProjectIds.has(projectId);
		setExpandedSessionProjectIds((current) => {
			const next = new Set(current);
			if (next.has(projectId)) {
				next.delete(projectId);
			} else {
				next.add(projectId);
			}
			return next;
		});
		if (isExpanding) {
			void onEnsureProjectSessions?.(projectId);
		}
	};

	function closeSearch(): void {
		setIsSearchOpen(false);
		setSearchQuery("");
	}

	function closeEventCreate(): void {
		setIsEventCreateOpen(false);
	}

	async function selectSessionFromProject(sessionId: string, projectId?: string): Promise<void> {
		await onSelectSession(sessionId, projectId);
	}

	async function createPrimarySession(): Promise<void> {
		if (creatingSessionTargetRef.current) {
			return;
		}

		creatingSessionTargetRef.current = "primary";
		setCreatingSessionTarget("primary");
		try {
			if (onCreatePrimarySession) {
				await onCreatePrimarySession();
			} else {
				await onCreateSession();
			}
		} finally {
			creatingSessionTargetRef.current = undefined;
			setCreatingSessionTarget(undefined);
		}
	}

	async function createSessionInProject(projectId: string): Promise<void> {
		if (creatingSessionTargetRef.current) {
			return;
		}

		creatingSessionTargetRef.current = projectId;
		setCreatingSessionTarget(projectId);
		if (projectId !== activeProjectId) {
			try {
				await onSelectProject(projectId);
				await onCreateSession(projectId);
			} finally {
				creatingSessionTargetRef.current = undefined;
				setCreatingSessionTarget(undefined);
			}
			return;
		}

		try {
			await onCreateSession(projectId);
		} finally {
			creatingSessionTargetRef.current = undefined;
			setCreatingSessionTarget(undefined);
		}
	}

	async function deleteSessionFromProject(sessionId: string, projectId?: string): Promise<void> {
		await onDeleteSession?.(sessionId, projectId);
	}

	return (
		<div
			className="relative h-full min-h-0 overflow-hidden bg-[color:var(--color-sidebar-surface)] pt-[var(--desktop-titlebar-safe-area)]"
			data-motion="sidebar-content"
			data-motion-mode="drawer"
			data-motion-origin="left"
			data-motion-owner="content"
			data-motion-scope="structural"
			data-resize-motion="contents-static"
			data-sidebar-state={isSidebarCollapsed ? "collapsed" : "expanded"}
			data-slot="sidebar-content"
		>
			<div
				aria-hidden="true"
				className="desktop-window-drag-region absolute top-0 right-0 left-[var(--desktop-titlebar-content-inset)] z-10 h-[var(--desktop-titlebar-drag-height)]"
				data-slot="sidebar-titlebar-drag-region"
			/>
			{onCreateEvent && onOpenEventAttachments ? (
				<SidebarEventCreateDialog
					activeProjectId={activeProjectId}
					isOpen={isEventCreateOpen}
					isPreparingAttachments={isPreparingEventAttachments}
					isSaving={isSavingEvent}
					onClose={closeEventCreate}
					onCreateEvent={onCreateEvent}
					onOpenEventAttachments={onOpenEventAttachments}
					projects={projects}
				/>
			) : null}
			<SidebarSearchDialog
				isOpen={isSearchOpen}
				onClose={closeSearch}
				onQueryChange={setSearchQuery}
				onSelectProject={onSelectProject}
				onSelectSession={selectSessionFromProject}
				projects={projects}
				query={searchQuery}
				sessionsByProjectId={sessionsByProjectId}
			/>
			<AnimatePresence initial={false}>
				{!isSidebarCollapsed ? (
					<motion.div
						animate={{ opacity: 1 }}
						className="absolute inset-0 flex min-h-0 flex-col bg-[color:var(--color-sidebar-surface)] px-0 pb-3 pt-[var(--desktop-titlebar-safe-area)]"
						exit={{ opacity: 0 }}
						initial={{ opacity: 0 }}
						key="expanded-sidebar"
						transition={sidebarContentTransition}
					>
						<nav className="grid gap-1 px-3 pb-7">
							<button
								className="grid h-8 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-[8px] px-1 text-left text-[13px] font-normal leading-5 text-[color:var(--color-sidebar-ink)] transition-colors hover:bg-[color:var(--color-sidebar-selected-hover)] hover:text-[color:var(--color-sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:opacity-50"
								disabled={creatingSessionTarget === "primary" || !activeProjectId}
								onClick={() => {
									void createPrimarySession();
								}}
								type="button"
							>
								<PencilLine className="size-4 text-[color:var(--color-sidebar-icon)]" />
								<span className="truncate">新对话</span>
							</button>
							<div
								className={cn(
									"group/events grid h-8 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 rounded-[8px] py-0 pr-2 pl-1 text-[13px] font-normal leading-5 text-[color:var(--color-sidebar-ink)] transition-colors hover:bg-[color:var(--color-sidebar-selected-hover)] hover:text-[color:var(--color-sidebar-active)]",
									selectedPrimaryItem === "events" &&
										"bg-[color:var(--color-sidebar-selected)] text-[color:var(--color-sidebar-active)]",
								)}
							>
								<button
									className="grid h-8 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
									onClick={onOpenEvents}
									type="button"
								>
									<ClipboardList className="size-4 text-[color:var(--color-sidebar-icon)]" />
									<span className="truncate">事件</span>
								</button>
								{onCreateEvent && onOpenEventAttachments ? (
									<button
										aria-label="记录事件"
										className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[color:var(--color-sidebar-muted)] opacity-0 transition-[color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:text-[color:var(--color-sidebar-active)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 group-hover/events:opacity-100 disabled:pointer-events-none disabled:opacity-40"
										data-slot="sidebar-events-quick-create"
										disabled={isSavingEvent}
										onClick={() => setIsEventCreateOpen(true)}
										title="记录事件"
										type="button"
									>
										<PencilLine className="size-3.5" />
									</button>
								) : null}
								<span
									className="flex min-w-[2.25rem] shrink-0 items-center justify-end gap-1.5 text-[12px] tabular-nums text-[color:var(--color-sidebar-muted)]"
									data-slot="sidebar-events-count"
								>
									{runningEventCount > 0 ? (
										<StatusDot className="size-1.5" label="Running events" status="running" />
									) : null}
									{eventCount > 0 ? eventCount : null}
								</span>
							</div>
							<button
								className={cn(
									"grid h-8 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-[8px] px-1 text-left text-[13px] font-normal leading-5 text-[color:var(--color-sidebar-ink)] transition-colors hover:bg-[color:var(--color-sidebar-selected-hover)] hover:text-[color:var(--color-sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
									selectedPrimaryItem === "capabilities" &&
										"bg-[color:var(--color-sidebar-selected)] text-[color:var(--color-sidebar-active)]",
								)}
								onClick={onOpenCapabilities}
								type="button"
							>
								<Blocks className="size-4 text-[color:var(--color-sidebar-icon)]" />
								<span className="truncate">能力库</span>
							</button>
							<button
								aria-haspopup="dialog"
								className="grid h-8 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-[8px] px-1 text-left text-[13px] font-normal leading-5 text-[color:var(--color-sidebar-ink)] transition-colors hover:bg-[color:var(--color-sidebar-selected-hover)] hover:text-[color:var(--color-sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
								onClick={() => setIsSearchOpen(true)}
								type="button"
							>
								<Search className="size-4 text-[color:var(--color-sidebar-icon)]" />
								<span className="truncate">搜索</span>
							</button>
						</nav>

						<header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3">
							<h2 className="truncate text-[13px] font-normal leading-5 text-[color:var(--color-sidebar-muted)]">
								项目
							</h2>
							<div className="flex items-center gap-1 text-[color:var(--color-sidebar-muted)]">
								<Button
									aria-label={allProjectsCollapsed ? "Expand all projects" : "Collapse all projects"}
									className="size-7 rounded-lg text-[color:var(--color-sidebar-muted)]"
									disabled={visibleProjects.length === 0}
									onClick={toggleAllProjects}
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									{allProjectsCollapsed ? (
										<Maximize2 className="size-3.5" />
									) : (
										<Minimize2 className="size-3.5" />
									)}
								</Button>
								<Button
									aria-label={showEmptyProjects ? "Hide empty projects" : "Show empty projects"}
									className="size-7 rounded-lg text-[color:var(--color-sidebar-muted)]"
									onClick={() => setShowEmptyProjects((current) => !current)}
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									{showEmptyProjects ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
								</Button>
								<Button
									aria-label="Use local folder"
									className="size-7 rounded-lg text-[color:var(--color-sidebar-muted)]"
									disabled={isBusy}
									onClick={() => {
										void onCreateProjectFromFolder();
									}}
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									<FolderPlus className="size-3.5" />
								</Button>
							</div>
						</header>

						<AnimatePresence initial={false}>
							{errorMessage ? (
								<motion.div
									className="mx-3 mt-3 rounded-[8px] bg-destructive/8 px-3 py-2 text-[13px] leading-5 text-destructive"
									key="sidebar-error"
									{...subtleReveal}
								>
									{errorMessage}
								</motion.div>
							) : null}
						</AnimatePresence>

						<ScrollArea className="sidebar-project-tree mt-4 min-h-0 flex-1">
							<div className="space-y-1 pb-6">
								{isLoading && visibleProjects.length === 0 ? (
									<div
										aria-busy="true"
										className="min-h-[9rem] px-3"
										data-slot="sidebar-project-loading-state"
										key="sidebar-loading"
									>
										<span className="sr-only">Loading projects</span>
									</div>
								) : null}

								{!isLoading && visibleProjects.length === 0 ? (
									<motion.div className="px-3" key="sidebar-empty" {...subtleReveal}>
										<button
											className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-[8px] px-0 py-1.5 text-left text-[13px] font-normal leading-5 text-[color:var(--color-sidebar-ink)] transition-colors hover:text-[color:var(--color-sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
											disabled={isBusy}
											onClick={() => {
												void onCreateProjectFromFolder();
											}}
											type="button"
										>
											<FolderPlus className="size-4 text-[color:var(--color-sidebar-muted)]" />
											<span>添加本地文件夹项目</span>
										</button>
									</motion.div>
								) : null}

								<AnimatePresence initial={false}>
									{visibleProjects.map((project) => {
										const isActiveProject = project.id === activeProjectId;
										const isCollapsed = collapsedProjectIds.has(project.id);
										const projectSessions = sessionsByProjectId[project.id] ?? [];
										const isSessionExpanded = expandedSessionProjectIds.has(project.id);
										const projectDisplayName = projectDisplayNames.get(project.id) ?? project.name;
										const shouldHighlightProject =
											!selectedPrimaryItem &&
											isActiveProject &&
											!projectSessions.some((session) => session.id === activeSessionId);

										return (
											<motion.section className="min-w-0 px-0" key={project.id} {...subtleReveal}>
												<div
													className={cn(
														"group/project mx-3 grid h-8 grid-cols-[auto_minmax(0,1fr)_auto] items-center rounded-[9px] transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
														"text-[color:var(--color-sidebar-project)] hover:bg-[color:var(--color-sidebar-project-hover)] hover:text-[color:var(--color-sidebar-active)]",
														shouldHighlightProject &&
															"bg-[color:var(--color-sidebar-selected)] text-[color:var(--color-sidebar-active)] hover:bg-[color:var(--color-sidebar-selected)]",
													)}
												>
													<button
														aria-label={`${isCollapsed ? "展开" : "折叠"}项目 ${projectDisplayName}`}
														aria-expanded={!isCollapsed}
														className="ml-1 flex size-6 shrink-0 items-center justify-center rounded-[7px] text-[color:var(--color-sidebar-muted)] transition-colors hover:bg-background/45 hover:text-[color:var(--color-sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
														onClick={() => {
															toggleProjectCollapsed(project.id);
														}}
														title={isCollapsed ? "展开项目" : "折叠项目"}
														type="button"
													>
														<ChevronRight
															className={cn(
																"size-3.5 transition-transform duration-[var(--duration-fast)]",
																!isCollapsed && "rotate-90",
															)}
														/>
													</button>
													<button
														className="grid h-full w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-[9px] py-0 pl-1 pr-2 text-left text-[13px] font-normal leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:opacity-50"
														onClick={() => {
															void onSelectProject(project.id);
														}}
														title={project.cwd}
														type="button"
													>
														<Folder className="size-4 shrink-0 text-[color:var(--color-sidebar-icon)]" />
														<span className="truncate">{projectDisplayName}</span>
													</button>
													<button
														aria-label={`在 ${projectDisplayName} 中新建对话`}
														className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-[8px] text-[color:var(--color-sidebar-muted)] opacity-0 transition-[background-color,color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-background/45 hover:text-[color:var(--color-sidebar-active)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 group-hover/project:opacity-100 disabled:pointer-events-none disabled:opacity-40"
														disabled={creatingSessionTarget === project.id}
														onClick={() => {
															void createSessionInProject(project.id);
														}}
														title="新对话"
														type="button"
													>
														<PencilLine className="size-3.5" />
													</button>
												</div>

												{!isCollapsed && (projectSessions.length > 0 || isActiveProject) ? (
													<div className="mt-1 overflow-hidden">
														<SessionList
															activeSessionId={isActiveProject ? activeSessionId : undefined}
															isExpanded={isSessionExpanded}
															onDeleteSession={onDeleteSession ? deleteSessionFromProject : undefined}
															onToggleExpanded={() => toggleSessionsForProject(project.id)}
															onSelectSession={selectSessionFromProject}
															projectId={project.id}
															sessions={projectSessions}
														/>
													</div>
												) : null}
											</motion.section>
										);
									})}
								</AnimatePresence>
							</div>
						</ScrollArea>

						<div className="mt-2 shrink-0 px-3 pt-2">
							<button
								className="grid h-8 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-[8px] px-1 text-left text-[13px] font-normal leading-5 text-[color:var(--color-sidebar-ink)] transition-colors hover:bg-[color:var(--color-sidebar-selected-hover)] hover:text-[color:var(--color-sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
								onClick={onOpenSettings}
								type="button"
							>
								<Settings2 className="size-4 text-[color:var(--color-sidebar-icon)]" />
								<span className="truncate">设置</span>
							</button>
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}
