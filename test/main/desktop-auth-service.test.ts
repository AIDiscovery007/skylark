import type { OAuthCredentials, OAuthProviderInterface } from "@earendil-works/pi-ai";
import { type AuthCredential, AuthStorage } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopAuthService } from "../../src/main/auth/desktop-auth-service.ts";
import type { DesktopProviderKeysStore } from "../../src/main/storage/provider-keys-store.ts";
import type { DesktopOAuthLoginEvent } from "../../src/shared/types.ts";
import { registerOAuthProvider, resetOAuthProviders } from "../support/pi-provider-test-registry.ts";

type AuthStorageData = Record<string, AuthCredential>;

class FakeProviderKeysStore {
	private readonly keys = new Map<string, string>();

	constructor(keys: Record<string, string> = {}) {
		for (const [provider, key] of Object.entries(keys)) {
			this.keys.set(provider, key);
		}
	}

	async get(provider: string): Promise<string | undefined> {
		return this.keys.get(provider);
	}

	async has(provider: string): Promise<boolean> {
		return this.keys.has(provider);
	}
}

function createAuthService(options: {
	authData?: AuthStorageData;
	desktopKeys?: Record<string, string>;
	openExternal?: (url: string) => Promise<void>;
}): { authStorage: AuthStorage; service: DesktopAuthService } {
	const authStorage = AuthStorage.inMemory(options.authData);
	const providerKeysStore = new FakeProviderKeysStore(options.desktopKeys) as unknown as DesktopProviderKeysStore;
	const service = new DesktopAuthService(
		providerKeysStore,
		authStorage,
		options.openExternal ?? (async () => undefined),
	);
	return { authStorage, service };
}

function createOAuthCredentials(overrides: Partial<OAuthCredentials> = {}): OAuthCredentials {
	return {
		access: "shared-token",
		refresh: "refresh-token",
		expires: Date.now() + 60_000,
		...overrides,
	};
}

function registerTestOAuthProvider(id: string, provider: Partial<OAuthProviderInterface>): void {
	registerOAuthProvider({
		id,
		name: `${id} Test`,
		usesCallbackServer: true,
		async login() {
			return createOAuthCredentials();
		},
		async refreshToken(credentials) {
			return credentials;
		},
		getApiKey(credentials) {
			return credentials.access;
		},
		...provider,
	});
}

function registerOpenAICodexOAuthProvider(provider: Partial<OAuthProviderInterface>): void {
	registerTestOAuthProvider("openai-codex", { name: "OpenAI Codex Test", ...provider });
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt++) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for condition.");
}

afterEach(() => {
	resetOAuthProviders();
});

