import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { ArrowUp, type LucideIcon, Paperclip, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { microSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { DesktopAgentModel } from "../../../shared/serialized-agent-event.ts";
import type {
	DesktopOAuthProviderStatus,
	DesktopProviderKeyStatus,
	DesktopRuntimeCatalog,
	DesktopSessionProfileUpdateInput,
	DesktopSettingsOpenRequest,
} from "../../../shared/types.ts";
import { ComposerQuickControls } from "./ComposerQuickControls.tsx";
import type { ContextWindowUsage } from "./chat-helpers.ts";

interface ComposerProps {
	onAbort: () => Promise<void>;
	onSubmitPrompt: (text: string) => Promise<void>;
	contextWindowUsage?: ContextWindowUsage;
	disabled?: boolean;
	isStreaming: boolean;
	model?: DesktopAgentModel;
	oauthProviders?: DesktopOAuthProviderStatus[];
	onOpenSettings?: (request?: DesktopSettingsOpenRequest) => void;
	onUpdateSessionProfile?: (update: DesktopSessionProfileUpdateInput) => Promise<void>;
	providerKeys?: DesktopProviderKeyStatus[];
	runtimeCatalog?: DesktopRuntimeCatalog;
	thinkingLevel?: ThinkingLevel;
}

interface SubmitComposerPromptOptions {
	text: string;
	onSubmitPrompt: (text: string) => Promise<void>;
	clearDraft: () => void;
	restoreDraft: (text: string) => void;
	setSubmitting: (isSubmitting: boolean) => void;
}

export async function submitComposerPrompt({
	text,
	onSubmitPrompt,
	clearDraft,
	restoreDraft,
	setSubmitting,
}: SubmitComposerPromptOptions): Promise<void> {
	const trimmed = text.trim();
	if (!trimmed) {
		return;
	}

	setSubmitting(true);
	clearDraft();

	try {
		await onSubmitPrompt(trimmed);
	} catch (error) {
		restoreDraft(text);
		throw error;
	} finally {
		setSubmitting(false);
	}
}

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
	{
		onAbort,
		onSubmitPrompt,
		contextWindowUsage,
		disabled = false,
		isStreaming,
		model,
		oauthProviders,
		onOpenSettings,
		onUpdateSessionProfile,
		providerKeys,
		runtimeCatalog,
		thinkingLevel = "off",
	},
	ref,
) {
	const [text, setText] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isAborting, setIsAborting] = useState(false);

	const handleSubmit = async () => {
		if (disabled || isSubmitting) {
			return;
		}

		await submitComposerPrompt({
			text,
			onSubmitPrompt,
			clearDraft: () => setText(""),
			restoreDraft: (draft) => setText((current) => (current.length === 0 ? draft : current)),
			setSubmitting: setIsSubmitting,
		});
	};

	const handleAbort = async () => {
		if (!isStreaming || isAborting) {
			return;
		}

		setIsAborting(true);
		try {
			await onAbort();
		} finally {
			setIsAborting(false);
		}
	};

	return (
		<Card
			className={cn(
				"workbench-panel shrink-0 rounded-2xl border-border/80 py-0 shadow-none transition-[border-color,box-shadow] duration-[var(--duration-normal)] ease-[var(--ease-standard)] focus-within:border-ring/35 focus-within:shadow-[0_18px_50px_-42px_rgba(15,23,42,0.45)]",
				isStreaming &&
					"border-[color:var(--color-tool-running-surface)] shadow-[0_18px_50px_-44px_rgba(37,99,235,0.24)]",
			)}
		>
			<CardContent className="space-y-2 px-3 py-3">
				<div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
					<ComposerIconButton disabled={disabled || isStreaming} icon={Paperclip} label="Attachments" />
					<Textarea
						ref={ref}
						className="max-h-36 min-h-[46px] resize-none rounded-md border-transparent bg-transparent px-1 py-2 text-[13px] leading-6 shadow-none focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0 md:text-[13px]"
						disabled={disabled || isSubmitting}
						name="prompt"
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void handleSubmit();
							}
						}}
						placeholder="Ask about this workspace"
						rows={Math.min(5, Math.max(2, text.split("\n").length))}
						value={text}
					/>
					<Button
						aria-label={isStreaming ? (isAborting ? "Stopping run" : "Stop run") : "Send message"}
						className="size-11 rounded-full"
						disabled={isStreaming ? isAborting : disabled || isSubmitting || text.trim().length === 0}
						onClick={() => {
							if (isStreaming) {
								void handleAbort();
								return;
							}

							void handleSubmit();
						}}
						size="icon-lg"
						type="button"
					>
						<AnimatePresence initial={false} mode="wait">
							<motion.span
								animate={{ opacity: 1, scale: 1 }}
								className="grid place-items-center"
								exit={{ opacity: 0, scale: 0.88 }}
								initial={{ opacity: 0, scale: 0.88 }}
								key={isStreaming ? "stop" : "send"}
								transition={microSpring}
							>
								{isStreaming ? (
									<Square className={isAborting ? "size-4 animate-pulse" : "size-4"} />
								) : (
									<ArrowUp className="size-4" />
								)}
							</motion.span>
						</AnimatePresence>
					</Button>
				</div>
				<div className="flex items-center gap-3.5 pl-11 pr-12">
					{contextWindowUsage ? <ContextWindowStatus usage={contextWindowUsage} /> : null}
					<ComposerQuickControls
						disabled={disabled}
						isStreaming={isStreaming}
						model={model}
						oauthProviders={oauthProviders}
						onOpenSettings={onOpenSettings}
						onUpdateSessionProfile={onUpdateSessionProfile}
						providerKeys={providerKeys}
						runtimeCatalog={runtimeCatalog}
						thinkingLevel={thinkingLevel}
					/>
				</div>
			</CardContent>
		</Card>
	);
});

