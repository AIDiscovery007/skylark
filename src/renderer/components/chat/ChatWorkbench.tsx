import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { FileUIPart } from "ai";
import {
	ArrowDown,
	ArrowUp,
	Box,
	Check,
	CheckCircle2,
	ChevronDown,
	Circle,
	CircleAlert,
	CircleDot,
	Clock3,
	FileText,
	ImageIcon,
	Paperclip,
	Sparkles,
	Square,
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
	DesktopSubagentOpenRequest,
	DesktopTaskProgress,
	DesktopTaskProgressStatus,
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
import type { ToolCallActivity } from "../../lib/conversation-timeline-projection.ts";
import { cn } from "../../lib/utils.ts";
import { useAgentStore } from "../../stores/agent-store.ts";
import {
	Attachment,
	AttachmentInfo,
	AttachmentPreview,
	AttachmentRemove,
	Attachments,
} from "../ai-elements/attachments.tsx";
import { Conversation, ConversationContent } from "../ai-elements/conversation.tsx";
import {
	Message as AiMessage,
	MessageContent as AiMessageContent,
	MessageResponse,
	type MessageResponseProps,
} from "../ai-elements/message.tsx";
import { AgentRunActivity } from "./AgentRunActivity.tsx";
import { ComposerQuickControls } from "./ComposerQuickControls.tsx";
import {
	type ContextWindowUsage,
	resolveChatShellNoticeState,
	resolveContextWindowUsage,
	resolveModelContextWindow,
} from "./chat-helpers.ts";

const DEFAULT_COMPOSER_INSET_PX = 172;
const COMPOSER_SCROLL_GAP_PX = 24;
const COMPOSER_INPUT_MIN_HEIGHT_PX = 80;
const COMPOSER_INPUT_MAX_HEIGHT_PX = 224;
const ASSISTANT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 96;
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
	onOpenSubagent?: (request: Omit<DesktopSubagentOpenRequest, "nonce">) => void;
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

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function getDetailsRecord(value: unknown): Record<string, unknown> | undefined {
	const details = getRecord(value)?.details;
	return getRecord(details);
}

function getStringProperty(value: unknown, key: string): string | undefined {
	const property = getRecord(value)?.[key];
	return typeof property === "string" && property.trim().length > 0 ? property.trim() : undefined;
}

function resolveSubagentOpenRequest(
	toolCall: ToolCallActivity,
	parentSessionId: string | undefined,
): Omit<DesktopSubagentOpenRequest, "nonce"> | undefined {
	if (!parentSessionId || toolCall.toolName !== "subagent") {
		return undefined;
	}
	const details = getDetailsRecord(toolCall.result) ?? getDetailsRecord(toolCall.partialResult);
	const subagentId = getStringProperty(details, "subagentId");
	if (!subagentId) {
		return undefined;
	}
	return {
		parentSessionId,
		subagentId,
		title:
			getStringProperty(details, "title") ??
			getStringProperty(toolCall.args, "title") ??
			getStringProperty(toolCall.args, "task"),
	};
}

interface AssistantComposerProps {
	activeSessionId?: string;
	attachmentErrors: DesktopPromptAttachmentError[];
	availableTools: string[];
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
			lastForcePinnedDependencyRef.current = undefined;
			return;
		}

		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}
		const viewportElement = viewport;

		function handleScroll(): void {
			shouldAutoScrollRef.current = isAssistantViewportPinnedToBottom(viewportElement);
		}

		handleScroll();
		viewportElement.addEventListener("scroll", handleScroll, { passive: true });
		return () => viewportElement.removeEventListener("scroll", handleScroll);
	}, [enabled, viewportRef]);

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
		.sort((left, right) => left.name.localeCompare(right.name))
		.slice(0, 8);
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

