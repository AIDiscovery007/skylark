import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createReadToolDefinition, type ReadOperations } from "@earendil-works/pi-coding-agent";
import { detectSupportedImageMimeTypeFromFile, prepareInlineImageForModel } from "../prompt/prompt-file-processor.ts";

const READ_IMAGE_UNAVAILABLE_TEXT =
	"Read image file\n[Image could not be prepared as model image content. Try a smaller or different image file.]";

type PreparedReadImage =
	| {
			kind: "image";
			buffer: Buffer;
			mimeType: string;
	  }
	| {
			kind: "text";
			buffer: Buffer;
	  };

function createDesktopReadOperations(): ReadOperations {
	const preparedImages = new Map<string, PreparedReadImage>();

	return {
		access: (absolutePath) => access(absolutePath, constants.R_OK),
		async detectImageMimeType(absolutePath) {
			const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);
			if (!mimeType) {
				preparedImages.delete(absolutePath);
				return mimeType;
			}

			const buffer = await readFile(absolutePath);
			const prepared = await prepareInlineImageForModel({
				data: buffer.toString("base64"),
				mimeType,
				name: basename(absolutePath),
				path: absolutePath,
				size: buffer.byteLength,
			});
			if (!prepared) {
				preparedImages.set(absolutePath, {
					buffer: Buffer.from(`${READ_IMAGE_UNAVAILABLE_TEXT}\n`, "utf8"),
					kind: "text",
				});
				return undefined;
			}

			preparedImages.set(absolutePath, {
				buffer: Buffer.from(prepared.data, "base64"),
				kind: "image",
				mimeType: prepared.mimeType,
			});
			return prepared.mimeType;
		},
		async readFile(absolutePath) {
			const prepared = preparedImages.get(absolutePath);
			if (prepared) {
				return prepared.buffer;
			}
			return readFile(absolutePath);
		},
	};
}

export function createDesktopReadToolDefinition(cwd: string): ReturnType<typeof createReadToolDefinition> {
	const readTool = createReadToolDefinition(cwd, {
		autoResizeImages: false,
		operations: createDesktopReadOperations(),
	});
	return {
		...readTool,
		description:
			"Read the contents of a file. Supports text files and images. For images, Skylark prepares model-ready image content so the visual model can inspect pixels directly.",
		promptGuidelines: [
			...(readTool.promptGuidelines ?? []),
			"For image understanding, call read on the image path to send the pixels to the vision-capable model. Do not use Python, OCR, or image libraries for visual interpretation unless the user explicitly asks for OCR or image processing.",
		],
	};
}
