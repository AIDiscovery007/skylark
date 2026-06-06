import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { FileUIPart } from "ai";
import {
	ArrowDown,
	Box,
	Check,
	CheckCircle2,
	ChevronDown,
	Circle,
	CircleAlert,
	CircleDot,
	Clock3,
	FileCode2,
	FileJson,
	FileSpreadsheet,
	FileText,
	FileType,
	ImageIcon,
	Sparkles,
	SquareSlash,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
	type ChangeEvent,
	type ClipboardEvent,
	Component,
	type ComponentPropsWithoutRef,
	type CompositionEvent,
	createContext,
	type DragEvent,
	type ErrorInfo,
	type FocusEvent,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	type Ref,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { defaultRemarkPlugins } from "streamdown";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityRow } from "@/components/ui/entity-row";
import { ErrorNotice } from "@/components/ui/error-notice";
import { Spinner } from "@/components/ui/spinner";
import { StatusDot, type StatusDotStatus } from "@/components/ui/status-dot";
import { activityDrawerTransition, softRevealTransition, subtleReveal } from "@/lib/motion";
import { markRendererPerformance, measureRendererPerformance } from "@/lib/performance-marks";
import type { DesktopAgentBridge } from "../../../shared/ipc-contract.ts";
import type { DesktopAgentModel } from "../../../shared/serialized-agent-event.ts";
import type {
	DesktopAgentMode,
	DesktopCapabilityCatalog,
	DesktopEnvironmentResource,
	DesktopEnvironmentResourceKind,
	DesktopEnvironmentResourceStatus,
	DesktopOAuthProviderStatus,
	DesktopPreparedPromptAttachment,
	DesktopPreviewFile,
	DesktopPromptAttachmentCandidate,
	DesktopPromptAttachmentDisplay,
	DesktopPromptAttachmentError,
	DesktopPromptCapabilityInvocation,
	DesktopPromptSubmission,
	DesktopProviderKeyStatus,
	DesktopRuntimeCatalog,
	DesktopSessionProfileUpdateInput,
	DesktopSettingsOpenRequest,
	DesktopSlashCommandSummary,
	DesktopTaskProgress,
	DesktopTaskProgressStatus,
	DesktopWorkspaceFileEntry,
} from "../../../shared/types.ts";
import { useWorkspaceStatus, type WorkspaceStatusState } from "../../hooks/use-workspace-status.ts";
import {
	createAssistantUiRuntimeMessages,
	DESKTOP_CAPABILITY_INVOCATIONS_METADATA_KEY,
	DESKTOP_COMPACTION_NOTICE_METADATA_KEY,
	DESKTOP_FILE_REFERENCES_METADATA_KEY,
	DESKTOP_PROPOSED_PLAN_METADATA_KEY,
	type DesktopCompactionNoticeMetadata,
	type DesktopProposedPlanMetadata,
	type DesktopThreadContentPart,
	type DesktopThreadFileReference,
	type DesktopThreadMessage,
	type DesktopThreadMessageStatus,
	getUserPromptAttachments,
} from "../../lib/assistant-runtime-adapter.ts";
import { cn } from "../../lib/utils.ts";
import { useAgentStore } from "../../stores/agent-store.ts";
import {
	Attachment,
	AttachmentInfo,
	AttachmentPreview,
	AttachmentRemove,
	Attachments,
} from "../ai-elements/attachments.tsx";
import { ChainOfThoughtImage } from "../ai-elements/chain-of-thought.tsx";
import { Conversation, ConversationContent } from "../ai-elements/conversation.tsx";
import {
	Message as AiMessage,
	MessageContent as AiMessageContent,
	MessageResponse,
	type MessageResponseProps,
} from "../ai-elements/message.tsx";
import { PromptInputTextarea } from "../ai-elements/prompt-input.tsx";
import { AgentRunActivity } from "./AgentRunActivity.tsx";
import { ComposerQuickControls } from "./ComposerQuickControls.tsx";
import {
	type ContextWindowUsage,
	resolveChatShellNoticeState,
	resolveContextWindowUsage,
	resolveModelContextWindow,
} from "./chat-helpers.ts";
import {
	SkylarkContextWindowControl,
	SkylarkPromptInputAttachmentButton,
	SkylarkPromptInputComposer,
} from "./SkylarkPromptInputComposer.tsx";
import {
	type ResolvedThreadImagePreview,
	type ThreadImagePreview,
	ThreadImagePreviewGrid,
	type ThreadImagePreviewGridItem,
	type WorkspaceImagePreviewResolver,
} from "./ThreadImagePreviewGrid.tsx";
import { ThreadRunStatusTask } from "./ThreadRunStatusTask.tsx";

const DEFAULT_COMPOSER_INSET_PX = 172;
const COMPOSER_SCROLL_GAP_PX = 24;
const COMPOSER_INPUT_MIN_HEIGHT_PX = 80;
const COMPOSER_INPUT_MAX_HEIGHT_PX = 224;
const ASSISTANT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 96;
const ASSISTANT_USER_SCROLL_DIRECTION_EPSILON_PX = 1;
const PROPOSED_PLAN_COLLAPSED_HEIGHT_PX = 360;
const PROPOSED_PLAN_COLLAPSED_LINES = 12;
const PROPOSED_PLAN_COLLAPSED_LENGTH = 900;
const HYDRATION_STATUS_DELAY_MS = 200;
const STREAMING_RENDER_THROTTLE_MS = 150;
type DesktopTextPart = Extract<DesktopThreadContentPart, { type: "text" }>;
type DesktopImagePart = Extract<DesktopThreadContentPart, { type: "image" }>;
type DesktopActivityPart = Extract<DesktopThreadContentPart, { type: "reasoning" | "tool-call" }>;
type DesktopAttachmentFilePart = FileUIPart & {
	id: string;
	desktopKind: DesktopPromptAttachmentDisplay["kind"];
	size: number;
};
type ThreadImageAttachmentFilePart = FileUIPart & {
	id: string;
};

function getThreadContentParts(message: DesktopThreadMessage): DesktopThreadContentPart[] {
	if (typeof message.content === "string") {
		return message.content.length > 0 ? [{ type: "text", text: message.content }] : [];
	}
	return [...message.content];
}

function getThreadTextParts(message: DesktopThreadMessage): DesktopTextPart[] {
	return getThreadContentParts(message).filter((part): part is DesktopTextPart => part.type === "text");
}

function getThreadImageParts(message: DesktopThreadMessage): DesktopImagePart[] {
	return getThreadContentParts(message).filter((part): part is DesktopImagePart => part.type === "image");
}

function getThreadActivityParts(message: DesktopThreadMessage): DesktopActivityPart[] {
	return getThreadContentParts(message).filter(
		(part): part is DesktopActivityPart => part.type === "reasoning" || part.type === "tool-call",
	);
}

function toPromptAttachmentFilePart(
	attachment: DesktopPromptAttachmentDisplay | DesktopPreparedPromptAttachment,
): DesktopAttachmentFilePart {
	const image = "images" in attachment ? attachment.images[0] : undefined;
	const canPreviewImage = attachment.kind === "image" && image !== undefined;
	return {
		type: "file",
		desktopKind: attachment.kind,
		filename: attachment.name,
		id: attachment.id,
		mediaType: canPreviewImage
			? attachment.mimeType
			: attachment.kind === "image"
				? "application/octet-stream"
				: attachment.mimeType,
		size: attachment.size,
		url: canPreviewImage ? `data:${image.mimeType};base64,${image.data}` : `desktop-attachment://${attachment.id}`,
	};
}

function getDataUrlMediaType(value: string): string {
	const match = /^data:([^;,]+)[;,]/i.exec(value);
	return match?.[1] ?? "image/*";
}

function toThreadImageAttachmentFilePart(image: DesktopImagePart, id: string): ThreadImageAttachmentFilePart {
	const filename = image.filename ?? "Attached visual";
	return {
		type: "file",
		filename,
		id,
		mediaType: getDataUrlMediaType(image.image),
		url: image.image,
	};
}

const ASSISTANT_MARKDOWN_CLASSNAME = cn(
	"grid gap-3 text-[13px] leading-6 text-foreground",
	"[&_a]:break-words [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
	"[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
	"[&_li]:pl-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:m-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground [&_ul]:ml-5 [&_ul]:list-disc",
	"[&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left",
);
const WORKSPACE_PREVIEW_LINK_PREFIX = "https://workspace-preview.invalid/";

interface MarkdownAstNode {
	children?: MarkdownAstNode[];
	type?: string;
	url?: unknown;
}

const WorkspacePreviewLinkContext = createContext<((path: string) => void) | undefined>(undefined);
const ProposedPlanExecutionContext = createContext<
	| {
			disabled: boolean;
			isStreaming: boolean;
			latestPlanMessageId?: string;
			consumedProposedPlanMessageIds: readonly string[];
			onConsumeProposedPlan?: (planMessageId: string) => Promise<void>;
			onExecutePlan?: () => Promise<void>;
	  }
	| undefined
>(undefined);

interface AssistantTimelineErrorBoundaryProps {
	children: ReactNode;
	resetKey: string;
}

interface AssistantTimelineErrorBoundaryState {
	error?: Error;
}

class AssistantTimelineErrorBoundary extends Component<
	AssistantTimelineErrorBoundaryProps,
	AssistantTimelineErrorBoundaryState
> {
	state: AssistantTimelineErrorBoundaryState = {};

	static getDerivedStateFromError(error: Error): AssistantTimelineErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error("Assistant timeline render failed", error, errorInfo);
	}

	componentDidUpdate(previousProps: AssistantTimelineErrorBoundaryProps): void {
		if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
			this.setState({ error: undefined });
		}
	}

	render(): ReactNode {
		if (this.state.error) {
			return (
				<div
					className="absolute inset-0 flex items-start justify-center px-5 py-6"
					data-slot="assistant-thread-error"
				>
					<ErrorNotice
						className="max-w-[880px]"
						description={this.state.error.message || "The conversation could not be rendered."}
						title="Conversation render failed"
					/>
				</div>
			);
		}
		return this.props.children;
	}
}

interface ChatWorkbenchProps {
	activeProjectId?: string;
	composerFocusRequest?: {
		nonce: number;
		sessionId: string;
	};
	onAbort: () => Promise<void>;
	onCompact?: (customInstructions?: string) => Promise<void>;
	onConsumeProposedPlan?: (planMessageId: string) => Promise<void>;
	onExecutePlan?: () => Promise<void>;
	oauthProviders?: DesktopOAuthProviderStatus[];
	onOpenSettings?: (request?: DesktopSettingsOpenRequest) => void;
	onOpenEnvironmentResource?: (resource: DesktopEnvironmentResource) => void;
	onOpenWorkspacePreviewFile?: (path: string) => void;
	onRequestCapabilities?: () => Promise<void> | void;
	onSetSessionMode?: (agentMode: DesktopAgentMode) => Promise<void>;
	onSubmitPrompt: (request: DesktopPromptSubmission) => Promise<void>;
	onUpdateSessionProfile?: (update: DesktopSessionProfileUpdateInput) => Promise<void>;
	providerKeys?: DesktopProviderKeyStatus[];
	runtimeCatalog?: DesktopRuntimeCatalog;
	showThinkingBlocks: boolean;
	capabilityCatalog?: DesktopCapabilityCatalog;
	isWorkspacePanelOpen?: boolean;
	workspaceStatus?: WorkspaceStatusState;
}

interface AssistantComposerProps {
	activeProjectId?: string;
	activeSessionId?: string;
	attachmentErrors: DesktopPromptAttachmentError[];
	agentMode: DesktopAgentMode;
	capabilityCatalog?: DesktopCapabilityCatalog;
	contextWindowUsage?: ContextWindowUsage;
	disabled: boolean;
	inputRef: Ref<HTMLTextAreaElement>;
	isStreaming: boolean;
	model?: DesktopAgentModel;
	onAbort: () => Promise<void>;
	oauthProviders?: DesktopOAuthProviderStatus[];
	onOpenSettings?: (request?: DesktopSettingsOpenRequest) => void;
	onOpenWorkspacePreviewFile?: (path: string) => void;
	onCompact?: (customInstructions?: string) => Promise<void>;
	onRequestCapabilities?: () => Promise<void> | void;
	onSetSessionMode?: (agentMode: DesktopAgentMode) => Promise<void>;
	onSubmitPrompt: (request: DesktopPromptSubmission) => Promise<void>;
	onUpdateSessionProfile?: (update: DesktopSessionProfileUpdateInput) => Promise<void>;
	providerKeys?: DesktopProviderKeyStatus[];
	runtimeCatalog?: DesktopRuntimeCatalog;
	selectedCapabilityInvocations: DesktopPromptCapabilityInvocation[];
	selectedPromptAttachments: DesktopPreparedPromptAttachment[];
	setAttachmentErrors: (errors: DesktopPromptAttachmentError[]) => void;
	setSelectedCapabilityInvocations: (invocations: DesktopPromptCapabilityInvocation[]) => void;
	setSelectedPromptAttachments: (attachments: DesktopPreparedPromptAttachment[]) => void;
	thinkingLevel: ThinkingLevel;
}

function isCompositionInputEvent(nativeEvent: Event): boolean {
	const inputEvent = nativeEvent as InputEvent & { isComposing?: boolean };
	return (
		inputEvent.isComposing === true ||
		inputEvent.inputType === "insertCompositionText" ||
		inputEvent.inputType === "deleteCompositionText"
	);
}

function isCompositionKeyEvent(nativeEvent: Event, key: string): boolean {
	const keyboardEvent = nativeEvent as globalThis.KeyboardEvent & { isComposing?: boolean };
	return keyboardEvent.isComposing === true || key === "Process";
}

function assignTextareaRef(ref: Ref<HTMLTextAreaElement>, element: HTMLTextAreaElement | null): void {
	if (!ref) {
		return;
	}
	if (typeof ref === "function") {
		ref(element);
		return;
	}
	(ref as { current: HTMLTextAreaElement | null }).current = element;
}

function isAssistantViewportPinnedToBottom(viewport: HTMLDivElement): boolean {
	return (
		viewport.scrollHeight <= viewport.clientHeight ||
		viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= ASSISTANT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX
	);
}

function scrollAssistantViewportToBottom(viewport: HTMLDivElement, behavior: ScrollBehavior): void {
	const top = viewport.scrollHeight;
	if (typeof viewport.scrollTo === "function") {
		viewport.scrollTo({ behavior, top });
		return;
	}
	viewport.scrollTop = top;
}

