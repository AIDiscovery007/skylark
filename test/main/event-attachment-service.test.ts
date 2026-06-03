import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const mammothMock = vi.hoisted(() => ({
	extractRawText: vi.fn(),
}));

vi.mock("mammoth", () => ({
	default: mammothMock,
}));

import {
	copyDesktopEventAttachments,
	prepareDesktopEventAttachments,
} from "../../src/main/events/event-attachment-service.ts";

async function createTempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "desktop-event-attachments-"));
}

describe("event attachment service", () => {
	it("prepares .txt, .md, and .docx text snapshots", async () => {
		const rootDir = await createTempDir();
		const textPath = join(rootDir, "todo.txt");
		const markdownPath = join(rootDir, "idea.md");
		const docxPath = join(rootDir, "brief.docx");
		await writeFile(textPath, "text todo", "utf8");
		await writeFile(markdownPath, "# idea\nship events", "utf8");
		await writeFile(docxPath, "fake docx bytes", "utf8");
		mammothMock.extractRawText.mockResolvedValueOnce({ value: "docx brief", messages: [] });
		let attachmentId = 0;

		const result = await prepareDesktopEventAttachments(
			[
				{ type: "path", path: textPath },
				{ type: "path", path: markdownPath },
				{ type: "path", path: docxPath },
			],
			{
				createId: () => {
					attachmentId += 1;
					return `attachment-${attachmentId}`;
				},
			},
		);

		expect(result.errors).toEqual([]);
		expect(result.attachments.map((attachment) => attachment.name)).toEqual(["todo.txt", "idea.md", "brief.docx"]);
		expect(result.attachments.map((attachment) => attachment.textSnapshot)).toEqual([
			"text todo",
			"# idea\nship events",
			"docx brief",
		]);
		expect(mammothMock.extractRawText).toHaveBeenCalledWith({ path: docxPath });
	});

	it("keeps original files when extraction fails and copies prepared attachments", async () => {
		const rootDir = await createTempDir();
		const docxPath = join(rootDir, "broken.docx");
		await writeFile(docxPath, "fake docx bytes", "utf8");
		mammothMock.extractRawText.mockRejectedValueOnce(new Error("bad zip"));

		const prepared = await prepareDesktopEventAttachments([{ type: "path", path: docxPath }], {
			createId: () => "attachment-1",
		});
		expect(prepared.errors).toEqual([]);
		expect(prepared.attachments[0]?.extractionError).toBe("bad zip");

		const [copied] = await copyDesktopEventAttachments({
			eventId: "event-1",
			attachmentsRootDir: join(rootDir, "events", "attachments"),
			drafts: prepared.attachments,
			now: "2026-05-22T00:00:00.000Z",
		});

		expect(copied?.originalPath).toBe(docxPath);
		expect(copied?.extractionError).toBe("bad zip");
		expect(await readFile(copied!.storedPath, "utf8")).toBe("fake docx bytes");
	});

	it("reports unsupported files without creating drafts", async () => {
		const rootDir = await createTempDir();
		const pdfPath = join(rootDir, "note.pdf");
		await writeFile(pdfPath, "%PDF", "utf8");

		const result = await prepareDesktopEventAttachments([{ type: "path", path: pdfPath }]);

		expect(result.attachments).toEqual([]);
		expect(result.errors[0]?.message).toMatch(/Only \.txt, \.md, and \.docx/);
	});
});
