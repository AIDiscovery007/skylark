import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
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
const DEFAULT_INLINE_IMAGE_ATTACHMENTS_DIR = join(tmpdir(), "skylark-prompt-attachments");
const IMAGE_MIME_TYPE_EXTENSIONS = new Map([
	["image/gif", ".gif"],
	["image/jpeg", ".jpg"],
	["image/png", ".png"],
	["image/webp", ".webp"],
]);

export interface PrepareDesktopPromptAttachmentsOptions extends ProcessPromptFileInputsOptions {
	createId?: () => string;
	inlineImageAttachmentsDir?: string;
	maxAttachments?: number;
	maxTotalTextChars?: number;
}

function getCandidateName(candidate: DesktopPromptAttachmentCandidate): string {
	return candidate.type === "path" ? basename(resolve(candidate.path)) : candidate.name;
}

function getCandidatePath(candidate: DesktopPromptAttachmentCandidate): string | undefined {
	return candidate.type === "path" ? resolve(candidate.path) : undefined;
}

function sanitizeAttachmentFilename(value: string): string {
	const sanitized = basename(value)
		.replace(/[\u0000-\u001f\u007f]/g, "")
		.replace(/[/:\\]/g, "-")
		.trim();
	return sanitized || "pasted-image";
}

function ensureImageFilenameExtension(name: string, mimeType: string): string {
	if (extname(name)) {
		return name;
	}
	return `${name}${IMAGE_MIME_TYPE_EXTENSIONS.get(mimeType) ?? ".img"}`;
}

async function persistInlineImageCandidate(
	candidate: Extract<DesktopPromptAttachmentCandidate, { type: "inline_image" }>,
	input: {
		attachmentId: string;
		inlineImageAttachmentsDir: string;
	},
): Promise<PromptFileInput> {
	const safeName = ensureImageFilenameExtension(sanitizeAttachmentFilename(candidate.name), candidate.mimeType);
	const attachmentDir = join(input.inlineImageAttachmentsDir, input.attachmentId);
	const attachmentPath = join(attachmentDir, safeName);
	await mkdir(attachmentDir, { recursive: true });
	await writeFile(attachmentPath, Buffer.from(candidate.data, "base64"));
	return {
		type: "inline_image",
		name: safeName,
		mimeType: candidate.mimeType,
		data: candidate.data,
		size: candidate.size,
		path: attachmentPath,
	};
}

async function toPromptFileInput(
	candidate: DesktopPromptAttachmentCandidate,
	input: {
		attachmentId: string;
		inlineImageAttachmentsDir: string;
	},
): Promise<PromptFileInput> {
	if (candidate.type === "inline_image") {
		return persistInlineImageCandidate(candidate, input);
	}
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
	const inlineImageAttachmentsDir = options.inlineImageAttachmentsDir ?? DEFAULT_INLINE_IMAGE_ATTACHMENTS_DIR;
	const attachments: DesktopPreparedPromptAttachment[] = [];
	const errors: DesktopPromptAttachmentError[] = [];
	let totalPromptTextChars = 0;

	for (const candidate of candidates) {
		if (attachments.length >= maxAttachments) {
			errors.push(createAttachmentLimitError(candidate, maxAttachments));
			continue;
		}

		const attachmentId = createId();
		const result = await processPromptFileInputs(
			[await toPromptFileInput(candidate, { attachmentId, inlineImageAttachmentsDir })],
			{ maxTextFileBytes },
		);
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
			id: attachmentId,
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