describe("DesktopAuthService", () => {
	it("lists desktop OAuth providers from the pi-ai registry", () => {
		registerTestOAuthProvider("anthropic", { name: "Anthropic Test" });
		registerTestOAuthProvider("github-copilot", { name: "GitHub Copilot Test", usesCallbackServer: false });
		registerTestOAuthProvider("openai-codex", { name: "OpenAI Codex Test" });
		const { service } = createAuthService({
			authData: {
				anthropic: {
					type: "oauth",
					...createOAuthCredentials(),
				},
			},
		});

		expect(service.listOAuthProviders()).toEqual([
			{
				id: "anthropic",
				name: "Anthropic Test",
				configured: true,
				source: "shared-auth",
				usesCallbackServer: true,
			},
			{
				id: "github-copilot",
				name: "GitHub Copilot Test",
				configured: false,
				source: "shared-auth",
				usesCallbackServer: false,
			},
			{
				id: "openai-codex",
				name: "OpenAI Codex Test",
				configured: false,
				source: "shared-auth",
				usesCallbackServer: true,
			},
		]);
	});

	it("resolves desktop API keys before shared auth storage", async () => {
		registerOpenAICodexOAuthProvider({});
		const { service } = createAuthService({
			desktopKeys: { "openai-codex": "desktop-key" },
			authData: {
				"openai-codex": {
					type: "oauth",
					...createOAuthCredentials({ access: "shared-key" }),
				},
			},
		});

		await expect(service.getApiKey("openai-codex")).resolves.toBe("desktop-key");
	});

	it("refreshes expired shared OAuth tokens through AuthStorage", async () => {
		const refreshToken = vi.fn(async () => createOAuthCredentials({ access: "refreshed-token" }));
		registerOpenAICodexOAuthProvider({ refreshToken });
		const { service } = createAuthService({
			authData: {
				"openai-codex": {
					type: "oauth",
					...createOAuthCredentials({ access: "expired-token", expires: Date.now() - 1 }),
				},
			},
		});

		await expect(service.getApiKey("openai-codex")).resolves.toBe("refreshed-token");
		expect(refreshToken).toHaveBeenCalledTimes(1);
	});

	it("logs out only the OpenAI Codex OAuth credential", () => {
		registerOpenAICodexOAuthProvider({});
		const { authStorage, service } = createAuthService({
			authData: {
				"openai-codex": {
					type: "oauth",
					...createOAuthCredentials(),
				},
				anthropic: {
					type: "api_key",
					key: "anthropic-key",
				},
			},
		});
		const events: DesktopOAuthLoginEvent[] = [];
		service.subscribe((event) => events.push(event));

		service.logoutOAuthProvider("openai-codex");

		expect(authStorage.get("openai-codex")).toBeUndefined();
		expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "anthropic-key" });
		expect(events).toEqual([{ type: "credentials_changed", provider: "openai-codex" }]);
	});

	it("emits browser callback login events and opens the authorization URL", async () => {
		registerTestOAuthProvider("anthropic", {
			name: "Anthropic Test",
			async login(callbacks) {
				const selectedMethod = await callbacks.onSelect({
					message: "Select login method:",
					options: [
						{ id: "device_code", label: "Device code login" },
						{ id: "browser", label: "Browser login" },
					],
				});
				expect(selectedMethod).toBe("browser");
				callbacks.onAuth({ url: "https://auth.test/anthropic", instructions: "Complete login." });
				return createOAuthCredentials({ access: "callback-token" });
			},
		});
		const openExternal = vi.fn(async () => undefined);
		const { authStorage, service } = createAuthService({ openExternal });
		const events: DesktopOAuthLoginEvent[] = [];
		service.subscribe((event) => events.push(event));

		service.startOAuthLogin("anthropic");

		await waitUntil(() => events.some((event) => event.type === "success"));
		expect(openExternal).toHaveBeenCalledWith("https://auth.test/anthropic");
		expect(events.map((event) => event.type)).toEqual(["auth_url", "success", "credentials_changed"]);
		expect(events.map((event) => event.provider)).toEqual(["anthropic", "anthropic", "anthropic"]);
		expect(authStorage.get("anthropic")).toMatchObject({ type: "oauth", access: "callback-token" });
	});

	it("emits device-code login progress and opens the verification URL", async () => {
		registerOpenAICodexOAuthProvider({
			async login(callbacks) {
				callbacks.onDeviceCode({
					userCode: "ABCD-EFGH",
					verificationUri: "https://auth.test/device",
					expiresInSeconds: 900,
				});
				return createOAuthCredentials({ access: "device-token" });
			},
		});
		const openExternal = vi.fn(async () => undefined);
		const { authStorage, service } = createAuthService({ openExternal });
		const events: DesktopOAuthLoginEvent[] = [];
		service.subscribe((event) => events.push(event));

		service.startOAuthLogin("openai-codex");

		await waitUntil(() => events.some((event) => event.type === "success"));
		expect(openExternal).toHaveBeenCalledWith("https://auth.test/device");
		expect(events).toContainEqual({
			type: "progress",
			provider: "openai-codex",
			message: "Open https://auth.test/device and enter code ABCD-EFGH. Code expires in 15 minutes.",
		});
		expect(authStorage.get("openai-codex")).toMatchObject({ type: "oauth", access: "device-token" });
	});

	it("accepts manual redirect URL fallback during login", async () => {
		registerOpenAICodexOAuthProvider({
			async login(callbacks) {
				callbacks.onAuth({ url: "https://auth.test/codex" });
				const code = await callbacks.onManualCodeInput?.();
				return createOAuthCredentials({ access: `manual:${code}` });
			},
		});
		const { authStorage, service } = createAuthService({});
		const events: DesktopOAuthLoginEvent[] = [];
		service.subscribe((event) => events.push(event));

		service.startOAuthLogin("openai-codex");
		await waitUntil(() => events.some((event) => event.type === "manual_code_prompt"));
		service.submitOAuthLoginCode("openai-codex", "http://localhost:1455/auth/callback?code=test");

		await waitUntil(() => events.some((event) => event.type === "success"));
		expect(authStorage.get("openai-codex")).toMatchObject({
			type: "oauth",
			access: "manual:http://localhost:1455/auth/callback?code=test",
		});
	});

	it("cancels pending login state on dispose", async () => {
		registerOpenAICodexOAuthProvider({
			async login(callbacks) {
				await callbacks.onManualCodeInput?.();
				return createOAuthCredentials({ access: "unreachable-token" });
			},
		});
		const { service } = createAuthService({});
		const events: DesktopOAuthLoginEvent[] = [];
		service.subscribe((event) => events.push(event));

		service.startOAuthLogin("openai-codex");
		await waitUntil(() => events.some((event) => event.type === "manual_code_prompt"));
		service.dispose();

		expect(events.at(-1)).toEqual({ type: "cancelled", provider: "openai-codex" });
		expect(() => service.submitOAuthLoginCode("openai-codex", "unused-code")).toThrow(
			"No OAuth login in progress for openai-codex.",
		);
	});
});
