import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopInstructionStore } from "../../src/main/storage/instruction-store.ts";
import { DesktopSettingsStore } from "../../src/main/storage/settings-store.ts";
import {
	DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
	DEFAULT_DESKTOP_COMPACT_INSTRUCTION,
	DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
} from "../../src/shared/types.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-settings-store-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

describe("DesktopSettingsStore", () => {
	it("persists settings to disk", async () => {
		const directoryPath = createTempDirectory();
		const filePath = join(directoryPath, "settings.json");
		const store = new DesktopSettingsStore(filePath);

		await store.set("defaultProvider", "anthropic");
		await store.set("defaultThinkingLevel", "medium");
		await store.set("appearance", {
			...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
			themeMode: "dark",
			darkTheme: {
				...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme,
				accentColor: "#cc7d5e",
				contrast: 60,
			},
		});

		const reloadedStore = new DesktopSettingsStore(filePath);
		expect(await reloadedStore.getAll()).toEqual({
			appearance: {
				...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
				themeMode: "dark",
				darkTheme: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme,
					accentColor: "#cc7d5e",
					contrast: 60,
				},
			},
			defaultProvider: "anthropic",
			defaultThinkingLevel: "medium",
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
			showThinkingBlocks: false,
		});
	});

	it("fills default appearance font sizes for legacy settings", async () => {
		const directoryPath = createTempDirectory();
		const filePath = join(directoryPath, "settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					appearance: {
						themeMode: "dark",
						lightTheme: DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme,
						darkTheme: DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme,
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const store = new DesktopSettingsStore(filePath);

		expect(await store.get("appearance")).toEqual({
			...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
			themeMode: "dark",
			uiFontSize: 13,
			codeFontSize: 12,
		});
	});

	it("keeps instruction resources out of settings.json", async () => {
		const directoryPath = createTempDirectory();
		const filePath = join(directoryPath, "settings.json");
		const store = new DesktopSettingsStore(filePath);

		await expect(store.set("globalAgentsInstruction", "Always keep responses concise.")).rejects.toThrow(
			"Agent Home resource",
		);
		await expect(store.set("compactInstruction", DEFAULT_DESKTOP_COMPACT_INSTRUCTION)).rejects.toThrow(
			"Agent Home resource",
		);
	});

	it("migrates legacy instruction settings into Agent Home resources", async () => {
		const directoryPath = createTempDirectory();
		const agentDir = join(directoryPath, ".skylark");
		const settingsPath = join(agentDir, "settings.json");
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			settingsPath,
			JSON.stringify(
				{
					defaultProvider: "anthropic",
					compactInstruction: "Preserve the validation plan.",
					globalAgentsInstruction: "Always keep answers concise.",
				},
				null,
				2,
			),
			"utf8",
		);
		const settingsStore = new DesktopSettingsStore(settingsPath);
		const instructionStore = new DesktopInstructionStore({ agentDir });

		await instructionStore.migrateLegacySettings(settingsStore);

		expect(await readFile(join(agentDir, "COMPACT.md"), "utf8")).toBe("Preserve the validation plan.\n");
		expect(await readFile(join(agentDir, "AGENTS.md"), "utf8")).toBe("Always keep answers concise.\n");
		const persistedSettings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
		expect(persistedSettings).not.toHaveProperty("compactInstruction");
		expect(persistedSettings).not.toHaveProperty("globalAgentsInstruction");
		expect(persistedSettings.defaultProvider).toBe("anthropic");
	});
});
