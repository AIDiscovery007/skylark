import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { forwardRef, useState } from "react";
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
import {
	SkylarkContextWindowControl,
	SkylarkPromptInputAttachmentButton,
	SkylarkPromptInputComposer,
} from "./SkylarkPromptInputComposer.tsx";

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
		<SkylarkPromptInputComposer
			canSubmit={!disabled && !isSubmitting && text.trim().length > 0}
			consoleState={disabled ? "disabled" : isStreaming ? "running" : "idle"}
			disabled={disabled || isSubmitting}
			footerLeft={
				<>
					<SkylarkPromptInputAttachmentButton disabled={disabled || isStreaming} onClick={() => undefined} />
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
					<SkylarkContextWindowControl usage={contextWindowUsage} />
				</>
			}
			isStreaming={isStreaming}
			onStop={handleAbort}
			onSubmit={handleSubmit}
			textareaProps={{
				ref,
				name: "prompt",
				onChange: (event) => setText(event.target.value),
				onKeyDown: (event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						void handleSubmit();
					}
				},
				placeholder: "Ask about this workspace",
				rows: Math.min(5, Math.max(2, text.split("\n").length)),
				value: text,
			}}
		/>
	);
});