function scrollAssistantViewportToBottomFromUserAction(viewport: HTMLDivElement): void {
	scrollAssistantViewportToBottom(viewport, "auto");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	let binary = "";
	for (let index = 0; index < bytes.length; index += chunkSize) {
		const chunk = bytes.subarray(index, index + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

async function createInlineImageCandidate(file: File): Promise<DesktopPromptAttachmentCandidate> {
	const buffer = await file.arrayBuffer();
	return {
		type: "inline_image",
		name: file.name || "pasted-image",
		mimeType: file.type || "image/png",
		data: arrayBufferToBase64(buffer),
		size: file.size,
	};
}

async function createPromptAttachmentCandidatesFromFiles(
	files: FileList | File[],
): Promise<DesktopPromptAttachmentCandidate[]> {
	const candidates: DesktopPromptAttachmentCandidate[] = [];
	for (const file of Array.from(files)) {
		const filePath = (file as File & { path?: string }).path;
		if (filePath) {
			candidates.push({ type: "path", path: filePath });
			continue;
		}
		if (file.type.startsWith("image/")) {
			candidates.push(await createInlineImageCandidate(file));
		}
	}
	return candidates;
}

function isCompactCommand(text: string): boolean {
	return text === "/compact" || text.startsWith("/compact ");
}

function getCompactInstructions(text: string): string | undefined {
	if (!text.startsWith("/compact ")) {
		return undefined;
	}
	const instructions = text.slice("/compact ".length).trim();
	return instructions.length > 0 ? instructions : undefined;
}

function getRefTextareaValue(ref: Ref<HTMLTextAreaElement>): string | undefined {
	if (typeof ref === "function" || ref === null) {
		return undefined;
	}
	return ref.current?.value;
}

function getRefTextareaElement(ref: Ref<HTMLTextAreaElement>): HTMLTextAreaElement | undefined {
	if (typeof ref === "function" || ref === null) {
		return undefined;
	}
	return ref.current ?? undefined;
}

function AssistantScrollToBottomButton({ viewport }: { viewport: HTMLDivElement | null }) {
	const [isAtBottom, setIsAtBottom] = useState(true);

	const updateIsAtBottom = useCallback(() => {
		setIsAtBottom(viewport ? isAssistantViewportPinnedToBottom(viewport) : true);
	}, [viewport]);

	useLayoutEffect(() => {
		if (!viewport) {
			setIsAtBottom(true);
			return;
		}

		updateIsAtBottom();
		viewport.addEventListener("scroll", updateIsAtBottom, { passive: true });
		const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateIsAtBottom) : undefined;
		resizeObserver?.observe(viewport);
		const mutationObserver =
			typeof MutationObserver !== "undefined" ? new MutationObserver(updateIsAtBottom) : undefined;
		mutationObserver?.observe(viewport, {
			attributes: true,
			characterData: true,
			childList: true,
			subtree: true,
		});

		return () => {
			viewport.removeEventListener("scroll", updateIsAtBottom);
			resizeObserver?.disconnect();
			mutationObserver?.disconnect();
		};
	}, [updateIsAtBottom, viewport]);

	function handleClick(): void {
		if (!viewport || isAtBottom) {
			return;
		}
		scrollAssistantViewportToBottomFromUserAction(viewport);
		setIsAtBottom(true);
	}

	return (
		<Button
			aria-label="Scroll to bottom"
			className={cn(
				buttonVariants({ size: "icon-sm", variant: "secondary" }),
				"rounded-full shadow-lg disabled:hidden",
			)}
			disabled={isAtBottom}
			onClick={handleClick}
			type="button"
		>
			<ArrowDown className="size-4" />
		</Button>
	);
}

const TASK_PROGRESS_STATUS_META: Record<
	DesktopTaskProgressStatus,
	{
		Icon: typeof CheckCircle2;
		iconClassName: string;
		textClassName: string;
	}
> = {
	active: {
		Icon: CircleDot,
		iconClassName: "text-[color:var(--accent)]",
		textClassName: "text-[color:var(--text-primary)]",
	},
	completed: {
		Icon: CheckCircle2,
		iconClassName: "text-[color:var(--success)]",
		textClassName: "text-[color:var(--text-secondary)]",
	},
	failed: {
		Icon: CircleAlert,
		iconClassName: "text-destructive",
		textClassName: "text-destructive",
	},
	pending: {
		Icon: Circle,
		iconClassName: "text-muted-foreground",
		textClassName: "text-muted-foreground",
	},
};

function getTaskProgressSummary(progress: DesktopTaskProgress): string {
	const completedCount = progress.items.filter((item) => item.status === "completed").length;
	const failedCount = progress.items.filter((item) => item.status === "failed").length;
	if (failedCount > 0) {
		return `${completedCount}/${progress.items.length} complete, ${failedCount} failed`;
	}
	return `${completedCount}/${progress.items.length} complete`;
}

type BadgeVariant = NonNullable<ComponentPropsWithoutRef<typeof Badge>["variant"]>;

function getEnvironmentStatusVariant(status: DesktopEnvironmentResourceStatus): BadgeVariant {
	switch (status) {
		case "completed":
			return "success";
		case "detached":
		case "unknown":
			return "neutral";
		case "failed":
			return "error";
		case "stale":
			return "warning";
		case "running":
			return "success";
	}
}

function getEnvironmentStatusDot(status: DesktopEnvironmentResourceStatus): StatusDotStatus {
	switch (status) {
		case "completed":
			return "success";
		case "detached":
		case "unknown":
			return "idle";
		case "failed":
			return "error";
		case "stale":
			return "warning";
		case "running":
			return "success";
	}
}

function getEnvironmentStatusLabel(status: DesktopEnvironmentResourceStatus): string {
	switch (status) {
		case "completed":
			return "completed";
		case "detached":
			return "detached";
		case "failed":
			return "failed";
		case "running":
			return "running";
		case "stale":
			return "stale";
		case "unknown":
			return "unknown";
	}
}

function getEnvironmentKindLabel(kind: DesktopEnvironmentResourceKind): string {
	switch (kind) {
		case "subagent":
			return "Subagent";
		case "tmux_session":
			return "tmux session";
		case "tmux_window":
			return "tmux window";
	}
}

function getEnvironmentResourceSubtitle(resource: DesktopEnvironmentResource): string {
	const pathName = resource.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? resource.cwd;
	if (resource.kind === "subagent" && resource.metadata.limitReached === "true") {
		return `${getEnvironmentKindLabel(resource.kind)} · ${pathName} · budget reached`;
	}
	return `${getEnvironmentKindLabel(resource.kind)} · ${pathName}`;
}

function WorkspaceStatusPanel({
	onOpenEnvironmentResource,
	workspaceStatus,
}: {
	onOpenEnvironmentResource?: (resource: DesktopEnvironmentResource) => void;
	workspaceStatus: WorkspaceStatusState;
}) {
	const [isCollapsed, setIsCollapsed] = useState(false);
	const { environmentResources, errorMessage, progress } = workspaceStatus;
	if (!workspaceStatus.isAvailable) {
		return null;
	}

	const taskSummary = progress ? getTaskProgressSummary(progress) : undefined;

	return (
		<motion.aside
			animate={{ opacity: 1, x: 0, y: 0 }}
			aria-label="Environment"
			aria-live="polite"
			className="pointer-events-auto absolute top-4 right-4 z-20 w-[min(18rem,calc(100%_-_2rem))] overflow-hidden rounded-lg border border-border/75 bg-background/92 px-4 py-3 shadow-[0_18px_56px_-38px_rgba(15,23,42,0.7)] backdrop-blur md:right-6 md:w-[18rem]"
			data-slot="assistant-workspace-status-panel"
			exit={{ opacity: 0, x: 8, y: -2 }}
			initial={{ opacity: 0, x: 8, y: -2 }}
			transition={softRevealTransition}
		>
			<div className="grid grid-cols-[minmax(0,1fr)] items-start gap-2">
				<button
					aria-expanded={!isCollapsed}
					aria-label={isCollapsed ? "Expand environment status" : "Collapse environment status"}
					className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
					onClick={() => setIsCollapsed((current) => !current)}
					type="button"
				>
					<span className="min-w-0">
						<span className="block truncate text-[12px] font-medium text-muted-foreground">Environment</span>
						{progress?.title ? (
							<span className="mt-1 block truncate text-[13px] font-medium text-foreground">
								{progress.title}
							</span>
						) : null}
						<span className="mt-1 block truncate text-[12px] text-muted-foreground">
							{taskSummary ?? `${environmentResources.length} resources`}
						</span>
					</span>
					<ChevronDown
						className={cn("size-4 text-muted-foreground transition-transform", isCollapsed && "-rotate-90")}
					/>
				</button>
			</div>
			{isCollapsed ? null : (
				<div className="mt-3 grid gap-3">
					{progress ? (
						<ol className="grid gap-2" data-slot="assistant-workspace-task-items">
							{progress.items.map((item) => {
								const statusMeta = TASK_PROGRESS_STATUS_META[item.status];
								const Icon = statusMeta.Icon;
								return (
									<li
										className="grid min-h-7 grid-cols-[1rem_minmax(0,1fr)] items-start gap-2"
										data-status={item.status}
										data-slot="assistant-workspace-task-item"
										key={item.id}
									>
										<Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", statusMeta.iconClassName)} />
										<span
											className={cn("min-w-0 break-words text-[13px] leading-5", statusMeta.textClassName)}
										>
											{item.label}
										</span>
									</li>
								);
							})}
						</ol>
					) : null}
					{environmentResources.length > 0 || errorMessage ? (
						<div className="grid gap-2" data-slot="assistant-workspace-runtime-status">
							{environmentResources.map((resource) => (
								<EntityRow
									aria-label={`Open ${resource.title}`}
									className="min-h-8 px-1.5 py-1 text-[12px]"
									disabled={resource.provider !== "tmux" && resource.provider !== "subagent"}
									icon={<StatusDot status={getEnvironmentStatusDot(resource.status)} />}
									key={resource.id}
									onClick={() => onOpenEnvironmentResource?.(resource)}
									subtitle={getEnvironmentResourceSubtitle(resource)}
									title={resource.title}
									trailing={
										<Badge variant={getEnvironmentStatusVariant(resource.status)}>
											{getEnvironmentStatusLabel(resource.status)}
										</Badge>
									}
								/>
							))}
							{errorMessage ? (
								<p className="border-t border-border/60 pt-2 text-[12px] leading-5 text-destructive">
									Environment status unavailable.
								</p>
							) : null}
						</div>
					) : null}
				</div>
			)}
		</motion.aside>
	);
}

function usePinnedAssistantViewportAutoScroll({
	enabled,
	forcePinned,
	forcePinnedDependency,
	scrollDependency,
	viewportRef,
}: {
	enabled: boolean;
	forcePinned: boolean;
	forcePinnedDependency: unknown;
	scrollDependency: unknown;
	viewportRef: { current: HTMLDivElement | null };
}): void {
	const shouldAutoScrollRef = useRef(true);
	const animationFrameRef = useRef<number | undefined>(undefined);
	const lastForcePinnedDependencyRef = useRef<unknown>(undefined);
	const lastScrollDependencyRef = useRef<unknown>(undefined);
	const lastScrollTopRef = useRef<number | undefined>(undefined);
	const userPausedAutoScrollRef = useRef(false);

	const cancelScheduledScroll = useCallback(() => {
		if (animationFrameRef.current === undefined) {
			return;
		}
		window.cancelAnimationFrame(animationFrameRef.current);
		animationFrameRef.current = undefined;
	}, []);

	useLayoutEffect(() => {
		if (!enabled) {
			shouldAutoScrollRef.current = true;
			userPausedAutoScrollRef.current = false;
			lastScrollTopRef.current = undefined;
			lastForcePinnedDependencyRef.current = undefined;
			return;
		}

		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}
		const viewportElement = viewport;

		function pauseAutoScrollForUser(): void {
			userPausedAutoScrollRef.current = true;
			shouldAutoScrollRef.current = false;
			cancelScheduledScroll();
		}

		function handleScroll(): void {
			const currentScrollTop = viewportElement.scrollTop;
			const previousScrollTop = lastScrollTopRef.current;
			lastScrollTopRef.current = currentScrollTop;

			if (
				previousScrollTop !== undefined &&
				currentScrollTop < previousScrollTop - ASSISTANT_USER_SCROLL_DIRECTION_EPSILON_PX
			) {
				pauseAutoScrollForUser();
				return;
			}

			const isPinned = isAssistantViewportPinnedToBottom(viewportElement);
			if (userPausedAutoScrollRef.current) {
				const didUserMoveTowardBottom =
					previousScrollTop !== undefined &&
					currentScrollTop > previousScrollTop + ASSISTANT_USER_SCROLL_DIRECTION_EPSILON_PX;
				if (didUserMoveTowardBottom && isPinned) {
					userPausedAutoScrollRef.current = false;
					shouldAutoScrollRef.current = true;
				} else {
					shouldAutoScrollRef.current = false;
				}
				return;
			}

			shouldAutoScrollRef.current = isPinned;
		}

		function handleWheel(event: WheelEvent): void {
			if (event.deltaY >= 0) {
				return;
			}
			pauseAutoScrollForUser();
		}

		handleScroll();
		viewportElement.addEventListener("scroll", handleScroll, { passive: true });
		viewportElement.addEventListener("wheel", handleWheel, { passive: true });
		return () => {
			viewportElement.removeEventListener("scroll", handleScroll);
			viewportElement.removeEventListener("wheel", handleWheel);
		};
	}, [cancelScheduledScroll, enabled, viewportRef]);

	useLayoutEffect(() => {
		if (!enabled) {
			cancelScheduledScroll();
			lastScrollDependencyRef.current = undefined;
			return;
		}

		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}

		const didScrollDependencyChange = lastScrollDependencyRef.current !== scrollDependency;
		lastScrollDependencyRef.current = scrollDependency;

		let didForcePin = false;
		if (forcePinned && lastForcePinnedDependencyRef.current !== forcePinnedDependency) {
			userPausedAutoScrollRef.current = false;
			shouldAutoScrollRef.current = true;
			lastForcePinnedDependencyRef.current = forcePinnedDependency;
			didForcePin = true;
		}

		if (!didScrollDependencyChange && !didForcePin) {
			return;
		}

		if (!shouldAutoScrollRef.current) {
			cancelScheduledScroll();
			return;
		}

		cancelScheduledScroll();
		animationFrameRef.current = window.requestAnimationFrame(() => {
			animationFrameRef.current = undefined;
			scrollAssistantViewportToBottom(viewport, "auto");
		});
	}, [cancelScheduledScroll, enabled, forcePinned, forcePinnedDependency, scrollDependency, viewportRef]);

	useEffect(() => {
		return () => cancelScheduledScroll();
	}, [cancelScheduledScroll]);
}

function getStreamingMessageShape(message: AgentMessage | undefined): string | undefined {
	if (!message) {
		return undefined;
	}
	if (message.role !== "assistant") {
		return message.role;
	}

	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) {
		return "assistant:malformed";
	}

	return `assistant:${content
		.map((part) => {
			if (!part || typeof part !== "object" || Array.isArray(part)) {
				return "unknown";
			}
			const record = part as Record<string, unknown>;
			if (record.type === "toolCall") {
				return `toolCall:${String(record.id)}:${String(record.name)}`;
			}
			return String(record.type ?? "unknown");
		})
		.join("|")}`;
}

function useThrottledStreamingMessage(
	streamingMessage: AgentMessage | undefined,
	isStreaming: boolean,
): AgentMessage | undefined {
	const [visibleStreamingMessage, setVisibleStreamingMessage] = useState(streamingMessage);
	const latestStreamingMessageRef = useRef(streamingMessage);
	const timeoutRef = useRef<number | undefined>(undefined);
	const visibleShapeRef = useRef(getStreamingMessageShape(streamingMessage));
	const streamingMessageShape = getStreamingMessageShape(streamingMessage);

	const clearStreamingThrottle = useCallback(() => {
		if (timeoutRef.current === undefined) {
			return;
		}
		window.clearTimeout(timeoutRef.current);
		timeoutRef.current = undefined;
	}, []);

	useEffect(() => {
		return () => clearStreamingThrottle();
	}, [clearStreamingThrottle]);

	useEffect(() => {
		latestStreamingMessageRef.current = streamingMessage;

		if (!isStreaming || !streamingMessage) {
			clearStreamingThrottle();
			visibleShapeRef.current = streamingMessageShape;
			setVisibleStreamingMessage(streamingMessage);
			return;
		}

		if (visibleShapeRef.current !== streamingMessageShape) {
			clearStreamingThrottle();
			visibleShapeRef.current = streamingMessageShape;
			setVisibleStreamingMessage(streamingMessage);
			return;
		}

		if (visibleStreamingMessage === streamingMessage || timeoutRef.current !== undefined) {
			return;
		}

		timeoutRef.current = window.setTimeout(() => {
			timeoutRef.current = undefined;
			setVisibleStreamingMessage(latestStreamingMessageRef.current);
		}, STREAMING_RENDER_THROTTLE_MS);
	}, [clearStreamingThrottle, isStreaming, streamingMessage, streamingMessageShape, visibleStreamingMessage]);

	if (!isStreaming || !streamingMessage) {
		return undefined;
	}

	return visibleStreamingMessage ?? streamingMessage;
}

