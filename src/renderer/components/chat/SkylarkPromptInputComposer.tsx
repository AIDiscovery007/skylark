import { Plus } from "lucide-react";
import type { ComponentProps, MouseEventHandler, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";
import { Context, ContextContent, ContextContentHeader, ContextTrigger } from "../ai-elements/context.tsx";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputHeader,
	type PromptInputMessage,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "../ai-elements/prompt-input.tsx";
import type { ContextWindowUsage } from "./chat-helpers.ts";

type PromptInputTextareaProps = ComponentProps<typeof PromptInputTextarea>;

interface SkylarkPromptInputComposerProps {
	canSubmit: boolean;
	body?: ReactNode;
	children?: ReactNode;
	consoleState?: "disabled" | "idle" | "running";
	disabled?: boolean;
	footerLeft?: ReactNode;
	header?: ReactNode;
	inputGroupClassName?: string;
	inputGroupProps?: ComponentProps<"div">;
	isStreaming?: boolean;
	onMouseDown?: MouseEventHandler<HTMLFormElement>;
	onStop?: () => Promise<void> | void;
	onSubmit: () => Promise<void> | void;
	submitAriaLabel?: string;
	textareaProps?: PromptInputTextareaProps & TextareaHTMLAttributes<HTMLTextAreaElement>;
}

export function SkylarkPromptInputComposer({
	body,
	canSubmit,
	children,
	consoleState = "idle",
	disabled,
	footerLeft,
	header,
	inputGroupClassName,
	inputGroupProps,
	isStreaming = false,
	onMouseDown,
	onStop,
	onSubmit,
	submitAriaLabel = "Send message",
	textareaProps,
}: SkylarkPromptInputComposerProps) {
	const chatStatus = isStreaming ? "streaming" : undefined;
	const submitSafely = async (): Promise<void> => {
		try {
			await onSubmit();
		} catch {
			return;
		}
	};

	return (
		<div
			className={cn("relative grid max-h-[min(540px,66vh)] overflow-visible", disabled && "opacity-70")}
			data-slot="agent-console"
			data-state={consoleState}
		>
			{children}
			<PromptInput
				className="contents"
				inputGroupClassName={cn(
					"min-h-24 overflow-visible rounded-[var(--radius-xl)] border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] shadow-[var(--shadow-middle)] backdrop-blur",
					"transition-[border-color,box-shadow,opacity] duration-[var(--duration-normal)] ease-[var(--ease-standard)]",
					isStreaming &&
						"border-[color:color-mix(in_oklch,var(--info)_22%,var(--border-subtle))] ring-1 ring-[color:color-mix(in_oklch,var(--info)_12%,transparent)]",
					inputGroupClassName,
				)}
				inputGroupDataSlot="agent-console-input-surface"
				inputGroupProps={inputGroupProps}
				onMouseDown={onMouseDown}
				onSubmit={async (_message: PromptInputMessage) => {
					await submitSafely();
				}}
			>
				{header ? <PromptInputHeader className="px-3 pt-3 pb-0">{header}</PromptInputHeader> : null}
				<PromptInputBody>
					{body ??
						(textareaProps ? (
							<PromptInputTextarea
								{...textareaProps}
								className={cn(
									"min-h-20 border-0 bg-transparent px-3 py-3 text-sm leading-6 shadow-none outline-none focus-visible:ring-0",
									textareaProps.className,
								)}
								disabled={disabled || textareaProps.disabled}
							/>
						) : null)}
				</PromptInputBody>
				<PromptInputFooter className="flex-wrap px-3 pt-1.5 pb-3" data-slot="agent-console-toolbar">
					<PromptInputTools>{footerLeft}</PromptInputTools>
					<PromptInputSubmit
						aria-label={isStreaming ? "Cancel response" : submitAriaLabel}
						data-slot={isStreaming ? "agent-console-stop-button" : "agent-console-send-button"}
						data-state={canSubmit ? "ready" : "empty"}
						disabled={isStreaming ? false : !canSubmit}
						onStop={() => void onStop?.()}
						size="icon-sm"
						status={chatStatus}
						type="button"
						variant={canSubmit || isStreaming ? "default" : "secondary"}
						onClick={(event) => {
							if (isStreaming) {
								return;
							}
							event.preventDefault();
							void submitSafely();
						}}
					/>
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}

export function SkylarkPromptInputAttachmentButton({
	disabled,
	onClick,
}: {
	disabled?: boolean;
	onClick: () => Promise<void> | void;
}) {
	return (
		<PromptInputButton
			aria-label="Attach files"
			disabled={disabled}
			onClick={() => void onClick()}
			size="icon-sm"
			type="button"
			variant="ghost"
		>
			<Plus className="size-4" />
		</PromptInputButton>
	);
}

function getContextWindowPercent(usage: ContextWindowUsage): number | undefined {
	if (!usage.totalTokens || usage.totalTokens <= 0) {
		return undefined;
	}

	return Math.min(100, Math.max(0, Math.round((usage.usedTokens / usage.totalTokens) * 100)));
}

export function SkylarkContextWindowControl({ usage }: { usage?: ContextWindowUsage }) {
	const percent = usage ? getContextWindowPercent(usage) : undefined;
	if (!usage || !usage.totalTokens || usage.totalTokens <= 0 || percent === undefined) {
		return null;
	}

	return (
		<Context maxTokens={usage.totalTokens} usedTokens={usage.usedTokens}>
			<ContextTrigger
				aria-label={`Context window ${percent}% used`}
				className="h-8 gap-1.5 rounded-[var(--radius-md)] px-2 text-[12px] text-[color:var(--text-tertiary)] shadow-none hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)]"
			/>
			<ContextContent align="start" className="shadow-[var(--uix-flat-shadow-floating)]">
				<ContextContentHeader />
				<div className="px-3 py-2 text-[12px] leading-4 text-[color:var(--text-tertiary)]">
					{usage.usedTokens.toLocaleString()} used of {usage.totalTokens.toLocaleString()} tokens.
				</div>
			</ContextContent>
		</Context>
	);
}
