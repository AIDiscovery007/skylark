import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopProjectStore, normalizeProjectCwd } from "../../src/main/storage/project-store.ts";
import type { DesktopSessionSummary } from "../../src/shared/types.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-project-store-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

function createSession(id: string, cwd: string): DesktopSessionSummary {
	return {
		id,
		title: id,
		cwd,
		createdAt: "2026-04-25T08:00:00.000Z",
		updatedAt: "2026-04-25T08:00:00.000Z",
		messageCount: 1,
		agentMode: "execute",
		provider: "openai",
		modelId: "gpt-5.4",
	};
}

afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

describe("DesktopProjectStore", () => {
	it("creates projects from local folders and deduplicates normalized cwd", async () => {
		const directoryPath = createTempDirectory();
		const store = new DesktopProjectStore(join(directoryPath, "projects", "index.json"));
		const projectPath = join(directoryPath, "repo");

		const project = await store.createOrGet(projectPath);
		const duplicate = await store.createOrGet(join(projectPath, "."));

		expect(duplicate.id).toBe(project.id);
		expect(project.name).toBe("repo");
		expect(project.cwd).toBe(normalizeProjectCwd(projectPath));
		expect(await store.list()).toEqual([project]);
	});

	it("returns project session counts and last opened session metadata", async () => {
		const directoryPath = createTempDirectory();
		const store = new DesktopProjectStore(join(directoryPath, "projects", "index.json"));
		const project = await store.createOrGet(join(directoryPath, "repo"));
		await store.updateLastOpenedSession(project.id, "session-1");

		const projects = await store.listWithSessionStats([
			createSession("session-1", project.cwd),
			createSession("session-2", join(directoryPath, "other")),
		]);

		expect(projects[0]).toEqual(
			expect.objectContaining({
				id: project.id,
				lastOpenedSessionId: "session-1",
				sessionCount: 1,
			}),
		);
	});

	it("does not reorder projects when only the last opened session changes", async () => {
		vi.useFakeTimers();
		const directoryPath = createTempDirectory();
		const store = new DesktopProjectStore(join(directoryPath, "projects", "index.json"));

		vi.setSystemTime(new Date("2026-04-25T08:00:00.000Z"));
		const olderProject = await store.createOrGet(join(directoryPath, "older"));
		vi.setSystemTime(new Date("2026-04-25T09:00:00.000Z"));
		const newerProject = await store.createOrGet(join(directoryPath, "newer"));

		expect((await store.list()).map((project) => project.id)).toEqual([newerProject.id, olderProject.id]);

		vi.setSystemTime(new Date("2026-04-25T10:00:00.000Z"));
		await store.updateLastOpenedSession(olderProject.id, "session-older");
		const projects = await store.list();

		expect(projects.map((project) => project.id)).toEqual([newerProject.id, olderProject.id]);
		expect(projects.find((project) => project.id === olderProject.id)?.updatedAt).toBe(olderProject.updatedAt);
		expect(projects.find((project) => project.id === olderProject.id)?.lastOpenedSessionId).toBe("session-older");
	});
});