function PromptAttachmentChips({
	attachments,
	onRemove,
}: {
	attachments: (DesktopPromptAttachmentDisplay | DesktopPreparedPromptAttachment)[];
	onRemove?: (attachment: DesktopPromptAttachmentDisplay | DesktopPreparedPromptAttachment) => void;
}) {
	if (attachments.length === 0) {
		return null;
	}
	return (
		<Attachments className="min-w-0" variant="inline">
			{attachments.map((attachment) => {
				const filePart = toPromptAttachmentFilePart(attachment);
				return (
					<Attachment
						aria-label={attachment.name}
						className="max-w-full border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] text-[13px] leading-none shadow-[var(--shadow-minimal)]"
						data={filePart}
						key={attachment.id}
						onRemove={onRemove ? () => onRemove(attachment) : undefined}
						title={`${attachment.name} ${formatAttachmentSize(attachment.size)}`}
					>
						<AttachmentPreview
							fallbackIcon={
								attachment.kind === "image" ? (
									<ImageIcon className="size-3.5 text-muted-foreground" />
								) : (
									<FileText className="size-3.5 text-muted-foreground" />
								)
							}
						/>
						<AttachmentInfo />
						<span className="shrink-0 text-[11px] text-muted-foreground">
							{formatAttachmentSize(attachment.size)}
						</span>
						<AttachmentRemove label={`Remove ${attachment.name}`} />
					</Attachment>
				);
			})}
		</Attachments>
	);
}

function SlashCommandPalette({
	commands,
	onSelect,
	selectedIndex,
}: {
	commands: DesktopSlashCommandSummary[];
	onSelect: (command: DesktopSlashCommandSummary) => void;
	selectedIndex: number;
}) {
	const selectedCommandRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		if (selectedIndex < 0 || selectedIndex >= commands.length) {
			return;
		}
		selectedCommandRef.current?.scrollIntoView?.({ block: "nearest" });
	}, [commands.length, selectedIndex]);

	return (
		<motion.div
			animate={{ opacity: 1, y: 0 }}
			className="absolute bottom-full left-0 z-50 mb-3 w-[min(28rem,calc(100vw-5rem))] overflow-hidden rounded-lg border border-border/80 bg-background shadow-[0_20px_60px_-34px_rgba(15,23,42,0.6)]"
			exit={{ opacity: 0, y: 4 }}
			initial={{ opacity: 0, y: 4 }}
			transition={softRevealTransition}
		>
			<div className="border-b border-border/70 px-3 py-2">
				<div className="flex items-center gap-2 text-[12px] font-medium uppercase text-muted-foreground">
					<SquareSlash className="size-3.5" />
					<span>Slash commands</span>
				</div>
			</div>
			<div className="max-h-72 overflow-y-auto p-1">
				{commands.map((command, index) => (
					<button
						aria-current={index === selectedIndex ? "true" : undefined}
						className={cn(
							"grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md px-3 py-2 text-left transition-colors",
							index === selectedIndex ? "bg-secondary text-secondary-foreground" : "hover:bg-muted/70",
						)}
						data-selected={index === selectedIndex ? "true" : undefined}
						key={`${command.source}:${command.name}`}
						onMouseDown={(event) => {
							event.preventDefault();
							onSelect(command);
						}}
						ref={index === selectedIndex ? selectedCommandRef : undefined}
						type="button"
					>
						<span className="min-w-0">
							<span className="block truncate font-mono text-[13px] font-medium">/{command.name}</span>
							<span className="block truncate text-[12px] leading-5 text-muted-foreground">
								{command.description ?? command.source}
							</span>
						</span>
						<span className="self-center rounded-md bg-muted px-2 py-1 text-[11px] uppercase text-muted-foreground">
							{command.source}
						</span>
					</button>
				))}
			</div>
		</motion.div>
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
	text,
}: {
	className?: string;
	isStreaming?: boolean;
	text: string;
}) {
	return (
		<div
			className="select-text"
			data-selectable-text="true"
			data-slot="assistant-markdown-content"
			data-streaming={isStreaming ? "true" : undefined}
		>
			<MessageResponse
				className={cn(ASSISTANT_MARKDOWN_CLASSNAME, className)}
				components={ASSISTANT_MARKDOWN_COMPONENTS}
				isAnimating={isStreaming}
				mode={isStreaming ? "streaming" : "static"}
				remarkPlugins={ASSISTANT_MARKDOWN_REMARK_PLUGINS}
			>
				{text}
			</MessageResponse>
		</div>
	);
}

