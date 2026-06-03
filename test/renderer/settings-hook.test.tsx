import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type UseSettingsOptions, useSettings } from "../../src/renderer/hooks/use-settings.ts";
import { type SettingsStoreBridge, settingsStore } from "../../src/renderer/stores/settings-store.ts";

function resetSettingsStore(): void {
	settingsStore.setState({
		settings: {},
		runtimeCatalog: undefined,
		providerKeys: [],
		oauthProviders: [],
		oauthLogin: { isSigningIn: false },
		storageSecurityState: undefined,
		eventManagementCriteria: undefined,
		hasLoadedSettings: false,
		hasLoadedDetails: false,
		isLoading: false,
		isSaving: false,
		errorMessage: undefined,
	});
}

function createDeferredPromise<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
}

function createSettingsBridge(getSettings: SettingsStoreBridge["getSettings"]): SettingsStoreBridge {
	return {
		cancelOAuthLogin: vi.fn(async () => undefined),
		deleteProviderKey: vi.fn(async () => undefined),
		getRuntimeCatalog: vi.fn(async () => ({ defaultTools: ["read", "bash"], providers: [] })),
		getSettings,
		getStorageSecurityState: vi.fn(async () => ({
			providerKeysEncrypted: true,
			secureStorageAvailable: true,
		})),
		listOAuthProviders: vi.fn(async () => []),
		listProviderKeys: vi.fn(async () => []),
		logoutOAuthProvider: vi.fn(async () => undefined),
		setProviderKey: vi.fn(async () => undefined),
		setSetting: vi.fn(async () => undefined),
		startOAuthLogin: vi.fn(async () => undefined),
		submitOAuthLoginCode: vi.fn(async () => undefined),
		subscribeToAuthEvents: vi.fn(() => () => undefined),
	};
}

afterEach(() => {
	cleanup();
	resetSettingsStore();
});

