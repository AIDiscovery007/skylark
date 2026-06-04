import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
