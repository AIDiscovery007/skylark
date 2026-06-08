import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FileEntry, SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import {
	buildSessionContext,
	CURRENT_SESSION_VERSION,
	migrateSessionEntries,
	parseSessionEntries,
} from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_DESKTOP_AGENT_MODE,
	type DesktopAgentMode,
	type DesktopPersistedSession,
	type DesktopSessionSummary,
	resolveConsumedProposedPlanMessageIds,
	resolveDesktopAgentMode,
	resolveDesktopTaskProgress,
} from "../../shared/types.ts";
import {
	DEFAULT_SESSION_TITLE,
	deriveFallbackSessionTitle,
	isGenericSessionTitle,
	isLegacyAutoDerivedSessionTitle,
} from "../session-title-utils.ts";
import { isMissingFileError } from "./fs-errors.ts";

export const DESKTOP_SESSION_METADATA_CUSTOM_TYPE = "desktop_session_metadata";

type SessionIndexRecord = DesktopSessionSummary & {
	sessionFilePath: string;
};

type SessionIndex = Record<string, SessionIndexRecord>;

type SessionIndexEvent =
	| {
			type: "session_upsert";
			timestamp: string;
			session: SessionIndexRecord;
	  }
	| {
			type: "session_delete";
			timestamp: string;
			sessionId: string;
	  };

type SessionEntryDraft = SessionEntry extends infer T
	? T extends SessionEntry
		? Omit<T, "id" | "parentId" | "timestamp">
		: never
	: never;

interface DesktopSessionMetadata {
	title?: string;
	agentMode?: DesktopAgentMode;
	consumedProposedPlanMessageIds?: string[];
	taskProgress?: DesktopPersistedSession["taskProgress"];
	model?: DesktopPersistedSession["model"];
	thinkingLevel?: DesktopPersistedSession["thinkingLevel"];
	updatedAt?: string;
}

export interface CreateDesktopSessionOptions {
	id?: string;
	cwd: string;
	model: DesktopPersistedSession["model"];
	thinkingLevel: DesktopPersistedSession["thinkingLevel"];
	messages?: AgentMessage[];
	title?: string;
	agentMode?: DesktopAgentMode;
}

export interface DesktopSessionStoreOptions {
	now?: () => Date;
}

function deriveSessionTitle(messages: AgentMessage[], currentTitle?: string): string {
	const explicitTitle = currentTitle?.trim().replace(/\s+/g, " ");
	if (
		explicitTitle &&
		!isGenericSessionTitle(currentTitle) &&
		!isLegacyAutoDerivedSessionTitle(messages, currentTitle)
	) {
		return explicitTitle;
	}

	return deriveFallbackSessionTitle(messages, currentTitle);
}

function toSummary(session: DesktopPersistedSession): DesktopSessionSummary {
	return {
		id: session.id,
		title: deriveSessionTitle(session.messages, session.title),
		cwd: session.cwd,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		messageCount: session.messages.length,
		agentMode: resolveDesktopAgentMode(session.agentMode),
		provider: session.model.provider,
		modelId: session.model.id,
	};
}

function getDateBucket(timestamp: Date): string[] {
	const iso = timestamp.toISOString();
	return [iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)];
}

function getFileTimestamp(timestamp: Date): string {
	return timestamp.toISOString().replace(/[:.]/g, "-");
}

export function getDesktopSessionFilePath(sessionsDir: string, sessionId: string, timestamp: Date): string {
	return join(sessionsDir, ...getDateBucket(timestamp), `${getFileTimestamp(timestamp)}-${sessionId}.jsonl`);
}

function stringifyJsonlEntry(entry: unknown): string {
	return `${JSON.stringify(entry)}\n`;
}

function createEntryId(): string {
	return randomUUID().slice(0, 8);
}

function appendEntry(entries: SessionEntry[], entry: SessionEntryDraft, now: Date): void {
	entries.push({
		...entry,
		id: createEntryId(),
		parentId: entries.at(-1)?.id ?? null,
		timestamp: now.toISOString(),
	} as SessionEntry);
}

function createMetadataEntry(metadata: DesktopSessionMetadata): SessionEntryDraft {
	return {
		type: "custom",
		customType: DESKTOP_SESSION_METADATA_CUSTOM_TYPE,
		data: metadata,
	} as SessionEntryDraft;
}

function isSessionIndexEvent(value: unknown): value is SessionIndexEvent {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const event = value as Partial<SessionIndexEvent>;
	if (event.type === "session_delete") {
		return typeof event.sessionId === "string";
	}
	if (event.type !== "session_upsert") {
		return false;
	}
	return typeof event.session === "object" && event.session !== null && typeof event.session.id === "string";
}

