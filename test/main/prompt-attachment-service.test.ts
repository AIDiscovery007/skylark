import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareDesktopPromptAttachments } from "../../src/main/prompt/prompt-attachment-service.ts";

describe("prepareDesktopPromptAttachments", () => {
	let testDir: string;

	beforeEach(() => {
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
});
