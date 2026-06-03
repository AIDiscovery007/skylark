import { Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorNotice } from "@/components/ui/error-notice";
import { Skeleton } from "@/components/ui/skeleton";
import { softRevealTransition, subtleReveal } from "@/lib/motion";
import type {
	DesktopOAuthProviderStatus,
	DesktopProviderKeyStatus,
	DesktopRuntimeCatalog,
	DesktopSessionProfileUpdateInput,
	DesktopSettingsOpenRequest,
} from "../../../shared/types.ts";
import { useAgentStore } from "../../stores/agent-store.ts";
import { Composer } from "./Composer.tsx";
import { resolveChatShellNoticeState, resolveContextWindowUsage, resolveModelContextWindow } from "./chat-helpers.ts";
import { MessageList } from "./MessageList.tsx";

export { resolveChatShellNoticeState, resolveContextWindowUsage, resolveModelContextWindow } from "./chat-helpers.ts";

const DEFAULT_COMPOSER_INSET_PX = 172;
const COMPOSER_SCROLL_GAP_PX = 24;

interface ChatShellProps {
	onAbort: () => Promise<void>;
	oauthProviders?: DesktopOAuthProviderStatus[];
	onOpenSettings?: (request?: DesktopSettingsOpenRequest) => void;
	onSubmitPrompt: (text: string) => Promise<void>;
	onUpdateSessionProfile?: (update: DesktopSessionProfileUpdateInput) => Promise<void>;
	providerKeys?: DesktopProviderKeyStatus[];
	runtimeCatalog?: DesktopRuntimeCatalog;
	showThinkingBlocks: boolean;
}

export function ChatShell({
	onAbort,
	oauthProviders,
	onOpenSettings,
	onSubmitPrompt,
	onUpdateSessionProfile,
	providerKeys,
	runtimeCatalog,
	showThinkingBlocks,
}: ChatShellProps) {
	const availableTools = useAgentStore((state) => state.availableTools);
	const bridgeError = useAgentStore((state) => state.bridgeError);
	const cwd = useAgentStore((state) => state.cwd);
	const errorMessage = useAgentStore((state) => state.errorMessage);
	const hasHydrated = useAgentStore((state) => state.hasHydrated);
	const isStreaming = useAgentStore((state) => state.isStreaming);
	const messages = useAgentStore((state) => state.messages);
	const model = useAgentStore((state) => state.model);
	const streamingMessage = useAgentStore((state) => state.streamingMessage);
	const thinkingLevel = useAgentStore((state) => state.thinkingLevel);
	const toolCalls = useAgentStore((state) => state.toolCalls);
	const composerRef = useRef<HTMLTextAreaElement | null>(null);
	const composerDockRef = useRef<HTMLDivElement | null>(null);
	const [composerInset, setComposerInset] = useState(DEFAULT_COMPOSER_INSET_PX);
	const hasVisibleMessages =
		messages.some((message) => message.role !== "toolResult") ||
		(streamingMessage !== undefined && streamingMessage.role !== "toolResult");
	const { abortNoticeKey, persistentTopNotice } = resolveChatShellNoticeState({
		bridgeError,
		errorMessage,
		messages,
	});
	const [visibleAbortNoticeKey, setVisibleAbortNoticeKey] = useState<string | undefined>(abortNoticeKey);
	const messageListEmptyState = bridgeError
		? {
				label: "Session unavailable",
				title: "The current transcript could not be loaded.",
				description: "The desktop bridge did not return a usable session snapshot yet.",
				detail: bridgeError,
				tone: "error" as const,
				actionLabel: "Try a new prompt",
			}
		: {
				label: "Skylark",
				title: "Ask from here.",
				description: "The workspace is ready.",
				detail: cwd || "Workspace path will appear here when the session is ready.",
				tone: "idle" as const,
				actionLabel: "Focus composer",
			};
	const showAbortNotice = abortNoticeKey !== undefined && visibleAbortNoticeKey === abortNoticeKey;
	const modelContextWindow = useMemo(
		() => resolveModelContextWindow({ model, runtimeCatalog }),
		[model, runtimeCatalog],
	);
	const contextWindowUsage = useMemo(
		() =>
			resolveContextWindowUsage({
				contextWindow: modelContextWindow,
				messages,
				streamingMessage,
			}),
		[messages, modelContextWindow, streamingMessage],
	);

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
		<div className="relative h-full min-h-0 w-full" data-slot="chat-shell">
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
							className="mx-auto max-w-[960px] backdrop-blur"
							description={persistentTopNotice}
							title="Desktop runtime notice"
						/>
					</motion.div>
				) : null}
			</AnimatePresence>

			<div className="absolute inset-0" data-slot="chat-scroll-stage">
				{hasHydrated ? (
					<MessageList
						bottomInset={composerInset}
						emptyState={!hasVisibleMessages ? messageListEmptyState : undefined}
						isStreaming={isStreaming}
						messages={messages}
						onEmptyAction={() => composerRef.current?.focus()}
						showThinkingBlocks={showThinkingBlocks}
						streamingMessage={streamingMessage}
						toolCalls={toolCalls}
					/>
				) : (
					<Card className="h-full rounded-lg border-transparent bg-transparent py-0 shadow-none">
						<CardContent className="grid min-h-full gap-6 px-6 py-6" style={{ paddingBottom: composerInset }}>
							<div className="space-y-2">
								<Skeleton className="h-4 w-28" />
								<Skeleton className="h-3 w-48" />
							</div>
							<div className="grid gap-4">
								<div className="flex justify-end">
									<Skeleton className="h-16 w-[48%] rounded-lg" />
								</div>
								<div className="space-y-3">
									<Skeleton className="h-4 w-36" />
									<Skeleton className="h-5 w-[90%] rounded-full" />
									<Skeleton className="h-5 w-[78%] rounded-full" />
									<Skeleton className="h-5 w-[84%] rounded-full" />
								</div>
							</div>
						</CardContent>
					</Card>
				)}
			</div>

			<div
				className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-6 pb-5 md:px-9 md:pb-7 xl:px-14"
				data-slot="composer-dock"
				ref={composerDockRef}
			>
				<div className="pointer-events-auto w-full max-w-[960px]">
					<Composer
						ref={composerRef}
						contextWindowUsage={contextWindowUsage}
						disabled={!hasHydrated}
						isStreaming={isStreaming}
						model={model}
						availableTools={availableTools}
						onAbort={onAbort}
						oauthProviders={oauthProviders}
						onOpenSettings={onOpenSettings}
						onSubmitPrompt={onSubmitPrompt}
						onUpdateSessionProfile={onUpdateSessionProfile}
						providerKeys={providerKeys}
						runtimeCatalog={runtimeCatalog}
						thinkingLevel={thinkingLevel}
					/>
				</div>
			</div>
		</div>
	);
}