function isDesktopSessionMetadata(value: unknown): value is DesktopSessionMetadata {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveMetadata(entries: readonly SessionEntry[]): DesktopSessionMetadata {
	let metadata: DesktopSessionMetadata = {};
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== DESKTOP_SESSION_METADATA_CUSTOM_TYPE) {
			continue;
		}
		if (!isDesktopSessionMetadata(entry.data)) {
			continue;
		}
		metadata = {
			...metadata,
			...entry.data,
		};
	}
	return metadata;
}

function createComparableMetadata(metadata: DesktopSessionMetadata): Omit<DesktopSessionMetadata, "updatedAt"> {
	const { updatedAt: _updatedAt, ...comparable } = metadata;
	return comparable;
}

function hasMetadataPayloadChanged(left: DesktopSessionMetadata, right: DesktopSessionMetadata): boolean {
	return JSON.stringify(createComparableMetadata(left)) !== JSON.stringify(createComparableMetadata(right));
}

function resolveLatestTimestamp(...timestamps: Array<string | undefined>): string | undefined {
	let latest: { raw: string; time: number } | undefined;
	for (const raw of timestamps) {
		if (!raw) {
			continue;
		}
		const time = Date.parse(raw);
		if (Number.isNaN(time)) {
			continue;
		}
		if (!latest || time > latest.time) {
			latest = { raw, time };
		}
	}
	return latest?.raw;
}

function findLeafId(entries: readonly SessionEntry[]): string | null {
	return entries.at(-1)?.id ?? null;
}

function createById(entries: readonly SessionEntry[]): Map<string, SessionEntry> {
	return new Map(entries.map((entry) => [entry.id, entry]));
}

function getSessionHeader(entries: readonly FileEntry[]): SessionHeader | undefined {
	return entries.find((entry): entry is SessionHeader => entry.type === "session");
}

function getSessionEntries(entries: readonly FileEntry[]): SessionEntry[] {
	return entries.filter((entry): entry is SessionEntry => entry.type !== "session");
}

function createPersistedSessionFromFile(
	filePath: string,
	entries: FileEntry[],
	fallback?: DesktopPersistedSession,
): DesktopPersistedSession | null {
	const header = getSessionHeader(entries);
	if (!header) {
		return null;
	}
	const sessionEntries = getSessionEntries(entries);
	const metadata = resolveMetadata(sessionEntries);
	const context = buildSessionContext(sessionEntries, findLeafId(sessionEntries), createById(sessionEntries));
	const messages = context.messages;
	const createdAt = header.timestamp;
	const updatedAt =
		resolveLatestTimestamp(metadata.updatedAt, sessionEntries.at(-1)?.timestamp, fallback?.updatedAt, createdAt) ??
		createdAt;
	const model = metadata.model ?? fallback?.model;
	const thinkingLevel = metadata.thinkingLevel ?? fallback?.thinkingLevel ?? context.thinkingLevel;

	if (!model) {
		return null;
	}

	return {
		id: header.id,
		sessionFilePath: filePath,
		title: deriveSessionTitle(messages, metadata.title ?? fallback?.title ?? DEFAULT_SESSION_TITLE),
		cwd: header.cwd,
		createdAt,
		updatedAt,
		agentMode: resolveDesktopAgentMode(metadata.agentMode ?? fallback?.agentMode),
		consumedProposedPlanMessageIds: resolveConsumedProposedPlanMessageIds(
			metadata.consumedProposedPlanMessageIds ?? fallback?.consumedProposedPlanMessageIds,
		),
		taskProgress: resolveDesktopTaskProgress(metadata.taskProgress ?? fallback?.taskProgress),
		model,
		thinkingLevel: thinkingLevel as DesktopPersistedSession["thinkingLevel"],
		messages,
	};
}

export class DesktopSessionStore {
	constructor(
		private readonly indexFilePath: string,
		private readonly sessionsDir: string,
		private readonly options: DesktopSessionStoreOptions = {},
	) {}

	private getNow(): Date {
		return this.options.now?.() ?? new Date();
	}

	private async readIndex(): Promise<SessionIndex> {
		try {
			const content = await readFile(this.indexFilePath, "utf8");
			const index: SessionIndex = {};
			for (const line of content.split("\n")) {
				if (!line.trim()) {
					continue;
				}
				const parsed = JSON.parse(line) as unknown;
				if (!isSessionIndexEvent(parsed)) {
					continue;
				}
				if (parsed.type === "session_delete") {
					delete index[parsed.sessionId];
				} else {
					index[parsed.session.id] = parsed.session;
				}
			}
			return index;
		} catch (error) {
			if (isMissingFileError(error)) {
				return this.rebuildIndexFromSessionFiles();
			}
			throw error;
		}
	}

