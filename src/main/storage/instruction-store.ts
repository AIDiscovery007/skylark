import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_DESKTOP_COMPACT_INSTRUCTION, type DesktopSettingsData } from "../../shared/types.ts";
import { isMissingFileError } from "./fs-errors.ts";
import type { DesktopSettingsStore } from "./settings-store.ts";

export const DESKTOP_GLOBAL_AGENTS_FILE_NAME = "AGENTS.md";
export const DESKTOP_COMPACT_INSTRUCTION_FILE_NAME = "COMPACT.md";

interface DesktopInstructionStoreOptions {
	agentDir: string;
}

function normalizeInstruction(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

async function writeTextFile(filePath: string, content: string): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	const tempFilePath = `${filePath}.${randomUUID()}.tmp`;
	await writeFile(tempFilePath, `${content.trim()}\n`, "utf8");
	await rename(tempFilePath, filePath);
}

async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
	try {
		return normalizeInstruction(await readFile(filePath, "utf8"));
	} catch (error) {
		if (isMissingFileError(error)) {
			return undefined;
		}
		throw error;
	}
}

async function removeOptionalFile(filePath: string): Promise<void> {
	try {
		await rm(filePath);
	} catch (error) {
		if (!isMissingFileError(error)) {
			throw error;
		}
	}
}

export class DesktopInstructionStore {
	readonly globalAgentsFilePath: string;
	readonly compactInstructionFilePath: string;

	constructor(options: DesktopInstructionStoreOptions) {
		this.globalAgentsFilePath = join(options.agentDir, DESKTOP_GLOBAL_AGENTS_FILE_NAME);
		this.compactInstructionFilePath = join(options.agentDir, DESKTOP_COMPACT_INSTRUCTION_FILE_NAME);
	}

	async migrateLegacySettings(settingsStore: DesktopSettingsStore): Promise<void> {
		const legacy = await settingsStore.getLegacyInstructionSettings();
		const compactInstruction = normalizeInstruction(legacy.compactInstruction);
		const globalAgentsInstruction = normalizeInstruction(legacy.globalAgentsInstruction);

		if (compactInstruction) {
			await this.setCompactInstruction(compactInstruction);
		} else if (!(await readOptionalTextFile(this.compactInstructionFilePath))) {
			await this.setCompactInstruction(DEFAULT_DESKTOP_COMPACT_INSTRUCTION);
		}
		if (globalAgentsInstruction) {
			await this.setGlobalAgentsInstruction(globalAgentsInstruction);
		}
		await settingsStore.clearLegacyInstructionSettings();
	}

	async getAll(): Promise<Pick<DesktopSettingsData, "compactInstruction" | "globalAgentsInstruction">> {
		return {
			compactInstruction: await this.getCompactInstruction(),
			globalAgentsInstruction: await this.getGlobalAgentsInstruction(),
		};
	}

	async getCompactInstruction(): Promise<string> {
		return (await readOptionalTextFile(this.compactInstructionFilePath)) ?? DEFAULT_DESKTOP_COMPACT_INSTRUCTION;
	}

	async setCompactInstruction(value: string | undefined): Promise<void> {
		await writeTextFile(
			this.compactInstructionFilePath,
			normalizeInstruction(value) ?? DEFAULT_DESKTOP_COMPACT_INSTRUCTION,
		);
	}

	async getGlobalAgentsInstruction(): Promise<string | undefined> {
		return readOptionalTextFile(this.globalAgentsFilePath);
	}

	async setGlobalAgentsInstruction(value: string | undefined): Promise<void> {
		const normalized = normalizeInstruction(value);
		if (!normalized) {
			await removeOptionalFile(this.globalAgentsFilePath);
			return;
		}
		await writeTextFile(this.globalAgentsFilePath, normalized);
	}
}
