import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	Binary,
	Bot,
	Braces,
	ChevronDown,
	ChevronRight,
	Cookie,
	ExternalLink,
	FileCode2,
	FileText,
	Folder,
	GitBranch,
	GitCommitHorizontal,
	GitCompareArrows,
	GitPullRequest,
	Globe2,
	HardDrive,
	Maximize2,
	Minimize2,
	MoreHorizontal,
	MousePointerClick,
	Plus,
	RefreshCcw,
	Search,
	UploadCloud,
	X,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import parseDiff from "parse-diff";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getErrorMessage } from "../../../shared/errors.ts";
import { isDesktopStaticWebPreviewUrl, normalizeDesktopWebPreviewUrl } from "../../../shared/preview-url.ts";
import type { SerializedAgentEvent } from "../../../shared/serialized-agent-event.ts";
import type {
	DesktopPreviewFile,
	DesktopReviewFile,
	DesktopReviewSnapshot,
	DesktopSubagentOpenRequest,
	DesktopWebPreviewElementSelection,
	DesktopWebPreviewEvent,
	DesktopWebPreviewState,
	DesktopWorkspaceFileEntry,
	DesktopWorkspaceFileListResult,
} from "../../../shared/types.ts";
import { useDragResize } from "../../hooks/use-drag-resize.ts";
import { useReviewWorkspace } from "../../hooks/use-review-workspace.ts";
import { useSubscribedResource } from "../../hooks/use-subscribed-resource.ts";
import { useWorkspaceFiles, type WorkspaceFileListStatus } from "../../hooks/use-workspace-files.ts";
import { noMotionTransition, panelSpring } from "../../lib/motion.ts";
import { observeElementResize } from "../../lib/resize-observer.ts";
import {
	createPathTree,
	createPreviewErrorFile,
	createWorkspacePreviewItem,
	filterTreeFiles,
	flattenTreeRows,
	formatDiffChunkRange,
	getDiffChunkContext,
	getDiffChunkKey,
	getWebPreviewTitle,
	getWorkspaceItemTitle,
	isRelatedWebPreviewUrl,
	isWorkspacePreviewFileItem,
	type PathTreeFileRow,
	type PathTreeFlatRow,
	REVIEW_WORKSPACE_ITEM,
	resolvePreviewSourceLanguage,
	retainRecentWorkspacePreviewFiles,
	type WorkspacePanelItem,
} from "../../lib/review-workspace-model.ts";
import { cn } from "../../lib/utils.ts";
import { CodeBlock } from "../ai-elements/code-block.tsx";
import {
	WebPreview,
	WebPreviewConsole,
	type WebPreviewConsoleLog,
	WebPreviewNavigation,
	WebPreviewNavigationButton,
	WebPreviewUrl,
} from "../ai-elements/web-preview.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.tsx";
import { VirtualStack } from "../ui/virtual-stack.tsx";
import { SubagentDetailPane } from "./SubagentDetailPane.tsx";

interface ReviewWorkspacePanelProps {
	open: boolean;
	isFullscreen: boolean;
	isTitlebarSummaryVisible?: boolean;
	previewRequest?: {
		nonce: number;
		path: string;
	};
	webPreviewRequest?: {
		nonce: number;
		url: string;
	};
	subagentRequest?: DesktopSubagentOpenRequest;
	projectId?: string;
	sessionId?: string;
	workspaceLabel: string;
	onClose: () => void;
	onChromeSummaryChange?: (summary: ReviewWorkspaceChromeSummary | undefined) => void;
	onFullscreenChange: (next: boolean) => void;
}

export interface ReviewWorkspaceChromeSummary {
	activeItemLabel: string;
	additions: number;
	branchLabel: string;
	deletions: number;
	title: "综合面板";
	workspaceLabel: string;
}

type ParsedDiffFile = ReturnType<typeof parseDiff>[number];
type NativeWebPreviewOcclusionSource = "browser-actions" | "git-actions" | "workspace-create";
type SetNativeWebPreviewOcclusion = (source: NativeWebPreviewOcclusionSource, occluded: boolean) => void;
interface FileTreeToggleState {
	active: boolean;
	label: string;
	onClick: () => void;
}

const PUSH_REVEAL_TRANSITION = { type: "tween", duration: 0.32, ease: [0.32, 0.72, 0, 1] } as const;
const REVIEW_PANEL_BODY_HYDRATION_DELAY_MS = 340;
export const REVIEW_PANEL_WIDTH = {
	min: 520,
	default: 820,
	max: 1080,
	protectedMain: 560,
} as const;
const FILE_TREE_WIDTH = {
	min: 260,
	default: 340,
	max: 520,
} as const;
const FILE_TREE_INDENT = 14;
const STATUS_LABELS: Record<DesktopReviewFile["status"], string> = {
	added: "A",
	deleted: "D",
	modified: "M",
	renamed: "R",
	untracked: "U",
};
const WORKSPACE_FILE_TREE_LIMIT = 5000;
const WEB_PREVIEW_ERROR_MESSAGE = "仅支持 http、https 或 skylark-preview 的预览 URL。";

function formatWebPreviewElementSelection(selection: DesktopWebPreviewElementSelection): string {
	const target = selection.selector || selection.tagName;
	const label = selection.ariaLabel || selection.text;
	const suffix = label ? ` "${label.slice(0, 120)}"` : "";
	return `已选择 ${target}${suffix}`;
}

function clampFileTreeWidth(width: number): number {
	return Math.min(FILE_TREE_WIDTH.max, Math.max(FILE_TREE_WIDTH.min, width));
}

export function resolveReviewPanelMaxWidth(containerWidth: number | undefined): number {
	if (!containerWidth || containerWidth <= 0) {
		return REVIEW_PANEL_WIDTH.max;
	}

	return Math.max(0, Math.min(REVIEW_PANEL_WIDTH.max, containerWidth - REVIEW_PANEL_WIDTH.protectedMain));
}

export function clampReviewPanelWidth(width: number, containerWidth?: number): number {
	const maxWidth = resolveReviewPanelMaxWidth(containerWidth);
	if (maxWidth <= REVIEW_PANEL_WIDTH.min) {
		return maxWidth;
	}

	return Math.min(maxWidth, Math.max(REVIEW_PANEL_WIDTH.min, width));
}

function formatPath(path: string): string {
	if (path.length <= 54) {
		return path;
	}
	return `...${path.slice(-51)}`;
}

function getStatusClassName(status: DesktopReviewFile["status"]): string {
	switch (status) {
		case "added":
		case "untracked":
			return "bg-[color:color-mix(in_oklch,var(--success)_10%,var(--background))] text-[color:var(--success)]";
		case "deleted":
			return "bg-[color:color-mix(in_oklch,var(--destructive)_9%,var(--background))] text-[color:var(--destructive)]";
		case "renamed":
			return "bg-[color:color-mix(in_oklch,var(--info)_10%,var(--background))] text-[color:var(--info)]";
		case "modified":
			return "bg-[color:var(--surface-2)] text-[color:var(--text-secondary)]";
	}
}

function getFileIcon(path: string) {
	if (path.endsWith(".tsx") || path.endsWith(".jsx")) {
		return <Braces className="size-3.5 text-[color:var(--info)]" />;
	}
	if (path.endsWith(".ts") || path.endsWith(".js") || path.endsWith(".css") || path.endsWith(".json")) {
		return <FileCode2 className="size-3.5 text-[color:var(--accent)]" />;
	}
	return <FileCode2 className="size-3.5 text-[color:var(--text-tertiary)]" />;
}

function GitActionMenu({
	onNativeWebPreviewOcclusionChange,
	reason,
}: {
	onNativeWebPreviewOcclusionChange: SetNativeWebPreviewOcclusion;
	reason: string;
}) {
	const [open, setOpen] = useState(false);
	const actions = [
		{ label: "提交", icon: GitCommitHorizontal },
		{ label: "推送", icon: UploadCloud },
		{ label: "创建拉取请求", icon: GitPullRequest },
		{ label: "创建分支", icon: GitBranch },
	];

	const handleOpenChange = useCallback(
		(nextOpen: boolean): void => {
			setOpen(nextOpen);
			onNativeWebPreviewOcclusionChange("git-actions", nextOpen);
		},
		[onNativeWebPreviewOcclusionChange],
	);

	useEffect(() => {
		return () => onNativeWebPreviewOcclusionChange("git-actions", false);
	}, [onNativeWebPreviewOcclusionChange]);

	return (
		<Popover onOpenChange={handleOpenChange} open={open}>
			<PopoverTrigger asChild>
				<Button aria-label="Open Git actions" className="desktop-window-no-drag" size="icon-sm" variant="ghost">
					<MoreHorizontal className="size-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-60 p-2">
				<div className="grid gap-1">
					{actions.map((action) => {
						const Icon = action.icon;
						return (
							<button
								className="flex h-9 cursor-not-allowed items-center gap-3 rounded-[var(--radius-md)] px-2.5 text-left text-sm text-[color:var(--text-tertiary)] opacity-70"
								disabled
								key={action.label}
								type="button"
							>
								<Icon className="size-4" />
								<span>{action.label}</span>
							</button>
						);
					})}
				</div>
				<p className="mt-2 px-2.5 pt-2 text-[11px] leading-4 text-[color:var(--text-tertiary)]">{reason}</p>
			</PopoverContent>
		</Popover>
	);
}