	private async listSessionFiles(directoryPath = this.sessionsDir): Promise<string[]> {
		try {
			const entries = await readdir(directoryPath, { withFileTypes: true });
			const files = await Promise.all(
				entries.map((entry) => {
					const entryPath = join(directoryPath, entry.name);
					if (entry.isDirectory()) {
						return this.listSessionFiles(entryPath);
					}
					return Promise.resolve(entry.isFile() && entry.name.endsWith(".jsonl") ? [entryPath] : []);
				}),
			);
			return files.flat();
		} catch (error) {
			if (isMissingFileError(error)) {
				return [];
			}
			throw error;
		}
	}

	private async readSessionFile(sessionFilePath: string): Promise<DesktopPersistedSession | null> {
		const content = await readFile(sessionFilePath, "utf8");
		const entries = parseSessionEntries(content);
		migrateSessionEntries(entries);
		return createPersistedSessionFromFile(sessionFilePath, entries);
	}

	private async rebuildIndexFromSessionFiles(): Promise<SessionIndex> {
		const sessionFiles = await this.listSessionFiles();
		const index: SessionIndex = {};
		for (const sessionFilePath of sessionFiles) {
			const session = await this.readSessionFile(sessionFilePath);
			if (!session?.sessionFilePath) {
				continue;
			}
			index[session.id] = {
				...toSummary(session),
				sessionFilePath: session.sessionFilePath,
			};
		}
		if (Object.keys(index).length > 0) {
			await mkdir(dirname(this.indexFilePath), { recursive: true });
			const timestamp = this.getNow().toISOString();
			const content = Object.values(index)
				.map((session) =>
					stringifyJsonlEntry({
						type: "session_upsert",
						timestamp,
						session,
					} satisfies SessionIndexEvent),
				)
				.join("");
			await writeFile(this.indexFilePath, content, "utf8");
		}
		return index;
	}

	private async appendIndexEvent(event: SessionIndexEvent): Promise<void> {
		await mkdir(dirname(this.indexFilePath), { recursive: true });
		await writeFile(this.indexFilePath, stringifyJsonlEntry(event), { encoding: "utf8", flag: "a" });
	}

	private async upsertIndex(session: DesktopPersistedSession): Promise<void> {
		const summary = toSummary(session);
		const sessionFilePath = session.sessionFilePath;
		if (!sessionFilePath) {
			throw new Error(`Session '${session.id}' is missing a session file path.`);
		}
		await this.appendIndexEvent({
			type: "session_upsert",
			timestamp: this.getNow().toISOString(),
			session: {
				...summary,
				sessionFilePath,
			},
		});
	}