function ComposerIconButton({ disabled, icon: Icon, label }: { disabled?: boolean; icon: LucideIcon; label: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={label}
					className="rounded-full"
					disabled={disabled}
					size="icon"
					type="button"
					variant="ghost"
				>
					<Icon className="size-4" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

function formatCompactTokenCount(tokens: number): string {
	if (!Number.isFinite(tokens) || tokens <= 0) {
		return "0";
	}

	if (tokens >= 1000) {
		return `${Math.round(tokens / 1000)}k`;
	}

	return String(Math.round(tokens));
}

function getContextWindowPercent(usage: ContextWindowUsage): number | undefined {
	if (!usage.totalTokens || usage.totalTokens <= 0) {
		return undefined;
	}

	return Math.min(100, Math.max(0, Math.round((usage.usedTokens / usage.totalTokens) * 100)));
}

function ContextWindowStatus({ usage }: { usage: ContextWindowUsage }) {
	const tooltipId = useId();
	const percent = getContextWindowPercent(usage);
	const progress = percent ?? 0;
	const usedLabel = formatCompactTokenCount(usage.usedTokens);
	const totalLabel = usage.totalTokens ? formatCompactTokenCount(usage.totalTokens) : undefined;
	const percentLabel = percent === undefined ? "未知" : `${percent}%`;
	const ariaLabel =
		percent === undefined ? `Context window ${usedLabel} tokens used` : `Context window ${percentLabel} used`;

	return (
		<div className="group relative inline-flex">
			<button
				aria-describedby={tooltipId}
				aria-label={ariaLabel}
				className="inline-flex h-7 w-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2"
				data-slot="composer-status-icon"
				type="button"
			>
				<span
					aria-hidden="true"
					className="grid size-4 place-items-center rounded-full"
					data-slot="context-window-progress"
					style={{
						background: `conic-gradient(currentColor ${progress}%, var(--color-muted) 0)`,
					}}
				>
					<span className="size-2.5 rounded-full bg-background" />
				</span>
			</button>
			<div
				className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2.5 hidden w-[13.5rem] -translate-x-1/2 rounded-xl border border-border/80 bg-background px-3.5 py-2.5 text-center text-foreground shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] group-hover:block group-focus-within:block"
				id={tooltipId}
				role="tooltip"
			>
				<div className="space-y-1">
					<p className="text-[13px] font-medium leading-4 text-muted-foreground">背景信息窗口：</p>
					{percent === undefined ? (
						<p className="text-[13px] font-medium leading-4 text-foreground">已用 {usedLabel} 标记</p>
					) : (
						<>
							<p className="font-mono text-[12px] font-semibold leading-5 text-muted-foreground">
								{percentLabel} 已用
							</p>
							<p className="text-[13px] font-medium leading-4 text-foreground">
								已用 {usedLabel} 标记，共 {totalLabel}
							</p>
						</>
					)}
				</div>
				<span className="absolute -bottom-[6px] left-1/2 size-3 -translate-x-1/2 rotate-45 border-b border-r border-border/80 bg-background" />
			</div>
		</div>
	);
}
