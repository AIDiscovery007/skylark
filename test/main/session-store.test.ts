import { mkdtempSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { DESKTOP_SESSION_METADATA_CUSTOM_TYPE, DesktopSessionStore } from "../../src/main/storage/session-store.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-session-store-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

const sessionTestModel = {
	id: "desktop-test-model",
	name: "Desktop Test Model",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
} satisfies Model<"openai-completions">;

async function readJsonlEntries(filePath: string): Promise<Array<Record<string, unknown>>> {
	return (await readFile(filePath, "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function countDesktopMetadataEntries(entries: readonly Record<string, unknown>[]): number {
	return entries.filter(
		(entry) => entry.type === "custom" && entry.customType === DESKTOP_SESSION_METADATA_CUSTOM_TYPE,
	).length;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

describe("DesktopSessionStore", () => {
	it("creates, persists, and lists sessions", async () => {
		const directoryPath = createTempDirectory();
		const store = new DesktopSessionStore(
			join(directoryPath, "session_index.jsonl"),
			join(directoryPath, "sessions"),
			{ now: () => new Date("2026-05-24T08:30:00.000Z") },
		);

		const created = await store.create({
			cwd: "/workspace/project",
			model: sessionTestModel,
			thinkingLevel: "off",
			messages: [{ role: "user", content: "Explain the repo", timestamp: 1 }],
		});

		expect(created.title).toBe("Explain");

		const loaded = await store.get(created.id);
		expect(loaded?.messages).toEqual([{ role: "user", content: "Explain the repo", timestamp: 1 }]);
		expect(loaded?.taskProgress).toBeUndefined();
		expect(loaded?.sessionFilePath).toBe(
			join(directoryPath, "sessions", "2026", "05", "24", `2026-05-24T08-30-00-000Z-${created.id}.jsonl`),
		);
		const sessionLines = (
			await readFile(
				join(directoryPath, "sessions", "2026", "05", "24", `2026-05-24T08-30-00-000Z-${created.id}.jsonl`),
				"utf8",
			)
		)
			.trim()
			.split("\n");
		expect(JSON.parse(sessionLines[0] ?? "{}")).toEqual(
			expect.objectContaining({
				cwd: "/workspace/project",
				id: created.id,
				type: "session",
			}),
		);
		await expect(readdir(join(directoryPath, "sessions", "data"))).rejects.toMatchObject({ code: "ENOENT" });

		const sessions = await store.list();
		expect(sessions).toEqual([
			{
				id: created.id,
				title: "Explain",
				cwd: "/workspace/project",
				createdAt: created.createdAt,
				updatedAt: created.updatedAt,
				messageCount: 1,
				agentMode: "execute",
				provider: "openai",
				modelId: "desktop-test-model",
			},
		]);
	});

	it("persists structured task progress with sessions", async () => {
		const directoryPath = createTempDirectory();
		const store = new DesktopSessionStore(
			join(directoryPath, "session_index.jsonl"),
			join(directoryPath, "sessions"),
		);

		const created = await store.create({
			cwd: "/workspace/project",
			model: sessionTestModel,
			thinkingLevel: "off",
			messages: [{ role: "user", content: "Keep this message", timestamp: 1 }],
		});
		const taskProgress = {
			title: "Implement panel",
			items: [
				{ id: "inspect", label: "Inspect runtime", status: "completed" as const },
				{ id: "render", label: "Render panel", status: "active" as const },
			],
			updatedAt: "2026-05-17T00:00:00.000Z",
		};

		await store.save({ ...created, taskProgress });

		const loaded = await store.get(created.id);
		expect(loaded?.messages).toEqual([{ role: "user", content: "Keep this message", timestamp: 1 }]);
		expect(loaded?.taskProgress).toEqual(taskProgress);
	});

	it("does not append duplicate desktop metadata when only transcript messages changed", async () => {
		const directoryPath = createTempDirectory();
		let now = new Date("2026-05-24T08:30:00.000Z");
		const store = new DesktopSessionStore(
			join(directoryPath, "session_index.jsonl"),
			join(directoryPath, "sessions"),
			{ now: () => now },
		);
		const created = await store.create({
			cwd: "/workspace/project",
			model: sessionTestModel,
			thinkingLevel: "off",
			messages: [{ role: "user", content: "Explain the store", timestamp: 1 }],
		});

		now = new Date("2026-05-24T08:30:10.000Z");
		const stabilized = await store.save(created);
		const sessionFilePath = stabilized.sessionFilePath;
		if (!sessionFilePath) {
			throw new Error("Expected stabilized session to have a session file path.");
		}
		const beforeEntries = await readJsonlEntries(sessionFilePath);
		const parentId = beforeEntries.at(-1)?.id;
		if (typeof parentId !== "string") {
			throw new Error("Expected session file to have a leaf entry id.");
		}
		const appendedMessageEntry = {
			type: "message",
			id: "assistant-1",
			parentId,
			timestamp: "2026-05-24T08:31:00.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "It is append-only." }],
				api: "openai-completions",
				provider: "openai",
				model: "desktop-test-model",
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 2,
			},
		};
		await writeFile(sessionFilePath, `${[appendedMessageEntry].map((entry) => JSON.stringify(entry)).join("\n")}\n`, {
			encoding: "utf8",
			flag: "a",
		});

		now = new Date("2026-05-24T08:31:10.000Z");
		await store.save({
			...stabilized,
			messages: [
				...stabilized.messages,
				{
					role: "assistant",
					content: [{ type: "text", text: "It is append-only." }],
					api: "openai-completions",
					provider: "openai",
					model: "desktop-test-model",
					usage: {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 2,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: 2,
				},
			],
		});

		const afterEntries = await readJsonlEntries(sessionFilePath);
		expect(countDesktopMetadataEntries(afterEntries)).toBe(countDesktopMetadataEntries(beforeEntries));
		expect((await store.get(stabilized.id))?.updatedAt).toBe("2026-05-24T08:31:00.000Z");
	});

	it("deletes sessions from the index and persisted data", async () => {
		const directoryPath = createTempDirectory();
		const store = new DesktopSessionStore(
			join(directoryPath, "session_index.jsonl"),
			join(directoryPath, "sessions"),
		);
		const created = await store.create({
			cwd: "/workspace/project",
			model: sessionTestModel,
			thinkingLevel: "off",
			messages: [{ role: "user", content: "Delete me", timestamp: 1 }],
		});

		await expect(store.delete(created.id)).resolves.toBe(true);

		expect(await store.get(created.id)).toBeNull();
		expect(await store.list()).toEqual([]);
		await expect(store.delete(created.id)).resolves.toBe(false);
	});

	it("rebuilds session summaries from JSONL transcripts when the index cache is missing", async () => {
		const directoryPath = createTempDirectory();
		const indexPath = join(directoryPath, "session_index.jsonl");
		const sessionsDir = join(directoryPath, "sessions");
		const store = new DesktopSessionStore(indexPath, sessionsDir);
		const created = await store.create({
			cwd: "/workspace/project",
			model: sessionTestModel,
			thinkingLevel: "off",
			messages: [
				{ role: "user", content: "Can you map the storage?", timestamp: 1 },
				{
					role: "assistant",
					content: [{ type: "text", text: "Yes." }],
					api: "openai-completions",
					model: "desktop-test-model",
					provider: "openai",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: 2,
				},
			],
		});
		await rm(indexPath, { force: true });

		const reloadedStore = new DesktopSessionStore(indexPath, sessionsDir);

		expect(await reloadedStore.list()).toEqual([
			expect.objectContaining({
				id: created.id,
				messageCount: 2,
				title: "Can you",
			}),
		]);
		expect((await reloadedStore.get(created.id))?.messages).toHaveLength(2);
	});
});