function AssistantMarkdownPart({ status, text }: { status?: DesktopThreadMessageStatus; text: string }) {
	return <AssistantMarkdownResponse isStreaming={status?.type === "running"} text={text} />;
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

function UserImagePart({ image }: { image: string }) {
	return (
		<figure
			className="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] p-1 shadow-[var(--shadow-minimal)]"
			data-slot="user-attachment-card"
		>
			<img
				alt="Attached visual"
				className="max-h-80 rounded-[calc(var(--radius-md)-2px)] object-contain"
				src={image}
			/>
		</figure>
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

function AssistantMessageErrorNotice({ messageStatus }: { messageStatus?: DesktopThreadMessageStatus }) {
	if (messageStatus?.type !== "incomplete" || messageStatus.reason !== "error") {
		return null;
	}
	const description =
		typeof messageStatus.error === "string" && messageStatus.error.trim().length > 0
			? messageStatus.error
			: "The agent run did not complete.";

	return <ErrorNotice className="mt-3 text-[13px] leading-5" description={description} title="Agent run failed" />;
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
	onOpenSubagentToolCall,
}: {
	message: DesktopThreadMessage;
	onOpenSubagentToolCall?: (toolCall: ToolCallActivity) => void;
}) {
	const messageId = message.id ?? `assistant-${message.createdAt?.getTime() ?? "message"}`;
	const messageStatus = message.status;
	const messageCustomMetadata = message.metadata?.custom;
	const isMessageRunning = messageStatus?.type === "running";
	const activityParts = getThreadActivityParts(message);
	const textParts = getThreadTextParts(message);
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
							onOpenSubagentToolCall={onOpenSubagentToolCall}
							parts={activityParts}
						/>
					) : null}
					{textParts.length > 0 ? (
						textParts.map((part, partIndex) => (
							<AssistantMarkdownPart
								key={`${messageId}-text-${part.parentId ?? partIndex}`}
								status={messageStatus}
								text={part.text}
							/>
						))
					) : (
						<EmptyMessagePart status={messageStatus} />
					)}
					<AssistantProposedPlanCard messageCustomMetadata={messageCustomMetadata} messageStatus={messageStatus} />
					<AssistantProposedPlanActions
						messageCustomMetadata={messageCustomMetadata}
						messageId={messageId}
						messageStatus={messageStatus}
					/>
					<AssistantFileReferences messageCustomMetadata={messageCustomMetadata} messageStatus={messageStatus} />
					<AssistantMessageErrorNotice messageStatus={messageStatus} />
				</AiMessageContent>
			</div>
		</AiMessage>
	);
}