describe("useSettings", () => {
	it("keeps detail-backed settings loading until AGENTS.md instructions hydrate", async () => {
		resetSettingsStore();
		const settingsLoad = createDeferredPromise<Awaited<ReturnType<SettingsStoreBridge["getSettings"]>>>();
		const bridge = createSettingsBridge(vi.fn(async () => settingsLoad.promise));
		const renders: Array<{ globalAgentsInstruction: string | undefined; isLoading: boolean }> = [];

		function Probe({ options }: { options: UseSettingsOptions }) {
			const settings = useSettings(options);
			renders.push({
				globalAgentsInstruction: settings.settings.globalAgentsInstruction,
				isLoading: settings.isLoading,
			});
			return null;
		}

		render(<Probe options={{ bridge, loadDetails: true, loadInitial: false }} />);

		expect(renders[0]?.isLoading).toBe(true);
		expect(renders[0]?.globalAgentsInstruction).toBeUndefined();

		settingsLoad.resolve({
			globalAgentsInstruction: "Always keep responses concise.",
			showThinkingBlocks: false,
		});

		await waitFor(() => {
			expect(renders.at(-1)?.isLoading).toBe(false);
		});
		expect(renders.at(-1)?.globalAgentsInstruction).toBe("Always keep responses concise.");
	});

	it("hydrates event EVENTS.md criteria with settings details", async () => {
		resetSettingsStore();
		const bridge = {
			...createSettingsBridge(
				vi.fn(async () => ({
					globalAgentsInstruction: "Always keep responses concise.",
					showThinkingBlocks: false,
				})),
			),
			getEventManagementCriteria: vi.fn(async () => ({
				path: "/Users/qiaochao/.skylark/events/EVENTS.md",
				content: "Discard stale low-value events.",
			})),
		};
		const renders: Array<{ criteriaContent: string | undefined; isLoading: boolean }> = [];

		function Probe({ options }: { options: UseSettingsOptions }) {
			const settings = useSettings(options);
			renders.push({
				criteriaContent: settings.eventManagementCriteria?.content,
				isLoading: settings.isLoading,
			});
			return null;
		}

		render(<Probe options={{ bridge, loadDetails: true, loadInitial: false }} />);

		await waitFor(() => {
			expect(renders.at(-1)?.isLoading).toBe(false);
		});
		expect(renders.at(-1)?.criteriaContent).toBe("Discard stale low-value events.");
	});

	it("loads provider catalog without loading settings details", async () => {
		resetSettingsStore();
		const bridge = {
			...createSettingsBridge(vi.fn(async () => ({ showThinkingBlocks: false }))),
			getRuntimeCatalog: vi.fn(async () => ({
				defaultTools: ["read", "bash"],
				providers: [
					{
						id: "openai-codex",
						name: "OpenAI Codex",
						configured: true,
						authMethods: ["oauth" as const],
						models: [{ id: "gpt-5.5", name: "GPT-5.5", reasoning: true, contextWindow: 256000 }],
					},
				],
			})),
			listOAuthProviders: vi.fn(async () => [
				{
					id: "openai-codex",
					name: "OpenAI Codex",
					configured: true,
					source: "shared-auth" as const,
					usesCallbackServer: true,
				},
			]),
			listProviderKeys: vi.fn(async () => [{ provider: "anthropic", configured: true }]),
			getEventManagementCriteria: vi.fn(),
			getStorageSecurityState: vi.fn(),
		};
		const renders: Array<{ providerCount: number | undefined; isLoading: boolean }> = [];

		function Probe({ options }: { options: UseSettingsOptions }) {
			const settings = useSettings(options);
			renders.push({
				providerCount: settings.runtimeCatalog?.providers.length,
				isLoading: settings.isLoading,
			});
			return null;
		}

		render(<Probe options={{ bridge, loadDetails: false, loadInitial: false, loadProviderCatalog: true }} />);

		await waitFor(() => {
			expect(renders.at(-1)?.providerCount).toBe(1);
		});
		expect(renders.at(-1)?.isLoading).toBe(false);
		expect(bridge.getRuntimeCatalog).toHaveBeenCalledTimes(1);
		expect(bridge.listProviderKeys).toHaveBeenCalledTimes(1);
		expect(bridge.listOAuthProviders).toHaveBeenCalledTimes(1);
		expect(bridge.getSettings).not.toHaveBeenCalled();
		expect(bridge.getStorageSecurityState).not.toHaveBeenCalled();
		expect(bridge.getEventManagementCriteria).not.toHaveBeenCalled();
	});

	it("reloads detail-backed instruction resources when Settings opens with a stale detail cache", async () => {
		resetSettingsStore();
		settingsStore.setState({
			settings: { showThinkingBlocks: false },
			runtimeCatalog: undefined,
			providerKeys: [],
			oauthProviders: [],
			oauthLogin: { isSigningIn: false },
			storageSecurityState: undefined,
			eventManagementCriteria: undefined,
			hasLoadedSettings: true,
			hasLoadedDetails: true,
			isLoading: false,
			isSaving: false,
			errorMessage: undefined,
		});
		const settingsLoad = createDeferredPromise<Awaited<ReturnType<SettingsStoreBridge["getSettings"]>>>();
		const bridge = {
			...createSettingsBridge(vi.fn(async () => settingsLoad.promise)),
			getEventManagementCriteria: vi.fn(async () => ({
				path: "/Users/qiaochao/.skylark/events/EVENTS.md",
				content: "Discard stale low-value events.",
			})),
		};
		const renders: Array<{
			criteriaContent: string | undefined;
			globalAgentsInstruction: string | undefined;
			isLoading: boolean;
		}> = [];

		function Probe({ options }: { options: UseSettingsOptions }) {
			const settings = useSettings(options);
			renders.push({
				criteriaContent: settings.eventManagementCriteria?.content,
				globalAgentsInstruction: settings.settings.globalAgentsInstruction,
				isLoading: settings.isLoading,
			});
			return null;
		}

		render(<Probe options={{ bridge, loadDetails: true, loadInitial: false }} />);

		expect(renders[0]?.isLoading).toBe(true);
		expect(renders[0]?.globalAgentsInstruction).toBeUndefined();
		expect(bridge.getSettings).toHaveBeenCalledTimes(1);

		settingsLoad.resolve({
			globalAgentsInstruction: "Always keep responses concise.",
			showThinkingBlocks: false,
		});

		await waitFor(() => {
			expect(renders.at(-1)?.isLoading).toBe(false);
		});
		expect(renders.at(-1)?.globalAgentsInstruction).toBe("Always keep responses concise.");
		expect(renders.at(-1)?.criteriaContent).toBe("Discard stale low-value events.");
	});

	it("keeps hydrated instruction resources across repeated Settings opens when a later detail response omits them", async () => {
		resetSettingsStore();
		const bridge = {
			...createSettingsBridge(
				vi
					.fn()
					.mockResolvedValueOnce({
						globalAgentsInstruction: "Always keep responses concise.",
						showThinkingBlocks: false,
					})
					.mockResolvedValueOnce({
						showThinkingBlocks: true,
					}),
			),
			getEventManagementCriteria: vi
				.fn()
				.mockResolvedValueOnce({
					path: "/Users/qiaochao/.skylark/events/EVENTS.md",
					content: "Discard stale low-value events.",
				})
				.mockResolvedValueOnce(undefined),
		};
		const renders: Array<{
			criteriaContent: string | undefined;
			globalAgentsInstruction: string | undefined;
			isLoading: boolean;
			showThinkingBlocks: boolean | undefined;
		}> = [];

		function Probe({ options }: { options: UseSettingsOptions }) {
			const settings = useSettings(options);
			renders.push({
				criteriaContent: settings.eventManagementCriteria?.content,
				globalAgentsInstruction: settings.settings.globalAgentsInstruction,
				isLoading: settings.isLoading,
				showThinkingBlocks: settings.settings.showThinkingBlocks,
			});
			return null;
		}

		const { rerender } = render(<Probe options={{ bridge, loadDetails: true, loadInitial: false }} />);

		await waitFor(() => {
			expect(renders.at(-1)?.isLoading).toBe(false);
		});
		expect(renders.at(-1)?.globalAgentsInstruction).toBe("Always keep responses concise.");
		expect(renders.at(-1)?.criteriaContent).toBe("Discard stale low-value events.");

		rerender(<Probe options={{ bridge, loadDetails: false, loadInitial: false }} />);
		rerender(<Probe options={{ bridge, loadDetails: true, loadInitial: false }} />);

		await waitFor(() => {
			expect(renders.at(-1)?.showThinkingBlocks).toBe(true);
		});
		expect(renders.at(-1)?.globalAgentsInstruction).toBe("Always keep responses concise.");
		expect(renders.at(-1)?.criteriaContent).toBe("Discard stale low-value events.");
	});
});