	async list(): Promise<DesktopSessionSummary[]> {
		const sessionIndex = await this.readIndex();
		return Object.values(sessionIndex)
			.map(({ sessionFilePath: _sessionFilePath, ...summary }) => summary)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	async get(sessionId: string): Promise<DesktopPersistedSession | null> {
		const record = (await this.readIndex())[sessionId];
		const resolvedRecord = record ?? (await this.rebuildIndexFromSessionFiles())[sessionId];
		if (!resolvedRecord) {
			return null;
		}
		const fallback: DesktopPersistedSession = {
			id: resolvedRecord.id,
			sessionFilePath: resolvedRecord.sessionFilePath,
			title: resolvedRecord.title,
			cwd: resolvedRecord.cwd,
			createdAt: resolvedRecord.createdAt,
			updatedAt: resolvedRecord.updatedAt,
			agentMode: resolvedRecord.agentMode,
			consumedProposedPlanMessageIds: [],
			model: {
				id: resolvedRecord.modelId ?? "desktop-session-model",
				name: resolvedRecord.modelId ?? "Desktop Session Model",
				api: "openai-completions",
				provider: resolvedRecord.provider ?? "openai",
				baseUrl: "",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			},
			thinkingLevel: "off",
			messages: [],
		};
		try {
			const content = await readFile(resolvedRecord.sessionFilePath, "utf8");
			const entries = parseSessionEntries(content);
			migrateSessionEntries(entries);
			return createPersistedSessionFromFile(resolvedRecord.sessionFilePath, entries, fallback);
		} catch (error) {
			if (isMissingFileError(error)) {
				return null;
			}
			throw error;
		}
	}

	async save(session: DesktopPersistedSession): Promise<DesktopPersistedSession> {
		if (!session.sessionFilePath) {
			throw new Error(`Session '${session.id}' is missing a session file path.`);
		}
		const now = this.getNow();
		const currentContent = await readFile(session.sessionFilePath, "utf8");
		const fileEntries = parseSessionEntries(currentContent);
		const currentEntries = getSessionEntries(fileEntries);
		const currentMetadata = resolveMetadata(currentEntries);
		const metadata: DesktopSessionMetadata = {
			title: deriveSessionTitle(session.messages, session.title),
			agentMode: resolveDesktopAgentMode(session.agentMode),
			consumedProposedPlanMessageIds: resolveConsumedProposedPlanMessageIds(session.consumedProposedPlanMessageIds),
			taskProgress: resolveDesktopTaskProgress(session.taskProgress),
			model: session.model,
			thinkingLevel: session.thinkingLevel,
			updatedAt: now.toISOString(),
		};
		const nextEntries = [...fileEntries];
		if (hasMetadataPayloadChanged(currentMetadata, metadata)) {
			const entry = {
				...createMetadataEntry(metadata),
				id: createEntryId(),
				parentId: currentEntries.at(-1)?.id ?? null,
				timestamp: now.toISOString(),
			} as SessionEntry;
			nextEntries.push(entry);
			await writeFile(session.sessionFilePath, stringifyJsonlEntry(entry), { encoding: "utf8", flag: "a" });
		}
		const loaded = createPersistedSessionFromFile(session.sessionFilePath, nextEntries, session);
		if (!loaded) {
			throw new Error(`Session '${session.id}' could not be reloaded after save.`);
		}
		await this.upsertIndex(loaded);
		return loaded;
	}

	async create(options: CreateDesktopSessionOptions): Promise<DesktopPersistedSession> {
		const timestamp = this.getNow();
		const sessionId = options.id ?? randomUUID();
		const sessionFilePath = getDesktopSessionFilePath(this.sessionsDir, sessionId, timestamp);
		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: sessionId,
			timestamp: timestamp.toISOString(),
			cwd: options.cwd,
		};
		const entries: SessionEntry[] = [];
		appendEntry(
			entries,
			{
				type: "model_change",
				provider: options.model.provider,
				modelId: options.model.id,
			},
			timestamp,
		);
		appendEntry(
			entries,
			{
				type: "thinking_level_change",
				thinkingLevel: options.thinkingLevel,
			},
			timestamp,
		);
		appendEntry(
			entries,
			createMetadataEntry({
				title: options.title ?? DEFAULT_SESSION_TITLE,
				agentMode: options.agentMode ?? DEFAULT_DESKTOP_AGENT_MODE,
				consumedProposedPlanMessageIds: [],
				model: options.model,
				thinkingLevel: options.thinkingLevel,
				updatedAt: timestamp.toISOString(),
			}),
			timestamp,
		);
		for (const message of options.messages ?? []) {
			appendEntry(
				entries,
				{
					type: "message",
					message,
				},
				timestamp,
			);
		}

		await mkdir(dirname(sessionFilePath), { recursive: true });
		await writeFile(
			sessionFilePath,
			[header, ...entries].map((entry) => stringifyJsonlEntry(entry)).join(""),
			"utf8",
		);
		const session = createPersistedSessionFromFile(sessionFilePath, [header, ...entries]);
		if (!session) {
			throw new Error(`Session '${sessionId}' could not be created.`);
		}
		await this.upsertIndex(session);
		return session;
	}

	async importEntries(
		entries: FileEntry[],
		fallback?: DesktopPersistedSession,
	): Promise<DesktopPersistedSession | null> {
		const header = getSessionHeader(entries);
		if (!header) {
			return null;
		}
		const createdAt = new Date(header.timestamp);
		const sessionFilePath = getDesktopSessionFilePath(
			this.sessionsDir,
			header.id,
			Number.isNaN(createdAt.getTime()) ? this.getNow() : createdAt,
		);
		await mkdir(dirname(sessionFilePath), { recursive: true });
		await writeFile(sessionFilePath, entries.map((entry) => stringifyJsonlEntry(entry)).join(""), "utf8");
		const session = createPersistedSessionFromFile(sessionFilePath, entries, fallback);
		if (!session) {
			return null;
		}
		await this.upsertIndex(session);
		return session;
	}

	async delete(sessionId: string): Promise<boolean> {
		const record = (await this.readIndex())[sessionId];
		if (!record) {
			return false;
		}
		await this.appendIndexEvent({
			type: "session_delete",
			timestamp: this.getNow().toISOString(),
			sessionId,
		});

		try {
			await rm(record.sessionFilePath, { force: true });
		} catch (error) {
			if (!isMissingFileError(error)) {
				throw error;
			}
		}

		return true;
	}
}