function UserMessage({ message }: { message: DesktopThreadMessage }) {
	const messageCustomMetadata = message.metadata?.custom;
	const capabilityInvocations = useMemo(
		() => getMessageCapabilityInvocations(messageCustomMetadata),
		[messageCustomMetadata],
	);
	const promptAttachments = useMemo(() => getUserPromptAttachments(messageCustomMetadata), [messageCustomMetadata]);
	const imageParts = getThreadImageParts(message);
	const textParts = getThreadTextParts(message);
	return (
		<AiMessage className="mx-auto flex w-full max-w-[880px] justify-end px-5 py-4 md:px-7" from="user">
			<AiMessageContent
				className="grid max-w-[82%] gap-2 rounded-[var(--radius-lg)] border border-[color:var(--border-subtle)] bg-[color:var(--surface-2)] px-4 py-3 shadow-[var(--shadow-minimal)]"
				data-slot="user-message-bubble"
			>
				<SelectedCapabilityChips invocations={capabilityInvocations} />
				<PromptAttachmentChips attachments={promptAttachments} />
				{imageParts.map((part, index) => (
					<UserImagePart image={part.image} key={`${message.id}-image-${index}`} />
				))}
				{textParts.map((part, index) => (
					<UserTextPart key={`${message.id}-text-${index}`} text={part.text} />
				))}
			</AiMessageContent>
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
	activeSessionId,
	attachmentErrors,
	capabilityCatalog,
	disabled,
	draft,
	inputRef,
	onCompact,
	onRequestCapabilities,
	onSubmitPrompt,
	selectedCapabilityInvocations,
	selectedPromptAttachments,
	setAttachmentErrors,
	setDraft,
	setIsComposing,
	setSelectedCapabilityInvocations,
	setSelectedPromptAttachments,
}: {
	activeSessionId?: string;
	attachmentErrors: DesktopPromptAttachmentError[];
	capabilityCatalog?: DesktopCapabilityCatalog;
	disabled: boolean;
	draft: string;
	inputRef: Ref<HTMLTextAreaElement>;
	onCompact?: (customInstructions?: string) => Promise<void>;
	onRequestCapabilities?: () => Promise<void> | void;
	onSubmitPrompt: (request: DesktopPromptSubmission) => Promise<void>;
	selectedCapabilityInvocations: DesktopPromptCapabilityInvocation[];
	selectedPromptAttachments: DesktopPreparedPromptAttachment[];
	setAttachmentErrors: (errors: DesktopPromptAttachmentError[]) => void;
	setDraft: (draft: string) => void;
	setIsComposing: (isComposing: boolean) => void;
	setSelectedCapabilityInvocations: (invocations: DesktopPromptCapabilityInvocation[]) => void;
	setSelectedPromptAttachments: (attachments: DesktopPreparedPromptAttachment[]) => void;
}) {
	const resolvedCapabilityCatalog = capabilityCatalog ?? emptyCapabilityCatalog();
	const [hasInputOverflow, setHasInputOverflow] = useState(false);
	const isComposingRef = useRef(false);
	const hasRequestedCapabilitiesRef = useRef(false);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const isDisabled = disabled;
	const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
	const slashCommands = useMemo(
		() => resolveSlashCommandSuggestions(draft, resolvedCapabilityCatalog.slashCommands),
		[draft, resolvedCapabilityCatalog.slashCommands],
	);
	const showSlashCommands = slashCommands.length > 0 && draft.startsWith("/") && !draft.includes("\n") && !isDisabled;

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

		if (isCompositionInputEvent(event.nativeEvent)) {
			setIsComposing(true);
			return;
		}

		isComposingRef.current = false;
		setIsComposing(false);
		setSelectedSlashIndex(0);
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
	}

	function selectSlashCommand(command: DesktopSlashCommandSummary): void {
		const invocation = createCapabilityInvocationFromSlashCommand(command);
		if (invocation) {
			setSelectedCapabilityInvocations(upsertCapabilityInvocation(selectedCapabilityInvocations, invocation));
			setDraft("");
			setSelectedSlashIndex(0);
			textareaRef.current?.focus();
			return;
		}

		const nextText = `/${command.name} `;
		setDraft(nextText);
		textareaRef.current?.focus();
	}

	async function prepareAndAppendAttachments(candidates: DesktopPromptAttachmentCandidate[]): Promise<void> {
		if (candidates.length === 0) {
			return;
		}
		const result = await window.desktopAgent.preparePromptAttachments({ candidates });
		setAttachmentErrors(result.errors);
		if (result.attachments.length > 0) {
			setSelectedPromptAttachments([...selectedPromptAttachments, ...result.attachments]);
		}
	}

	async function openPromptAttachments(): Promise<void> {
		if (!activeSessionId) {
			return;
		}
		const result = await window.desktopAgent.openPromptAttachments({ sessionId: activeSessionId });
		setAttachmentErrors(result.errors);
		if (result.attachments.length > 0) {
			setSelectedPromptAttachments([...selectedPromptAttachments, ...result.attachments]);
		}
		textareaRef.current?.focus();
	}

	async function submitComposerText(rawText: string): Promise<void> {
		const text = rawText.trim();
		if (isCompactCommand(text) && onCompact) {
			const customInstructions = getCompactInstructions(text);
			setSelectedCapabilityInvocations([]);
			setSelectedPromptAttachments([]);
			setAttachmentErrors([]);
			setDraft("");
			await onCompact(customInstructions);
			return;
		}
		if (!text && selectedCapabilityInvocations.length === 0 && selectedPromptAttachments.length === 0) {
			return;
		}
		await onSubmitPrompt({
			text,
			...(selectedCapabilityInvocations.length > 0 ? { capabilityInvocations: selectedCapabilityInvocations } : {}),
			...(selectedPromptAttachments.length > 0 ? { attachments: selectedPromptAttachments } : {}),
		});
		setSelectedCapabilityInvocations([]);
		setSelectedPromptAttachments([]);
		setAttachmentErrors([]);
		setDraft("");
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

		if (event.key !== "Enter" || event.shiftKey) {
			if (showSlashCommands && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
				event.preventDefault();
				setSelectedSlashIndex((current) =>
					event.key === "ArrowDown"
						? (current + 1) % slashCommands.length
						: (current - 1 + slashCommands.length) % slashCommands.length,
				);
			}
			return;
		}

		event.preventDefault();
		if (showSlashCommands) {
			const selectedCommand = slashCommands[selectedSlashIndex] ?? slashCommands[0];
			selectSlashCommand(selectedCommand);
			return;
		}
		const nextText = event.currentTarget.value;
		isComposingRef.current = false;
		setIsComposing(false);
		setDraft(nextText);
		void submitComposerText(nextText).catch(() => undefined);
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
			.then(prepareAndAppendAttachments)
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
			.then(prepareAndAppendAttachments)
			.catch((error: unknown) =>
				setAttachmentErrors([
					{ name: "Pasted image", message: error instanceof Error ? error.message : String(error) },
				]),
			);
	}

	return (
		<div className="relative grid min-w-0 flex-1 gap-2">
			<SelectedCapabilityChips
				invocations={selectedCapabilityInvocations}
				onRemove={(invocation) =>
					setSelectedCapabilityInvocations(removeCapabilityInvocation(selectedCapabilityInvocations, invocation))
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
			<textarea
				aria-label="Message Skylark"
				className="min-h-20 flex-1 resize-none border-0 bg-transparent p-0 pr-8 text-sm leading-6 text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:outline-none"
				data-overflow={hasInputOverflow ? "true" : "false"}
				disabled={isDisabled}
				onBlur={handleBlur}
				onChange={handleChange}
				onCompositionEnd={handleCompositionEnd}
				onCompositionStart={handleCompositionStart}
				onDrop={handleDrop}
				onKeyDown={handleKeyDown}
				onPaste={handlePaste}
				placeholder="Message Skylark"
				ref={setComposedRef}
				rows={3}
				value={draft}
			/>
			<AnimatePresence>
				{showSlashCommands ? (
					<SlashCommandPalette
						commands={slashCommands}
						onSelect={selectSlashCommand}
						selectedIndex={selectedSlashIndex}
					/>
				) : null}
			</AnimatePresence>
			<Button
				aria-label="Attach files"
				className="absolute right-0 top-0"
				disabled={isDisabled}
				onClick={() => void openPromptAttachments().catch(() => undefined)}
				size="icon-xs"
				type="button"
				variant="ghost"
			>
				<Paperclip className="size-3.5" />
			</Button>
		</div>
	);
}

