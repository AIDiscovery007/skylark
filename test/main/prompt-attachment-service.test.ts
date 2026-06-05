import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const mammothMock = vi.hoisted(() => ({
	extractRawText: vi.fn(),
}));

vi.mock("mammoth", () => ({
	default: mammothMock,
}));

import { prepareDesktopPromptAttachments } from "../../src/main/prompt/prompt-attachment-service.ts";

const ONE_PIXEL_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("prepareDesktopPromptAttachments", () => {
	let testDir: string;

	beforeEach(() => {
		mammothMock.extractRawText.mockReset();
		testDir = join(tmpdir(), `desktop-prompt-attachments-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("keeps valid attachments while reporting rejected files", async () => {
		const keptPath = join(testDir, "kept.md");
		const largePath = join(testDir, "large.txt");
		writeFileSync(keptPath, "small");
		writeFileSync(largePath, "too large");

		const result = await prepareDesktopPromptAttachments(
			[
				{ type: "path", path: keptPath },
				{ type: "path", path: largePath },
			],
			{ createId: () => "attachment-1", maxTextFileBytes: 5 },
		);

		expect(result.attachments).toEqual([
			expect.objectContaining({
				id: "attachment-1",
				kind: "text",
				name: "kept.md",
				path: keptPath,
				mimeType: "text/markdown",
				size: 5,
			}),
		]);
		expect(result.attachments[0]?.promptText).toContain("small");
		expect(result.errors).toEqual([
			{
				name: "large.txt",
				path: largePath,
				message: "Text file exceeds the 5 byte prompt attachment limit.",
			},
		]);
	});

	it("extracts readable prompt text from xlsx spreadsheets", async () => {
		const spreadsheetPath = join(testDir, "budget.xlsx");
		const workbook = XLSX.utils.book_new();
		const sheet = XLSX.utils.aoa_to_sheet([
			["Name", "Count"],
			["Alpha", 2],
			["中文", 3],
		]);
		XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
		XLSX.writeFile(workbook, spreadsheetPath);

		const result = await prepareDesktopPromptAttachments([{ type: "path", path: spreadsheetPath }], {
			createId: () => "attachment-1",
		});

		expect(result.errors).toEqual([]);
		expect(result.attachments).toEqual([
			expect.objectContaining({
				id: "attachment-1",
				kind: "text",
				name: "budget.xlsx",
				path: spreadsheetPath,
				mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			}),
		]);
		expect(result.attachments[0]?.promptText).toContain("# Spreadsheet: budget.xlsx");
		expect(result.attachments[0]?.promptText).toContain("## Sheet: Sheet1");
		expect(result.attachments[0]?.promptText).toContain("Name,Count");
		expect(result.attachments[0]?.promptText).toContain("中文,3");
		expect(result.attachments[0]?.promptText).not.toContain("\uFFFD");
	});

	it("extracts readable prompt text from docx documents", async () => {
		const docxPath = join(testDir, "brief.docx");
		writeFileSync(docxPath, "fake docx bytes");
		mammothMock.extractRawText.mockResolvedValueOnce({ value: "Doc title\nBody text", messages: [] });

		const result = await prepareDesktopPromptAttachments([{ type: "path", path: docxPath }], {
			createId: () => "attachment-1",
		});

		expect(result.errors).toEqual([]);
		expect(result.attachments).toEqual([
			expect.objectContaining({
				id: "attachment-1",
				kind: "text",
				name: "brief.docx",
				path: docxPath,
				mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			}),
		]);
		expect(result.attachments[0]?.promptText).toContain("# Document: brief.docx");
		expect(result.attachments[0]?.promptText).toContain("Doc title\nBody text");
		expect(mammothMock.extractRawText).toHaveBeenCalledWith({ path: docxPath });
	});

	it("prepares image file attachments as multimodal image content", async () => {
		const imagePath = join(testDir, "panel.png");
		writeFileSync(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));

		const result = await prepareDesktopPromptAttachments([{ type: "path", path: imagePath }], {
			createId: () => "attachment-1",
		});

		expect(result.errors).toEqual([]);
		expect(result.attachments).toEqual([
			expect.objectContaining({
				id: "attachment-1",
				kind: "image",
				name: "panel.png",
				path: imagePath,
				size: Buffer.byteLength(ONE_PIXEL_PNG_BASE64, "base64"),
			}),
		]);
		expect(result.attachments[0]?.images).toEqual([
			expect.objectContaining({
				type: "image",
				data: expect.any(String),
			}),
		]);
		expect(result.attachments[0]?.images[0]?.mimeType).toMatch(/^image\//);
		expect(result.attachments[0]?.promptText).toContain("panel.png");
		expect(result.attachments[0]?.promptText).toContain("included directly as model image content");
		expect(result.attachments[0]?.promptText).not.toContain(imagePath);
		expect(result.attachments[0]?.promptText).not.toContain("could not be converted");
	});

	it("rejects image file attachments when they cannot be prepared as model images", async () => {
		const imagePath = join(testDir, "panel_003.jpg");
		writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]));

		const result = await prepareDesktopPromptAttachments([{ type: "path", path: imagePath }], {
			createId: () => "attachment-1",
		});

		expect(result.attachments).toEqual([]);
		expect(result.errors).toEqual([
			{
				name: "panel_003.jpg",
				path: imagePath,
				message: "Image attachment could not be prepared for the model. Try a smaller or different image file.",
			},
		]);
	});

	it("prepares pasted inline images as multimodal image content while retaining the persisted path", async () => {
		const inlineImageDir = join(testDir, "inline-images");

		const result = await prepareDesktopPromptAttachments(
			[
				{
					type: "inline_image",
					name: "pasted image.png",
					mimeType: "image/png",
					data: ONE_PIXEL_PNG_BASE64,
					size: Buffer.byteLength(ONE_PIXEL_PNG_BASE64, "base64"),
				},
			],
			{
				createId: () => "attachment-1",
				inlineImageAttachmentsDir: inlineImageDir,
			},
		);

		const attachment = result.attachments[0];
		expect(result.errors).toEqual([]);
		expect(attachment?.path).toBe(join(inlineImageDir, "attachment-1", "pasted image.png"));
		expect(existsSync(attachment?.path ?? "")).toBe(true);
		expect(attachment?.images).toEqual([
			expect.objectContaining({
				type: "image",
				data: expect.any(String),
			}),
		]);
		expect(attachment?.images[0]?.mimeType).toMatch(/^image\//);
		expect(attachment?.promptText).toContain("pasted image.png");
		expect(attachment?.promptText).toContain("included directly as model image content");
		expect(attachment?.promptText).not.toContain(attachment?.path ?? "");
		expect(attachment?.promptText).not.toContain("could not be converted");
	});

	it("rejects pasted inline images that cannot be prepared without sending a filesystem path", async () => {
		const pastedBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
		const inlineImageDir = join(testDir, "inline-images");

		const result = await prepareDesktopPromptAttachments(
			[
				{
					type: "inline_image",
					name: "pasted image.jpg",
					mimeType: "image/jpeg",
					data: pastedBytes.toString("base64"),
					size: pastedBytes.length,
				},
			],
			{
				createId: () => "attachment-1",
				inlineImageAttachmentsDir: inlineImageDir,
			},
		);

		const persistedPath = join(inlineImageDir, "attachment-1", "pasted image.jpg");
		expect(result.attachments).toEqual([]);
		expect(result.errors).toEqual([
			{
				name: "pasted image.jpg",
				path: persistedPath,
				message: "Image attachment could not be prepared for the model. Try a smaller or different image file.",
			},
		]);
		expect(existsSync(persistedPath)).toBe(true);
		expect(readFileSync(persistedPath)).toEqual(pastedBytes);
	});

	it("rejects unknown binary files instead of injecting unreadable bytes into the prompt", async () => {
		const binaryPath = join(testDir, "archive.bin");
		writeFileSync(binaryPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0xff]));

		const result = await prepareDesktopPromptAttachments([{ type: "path", path: binaryPath }], {
			createId: () => "attachment-1",
		});

		expect(result.attachments).toEqual([]);
		expect(result.errors).toEqual([
			{
				name: "archive.bin",
				path: binaryPath,
				message:
					"Unsupported binary prompt attachment. Supported prompt attachments are text files, images, .docx, and .xlsx.",
			},
		]);
	});
});
