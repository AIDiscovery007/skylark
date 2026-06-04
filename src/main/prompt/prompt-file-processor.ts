import { access, open, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";
import mammoth from "mammoth";
import xlsx, { type WorkSheet } from "xlsx";

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
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_STRUCTURED_PROMPT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_SPREADSHEET_SHEETS = 5;
const MAX_SPREADSHEET_ROWS_PER_SHEET = 200;
const MAX_SPREADSHEET_COLUMNS = 50;
const UNSUPPORTED_BINARY_PROMPT_ATTACHMENT_MESSAGE =
	"Unsupported binary prompt attachment. Supported prompt attachments are text files, images, .docx, and .xlsx.";
const TEXT_MIME_TYPES = new Map<string, string>([
	[".bash", "text/x-shellscript"],
	[".c", "text/x-c"],
	[".cpp", "text/x-c++"],
	[".cs", "text/x-csharp"],
	[".css", "text/css"],
	[".csv", "text/csv"],
	[".env", "text/plain"],
	[".fish", "text/x-shellscript"],
	[".go", "text/x-go"],
	[".h", "text/x-c"],
	[".hpp", "text/x-c++"],
	[".htm", "text/html"],
	[".html", "text/html"],
	[".ini", "text/plain"],
	[".java", "text/x-java-source"],
	[".js", "text/javascript"],
	[".json", "application/json"],
	[".jsonl", "application/jsonl"],
	[".jsx", "text/jsx"],
	[".kt", "text/x-kotlin"],
	[".log", "text/plain"],
	[".md", "text/markdown"],
	[".markdown", "text/markdown"],
	[".mjs", "text/javascript"],
	[".php", "text/x-php"],
	[".py", "text/x-python"],
	[".rb", "text/x-ruby"],
	[".rs", "text/x-rust"],
	[".sh", "text/x-shellscript"],
	[".sql", "application/sql"],
	[".swift", "text/x-swift"],
	[".toml", "application/toml"],
	[".ts", "text/typescript"],
	[".tsv", "text/tab-separated-values"],
	[".tsx", "text/tsx"],
	[".txt", "text/plain"],
	[".xml", "application/xml"],
	[".yaml", "application/yaml"],
	[".yml", "application/yaml"],
	[".zsh", "text/x-shellscript"],
]);
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function getTextMimeType(path: string): string {
	return TEXT_MIME_TYPES.get(extname(path).toLowerCase()) ?? "text/plain";
}

function getStructuredMimeType(path: string): string | undefined {
	switch (extname(path).toLowerCase()) {
		case ".docx":
			return DOCX_MIME_TYPE;
		case ".xlsx":
			return XLSX_MIME_TYPE;
		default:
			return undefined;
	}
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

function isAllowedTextControlCode(code: number): boolean {
	return code === 0x09 || code === 0x0a || code === 0x0d;
}

function isLikelyTextBuffer(buffer: Buffer): boolean {
	if (buffer.length === 0) {
		return true;
	}
	if (buffer.includes(0)) {
		return false;
	}

	const text = buffer.toString("utf8");
	if (text.includes("\uFFFD")) {
		return false;
	}

	let disallowedControlCount = 0;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code < 0x20 && !isAllowedTextControlCode(code)) {
			disallowedControlCount++;
		}
	}

	return disallowedControlCount / text.length < 0.01;
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

function appendTextAttachment(
	input: {
		name: string;
		path: string;
		mimeType: string;
		size: number;
		content: string;
	},
	output: Pick<ProcessPromptFileInputsResult, "attachments"> & { text: string },
): string {
	output.attachments.push({
		kind: "text",
		name: input.name,
		path: input.path,
		mimeType: input.mimeType,
		size: input.size,
	});
	return `${output.text}<file name="${input.path}">\n${input.content}\n</file>\n`;
}

function formatSpreadsheetCell(value: unknown): string {
	const text = value == null ? "" : String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!/[",\n]/.test(text)) {
		return text;
	}
	return `"${text.replaceAll('"', '""')}"`;
}

function formatSpreadsheetSheet(name: string, worksheet: WorkSheet): string {
	const rows = xlsx.utils.sheet_to_json(worksheet, {
		header: 1,
		blankrows: false,
		defval: "",
		raw: false,
	}) as unknown[][];
	const widestRow = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
	const visibleRows = rows.slice(0, MAX_SPREADSHEET_ROWS_PER_SHEET);
	const visibleColumnCount = Math.min(widestRow, MAX_SPREADSHEET_COLUMNS);
	const lines = [`## Sheet: ${name}`];

	if (rows.length === 0 || visibleColumnCount === 0) {
		lines.push("(empty sheet)");
		return lines.join("\n");
	}

	if (rows.length > visibleRows.length) {
		lines.push(`(${rows.length - visibleRows.length} more rows not shown)`);
	}
	if (widestRow > visibleColumnCount) {
		lines.push(`(${widestRow - visibleColumnCount} more columns not shown)`);
	}

	lines.push("```csv");
	for (const row of visibleRows) {
		const cells = Array.from({ length: visibleColumnCount }, (_, index) => formatSpreadsheetCell(row[index]));
		lines.push(cells.join(","));
	}
	lines.push("```");
	return lines.join("\n");
}

async function extractStructuredPromptText(path: string, name: string): Promise<string> {
	switch (extname(path).toLowerCase()) {
		case ".docx": {
			const result = await mammoth.extractRawText({ path });
			const content = result.value.trim();
			return `# Document: ${name}\n\n${content || "(no text could be extracted)"}`;
		}
		case ".xlsx": {
			const workbook = xlsx.readFile(path, { cellDates: true });
			const visibleSheetNames = workbook.SheetNames.slice(0, MAX_SPREADSHEET_SHEETS);
			const sections = [`# Spreadsheet: ${name}`];
			for (const sheetName of visibleSheetNames) {
				const worksheet = workbook.Sheets[sheetName];
				if (worksheet) {
					sections.push(formatSpreadsheetSheet(sheetName, worksheet));
				}
			}
			if (workbook.SheetNames.length > visibleSheetNames.length) {
				sections.push(`(${workbook.SheetNames.length - visibleSheetNames.length} more sheets not shown)`);
			}
			return sections.join("\n\n");
		}
		default:
			throw new Error("Unsupported structured prompt attachment.");
	}
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
			const structuredMimeType = getStructuredMimeType(absolutePath);
			if (structuredMimeType) {
				if (fileStat.size > MAX_STRUCTURED_PROMPT_ATTACHMENT_BYTES) {
					errors.push({
						name,
						path: absolutePath,
						message: `Structured file exceeds the ${MAX_STRUCTURED_PROMPT_ATTACHMENT_BYTES} byte prompt attachment limit.`,
					});
					continue;
				}
				const content = await extractStructuredPromptText(absolutePath, name);
				text = appendTextAttachment(
					{
						name,
						path: absolutePath,
						mimeType: structuredMimeType,
						size: fileStat.size,
						content,
					},
					{ attachments, text },
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
			const buffer = await readFile(absolutePath);
			if (!isLikelyTextBuffer(buffer)) {
				errors.push({
					name,
					path: absolutePath,
					message: UNSUPPORTED_BINARY_PROMPT_ATTACHMENT_MESSAGE,
				});
				continue;
			}
			const content = buffer.toString("utf8");
			text = appendTextAttachment(
				{
					name,
					path: absolutePath,
					mimeType: getTextMimeType(absolutePath),
					size: fileStat.size,
					content,
				},
				{ attachments, text },
			);
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
