import { access, open, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";

export type PromptFileInput =
	| { type: "path"; path: string }
	| { type: "inline_image"; name: string; mimeType: string; data: string; size?: number };

export type PromptFileAttachmentKind = "text" | "image";

export interface PromptFileAttachment {
	kind: PromptFileAttachmentKind;
	name: string;
	path?: string;
	mimeType: string;
	size: number;
}

export interface PromptFileError {
	name: string;
	path?: string;
	message: string;
}

export interface ProcessPromptFileInputsResult {
	text: string;
	images: ImageContent[];
	attachments: PromptFileAttachment[];
	errors: PromptFileError[];
}

export interface ProcessPromptFileInputsOptions {
	maxTextFileBytes?: number;
}

const IMAGE_TYPE_SNIFF_BYTES = 4100;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TEXT_MIME_TYPES = new Map<string, string>([
	[".md", "text/markdown"],
	[".txt", "text/plain"],
]);
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function getTextMimeType(path: string): string {
	return TEXT_MIME_TYPES.get(extname(path).toLowerCase()) ?? "text/plain";
}

function readUint32BE(buffer: Uint8Array, offset: number): number {
	return (
		(buffer[offset] ?? 0) * 0x1000000 +
		((buffer[offset + 1] ?? 0) << 16) +
		((buffer[offset + 2] ?? 0) << 8) +
		(buffer[offset + 3] ?? 0)
	);
}

function startsWith(buffer: Uint8Array, bytes: number[]): boolean {
	if (buffer.length < bytes.length) return false;
	return bytes.every((byte, index) => buffer[index] === byte);
}

function startsWithAscii(buffer: Uint8Array, offset: number, text: string): boolean {
	if (buffer.length < offset + text.length) return false;
	for (let index = 0; index < text.length; index++) {
		if (buffer[offset + index] !== text.charCodeAt(index)) return false;
	}
	return true;
}

function isPng(buffer: Uint8Array): boolean {
	return (
		buffer.length >= 16 && readUint32BE(buffer, PNG_SIGNATURE.length) === 13 && startsWithAscii(buffer, 12, "IHDR")
	);
}

function isAnimatedPng(buffer: Uint8Array): boolean {
	let offset = PNG_SIGNATURE.length;
	while (offset + 8 <= buffer.length) {
		const chunkLength = readUint32BE(buffer, offset);
		const chunkTypeOffset = offset + 4;
		if (startsWithAscii(buffer, chunkTypeOffset, "acTL")) return true;
		if (startsWithAscii(buffer, chunkTypeOffset, "IDAT")) return false;

		const nextOffset = offset + 8 + chunkLength + 4;
		if (nextOffset <= offset || nextOffset > buffer.length) return false;
		offset = nextOffset;
	}
	return false;
}

function detectSupportedImageMimeType(buffer: Uint8Array): string | null {
	if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
		return buffer[3] === 0xf7 ? null : "image/jpeg";
	}
	if (startsWith(buffer, PNG_SIGNATURE)) {
		return isPng(buffer) && !isAnimatedPng(buffer) ? "image/png" : null;
	}
	if (startsWithAscii(buffer, 0, "GIF")) {
		return "image/gif";
	}
	if (startsWithAscii(buffer, 0, "RIFF") && startsWithAscii(buffer, 8, "WEBP")) {
		return "image/webp";
	}
	return null;
}

async function detectSupportedImageMimeTypeFromFile(filePath: string): Promise<string | null> {
	const fileHandle = await open(filePath, "r");
	try {
		const buffer = Buffer.alloc(IMAGE_TYPE_SNIFF_BYTES);
		const { bytesRead } = await fileHandle.read(buffer, 0, IMAGE_TYPE_SNIFF_BYTES, 0);
		return detectSupportedImageMimeType(buffer.subarray(0, bytesRead));
	} finally {
		await fileHandle.close();
	}
}

async function appendImageAttachment(
	input: {
		name: string;
		mimeType: string;
		data: string;
		size: number;
		path?: string;
	},
	output: Pick<ProcessPromptFileInputsResult, "attachments" | "errors" | "images"> & { text: string },
): Promise<string> {
	const resized = await resizeImage(Buffer.from(input.data, "base64"), input.mimeType);
	if (!resized) {
		output.errors.push({
			name: input.name,
			...(input.path ? { path: input.path } : {}),
			message: "Image could not be resized below the inline image size limit.",
		});
		return output.text;
	}
	const image: ImageContent = {
		type: "image",
		mimeType: resized.mimeType,
		data: resized.data,
	};
	output.images.push(image);
	output.attachments.push({
		kind: "image",
		name: input.name,
		...(input.path ? { path: input.path } : {}),
		mimeType: resized.mimeType,
		size: input.size,
	});
	return `${output.text}<file name="${input.path ?? input.name}">${formatDimensionNote(resized) ?? ""}</file>\n`;
}

export async function processPromptFileInputs(
	inputs: readonly PromptFileInput[],
	options: ProcessPromptFileInputsOptions = {},
): Promise<ProcessPromptFileInputsResult> {
	let text = "";
	const images: ImageContent[] = [];
	const attachments: PromptFileAttachment[] = [];
	const errors: PromptFileError[] = [];

	for (const input of inputs) {
		if (input.type === "inline_image") {
			if (!IMAGE_MIME_TYPES.has(input.mimeType)) {
				errors.push({
					name: input.name,
					message: `Unsupported image mime type: ${input.mimeType}`,
				});
				continue;
			}
			text = await appendImageAttachment(
				{
					name: input.name,
					mimeType: input.mimeType,
					data: input.data,
					size: input.size ?? Buffer.byteLength(input.data, "base64"),
				},
				{ attachments, errors, images, text },
			);
			continue;
		}

		const absolutePath = resolve(input.path);
		const name = basename(absolutePath);
		try {
			await access(absolutePath);
			const fileStat = await stat(absolutePath);
			const imageMimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);
			if (imageMimeType) {
				const content = await readFile(absolutePath);
				text = await appendImageAttachment(
					{
						name,
						path: absolutePath,
						mimeType: imageMimeType,
						data: content.toString("base64"),
						size: fileStat.size,
					},
					{ attachments, errors, images, text },
				);
				continue;
			}
			if (options.maxTextFileBytes !== undefined && fileStat.size > options.maxTextFileBytes) {
				errors.push({
					name,
					path: absolutePath,
					message: `Text file exceeds the ${options.maxTextFileBytes} byte prompt attachment limit.`,
				});
				continue;
			}
			const content = await readFile(absolutePath, "utf8");
			text += `<file name="${absolutePath}">\n${content}\n</file>\n`;
			attachments.push({
				kind: "text",
				name,
				path: absolutePath,
				mimeType: getTextMimeType(absolutePath),
				size: fileStat.size,
			});
		} catch (error) {
			errors.push({
				name,
				path: absolutePath,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { text, images, attachments, errors };
}
