import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import mammoth from "mammoth";
import type {
	DesktopEventAttachment,
	DesktopEventAttachmentDraft,
	DesktopEventAttachmentError,
	DesktopPrepareEventAttachmentsResult,
} from "../../shared/types.ts";

export const MAX_DESKTOP_EVENT_ATTACHMENTS = 10;
export const MAX_DESKTOP_EVENT_ATTACHMENT_BYTES = 128 * 1024 * 1024;
export const MAX_DESKTOP_EVENT_ATTACHMENT_TEXT_CHARS = 400_000;

const SUPPORTED_EVENT_ATTACHMENT_EXTENSIONS = new Set([".txt", ".md", ".docx"]);

function truncateTextSnapshot(value: string): string {
	const normalized = value.replace(/\r\n/g, "\n").trim();
	if (normalized.length <= MAX_DESKTOP_EVENT_ATTACHMENT_TEXT_CHARS) {
		return normalized;
	}
	return normalized.slice(0, MAX_DESKTOP_EVENT_ATTACHMENT_TEXT_CHARS);
}

function getMimeType(path: string): string | undefined {
	switch (extname(path).toLowerCase()) {
		case ".txt":
			return "text/plain";
		case ".md":
			return "text/markdown";
		case ".docx":
			return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
		default:
			return undefined;
	}
}

function getCandidateName(path: string): string {
	return basename(resolve(path));
}

function sanitizeAttachmentFilename(value: string): string {
	const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized || "attachment";
}

function createAttachmentError(path: string, message: string): DesktopEventAttachmentError {
	return {
		name: getCandidateName(path),
		path: resolve(path),
		message,
	};
}

async function extractTextSnapshot(path: string): Promise<string | undefined> {
	const extension = extname(path).toLowerCase();
	if (extension === ".txt" || extension === ".md") {
		const content = await readFile(path, "utf8");
		return truncateTextSnapshot(content);
	}
	if (extension === ".docx") {
		const result = await mammoth.extractRawText({ path });
		return truncateTextSnapshot(result.value);
	}
	return undefined;
}

export async function prepareDesktopEventAttachments(
	candidates: readonly { type: "path"; path: string }[],
	options: {
		createId?: () => string;
		maxAttachments?: number;
		maxAttachmentBytes?: number;
	} = {},
): Promise<DesktopPrepareEventAttachmentsResult> {
	const createId = options.createId ?? randomUUID;
	const maxAttachments = options.maxAttachments ?? MAX_DESKTOP_EVENT_ATTACHMENTS;
	const maxAttachmentBytes = options.maxAttachmentBytes ?? MAX_DESKTOP_EVENT_ATTACHMENT_BYTES;
	const attachments: DesktopEventAttachmentDraft[] = [];
	const errors: DesktopEventAttachmentError[] = [];

	for (const candidate of candidates) {
		const sourcePath = resolve(candidate.path);
		const extension = extname(sourcePath).toLowerCase();
		const mimeType = getMimeType(sourcePath);
		if (!mimeType || !SUPPORTED_EVENT_ATTACHMENT_EXTENSIONS.has(extension)) {
			errors.push(createAttachmentError(sourcePath, "Only .txt, .md, and .docx event attachments are supported."));
			continue;
		}
		if (attachments.length >= maxAttachments) {
			errors.push(
				createAttachmentError(sourcePath, `Only ${maxAttachments} event attachments can be added at once.`),
			);
			continue;
		}

		let fileStat: Awaited<ReturnType<typeof stat>>;
		try {
			fileStat = await stat(sourcePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(createAttachmentError(sourcePath, message));
			continue;
		}
		if (!fileStat.isFile()) {
			errors.push(createAttachmentError(sourcePath, "Event attachments must be files."));
			continue;
		}
		if (fileStat.size > maxAttachmentBytes) {
			errors.push(
				createAttachmentError(sourcePath, `Event attachments must be ${maxAttachmentBytes} bytes or smaller.`),
			);
			continue;
		}

		const draft: DesktopEventAttachmentDraft = {
			id: createId(),
			name: getCandidateName(sourcePath),
			sourcePath,
			mimeType,
			size: fileStat.size,
		};

		try {
			const textSnapshot = await extractTextSnapshot(sourcePath);
			if (textSnapshot) {
				draft.textSnapshot = textSnapshot;
			} else {
				draft.extractionError = "No text could be extracted from this attachment.";
			}
		} catch (error) {
			draft.extractionError = error instanceof Error ? error.message : String(error);
		}

		attachments.push(draft);
	}

	return { attachments, errors };
}

export async function copyDesktopEventAttachments(input: {
	eventId: string;
	attachmentsRootDir: string;
	drafts: readonly DesktopEventAttachmentDraft[];
	now?: string;
}): Promise<DesktopEventAttachment[]> {
	const createdAt = input.now ?? new Date().toISOString();
	const eventAttachmentsDir = join(input.attachmentsRootDir, input.eventId);
	await mkdir(eventAttachmentsDir, { recursive: true });
	const attachments: DesktopEventAttachment[] = [];

	for (const draft of input.drafts) {
		const storedPath = join(eventAttachmentsDir, `${draft.id}-${sanitizeAttachmentFilename(draft.name)}`);
		await copyFile(draft.sourcePath, storedPath);
		attachments.push({
			id: draft.id,
			name: draft.name,
			originalPath: draft.sourcePath,
			storedPath,
			mimeType: draft.mimeType,
			size: draft.size,
			...(draft.textSnapshot ? { textSnapshot: draft.textSnapshot } : {}),
			...(draft.extractionError ? { extractionError: draft.extractionError } : {}),
			createdAt,
		});
	}

	return attachments;
}