function resolveSlashCommandSuggestions(
	text: string,
	commands: DesktopSlashCommandSummary[],
): DesktopSlashCommandSummary[] {
	if (!text.startsWith("/") || text.includes("\n")) {
		return [];
	}
	const slashBody = text.slice(1);
	if (/\s/.test(slashBody)) {
		return [];
	}
	const query = slashBody.toLowerCase();
	return commands
		.filter((command) => !query || command.name.toLowerCase().includes(query))
		.sort((left, right) => left.name.localeCompare(right.name));
}

function emptyCapabilityCatalog(): DesktopCapabilityCatalog {
	return {
		skills: [],
		prompts: [],
		slashCommands: [],
		mcpServers: [],
		diagnostics: [],
	};
}

function createCapabilityInvocationFromSlashCommand(
	command: DesktopSlashCommandSummary,
): DesktopPromptCapabilityInvocation | undefined {
	if (command.source === "skill" && command.name.startsWith("skill:")) {
		return {
			type: "skill",
			name: command.name.slice("skill:".length),
			...(command.description ? { description: command.description } : {}),
			...(command.sourcePath ? { sourcePath: command.sourcePath } : {}),
		};
	}
	if (command.source === "prompt") {
		return {
			type: "prompt_template",
			name: command.name,
			...(command.description ? { description: command.description } : {}),
			...(command.sourcePath ? { sourcePath: command.sourcePath } : {}),
		};
	}
	return undefined;
}

function upsertCapabilityInvocation(
	current: DesktopPromptCapabilityInvocation[],
	invocation: DesktopPromptCapabilityInvocation,
): DesktopPromptCapabilityInvocation[] {
	if (invocation.type === "prompt_template") {
		return [invocation, ...current.filter((item) => item.type !== "prompt_template")];
	}
	if (current.some((item) => item.type === "skill" && item.name === invocation.name)) {
		return current;
	}
	return [...current, invocation];
}

function removeCapabilityInvocation(
	current: DesktopPromptCapabilityInvocation[],
	target: DesktopPromptCapabilityInvocation,
): DesktopPromptCapabilityInvocation[] {
	return current.filter((item) => item.type !== target.type || item.name !== target.name);
}

function getCapabilityInvocationLabel(invocation: DesktopPromptCapabilityInvocation): string {
	return invocation.type === "skill" ? invocation.name : invocation.name;
}

function getMessageCapabilityInvocations(customMetadata: unknown): DesktopPromptCapabilityInvocation[] {
	if (!customMetadata || typeof customMetadata !== "object") {
		return [];
	}
	const value = (customMetadata as Record<string, unknown>)[DESKTOP_CAPABILITY_INVOCATIONS_METADATA_KEY];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is DesktopPromptCapabilityInvocation => {
		if (!item || typeof item !== "object") {
			return false;
		}
		const record = item as Record<string, unknown>;
		return (
			(record.type === "skill" || record.type === "prompt_template") &&
			typeof record.name === "string" &&
			record.name.length > 0
		);
	});
}

function CapabilityInvocationChip({
	invocation,
	onRemove,
}: {
	invocation: DesktopPromptCapabilityInvocation;
	onRemove?: (invocation: DesktopPromptCapabilityInvocation) => void;
}) {
	const isSkill = invocation.type === "skill";
	const Icon = isSkill ? Box : FileText;
	return (
		<motion.span
			animate={{ opacity: 1, scale: 1, y: 0 }}
			className={cn(
				"inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[13px] font-medium leading-none",
				isSkill
					? "border-[color:color-mix(in_oklch,var(--info)_22%,transparent)] bg-[color-mix(in_oklch,var(--info)_9%,var(--background))] text-[color:var(--info)]"
					: "border-[color:color-mix(in_oklch,var(--success)_22%,transparent)] bg-[color-mix(in_oklch,var(--success)_9%,var(--background))] text-[color:var(--success)]",
			)}
			exit={{ opacity: 0, scale: 0.96, y: -2 }}
			initial={{ opacity: 0, scale: 0.96, y: -2 }}
			layout
			transition={softRevealTransition}
		>
			<Icon aria-hidden className="size-3.5 shrink-0" />
			<span className="truncate">{getCapabilityInvocationLabel(invocation)}</span>
			{onRemove ? (
				<button
					aria-label={`Remove ${getCapabilityInvocationLabel(invocation)}`}
					className="-mr-1 rounded p-0.5 text-current/65 transition-colors hover:bg-background/60 hover:text-current"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onRemove(invocation)}
					type="button"
				>
					<X className="size-3" />
				</button>
			) : null}
		</motion.span>
	);
}

function SelectedCapabilityChips({
	invocations,
	onRemove,
}: {
	invocations: DesktopPromptCapabilityInvocation[];
	onRemove?: (invocation: DesktopPromptCapabilityInvocation) => void;
}) {
	if (invocations.length === 0) {
		return null;
	}
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-1.5">
			<AnimatePresence initial={false}>
				{invocations.map((invocation) => (
					<CapabilityInvocationChip
						invocation={invocation}
						key={`${invocation.type}:${invocation.name}`}
						onRemove={onRemove}
					/>
				))}
			</AnimatePresence>
		</div>
	);
}

