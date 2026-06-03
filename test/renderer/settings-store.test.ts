import { describe, expect, it, vi } from "vitest";
import { createSettingsStore } from "../../src/renderer/stores/settings-store.ts";
import {
	DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
	DEFAULT_DESKTOP_COMPACT_INSTRUCTION,
	DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
} from "../../src/shared/types.ts";

describe("settingsStore", () => {
	it("hydrates boot settings from the workspace overview", () => {
		const store = createSettingsStore();

		store.getState().applyWorkspaceOverview({
			settings: {
				defaultProvider: "openai",
				defaultModel: "gpt-5.5",
				defaultThinkingLevel: "high",
			},
			projects: [],
			sessionsByProjectId: {},
		});

		const state = store.getState();
		expect(state.settings.defaultProvider).toBe("openai");
		expect(state.settings.defaultModel).toBe("gpt-5.5");
		expect(state.hasLoadedSettings).toBe(true);
		expect(state.hasLoadedDetails).toBe(false);
	});

	it("does not let workspace overview omit hydrated Agent Home instruction resources", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(async () => ({ defaultTools: ["read", "bash"], providers: [] })),
			getSettings: vi.fn(async () => ({
				compactInstruction: DEFAULT_DESKTOP_COMPACT_INSTRUCTION,
				globalAgentsInstruction: "Always keep responses concise.",
				showThinkingBlocks: false,
			})),
			setSetting: vi.fn(),
			listProviderKeys: vi.fn(async () => []),
			listOAuthProviders: vi.fn(async () => []),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(async () => ({
				secureStorageAvailable: true,
				providerKeysEncrypted: true,
			})),
			getEventManagementCriteria: vi.fn(async () => ({
				path: "/Users/qiaochao/.skylark/events/EVENTS.md",
				content: "Use P0 for blockers.",
			})),
		};

		await store.getState().loadSettingsDetails(bridge);
		store.getState().applyWorkspaceOverview({
			settings: {
				defaultProvider: "openai",
				showThinkingBlocks: false,
			},
			projects: [],
			sessionsByProjectId: {},
		});

		expect(store.getState().settings.globalAgentsInstruction).toBe("Always keep responses concise.");
		expect(store.getState().settings.compactInstruction).toBe(DEFAULT_DESKTOP_COMPACT_INSTRUCTION);
		expect(store.getState().eventManagementCriteria?.content).toBe("Use P0 for blockers.");
	});

	it("does not let settings events omit hydrated Agent Home instruction resources", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(async () => ({ defaultTools: ["read", "bash"], providers: [] })),
			getSettings: vi.fn(async () => ({
				compactInstruction: DEFAULT_DESKTOP_COMPACT_INSTRUCTION,
				globalAgentsInstruction: "Always keep responses concise.",
				showThinkingBlocks: false,
			})),
			setSetting: vi.fn(),
			listProviderKeys: vi.fn(async () => []),
			listOAuthProviders: vi.fn(async () => []),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(async () => ({
				secureStorageAvailable: true,
				providerKeysEncrypted: true,
			})),
		};

		await store.getState().loadSettingsDetails(bridge);
		store.getState().applySettingsEvent({
			type: "settings_updated",
			settings: {
				showThinkingBlocks: true,
			},
		});

		expect(store.getState().settings.showThinkingBlocks).toBe(true);
		expect(store.getState().settings.globalAgentsInstruction).toBe("Always keep responses concise.");
		expect(store.getState().settings.compactInstruction).toBe(DEFAULT_DESKTOP_COMPACT_INSTRUCTION);
	});

	it("does not let detail reloads omit hydrated instruction resources", async () => {
		const store = createSettingsStore();
		const fullBridge = {
			getRuntimeCatalog: vi.fn(async () => ({ defaultTools: ["read", "bash"], providers: [] })),
			getSettings: vi.fn(async () => ({
				compactInstruction: DEFAULT_DESKTOP_COMPACT_INSTRUCTION,
				globalAgentsInstruction: "Always keep responses concise.",
				showThinkingBlocks: false,
			})),
			setSetting: vi.fn(),
			listProviderKeys: vi.fn(async () => []),
			listOAuthProviders: vi.fn(async () => []),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(async () => ({
				secureStorageAvailable: true,
				providerKeysEncrypted: true,
			})),
			getEventManagementCriteria: vi.fn(async () => ({
				path: "/Users/qiaochao/.skylark/events/EVENTS.md",
				content: "Use P0 for blockers.",
			})),
		};
		const shallowBridge = {
			...fullBridge,
			getSettings: vi.fn(async () => ({
				showThinkingBlocks: true,
			})),
			getEventManagementCriteria: undefined,
		};

		await store.getState().loadSettingsDetails(fullBridge);
		await store.getState().loadSettingsDetails(shallowBridge);

		expect(store.getState().settings.showThinkingBlocks).toBe(true);
		expect(store.getState().settings.globalAgentsInstruction).toBe("Always keep responses concise.");
		expect(store.getState().settings.compactInstruction).toBe(DEFAULT_DESKTOP_COMPACT_INSTRUCTION);
		expect(store.getState().eventManagementCriteria?.content).toBe("Use P0 for blockers.");
	});

	it("loads boot settings without provider details", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(),
			getSettings: vi.fn(async () => ({
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-20250514",
				defaultThinkingLevel: "medium" as const,
				showThinkingBlocks: false,
			})),
			setSetting: vi.fn(),
			listProviderKeys: vi.fn(),
			listOAuthProviders: vi.fn(),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(),
		};

		await store.getState().loadSettings(bridge);

		const state = store.getState();
		expect(state.settings.defaultProvider).toBe("anthropic");
		expect(state.hasLoadedSettings).toBe(true);
		expect(state.hasLoadedDetails).toBe(false);
		expect(state.runtimeCatalog).toBe(undefined);
		expect(bridge.getRuntimeCatalog).not.toHaveBeenCalled();
		expect(bridge.listProviderKeys).not.toHaveBeenCalled();
	});

	it("loads the provider catalog without loading settings details", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(async () => ({
				providers: [
					{
						id: "openai-codex",
						name: "OpenAI Codex",
						configured: true,
						authMethods: ["oauth" as const],
						models: [{ id: "gpt-5.5", name: "GPT-5.5", reasoning: true, contextWindow: 256000 }],
					},
				],
				defaultTools: ["read", "bash", "edit", "write"],
			})),
			getSettings: vi.fn(),
			setSetting: vi.fn(),
			listProviderKeys: vi.fn(async () => [{ provider: "anthropic", configured: true }]),
			listOAuthProviders: vi.fn(async () => [
				{
					id: "openai-codex",
					name: "OpenAI Codex",
					configured: true,
					source: "shared-auth" as const,
					usesCallbackServer: true,
				},
			]),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(),
			getEventManagementCriteria: vi.fn(),
		};

		await store.getState().loadProviderCatalog(bridge);

		const state = store.getState();
		expect(state.runtimeCatalog?.providers[0]?.id).toBe("openai-codex");
		expect(state.providerKeys).toEqual([{ provider: "anthropic", configured: true }]);
		expect(state.oauthProviders[0]?.configured).toBe(true);
		expect(state.hasLoadedSettings).toBe(false);
		expect(state.hasLoadedDetails).toBe(false);
		expect(bridge.getSettings).not.toHaveBeenCalled();
		expect(bridge.getStorageSecurityState).not.toHaveBeenCalled();
		expect(bridge.getEventManagementCriteria).not.toHaveBeenCalled();
	});

	it("loads persisted settings, provider keys, and storage state on detail load", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(async () => ({
				providers: [
					{
						id: "anthropic",
						name: "Anthropic",
						configured: true,
						authMethods: ["api_key" as const],
						models: [
							{
								id: "claude-sonnet-4-20250514",
								name: "Claude Sonnet",
								reasoning: true,
								contextWindow: 200000,
							},
						],
					},
				],
				defaultTools: ["read", "bash", "edit", "write"],
			})),
			getSettings: vi.fn(async () => ({
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-20250514",
				defaultThinkingLevel: "medium" as const,
				showThinkingBlocks: false,
			})),
			setSetting: vi.fn(),
			listProviderKeys: vi.fn(async () => [
				{ provider: "openai", configured: true },
				{ provider: "anthropic", configured: true },
			]),
			listOAuthProviders: vi.fn(async () => [
				{
					id: "openai-codex",
					name: "OpenAI Codex",
					configured: false,
					source: "shared-auth" as const,
					usesCallbackServer: true,
				},
			]),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(async () => ({
				secureStorageAvailable: true,
				providerKeysEncrypted: true,
			})),
			getEventManagementCriteria: vi.fn(async () => ({
				path: "/Users/qiaochao/.skylark/events/EVENTS.md",
				content: "Use P0 for blockers.",
			})),
		};

		await store.getState().loadSettingsDetails(bridge);

		const state = store.getState();
		expect(state.settings.defaultProvider).toBe("anthropic");
		expect(state.settings.defaultThinkingLevel).toBe("medium");
		expect(state.hasLoadedSettings).toBe(true);
		expect(state.hasLoadedDetails).toBe(true);
		expect(state.runtimeCatalog?.defaultTools).toEqual(["read", "bash", "edit", "write"]);
		expect(state.providerKeys.map((entry) => entry.provider)).toEqual(["anthropic", "openai"]);
		expect(state.oauthProviders.map((entry) => entry.id)).toEqual(["openai-codex"]);
		expect(state.storageSecurityState?.providerKeysEncrypted).toBe(true);
		expect(state.eventManagementCriteria?.content).toBe("Use P0 for blockers.");
	});

	it("saves event management criteria through the bridge", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(),
			getSettings: vi.fn(),
			setSetting: vi.fn(),
			listProviderKeys: vi.fn(),
			listOAuthProviders: vi.fn(),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(),
			saveEventManagementCriteria: vi.fn(async (request: { content: string }) => ({
				path: "/Users/qiaochao/.skylark/events/EVENTS.md",
				content: request.content,
			})),
		};

		await store.getState().saveEventManagementCriteria(bridge, {
			content: "Discard stale low-value events.",
		});

		expect(bridge.saveEventManagementCriteria).toHaveBeenCalledWith({
			content: "Discard stale low-value events.",
		});
		expect(store.getState().eventManagementCriteria).toEqual({
			path: "/Users/qiaochao/.skylark/events/EVENTS.md",
			content: "Discard stale low-value events.",
		});
	});

	it("saves general settings through the bridge and updates local state", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(async () => ({
				providers: [
					{
						id: "openai",
						name: "OpenAI",
						configured: true,
						authMethods: ["api_key" as const],
						models: [{ id: "gpt-4.1", name: "GPT-4.1", reasoning: false, contextWindow: 128000 }],
					},
				],
				defaultTools: ["read", "bash", "edit", "write"],
			})),
			getSettings: vi.fn(),
			setSetting: vi.fn(async () => undefined),
			listProviderKeys: vi.fn(async () => []),
			listOAuthProviders: vi.fn(async () => []),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(),
		};

		await store.getState().saveGeneralSettings(bridge, {
			defaultProvider: "openai",
			defaultModel: "gpt-4.1",
			defaultThinkingLevel: "low",
			showThinkingBlocks: true,
			compactInstruction: DEFAULT_DESKTOP_COMPACT_INSTRUCTION,
			globalAgentsInstruction: "Always keep responses concise.",
		});

		expect(bridge.setSetting).toHaveBeenNthCalledWith(1, "defaultProvider", "openai");
		expect(bridge.setSetting).toHaveBeenNthCalledWith(2, "defaultModel", "gpt-4.1");
		expect(bridge.setSetting).toHaveBeenNthCalledWith(3, "defaultThinkingLevel", "low");
		expect(bridge.setSetting).toHaveBeenNthCalledWith(4, "showThinkingBlocks", true);
		expect(bridge.setSetting).toHaveBeenNthCalledWith(5, "compactInstruction", DEFAULT_DESKTOP_COMPACT_INSTRUCTION);
		expect(bridge.setSetting).toHaveBeenNthCalledWith(6, "globalAgentsInstruction", "Always keep responses concise.");
		expect(store.getState().settings).toEqual({
			defaultProvider: "openai",
			defaultModel: "gpt-4.1",
			defaultThinkingLevel: "low",
			showThinkingBlocks: true,
			compactInstruction: DEFAULT_DESKTOP_COMPACT_INSTRUCTION,
			globalAgentsInstruction: "Always keep responses concise.",
		});
	});

	it("does not clear instruction resources when saving unrelated general settings", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(),
			getSettings: vi.fn(),
			setSetting: vi.fn(async () => undefined),
			listProviderKeys: vi.fn(),
			listOAuthProviders: vi.fn(),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(),
		};

		await store.getState().saveGeneralSettings(bridge, {
			showThinkingBlocks: true,
		});

		expect(bridge.setSetting).toHaveBeenCalledTimes(1);
		expect(bridge.setSetting).toHaveBeenCalledWith("showThinkingBlocks", true);
		expect(bridge.setSetting).not.toHaveBeenCalledWith("globalAgentsInstruction", undefined);
		expect(bridge.setSetting).not.toHaveBeenCalledWith("compactInstruction", undefined);
		expect(store.getState().settings.showThinkingBlocks).toBe(true);
	});

	it("saves permission approval settings through the bridge", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(),
			getSettings: vi.fn(),
			setSetting: vi.fn(async () => undefined),
			listProviderKeys: vi.fn(),
			listOAuthProviders: vi.fn(),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(),
		};
		const permissionApprovals = {
			...DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
			terminal: false,
		};

		await store.getState().savePermissionApprovalSettings(bridge, permissionApprovals);

		expect(bridge.setSetting).toHaveBeenCalledWith("permissionApprovals", permissionApprovals);
		expect(store.getState().settings.permissionApprovals?.terminal).toBe(false);
	});

	it("saves appearance settings through the bridge and accepts settings update events", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(),
			getSettings: vi.fn(),
			setSetting: vi.fn(async () => undefined),
			listProviderKeys: vi.fn(),
			listOAuthProviders: vi.fn(),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(),
		};
		const appearance = {
			...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
			themeMode: "dark" as const,
			darkTheme: {
				...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme,
				accentColor: "#cc7d5e",
				contrast: 60,
			},
		};

		await store.getState().saveAppearanceSettings(bridge, appearance);

		expect(bridge.setSetting).toHaveBeenCalledWith("appearance", appearance);
		expect(store.getState().settings.appearance).toEqual(appearance);

		store.getState().applySettingsEvent({
			type: "settings_updated",
			settings: {
				appearance: {
					...appearance,
					themeMode: "light",
				},
				showThinkingBlocks: true,
			},
		});

		expect(store.getState().settings.appearance?.themeMode).toBe("light");
		expect(store.getState().settings.showThinkingBlocks).toBe(true);
		expect(store.getState().hasLoadedSettings).toBe(true);
	});

	it("updates and removes provider keys by refreshing the configured list", async () => {
		const store = createSettingsStore();
		const listProviderKeys = vi
			.fn()
			.mockResolvedValueOnce([{ provider: "anthropic", configured: true }])
			.mockResolvedValueOnce([]);
		const bridge = {
			getRuntimeCatalog: vi
				.fn()
				.mockResolvedValueOnce({
					providers: [
						{
							id: "anthropic",
							name: "Anthropic",
							configured: true,
							authMethods: ["api_key" as const],
							models: [],
						},
					],
					defaultTools: ["read", "bash", "edit", "write"],
				})
				.mockResolvedValueOnce({
					providers: [],
					defaultTools: ["read", "bash", "edit", "write"],
				}),
			getSettings: vi.fn(),
			setSetting: vi.fn(),
			listProviderKeys,
			listOAuthProviders: vi.fn(async () => []),
			setProviderKey: vi.fn(async () => undefined),
			deleteProviderKey: vi.fn(async () => undefined),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(),
		};

		await store.getState().setProviderKey(bridge, "anthropic", "secret");
		expect(store.getState().providerKeys).toEqual([{ provider: "anthropic", configured: true }]);

		await store.getState().deleteProviderKey(bridge, "anthropic");
		expect(store.getState().providerKeys).toEqual([]);
	});

	it("tests provider key connections through the bridge", async () => {
		const store = createSettingsStore();
		const result = {
			provider: "anthropic",
			ok: true as const,
			message: "连接正常",
		};
		const bridge = {
			testProviderKey: vi.fn(async () => result),
		};

		await expect(store.getState().testProviderKey(bridge, "anthropic")).resolves.toEqual(result);
		expect(bridge.testProviderKey).toHaveBeenCalledWith("anthropic");
	});

	it("starts OAuth login and refreshes catalog after success", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(async () => ({
				providers: [
					{
						id: "openai-codex",
						name: "OpenAI Codex",
						configured: true,
						authMethods: ["oauth" as const],
						models: [],
					},
				],
				defaultTools: ["read", "bash", "edit", "write"],
			})),
			getSettings: vi.fn(),
			setSetting: vi.fn(),
			listProviderKeys: vi.fn(async () => []),
			listOAuthProviders: vi.fn(async () => [
				{
					id: "openai-codex",
					name: "OpenAI Codex",
					configured: true,
					source: "shared-auth" as const,
					usesCallbackServer: true,
				},
			]),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(async () => undefined),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(),
		};

		await store.getState().startOAuthLogin(bridge, "openai-codex");
		expect(bridge.startOAuthLogin).toHaveBeenCalledWith("openai-codex");
		expect(store.getState().oauthLogin.isSigningIn).toBe(true);

		await store.getState().handleOAuthLoginEvent(bridge, { type: "success", provider: "openai-codex" });

		expect(store.getState().runtimeCatalog?.providers[0]?.configured).toBe(true);
		expect(store.getState().oauthProviders[0]?.configured).toBe(true);
		expect(store.getState().oauthLogin.isSigningIn).toBe(false);
	});

	it("refreshes the provider catalog after a credentials change event", async () => {
		const store = createSettingsStore();
		const bridge = {
			getRuntimeCatalog: vi.fn(async () => ({
				providers: [
					{
						id: "anthropic",
						name: "Anthropic",
						configured: true,
						authMethods: ["api_key" as const],
						models: [],
					},
				],
				defaultTools: ["read", "bash"],
			})),
			getSettings: vi.fn(),
			setSetting: vi.fn(),
			listProviderKeys: vi.fn(async () => [{ provider: "anthropic", configured: true }]),
			listOAuthProviders: vi.fn(async () => []),
			setProviderKey: vi.fn(),
			deleteProviderKey: vi.fn(),
			startOAuthLogin: vi.fn(),
			submitOAuthLoginCode: vi.fn(),
			cancelOAuthLogin: vi.fn(),
			logoutOAuthProvider: vi.fn(),
			subscribeToAuthEvents: vi.fn(),
			getStorageSecurityState: vi.fn(),
		};

		await store.getState().handleOAuthLoginEvent(bridge, { type: "credentials_changed", provider: "anthropic" });

		expect(store.getState().providerKeys).toEqual([{ provider: "anthropic", configured: true }]);
		expect(store.getState().runtimeCatalog?.providers[0]?.configured).toBe(true);
		expect(store.getState().oauthLogin.isSigningIn).toBe(false);
	});
});
