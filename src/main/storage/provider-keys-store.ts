import { safeStorage } from "electron";
import { getDesktopProviderAliases, normalizeDesktopProviderIdentifier } from "../../shared/provider-id.ts";
import type { DesktopProviderKeyStatus, DesktopStorageSecurityState } from "../../shared/types.ts";
import { JsonFileStore } from "./json-file-store.ts";

interface StoredProviderKey {
	encrypted: boolean;
	value: string;
}

type ProviderKeyMap = Record<string, StoredProviderKey>;

export interface DesktopSecretStorage {
	isAvailable(): boolean;
	encrypt(value: string): string;
	decrypt(value: string): string;
}

export class ElectronSafeStorageAdapter implements DesktopSecretStorage {
	isAvailable(): boolean {
		return safeStorage.isEncryptionAvailable();
	}

	encrypt(value: string): string {
		return safeStorage.encryptString(value).toString("base64");
	}

	decrypt(value: string): string {
		return safeStorage.decryptString(Buffer.from(value, "base64"));
	}
}

export class DesktopProviderKeysStore {
	private readonly store: JsonFileStore<ProviderKeyMap>;
	private readonly decryptedValueCache = new Map<string, string>();

	constructor(
		filePath: string,
		private readonly secretStorage: DesktopSecretStorage = new ElectronSafeStorageAdapter(),
	) {
		this.store = new JsonFileStore(filePath, {});
	}

	async get(provider: string): Promise<string | undefined> {
		const canonicalProvider = normalizeDesktopProviderIdentifier(provider);
		const cachedValue = this.decryptedValueCache.get(canonicalProvider);
		if (cachedValue !== undefined) {
			return cachedValue;
		}

		const keyMap = await this.store.read();
		const storedValue = this.findStoredProviderValue(keyMap, provider);
		if (!storedValue) {
			this.decryptedValueCache.delete(canonicalProvider);
			return undefined;
		}

		if (!storedValue.encrypted) {
			this.decryptedValueCache.set(canonicalProvider, storedValue.value);
			return storedValue.value;
		}

		const decryptedValue = this.secretStorage.decrypt(storedValue.value);
		this.decryptedValueCache.set(canonicalProvider, decryptedValue);
		return decryptedValue;
	}

	async set(provider: string, key: string): Promise<void> {
		const canonicalProvider = normalizeDesktopProviderIdentifier(provider);
		const encrypted = this.secretStorage.isAvailable();
		const storedValue: StoredProviderKey = {
			encrypted,
			value: encrypted ? this.secretStorage.encrypt(key) : key,
		};

		await this.store.update((current) => {
			const next = { ...current };
			for (const alias of getDesktopProviderAliases(provider)) {
				delete next[alias];
			}
			next[canonicalProvider] = storedValue;
			return next;
		});
		this.decryptedValueCache.set(canonicalProvider, key);
	}

	async delete(provider: string): Promise<void> {
		const canonicalProvider = normalizeDesktopProviderIdentifier(provider);
		await this.store.update((current) => {
			const next = { ...current };
			for (const alias of getDesktopProviderAliases(provider)) {
				delete next[alias];
			}
			for (const key of Object.keys(next)) {
				if (normalizeDesktopProviderIdentifier(key) === normalizeDesktopProviderIdentifier(provider)) {
					delete next[key];
				}
			}
			return next;
		});
		this.decryptedValueCache.delete(canonicalProvider);
		for (const alias of getDesktopProviderAliases(provider)) {
			this.decryptedValueCache.delete(normalizeDesktopProviderIdentifier(alias));
		}
	}

	async has(provider: string): Promise<boolean> {
		const keyMap = await this.store.read();
		return this.findStoredProviderValue(keyMap, provider) !== undefined;
	}

	async list(): Promise<DesktopProviderKeyStatus[]> {
		const keyMap = await this.store.read();
		return [...new Set(Object.keys(keyMap).map((provider) => normalizeDesktopProviderIdentifier(provider)))]
			.sort()
			.map((provider) => ({ provider, configured: true }));
	}

	getSecurityState(): DesktopStorageSecurityState {
		const secureStorageAvailable = this.secretStorage.isAvailable();

		return {
			secureStorageAvailable,
			providerKeysEncrypted: secureStorageAvailable,
		};
	}

	private findStoredProviderValue(keyMap: ProviderKeyMap, provider: string): StoredProviderKey | undefined {
		for (const alias of getDesktopProviderAliases(provider)) {
			const aliasValue = keyMap[alias];
			if (aliasValue) {
				return aliasValue;
			}
		}

		const canonicalProvider = normalizeDesktopProviderIdentifier(provider);
		for (const [storedProvider, storedValue] of Object.entries(keyMap)) {
			if (normalizeDesktopProviderIdentifier(storedProvider) === canonicalProvider) {
				return storedValue;
			}
		}

		return undefined;
	}
}