function formatAttachmentSize(size: number): string {
	if (size < 1024) {
		return `${size} B`;
	}
	if (size < 1024 * 1024) {
		return `${Math.round(size / 1024)} KB`;
	}
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentExtension(attachment: DesktopPromptAttachmentDisplay | DesktopPreparedPromptAttachment): string {
	const match = /\.[^.\\/]+$/.exec(attachment.name.toLowerCase());
	return match?.[0] ?? "";
}

function getAttachmentDisplayMeta(attachment: DesktopPromptAttachmentDisplay | DesktopPreparedPromptAttachment): {
	Icon: typeof FileText;
	label: string;
} {
	const mimeType = attachment.mimeType.toLowerCase();
	const extension = getAttachmentExtension(attachment);
	if (attachment.kind === "image" || mimeType.startsWith("image/")) {
		return { Icon: ImageIcon, label: "Image" };
	}
	if (
		mimeType.includes("spreadsheet") ||
		mimeType.includes("excel") ||
		extension === ".xlsx" ||
		extension === ".xls"
	) {
		return { Icon: FileSpreadsheet, label: "Spreadsheet" };
	}
	if (mimeType === "text/csv" || extension === ".csv") {
		return { Icon: FileSpreadsheet, label: "CSV" };
	}
	if (mimeType.includes("wordprocessingml") || extension === ".docx" || extension === ".doc") {
		return { Icon: FileText, label: "Word document" };
	}
	if (mimeType === "text/markdown" || extension === ".md" || extension === ".markdown") {
		return { Icon: FileCode2, label: "Markdown" };
	}
	if (mimeType.includes("json") || extension === ".json") {
		return { Icon: FileJson, label: "JSON" };
	}
	if (mimeType === "application/pdf" || extension === ".pdf") {
		return { Icon: FileType, label: "PDF" };
	}
	if (mimeType.startsWith("text/")) {
		return { Icon: FileText, label: "Text" };
	}
	return { Icon: FileText, label: "File" };
}

function formatAttachmentType(attachment: DesktopPromptAttachmentDisplay | DesktopPreparedPromptAttachment): string {
	return getAttachmentDisplayMeta(attachment).label;
}

function formatAttachmentSecondaryText(
	attachment: DesktopPromptAttachmentDisplay | DesktopPreparedPromptAttachment,
): string {
	const attachmentType = formatAttachmentType(attachment);
	return attachment.size > 0 ? `${attachmentType} / ${formatAttachmentSize(attachment.size)}` : attachmentType;
}

function PromptAttachmentChips({
	attachments,
	compact = false,
	onRemove,
}: {
	attachments: (DesktopPromptAttachmentDisplay | DesktopPreparedPromptAttachment)[];
	compact?: boolean;
	onRemove?: (attachment: DesktopPromptAttachmentDisplay | DesktopPreparedPromptAttachment) => void;
}) {
	if (attachments.length === 0) {
		return null;
	}
	return (
		<Attachments
			className={cn("min-w-0", compact && "w-full flex-col items-stretch gap-1.5")}
			variant={compact ? "list" : "inline"}
		>
			{attachments.map((attachment) => {
				const filePart = toPromptAttachmentFilePart(attachment);
				const { Icon } = getAttachmentDisplayMeta(attachment);
				return (
					<Attachment
						aria-label={attachment.name}
						className={cn(
							"border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] shadow-[var(--shadow-minimal)]",
							compact
								? "min-h-9 w-fit max-w-full gap-2 rounded-md px-2.5 py-1.5 text-[12px] leading-none"
								: "max-w-full text-[13px] leading-none",
						)}
						data={filePart}
						key={attachment.id}
						onRemove={onRemove ? () => onRemove(attachment) : undefined}
						title={`${attachment.name} ${formatAttachmentSize(attachment.size)}`}
					>
						<AttachmentPreview
							className={compact ? "size-6 rounded-[6px] bg-[color:var(--surface-2)]" : undefined}
							fallbackIcon={<Icon className={cn("text-muted-foreground", compact ? "size-3.5" : "size-3.5")} />}
						/>
						{compact ? (
							<div className="min-w-0">
								<span className="block max-w-[260px] truncate font-medium text-[color:var(--text-primary)]">
									{attachment.name}
								</span>
								<span className="block truncate text-[11px] text-muted-foreground">
									{formatAttachmentSecondaryText(attachment)}
								</span>
							</div>
						) : (
							<>
								<AttachmentInfo />
								<span className="shrink-0 text-[11px] text-muted-foreground">
									{formatAttachmentSize(attachment.size)}
								</span>
								<AttachmentRemove label={`Remove ${attachment.name}`} />
							</>
						)}
					</Attachment>
				);
			})}
		</Attachments>
	);
}

type SlashCommandSectionKey = "commands" | "skills" | "prompts";

interface SlashCommandSection {
	key: SlashCommandSectionKey;
	title: string;
	commands: DesktopSlashCommandSummary[];
}

interface AtReferenceToken {
	start: number;
	end: number;
	query: string;
}

function groupSlashCommandSuggestions(commands: DesktopSlashCommandSummary[]): SlashCommandSection[] {
	const sections: SlashCommandSection[] = [
		{ key: "commands", title: "Commands", commands: [] },
		{ key: "skills", title: "Skills", commands: [] },
		{ key: "prompts", title: "Prompt templates", commands: [] },
	];
	for (const command of commands) {
		if (command.source === "skill") {
			sections[1]?.commands.push(command);
			continue;
		}
		if (command.source === "prompt") {
			sections[2]?.commands.push(command);
			continue;
		}
		sections[0]?.commands.push(command);
	}
	return sections.filter((section) => section.commands.length > 0);
}

function getAtReferenceTokenEnd(text: string, start: number): number {
	let end = start;
	while (end < text.length && !/\s/.test(text[end] ?? "")) {
		end += 1;
	}
	return end;
}

function isAtTokenBoundary(text: string, atIndex: number): boolean {
	if (atIndex === 0) {
		return true;
	}
	const previous = text[atIndex - 1];
	return previous === undefined || /[\s([{'"`]/.test(previous);
}

function resolveAtReferenceToken(text: string, cursor: number | undefined): AtReferenceToken | undefined {
	const cursorIndex = Math.min(Math.max(cursor ?? text.length, 0), text.length);
	const beforeCursor = text.slice(0, cursorIndex);
	const atIndex = beforeCursor.lastIndexOf("@");
	if (atIndex < 0 || !isAtTokenBoundary(text, atIndex)) {
		return undefined;
	}
	const query = text.slice(atIndex + 1, cursorIndex);
	if (/\s/.test(query)) {
		return undefined;
	}
	return {
		start: atIndex,
		end: getAtReferenceTokenEnd(text, atIndex),
		query,
	};
}

function filterWorkspaceFileSuggestions(
	files: DesktopWorkspaceFileEntry[],
	query: string,
): DesktopWorkspaceFileEntry[] {
	const normalizedQuery = query.replace(/^"/, "").toLowerCase();
	if (!normalizedQuery) {
		return files.slice(0, 12);
	}
	return files
		.filter(
			(file) =>
				file.name.toLowerCase().includes(normalizedQuery) || file.path.toLowerCase().includes(normalizedQuery),
		)
		.slice(0, 12);
}

function formatWorkspaceFileReference(path: string): string {
	if (!/\s/.test(path)) {
		return `@${path}`;
	}
	return `@"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function getWorkspaceFileIcon(file: DesktopWorkspaceFileEntry): ReactNode {
	switch (file.type) {
		case "code":
			return <FileCode2 className="size-3.5" />;
		case "docs":
			return <FileText className="size-3.5" />;
		case "images":
			return <ImageIcon className="size-3.5" />;
		case "data":
			return file.name.toLowerCase().endsWith(".json") || file.name.toLowerCase().endsWith(".jsonl") ? (
				<FileJson className="size-3.5" />
			) : (
				<FileSpreadsheet className="size-3.5" />
			);
		default:
			return <FileType className="size-3.5" />;
	}
}

function getSlashCommandIcon(command: DesktopSlashCommandSummary): ReactNode {
	if (command.source === "skill") {
		return <Sparkles className="size-3.5" />;
	}
	if (command.source === "prompt") {
		return <FileText className="size-3.5" />;
	}
	return <SquareSlash className="size-3.5" />;
}

function ComposerSuggestionPanel({ children, label }: { children: ReactNode; label: string }) {
	return (
		<motion.div
			animate={{ opacity: 1, y: 0 }}
			aria-label={label}
			className="absolute inset-x-0 bottom-full z-[var(--z-popover)] mb-2 overflow-hidden rounded-[var(--radius-xl)] border border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] shadow-[var(--uix-flat-shadow-floating)]"
			data-slot="composer-suggestion-panel"
			initial={{ opacity: 0, y: 4 }}
			role="listbox"
			transition={softRevealTransition}
		>
			<div className="composer-suggestion-scrollbar max-h-[min(360px,48vh)] overflow-y-auto py-2">{children}</div>
		</motion.div>
	);
}

function ComposerSuggestionSection({ children, title }: { children: ReactNode; title: string }) {
	return (
		<section className="px-2 py-1" data-slot="composer-suggestion-section">
			<div className="px-2 pb-1 text-[12px] font-medium leading-5 text-[color:var(--text-tertiary)]">{title}</div>
			<div className="grid gap-0.5">{children}</div>
		</section>
	);
}

function ComposerSuggestionRow({
	description,
	icon,
	onSelect,
	selected,
	title,
	trailing,
}: {
	description?: string;
	icon: ReactNode;
	onSelect: () => void;
	selected: boolean;
	title: string;
	trailing?: ReactNode;
}) {
	const rowRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		if (selected) {
			rowRef.current?.scrollIntoView?.({ block: "nearest" });
		}
	}, [selected]);

	return (
		<button
			aria-selected={selected}
			className={cn(
				"grid min-h-10 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
				selected
					? "bg-[color:var(--surface-2)] text-[color:var(--text-primary)]"
					: "text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)]",
			)}
			data-selected={selected ? "true" : undefined}
			onMouseDown={(event) => {
				event.preventDefault();
				onSelect();
			}}
			ref={rowRef}
			role="option"
			type="button"
		>
			<span className="grid size-5 shrink-0 place-items-center text-[color:var(--text-tertiary)]">{icon}</span>
			<span className="min-w-0">
				<span className="block truncate text-[13px] font-medium leading-5">{title}</span>
				{description ? (
					<span className="block truncate text-[12px] leading-5 text-[color:var(--text-tertiary)]">
						{description}
					</span>
				) : null}
			</span>
			{trailing ? <span className="shrink-0 text-[12px] text-[color:var(--text-tertiary)]">{trailing}</span> : null}
		</button>
	);
}

function SafeMarkdownAnchor({ children, className, href, ...props }: ComponentPropsWithoutRef<"a">) {
	const decodedWorkspacePreviewHref = decodeWorkspacePreviewLinkHref(href);
	const effectiveHref = decodedWorkspacePreviewHref ?? href?.replace(/^(https?:\/\/[^/?#]+)\/$/i, "$1");
	const openWorkspacePreviewFile = useContext(WorkspacePreviewLinkContext);
	const opensWorkspacePreview = Boolean(
		effectiveHref && openWorkspacePreviewFile && isWorkspacePreviewHref(effectiveHref),
	);
	const desktopBridge = (window as Partial<Window>).desktopAgent as Partial<DesktopAgentBridge> | undefined;
	const opensExternalUrl = Boolean(
		effectiveHref &&
			!opensWorkspacePreview &&
			isExternalBrowserHref(effectiveHref) &&
			typeof desktopBridge?.openExternalUrl === "function",
	);

	function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
		props.onClick?.(event);
		if (event.defaultPrevented || !effectiveHref) {
			return;
		}
		if (opensWorkspacePreview) {
			event.preventDefault();
			openWorkspacePreviewFile?.(effectiveHref);
			return;
		}
		if (opensExternalUrl) {
			event.preventDefault();
			void desktopBridge?.openExternalUrl?.(effectiveHref).catch(() => undefined);
		}
	}

	return (
		<a
			className={cn("text-[color:var(--accent)] underline decoration-current/35 underline-offset-4", className)}
			href={effectiveHref}
			{...props}
			onClick={handleClick}
			rel={opensWorkspacePreview ? undefined : "noreferrer"}
			target={opensWorkspacePreview ? undefined : "_blank"}
		>
			{children}
		</a>
	);
}

function workspacePreviewLinkRemarkPlugin() {
	return (tree: MarkdownAstNode): void => {
		rewriteWorkspacePreviewLinkUrls(tree);
	};
}

function rewriteWorkspacePreviewLinkUrls(node: MarkdownAstNode): void {
	if (node.type === "link" && typeof node.url === "string") {
		const workspacePreviewHref = encodeWorkspacePreviewLinkHref(node.url);
		if (workspacePreviewHref) {
			node.url = workspacePreviewHref;
		}
	}

	for (const child of node.children ?? []) {
		rewriteWorkspacePreviewLinkUrls(child);
	}
}

function encodeWorkspacePreviewLinkHref(href: string): string | undefined {
	const trimmedHref = href.trim();
	if (!shouldRewriteWorkspacePreviewLinkHref(trimmedHref)) {
		return undefined;
	}
	return `${WORKSPACE_PREVIEW_LINK_PREFIX}${encodeURIComponent(trimmedHref)}`;
}

function decodeWorkspacePreviewLinkHref(href: string | undefined): string | undefined {
	if (!href?.startsWith(WORKSPACE_PREVIEW_LINK_PREFIX)) {
		return undefined;
	}

	try {
		return decodeURIComponent(href.slice(WORKSPACE_PREVIEW_LINK_PREFIX.length));
	} catch {
		return undefined;
	}
}

function shouldRewriteWorkspacePreviewLinkHref(href: string): boolean {
	if (!href || href.startsWith("#") || href.startsWith("?") || href.startsWith("//")) {
		return false;
	}
	if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
		return false;
	}

	const schemeMatch = /^[a-z][a-z0-9+.-]*:/i.exec(href);
	if (!schemeMatch) {
		return href.startsWith("./") || href.startsWith("../") || href.includes("/") || href.includes("\\");
	}
	return schemeMatch[0].toLowerCase() === "file:";
}

function isExternalBrowserHref(href: string): boolean {
	const trimmedHref = href.trim();
	return /^https?:\/\//i.test(trimmedHref) || /^mailto:/i.test(trimmedHref);
}

function isWorkspacePreviewHref(href: string): boolean {
	const trimmedHref = href.trim();
	if (!trimmedHref || trimmedHref.startsWith("#") || trimmedHref.startsWith("?")) {
		return false;
	}

	const schemeMatch = /^[a-z][a-z0-9+.-]*:/i.exec(trimmedHref);
	if (!schemeMatch) {
		return true;
	}
	return schemeMatch[0].toLowerCase() === "file:";
}

type AssistantMarkdownSegment =
	| {
			key: string;
			text: string;
			type: "markdown";
	  }
	| {
			items: ThreadImagePreviewGridItem[];
			key: string;
			type: "images";
	  };

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;

function normalizeMarkdownImageAlt(alt: string | undefined, src: string): string {
	const trimmedAlt = alt?.trim();
	if (trimmedAlt) {
		return trimmedAlt;
	}
	return (
		src
			.split(/[\\/]+/)
			.filter(Boolean)
			.at(-1) ?? "Image"
	);
}

function createMarkdownImagePreviewItem(src: string | undefined, alt: string | undefined, indexKey: string) {
	const trimmedSrc = src?.trim();
	if (!trimmedSrc) {
		return undefined;
	}

	const label = normalizeMarkdownImageAlt(alt, trimmedSrc);
	if (/^data:image\//i.test(trimmedSrc) || /^blob:/i.test(trimmedSrc)) {
		return {
			alt: label,
			id: `markdown-image:${indexKey}:${trimmedSrc.slice(0, 96)}`,
			kind: "direct" as const,
			src: trimmedSrc,
			title: label,
		};
	}

	if (/^https?:\/\//i.test(trimmedSrc)) {
		return {
			alt: label,
			href: trimmedSrc,
			id: `markdown-image:${indexKey}:${trimmedSrc}`,
			kind: "external" as const,
			title: label,
		};
	}

	if (isWorkspacePreviewHref(trimmedSrc)) {
		return {
			alt: label,
			id: `markdown-image:${indexKey}:${trimmedSrc}`,
			kind: "workspace" as const,
			path: trimmedSrc,
			title: label,
		};
	}

	return {
		alt: label,
		href: trimmedSrc,
		id: `markdown-image:${indexKey}:${trimmedSrc}`,
		kind: "external" as const,
		title: label,
	};
}

function parseImageOnlyMarkdownBlock(block: string, blockIndex: number): ThreadImagePreviewGridItem[] | undefined {
	const trimmedBlock = block.trim();
	if (!trimmedBlock.includes("![")) {
		return undefined;
	}

	MARKDOWN_IMAGE_PATTERN.lastIndex = 0;
	const items: ThreadImagePreviewGridItem[] = [];
	let cursor = 0;
	for (const match of trimmedBlock.matchAll(MARKDOWN_IMAGE_PATTERN)) {
		const matchIndex = match.index ?? 0;
		if (trimmedBlock.slice(cursor, matchIndex).trim().length > 0) {
			return undefined;
		}

		const item = createMarkdownImagePreviewItem(match[2], match[1], `${blockIndex}:${items.length}`);
		if (!item) {
			return undefined;
		}
		items.push(item);
		cursor = matchIndex + match[0].length;
	}

	if (items.length === 0 || trimmedBlock.slice(cursor).trim().length > 0) {
		return undefined;
	}
	return items;
}

function splitAssistantMarkdownImageBlocks(text: string): AssistantMarkdownSegment[] {
	const blocks = text.split(/\r?\n\s*\r?\n/);
	const segments: AssistantMarkdownSegment[] = [];
	let pendingMarkdown: string[] = [];
	let pendingImages: ThreadImagePreviewGridItem[] = [];

	function flushMarkdown(): void {
		if (pendingMarkdown.length === 0) {
			return;
		}
		const segmentText = pendingMarkdown.join("\n\n");
		segments.push({
			key: `markdown:${segments.length}:${segmentText.slice(0, 80)}`,
			text: segmentText,
			type: "markdown",
		});
		pendingMarkdown = [];
	}

	function flushImages(): void {
		if (pendingImages.length === 0) {
			return;
		}
		segments.push({
			items: pendingImages,
			key: `images:${segments.length}:${pendingImages.map((item) => item.id).join("|")}`,
			type: "images",
		});
		pendingImages = [];
	}

	for (const [blockIndex, block] of blocks.entries()) {
		const imageItems = parseImageOnlyMarkdownBlock(block, blockIndex);
		if (imageItems) {
			flushMarkdown();
			pendingImages.push(...imageItems);
			continue;
		}

		flushImages();
		pendingMarkdown.push(block);
	}

	flushMarkdown();
	flushImages();
	return segments;
}

const ASSISTANT_MARKDOWN_COMPONENTS = {
	a: SafeMarkdownAnchor as NonNullable<MessageResponseProps["components"]>["a"],
} satisfies NonNullable<MessageResponseProps["components"]>;
const ASSISTANT_MARKDOWN_REMARK_PLUGINS = [
	...Object.values(defaultRemarkPlugins),
	workspacePreviewLinkRemarkPlugin,
] satisfies NonNullable<MessageResponseProps["remarkPlugins"]>;

function AssistantMarkdownResponse({
	className,
	isStreaming = false,
	onPreviewImage,
	resolveWorkspaceImage,
	text,
}: {
	className?: string;
	isStreaming?: boolean;
	onPreviewImage?: (image: ThreadImagePreview) => void;
	resolveWorkspaceImage?: WorkspaceImagePreviewResolver;
	text: string;
}) {
	const segments = useMemo(() => splitAssistantMarkdownImageBlocks(text), [text]);
	const hasImageSegments = segments.some((segment) => segment.type === "images");
	const components = useMemo(() => {
		function SafeMarkdownImage({ alt, src }: ComponentPropsWithoutRef<"img">) {
			const item = createMarkdownImagePreviewItem(src, alt, "inline");
			if (!item) {
				return <span className="italic text-muted-foreground">Image not available</span>;
			}
			return (
				<ThreadImagePreviewGrid
					className="my-2"
					items={[item]}
					onPreviewImage={onPreviewImage}
					resolveWorkspaceImage={resolveWorkspaceImage}
				/>
			);
		}

		return {
			...ASSISTANT_MARKDOWN_COMPONENTS,
			img: SafeMarkdownImage as NonNullable<MessageResponseProps["components"]>["img"],
		} satisfies NonNullable<MessageResponseProps["components"]>;
	}, [onPreviewImage, resolveWorkspaceImage]);

	return (
		<div
			className="select-text"
			data-selectable-text="true"
			data-slot="assistant-markdown-content"
			data-streaming={isStreaming ? "true" : undefined}
		>
			{hasImageSegments ? (
				<div className={cn(ASSISTANT_MARKDOWN_CLASSNAME, className)}>
					{segments.map((segment) =>
						segment.type === "images" ? (
							<ThreadImagePreviewGrid
								items={segment.items}
								key={segment.key}
								onPreviewImage={onPreviewImage}
								resolveWorkspaceImage={resolveWorkspaceImage}
							/>
						) : (
							<MessageResponse
								className="contents"
								components={components}
								isAnimating={isStreaming}
								key={segment.key}
								mode={isStreaming ? "streaming" : "static"}
								remarkPlugins={ASSISTANT_MARKDOWN_REMARK_PLUGINS}
							>
								{segment.text}
							</MessageResponse>
						),
					)}
				</div>
			) : (
				<MessageResponse
					className={cn(ASSISTANT_MARKDOWN_CLASSNAME, className)}
					components={components}
					isAnimating={isStreaming}
					mode={isStreaming ? "streaming" : "static"}
					remarkPlugins={ASSISTANT_MARKDOWN_REMARK_PLUGINS}
				>
					{text}
				</MessageResponse>
			)}
		</div>
	);
}

function AssistantMarkdownPart({
	onPreviewImage,
	resolveWorkspaceImage,
	status,
	text,
}: {
	onPreviewImage?: (image: ThreadImagePreview) => void;
	resolveWorkspaceImage?: WorkspaceImagePreviewResolver;
	status?: DesktopThreadMessageStatus;
	text: string;
}) {
	return (
		<AssistantMarkdownResponse
			isStreaming={status?.type === "running"}
			onPreviewImage={onPreviewImage}
			resolveWorkspaceImage={resolveWorkspaceImage}
			text={text}
		/>
	);
}

function UserTextPart({ text }: { text: string }) {
	if (text.length === 0) {
		return null;
	}
	return (
		<AssistantMarkdownResponse
			className={cn(
				"gap-2 text-sm leading-6 text-[color:var(--text-primary)]",
				"[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2",
				"[&_code]:bg-[color:var(--surface-3)]",
			)}
			text={text}
		/>
	);
}

function ThreadImagePreviewDialog({ image, onClose }: { image?: ThreadImagePreview; onClose: () => void }) {
	useEffect(() => {
		if (!image) {
			return undefined;
		}

		function handleKeyDown(event: globalThis.KeyboardEvent): void {
			if (event.key === "Escape") {
				onClose();
			}
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [image, onClose]);

	if (!image) {
		return null;
	}

	return (
		<div
			aria-label="Image preview"
			aria-modal="true"
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
			data-slot="thread-image-preview"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) {
					onClose();
				}
			}}
			role="dialog"
		>
			<Button
				aria-label="Close image preview"
				className="absolute right-4 top-4 border-white/15 bg-black/30 text-white shadow-none hover:bg-white/15"
				onClick={onClose}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				<X className="size-4" />
			</Button>
			<img
				alt={image.alt}
				className="max-h-[calc(100vh-6rem)] max-w-[calc(100vw-6rem)] rounded-lg object-contain shadow-2xl"
				src={image.src}
				title={image.title}
			/>
		</div>
	);
}

function ThreadImageAttachments({
	align,
	images,
	messageId,
	onPreviewImage,
	slot,
}: {
	align: "start" | "end";
	images: DesktopImagePart[];
	messageId: string;
	onPreviewImage?: (image: ThreadImagePreview) => void;
	slot: string;
}) {
	if (images.length === 0) {
		return null;
	}

	return (
		<div className={cn("grid max-w-full gap-2", align === "start" ? "justify-items-start" : "justify-items-end")}>
			{images.map((image, index) => {
				const attachment = toThreadImageAttachmentFilePart(image, `${messageId}-image-${index}`);
				return (
					<ChainOfThoughtImage
						className="max-w-[min(100%,28rem)]"
						data-slot={slot}
						key={attachment.id}
						title={attachment.filename}
					>
						<button
							aria-label={`Open image preview for ${attachment.filename ?? "Attached visual"}`}
							className="block max-w-full cursor-zoom-in rounded-[calc(var(--radius-md)-2px)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
							onClick={() =>
								onPreviewImage?.({
									alt: attachment.filename ?? "Attached visual",
									src: attachment.url,
									title: attachment.filename,
								})
							}
							type="button"
						>
							<img
								alt={attachment.filename ?? "Attached visual"}
								className="max-h-[22rem] max-w-full rounded-[calc(var(--radius-md)-2px)] object-contain"
								src={attachment.url}
							/>
						</button>
					</ChainOfThoughtImage>
				);
			})}
		</div>
	);
}

function UserThreadImages({
	images,
	messageId,
	onPreviewImage,
	promptAttachments,
}: {
	images: DesktopImagePart[];
	messageId: string;
	onPreviewImage?: (image: ThreadImagePreview) => void;
	promptAttachments: readonly DesktopPromptAttachmentDisplay[];
}) {
	if (images.length === 0) {
		return null;
	}

	const promptImageAttachments = promptAttachments.filter((attachment) => attachment.kind === "image");

	return (
		<div className="grid max-w-full justify-items-end gap-2" data-slot="user-thread-images">
			{images.map((image, index) => {
				const fallbackName = promptImageAttachments[index]?.name;
				const filename = image.filename ?? fallbackName ?? "Attached visual";
				return (
					<div
						className="max-w-[min(100%,34rem)] overflow-hidden rounded-lg"
						data-slot="user-thread-image"
						key={`${messageId}-${filename}-${image.image.slice(0, 160)}`}
						title={filename}
					>
						<button
							aria-label={`Open image preview for ${filename}`}
							className="block max-w-full cursor-zoom-in rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
							onClick={() => onPreviewImage?.({ alt: filename, src: image.image, title: filename })}
							type="button"
						>
							<img
								alt={filename}
								className="max-h-[min(60vh,28rem)] max-w-full rounded-lg object-contain"
								src={image.image}
							/>
						</button>
					</div>
				);
			})}
		</div>
	);
}

function EmptyMessagePart({ status }: { status?: DesktopThreadMessageStatus }) {
	if (status?.type !== "running") {
		return null;
	}

	return (
		<div className="text-sm text-muted-foreground" data-slot="assistant-empty-working">
			<span>Working</span>
		</div>
	);
}

function UserThreadAttachments({ attachments }: { attachments: readonly DesktopPromptAttachmentDisplay[] }) {
	if (attachments.length === 0) {
		return null;
	}

	return (
		<Attachments className="max-w-full justify-end" data-slot="user-thread-attachments" variant="inline">
			{attachments.map((attachment) => {
				const filePart = toPromptAttachmentFilePart(attachment);
				const { Icon } = getAttachmentDisplayMeta(attachment);
				return (
					<Attachment
						aria-label={attachment.name}
						className="h-auto min-h-9 max-w-[min(100%,24rem)] gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] px-3 py-2 text-left leading-none shadow-[var(--shadow-minimal)] hover:bg-[color:var(--surface-1)]"
						data={filePart}
						data-slot="user-thread-attachment-card"
						key={attachment.id}
						title={`${attachment.name} ${formatAttachmentSize(attachment.size)}`}
					>
						<AttachmentPreview
							className="size-7 rounded-md bg-[color:var(--surface-2)]"
							fallbackIcon={<Icon className="size-3.5 text-muted-foreground" />}
						/>
						<div className="min-w-0">
							<span className="block max-w-[18rem] truncate font-medium text-[13px] text-[color:var(--text-primary)]">
								{attachment.name}
							</span>
							<span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
								{formatAttachmentSecondaryText(attachment)}
							</span>
						</div>
					</Attachment>
				);
			})}
		</Attachments>
	);
}

function AssistantMessageRunStatusTask({ messageStatus }: { messageStatus?: DesktopThreadMessageStatus }) {
	return <ThreadRunStatusTask className="mt-3" status={messageStatus} />;
}

function AssistantFileReferences({
	messageCustomMetadata,
	messageStatus,
}: {
	messageCustomMetadata: unknown;
	messageStatus?: DesktopThreadMessageStatus;
}) {
	const openWorkspacePreviewFile = useContext(WorkspacePreviewLinkContext);
	const fileReferences = useMemo(() => getMessageFileReferences(messageCustomMetadata), [messageCustomMetadata]);
	if (messageStatus?.type === "running" || fileReferences.length === 0 || !openWorkspacePreviewFile) {
		return null;
	}

	const changedReferences = fileReferences.filter((reference) => reference.kind === "changed");
	const foundReferences = fileReferences.filter((reference) => reference.kind === "found");
	return (
		<div className="mt-3 grid gap-2 text-[13px]" data-slot="assistant-file-references">
			<FileReferenceGroup
				label="Changed"
				onOpenWorkspacePreviewFile={openWorkspacePreviewFile}
				references={changedReferences}
			/>
			<FileReferenceGroup
				label="Found"
				onOpenWorkspacePreviewFile={openWorkspacePreviewFile}
				references={foundReferences}
			/>
		</div>
	);
}

function FileReferenceGroup({
	label,
	onOpenWorkspacePreviewFile,
	references,
}: {
	label: string;
	onOpenWorkspacePreviewFile: (path: string) => void;
	references: readonly DesktopThreadFileReference[];
}) {
	if (references.length === 0) {
		return null;
	}
	return (
		<div className="grid gap-1.5" data-slot="assistant-file-reference-group">
			<div className="text-[12px] font-medium text-muted-foreground">{label}</div>
			<ul className="m-0 grid list-none gap-1 p-0">
				{references.map((reference) => (
					<li key={`${reference.kind}:${reference.path}`}>
						<button
							aria-label={`Open ${reference.displayPath} in workspace preview`}
							className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left font-mono text-[13px] text-[color:var(--accent)] underline decoration-current/35 underline-offset-4 hover:bg-muted"
							onClick={() => onOpenWorkspacePreviewFile(reference.path)}
							type="button"
						>
							<FileText className="size-3.5 shrink-0" />
							<span className="truncate">{reference.displayPath}</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

function getMessageFileReferences(value: unknown): DesktopThreadFileReference[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return [];
	}
	const record = value as Record<string, unknown>;
	const references = record[DESKTOP_FILE_REFERENCES_METADATA_KEY];
	if (!Array.isArray(references)) {
		return [];
	}
	return references.filter((reference): reference is DesktopThreadFileReference => {
		if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
			return false;
		}
		const item = reference as Record<string, unknown>;
		return (
			(item.kind === "changed" || item.kind === "found") &&
			typeof item.path === "string" &&
			item.path.length > 0 &&
			typeof item.displayPath === "string" &&
			item.displayPath.length > 0 &&
			typeof item.toolName === "string" &&
			item.toolName.length > 0
		);
	});
}

function getMessageProposedPlan(value: unknown): DesktopProposedPlanMetadata | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const plan = (value as Record<string, unknown>)[DESKTOP_PROPOSED_PLAN_METADATA_KEY];
	if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
		return undefined;
	}
	const text = (plan as Record<string, unknown>).text;
	return typeof text === "string" && text.trim().length > 0 ? { text } : undefined;
}

function findLatestCompletedProposedPlanMessageId(messages: readonly DesktopThreadMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (
			message?.role === "assistant" &&
			message.status?.type === "complete" &&
			getMessageProposedPlan(message.metadata?.custom)
		) {
			return message.id;
		}
	}
	return undefined;
}

function shouldCollapseProposedPlan(text: string): boolean {
	return text.length > PROPOSED_PLAN_COLLAPSED_LENGTH || text.split("\n").length > PROPOSED_PLAN_COLLAPSED_LINES;
}

function AssistantProposedPlanCard({
	messageCustomMetadata,
	messageStatus,
}: {
	messageCustomMetadata: unknown;
	messageStatus?: DesktopThreadMessageStatus;
}) {
	const proposedPlan = useMemo(() => getMessageProposedPlan(messageCustomMetadata), [messageCustomMetadata]);
	const [isExpanded, setIsExpanded] = useState(false);
	if (!proposedPlan || messageStatus?.type !== "complete") {
		return null;
	}
	const shouldCollapse = shouldCollapseProposedPlan(proposedPlan.text);
	const isCollapsed = shouldCollapse && !isExpanded;

	return (
		<Card
			className="mt-4 gap-0 overflow-hidden rounded-xl border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] py-0 shadow-[var(--shadow-middle)]"
			data-slot="assistant-proposed-plan-card"
		>
			<div className="flex items-center justify-between gap-3 px-5 pt-5">
				<div className="flex min-w-0 items-center gap-2">
					<FileText className="size-4 shrink-0 text-[color:var(--accent)]" />
					<span className="truncate text-[13px] font-semibold text-[color:var(--text-primary)]">计划</span>
				</div>
			</div>
			<div className="relative">
				<motion.div
					animate={{ height: isCollapsed ? PROPOSED_PLAN_COLLAPSED_HEIGHT_PX : "auto" }}
					className="overflow-hidden"
					data-motion="structural-drawer"
					data-motion-engine="motion"
					data-motion-mode="drawer"
					data-motion-origin="top"
					data-motion-owner="proposed-plan-card"
					data-motion-scope="structural"
					data-slot="assistant-proposed-plan-card-content-spacer"
					data-state={isCollapsed ? "closed" : "open"}
					data-structural-layout-driver="height"
					initial={false}
					transition={activityDrawerTransition}
				>
					<div className="px-5 py-5" data-slot="assistant-proposed-plan-card-content">
						<AssistantMarkdownResponse text={proposedPlan.text} />
					</div>
				</motion.div>
				{isCollapsed ? (
					<div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-[color:var(--surface-1)]" />
				) : null}
			</div>
			{shouldCollapse ? (
				<div className="flex flex-wrap items-center gap-2 px-5 pb-5">
					<Button
						aria-expanded={isExpanded}
						className="h-8 gap-1.5 rounded-full px-3 text-[13px]"
						onClick={() => setIsExpanded((current) => !current)}
						type="button"
						variant="secondary"
					>
						<ChevronDown className={cn("size-3.5 transition-transform", isExpanded ? "rotate-180" : "")} />
						<span>{isExpanded ? "收起计划" : "展开计划"}</span>
					</Button>
				</div>
			) : null}
		</Card>
	);
}

function AssistantProposedPlanActions({
	messageCustomMetadata,
	messageId,
	messageStatus,
}: {
	messageCustomMetadata: unknown;
	messageId: string;
	messageStatus?: DesktopThreadMessageStatus;
}) {
	const executionContext = useContext(ProposedPlanExecutionContext);
	const proposedPlan = useMemo(() => getMessageProposedPlan(messageCustomMetadata), [messageCustomMetadata]);
	const [isConsumedLocally, setIsConsumedLocally] = useState(false);
	const [isExecuting, setIsExecuting] = useState(false);
	const [isWaiting, setIsWaiting] = useState(false);

	useEffect(() => {
		if (!messageId) {
			return;
		}
		setIsConsumedLocally(false);
		setIsExecuting(false);
		setIsWaiting(false);
	}, [messageId]);

	if (
		!executionContext ||
		!proposedPlan ||
		messageStatus?.type !== "complete" ||
		messageId !== executionContext.latestPlanMessageId ||
		executionContext.isStreaming ||
		executionContext.disabled ||
		isConsumedLocally ||
		executionContext.consumedProposedPlanMessageIds.includes(messageId) ||
		!executionContext.onConsumeProposedPlan
	) {
		return null;
	}

	async function handleExecutePlan(): Promise<void> {
		if (!executionContext?.onConsumeProposedPlan || !executionContext.onExecutePlan) {
			return;
		}
		setIsExecuting(true);
		try {
			await executionContext.onConsumeProposedPlan(messageId);
			setIsConsumedLocally(true);
			await executionContext.onExecutePlan();
		} finally {
			setIsExecuting(false);
		}
	}

	async function handleWait(): Promise<void> {
		if (!executionContext?.onConsumeProposedPlan) {
			return;
		}
		setIsWaiting(true);
		try {
			await executionContext.onConsumeProposedPlan(messageId);
			setIsConsumedLocally(true);
		} finally {
			setIsWaiting(false);
		}
	}

	const isBusy = isExecuting || isWaiting;

	return (
		<div className="mt-3 flex flex-wrap items-center gap-2 px-1" data-slot="assistant-proposed-plan-actions">
			{executionContext.onExecutePlan ? (
				<Button
					className="h-8 gap-1.5 rounded-md px-3 text-[13px]"
					disabled={isBusy}
					onClick={() => void handleExecutePlan().catch(() => undefined)}
					type="button"
					variant="default"
				>
					{isExecuting ? <Spinner className="size-3.5" label="Executing plan" /> : <Check className="size-3.5" />}
					<span>Execute plan</span>
				</Button>
			) : null}
			<Button
				className="h-8 gap-1.5 rounded-md px-3 text-[13px]"
				disabled={isBusy}
				onClick={() => void handleWait().catch(() => undefined)}
				type="button"
				variant="secondary"
			>
				{isWaiting ? <Spinner className="size-3.5" label="Waiting on plan" /> : <Clock3 className="size-3.5" />}
				<span>等一会儿</span>
			</Button>
		</div>
	);
}

function AssistantMessage({
	message,
	onPreviewImage,
	resolveWorkspaceImage,
}: {
	message: DesktopThreadMessage;
	onPreviewImage?: (image: ThreadImagePreview) => void;
	resolveWorkspaceImage?: WorkspaceImagePreviewResolver;
}) {
	const messageId = message.id ?? `assistant-${message.createdAt?.getTime() ?? "message"}`;
	const messageStatus = message.status;
	const messageCustomMetadata = message.metadata?.custom;
	const isMessageRunning = messageStatus?.type === "running";
	const activityParts = getThreadActivityParts(message);
	const textParts = getThreadTextParts(message);
	const imageParts = getThreadImageParts(message);
	return (
		<AiMessage
			className={cn(
				"mx-auto grid w-full max-w-[880px] gap-3 px-5 py-4 md:px-7",
				!isMessageRunning && "assistant-message-contained",
			)}
			data-slot="assistant-message"
			from="assistant"
		>
			<div className="max-w-[min(100%,760px)]">
				<AiMessageContent className="w-full overflow-visible">
					{activityParts.length > 0 ? (
						<AgentRunActivity
							messageCustomMetadata={messageCustomMetadata}
							messageId={messageId}
							messageStatus={messageStatus}
							onPreviewImage={onPreviewImage}
							parts={activityParts}
						/>
					) : null}
					{textParts.length > 0 ? (
						textParts.map((part, partIndex) => (
							<AssistantMarkdownPart
								key={`${messageId}-text-${part.parentId ?? partIndex}`}
								onPreviewImage={onPreviewImage}
								resolveWorkspaceImage={resolveWorkspaceImage}
								status={messageStatus}
								text={part.text}
							/>
						))
					) : imageParts.length === 0 ? (
						<EmptyMessagePart status={messageStatus} />
					) : null}
					<ThreadImageAttachments
						align="start"
						images={imageParts}
						messageId={messageId}
						onPreviewImage={onPreviewImage}
						slot="assistant-attachment-card"
					/>
					<AssistantProposedPlanCard messageCustomMetadata={messageCustomMetadata} messageStatus={messageStatus} />
					<AssistantProposedPlanActions
						messageCustomMetadata={messageCustomMetadata}
						messageId={messageId}
						messageStatus={messageStatus}
					/>
					<AssistantFileReferences messageCustomMetadata={messageCustomMetadata} messageStatus={messageStatus} />
					<AssistantMessageRunStatusTask messageStatus={messageStatus} />
				</AiMessageContent>
			</div>
		</AiMessage>
	);
}

function UserMessage({
	message,
	onPreviewImage,
}: {
	message: DesktopThreadMessage;
	onPreviewImage?: (image: ThreadImagePreview) => void;
}) {
	const messageId = message.id ?? `user-${message.createdAt?.getTime() ?? "message"}`;
	const messageCustomMetadata = message.metadata?.custom;
	const capabilityInvocations = useMemo(
		() => getMessageCapabilityInvocations(messageCustomMetadata),
		[messageCustomMetadata],
	);
	const promptAttachments = useMemo(() => getUserPromptAttachments(messageCustomMetadata), [messageCustomMetadata]);
	const imageParts = getThreadImageParts(message);
	const textParts = getThreadTextParts(message);
	const threadPromptAttachments =
		imageParts.length > 0 ? promptAttachments.filter((attachment) => attachment.kind !== "image") : promptAttachments;
	const hasThreadAttachmentContent = threadPromptAttachments.length > 0;
	const hasPromptBubbleContent = capabilityInvocations.length > 0 || textParts.length > 0;
	const renderPromptBubble = (maxWidthClassName: string) =>
		hasPromptBubbleContent ? (
			<AiMessageContent
				className={cn(
					"grid gap-2 rounded-[var(--radius-lg)] border border-[color:var(--border-subtle)] bg-[color:var(--surface-2)] px-4 py-3 shadow-[var(--shadow-minimal)]",
					maxWidthClassName,
				)}
				data-slot="user-message-bubble"
			>
				<SelectedCapabilityChips invocations={capabilityInvocations} />
				{textParts.map((part, index) => (
					<UserTextPart key={`${message.id}-text-${index}`} text={part.text} />
				))}
			</AiMessageContent>
		) : null;

	if (imageParts.length > 0 || hasThreadAttachmentContent) {
		return (
			<AiMessage className="mx-auto flex w-full max-w-[880px] items-end justify-end px-5 py-4 md:px-7" from="user">
				<div
					className="grid w-fit max-w-[82%] self-end justify-items-end gap-2"
					data-slot="user-message-media-stack"
				>
					<UserThreadImages
						images={imageParts}
						messageId={messageId}
						onPreviewImage={onPreviewImage}
						promptAttachments={promptAttachments}
					/>
					<UserThreadAttachments attachments={threadPromptAttachments} />
					{renderPromptBubble("max-w-full")}
				</div>
			</AiMessage>
		);
	}

	return (
		<AiMessage className="mx-auto flex w-full max-w-[880px] items-end justify-end px-5 py-4 md:px-7" from="user">
			{renderPromptBubble("max-w-[82%]")}
		</AiMessage>
	);
}

function getCompactionNotice(value: unknown): DesktopCompactionNoticeMetadata | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as { status?: unknown; tokensBefore?: unknown };
	if (record.status !== "completed" || typeof record.tokensBefore !== "number") {
		return undefined;
	}
	return {
		status: record.status,
		tokensBefore: record.tokensBefore,
	};
}

function CompactionTimelineDivider({ status }: { status: "completed" | "running" }) {
	const isRunning = status === "running";
	return (
		<div
			aria-live="polite"
			className="mx-auto flex w-full max-w-[880px] items-center gap-3 px-5 py-3 text-[12px] text-muted-foreground md:px-7"
			data-slot="compaction-timeline-divider"
			data-status={status}
		>
			<div className="h-px min-w-8 flex-1 bg-[color:var(--border-subtle)]" />
			<div className="flex min-w-[9.5rem] items-center justify-center gap-2 whitespace-nowrap">
				{isRunning ? (
					<Spinner className="size-3.5" label="正在压缩上下文" />
				) : (
					<Box className="size-3.5 text-muted-foreground" aria-hidden="true" />
				)}
				<span>{isRunning ? "正在压缩上下文" : "上下文已压缩"}</span>
			</div>
			<div className="h-px min-w-8 flex-1 bg-[color:var(--border-subtle)]" />
		</div>
	);
}

function SystemMessage({ message }: { message: DesktopThreadMessage }) {
	const messageCustomMetadata = message.metadata?.custom;
	const compactionNotice = getCompactionNotice(messageCustomMetadata?.[DESKTOP_COMPACTION_NOTICE_METADATA_KEY]);
	if (compactionNotice) {
		return <CompactionTimelineDivider status={compactionNotice.status} />;
	}
	return null;
}

function useDelayedVisibleFlag(active: boolean, delayMs: number): boolean {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (!active) {
			setVisible(false);
			return;
		}

		const timeoutId = window.setTimeout(() => setVisible(true), delayMs);
		return () => window.clearTimeout(timeoutId);
	}, [active, delayMs]);

	return visible;
}

function QuietConversationLoadState({
	bottomInset,
	label,
	slot,
	statusSlot,
}: {
	bottomInset: number;
	label: string;
	slot: string;
	statusSlot: string;
}) {
	const showStatus = useDelayedVisibleFlag(true, HYDRATION_STATUS_DELAY_MS);

	return (
		<div
			aria-busy="true"
			className="relative h-full min-h-0 bg-transparent"
			data-slot={slot}
			style={{ paddingBottom: bottomInset }}
		>
			{showStatus ? (
				<output
					aria-label={label}
					aria-live="polite"
					className="absolute top-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface-1)]/85 px-3 py-1.5 text-xs text-muted-foreground shadow-[var(--shadow-minimal)] backdrop-blur"
					data-slot={statusSlot}
				>
					<Spinner aria-hidden="true" className="size-3" label={label} />
					<span>{label}</span>
				</output>
			) : null}
		</div>
	);
}

function QuietHydrationState({ bottomInset }: { bottomInset: number }) {
	return (
		<QuietConversationLoadState
			bottomInset={bottomInset}
			label="Loading conversation"
			slot="assistant-hydration-state"
			statusSlot="assistant-hydration-status"
		/>
	);
}

function QuietSessionSwitchState({ bottomInset }: { bottomInset: number }) {
	return (
		<QuietConversationLoadState
			bottomInset={bottomInset}
			label="Loading session"
			slot="assistant-session-switch-state"
			statusSlot="assistant-session-switch-status"
		/>
	);
}

function AssistantEmptyState({
	detail,
	onAction,
	tone,
}: {
	detail: string;
	onAction: () => void;
	tone: "error" | "idle";
}) {
	return (
		<div
			className="boundary-state mx-auto flex w-full items-center px-5 py-10 md:px-7"
			data-boundary-state={tone}
			data-slot="assistant-empty-state"
			role={tone === "error" ? "alert" : undefined}
		>
			<div className="grid max-w-xl gap-4">
				<div className="boundary-state-icon flex items-center justify-center rounded-lg border bg-background text-foreground">
					<Sparkles className={cn("size-4", tone === "error" ? "text-destructive" : "text-primary")} />
				</div>
				<div className="grid gap-1.5">
					<p className="ui-detail-label">{tone === "error" ? "Session unavailable" : "Skylark"}</p>
					<h2 className="text-[13px] font-semibold leading-5 text-foreground">
						{tone === "error" ? "The current transcript could not be loaded." : "What should we work on?"}
					</h2>
					<p className="text-sm leading-6 text-muted-foreground">
						{tone === "error"
							? "The desktop bridge did not return a usable session snapshot yet."
							: "Ask Skylark to inspect files, explain code, or shape the next change."}
					</p>
					<p className="boundary-state-detail font-mono text-xs leading-5 text-muted-foreground">{detail}</p>
				</div>
				<Button className="w-fit" onClick={onAction} type="button" variant="outline">
					Focus composer
				</Button>
			</div>
		</div>
	);
}

function AssistantComposerInput({
	activeSuggestionCount,
	capabilityCatalog,
	disabled,
	draft,
	hasSuggestionPanel,
	inputRef,
	onAppendAttachmentCandidates,
	onCloseSuggestionPanel,
	onConfirmSuggestion,
	onNavigateSuggestion,
	onRequestCapabilities,
	onSelectionChange,
	onSubmitDraft,
	setAttachmentErrors,
	setDraft,
	setIsComposing,
}: {
	activeSuggestionCount: number;
	capabilityCatalog?: DesktopCapabilityCatalog;
	disabled: boolean;
	draft: string;
	hasSuggestionPanel: boolean;
	inputRef: Ref<HTMLTextAreaElement>;
	onAppendAttachmentCandidates: (candidates: DesktopPromptAttachmentCandidate[]) => Promise<void>;
	onCloseSuggestionPanel: () => void;
	onConfirmSuggestion: () => void;
	onNavigateSuggestion: (direction: "down" | "up") => void;
	onRequestCapabilities?: () => Promise<void> | void;
	onSelectionChange: (selectionStart: number | undefined) => void;
	onSubmitDraft: (rawText: string) => Promise<void>;
	setAttachmentErrors: (errors: DesktopPromptAttachmentError[]) => void;
	setDraft: (draft: string) => void;
	setIsComposing: (isComposing: boolean) => void;
}) {
	const [hasInputOverflow, setHasInputOverflow] = useState(false);
	const isComposingRef = useRef(false);
	const hasRequestedCapabilitiesRef = useRef(false);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const isDisabled = disabled;

	const resizeTextarea = useCallback((currentText: string) => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}

		textarea.style.height = "auto";
		const measuredHeight =
			currentText.length === 0
				? COMPOSER_INPUT_MIN_HEIGHT_PX
				: Math.max(textarea.scrollHeight, COMPOSER_INPUT_MIN_HEIGHT_PX);
		const nextHeight = Math.min(measuredHeight, COMPOSER_INPUT_MAX_HEIGHT_PX);
		const nextOverflow = measuredHeight > COMPOSER_INPUT_MAX_HEIGHT_PX;
		textarea.style.height = `${nextHeight}px`;
		textarea.style.overflowY = nextOverflow ? "auto" : "hidden";
		setHasInputOverflow((current) => (current === nextOverflow ? current : nextOverflow));
	}, []);

	const setComposedRef = useCallback(
		(element: HTMLTextAreaElement | null) => {
			textareaRef.current = element;
			assignTextareaRef(inputRef, element);
		},
		[inputRef],
	);

	useLayoutEffect(() => {
		resizeTextarea(draft);
	}, [draft, resizeTextarea]);

	useEffect(() => {
		if (capabilityCatalog || !draft.startsWith("/") || isDisabled || hasRequestedCapabilitiesRef.current) {
			return;
		}

		hasRequestedCapabilitiesRef.current = true;
		void onRequestCapabilities?.();
	}, [capabilityCatalog, draft, isDisabled, onRequestCapabilities]);

	function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
		const nextText = event.currentTarget.value;
		setDraft(nextText);
		onSelectionChange(event.currentTarget.selectionStart);

		if (isCompositionInputEvent(event.nativeEvent)) {
			setIsComposing(true);
			return;
		}

		isComposingRef.current = false;
		setIsComposing(false);
	}

	function handleCompositionStart(): void {
		isComposingRef.current = true;
		setIsComposing(true);
	}

	function handleCompositionEnd(event: CompositionEvent<HTMLTextAreaElement>): void {
		const nextText = event.currentTarget.value;
		isComposingRef.current = false;
		setIsComposing(false);
		setDraft(nextText);
		onSelectionChange(event.currentTarget.selectionStart);
	}

	function handleBlur(event: FocusEvent<HTMLTextAreaElement>): void {
		if (!isComposingRef.current) {
			return;
		}

		isComposingRef.current = false;
		setIsComposing(false);
		setDraft(event.currentTarget.value);
	}

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
		if (isDisabled || isCompositionKeyEvent(event.nativeEvent, event.key)) {
			return;
		}

		if (hasSuggestionPanel && event.key === "Escape") {
			event.preventDefault();
			onCloseSuggestionPanel();
			return;
		}

		if (hasSuggestionPanel && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
			event.preventDefault();
			if (activeSuggestionCount > 0) {
				onNavigateSuggestion(event.key === "ArrowDown" ? "down" : "up");
			}
			return;
		}

		if (event.key !== "Enter" || event.shiftKey) {
			return;
		}

		event.preventDefault();
		if (hasSuggestionPanel) {
			onConfirmSuggestion();
			return;
		}
		const nextText = event.currentTarget.value;
		isComposingRef.current = false;
		setIsComposing(false);
		setDraft(nextText);
		void onSubmitDraft(nextText).catch(() => undefined);
	}

	function handleDrop(event: DragEvent<HTMLTextAreaElement>): void {
		if (isDisabled) {
			return;
		}
		if (event.dataTransfer.files.length === 0) {
			return;
		}
		event.preventDefault();
		void createPromptAttachmentCandidatesFromFiles(event.dataTransfer.files)
			.then(onAppendAttachmentCandidates)
			.catch((error: unknown) =>
				setAttachmentErrors([
					{ name: "Dropped files", message: error instanceof Error ? error.message : String(error) },
				]),
			);
	}

	function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
		if (isDisabled || event.clipboardData.files.length === 0) {
			return;
		}
		const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
		if (imageFiles.length === 0) {
			return;
		}
		event.preventDefault();
		void createPromptAttachmentCandidatesFromFiles(imageFiles)
			.then(onAppendAttachmentCandidates)
			.catch((error: unknown) =>
				setAttachmentErrors([
					{ name: "Pasted image", message: error instanceof Error ? error.message : String(error) },
				]),
			);
	}

	return (
		<PromptInputTextarea
			aria-label="Message Skylark"
			className="max-h-[224px] min-h-20 resize-none"
			data-overflow={hasInputOverflow ? "true" : "false"}
			disabled={isDisabled}
			onBlur={handleBlur}
			onChange={handleChange}
			onCompositionEnd={handleCompositionEnd}
			onCompositionStart={handleCompositionStart}
			onClick={(event) => onSelectionChange(event.currentTarget.selectionStart)}
			onDrop={handleDrop}
			onKeyDown={handleKeyDown}
			onKeyUp={(event) => onSelectionChange(event.currentTarget.selectionStart)}
			onPaste={handlePaste}
			onSelect={(event) => onSelectionChange(event.currentTarget.selectionStart)}
			placeholder="Message Skylark"
			ref={setComposedRef}
			rows={3}
			value={draft}
		/>
	);
}

function AssistantComposer({
	activeProjectId,
	activeSessionId,
	attachmentErrors,
	agentMode,
	capabilityCatalog,
	contextWindowUsage,
	disabled,
	inputRef,
	isStreaming,
	model,
	onCompact,
	onAbort,
	oauthProviders,
	onOpenSettings,
	onOpenWorkspacePreviewFile,
	onRequestCapabilities,
	onSetSessionMode,
	onSubmitPrompt,
	onUpdateSessionProfile,
	providerKeys,
	runtimeCatalog,
	selectedCapabilityInvocations,
	selectedPromptAttachments,
	setAttachmentErrors,
	setSelectedCapabilityInvocations,
	setSelectedPromptAttachments,
	thinkingLevel,
}: AssistantComposerProps) {
	const [composerDraft, setComposerDraft] = useState("");
	const [composerSelectionStart, setComposerSelectionStart] = useState(0);
	const [isComposerComposing, setIsComposerComposing] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
	const [suggestionsSuppressed, setSuggestionsSuppressed] = useState(false);
	const [workspaceFiles, setWorkspaceFiles] = useState<DesktopWorkspaceFileEntry[]>([]);
	const [workspaceFilesStatus, setWorkspaceFilesStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
	const [workspaceFilesError, setWorkspaceFilesError] = useState<string | undefined>();
	const workspaceFileScopeKey = `${activeProjectId ?? ""}\u0000${activeSessionId ?? ""}`;
	const resolvedCapabilityCatalog = capabilityCatalog ?? emptyCapabilityCatalog();
	const slashCommands = useMemo(
		() => resolveSlashCommandSuggestions(composerDraft, resolvedCapabilityCatalog.slashCommands),
		[composerDraft, resolvedCapabilityCatalog.slashCommands],
	);
	const slashSections = useMemo(() => groupSlashCommandSuggestions(slashCommands), [slashCommands]);
	const flattenedSlashCommands = useMemo(() => slashSections.flatMap((section) => section.commands), [slashSections]);
	const atReferenceToken = useMemo(
		() => resolveAtReferenceToken(composerDraft, composerSelectionStart),
		[composerDraft, composerSelectionStart],
	);
	const showSlashSuggestions =
		!disabled && !suggestionsSuppressed && slashCommands.length > 0 && composerDraft.startsWith("/");
	const showFileSuggestions =
		!disabled && !suggestionsSuppressed && !showSlashSuggestions && Boolean(atReferenceToken);
	const fileSuggestions = useMemo(
		() => filterWorkspaceFileSuggestions(workspaceFiles, atReferenceToken?.query ?? ""),
		[atReferenceToken?.query, workspaceFiles],
	);
	const activeSuggestionKind = showSlashSuggestions ? "slash" : showFileSuggestions ? "file" : undefined;
	const activeSuggestionCount =
		activeSuggestionKind === "slash"
			? flattenedSlashCommands.length
			: activeSuggestionKind === "file"
				? fileSuggestions.length
				: 0;
	const consoleState = disabled ? "disabled" : isStreaming ? "running" : "idle";
	const canSubmit =
		!disabled &&
		!isSubmitting &&
		!isComposerComposing &&
		(composerDraft.trim().length > 0 ||
			selectedCapabilityInvocations.length > 0 ||
			selectedPromptAttachments.length > 0);
	const handleComposerDraftChange = useCallback((nextDraft: string) => {
		setComposerDraft(nextDraft);
		setSelectedSuggestionIndex(0);
		setSuggestionsSuppressed(false);
	}, []);
	const handleComposerSelectionChange = useCallback(
		(selectionStart: number | undefined) => {
			setComposerSelectionStart(selectionStart ?? composerDraft.length);
		},
		[composerDraft.length],
	);
	const closeSuggestionPanel = useCallback(() => {
		setSuggestionsSuppressed(true);
	}, []);
	const focusComposerAt = useCallback(
		(cursor: number) => {
			requestAnimationFrame(() => {
				const textarea = getRefTextareaElement(inputRef);
				textarea?.focus();
				textarea?.setSelectionRange(cursor, cursor);
			});
		},
		[inputRef],
	);
	const selectSlashCommand = useCallback(
		(command: DesktopSlashCommandSummary) => {
			const invocation = createCapabilityInvocationFromSlashCommand(command);
			setSuggestionsSuppressed(true);
			if (invocation) {
				setSelectedCapabilityInvocations(upsertCapabilityInvocation(selectedCapabilityInvocations, invocation));
				setComposerDraft("");
				setComposerSelectionStart(0);
				getRefTextareaElement(inputRef)?.focus();
				return;
			}

			const nextText = `/${command.name} `;
			setComposerDraft(nextText);
			setComposerSelectionStart(nextText.length);
			focusComposerAt(nextText.length);
		},
		[focusComposerAt, inputRef, selectedCapabilityInvocations, setSelectedCapabilityInvocations],
	);
	const insertWorkspaceFileReference = useCallback(
		(file: DesktopWorkspaceFileEntry) => {
			if (!atReferenceToken) {
				return;
			}
			const reference = formatWorkspaceFileReference(file.path);
			const nextText =
				composerDraft.slice(0, atReferenceToken.start) + reference + composerDraft.slice(atReferenceToken.end);
			const nextCursor = atReferenceToken.start + reference.length;
			setSuggestionsSuppressed(true);
			setComposerDraft(nextText);
			setComposerSelectionStart(nextCursor);
			focusComposerAt(nextCursor);
		},
		[atReferenceToken, composerDraft, focusComposerAt],
	);
	const confirmActiveSuggestion = useCallback(() => {
		if (activeSuggestionKind === "slash") {
			const command = flattenedSlashCommands[selectedSuggestionIndex] ?? flattenedSlashCommands[0];
			if (command) {
				selectSlashCommand(command);
			}
			return;
		}
		if (activeSuggestionKind === "file") {
			const file = fileSuggestions[selectedSuggestionIndex] ?? fileSuggestions[0];
			if (file) {
				insertWorkspaceFileReference(file);
			}
		}
	}, [
		activeSuggestionKind,
		fileSuggestions,
		flattenedSlashCommands,
		insertWorkspaceFileReference,
		selectSlashCommand,
		selectedSuggestionIndex,
	]);
	const navigateActiveSuggestion = useCallback(
		(direction: "down" | "up") => {
			if (activeSuggestionCount <= 0) {
				return;
			}
			setSelectedSuggestionIndex((current) =>
				direction === "down"
					? (current + 1) % activeSuggestionCount
					: (current - 1 + activeSuggestionCount) % activeSuggestionCount,
			);
		},
		[activeSuggestionCount],
	);
	const appendPromptAttachmentCandidates = useCallback(
		async (candidates: DesktopPromptAttachmentCandidate[]): Promise<void> => {
			if (candidates.length === 0) {
				return;
			}
			const result = await window.desktopAgent.preparePromptAttachments({ candidates });
			setAttachmentErrors(result.errors);
			if (result.attachments.length > 0) {
				setSelectedPromptAttachments([...selectedPromptAttachments, ...result.attachments]);
			}
		},
		[selectedPromptAttachments, setAttachmentErrors, setSelectedPromptAttachments],
	);
	const openPromptAttachments = useCallback(async (): Promise<void> => {
		if (!activeSessionId) {
			return;
		}
		const result = await window.desktopAgent.openPromptAttachments({ sessionId: activeSessionId });
		setAttachmentErrors(result.errors);
		if (result.attachments.length > 0) {
			setSelectedPromptAttachments([...selectedPromptAttachments, ...result.attachments]);
		}
		getRefTextareaElement(inputRef)?.focus();
	}, [activeSessionId, inputRef, selectedPromptAttachments, setAttachmentErrors, setSelectedPromptAttachments]);
	const submitComposerDraft = useCallback(
		async (rawText?: string): Promise<void> => {
			if (disabled || isSubmitting || isComposerComposing) {
				return;
			}
			const text = (rawText ?? getRefTextareaValue(inputRef) ?? composerDraft).trim();
			if (isCompactCommand(text) && onCompact) {
				setIsSubmitting(true);
				try {
					const customInstructions = getCompactInstructions(text);
					setSelectedCapabilityInvocations([]);
					setSelectedPromptAttachments([]);
					setAttachmentErrors([]);
					setComposerDraft("");
					await onCompact(customInstructions);
				} finally {
					setIsSubmitting(false);
				}
				return;
			}
			if (!text && selectedCapabilityInvocations.length === 0 && selectedPromptAttachments.length === 0) {
				return;
			}
			setIsSubmitting(true);
			try {
				await onSubmitPrompt({
					text,
					...(selectedCapabilityInvocations.length > 0
						? { capabilityInvocations: selectedCapabilityInvocations }
						: {}),
					...(selectedPromptAttachments.length > 0 ? { attachments: selectedPromptAttachments } : {}),
				});
				setSelectedCapabilityInvocations([]);
				setSelectedPromptAttachments([]);
				setAttachmentErrors([]);
				setComposerDraft("");
			} finally {
				setIsSubmitting(false);
			}
		},
		[
			composerDraft,
			disabled,
			inputRef,
			isComposerComposing,
			isSubmitting,
			onCompact,
			onSubmitPrompt,
			selectedCapabilityInvocations,
			selectedPromptAttachments,
			setAttachmentErrors,
			setSelectedCapabilityInvocations,
			setSelectedPromptAttachments,
		],
	);
	const handleConsoleMouseDown = useCallback(
		(event: MouseEvent<HTMLFormElement>) => {
			if (disabled) {
				return;
			}
			const target = event.target as HTMLElement;
			if (
				target.closest(
					"button,a,input,textarea,select,[role='button'],[role='menuitem'],[data-radix-popper-content-wrapper]",
				)
			) {
				return;
			}

			event.preventDefault();
			event.currentTarget.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message Skylark']")?.focus();
		},
		[disabled],
	);

	useEffect(() => {
		if (workspaceFileScopeKey.length === 0) {
			setWorkspaceFilesError(undefined);
		}
		setWorkspaceFiles([]);
		setWorkspaceFilesStatus("idle");
		setWorkspaceFilesError(undefined);
	}, [workspaceFileScopeKey]);

	useEffect(() => {
		if (!showFileSuggestions || workspaceFilesStatus !== "idle") {
			return;
		}
		const desktopBridge = (window as Partial<Window>).desktopAgent as Partial<DesktopAgentBridge> | undefined;
		if (typeof desktopBridge?.listWorkspaceFiles !== "function") {
			setWorkspaceFilesStatus("error");
			setWorkspaceFilesError("Restart Skylark to enable workspace file listing.");
			return;
		}
		if (!activeProjectId && !activeSessionId) {
			setWorkspaceFilesStatus("error");
			setWorkspaceFilesError("Workspace is unavailable.");
			return;
		}
		let isCanceled = false;
		void desktopBridge
			.listWorkspaceFiles({
				...(activeProjectId ? { projectId: activeProjectId } : {}),
				...(activeSessionId ? { sessionId: activeSessionId } : {}),
				limit: 1000,
			})
			.then((result) => {
				if (isCanceled) {
					return;
				}
				setWorkspaceFiles(result.files);
				setWorkspaceFilesStatus(result.errorMessage ? "error" : "loaded");
				setWorkspaceFilesError(result.errorMessage);
			})
			.catch((error: unknown) => {
				if (isCanceled) {
					return;
				}
				setWorkspaceFilesStatus("error");
				setWorkspaceFilesError(error instanceof Error ? error.message : String(error));
			});
		return () => {
			isCanceled = true;
		};
	}, [activeProjectId, activeSessionId, showFileSuggestions, workspaceFilesStatus]);

	useEffect(() => {
		if (activeSuggestionCount === 0) {
			setSelectedSuggestionIndex(0);
			return;
		}
		setSelectedSuggestionIndex((current) => Math.min(current, activeSuggestionCount - 1));
	}, [activeSuggestionCount]);

	function renderSlashSuggestionRows(): ReactNode {
		let rowIndex = 0;
		return slashSections.map((section) => (
			<ComposerSuggestionSection key={section.key} title={section.title}>
				{section.commands.map((command) => {
					const currentIndex = rowIndex;
					rowIndex += 1;
					return (
						<ComposerSuggestionRow
							description={command.description ?? command.source}
							icon={getSlashCommandIcon(command)}
							key={`${command.source}:${command.name}`}
							onSelect={() => selectSlashCommand(command)}
							selected={currentIndex === selectedSuggestionIndex}
							title={`/${command.name}`}
							trailing={command.source}
						/>
					);
				})}
			</ComposerSuggestionSection>
		));
	}

	function renderFileSuggestionRows(): ReactNode {
		if (workspaceFilesStatus === "idle" || workspaceFilesStatus === "loading") {
			return (
				<ComposerSuggestionSection title="Files">
					<div className="flex items-center gap-2 px-2.5 py-2 text-[12px] leading-5 text-[color:var(--text-tertiary)]">
						<Spinner className="size-3.5" label="Loading files" />
						<span>Loading files...</span>
					</div>
				</ComposerSuggestionSection>
			);
		}
		if (fileSuggestions.length === 0) {
			return (
				<ComposerSuggestionSection title="Files">
					<div className="px-2.5 py-2 text-[12px] leading-5 text-[color:var(--text-tertiary)]">
						{workspaceFilesError ?? "No files found."}
					</div>
				</ComposerSuggestionSection>
			);
		}
		return (
			<ComposerSuggestionSection title="Files">
				{fileSuggestions.map((file, index) => (
					<ComposerSuggestionRow
						description={file.path}
						icon={getWorkspaceFileIcon(file)}
						key={file.path}
						onSelect={() => {
							setSelectedSuggestionIndex(index);
							onOpenWorkspacePreviewFile?.(file.path);
							getRefTextareaElement(inputRef)?.focus();
						}}
						selected={index === selectedSuggestionIndex}
						title={file.name}
						trailing={file.type}
					/>
				))}
			</ComposerSuggestionSection>
		);
	}

	const composerHeader =
		selectedCapabilityInvocations.length > 0 ||
		selectedPromptAttachments.length > 0 ||
		attachmentErrors.length > 0 ? (
			<div className="grid min-w-0 gap-2">
				<SelectedCapabilityChips
					invocations={selectedCapabilityInvocations}
					onRemove={(invocation) =>
						setSelectedCapabilityInvocations(
							removeCapabilityInvocation(selectedCapabilityInvocations, invocation),
						)
					}
				/>
				<PromptAttachmentChips
					attachments={selectedPromptAttachments}
					onRemove={(attachment) => {
						setSelectedPromptAttachments(selectedPromptAttachments.filter((item) => item.id !== attachment.id));
						if (selectedPromptAttachments.length <= 1) {
							setAttachmentErrors([]);
						}
					}}
				/>
				{attachmentErrors.length > 0 ? (
					<div className="grid gap-1 text-[12px] leading-5 text-[color:var(--destructive)]">
						{attachmentErrors.map((error) => (
							<div key={`${error.path ?? error.name}:${error.message}`} className="truncate">
								{error.name}: {error.message}
							</div>
						))}
					</div>
				) : null}
			</div>
		) : undefined;

	return (
		<SkylarkPromptInputComposer
			body={
				<AssistantComposerInput
					activeSuggestionCount={activeSuggestionCount}
					capabilityCatalog={capabilityCatalog}
					disabled={disabled}
					draft={composerDraft}
					hasSuggestionPanel={Boolean(activeSuggestionKind)}
					inputRef={inputRef}
					onAppendAttachmentCandidates={appendPromptAttachmentCandidates}
					onCloseSuggestionPanel={closeSuggestionPanel}
					onConfirmSuggestion={confirmActiveSuggestion}
					onNavigateSuggestion={navigateActiveSuggestion}
					onRequestCapabilities={onRequestCapabilities}
					onSelectionChange={handleComposerSelectionChange}
					onSubmitDraft={submitComposerDraft}
					setAttachmentErrors={setAttachmentErrors}
					setDraft={handleComposerDraftChange}
					setIsComposing={setIsComposerComposing}
				/>
			}
			canSubmit={canSubmit}
			consoleState={consoleState}
			disabled={disabled}
			footerLeft={
				<>
					<SkylarkPromptInputAttachmentButton disabled={disabled} onClick={openPromptAttachments} />
					<ComposerQuickControls
						agentMode={agentMode}
						disabled={disabled}
						isStreaming={isStreaming}
						model={model}
						oauthProviders={oauthProviders}
						onOpenSettings={onOpenSettings}
						onSetSessionMode={onSetSessionMode}
						onUpdateSessionProfile={onUpdateSessionProfile}
						providerKeys={providerKeys}
						runtimeCatalog={runtimeCatalog}
						thinkingLevel={thinkingLevel}
					/>
					<SkylarkContextWindowControl usage={contextWindowUsage} />
				</>
			}
			header={composerHeader}
			isStreaming={isStreaming}
			onMouseDown={handleConsoleMouseDown}
			onStop={onAbort}
			onSubmit={() => submitComposerDraft()}
		>
			<AnimatePresence>
				{activeSuggestionKind ? (
					<ComposerSuggestionPanel label="Composer suggestions">
						{activeSuggestionKind === "slash" ? renderSlashSuggestionRows() : renderFileSuggestionRows()}
					</ComposerSuggestionPanel>
				) : null}
			</AnimatePresence>
		</SkylarkPromptInputComposer>
	);
}

export function ChatWorkbench({
	activeProjectId,
	capabilityCatalog,
	composerFocusRequest,
	isWorkspacePanelOpen = true,
	onAbort,
	onCompact,
	onConsumeProposedPlan,
	onExecutePlan,
	onOpenEnvironmentResource,
	oauthProviders,
	onOpenSettings,
	onOpenWorkspacePreviewFile,
	onRequestCapabilities,
	onSetSessionMode,
	onSubmitPrompt,
	onUpdateSessionProfile,
	providerKeys,
	runtimeCatalog,
	showThinkingBlocks,
	workspaceStatus,
}: ChatWorkbenchProps) {
	const agentMode = useAgentStore((state) => state.agentMode);
	const bridgeError = useAgentStore((state) => state.bridgeError);
	const compactionActivity = useAgentStore((state) => state.compactionActivity);
	const cwd = useAgentStore((state) => state.cwd);
	const errorMessage = useAgentStore((state) => state.errorMessage);
	const hasHydrated = useAgentStore((state) => state.hasHydrated);
	const isStreaming = useAgentStore((state) => state.isStreaming);
	const contextMessages = useAgentStore((state) => state.contextMessages);
	const messages = useAgentStore((state) => state.messages);
	const consumedProposedPlanMessageIds = useAgentStore((state) => state.consumedProposedPlanMessageIds);
	const model = useAgentStore((state) => state.model);
	const activeAgentSessionId = useAgentStore((state) => state.activeSessionId);
	const pendingActiveSessionId = useAgentStore((state) => state.pendingActiveSessionId);
	const runActivityTiming = useAgentStore((state) => state.runActivityTiming);
	const streamingMessage = useAgentStore((state) => state.streamingMessage);
	const taskProgress = useAgentStore((state) => state.taskProgress);
	const fallbackWorkspaceStatus = useWorkspaceStatus({
		activeSessionId: activeAgentSessionId,
		cwd,
		enabled: workspaceStatus === undefined,
		progress: taskProgress,
	});
	const resolvedWorkspaceStatus = workspaceStatus ?? fallbackWorkspaceStatus;
	const visibleStreamingMessage = useThrottledStreamingMessage(streamingMessage, isStreaming);
	const thinkingLevel = useAgentStore((state) => state.thinkingLevel);
	const toolCalls = useAgentStore((state) => state.toolCalls);
	const composerRef = useRef<HTMLTextAreaElement | null>(null);
	const composerDockRef = useRef<HTMLDivElement | null>(null);
	const threadViewportRef = useRef<HTMLDivElement | null>(null);
	const [threadViewportElement, setThreadViewportElement] = useState<HTMLDivElement | null>(null);
	const handledComposerFocusNonceRef = useRef<number | undefined>(undefined);
	const [selectedCapabilityInvocations, setSelectedCapabilityInvocations] = useState<
		DesktopPromptCapabilityInvocation[]
	>([]);
	const [selectedPromptAttachments, setSelectedPromptAttachments] = useState<DesktopPreparedPromptAttachment[]>([]);
	const [attachmentErrors, setAttachmentErrors] = useState<DesktopPromptAttachmentError[]>([]);
	const [composerInset, setComposerInset] = useState(DEFAULT_COMPOSER_INSET_PX);
	const [previewImage, setPreviewImage] = useState<ThreadImagePreview | undefined>(undefined);
	const workspaceImagePreviewCacheRef = useRef<Map<string, Promise<ResolvedThreadImagePreview>>>(new Map());
	const previousAttachmentSessionIdRef = useRef<typeof activeAgentSessionId>(undefined);
	useEffect(() => {
		if (previousAttachmentSessionIdRef.current === activeAgentSessionId) return;
		previousAttachmentSessionIdRef.current = activeAgentSessionId;
		workspaceImagePreviewCacheRef.current.clear();
		setSelectedPromptAttachments([]);
		setAttachmentErrors([]);
	}, [activeAgentSessionId]);
	const assistantMessages = useMemo(
		() =>
			createAssistantUiRuntimeMessages({
				isStreaming,
				messages,
				runActivityTiming,
				showThinkingBlocks,
				streamingMessage: visibleStreamingMessage,
				toolCalls,
			}),
		[isStreaming, messages, runActivityTiming, showThinkingBlocks, visibleStreamingMessage, toolCalls],
	);
	const isCompactionRunning = compactionActivity !== undefined;
	const handleOpenImagePreview = useCallback((image: ThreadImagePreview): void => {
		setPreviewImage(image);
	}, []);
	const handleCloseImagePreview = useCallback((): void => {
		setPreviewImage(undefined);
	}, []);
	const resolveWorkspaceImagePreview = useCallback<WorkspaceImagePreviewResolver>(
		async (path: string) => {
			if (!activeAgentSessionId) {
				throw new Error("Image not available");
			}
			const desktopBridge = (window as Partial<Window>).desktopAgent as Partial<DesktopAgentBridge> | undefined;
			if (typeof desktopBridge?.openWorkspacePreviewFile !== "function") {
				throw new Error("Image not available");
			}

			const cacheKey = `${activeAgentSessionId}:${path}`;
			const cachedPreview = workspaceImagePreviewCacheRef.current.get(cacheKey);
			if (cachedPreview) {
				return cachedPreview;
			}

			const previewPromise = desktopBridge
				.openWorkspacePreviewFile({ path, sessionId: activeAgentSessionId })
				.then((file: DesktopPreviewFile) => {
					if (file.kind !== "image" || !file.dataUrl?.startsWith("data:image/")) {
						throw new Error(file.errorMessage ?? "Image not available");
					}
					return {
						src: file.dataUrl,
						title: file.name,
					};
				})
				.catch((error: unknown) => {
					workspaceImagePreviewCacheRef.current.delete(cacheKey);
					throw error;
				});
			workspaceImagePreviewCacheRef.current.set(cacheKey, previewPromise);
			return previewPromise;
		},
		[activeAgentSessionId],
	);
	const latestPlanMessageId = useMemo(
		() => findLatestCompletedProposedPlanMessageId(assistantMessages),
		[assistantMessages],
	);
	const { abortNoticeKey, persistentTopNotice } = resolveChatShellNoticeState({
		bridgeError,
		errorMessage,
		messages,
	});
	const [visibleAbortNoticeKey, setVisibleAbortNoticeKey] = useState<string | undefined>(abortNoticeKey);
	const showAbortNotice = abortNoticeKey !== undefined && visibleAbortNoticeKey === abortNoticeKey;
	const modelContextWindow = useMemo(
		() => resolveModelContextWindow({ model, runtimeCatalog }),
		[model, runtimeCatalog],
	);
	const contextWindowUsage = useMemo(() => {
		const messagesForContext = contextMessages.length > 0 ? contextMessages : messages;
		return resolveContextWindowUsage({
			contextWindow: modelContextWindow,
			messages: messagesForContext,
			streamingMessage,
		});
	}, [contextMessages, messages, modelContextWindow, streamingMessage]);
	const assistantViewportScrollDependency = useMemo(
		() => ({ assistantMessages, composerInset }),
		[assistantMessages, composerInset],
	);
	const setThreadViewportRef = useCallback((element: HTMLDivElement | null) => {
		threadViewportRef.current = element;
		setThreadViewportElement((current) => (current === element ? current : element));
	}, []);
	const isSwitchingSession = pendingActiveSessionId !== undefined;
	const hasActiveConversation = activeAgentSessionId !== undefined;
	const isConversationHydrating = hasActiveConversation && !hasHydrated;
	const isComposerDisabled = !hasActiveConversation || !hasHydrated || Boolean(bridgeError) || isSwitchingSession;
	const proposedPlanExecutionContext = useMemo(
		() => ({
			disabled: isComposerDisabled,
			isStreaming,
			latestPlanMessageId,
			consumedProposedPlanMessageIds,
			onConsumeProposedPlan,
			onExecutePlan,
		}),
		[
			consumedProposedPlanMessageIds,
			isComposerDisabled,
			isStreaming,
			latestPlanMessageId,
			onConsumeProposedPlan,
			onExecutePlan,
		],
	);
	const lastMessage = messages[messages.length - 1];
	const lastUserTurnKey =
		lastMessage?.role === "user" ? `${messages.length}:${lastMessage.timestamp}:${lastMessage.role}` : undefined;
	usePinnedAssistantViewportAutoScroll({
		enabled: hasActiveConversation && hasHydrated,
		forcePinned: lastMessage?.role === "user",
		forcePinnedDependency: lastUserTurnKey,
		scrollDependency: assistantViewportScrollDependency,
		viewportRef: threadViewportRef,
	});
	useEffect(() => {
		markRendererPerformance("renderer:chat-shell:first-render");
		measureRendererPerformance(
			"renderer bootstrap to chat shell",
			"renderer:bootstrap:start",
			"renderer:chat-shell:first-render",
		);
	}, []);
	useEffect(() => {
		if (
			!composerFocusRequest ||
			handledComposerFocusNonceRef.current === composerFocusRequest.nonce ||
			composerFocusRequest.sessionId !== activeAgentSessionId ||
			!hasHydrated ||
			bridgeError ||
			isSwitchingSession
		) {
			return;
		}

		composerRef.current?.focus();
		handledComposerFocusNonceRef.current = composerFocusRequest.nonce;
	}, [activeAgentSessionId, bridgeError, composerFocusRequest, hasHydrated, isSwitchingSession]);
	useEffect(() => {
		const composerDock = composerDockRef.current;
		if (!composerDock) {
			return;
		}
		const composerDockElement = composerDock;

		function updateComposerInset(): void {
			const nextInset = Math.ceil(composerDockElement.getBoundingClientRect().height) + COMPOSER_SCROLL_GAP_PX;
			setComposerInset((currentInset) => (currentInset === nextInset ? currentInset : nextInset));
		}

		updateComposerInset();
		if (typeof ResizeObserver === "undefined") {
			return;
		}

		const resizeObserver = new ResizeObserver(updateComposerInset);
		resizeObserver.observe(composerDockElement);
		return () => resizeObserver.disconnect();
	}, []);

	useEffect(() => {
		if (!abortNoticeKey) {
			return;
		}

		setVisibleAbortNoticeKey(abortNoticeKey);
		const timeoutId = window.setTimeout(() => {
			setVisibleAbortNoticeKey((currentKey) => (currentKey === abortNoticeKey ? undefined : currentKey));
		}, 2400);

		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [abortNoticeKey]);

	return (
		<WorkspacePreviewLinkContext.Provider value={onOpenWorkspacePreviewFile}>
			<ProposedPlanExecutionContext.Provider value={proposedPlanExecutionContext}>
				<div className="relative h-full min-h-0 w-full" data-slot="assistant-chat-shell">
					<AnimatePresence initial={false}>
						{showAbortNotice && errorMessage ? (
							<motion.div
								animate={{ opacity: 1, x: "-50%", y: 0 }}
								className="pointer-events-none absolute left-1/2 top-4 z-30"
								exit={{ opacity: 0, x: "-50%", y: 4 }}
								initial={{ opacity: 0, x: "-50%", y: 4 }}
								key="abort-notice"
								transition={softRevealTransition}
							>
								<output
									aria-live="polite"
									className="flex items-center gap-2 rounded-full border border-destructive/20 bg-background/90 px-4 py-2 text-[13px] font-medium text-destructive shadow-lg backdrop-blur"
								>
									<Sparkles className="size-3.5" />
									<span>{errorMessage}</span>
								</output>
							</motion.div>
						) : null}
					</AnimatePresence>

					<AnimatePresence initial={false}>
						{persistentTopNotice ? (
							<motion.div
								className="absolute inset-x-6 top-4 z-20 md:inset-x-9 xl:inset-x-14"
								key="top-notice"
								{...subtleReveal}
							>
								<ErrorNotice
									className="mx-auto max-w-[880px] backdrop-blur"
									description={persistentTopNotice}
									title="Desktop runtime notice"
								/>
							</motion.div>
						) : null}
					</AnimatePresence>

					<AnimatePresence initial={false}>
						{isWorkspacePanelOpen && resolvedWorkspaceStatus.isAvailable ? (
							<WorkspaceStatusPanel
								key="workspace-status-panel"
								onOpenEnvironmentResource={onOpenEnvironmentResource}
								workspaceStatus={resolvedWorkspaceStatus}
							/>
						) : null}
					</AnimatePresence>

					<AssistantTimelineErrorBoundary resetKey={activeAgentSessionId ?? "no-active-session"}>
						<Conversation className="absolute inset-0 min-h-0" data-slot="assistant-thread">
							{isConversationHydrating ? (
								<QuietHydrationState bottomInset={composerInset} />
							) : isSwitchingSession ? (
								<QuietSessionSwitchState bottomInset={composerInset} />
							) : (
								<ConversationContent
									className="gap-0 p-0"
									scrollClassName="native-scrollbar h-full overflow-y-auto overscroll-contain pb-6 pt-6"
									scrollProps={{
										"data-slot": "assistant-thread-viewport",
										ref: setThreadViewportRef,
										style: { paddingBottom: composerInset },
									}}
									stickToBottom={false}
								>
									{assistantMessages.length === 0 ? (
										<AssistantEmptyState
											detail={
												bridgeError
													? (cwd ?? "Session snapshot unavailable.")
													: (cwd ?? "Workspace path will appear here when the session is ready.")
											}
											onAction={() => composerRef.current?.focus()}
											tone={bridgeError ? "error" : "idle"}
										/>
									) : (
										assistantMessages.map((message) => {
											const messageKey = `${activeAgentSessionId ?? "no-active-session"}:${message.id}`;
											if (message.role === "user") {
												return (
													<UserMessage
														key={messageKey}
														message={message}
														onPreviewImage={handleOpenImagePreview}
													/>
												);
											}
											if (message.role === "assistant") {
												return (
													<AssistantMessage
														key={messageKey}
														message={message}
														onPreviewImage={handleOpenImagePreview}
														resolveWorkspaceImage={resolveWorkspaceImagePreview}
													/>
												);
											}
											return <SystemMessage key={messageKey} message={message} />;
										})
									)}
									{isCompactionRunning ? <CompactionTimelineDivider status="running" /> : null}
									<div
										className="pointer-events-none sticky bottom-4 z-10 flex h-8 justify-center"
										data-slot="assistant-scroll-to-bottom-anchor"
									>
										<div className="pointer-events-auto">
											<AssistantScrollToBottomButton viewport={threadViewportElement} />
										</div>
									</div>
								</ConversationContent>
							)}
						</Conversation>
					</AssistantTimelineErrorBoundary>

					<ThreadImagePreviewDialog image={previewImage} onClose={handleCloseImagePreview} />

					<div
						className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-5 pb-5 md:px-7 md:pb-7"
						data-slot="composer-dock"
						ref={composerDockRef}
					>
						<div className="pointer-events-auto w-full max-w-[880px]">
							<AssistantComposer
								activeProjectId={activeProjectId}
								activeSessionId={activeAgentSessionId}
								attachmentErrors={attachmentErrors}
								agentMode={agentMode}
								capabilityCatalog={capabilityCatalog}
								contextWindowUsage={contextWindowUsage}
								disabled={isComposerDisabled}
								inputRef={composerRef}
								isStreaming={isStreaming}
								model={model}
								onAbort={onAbort}
								onCompact={onCompact}
								oauthProviders={oauthProviders}
								onOpenSettings={onOpenSettings}
								onOpenWorkspacePreviewFile={onOpenWorkspacePreviewFile}
								onRequestCapabilities={onRequestCapabilities}
								onSetSessionMode={onSetSessionMode}
								onSubmitPrompt={onSubmitPrompt}
								onUpdateSessionProfile={onUpdateSessionProfile}
								providerKeys={providerKeys}
								runtimeCatalog={runtimeCatalog}
								selectedCapabilityInvocations={selectedCapabilityInvocations}
								selectedPromptAttachments={selectedPromptAttachments}
								setAttachmentErrors={setAttachmentErrors}
								setSelectedCapabilityInvocations={setSelectedCapabilityInvocations}
								setSelectedPromptAttachments={setSelectedPromptAttachments}
								thinkingLevel={thinkingLevel}
							/>
						</div>
					</div>
				</div>
			</ProposedPlanExecutionContext.Provider>
		</WorkspacePreviewLinkContext.Provider>
	);
}