function AssistantComposer({
	activeSessionId,
	attachmentErrors,
	availableTools,
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
	const [isComposerComposing, setIsComposerComposing] = useState(false);
	const contextLabel =
		contextWindowUsage?.totalTokens && contextWindowUsage.totalTokens > 0
			? `${Math.round((contextWindowUsage.usedTokens / contextWindowUsage.totalTokens) * 100)}% context`
			: contextWindowUsage
				? `${contextWindowUsage.usedTokens.toLocaleString()} tokens`
				: undefined;
	const consoleState = disabled ? "disabled" : isStreaming ? "running" : "idle";
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

	return (
		<form
			className={cn(
				"grid max-h-[min(540px,66vh)] gap-3 overflow-visible rounded-[var(--radius-xl)] border border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] p-3 shadow-[var(--shadow-middle)] backdrop-blur",
				"transition-[border-color,box-shadow,opacity] duration-[var(--duration-normal)] ease-[var(--ease-standard)]",
				isStreaming &&
					"border-[color:color-mix(in_oklch,var(--info)_22%,var(--border-subtle))] ring-1 ring-[color:color-mix(in_oklch,var(--info)_12%,transparent)]",
				disabled && "opacity-70",
			)}
			data-slot="agent-console"
			data-state={consoleState}
			onMouseDown={handleConsoleMouseDown}
			onSubmit={(event) => event.preventDefault()}
		>
			<div
				className="flex min-h-24 items-start gap-2 overflow-visible rounded-[var(--radius-lg)] border border-[color:var(--border-subtle)] bg-[color:var(--background)] px-3 py-2 transition-[border-color,box-shadow,background-color] duration-[var(--duration-normal)] ease-[var(--ease-standard)] focus-within:border-[color:var(--ring)] focus-within:shadow-[var(--shadow-panel-focused)]"
				data-slot="agent-console-input-surface"
			>
				<AssistantComposerInput
					activeSessionId={activeSessionId}
					attachmentErrors={attachmentErrors}
					capabilityCatalog={capabilityCatalog}
					disabled={disabled}
					draft={composerDraft}
					inputRef={inputRef}
					onCompact={onCompact}
					onRequestCapabilities={onRequestCapabilities}
					onSubmitPrompt={onSubmitPrompt}
					selectedCapabilityInvocations={selectedCapabilityInvocations}
					selectedPromptAttachments={selectedPromptAttachments}
					setAttachmentErrors={setAttachmentErrors}
					setDraft={setComposerDraft}
					setIsComposing={setIsComposerComposing}
					setSelectedCapabilityInvocations={setSelectedCapabilityInvocations}
					setSelectedPromptAttachments={setSelectedPromptAttachments}
				/>
			</div>
			<div className="flex items-center justify-between gap-3" data-slot="agent-console-toolbar">
				<div className="flex min-w-0 items-center gap-1">
					<ComposerQuickControls
						availableTools={availableTools}
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
					{contextLabel ? (
						<span className="ml-1 truncate text-xs text-muted-foreground">{contextLabel}</span>
					) : null}
				</div>
				{isStreaming ? (
					<AssistantCancelRunButton onAbort={onAbort} />
				) : (
					<AssistantSendButton
						attachments={selectedPromptAttachments}
						composerDraft={composerDraft}
						disabled={disabled}
						inputRef={inputRef}
						isComposing={isComposerComposing}
						onCompact={onCompact}
						onSubmitPrompt={onSubmitPrompt}
						setAttachmentErrors={setAttachmentErrors}
						setComposerDraft={setComposerDraft}
						selectedCapabilityInvocations={selectedCapabilityInvocations}
						setSelectedPromptAttachments={setSelectedPromptAttachments}
						setSelectedCapabilityInvocations={setSelectedCapabilityInvocations}
					/>
				)}
			</div>
		</form>
	);
}

function AssistantSendButton({
	attachments,
	composerDraft,
	disabled,
	inputRef,
	isComposing,
	onCompact,
	onSubmitPrompt,
	setAttachmentErrors,
	setComposerDraft,
	selectedCapabilityInvocations,
	setSelectedPromptAttachments,
	setSelectedCapabilityInvocations,
}: {
	attachments: DesktopPreparedPromptAttachment[];
	composerDraft: string;
	disabled: boolean;
	inputRef: Ref<HTMLTextAreaElement>;
	isComposing: boolean;
	onCompact?: (customInstructions?: string) => Promise<void>;
	onSubmitPrompt: (request: DesktopPromptSubmission) => Promise<void>;
	setAttachmentErrors: (errors: DesktopPromptAttachmentError[]) => void;
	setComposerDraft: (draft: string) => void;
	selectedCapabilityInvocations: DesktopPromptCapabilityInvocation[];
	setSelectedPromptAttachments: (attachments: DesktopPreparedPromptAttachment[]) => void;
	setSelectedCapabilityInvocations: (invocations: DesktopPromptCapabilityInvocation[]) => void;
}) {
	const [isSubmitting, setIsSubmitting] = useState(false);
	const currentText = getRefTextareaValue(inputRef) ?? composerDraft;
	const canSubmit =
		!disabled &&
		!isSubmitting &&
		!isComposing &&
		(currentText.trim().length > 0 || selectedCapabilityInvocations.length > 0 || attachments.length > 0);

	async function handleSubmit(): Promise<void> {
		if (!canSubmit) {
			return;
		}
		setIsSubmitting(true);
		try {
			const text = (getRefTextareaValue(inputRef) ?? composerDraft).trim();
			if (isCompactCommand(text) && onCompact) {
				const customInstructions = getCompactInstructions(text);
				setSelectedCapabilityInvocations([]);
				setSelectedPromptAttachments([]);
				setAttachmentErrors([]);
				setComposerDraft("");
				await onCompact(customInstructions);
				return;
			}
			await onSubmitPrompt({
				text,
				...(selectedCapabilityInvocations.length > 0
					? { capabilityInvocations: selectedCapabilityInvocations }
					: {}),
				...(attachments.length > 0 ? { attachments } : {}),
			});
			setSelectedCapabilityInvocations([]);
			setSelectedPromptAttachments([]);
			setAttachmentErrors([]);
			setComposerDraft("");
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<Button
			aria-label="Send message"
			data-slot="agent-console-send-button"
			data-state={canSubmit ? "ready" : "empty"}
			disabled={!canSubmit}
			onClick={() => void handleSubmit().catch(() => undefined)}
			size="icon-sm"
			type="button"
			variant={canSubmit ? "default" : "secondary"}
		>
			<ArrowUp className="size-4" />
		</Button>
	);
}

function AssistantCancelRunButton({ onAbort }: { onAbort: () => Promise<void> }) {
	return (
		<Button
			aria-label="Cancel response"
			className="text-[color:var(--text-primary)] hover:text-[color:var(--destructive)]"
			data-slot="agent-console-stop-button"
			onClick={() => void onAbort().catch(() => undefined)}
			size="icon-sm"
			type="button"
			variant="secondary"
		>
			<Square className="size-3.5" />
		</Button>
	);
}

export function ChatWorkbench({
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
	onOpenSubagent,
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
	const availableTools = useAgentStore((state) => state.availableTools);
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
	const handleOpenSubagentToolCall = useCallback(
		(toolCall: ToolCallActivity): void => {
			const request = resolveSubagentOpenRequest(toolCall, activeAgentSessionId);
			if (!request) {
				return;
			}
			onOpenSubagent?.(request);
		},
		[activeAgentSessionId, onOpenSubagent],
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
												return <UserMessage key={messageKey} message={message} />;
											}
											if (message.role === "assistant") {
												return (
													<AssistantMessage
														key={messageKey}
														message={message}
														onOpenSubagentToolCall={handleOpenSubagentToolCall}
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

					<div
						className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-5 pb-5 md:px-7 md:pb-7"
						data-slot="composer-dock"
						ref={composerDockRef}
					>
						<div className="pointer-events-auto w-full max-w-[880px]">
							<AssistantComposer
								activeSessionId={activeAgentSessionId}
								attachmentErrors={attachmentErrors}
								availableTools={availableTools}
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
