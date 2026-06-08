import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FileEntry, SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import { CURRENT_SESSION_VERSION, migrateSessionEntries, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../../shared/guards.ts";
import type { DesktopPersistedSession } from "../../shared/types.ts";
import { isMissingFileError } from "./fs-errors.ts";
import { DESKTOP_SESSION_METADATA_CUSTOM_TYPE, DesktopSessionStore } from "./session-store.ts";

export interface DesktopAgentHomeMigrationOptions {
	agentRootDir: string;
	legacyDesktopRootDir: string;
	legacyPiAgentDir?: string;
	platformStateFilePath?: string;
}

export interface DesktopAgentHomeMigrationResult {
	migratedSessions: number;
	skippedSessions: number;
	copiedResources: number;
	skippedResources: number;
}

const LEGACY_DESKTOP_RESOURCE_PATHS = [
	"provider-keys.json",
	"mcp-servers.json",
	"projects",
	"events",
	"workspaces",
] as const;

const LEGACY_PI_AGENT_RESOURCE_PATHS = [
	"auth.json",
	"oauth.json",
	"models.json",
	"settings.json",
	"keybindings.json",
	"compaction-settings.json",
	"AGENTS.md",
	"CLAUDE.md",
	"skills",
	"prompts",
	"themes",
	"extensions",
	"tools",
	"bin",
] as const;

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(filePath, "utf8")) as T;
	} catch (error) {
		if (isMissingFileError(error)) {
			return undefined;
		}
		throw error;
	}
}

async function listJsonFiles(directoryPath: string): Promise<string[]> {
	try {
		const entries = await readdir(directoryPath, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.map((entry) => join(directoryPath, entry.name));
	} catch (error) {
		if (isMissingFileError(error)) {
			return [];
		}
		throw error;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isMissingFileError(error)) {
			return false;
		}
		throw error;
	}
}

function parseTimestamp(value: string | undefined): Date {
	const timestamp = value ? new Date(value) : undefined;
	return timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : new Date();
}

function createDesktopMetadataEntry(
	legacySession: DesktopPersistedSession,
	timestamp: Date,
	parentId: string | null,
): SessionEntry {
	return {
		type: "custom",
		customType: DESKTOP_SESSION_METADATA_CUSTOM_TYPE,
		data: {
			title: legacySession.title,
			agentMode: legacySession.agentMode,
			consumedProposedPlanMessageIds: legacySession.consumedProposedPlanMessageIds,
			taskProgress: legacySession.taskProgress,
			model: legacySession.model,
			thinkingLevel: legacySession.thinkingLevel,
			updatedAt: timestamp.toISOString(),
		},
		id: randomUUID().slice(0, 8),
		parentId,
		timestamp: timestamp.toISOString(),
	} as SessionEntry;
}

async function readLegacyTranscriptEntries(
	options: DesktopAgentHomeMigrationOptions,
	legacySession: DesktopPersistedSession,
): Promise<FileEntry[] | undefined> {
	const transcriptPath = join(options.legacyDesktopRootDir, "agent-sessions", `${legacySession.id}.jsonl`);
	let content: string;
	try {
		content = await readFile(transcriptPath, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) {
			return undefined;
		}
		throw error;
	}
	const entries = parseSessionEntries(content);
	migrateSessionEntries(entries);
	const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
	if (!header) {
		return undefined;
	}
	const createdAt = parseTimestamp(legacySession.createdAt);
	const updatedAt = parseTimestamp(legacySession.updatedAt);
	const sessionEntries = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
	const normalizedHeader: SessionHeader = {
		...header,
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: legacySession.id,
		timestamp: createdAt.toISOString(),
		cwd: legacySession.cwd,
	};
	const metadataEntry = createDesktopMetadataEntry(legacySession, updatedAt, sessionEntries.at(-1)?.id ?? null);
	return [normalizedHeader, ...sessionEntries, metadataEntry];
}