function WorkspaceCreateMenu({
	align = "start",
	onNativeWebPreviewOcclusionChange,
	onOpenBrowser,
	onOpenFiles,
	onOpenReview,
}: {
	align?: "center" | "end" | "start";
	onNativeWebPreviewOcclusionChange: SetNativeWebPreviewOcclusion;
	onOpenBrowser: () => void;
	onOpenFiles: () => Promise<void>;
	onOpenReview: () => void;
}) {
	const [open, setOpen] = useState(false);

	const handleOpenChange = useCallback(
		(nextOpen: boolean): void => {
			setOpen(nextOpen);
			onNativeWebPreviewOcclusionChange("workspace-create", nextOpen);
		},
		[onNativeWebPreviewOcclusionChange],
	);

	useEffect(() => {
		return () => onNativeWebPreviewOcclusionChange("workspace-create", false);
	}, [onNativeWebPreviewOcclusionChange]);

	async function handleOpenFiles(): Promise<void> {
		handleOpenChange(false);
		await onOpenFiles();
	}

	return (
		<Popover onOpenChange={handleOpenChange} open={open}>
			<PopoverTrigger asChild>
				<Button aria-label="New workspace item" className="desktop-window-no-drag" size="icon-sm" variant="ghost">
					<Plus className="size-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align={align} className="w-56 p-2">
				<div className="grid gap-1">
					<button
						className="flex h-9 items-center gap-3 rounded-[var(--radius-md)] px-2.5 text-left text-sm text-[color:var(--text-primary)] transition-[background-color,color] duration-[var(--duration-fast)] hover:bg-[color:var(--surface-2)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)]"
						onClick={() => void handleOpenFiles()}
						type="button"
					>
						<FileText className="size-4 text-[color:var(--text-tertiary)]" />
						<span>打开文件</span>
					</button>
					<button
						className="flex h-9 items-center gap-3 rounded-[var(--radius-md)] px-2.5 text-left text-sm text-[color:var(--text-primary)] transition-[background-color,color] duration-[var(--duration-fast)] hover:bg-[color:var(--surface-2)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)]"
						onClick={() => {
							handleOpenChange(false);
							onOpenBrowser();
						}}
						type="button"
					>
						<Globe2 className="size-4 text-[color:var(--text-tertiary)]" />
						<span>网页预览</span>
					</button>
					<button
						className="flex h-9 items-center gap-3 rounded-[var(--radius-md)] px-2.5 text-left text-sm text-[color:var(--text-primary)] transition-[background-color,color] duration-[var(--duration-fast)] hover:bg-[color:var(--surface-2)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)]"
						onClick={() => {
							handleOpenChange(false);
							onOpenReview();
						}}
						type="button"
					>
						<GitCompareArrows className="size-4 text-[color:var(--text-tertiary)]" />
						<span>审查</span>
					</button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function WorkspaceEmptyState({
	onOpenBrowser,
	onOpenFiles,
	onOpenReview,
}: {
	onOpenBrowser: () => void;
	onOpenFiles: () => Promise<void>;
	onOpenReview: () => void;
}) {
	const actions = [
		{
			description: "浏览文件",
			icon: FileText,
			label: "文件",
			onClick: () => void onOpenFiles(),
		},
		{
			description: "打开网页",
			icon: Globe2,
			label: "浏览器",
			onClick: onOpenBrowser,
		},
		{
			description: "查看代码更改",
			icon: GitCompareArrows,
			label: "审查",
			onClick: onOpenReview,
		},
	];

	return (
		<div className="grid h-full min-h-[360px] place-items-center bg-[color:var(--background)] px-8 py-12">
			<div className="grid w-full max-w-[460px] grid-cols-1 gap-3 sm:grid-cols-3">
				{actions.map((action) => {
					const Icon = action.icon;
					return (
						<button
							aria-label={action.label}
							className="group grid min-h-32 justify-items-center gap-2 rounded-[var(--radius-md)] bg-[color:var(--surface-1)] px-4 py-5 text-center shadow-[var(--shadow-minimal)] transition-[background-color,box-shadow,transform] duration-[var(--duration-fast)] hover:bg-[color:var(--surface-2)] hover:shadow-[var(--shadow-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)]"
							key={action.label}
							onClick={action.onClick}
							type="button"
						>
							<Icon className="size-5 text-[color:var(--text-tertiary)] transition-colors duration-[var(--duration-fast)] group-hover:text-[color:var(--text-secondary)]" />
							<span className="grid gap-1">
								<span className="text-[13px] font-medium text-[color:var(--text-primary)]">{action.label}</span>
								<span className="text-xs text-[color:var(--text-tertiary)]">{action.description}</span>
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

function ReviewEmptyState({ snapshot }: { snapshot?: DesktopReviewSnapshot }) {
	const title =
		snapshot?.status === "not_git"
			? "当前目录不是 Git 仓库"
			: snapshot?.status === "error"
				? "无法读取审查信息"
				: "尚无文件更改";
	const description =
		snapshot?.errorMessage ??
		(snapshot?.status === "not_git" ? "切换到 Git workspace 后可查看差异。" : "工作区当前没有可审查的 Git 变更。");

	return (
		<div className="grid h-full min-h-[360px] place-items-center px-8 py-12 text-center">
			<div className="grid max-w-xs justify-items-center gap-3">
				<div className="grid size-14 place-items-center rounded-[var(--radius-xl)] bg-[color:var(--surface-2)] text-[color:var(--text-tertiary)] shadow-[var(--shadow-minimal)]">
					<GitCompareArrows className="size-6" />
				</div>
				<div className="grid gap-1">
					<p className="text-[13px] font-medium text-[color:var(--text-primary)]">{title}</p>
					<p className="text-xs leading-5 text-[color:var(--text-tertiary)]">{description}</p>
				</div>
			</div>
		</div>
	);
}

function ReviewErrorState({ message }: { message: string }) {
	return (
		<div className="grid h-full min-h-[360px] place-items-center px-8 py-12 text-center">
			<div className="grid max-w-xs justify-items-center gap-3">
				<div className="grid size-14 place-items-center rounded-[var(--radius-xl)] bg-[color:color-mix(in_oklch,var(--destructive)_9%,var(--background))] text-[color:var(--destructive)] shadow-[var(--shadow-minimal)]">
					<AlertCircle className="size-6" />
				</div>
				<div className="grid gap-1">
					<p className="text-[13px] font-medium text-[color:var(--text-primary)]">无法读取审查信息</p>
					<p className="text-xs leading-5 text-[color:var(--text-tertiary)]">{message}</p>
				</div>
			</div>
		</div>
	);
}

function WorkspacePanelTabs({
	activeItemId,
	isFullscreen,
	items,
	onCloseItem,
	onSelectItem,
}: {
	activeItemId?: string;
	isFullscreen: boolean;
	items: WorkspacePanelItem[];
	onCloseItem: (itemId: string) => void;
	onSelectItem: (itemId: string) => void;
}) {
	if (items.length === 0) {
		return null;
	}

	return (
		<div
			aria-label="Workspace panel tabs"
			className="desktop-window-no-drag flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
			data-display-mode={isFullscreen ? "fullscreen" : "panel"}
			role="tablist"
		>
			{items.map((item) => (
				<div className="group relative flex shrink-0 items-center" key={item.id}>
					<button
						aria-label={`Close ${getWorkspaceItemTitle(item)}`}
						className="pointer-events-none absolute left-2 top-1/2 z-10 grid size-3.5 -translate-y-1/2 place-items-center rounded-full bg-[color:color-mix(in_oklch,var(--foreground)_48%,transparent)] text-[color:var(--background)] opacity-0 transition-[background-color,opacity] duration-[var(--duration-fast)] hover:bg-[color:color-mix(in_oklch,var(--foreground)_60%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
						onClick={() => onCloseItem(item.id)}
						type="button"
					>
						<X className="size-2.5" />
					</button>
					<button
						aria-selected={activeItemId === item.id}
						className={cn(
							"flex h-7 max-w-44 min-w-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-xs transition-[background-color,color,box-shadow] duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)]",
							activeItemId === item.id
								? "bg-[color:var(--surface-2)] text-[color:var(--text-primary)] shadow-[var(--shadow-minimal)]"
								: "text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)]",
						)}
						onClick={() => onSelectItem(item.id)}
						role="tab"
						title={getWorkspaceItemTitle(item)}
						type="button"
					>
						{item.type === "review" ? (
							<GitCompareArrows className="size-3.5 transition-opacity group-focus-within:opacity-0 group-hover:opacity-0" />
						) : item.type === "browser" ? (
							<Globe2 className="size-3.5 transition-opacity group-focus-within:opacity-0 group-hover:opacity-0" />
						) : item.type === "subagent" ? (
							<Bot className="size-3.5 transition-opacity group-focus-within:opacity-0 group-hover:opacity-0" />
						) : (
							<FileText className="size-3.5 transition-opacity group-focus-within:opacity-0 group-hover:opacity-0" />
						)}
						<span className="min-w-0 truncate">{getWorkspaceItemTitle(item)}</span>
					</button>
				</div>
			))}
		</div>
	);
}

function ReviewPanelBodyDeferredFallback() {
	return (
		<div
			aria-hidden="true"
			className="flex h-full min-h-0 overflow-hidden"
			data-slot="review-workspace-body-deferred"
		>
			<section className="min-w-0 flex-1 p-4">
				<div className="grid gap-3">
					<div className="h-8 rounded-[var(--radius-md)] bg-[color:var(--surface-2)]" />
					<div className="h-9 rounded-[var(--radius-md)] bg-[color:var(--surface-2)]" />
					<div className="h-52 rounded-[var(--radius-md)] bg-[color:var(--surface-1)]" />
					<div className="h-36 rounded-[var(--radius-md)] bg-[color:var(--surface-1)]" />
				</div>
			</section>
			<aside className="hidden w-[340px] shrink-0 p-3 shadow-[inset_1px_0_0_var(--border-subtle)] lg:block">
				<div className="grid gap-2">
					<div className="h-9 rounded-[var(--radius-md)] bg-[color:var(--surface-2)]" />
					<div className="h-7 rounded-[var(--radius-md)] bg-[color:var(--surface-1)]" />
					<div className="h-7 rounded-[var(--radius-md)] bg-[color:var(--surface-1)]" />
					<div className="h-7 rounded-[var(--radius-md)] bg-[color:var(--surface-1)]" />
				</div>
			</aside>
		</div>
	);
}

function FolderTreeRow<TFile extends { path: string }>({
	onToggle,
	row,
}: {
	onToggle: (path: string) => void;
	row: Extract<PathTreeFlatRow<TFile>, { type: "folder" }>;
}) {
	return (
		<button
			aria-expanded={row.expanded}
			className="flex h-7 w-full items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-left text-[13px] text-[color:var(--text-secondary)] transition-[background-color,color] duration-[var(--duration-fast)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)]"
			onClick={() => onToggle(row.path)}
			style={{ paddingLeft: 4 + row.depth * FILE_TREE_INDENT }}
			type="button"
		>
			{row.expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
			<span className="truncate">{row.name}</span>
		</button>
	);
}

function ReviewFileTreeRow({
	onSelect,
	row,
	selectedPath,
}: {
	onSelect: (file: DesktopReviewFile) => void;
	row: PathTreeFileRow<DesktopReviewFile>;
	selectedPath?: string;
}) {
	const file = row.file;
	const selected = selectedPath === file.path;
	return (
		<button
			className={cn(
				"grid h-8 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-md)] px-2 text-left text-[13px] transition-[background-color,color,box-shadow] duration-[var(--duration-fast)]",
				selected
					? "bg-[color:var(--surface-2)] text-[color:var(--text-primary)] shadow-[var(--shadow-minimal)]"
					: "text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)]",
			)}
			onClick={() => onSelect(file)}
			style={{ paddingLeft: 6 + row.depth * FILE_TREE_INDENT }}
			type="button"
		>
			{getFileIcon(file.path)}
			<span className="min-w-0 truncate" data-slot="review-file-name">
				{row.name}
			</span>
			<span
				className={cn(
					"shrink-0 justify-self-end rounded px-1.5 py-0.5 text-[10px] font-medium",
					getStatusClassName(file.status),
				)}
				data-slot="review-file-status-badge"
			>
				{STATUS_LABELS[file.status]}
			</span>
		</button>
	);
}

function WorkspaceFileTreeRow({
	onSelect,
	row,
	selectedPath,
}: {
	onSelect: (file: DesktopWorkspaceFileEntry) => void;
	row: PathTreeFileRow<DesktopWorkspaceFileEntry>;
	selectedPath?: string;
}) {
	const file = row.file;
	const selected = selectedPath === file.path;
	return (
		<button
			className={cn(
				"grid h-8 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-[var(--radius-md)] px-2 text-left text-[13px] transition-[background-color,color,box-shadow] duration-[var(--duration-fast)]",
				selected
					? "bg-[color:var(--surface-2)] text-[color:var(--text-primary)] shadow-[var(--shadow-minimal)]"
					: "text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)]",
			)}
			onClick={() => onSelect(file)}
			style={{ paddingLeft: 6 + row.depth * FILE_TREE_INDENT }}
			title={file.path}
			type="button"
		>
			{getFileIcon(file.path)}
			<span className="min-w-0 truncate" data-slot="workspace-file-tree-name">
				{row.name}
			</span>
		</button>
	);
}

function PathTree<TFile extends { path: string }>({
	ariaLabel,
	collapsedPaths,
	dataSlot,
	files,
	forceExpanded,
	onToggle,
	noMatchesMessage,
	renderFileRow,
}: {
	ariaLabel?: string;
	collapsedPaths: ReadonlySet<string>;
	dataSlot: string;
	files: TFile[];
	forceExpanded: boolean;
	onToggle: (path: string) => void;
	noMatchesMessage: string;
	renderFileRow: (row: PathTreeFileRow<TFile>) => ReactNode;
}) {
	const nodes = useMemo(() => createPathTree(files), [files]);
	const rows = useMemo(
		() => flattenTreeRows(nodes, collapsedPaths, forceExpanded),
		[collapsedPaths, forceExpanded, nodes],
	);
	if (nodes.length === 0) {
		return <p className="px-2 py-3 text-sm text-[color:var(--text-tertiary)]">{noMatchesMessage}</p>;
	}

	return (
		<VirtualStack
			ariaLabel={ariaLabel}
			className="native-scrollbar h-full overflow-y-auto overflow-x-hidden py-2 pr-3 pl-1"
			dataSlot={dataSlot}
			estimateSize={(index) => (rows[index]?.type === "folder" ? 28 : 32)}
			gap={2}
			getKey={(row) => row.id}
			initialViewportHeight={520}
			items={rows}
			overscan={8}
			renderItem={({ item }) =>
				item.type === "folder" ? <FolderTreeRow onToggle={onToggle} row={item} /> : renderFileRow(item)
			}
		/>
	);
}

function ResizableFileTreePanel({
	children,
	contentSlot,
	open,
	panelSlot,
	resizerLabel,
	resizerSlot,
	setWidth,
	spacerSlot,
	width,
}: {
	children: ReactNode;
	contentSlot: string;
	open: boolean;
	panelSlot: string;
	resizerLabel: string;
	resizerSlot: string;
	setWidth: (width: number) => void;
	spacerSlot: string;
	width: number;
}) {
	const panelHidden = !open;
	const fileTreeResize = useDragResize({
		clampValue: clampFileTreeWidth,
		getKeyValue: (key, currentWidth) => {
			if (key === "ArrowLeft") {
				return currentWidth + 16;
			}
			if (key === "ArrowRight") {
				return currentWidth - 16;
			}
			if (key === "Home") {
				return FILE_TREE_WIDTH.min;
			}
			if (key === "End") {
				return FILE_TREE_WIDTH.max;
			}
			return undefined;
		},
		getMotionValue: (startWidth, info) => startWidth - info.offset.x,
		setValue: setWidth,
		value: width,
	});
	const panelTransition = fileTreeResize.isResizing ? noMotionTransition : PUSH_REVEAL_TRANSITION;

	return (
		<motion.div
			className="relative hidden min-h-0 shrink-0 overflow-hidden lg:block"
			data-slot={spacerSlot}
			data-width={width}
			animate={{ width: open ? width : 0 }}
			initial={false}
			transition={panelTransition}
		>
			<motion.div
				aria-hidden={panelHidden}
				className="absolute inset-y-0 right-0 flex min-h-0 overflow-hidden"
				data-slot={panelSlot}
				data-width={width}
				inert={panelHidden}
				style={{ width }}
				transition={panelTransition}
			>
				<motion.div
					aria-label={open ? resizerLabel : undefined}
					aria-orientation="vertical"
					aria-valuemax={FILE_TREE_WIDTH.max}
					aria-valuemin={FILE_TREE_WIDTH.min}
					aria-valuenow={width}
					className="-left-1.5 group absolute inset-y-0 z-20 w-3 cursor-col-resize touch-none focus-visible:outline-none"
					data-slot={resizerSlot}
					drag="x"
					dragConstraints={{ left: 0, right: 0 }}
					dragElastic={0}
					dragMomentum={false}
					onDrag={(_event, info) => fileTreeResize.handleMotionDrag(info)}
					onDragEnd={fileTreeResize.handleMotionDragEnd}
					onDragStart={fileTreeResize.handleMotionDragStart}
					onKeyDown={fileTreeResize.handleKeyDown}
					role="separator"
					style={{ x: 0 }}
					tabIndex={panelHidden ? -1 : 0}
					transition={panelTransition}
				/>
				<aside
					className="flex min-h-0 flex-col bg-[color:var(--surface-1)] shadow-[inset_1px_0_0_var(--border-subtle)]"
					data-slot={contentSlot}
					style={{ width }}
				>
					{children}
				</aside>
			</motion.div>
		</motion.div>
	);
}

function DiffLine({ change }: { change: ParsedDiffFile["chunks"][number]["changes"][number] }) {
	const content = change.content.slice(1);
	const isAdd = change.type === "add";
	const isDelete = change.type === "del";
	const lineBackgroundClassName = isAdd
		? "bg-[color:color-mix(in_oklch,var(--success)_10%,var(--background))]"
		: isDelete
			? "bg-[color:color-mix(in_oklch,var(--destructive)_8%,var(--background))]"
			: "bg-[color:var(--background)]";
	const changeBarClassName = isAdd
		? "bg-[color:var(--success)]"
		: isDelete
			? "bg-[color:var(--destructive)]"
			: "bg-transparent";
	const displayLineNumber = change.type === "del" ? change.ln : change.type === "normal" ? change.ln2 : change.ln;
	return (
		<div
			className={cn(
				"grid w-max min-w-full grid-cols-[4px_52px_max-content] font-mono text-[12px] leading-5 text-[color:var(--text-primary)]",
				lineBackgroundClassName,
			)}
		>
			<span
				aria-hidden="true"
				className={cn("sticky left-0 z-[2] select-none", changeBarClassName)}
				data-slot="diff-change-bar"
			/>
			<span
				className={cn(
					"sticky left-[4px] z-[1] select-none px-2 text-right text-[color:var(--text-tertiary)] shadow-[inset_-1px_0_0_color-mix(in_oklch,var(--foreground)_6%,transparent)]",
					lineBackgroundClassName,
				)}
				data-slot="diff-line-number"
			>
				{displayLineNumber}
			</span>
			<pre className="overflow-visible pr-6 font-mono text-[12px] leading-5">{content || " "}</pre>
		</div>
	);
}

function DiffViewer({
	file,
	isPatchLoading = false,
	patchErrorMessage,
}: {
	file: DesktopReviewFile;
	isPatchLoading?: boolean;
	patchErrorMessage?: string;
}) {
	const diffViewportRef = useRef<HTMLElement | null>(null);
	const parsedFiles = useMemo(() => (file.patch ? parseDiff(file.patch) : []), [file.patch]);
	const parsedFile = parsedFiles[0];
	const [collapsedChunkKeys, setCollapsedChunkKeys] = useState<Set<string>>(() => new Set());
	const [diffViewportWidth, setDiffViewportWidth] = useState(0);

	useEffect(() => {
		const viewport = diffViewportRef.current;
		if (!viewport) {
			return;
		}

		return observeElementResize(viewport, () => setDiffViewportWidth(viewport.clientWidth));
	}, []);

	function toggleChunk(chunkKey: string): void {
		setCollapsedChunkKeys((currentKeys) => {
			const nextKeys = new Set(currentKeys);
			if (nextKeys.has(chunkKey)) {
				nextKeys.delete(chunkKey);
			} else {
				nextKeys.add(chunkKey);
			}
			return nextKeys;
		});
	}

	if (file.isBinary) {
		return (
			<div className="grid h-full place-items-center p-10 text-center">
				<div className="grid justify-items-center gap-2 text-[color:var(--text-tertiary)]">
					<Binary className="size-6" />
					<p className="text-sm">二进制文件无法展示文本差异。</p>
				</div>
			</div>
		);
	}

	if (isPatchLoading) {
		return (
			<div aria-busy="true" className="grid h-full place-items-center p-10 text-center">
				<div className="grid justify-items-center gap-2 text-[color:var(--text-tertiary)]">
					<RefreshCcw className="size-5 animate-spin" />
					<p className="text-sm">正在加载 diff...</p>
				</div>
			</div>
		);
	}

	if (patchErrorMessage) {
		return (
			<div className="grid h-full place-items-center p-10 text-center">
				<div className="grid justify-items-center gap-2 text-[color:var(--text-tertiary)]">
					<AlertCircle className="size-6" />
					<p className="text-sm">{patchErrorMessage}</p>
				</div>
			</div>
		);
	}

	if (file.isTooLarge || !parsedFile) {
		return (
			<div className="grid h-full place-items-center p-10 text-center">
				<div className="grid justify-items-center gap-2 text-[color:var(--text-tertiary)]">
					<AlertCircle className="size-6" />
					<p className="text-sm">此文件没有可展示的文本 diff。</p>
				</div>
			</div>
		);
	}

	return (
		<section
			aria-label="Diff viewer"
			className="native-scrollbar h-full min-h-0 overflow-x-auto overflow-y-auto overscroll-contain"
			ref={diffViewportRef}
		>
			<div className="inline-block min-w-full py-2 pb-5">
				{parsedFile.chunks.map((chunk) => {
					const chunkKey = getDiffChunkKey(chunk);
					const chunkContext = getDiffChunkContext(chunk.content);
					const expanded = !collapsedChunkKeys.has(chunkKey);
					const oldRange = formatDiffChunkRange(chunk.oldStart, chunk.oldLines);
					const newRange = formatDiffChunkRange(chunk.newStart, chunk.newLines);
					const hunkHeaderWidth = diffViewportWidth > 16 ? diffViewportWidth - 16 : undefined;
					return (
						<div className="mb-4 w-max min-w-full pt-1" data-slot="diff-hunk" key={chunkKey}>
							<div className="mb-1.5 h-8 min-w-full px-2" data-slot="diff-hunk-row">
								<button
									aria-expanded={expanded}
									aria-label={`${expanded ? "Collapse" : "Expand"} diff hunk old ${oldRange} new ${newRange}`}
									className="sticky left-2 z-[2] inline-flex h-full min-w-0 items-center overflow-hidden rounded-[var(--radius-md)] bg-[color:var(--surface-2)] pr-3 text-left text-xs text-[color:var(--text-secondary)] shadow-[var(--shadow-minimal)] transition-[background-color,color,box-shadow] duration-[var(--duration-fast)] hover:bg-[color:var(--surface-3)] hover:text-[color:var(--text-primary)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)]"
									data-slot="diff-hunk-header"
									onClick={() => toggleChunk(chunkKey)}
									style={hunkHeaderWidth ? { width: hunkHeaderWidth } : undefined}
									title={chunk.content}
									type="button"
								>
									<span className="grid w-7 shrink-0 place-items-center">
										{expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
									</span>
									<span className="flex min-w-0 items-center gap-2">
										<span className="shrink-0 rounded-[var(--radius-sm)] bg-[color:var(--surface-1)] px-1.5 py-0.5 font-mono text-[11px] text-[color:var(--text-tertiary)]">
											旧 {oldRange}
										</span>
										<span className="shrink-0 rounded-[var(--radius-sm)] bg-[color:var(--surface-1)] px-1.5 py-0.5 font-mono text-[11px] text-[color:var(--text-tertiary)]">
											新 {newRange}
										</span>
										<span className="truncate font-mono text-[11px] text-[color:var(--text-tertiary)]">
											{chunkContext || "变更片段"}
										</span>
									</span>
								</button>
							</div>
							{expanded
								? chunk.changes.map((change, index) => (
										<DiffLine change={change} key={`${index}:${change.content}`} />
									))
								: null}
						</div>
					);
				})}
			</div>
		</section>
	);
}

function PreviewSourceCode({ file }: { file: DesktopPreviewFile }) {
	return (
		<CodeBlock
			bodyClassName="min-h-full p-4 text-[12px] leading-5"
			className="h-full rounded-none border-0 bg-[color:var(--background)] shadow-none"
			code={file.content ?? ""}
			contentClassName="h-full min-h-0"
			data-slot="preview-source-code"
			language={resolvePreviewSourceLanguage(file)}
			showLineNumbers
			waitForHighlight
		/>
	);
}

function FileTreeToggleButton({
	active,
	label,
	onClick,
	size = "icon-xs",
}: {
	active: boolean;
	label: string;
	onClick: () => void;
	size?: "icon-sm" | "icon-xs";
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={label}
					aria-pressed={active}
					className={active ? "bg-[color:var(--surface-2)] text-[color:var(--text-primary)]" : undefined}
					onClick={onClick}
					size={size}
					type="button"
					variant="ghost"
				>
					<Folder className={size === "icon-sm" ? "size-4" : "size-3.5"} />
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

function FilePreviewToolbar({
	file,
	fileTreeToggle,
	onRefresh,
}: {
	file: DesktopPreviewFile;
	fileTreeToggle: FileTreeToggleState;
	onRefresh: () => void;
}) {
	return (
		<div className="flex h-10 shrink-0 items-center justify-between gap-2 bg-[color:var(--surface-1)] px-3">
			<div className="min-w-0">
				<p className="truncate text-[13px] font-medium text-[color:var(--text-primary)]" title={file.path}>
					{file.name}
				</p>
				{file.kind === "text" && file.content !== undefined ? (
					<p className="truncate text-[11px] text-[color:var(--text-tertiary)]">{file.mimeType}</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<FileTreeToggleButton {...fileTreeToggle} />
				<Button
					aria-label={`Refresh ${file.name}`}
					onClick={onRefresh}
					size="icon-xs"
					type="button"
					variant="ghost"
				>
					<RefreshCcw className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}

function FilePreviewPane({
	file,
	fileTreeToggle,
	onRefresh,
}: {
	file: DesktopPreviewFile;
	fileTreeToggle: FileTreeToggleState;
	onRefresh: () => void;
}) {
	if (file.kind === "image" && file.dataUrl) {
		return (
			<section className="flex h-full min-h-0 min-w-0 flex-col" data-slot="workspace-preview-pane">
				<FilePreviewToolbar file={file} fileTreeToggle={fileTreeToggle} onRefresh={onRefresh} />
				<div className="grid min-h-0 min-w-0 flex-1 place-items-center overflow-auto bg-[color:var(--background)] p-4">
					<img alt={file.name} className="max-h-full max-w-full object-contain" src={file.dataUrl} />
				</div>
			</section>
		);
	}

	if (file.kind === "text" && file.content !== undefined) {
		return (
			<section className="flex h-full min-h-0 min-w-0 flex-col" data-slot="workspace-preview-pane">
				<FilePreviewToolbar file={file} fileTreeToggle={fileTreeToggle} onRefresh={onRefresh} />
				<div className="min-h-0 min-w-0 flex-1 overflow-auto bg-[color:var(--background)]">
					<PreviewSourceCode file={file} />
				</div>
			</section>
		);
	}

	return (
		<section className="flex h-full min-h-0 min-w-0 flex-col" data-slot="workspace-preview-pane">
			<FilePreviewToolbar file={file} fileTreeToggle={fileTreeToggle} onRefresh={onRefresh} />
			<div className="grid min-h-0 flex-1 place-items-center px-8 py-12 text-center">
				<div className="grid max-w-xs justify-items-center gap-2 text-[color:var(--text-tertiary)]">
					<AlertCircle className="size-6" />
					<p className="text-sm">{file.errorMessage ?? "此文件无法预览。"}</p>
				</div>
			</div>
		</section>
	);
}

function getSelectedWorkspaceFilePath(files: DesktopWorkspaceFileEntry[], previewPath: string): string | undefined {
	return files.find((file) => previewPath === file.path || previewPath.endsWith(`/${file.path}`))?.path;
}

function WorkspaceFileTreeContent({
	errorMessage,
	filesResult,
	onOpenFile,
	query,
	selectedPath,
	setQuery,
	status,
}: {
	errorMessage?: string;
	filesResult?: DesktopWorkspaceFileListResult;
	onOpenFile: (file: DesktopWorkspaceFileEntry) => void;
	query: string;
	selectedPath?: string;
	setQuery: (query: string) => void;
	status: WorkspaceFileListStatus;
}) {
	const files = useMemo(() => filterTreeFiles(filesResult?.files ?? [], query), [filesResult?.files, query]);
	const [collapsedTreePaths, setCollapsedTreePaths] = useState<Set<string>>(() => new Set());
	const hasFileQuery = query.trim().length > 0;

	function toggleTreePath(path: string): void {
		setCollapsedTreePaths((currentPaths) => {
			const nextPaths = new Set(currentPaths);
			if (nextPaths.has(path)) {
				nextPaths.delete(path);
			} else {
				nextPaths.add(path);
			}
			return nextPaths;
		});
	}

	return (
		<>
			<div className="px-2 py-2">
				<div className="relative">
					<Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-[color:var(--text-tertiary)]" />
					<Input
						className="h-9 rounded-[var(--radius-lg)] border-transparent bg-[color:var(--surface-2)] pl-8 text-sm shadow-none"
						onChange={(event) => setQuery(event.target.value)}
						placeholder="筛选文件..."
						value={query}
					/>
				</div>
			</div>
			{filesResult?.truncated ? (
				<p className="px-3 pb-1 text-[11px] text-[color:var(--text-tertiary)]">仅显示最近 5000 个文件</p>
			) : null}
			<section className="min-h-0 flex-1">
				{status === "idle" || status === "loading" ? (
					<div className="flex items-center gap-2 px-3 py-3 text-sm text-[color:var(--text-tertiary)]">
						<Spinner className="size-3.5" label="Loading workspace files" />
						<span>正在加载文件...</span>
					</div>
				) : status === "error" ? (
					<p className="px-3 py-3 text-sm text-[color:var(--text-tertiary)]">
						{errorMessage ?? "无法加载项目文件。"}
					</p>
				) : (filesResult?.files.length ?? 0) === 0 ? (
					<p className="px-3 py-3 text-sm text-[color:var(--text-tertiary)]">没有可显示的项目文件</p>
				) : (
					<PathTree
						ariaLabel="Workspace files tree"
						collapsedPaths={collapsedTreePaths}
						dataSlot="workspace-file-tree-virtual-list"
						files={files}
						forceExpanded={hasFileQuery}
						noMatchesMessage="没有匹配的文件"
						onToggle={toggleTreePath}
						renderFileRow={(row) => (
							<WorkspaceFileTreeRow onSelect={onOpenFile} row={row} selectedPath={selectedPath} />
						)}
					/>
				)}
			</section>
		</>
	);
}

function FilePreviewWorkspacePane({
	file,
	fileTreeOpen,
	fileTreeToggle,
	fileTreeWidth,
	onOpenWorkspaceFile,
	onRefresh,
	setFileTreeWidth,
	setWorkspaceFileQuery,
	workspaceFileListError,
	workspaceFileListResult,
	workspaceFileListStatus,
	workspaceFileQuery,
}: {
	file: DesktopPreviewFile;
	fileTreeOpen: boolean;
	fileTreeToggle: FileTreeToggleState;
	fileTreeWidth: number;
	onOpenWorkspaceFile: (file: DesktopWorkspaceFileEntry) => void;
	onRefresh: () => void;
	setFileTreeWidth: (width: number) => void;
	setWorkspaceFileQuery: (query: string) => void;
	workspaceFileListError?: string;
	workspaceFileListResult?: DesktopWorkspaceFileListResult;
	workspaceFileListStatus: WorkspaceFileListStatus;
	workspaceFileQuery: string;
}) {
	const selectedWorkspacePath = getSelectedWorkspaceFilePath(workspaceFileListResult?.files ?? [], file.path);

	return (
		<div className="relative flex h-full min-h-0 min-w-0 overflow-hidden" data-slot="workspace-file-preview-layout">
			<section className="min-h-0 min-w-0 flex-1">
				<FilePreviewPane file={file} fileTreeToggle={fileTreeToggle} onRefresh={onRefresh} />
			</section>
			<ResizableFileTreePanel
				contentSlot="workspace-file-tree-content"
				open={fileTreeOpen}
				panelSlot="workspace-file-tree-panel"
				resizerLabel="Resize workspace files panel"
				resizerSlot="workspace-file-tree-resizer"
				setWidth={setFileTreeWidth}
				spacerSlot="workspace-file-tree-spacer"
				width={fileTreeWidth}
			>
				<WorkspaceFileTreeContent
					errorMessage={workspaceFileListError}
					filesResult={workspaceFileListResult}
					onOpenFile={onOpenWorkspaceFile}
					query={workspaceFileQuery}
					selectedPath={selectedWorkspacePath}
					setQuery={setWorkspaceFileQuery}
					status={workspaceFileListStatus}
				/>
			</ResizableFileTreePanel>
		</div>
	);
}

function BrowserPreviewPane({
	isNativePreviewOccluded,
	isVisible,
	item,
	onNativeWebPreviewOcclusionChange,
	onUpdateUrl,
}: {
	isNativePreviewOccluded: boolean;
	isVisible: boolean;
	item: Extract<WorkspacePanelItem, { type: "browser" }>;
	onNativeWebPreviewOcclusionChange: SetNativeWebPreviewOcclusion;
	onUpdateUrl: (itemId: string, url: string) => void;
}) {
	const [inputValue, setInputValue] = useState(item.url);
	const [errorMessage, setErrorMessage] = useState<string | undefined>();
	const [isSelectMode, setIsSelectMode] = useState(false);
	const [actionsOpen, setActionsOpen] = useState(false);
	const [consoleLogs, setConsoleLogs] = useState<WebPreviewConsoleLog[]>([]);
	const [occlusionSnapshotDataUrl, setOcclusionSnapshotDataUrl] = useState<string | undefined>();
	const [previewState, setPreviewState] = useState<DesktopWebPreviewState | undefined>();
	const previewViewportRef = useRef<HTMLDivElement>(null);
	const itemIdRef = useRef(item.id);
	const isNativePreviewOccludedRef = useRef(isNativePreviewOccluded);
	const isAddressDirtyRef = useRef(false);
	const pendingSubmittedUrlRef = useRef<string | undefined>(item.url || undefined);
	const supersededUrlRef = useRef<string | undefined>(undefined);
	const canGoBack = previewState?.canGoBack ?? false;
	const canGoForward = previewState?.canGoForward ?? false;
	const hasPreviewUrl = Boolean(item.url);
	const canOpenExternalUrl = Boolean(item.url && !isDesktopStaticWebPreviewUrl(item.url));

	useEffect(() => {
		if (itemIdRef.current !== item.id) {
			itemIdRef.current = item.id;
			setIsSelectMode(false);
			setPreviewState(undefined);
			setOcclusionSnapshotDataUrl(undefined);
			isAddressDirtyRef.current = false;
			pendingSubmittedUrlRef.current = item.url || undefined;
			supersededUrlRef.current = undefined;
			setConsoleLogs(item.url ? [{ level: "log", message: `已打开 ${item.url}`, timestamp: new Date() }] : []);
		}
		if (!isAddressDirtyRef.current) {
			setInputValue(item.url);
		}
		setErrorMessage(undefined);
		if (!isNativePreviewOccludedRef.current) {
			setOcclusionSnapshotDataUrl(undefined);
		}
	}, [item.id, item.url]);

	useEffect(() => {
		if (!isVisible) {
			setIsSelectMode(false);
		}
	}, [isVisible]);

	const appendConsoleLog = useCallback((level: WebPreviewConsoleLog["level"], message: string): void => {
		setConsoleLogs((currentLogs) => [...currentLogs.slice(-79), { level, message, timestamp: new Date() }]);
	}, []);

	const applyPreviewState = useCallback((state: DesktopWebPreviewState): void => {
		setPreviewState(state);
		if (!isAddressDirtyRef.current) {
			setInputValue(state.url);
		}
	}, []);

	const isStalePreviewState = useCallback(
		(state: DesktopWebPreviewState): boolean => {
			const pendingUrl = pendingSubmittedUrlRef.current;
			if (pendingUrl && state.url && !isRelatedWebPreviewUrl(pendingUrl, state.url)) {
				return true;
			}
			const supersededUrl = supersededUrlRef.current;
			return Boolean(
				supersededUrl &&
					state.url &&
					isRelatedWebPreviewUrl(supersededUrl, state.url) &&
					item.url &&
					!isRelatedWebPreviewUrl(item.url, state.url),
			);
		},
		[item.url],
	);

	const applyTrustedPreviewState = useCallback(
		(state: DesktopWebPreviewState): void => {
			if (isStalePreviewState(state)) {
				return;
			}
			applyPreviewState(state);
			const pendingUrl = pendingSubmittedUrlRef.current;
			if (pendingUrl && state.url && isRelatedWebPreviewUrl(pendingUrl, state.url) && !state.isLoading) {
				pendingSubmittedUrlRef.current = undefined;
			}
		},
		[applyPreviewState, isStalePreviewState],
	);

	const getPreviewBounds = useCallback(() => {
		const viewport = previewViewportRef.current;
		if (!viewport) {
			return undefined;
		}
		const rect = viewport.getBoundingClientRect();
		return {
			height: Math.max(0, Math.round(rect.height)),
			width: Math.max(0, Math.round(rect.width)),
			x: Math.max(0, Math.round(rect.x)),
			y: Math.max(0, Math.round(rect.y)),
		};
	}, []);

	const showPreview = useCallback(() => {
		if (!isVisible || !item.url) {
			return;
		}
		const bounds = getPreviewBounds();
		if (!bounds) {
			return;
		}
		void window.desktopAgent
			?.showWebPreview?.({
				bounds,
				id: item.id,
				...(isNativePreviewOccludedRef.current ? { occluded: true } : {}),
				url: item.url,
			})
			.then(applyTrustedPreviewState)
			.catch((error: unknown) => {
				setErrorMessage(getErrorMessage(error));
			});
	}, [applyTrustedPreviewState, getPreviewBounds, isVisible, item.id, item.url]);

	const updatePreviewBounds = useCallback(() => {
		if (!hasPreviewUrl) {
			return;
		}
		const bounds = getPreviewBounds();
		if (!bounds) {
			return;
		}
		const isOccluded = isNativePreviewOccludedRef.current;
		if (!isOccluded) {
			setOcclusionSnapshotDataUrl(undefined);
		}
		const requestedItemId = item.id;
		void window.desktopAgent
			?.updateWebPreviewBounds?.({
				bounds,
				id: requestedItemId,
				occluded: isOccluded,
			})
			.then((snapshot) => {
				if (itemIdRef.current !== requestedItemId || !isNativePreviewOccludedRef.current) {
					setOcclusionSnapshotDataUrl(undefined);
					return;
				}
				if (snapshot?.dataUrl) {
					setOcclusionSnapshotDataUrl(snapshot.dataUrl);
				}
			})
			.catch(() => undefined);
	}, [getPreviewBounds, hasPreviewUrl, item.id]);

	useLayoutEffect(() => {
		isNativePreviewOccludedRef.current = isNativePreviewOccluded;
		if (!hasPreviewUrl || !isVisible) {
			return;
		}
		updatePreviewBounds();
	}, [hasPreviewUrl, isNativePreviewOccluded, isVisible, updatePreviewBounds]);

	useSubscribedResource<DesktopWebPreviewEvent>(
		(onEvent) =>
			hasPreviewUrl && isVisible ? window.desktopAgent?.subscribeToWebPreviewEvents?.(onEvent) : undefined,
		(event) => {
			if (event.type === "web_preview_element_selected") {
				if (event.id !== item.id) {
					return;
				}
				setIsSelectMode(false);
				appendConsoleLog("log", formatWebPreviewElementSelection(event.selection));
				return;
			}
			if (event.type !== "web_preview_state" || event.state.id !== item.id) {
				return;
			}
			if (isStalePreviewState(event.state)) {
				return;
			}
			applyTrustedPreviewState(event.state);
			if (event.state.isSelectingElement !== undefined) {
				setIsSelectMode(event.state.isSelectingElement);
			}
			if (event.state.errorMessage) {
				setErrorMessage(event.state.errorMessage);
				appendConsoleLog("error", event.state.errorMessage);
			} else {
				setErrorMessage(undefined);
			}
			if (!isAddressDirtyRef.current && event.state.url && event.state.url !== item.url) {
				onUpdateUrl(item.id, event.state.url);
			}
		},
		[
			appendConsoleLog,
			applyTrustedPreviewState,
			hasPreviewUrl,
			isStalePreviewState,
			isVisible,
			item.id,
			item.url,
			onUpdateUrl,
		],
	);

	useLayoutEffect(() => {
		if (!hasPreviewUrl || !isVisible) {
			return undefined;
		}
		updatePreviewBounds();
		const viewport = previewViewportRef.current;
		const cleanupResizeObserver = viewport
			? observeElementResize(viewport, updatePreviewBounds, { notifyImmediately: false })
			: undefined;
		window.addEventListener("resize", updatePreviewBounds);
		window.addEventListener("scroll", updatePreviewBounds, true);
		const animationFrame = window.requestAnimationFrame(updatePreviewBounds);
		const settlingTimers = [window.setTimeout(updatePreviewBounds, 120), window.setTimeout(updatePreviewBounds, 260)];
		return () => {
			window.cancelAnimationFrame(animationFrame);
			for (const timer of settlingTimers) {
				window.clearTimeout(timer);
			}
			window.removeEventListener("resize", updatePreviewBounds);
			window.removeEventListener("scroll", updatePreviewBounds, true);
			cleanupResizeObserver?.();
			void window.desktopAgent?.closeWebPreview?.({ id: item.id }).catch(() => undefined);
		};
	}, [hasPreviewUrl, isVisible, item.id, updatePreviewBounds]);

	useLayoutEffect(() => {
		showPreview();
	}, [showPreview]);

	function navigateToUrl(url: string): void {
		setPreviewState(undefined);
		setErrorMessage(undefined);
		supersededUrlRef.current = item.url && !isRelatedWebPreviewUrl(item.url, url) ? item.url : undefined;
		pendingSubmittedUrlRef.current = url;
		onUpdateUrl(item.id, url);
		isAddressDirtyRef.current = false;
		setInputValue(url);
		appendConsoleLog("log", `已打开 ${url}`);
	}

	function handleSubmit(): void {
		const nextUrl = normalizeDesktopWebPreviewUrl(inputValue);
		if (!nextUrl) {
			setErrorMessage(WEB_PREVIEW_ERROR_MESSAGE);
			appendConsoleLog("error", WEB_PREVIEW_ERROR_MESSAGE);
			return;
		}
		navigateToUrl(nextUrl);
	}

	function handleGoBack(): void {
		if (!canGoBack) {
			return;
		}
		pendingSubmittedUrlRef.current = undefined;
		supersededUrlRef.current = undefined;
		void window.desktopAgent
			?.controlWebPreview?.({
				action: "back",
				id: item.id,
			})
			.then(applyPreviewState)
			.catch((error: unknown) => {
				appendConsoleLog("error", getErrorMessage(error));
			});
	}

	function handleGoForward(): void {
		if (!canGoForward) {
			return;
		}
		pendingSubmittedUrlRef.current = undefined;
		supersededUrlRef.current = undefined;
		void window.desktopAgent
			?.controlWebPreview?.({
				action: "forward",
				id: item.id,
			})
			.then(applyPreviewState)
			.catch((error: unknown) => {
				appendConsoleLog("error", getErrorMessage(error));
			});
	}

	function handleReload(): void {
		if (!item.url || inputValue.trim() !== item.url) {
			handleSubmit();
			return;
		}
		pendingSubmittedUrlRef.current = item.url;
		supersededUrlRef.current = undefined;
		void window.desktopAgent
			?.controlWebPreview?.({
				action: "reload",
				id: item.id,
			})
			.then(applyPreviewState)
			.catch((error: unknown) => {
				appendConsoleLog("error", getErrorMessage(error));
			});
		appendConsoleLog("log", `已刷新 ${item.url}`);
	}

	function handleToggleSelect(): void {
		if (!item.url) {
			appendConsoleLog("warn", "请先打开网页。");
			return;
		}
		const nextIsSelectMode = !isSelectMode;
		setIsSelectMode(nextIsSelectMode);
		appendConsoleLog("log", nextIsSelectMode ? "选择模式已开启" : "选择模式已关闭");
		void window.desktopAgent
			?.setWebPreviewElementSelectionMode?.({
				enabled: nextIsSelectMode,
				id: item.id,
			})
			.then((state) => {
				applyPreviewState(state);
				setIsSelectMode(Boolean(state.isSelectingElement));
			})
			.catch((error: unknown) => {
				setIsSelectMode(false);
				appendConsoleLog("error", getErrorMessage(error));
			});
	}

	function handleOpenInNewTab(): void {
		if (!item.url || !canOpenExternalUrl) {
			return;
		}
		appendConsoleLog("log", `在浏览器打开 ${item.url}`);
		void window.desktopAgent?.openExternalUrl?.(item.url).catch((error: unknown) => {
			appendConsoleLog("error", getErrorMessage(error));
		});
	}

	function handleClearStorage(storage: "cache" | "cookies"): void {
		if (!item.url) {
			appendConsoleLog("warn", "请先打开网页。");
			return;
		}
		setActionsOpen(false);
		onNativeWebPreviewOcclusionChange("browser-actions", false);
		void window.desktopAgent
			?.clearWebPreviewStorage?.({
				id: item.id,
				storage,
			})
			.then((state) => {
				applyTrustedPreviewState(state);
				appendConsoleLog("log", storage === "cache" ? "已清除网页预览缓存" : "已清除网页预览 Cookie");
			})
			.catch((error: unknown) => {
				appendConsoleLog("error", getErrorMessage(error));
			});
	}

	function handleActionsOpenChange(nextOpen: boolean): void {
		setActionsOpen(nextOpen);
		onNativeWebPreviewOcclusionChange("browser-actions", nextOpen);
	}

	useEffect(() => {
		return () => onNativeWebPreviewOcclusionChange("browser-actions", false);
	}, [onNativeWebPreviewOcclusionChange]);

	return (
		<WebPreview className="h-full" data-slot="workspace-preview-pane" defaultUrl={item.url}>
			<WebPreviewNavigation>
				<WebPreviewNavigationButton disabled={!canGoBack} onClick={handleGoBack} tooltip="后退">
					<ArrowLeft className="size-3.5" />
				</WebPreviewNavigationButton>
				<WebPreviewNavigationButton disabled={!canGoForward} onClick={handleGoForward} tooltip="前进">
					<ArrowRight className="size-3.5" />
				</WebPreviewNavigationButton>
				<WebPreviewNavigationButton onClick={handleReload} tooltip="刷新网页预览">
					<RefreshCcw className="size-3.5" />
				</WebPreviewNavigationButton>
				<label className="sr-only" htmlFor={`${item.id}-url`}>
					Preview URL
				</label>
				<WebPreviewUrl
					aria-invalid={errorMessage ? true : undefined}
					id={`${item.id}-url`}
					onChange={(event) => {
						const nextValue = event.target.value;
						isAddressDirtyRef.current = nextValue.trim() !== item.url;
						setInputValue(nextValue);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							handleSubmit();
						}
					}}
					placeholder="https://google.com 或 http://localhost:3000"
					value={inputValue}
				/>
				<WebPreviewNavigationButton
					aria-pressed={isSelectMode}
					className={isSelectMode ? "bg-[color:var(--surface-2)] text-[color:var(--text-primary)]" : undefined}
					onClick={handleToggleSelect}
					tooltip="选择页面元素"
				>
					<MousePointerClick className="size-3.5" />
				</WebPreviewNavigationButton>
				<WebPreviewNavigationButton
					disabled={!canOpenExternalUrl}
					onClick={handleOpenInNewTab}
					tooltip="在浏览器打开"
				>
					<ExternalLink className="size-3.5" />
				</WebPreviewNavigationButton>
				<Popover onOpenChange={handleActionsOpenChange} open={actionsOpen}>
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<PopoverTrigger asChild>
									<Button
										aria-label="更多网页预览操作"
										className="desktop-window-no-drag"
										disabled={!item.url}
										size="icon-xs"
										type="button"
										variant="ghost"
									>
										<MoreHorizontal className="size-3.5" />
									</Button>
								</PopoverTrigger>
							</TooltipTrigger>
							<TooltipContent>更多网页预览操作</TooltipContent>
						</Tooltip>
					</TooltipProvider>
					<PopoverContent align="end" className="w-48 p-2">
						<div className="grid gap-1">
							<button
								className="flex h-9 items-center gap-3 rounded-[var(--radius-md)] px-2.5 text-left text-sm text-[color:var(--text-primary)] transition-[background-color,color] duration-[var(--duration-fast)] hover:bg-[color:var(--surface-2)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)]"
								onClick={() => handleClearStorage("cookies")}
								type="button"
							>
								<Cookie className="size-4 text-[color:var(--text-tertiary)]" />
								<span>清除 Cookie</span>
							</button>
							<button
								className="flex h-9 items-center gap-3 rounded-[var(--radius-md)] px-2.5 text-left text-sm text-[color:var(--text-primary)] transition-[background-color,color] duration-[var(--duration-fast)] hover:bg-[color:var(--surface-2)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)]"
								onClick={() => handleClearStorage("cache")}
								type="button"
							>
								<HardDrive className="size-4 text-[color:var(--text-tertiary)]" />
								<span>清除缓存</span>
							</button>
						</div>
					</PopoverContent>
				</Popover>
			</WebPreviewNavigation>
			{errorMessage ? <p className="px-3 py-2 text-xs text-[color:var(--destructive)]">{errorMessage}</p> : null}
			{item.url ? (
				<div
					className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-white"
					data-slot="workspace-preview-viewport"
					ref={previewViewportRef}
				>
					{isNativePreviewOccluded && occlusionSnapshotDataUrl ? (
						<img
							alt=""
							aria-hidden
							className="pointer-events-none absolute inset-0 z-[1] size-full object-fill"
							data-slot="workspace-preview-snapshot"
							src={occlusionSnapshotDataUrl}
						/>
					) : null}
					<div className="pointer-events-none absolute inset-0 grid place-items-center px-8 py-12 text-center">
						<p className="max-w-xs text-sm leading-5 text-[color:var(--text-tertiary)]">
							{previewState?.isLoading ? "正在加载网页..." : previewState?.title || "网页预览"}
						</p>
					</div>
				</div>
			) : (
				<div className="grid min-h-0 min-w-0 flex-1 place-items-center px-8 py-12 text-center">
					<p className="max-w-xs text-sm leading-5 text-[color:var(--text-tertiary)]">
						输入网页 URL 后在综合面板内打开。
					</p>
				</div>
			)}
			<WebPreviewConsole logs={consoleLogs} />
		</WebPreview>
	);
}

function ReviewPanelBody({
	errorMessage,
	fileTreeOpen,
	fileTreeToggle,
	fileTreeWidth,
	isLoading,
	isPatchLoading,
	onRefresh,
	patchErrorMessage,
	query,
	selectedFile,
	setQuery,
	setFileTreeWidth,
	setSelectedFile,
	snapshot,
}: {
	errorMessage?: string;
	fileTreeOpen: boolean;
	fileTreeToggle: FileTreeToggleState;
	fileTreeWidth: number;
	isLoading: boolean;
	isPatchLoading?: boolean;
	onRefresh: () => Promise<void>;
	patchErrorMessage?: string;
	query: string;
	selectedFile?: DesktopReviewFile;
	setQuery: (query: string) => void;
	setFileTreeWidth: (width: number) => void;
	setSelectedFile: (file: DesktopReviewFile) => void;
	snapshot?: DesktopReviewSnapshot;
}) {
	const files = useMemo(() => filterTreeFiles(snapshot?.files ?? [], query), [query, snapshot?.files]);
	const [collapsedTreePaths, setCollapsedTreePaths] = useState<Set<string>>(() => new Set());
	const hasFileQuery = query.trim().length > 0;

	function toggleTreePath(path: string): void {
		setCollapsedTreePaths((currentPaths) => {
			const nextPaths = new Set(currentPaths);
			if (nextPaths.has(path)) {
				nextPaths.delete(path);
			} else {
				nextPaths.add(path);
			}
			return nextPaths;
		});
	}

	if (isLoading && !snapshot) {
		return (
			<div className="relative flex h-full min-h-0 overflow-hidden">
				<div className="min-w-0 flex-1 space-y-3 p-4">
					<div className="h-8 w-2/3 rounded-[var(--radius-md)] bg-[color:var(--surface-2)]" />
					<div className="h-9 rounded-[var(--radius-md)] bg-[color:var(--surface-2)]" />
					<div className="h-32 rounded-[var(--radius-md)] bg-[color:var(--surface-1)]" />
					<div className="h-48 rounded-[var(--radius-md)] bg-[color:var(--surface-1)]" />
				</div>
				<motion.div
					aria-hidden="true"
					className="relative hidden min-h-0 shrink-0 overflow-hidden lg:block"
					animate={{ width: fileTreeOpen ? fileTreeWidth : 0 }}
					initial={false}
					transition={PUSH_REVEAL_TRANSITION}
				>
					<motion.div
						aria-hidden={!fileTreeOpen}
						className="absolute inset-y-0 right-0 min-h-0 overflow-hidden p-4 shadow-[inset_1px_0_0_var(--border-subtle)]"
						inert={!fileTreeOpen}
						style={{ width: fileTreeWidth }}
					>
						<div className="space-y-3">
							<div className="h-9 rounded-[var(--radius-md)] bg-[color:var(--surface-2)]" />
							<div className="h-7 rounded-[var(--radius-md)] bg-[color:var(--surface-1)]" />
							<div className="h-7 rounded-[var(--radius-md)] bg-[color:var(--surface-1)]" />
						</div>
					</motion.div>
				</motion.div>
			</div>
		);
	}

	if (errorMessage) {
		return <ReviewErrorState message={errorMessage} />;
	}

	if (!snapshot || snapshot.files.length === 0) {
		return <ReviewEmptyState snapshot={snapshot} />;
	}

	return (
		<div
			className="relative flex h-full min-h-0 min-w-0 overflow-hidden"
			data-resize-motion="contents-static"
			data-slot="review-workspace-body"
		>
			<section className="flex min-h-0 min-w-0 flex-1 flex-col">
				<div className="flex h-11 shrink-0 items-center gap-2 bg-[color:var(--surface-1)] px-3">
					<div className="flex min-w-0 flex-1 items-center text-[13px]" data-slot="review-selected-file-header">
						<span
							className="min-w-0 flex-1 truncate font-medium text-[color:var(--text-primary)]"
							title={selectedFile?.path}
						>
							{selectedFile ? formatPath(selectedFile.path) : "选择文件"}
						</span>
						{selectedFile ? (
							<span className="ml-2 shrink-0 text-[color:var(--success)]">+{selectedFile.additions}</span>
						) : null}
						{selectedFile ? (
							<span className="ml-1 shrink-0 text-[color:var(--destructive)]">-{selectedFile.deletions}</span>
						) : null}
					</div>
					<FileTreeToggleButton {...fileTreeToggle} />
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								aria-label="Refresh review"
								disabled={isLoading}
								onClick={() => void onRefresh()}
								size="icon-xs"
								variant="ghost"
							>
								<RefreshCcw className={cn("size-3.5", isLoading && "animate-spin")} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>刷新差异</TooltipContent>
					</Tooltip>
				</div>
				{snapshot.files.length > 1 ? (
					<div className="hidden shrink-0 bg-[color:var(--surface-1)] p-2 max-lg:block">
						<select
							className="h-9 w-full rounded-[var(--radius-md)] border border-transparent bg-[color:var(--surface-2)] px-3 text-sm text-[color:var(--text-primary)] outline-none transition-[background-color,box-shadow] focus-visible:shadow-[var(--control-focus-shadow)]"
							onChange={(event) => {
								const nextFile = snapshot.files.find((file) => file.path === event.target.value);
								if (nextFile) {
									setSelectedFile(nextFile);
								}
							}}
							value={selectedFile?.path ?? ""}
						>
							{snapshot.files.map((file) => (
								<option key={file.path} value={file.path}>
									{file.path} +{file.additions} -{file.deletions}
								</option>
							))}
						</select>
					</div>
				) : null}
				<div className="min-h-0 flex-1">
					{selectedFile ? (
						<DiffViewer
							file={selectedFile}
							isPatchLoading={isPatchLoading}
							key={selectedFile.path}
							patchErrorMessage={patchErrorMessage}
						/>
					) : (
						<ReviewEmptyState snapshot={snapshot} />
					)}
				</div>
			</section>

			<ResizableFileTreePanel
				contentSlot="review-file-tree-content"
				open={fileTreeOpen}
				panelSlot="review-file-tree-panel"
				resizerLabel="Resize changed files panel"
				resizerSlot="review-file-tree-resizer"
				setWidth={setFileTreeWidth}
				spacerSlot="review-file-tree-spacer"
				width={fileTreeWidth}
			>
				<div className="px-2 py-2">
					<div className="relative">
						<Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-[color:var(--text-tertiary)]" />
						<Input
							className="h-9 rounded-[var(--radius-lg)] border-transparent bg-[color:var(--surface-2)] pl-8 text-sm shadow-none"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="筛选文件..."
							value={query}
						/>
					</div>
				</div>
				<section className="min-h-0 flex-1">
					<PathTree
						ariaLabel={fileTreeOpen ? "Changed files tree" : undefined}
						collapsedPaths={collapsedTreePaths}
						dataSlot="review-file-tree-virtual-list"
						files={files}
						forceExpanded={hasFileQuery}
						noMatchesMessage="没有匹配的文件"
						onToggle={toggleTreePath}
						renderFileRow={(row) => (
							<ReviewFileTreeRow onSelect={setSelectedFile} row={row} selectedPath={selectedFile?.path} />
						)}
					/>
				</section>
			</ResizableFileTreePanel>
		</div>
	);
}

export function ReviewWorkspacePanel({
	open,
	isFullscreen,
	isTitlebarSummaryVisible = false,
	previewRequest,
	webPreviewRequest,
	projectId,
	sessionId,
	subagentRequest,
	workspaceLabel,
	onClose,
	onChromeSummaryChange,
	onFullscreenChange,
}: ReviewWorkspacePanelProps) {
	const { errorMessage, isLoading, loadFilePatch, refresh, snapshot } = useReviewWorkspace({
		open,
		projectId,
		sessionId,
	});
	const [fileTreeOpen, setFileTreeOpen] = useState(true);
	const [fileTreeWidth, setFileTreeWidth] = useState<number>(FILE_TREE_WIDTH.default);
	const [workspaceFileTreeOpen, setWorkspaceFileTreeOpen] = useState(false);
	const [workspaceFileTreeWidth, setWorkspaceFileTreeWidth] = useState<number>(FILE_TREE_WIDTH.default);
	const [query, setQuery] = useState("");
	const [workspaceFileQuery, setWorkspaceFileQuery] = useState("");
	const [selectedPath, setSelectedPath] = useState<string | undefined>();
	const [reviewPanelWidth, setReviewPanelWidth] = useState<number>(REVIEW_PANEL_WIDTH.default);
	const [containerWidth, setContainerWidth] = useState<number | undefined>();
	const [isResizingReviewPanel, setIsResizingReviewPanel] = useState(false);
	const [isFollowingContainerResize, setIsFollowingContainerResize] = useState(false);
	const [hasHydratedReviewBody, setHasHydratedReviewBody] = useState(false);
	const [workspaceItems, setWorkspaceItems] = useState<WorkspacePanelItem[]>([]);
	const [activeWorkspaceItemId, setActiveWorkspaceItemId] = useState<string | undefined>();
	const [isNativeWebPreviewOccluded, setIsNativeWebPreviewOccluded] = useState(false);
	const closeButtonRef = useRef<HTMLButtonElement | null>(null);
	const reviewSpacerRef = useRef<HTMLDivElement | null>(null);
	const containerResizeFrameRef = useRef<number | undefined>(undefined);
	const handledPreviewRequestNonceRef = useRef<number | undefined>(undefined);
	const handledWebPreviewRequestNonceRef = useRef<number | undefined>(undefined);
	const handledSubagentRequestNonceRef = useRef<number | undefined>(undefined);
	const nativeWebPreviewOcclusionSourcesRef = useRef<Set<NativeWebPreviewOcclusionSource>>(new Set());
	const requestedPatchPathsRef = useRef<Set<string>>(new Set());
	const workspaceContextKeyRef = useRef<string | undefined>(undefined);
	const [loadingPatchPath, setLoadingPatchPath] = useState<string | undefined>();
	const [patchErrorByPath, setPatchErrorByPath] = useState<Record<string, string>>({});
	const activeWorkspaceItem = workspaceItems.find((item) => item.id === activeWorkspaceItemId);
	const activeWorkspaceItemLabel = activeWorkspaceItem ? getWorkspaceItemTitle(activeWorkspaceItem) : "空面板";
	const hasReviewWorkspaceItem = workspaceItems.some((item) => item.type === "review");
	const isReviewWorkspaceItemActive = activeWorkspaceItem?.type === "review";
	const isFileWorkspaceItemActive = activeWorkspaceItem?.type === "file";
	const {
		errorMessage: workspaceFileListError,
		result: workspaceFileListResult,
		status: workspaceFileListStatus,
	} = useWorkspaceFiles({
		enabled: open && isFileWorkspaceItemActive && workspaceFileTreeOpen,
		limit: WORKSPACE_FILE_TREE_LIMIT,
		projectId,
		sessionId,
		unavailableMessage: "当前 workspace 不可用，无法列出文件。",
	});
	const selectedFile = snapshot?.files.find((file) => file.path === selectedPath) ?? snapshot?.files[0];
	const reviewAdditions = snapshot?.totals.additions ?? 0;
	const reviewDeletions = snapshot?.totals.deletions ?? 0;
	const reviewBranchLabel = snapshot?.branch ?? "no branch";
	const resolvedReviewPanelWidth = clampReviewPanelWidth(reviewPanelWidth, containerWidth);
	const reviewPanelLayoutWidth = isFullscreen ? "100%" : resolvedReviewPanelWidth;
	const reviewPanelDataWidth = isFullscreen ? "fill-parent" : String(Math.round(resolvedReviewPanelWidth));
	const reviewPanelWidthMode = isFullscreen ? "fill-parent" : "fixed";
	const reviewPanelMaxWidth = resolveReviewPanelMaxWidth(containerWidth);
	const reviewPanelWidthTransitionMode =
		isFullscreen || isResizingReviewPanel || isFollowingContainerResize ? "instant" : "animated";
	const reviewPanelTransition = reviewPanelWidthTransitionMode === "instant" ? noMotionTransition : panelSpring;
	const isFullscreenOpen = isFullscreen && open;
	const displayMode = isFullscreenOpen ? "fullscreen" : "panel";
	const reviewPanelLayoutDriver = isFullscreenOpen ? "overlay" : "width";
	const reviewPanelRootWidth = isFullscreenOpen ? "100%" : open ? resolvedReviewPanelWidth : 0;
	const FullscreenIcon = isFullscreen ? Minimize2 : Maximize2;

	const setNativeWebPreviewOcclusion = useCallback(
		(source: NativeWebPreviewOcclusionSource, occluded: boolean): void => {
			const sources = nativeWebPreviewOcclusionSourcesRef.current;
			if (occluded) {
				sources.add(source);
			} else {
				sources.delete(source);
			}
			setIsNativeWebPreviewOccluded(sources.size > 0);
		},
		[],
	);

	const markFollowingContainerResize = useCallback((): void => {
		setIsFollowingContainerResize(true);
		if (containerResizeFrameRef.current !== undefined) {
			cancelAnimationFrame(containerResizeFrameRef.current);
		}
		containerResizeFrameRef.current = requestAnimationFrame(() => {
			containerResizeFrameRef.current = undefined;
			setIsFollowingContainerResize(false);
		});
	}, []);

	const setReviewResizeActive = useCallback((active: boolean): void => {
		reviewSpacerRef.current?.setAttribute("data-review-resizing", String(active));
		setIsResizingReviewPanel(active);
	}, []);
	const reviewPanelResize = useDragResize({
		clampValue: (width) => clampReviewPanelWidth(width, containerWidth),
		getKeyValue: (key, currentWidth) => {
			if (key === "ArrowLeft") {
				return currentWidth + 16;
			}
			if (key === "ArrowRight") {
				return currentWidth - 16;
			}
			if (key === "Home") {
				return REVIEW_PANEL_WIDTH.min;
			}
			if (key === "End") {
				return REVIEW_PANEL_WIDTH.max;
			}
			return undefined;
		},
		onActiveChange: setReviewResizeActive,
		pointer: {
			cursor: "col-resize",
			getValue: (event, start) => start.value - (event.clientX - start.clientX),
			shouldStart: (event) => event.button === 0,
			userSelect: "none",
		},
		setValue: setReviewPanelWidth,
		value: resolvedReviewPanelWidth,
	});

	const handleRefreshWorkspaceFile = useCallback(async (itemId: string, path: string): Promise<void> => {
		const refreshedFile = await window.desktopAgent.refreshPreviewFile({ path });
		setWorkspaceItems((currentItems) =>
			currentItems.map((currentItem) =>
				currentItem.id === itemId && currentItem.type === "file"
					? { ...currentItem, file: refreshedFile }
					: currentItem,
			),
		);
	}, []);

	const upsertWorkspacePreviewFiles = useCallback((files: DesktopPreviewFile[]): void => {
		if (files.length === 0) {
			return;
		}
		const nextItems = files.map(createWorkspacePreviewItem);
		const nextActiveItemId = nextItems.at(-1)?.id;
		if (!nextActiveItemId) {
			return;
		}
		setWorkspaceItems((currentItems) => {
			const nextItemsById = new Map(currentItems.map((item) => [item.id, item]));
			for (const item of nextItems) {
				nextItemsById.set(item.id, item);
			}
			return retainRecentWorkspacePreviewFiles(Array.from(nextItemsById.values()), nextActiveItemId);
		});
		setActiveWorkspaceItemId(nextActiveItemId);
	}, []);

	const handleOpenWorkspaceTreeFile = useCallback(
		(file: DesktopWorkspaceFileEntry): void => {
			const request = projectId
				? { path: file.path, projectId }
				: sessionId
					? { path: file.path, sessionId }
					: undefined;
			if (!request) {
				upsertWorkspacePreviewFiles([createPreviewErrorFile(file.path, "当前 workspace 不可用，无法预览文件。")]);
				return;
			}

			void window.desktopAgent
				.openWorkspacePreviewFile(request)
				.then((previewFile) => upsertWorkspacePreviewFiles([previewFile]))
				.catch((error: unknown) => {
					upsertWorkspacePreviewFiles([createPreviewErrorFile(file.path, getErrorMessage(error))]);
				});
		},
		[projectId, sessionId, upsertWorkspacePreviewFiles],
	);

	const upsertWebPreviewUrl = useCallback((url: string): void => {
		const previewUrl = normalizeDesktopWebPreviewUrl(url);
		if (!previewUrl) {
			return;
		}
		const item: WorkspacePanelItem = {
			id: `browser:${previewUrl}`,
			type: "browser",
			title: getWebPreviewTitle(previewUrl),
			url: previewUrl,
		};
		setWorkspaceItems((currentItems) => {
			const nextItemsById = new Map(currentItems.map((currentItem) => [currentItem.id, currentItem]));
			nextItemsById.set(item.id, item);
			return Array.from(nextItemsById.values());
		});
		setActiveWorkspaceItemId(item.id);
	}, []);

	useEffect(() => {
		return () => {
			if (containerResizeFrameRef.current !== undefined) {
				cancelAnimationFrame(containerResizeFrameRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!onChromeSummaryChange) {
			return;
		}

		if (!open) {
			onChromeSummaryChange(undefined);
			return;
		}

		onChromeSummaryChange({
			activeItemLabel: activeWorkspaceItemLabel,
			additions: reviewAdditions,
			branchLabel: reviewBranchLabel,
			deletions: reviewDeletions,
			title: "综合面板",
			workspaceLabel,
		});
	}, [
		activeWorkspaceItemLabel,
		onChromeSummaryChange,
		open,
		reviewAdditions,
		reviewBranchLabel,
		reviewDeletions,
		workspaceLabel,
	]);

	useEffect(() => {
		return () => onChromeSummaryChange?.(undefined);
	}, [onChromeSummaryChange]);

	useEffect(() => {
		const nextWorkspaceContextKey = projectId
			? `project:${projectId}`
			: sessionId
				? `session:${sessionId}`
				: undefined;
		if (workspaceContextKeyRef.current === nextWorkspaceContextKey) {
			return;
		}
		workspaceContextKeyRef.current = nextWorkspaceContextKey;
		setWorkspaceItems([]);
		setActiveWorkspaceItemId(undefined);
		handledPreviewRequestNonceRef.current = undefined;
		handledWebPreviewRequestNonceRef.current = undefined;
		handledSubagentRequestNonceRef.current = undefined;
		requestedPatchPathsRef.current = new Set();
		setLoadingPatchPath(undefined);
		setPatchErrorByPath({});
		setWorkspaceFileTreeOpen(false);
		setWorkspaceFileQuery("");
	}, [projectId, sessionId]);

	const snapshotGeneratedAt = snapshot?.generatedAt;

	useEffect(() => {
		if (snapshotGeneratedAt === undefined) {
			requestedPatchPathsRef.current = new Set();
			setLoadingPatchPath(undefined);
			setPatchErrorByPath({});
			return;
		}
		requestedPatchPathsRef.current = new Set();
		setLoadingPatchPath(undefined);
		setPatchErrorByPath({});
	}, [snapshotGeneratedAt]);

	useEffect(() => {
		if (!open || !subagentRequest || handledSubagentRequestNonceRef.current === subagentRequest.nonce) {
			return;
		}
		handledSubagentRequestNonceRef.current = subagentRequest.nonce;
		const item: WorkspacePanelItem = {
			id: `subagent:${subagentRequest.parentSessionId}:${subagentRequest.subagentId}`,
			type: "subagent",
			request: subagentRequest,
		};
		setWorkspaceItems((currentItems) => {
			const nextItemsById = new Map(currentItems.map((currentItem) => [currentItem.id, currentItem]));
			nextItemsById.set(item.id, item);
			return Array.from(nextItemsById.values());
		});
		setActiveWorkspaceItemId(item.id);
	}, [open, subagentRequest]);

	useEffect(() => {
		if (!snapshot?.files.length) {
			setSelectedPath(undefined);
			return;
		}
		if (!selectedPath || !snapshot.files.some((file) => file.path === selectedPath)) {
			setSelectedPath(snapshot.files[0]?.path);
		}
	}, [selectedPath, snapshot]);

	useEffect(() => {
		if (
			!open ||
			!isReviewWorkspaceItemActive ||
			!selectedFile ||
			selectedFile.patch ||
			selectedFile.isBinary ||
			selectedFile.isTooLarge ||
			requestedPatchPathsRef.current.has(selectedFile.path)
		) {
			return;
		}

		let isDisposed = false;
		requestedPatchPathsRef.current.add(selectedFile.path);
		setLoadingPatchPath(selectedFile.path);
		setPatchErrorByPath((currentErrors) => {
			const { [selectedFile.path]: _previous, ...remainingErrors } = currentErrors;
			return remainingErrors;
		});
		void loadFilePatch(selectedFile.path)
			.then((file) => {
				if (!isDisposed && !file?.patch && !file?.isBinary && !file?.isTooLarge) {
					setPatchErrorByPath((currentErrors) => ({
						...currentErrors,
						[selectedFile.path]: "此文件没有可展示的文本 diff。",
					}));
				}
			})
			.catch((error: unknown) => {
				if (!isDisposed) {
					setPatchErrorByPath((currentErrors) => ({
						...currentErrors,
						[selectedFile.path]: getErrorMessage(error),
					}));
				}
			})
			.finally(() => {
				if (!isDisposed) {
					setLoadingPatchPath((currentPath) => (currentPath === selectedFile.path ? undefined : currentPath));
				}
			});
		return () => {
			isDisposed = true;
		};
	}, [isReviewWorkspaceItemActive, loadFilePatch, open, selectedFile]);

	useEffect(() => {
		if (!open) {
			return;
		}

		requestAnimationFrame(() => closeButtonRef.current?.focus());
	}, [open]);

	useEffect(() => {
		if (!open || !previewRequest || handledPreviewRequestNonceRef.current === previewRequest.nonce) {
			return;
		}
		handledPreviewRequestNonceRef.current = previewRequest.nonce;
		const request = projectId
			? { path: previewRequest.path, projectId }
			: sessionId
				? { path: previewRequest.path, sessionId }
				: undefined;
		if (!request) {
			upsertWorkspacePreviewFiles([
				createPreviewErrorFile(previewRequest.path, "当前 workspace 不可用，无法预览文件。"),
			]);
			return;
		}

		void window.desktopAgent
			.openWorkspacePreviewFile(request)
			.then((file) => upsertWorkspacePreviewFiles([file]))
			.catch((error: unknown) => {
				upsertWorkspacePreviewFiles([createPreviewErrorFile(previewRequest.path, getErrorMessage(error))]);
			});
	}, [open, previewRequest, projectId, sessionId, upsertWorkspacePreviewFiles]);

	useEffect(() => {
		if (!open || !webPreviewRequest || handledWebPreviewRequestNonceRef.current === webPreviewRequest.nonce) {
			return;
		}
		handledWebPreviewRequestNonceRef.current = webPreviewRequest.nonce;
		upsertWebPreviewUrl(webPreviewRequest.url);
	}, [open, upsertWebPreviewUrl, webPreviewRequest]);

	useSubscribedResource<SerializedAgentEvent>(
		(onEvent) => (open ? window.desktopAgent.subscribeToAgentEvents(onEvent) : undefined),
		(event) => {
			if (event.type !== "agent_end" || (sessionId && event.sessionId !== sessionId)) {
				return;
			}
			const fileItems = workspaceItems.filter(isWorkspacePreviewFileItem);
			if (fileItems.length === 0) {
				return;
			}
			void Promise.all(
				fileItems.map(async (item) => {
					if (item.type === "file") {
						await handleRefreshWorkspaceFile(item.id, item.file.path);
						return;
					}
					await window.desktopAgent.controlWebPreview({ action: "reload", id: item.id });
				}),
			);
		},
		[handleRefreshWorkspaceFile, open, sessionId, workspaceItems],
	);

	useEffect(() => {
		if (!open || !hasReviewWorkspaceItem || hasHydratedReviewBody) {
			return undefined;
		}

		const timeoutId = window.setTimeout(() => {
			setHasHydratedReviewBody(true);
		}, REVIEW_PANEL_BODY_HYDRATION_DELAY_MS);
		return () => window.clearTimeout(timeoutId);
	}, [hasHydratedReviewBody, hasReviewWorkspaceItem, open]);

	useEffect(() => {
		if (isFullscreen) {
			setIsFollowingContainerResize(false);
			return;
		}

		const spacer = reviewSpacerRef.current;
		const parentElement = spacer?.parentElement;
		if (!parentElement) {
			return;
		}
		const container = parentElement;

		function updateContainerWidth(): void {
			const nextContainerWidth = container.getBoundingClientRect().width;
			setContainerWidth((currentContainerWidth) => {
				if (currentContainerWidth === nextContainerWidth) {
					return currentContainerWidth;
				}
				if (currentContainerWidth !== undefined) {
					markFollowingContainerResize();
				}
				return nextContainerWidth;
			});
		}

		return observeElementResize(container, updateContainerWidth, { fallbackToWindow: true });
	}, [isFullscreen, markFollowingContainerResize]);

	async function handleOpenPreviewFiles(): Promise<void> {
		const request = projectId ? { projectId } : sessionId ? { sessionId } : undefined;
		if (!request) {
			return;
		}

		const files = await window.desktopAgent.openPreviewFiles(request);
		if (files.length === 0) {
			return;
		}

		upsertWorkspacePreviewFiles(files);
	}

	function handleOpenReview(): void {
		setWorkspaceItems((currentItems) =>
			currentItems.some((item) => item.type === "review") ? currentItems : [...currentItems, REVIEW_WORKSPACE_ITEM],
		);
		setActiveWorkspaceItemId(REVIEW_WORKSPACE_ITEM.id);
	}

	function handleOpenBrowser(): void {
		const id = `browser:${Date.now()}`;
		const item: WorkspacePanelItem = {
			id,
			type: "browser",
			title: "网页预览",
			url: "",
		};
		setWorkspaceItems((currentItems) => [...currentItems, item]);
		setActiveWorkspaceItemId(id);
	}

	function handleBrowserUrlUpdate(itemId: string, url: string): void {
		setWorkspaceItems((currentItems) =>
			currentItems.map((item) =>
				item.id === itemId && item.type === "browser"
					? {
							...item,
							title: item.sourceFile && isDesktopStaticWebPreviewUrl(url) ? item.title : getWebPreviewTitle(url),
							url,
						}
					: item,
			),
		);
	}

	function handleCloseWorkspaceItem(itemId: string): void {
		const itemIndex = workspaceItems.findIndex((item) => item.id === itemId);
		const nextItems = workspaceItems.filter((item) => item.id !== itemId);
		setWorkspaceItems(nextItems);
		if (activeWorkspaceItemId === itemId) {
			setActiveWorkspaceItemId(nextItems[itemIndex]?.id ?? nextItems[itemIndex - 1]?.id);
		}
	}

	const reviewFileTreeToggle: FileTreeToggleState = {
		active: fileTreeOpen,
		label: fileTreeOpen ? "收起变更文件列表" : "显示变更文件列表",
		onClick: () => setFileTreeOpen((current) => !current),
	};
	const workspaceFileTreeToggleState: FileTreeToggleState = {
		active: workspaceFileTreeOpen,
		label: workspaceFileTreeOpen ? "收起项目文件树" : "显示项目文件树",
		onClick: () => setWorkspaceFileTreeOpen((current) => !current),
	};

	return (
		<MotionConfig reducedMotion="never">
			<motion.div
				className={cn(
					"overflow-hidden",
					isFullscreenOpen ? "absolute inset-0 z-50 h-full" : "relative h-full shrink-0",
				)}
				data-motion="structural-drawer"
				data-motion-engine="motion"
				data-motion-mode="drawer"
				data-motion-origin="right"
				data-motion-owner="spacer"
				data-motion-scope="structural"
				data-slot="review-workspace-spacer"
				data-state={open ? "open" : "closed"}
				data-display-mode={displayMode}
				data-structural-layout-driver={reviewPanelLayoutDriver}
				data-width={reviewPanelDataWidth}
				data-width-mode={reviewPanelWidthMode}
				data-width-transition={reviewPanelWidthTransitionMode}
				data-review-resizing={isResizingReviewPanel}
				animate={{ width: reviewPanelRootWidth }}
				initial={false}
				ref={reviewSpacerRef}
				style={
					{
						pointerEvents: open ? "auto" : "none",
						"--structural-drawer-size": isFullscreenOpen ? "100%" : `${resolvedReviewPanelWidth}px`,
					} as CSSProperties
				}
				transition={reviewPanelTransition}
			>
				<aside
					aria-hidden={!open}
					aria-label="Review workspace"
					className="absolute inset-y-0 right-0 z-10 flex flex-col overflow-hidden border-l border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] shadow-[var(--shadow-modal)]"
					data-motion="structural-drawer"
					data-motion-engine="motion"
					data-motion-mode="drawer"
					data-motion-origin="right"
					data-motion-owner="fixed-content"
					data-motion-scope="structural"
					data-slot="review-workspace-panel"
					data-state={open ? "open" : "closed"}
					data-display-mode={displayMode}
					data-workbench-attachment={displayMode === "panel" ? "attached" : "detached"}
					data-width={reviewPanelDataWidth}
					data-width-mode={reviewPanelWidthMode}
					data-width-transition={reviewPanelWidthTransitionMode}
					inert={!open}
					style={{
						pointerEvents: open ? "auto" : "none",
						width: reviewPanelLayoutWidth,
					}}
				>
					{isFullscreen ? null : (
						<motion.div
							aria-label={open ? "Resize review panel" : undefined}
							aria-orientation="vertical"
							aria-valuemax={Math.round(reviewPanelMaxWidth)}
							aria-valuemin={Math.min(REVIEW_PANEL_WIDTH.min, Math.round(reviewPanelMaxWidth))}
							aria-valuenow={Math.round(resolvedReviewPanelWidth)}
							className="absolute inset-y-0 left-0 z-20 w-3 cursor-col-resize touch-none focus-visible:outline-none"
							data-slot="review-workspace-resizer"
							onKeyDown={reviewPanelResize.handleKeyDown}
							onPointerDownCapture={reviewPanelResize.handlePointerDown}
							role="separator"
							tabIndex={open ? 0 : -1}
						/>
					)}
					<div className="flex h-full min-w-0 flex-col">
						<header
							className={cn(
								"flex h-12 shrink-0 items-center gap-2 bg-[color:var(--surface-1)] px-2",
								!isTitlebarSummaryVisible && "desktop-window-drag-region",
							)}
							data-display-mode={displayMode}
							data-titlebar-summary-visible={isTitlebarSummaryVisible ? "true" : "false"}
							data-slot="review-workspace-header"
						>
							<div
								className="flex h-full min-w-0 flex-1 items-center gap-1"
								data-slot="review-workspace-tab-strip"
							>
								<WorkspaceCreateMenu
									onNativeWebPreviewOcclusionChange={setNativeWebPreviewOcclusion}
									onOpenBrowser={handleOpenBrowser}
									onOpenFiles={handleOpenPreviewFiles}
									onOpenReview={handleOpenReview}
								/>
								<WorkspacePanelTabs
									activeItemId={activeWorkspaceItem?.id}
									isFullscreen={isFullscreen}
									items={workspaceItems}
									onCloseItem={handleCloseWorkspaceItem}
									onSelectItem={setActiveWorkspaceItemId}
								/>
							</div>

							<div
								className="desktop-window-drag-region flex h-full shrink-0 items-center gap-1"
								data-slot="review-workspace-header-actions"
							>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											aria-label="Current branch"
											className="desktop-window-no-drag"
											size={isFullscreen ? "icon-sm" : "sm"}
											variant="ghost"
										>
											<GitBranch className="size-4" />
											{isFullscreen ? null : (
												<span className="max-w-28 truncate text-xs">{reviewBranchLabel}</span>
											)}
										</Button>
									</TooltipTrigger>
									<TooltipContent>当前分支: {reviewBranchLabel}</TooltipContent>
								</Tooltip>
								<GitActionMenu
									onNativeWebPreviewOcclusionChange={setNativeWebPreviewOcclusion}
									reason={snapshot?.actions.reason ?? "只读审查模式暂不执行 Git 写操作。"}
								/>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											aria-label={
												isFullscreen
													? "Exit review workspace fullscreen"
													: "Enter review workspace fullscreen"
											}
											aria-pressed={isFullscreen}
											className="desktop-window-no-drag"
											onClick={() => onFullscreenChange(!isFullscreen)}
											size="icon-sm"
											type="button"
											variant="ghost"
										>
											<FullscreenIcon className="size-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{isFullscreen ? "退出全屏" : "全屏预览"}</TooltipContent>
								</Tooltip>
								<Button
									aria-label="Close review workspace"
									className="desktop-window-no-drag"
									onClick={onClose}
									ref={closeButtonRef}
									size="icon-sm"
									variant="ghost"
								>
									<X className="size-4" />
								</Button>
							</div>
						</header>

						<div className="min-h-0 min-w-0 flex-1">
							{!activeWorkspaceItem ? (
								<WorkspaceEmptyState
									onOpenBrowser={handleOpenBrowser}
									onOpenFiles={handleOpenPreviewFiles}
									onOpenReview={handleOpenReview}
								/>
							) : activeWorkspaceItem.type === "file" ? (
								<FilePreviewWorkspacePane
									fileTreeOpen={workspaceFileTreeOpen}
									fileTreeToggle={workspaceFileTreeToggleState}
									fileTreeWidth={workspaceFileTreeWidth}
									file={activeWorkspaceItem.file}
									onOpenWorkspaceFile={handleOpenWorkspaceTreeFile}
									onRefresh={() =>
										void handleRefreshWorkspaceFile(activeWorkspaceItem.id, activeWorkspaceItem.file.path)
									}
									setFileTreeWidth={setWorkspaceFileTreeWidth}
									setWorkspaceFileQuery={setWorkspaceFileQuery}
									workspaceFileListError={workspaceFileListError}
									workspaceFileListResult={workspaceFileListResult}
									workspaceFileListStatus={workspaceFileListStatus}
									workspaceFileQuery={workspaceFileQuery}
								/>
							) : activeWorkspaceItem.type === "browser" ? (
								<BrowserPreviewPane
									isNativePreviewOccluded={isNativeWebPreviewOccluded}
									isVisible={open}
									item={activeWorkspaceItem}
									onNativeWebPreviewOcclusionChange={setNativeWebPreviewOcclusion}
									onUpdateUrl={handleBrowserUrlUpdate}
								/>
							) : activeWorkspaceItem.type === "subagent" ? (
								<SubagentDetailPane
									key={activeWorkspaceItem.request.nonce}
									request={activeWorkspaceItem.request}
								/>
							) : hasHydratedReviewBody ? (
								<ReviewPanelBody
									errorMessage={errorMessage}
									fileTreeOpen={fileTreeOpen}
									fileTreeToggle={reviewFileTreeToggle}
									fileTreeWidth={fileTreeWidth}
									isLoading={isLoading}
									isPatchLoading={loadingPatchPath === selectedFile?.path}
									onRefresh={refresh}
									patchErrorMessage={selectedFile ? patchErrorByPath[selectedFile.path] : undefined}
									query={query}
									selectedFile={selectedFile}
									setQuery={setQuery}
									setFileTreeWidth={setFileTreeWidth}
									setSelectedFile={(file) => setSelectedPath(file.path)}
									snapshot={snapshot}
								/>
							) : (
								<ReviewPanelBodyDeferredFallback />
							)}
						</div>
					</div>
				</aside>
			</motion.div>
		</MotionConfig>
	);
}
