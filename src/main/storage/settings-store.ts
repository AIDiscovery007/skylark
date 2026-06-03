import {
	DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
	DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
	type DesktopAppearanceSettings,
	type DesktopSettingKey,
	type DesktopSettingsData,
	resolveDesktopPermissionApprovalSettings,
} from "../../shared/types.ts";
import { JsonFileStore } from "./json-file-store.ts";

const MIN_APPEARANCE_FONT_SIZE = 10;
const MAX_APPEARANCE_FONT_SIZE = 20;
const DEFAULT_SETTINGS: DesktopSettingsData = {
	permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
	showThinkingBlocks: false,
};
const RESOURCE_BACKED_SETTING_KEYS = new Set<DesktopSettingKey>(["compactInstruction", "globalAgentsInstruction"]);

function normalizeAppearanceFontSize(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(MAX_APPEARANCE_FONT_SIZE, Math.max(MIN_APPEARANCE_FONT_SIZE, Math.round(value)));
}

function normalizeAppearanceSettings(
	appearance: DesktopSettingsData["appearance"],
): DesktopAppearanceSettings | undefined {
	if (!appearance) {
		return undefined;
	}
	const candidate = appearance as Partial<DesktopAppearanceSettings>;
	return {
		...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
		...candidate,
		uiFontSize: normalizeAppearanceFontSize(candidate.uiFontSize, DEFAULT_DESKTOP_APPEARANCE_SETTINGS.uiFontSize),
		codeFontSize: normalizeAppearanceFontSize(
			candidate.codeFontSize,
			DEFAULT_DESKTOP_APPEARANCE_SETTINGS.codeFontSize,
		),
		lightTheme: {
			...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme,
			...(candidate.lightTheme ?? {}),
		},
		darkTheme: {
			...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme,
			...(candidate.darkTheme ?? {}),
		},
	};
}

function normalizeSettings(settings: DesktopSettingsData): DesktopSettingsData {
	const {
		compactInstruction: _compactInstruction,
		globalAgentsInstruction: _globalAgentsInstruction,
		...rest
	} = settings;
	const appearance = normalizeAppearanceSettings(settings.appearance);
	return {
		...DEFAULT_SETTINGS,
		...rest,
		...(appearance ? { appearance } : {}),
		permissionApprovals: resolveDesktopPermissionApprovalSettings(settings),
	};
}

export class DesktopSettingsStore {
	private readonly store: JsonFileStore<DesktopSettingsData>;

	constructor(filePath: string) {
		this.store = new JsonFileStore(filePath, DEFAULT_SETTINGS);
	}

	async getAll(): Promise<DesktopSettingsData> {
		return normalizeSettings(await this.store.read());
	}

	async getLegacyInstructionSettings(): Promise<
		Pick<DesktopSettingsData, "compactInstruction" | "globalAgentsInstruction">
	> {
		const settings = await this.store.read();
		return {
			compactInstruction: typeof settings.compactInstruction === "string" ? settings.compactInstruction : undefined,
			globalAgentsInstruction:
				typeof settings.globalAgentsInstruction === "string" ? settings.globalAgentsInstruction : undefined,
		};
	}

	async clearLegacyInstructionSettings(): Promise<void> {
		await this.store.update((current) => normalizeSettings(current));
	}

	async get<TKey extends DesktopSettingKey>(key: TKey): Promise<DesktopSettingsData[TKey]> {
		const settings = await this.getAll();
		return settings[key];
	}

	async set<TKey extends DesktopSettingKey>(key: TKey, value: DesktopSettingsData[TKey]): Promise<void> {
		if (RESOURCE_BACKED_SETTING_KEYS.has(key)) {
			throw new Error(`Setting '${key}' is stored as an Agent Home resource.`);
		}
		await this.store.update((current) => ({
			...normalizeSettings(current),
			[key]: value,
		}));
	}
}