async function migrateLegacyDesktopSessions(options: DesktopAgentHomeMigrationOptions): Promise<{
	migratedSessions: number;
	skippedSessions: number;
}> {
	const sessionFiles = await listJsonFiles(join(options.legacyDesktopRootDir, "sessions", "data"));
	let migratedSessions = 0;
	let skippedSessions = 0;

	for (const sessionFile of sessionFiles) {
		const legacySession = await readJsonFile<DesktopPersistedSession>(sessionFile);
		if (!legacySession?.id || !legacySession.cwd || !legacySession.model) {
			skippedSessions += 1;
			continue;
		}
		const existingStore = new DesktopSessionStore(
			join(options.agentRootDir, "session_index.jsonl"),
			join(options.agentRootDir, "sessions"),
		);
		if (await existingStore.get(legacySession.id)) {
			skippedSessions += 1;
			continue;
		}

		const transcriptEntries = await readLegacyTranscriptEntries(options, legacySession);
		if (transcriptEntries) {
			const importStore = new DesktopSessionStore(
				join(options.agentRootDir, "session_index.jsonl"),
				join(options.agentRootDir, "sessions"),
			);
			const imported = await importStore.importEntries(transcriptEntries, legacySession);
			if (imported) {
				migratedSessions += 1;
				continue;
			}
		}

		const createdAt = parseTimestamp(legacySession.createdAt);
		const createdStore = new DesktopSessionStore(
			join(options.agentRootDir, "session_index.jsonl"),
			join(options.agentRootDir, "sessions"),
			{ now: () => createdAt },
		);
		const created = await createdStore.create({
			id: legacySession.id,
			cwd: legacySession.cwd,
			model: legacySession.model,
			thinkingLevel: legacySession.thinkingLevel,
			messages: legacySession.messages,
			title: legacySession.title,
			agentMode: legacySession.agentMode,
		});
		const updatedAt = parseTimestamp(legacySession.updatedAt);
		const updatedStore = new DesktopSessionStore(
			join(options.agentRootDir, "session_index.jsonl"),
			join(options.agentRootDir, "sessions"),
			{ now: () => updatedAt },
		);
		await updatedStore.save({
			...created,
			title: legacySession.title,
			agentMode: legacySession.agentMode,
			consumedProposedPlanMessageIds: legacySession.consumedProposedPlanMessageIds,
			taskProgress: legacySession.taskProgress,
			model: legacySession.model,
			thinkingLevel: legacySession.thinkingLevel,
			messages: legacySession.messages,
		});
		migratedSessions += 1;
	}

	return { migratedSessions, skippedSessions };
}

async function copyResource(
	sourceRootDir: string,
	targetRootDir: string,
	relativePath: string,
): Promise<{
	copiedResources: number;
	skippedResources: number;
}> {
	const sourcePath = join(sourceRootDir, relativePath);
	if (!(await pathExists(sourcePath))) {
		return { copiedResources: 0, skippedResources: 0 };
	}
	const targetPath = join(targetRootDir, relativePath);
	if (await pathExists(targetPath)) {
		return { copiedResources: 0, skippedResources: 1 };
	}
	await mkdir(dirname(targetPath), { recursive: true });
	await cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true });
	return { copiedResources: 1, skippedResources: 0 };
}

async function copyLegacyDesktopSettings(options: DesktopAgentHomeMigrationOptions): Promise<{
	copiedResources: number;
	skippedResources: number;
}> {
	const sourcePath = join(options.legacyDesktopRootDir, "settings.json");
	const settings = await readJsonFile<Record<string, unknown>>(sourcePath);
	if (!settings) {
		return { copiedResources: 0, skippedResources: 0 };
	}
	let copiedResources = 0;
	let skippedResources = 0;
	const { windowStates, ...agentSettings } = settings;
	const targetSettingsPath = join(options.agentRootDir, "settings.json");
	if (await pathExists(targetSettingsPath)) {
		skippedResources += 1;
	} else {
		await mkdir(dirname(targetSettingsPath), { recursive: true });
		await writeFile(targetSettingsPath, `${JSON.stringify(agentSettings, null, 2)}\n`, "utf8");
		copiedResources += 1;
	}
	if (isRecord(windowStates)) {
		const platformStateFilePath =
			options.platformStateFilePath ?? join(options.legacyDesktopRootDir, "platform-state.json");
		if (await pathExists(platformStateFilePath)) {
			skippedResources += 1;
		} else {
			await mkdir(dirname(platformStateFilePath), { recursive: true });
			await writeFile(platformStateFilePath, `${JSON.stringify({ windowStates }, null, 2)}\n`, "utf8");
			copiedResources += 1;
		}
	}
	return { copiedResources, skippedResources };
}

async function copyLegacyResources(options: DesktopAgentHomeMigrationOptions): Promise<{
	copiedResources: number;
	skippedResources: number;
}> {
	let copiedResources = 0;
	let skippedResources = 0;
	const desktopSettingsResult = await copyLegacyDesktopSettings(options);
	copiedResources += desktopSettingsResult.copiedResources;
	skippedResources += desktopSettingsResult.skippedResources;
	for (const relativePath of LEGACY_DESKTOP_RESOURCE_PATHS) {
		const result = await copyResource(options.legacyDesktopRootDir, options.agentRootDir, relativePath);
		copiedResources += result.copiedResources;
		skippedResources += result.skippedResources;
	}
	if (options.legacyPiAgentDir) {
		for (const relativePath of LEGACY_PI_AGENT_RESOURCE_PATHS) {
			const result = await copyResource(options.legacyPiAgentDir, options.agentRootDir, relativePath);
			copiedResources += result.copiedResources;
			skippedResources += result.skippedResources;
		}
	}
	return { copiedResources, skippedResources };
}

export async function migrateDesktopAgentHome(
	options: DesktopAgentHomeMigrationOptions,
): Promise<DesktopAgentHomeMigrationResult> {
	await mkdir(options.agentRootDir, { recursive: true });
	const sessionSummary = await migrateLegacyDesktopSessions(options);
	const resourceSummary = await copyLegacyResources(options);
	const result: DesktopAgentHomeMigrationResult = {
		...sessionSummary,
		...resourceSummary,
	};
	const reportPath = join(options.agentRootDir, "migration-report.json");
	await mkdir(dirname(reportPath), { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
	return result;
}
