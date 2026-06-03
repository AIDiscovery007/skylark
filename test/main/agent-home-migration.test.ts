import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDesktopAgentHome } from "../../src/main/storage/agent-home-migration.ts";
import { DesktopSessionStore } from "../../src/main/storage/session-store.ts";
import type { DesktopPersistedSession } from "../../src/shared/types.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-agent-home-migration-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

const migrationTestModel = {
	id: "desktop-migration-model",
	name: "Desktop Migration Model",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
} satisfies Model<"openai-completions">;

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

describe("migrateDesktopAgentHome", () => {
	it("copies legacy desktop sessions into the visible Skylark JSONL session home", async () => {
		const directoryPath = createTempDirectory();
		const legacyDesktopRootDir = join(
			directoryPath,
			"Library",
			"Application Support",
			"Skylark Development",
			"desktop-agent",
		);
		const agentRootDir = join(directoryPath, ".skylark");
		const legacySession: DesktopPersistedSession = {
			id: "session-1",
			title: "Legacy session",
			cwd: "/workspace/project",
			createdAt: "2026-05-24T08:30:00.000Z",
			updatedAt: "2026-05-24T09:00:00.000Z",
			agentMode: "plan",
			consumedProposedPlanMessageIds: ["assistant-plan"],
			model: migrationTestModel,
			thinkingLevel: "off",
			messages: [
				{ role: "user", content: "Migrate me", timestamp: 1 },
				{
					role: "assistant",
					content: [{ type: "text", text: "Migrated." }],
					api: "openai-completions",
					model: "desktop-migration-model",
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
		};
		await mkdir(join(legacyDesktopRootDir, "sessions", "data"), { recursive: true });
		await writeFile(
			join(legacyDesktopRootDir, "sessions", "data", `${legacySession.id}.json`),
			`${JSON.stringify(legacySession, null, 2)}\n`,
			"utf8",
		);

		const result = await migrateDesktopAgentHome({ agentRootDir, legacyDesktopRootDir });

		expect(result.migratedSessions).toBe(1);
		const store = new DesktopSessionStore(join(agentRootDir, "session_index.jsonl"), join(agentRootDir, "sessions"));
		expect(await store.list()).toEqual([
			expect.objectContaining({
				id: "session-1",
				agentMode: "plan",
				messageCount: 2,
				title: "Legacy session",
			}),
		]);
		const migrated = await store.get("session-1");
		expect(migrated?.messages).toEqual(legacySession.messages);
		expect(migrated?.consumedProposedPlanMessageIds).toEqual(["assistant-plan"]);
		await expect(
			readFile(
				join(agentRootDir, "sessions", "2026", "05", "24", "2026-05-24T08-30-00-000Z-session-1.jsonl"),
				"utf8",
			),
		).resolves.toContain('"type":"session"');
	});

	it("preserves legacy desktop SessionManager transcript entries when present", async () => {
		const directoryPath = createTempDirectory();
		const legacyDesktopRootDir = join(
			directoryPath,
			"Library",
			"Application Support",
			"Skylark Development",
			"desktop-agent",
		);
		const agentRootDir = join(directoryPath, ".skylark");
		const legacySession: DesktopPersistedSession = {
			id: "session-with-transcript",
			title: "Rich legacy session",
			cwd: "/workspace/project",
			createdAt: "2026-05-24T08:30:00.000Z",
			updatedAt: "2026-05-24T09:00:00.000Z",
			agentMode: "execute",
			model: migrationTestModel,
			thinkingLevel: "off",
			messages: [{ role: "user", content: "Migrate rich transcript", timestamp: 1 }],
		};
		await mkdir(join(legacyDesktopRootDir, "sessions", "data"), { recursive: true });
		await mkdir(join(legacyDesktopRootDir, "agent-sessions"), { recursive: true });
		await writeFile(
			join(legacyDesktopRootDir, "sessions", "data", `${legacySession.id}.json`),
			`${JSON.stringify(legacySession, null, 2)}\n`,
			"utf8",
		);
		await writeFile(
			join(legacyDesktopRootDir, "agent-sessions", `${legacySession.id}.jsonl`),
			`${[
				{
					type: "session",
					version: 3,
					id: legacySession.id,
					timestamp: "2026-05-24T08:30:00.000Z",
					cwd: "/workspace/project",
				},
				{
					type: "model_change",
					id: "model",
					parentId: null,
					timestamp: "2026-05-24T08:30:00.000Z",
					provider: "openai",
					modelId: "desktop-migration-model",
				},
				{
					type: "custom_message",
					id: "context",
					parentId: "model",
					timestamp: "2026-05-24T08:31:00.000Z",
					customType: "legacy_context",
					content: "Recovered tool context",
					display: false,
				},
				{
					type: "message",
					id: "assistant",
					parentId: "context",
					timestamp: "2026-05-24T08:32:00.000Z",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Rich transcript restored." }],
						api: "openai-completions",
						model: "desktop-migration-model",
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
				},
			]
				.map((entry) => JSON.stringify(entry))
				.join("\n")}\n`,
			"utf8",
		);

		const result = await migrateDesktopAgentHome({ agentRootDir, legacyDesktopRootDir });

		expect(result.migratedSessions).toBe(1);
		const migratedContent = await readFile(
			join(agentRootDir, "sessions", "2026", "05", "24", "2026-05-24T08-30-00-000Z-session-with-transcript.jsonl"),
			"utf8",
		);
		expect(migratedContent).toContain('"customType":"legacy_context"');
		expect(migratedContent).toContain('"customType":"desktop_session_metadata"');
	});

	it("copies legacy desktop and pi agent resources without overwriting existing Skylark files", async () => {
		const directoryPath = createTempDirectory();
		const legacyDesktopRootDir = join(
			directoryPath,
			"Library",
			"Application Support",
			"Skylark Development",
			"desktop-agent",
		);
		const legacyPiAgentDir = join(directoryPath, ".pi", "agent");
		const agentRootDir = join(directoryPath, ".skylark");
		await mkdir(join(legacyDesktopRootDir, "projects"), { recursive: true });
		await mkdir(join(legacyDesktopRootDir, "sessions", "data"), { recursive: true });
		await mkdir(join(legacyPiAgentDir, "skills", "review"), { recursive: true });
		await mkdir(join(legacyPiAgentDir, "prompts"), { recursive: true });
		await mkdir(join(legacyPiAgentDir, "sessions"), { recursive: true });
		await mkdir(agentRootDir, { recursive: true });
		await writeFile(join(legacyDesktopRootDir, "provider-keys.json"), '{"openai":"desktop-key"}\n', "utf8");
		await writeFile(join(legacyDesktopRootDir, "mcp-servers.json"), '{"servers":[]}\n', "utf8");
		await writeFile(join(legacyDesktopRootDir, "projects", "index.json"), '{"projects":[]}\n', "utf8");
		await writeFile(join(legacyDesktopRootDir, "sessions", "data", "legacy.json"), "{}\n", "utf8");
		await writeFile(join(legacyPiAgentDir, "auth.json"), '{"openai":{"apiKey":"legacy-key"}}\n', "utf8");
		await writeFile(join(legacyPiAgentDir, "models.json"), '{"models":[]}\n', "utf8");
		await writeFile(join(legacyPiAgentDir, "AGENTS.md"), "Legacy global instructions\n", "utf8");
		await writeFile(join(legacyPiAgentDir, "skills", "review", "SKILL.md"), "# Review\n", "utf8");
		await writeFile(join(legacyPiAgentDir, "prompts", "brief.md"), "Brief\n", "utf8");
		await writeFile(join(legacyPiAgentDir, "sessions", "pi-session.jsonl"), "{}\n", "utf8");
		await writeFile(join(agentRootDir, "auth.json"), '{"openai":{"apiKey":"new-key"}}\n', "utf8");

		const result = await migrateDesktopAgentHome({ agentRootDir, legacyDesktopRootDir, legacyPiAgentDir });

		expect(result.copiedResources).toBe(7);
		expect(result.skippedResources).toBe(1);
		await expect(readFile(join(agentRootDir, "provider-keys.json"), "utf8")).resolves.toContain("desktop-key");
		await expect(readFile(join(agentRootDir, "mcp-servers.json"), "utf8")).resolves.toContain("servers");
		await expect(readFile(join(agentRootDir, "projects", "index.json"), "utf8")).resolves.toContain("projects");
		await expect(readFile(join(agentRootDir, "models.json"), "utf8")).resolves.toContain("models");
		await expect(readFile(join(agentRootDir, "AGENTS.md"), "utf8")).resolves.toBe("Legacy global instructions\n");
		await expect(readFile(join(agentRootDir, "skills", "review", "SKILL.md"), "utf8")).resolves.toBe("# Review\n");
		await expect(readFile(join(agentRootDir, "prompts", "brief.md"), "utf8")).resolves.toBe("Brief\n");
		await expect(readFile(join(agentRootDir, "auth.json"), "utf8")).resolves.toContain("new-key");
		await expect(readFile(join(agentRootDir, "sessions", "pi-session.jsonl"), "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(readFile(join(agentRootDir, "sessions", "data", "legacy.json"), "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("moves legacy desktop window state into platform state instead of Skylark settings", async () => {
		const directoryPath = createTempDirectory();
		const legacyDesktopRootDir = join(
			directoryPath,
			"Library",
			"Application Support",
			"Skylark Development",
			"desktop-agent",
		);
		const agentRootDir = join(directoryPath, ".skylark");
		const platformStateFilePath = join(legacyDesktopRootDir, "platform-state.json");
		await mkdir(legacyDesktopRootDir, { recursive: true });
		await writeFile(
			join(legacyDesktopRootDir, "settings.json"),
			`${JSON.stringify(
				{
					defaultProvider: "anthropic",
					windowStates: {
						main: { x: 10, y: 20, width: 1200, height: 800 },
					},
				},
				null,
				2,
			)}\n`,
			"utf8",
		);

		const result = await migrateDesktopAgentHome({ agentRootDir, legacyDesktopRootDir, platformStateFilePath });

		expect(result.copiedResources).toBe(2);
		await expect(readFile(join(agentRootDir, "settings.json"), "utf8")).resolves.toContain("defaultProvider");
		await expect(readFile(join(agentRootDir, "settings.json"), "utf8")).resolves.not.toContain("windowStates");
		await expect(readFile(platformStateFilePath, "utf8")).resolves.toContain("windowStates");
	});
});
