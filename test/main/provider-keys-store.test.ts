import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopProviderKeysStore, type DesktopSecretStorage } from "../../src/main/storage/provider-keys-store.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-provider-keys-store-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

class FakeSecretStorage implements DesktopSecretStorage {
	constructor(private readonly available: boolean) {}

	isAvailable(): boolean {
		return this.available;
	}

	encrypt(value: string): string {
		return `enc:${value}`;
	}

	decrypt(value: string): string {
		return value.replace(/^enc:/, "");
	}
}

describe("DesktopProviderKeysStore", () => {
	it("stores encrypted provider keys when secure storage is available", async () => {
		const directoryPath = createTempDirectory();
		const filePath = join(directoryPath, "provider-keys.json");
		const store = new DesktopProviderKeysStore(filePath, new FakeSecretStorage(true));

		await store.set("anthropic", "secret-value");

		expect(await store.get("anthropic")).toBe("secret-value");
		expect(await store.list()).toEqual([{ provider: "anthropic", configured: true }]);
		expect(store.getSecurityState()).toEqual({
			secureStorageAvailable: true,
			providerKeysEncrypted: true,
		});
	});

	it("falls back to plaintext storage when secure storage is unavailable", async () => {
		const directoryPath = createTempDirectory();
		const filePath = join(directoryPath, "provider-keys.json");
		const store = new DesktopProviderKeysStore(filePath, new FakeSecretStorage(false));

		await store.set("openai", "plain-secret");

		expect(await store.has("openai")).toBe(true);
		expect(await store.get("openai")).toBe("plain-secret");
		expect(store.getSecurityState()).toEqual({
			secureStorageAvailable: false,
			providerKeysEncrypted: false,
		});

		await store.delete("openai");
		expect(await store.has("openai")).toBe(false);
	});

	it("canonicalizes legacy kimi coding base url keys to the kimi-coding provider id", async () => {
		const directoryPath = createTempDirectory();
		const filePath = join(directoryPath, "provider-keys.json");
		const store = new DesktopProviderKeysStore(filePath, new FakeSecretStorage(false));

		await store.set("https://api.kimi.com/coding", "kimi-secret");

		expect(await store.get("kimi-coding")).toBe("kimi-secret");
		expect(await store.has("kimi-coding")).toBe(true);
		expect(await store.list()).toEqual([{ provider: "kimi-coding", configured: true }]);

		await store.delete("kimi-coding");
		expect(await store.has("https://api.kimi.com/coding")).toBe(false);
		expect(await store.list()).toEqual([]);
	});
});
