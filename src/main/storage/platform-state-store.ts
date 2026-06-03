import type { DesktopWindowKind, DesktopWindowState } from "../../shared/types.ts";
import { JsonFileStore } from "./json-file-store.ts";

export interface DesktopPlatformStateData {
	windowStates?: Partial<Record<DesktopWindowKind, DesktopWindowState>>;
}

export type DesktopPlatformStateKey = keyof DesktopPlatformStateData;

export class DesktopPlatformStateStore {
	private readonly store: JsonFileStore<DesktopPlatformStateData>;

	constructor(filePath: string) {
		this.store = new JsonFileStore(filePath, {});
	}

	async getAll(): Promise<DesktopPlatformStateData> {
		return this.store.read();
	}

	async get<TKey extends DesktopPlatformStateKey>(key: TKey): Promise<DesktopPlatformStateData[TKey]> {
		const state = await this.getAll();
		return state[key];
	}

	async set<TKey extends DesktopPlatformStateKey>(key: TKey, value: DesktopPlatformStateData[TKey]): Promise<void> {
		await this.store.update((current) => ({
			...current,
			[key]: value,
		}));
	}
}
