import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import type {
	DesktopPreparedPromptAttachment,
	DesktopPreparePromptAttachmentsResult,
	DesktopPromptAttachmentCandidate,
	DesktopPromptAttachmentError,
} from "../../shared/types.ts";
import {
	type ProcessPromptFileInputsOptions,
	type PromptFileInput,
	processPromptFileInputs,
} from "./prompt-file-processor.ts";

export const MAX_DESKTOP_PROMPT_ATTACHMENTS = 10;
export const MAX_DESKTOP_PROMPT_TEXT_FILE_BYTES = 256 * 1024;
export const MAX_DESKTOP_PROMPT_ATTACHMENT_TEXT_CHARS = 400_000;

export interface PrepareDesktopPromptAttachmentsOptions extends ProcessPromptFileInputsOptions {
	createId?: () => string;
	maxAttachments?: number;
	maxTotalTextChars?: number;
}

function getCandidateName(candidate: DesktopPromptAttachmentCandidate): string {
	return candidate.type === "path" ? basename(resolve(candidate.path)) : candidate.name;
}

function getCandidatePath(candidate: DesktopPromptAttachmentCandidate): string | undefined {
	return candidate.type === "path" ? resolve(candidate.path) : undefined;
}

function toPromptFileInput(candidate: DesktopPromptAttachmentCandidate): PromptFileInput {
	return candidate;
}

function createAttachmentLimitError(
	candidate: DesktopPromptAttachmentCandidate,
	maxAttachments: number,
): DesktopPromptAttachmentError {
	return {
		name: getCandidateName(candidate),
		...(getCandidatePath(candidate) ? { path: getCandidatePath(candidate) } : {}),
		message: `Only ${maxAttachments} prompt attachments can be added at once.`,
	};
}

export async function prepareDesktopPromptAttachments(
	candidates: readonly DesktopPromptAttachmentCandidate[],
	options: PrepareDesktopPromptAttachmentsOptions = {},
): Promise<DesktopPreparePromptAttachmentsResult> {
	const createId = options.createId ?? randomUUID;
	const maxAttachments = options.maxAttachments ?? MAX_DESKTOP_PROMPT_ATTACHMENTS;
	const maxTextFileBytes = options.maxTextFileBytes ?? MAX_DESKTOP_PROMPT_TEXT_FILE_BYTES;
	const maxTotalTextChars = options.maxTotalTextChars ?? MAX_DESKTOP_PROMPT_ATTACHMENT_TEXT_CHARS;
	const attachments: DesktopPreparedPromptAttachment[] = [];
	const errors: DesktopPromptAttachmentError[] = [];
	let totalPromptTextChars = 0;

	for (const candidate of candidates) {
		if (attachments.length >= maxAttachments) {
			errors.push(createAttachmentLimitError(candidate, maxAttachments));
			continue;
		}

		const result = await processPromptFileInputs([toPromptFileInput(candidate)], { maxTextFileBytes });
		errors.push(...result.errors);
		const attachment = result.attachments[0];
		if (!attachment) {
			continue;
		}
		if (totalPromptTextChars + result.text.length > maxTotalTextChars) {
			errors.push({
				name: attachment.name,
				...(attachment.path ? { path: attachment.path } : {}),
				message: `Prompt attachments exceed the ${maxTotalTextChars} character prompt text limit.`,
			});
			continue;
		}
		totalPromptTextChars += result.text.length;
		attachments.push({
			id: createId(),
			kind: attachment.kind,
			name: attachment.name,
			...(attachment.path ? { path: attachment.path } : {}),
			mimeType: attachment.mimeType,
			size: attachment.size,
			promptText: result.text,
			images: result.images,
		});
	}

	return { attachments, errors };
}
