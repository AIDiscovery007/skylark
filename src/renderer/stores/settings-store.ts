import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { getErrorMessage } from "../../shared/errors.ts";
import type { DesktopAgentBridge } from "../../shared/ipc-contract.ts";
import { DESKTOP_THINKING_LEVEL_OPTIONS } from "../../shared/thinking-levels.ts";
import type {
	DesktopAppearanceSettings,
	DesktopEventManagementCriteria,
	DesktopEventManagementCriteriaUpdateRequest,
	DesktopOAuthLoginEvent,
	DesktopOAuthProviderStatus,
	DesktopPermissionApprovalSettings,
	DesktopProviderKeyStatus,
	DesktopProviderKeyTestResult,
	DesktopRuntimeCatalog,
	DesktopSettingsData,
	DesktopSettingsEvent,
	DesktopStorageSecurityState,
	DesktopWorkspaceOverview,
} from "../../shared/types.ts";
import { type AsyncStorePendingKey, runAsyncStoreCommand } from "../lib/async-store-command.ts";

export type SettingsStoreBridge = Pick<
	DesktopAgentBridge,
	| "cancelOAuthLogin"
	| "deleteProviderKey"
	| "getRuntimeCatalog"
	| "getSettings"
	| "getStorageSecurityState"
	| "listOAuthProviders"
	| "listProviderKeys"
	| "logoutOAuthProvider"
	| "setProviderKey"
	| "setSetting"
	| "startOAuthLogin"
	| "subscribeToAuthEvents"
	| "submitOAuthLoginCode"
> &
	Partial<
		Pick<
			DesktopAgentBridge,
			"getEventManagementCriteria" | "saveEventManagementCriteria" | "subscribeToSettingsEvents" | "testProviderKey"
		>
	>;

type ProviderKeyTestBridge = {
	testProviderKey?: DesktopAgentBridge["testProviderKey"];
};

export const THINKING_LEVEL_OPTIONS = DESKTOP_THINKING_LEVEL_OPTIONS;

export interface GeneralSettingsInput {
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: ThinkingLevel;
	showThinkingBlocks?: boolean;
	compactInstruction?: string;
	globalAgentsInstruction?: string;
}

export type PermissionApprovalSettingsInput = DesktopPermissionApprovalSettings;
export type AppearanceSettingsInput = DesktopAppearanceSettings;

function sortProviderKeys(providerKeys: DesktopProviderKeyStatus[]): DesktopProviderKeyStatus[] {
	return [...providerKeys].sort((left, right) => left.provider.localeCompare(right.provider));
}

function sortOAuthProviders(oauthProviders: DesktopOAuthProviderStatus[]): DesktopOAuthProviderStatus[] {
	return [...oauthProviders].sort((left, right) => left.id.localeCompare(right.id));
}

function hasOwnSetting<TKey extends keyof GeneralSettingsInput>(settings: GeneralSettingsInput, key: TKey): boolean {
	return Object.hasOwn(settings, key);
}

function mergeDesktopSettings(current: DesktopSettingsData, next: DesktopSettingsData): DesktopSettingsData {
	return {
		...current,
		...next,
	};
}

async function loadProviderCatalogState(bridge: SettingsStoreBridge): Promise<{
	runtimeCatalog: DesktopRuntimeCatalog;
	providerKeys: DesktopProviderKeyStatus[];
	oauthProviders: DesktopOAuthProviderStatus[];
}> {
	const runtimeCatalog = await bridge.getRuntimeCatalog();
	const providerKeys = sortProviderKeys(await bridge.listProviderKeys());
	const oauthProviders = sortOAuthProviders(await bridge.listOAuthProviders());

	return {
		runtimeCatalog,
		providerKeys,
		oauthProviders,
	};
}

export interface OAuthLoginState {
	provider?: string;
	isSigningIn: boolean;
	authUrl?: string;
	instructions?: string;
	manualPrompt?: string;
	manualPlaceholder?: string;
	statusMessage?: string;
	errorMessage?: string;
}

export interface SettingsStoreState {
	settings: DesktopSettingsData;
	runtimeCatalog?: DesktopRuntimeCatalog;
	providerKeys: DesktopProviderKeyStatus[];
	oauthProviders: DesktopOAuthProviderStatus[];
	oauthLogin: OAuthLoginState;
	storageSecurityState?: DesktopStorageSecurityState;
	eventManagementCriteria?: DesktopEventManagementCriteria;
	hasLoadedSettings: boolean;
	hasLoadedDetails: boolean;
	isLoading: boolean;
	isSaving: boolean;
	errorMessage?: string;
	loadSettings: (bridge: SettingsStoreBridge) => Promise<void>;
	loadProviderCatalog: (bridge: SettingsStoreBridge) => Promise<void>;
	loadSettingsDetails: (bridge: SettingsStoreBridge) => Promise<void>;
	applyWorkspaceOverview: (overview: DesktopWorkspaceOverview) => void;
	applySettingsEvent: (event: DesktopSettingsEvent) => void;
	saveAppearanceSettings: (bridge: SettingsStoreBridge, settings: AppearanceSettingsInput) => Promise<void>;
	saveGeneralSettings: (bridge: SettingsStoreBridge, settings: GeneralSettingsInput) => Promise<void>;
	saveEventManagementCriteria: (
		bridge: SettingsStoreBridge,
		request: DesktopEventManagementCriteriaUpdateRequest,
	) => Promise<DesktopEventManagementCriteria | undefined>;
	savePermissionApprovalSettings: (
		bridge: SettingsStoreBridge,
		settings: PermissionApprovalSettingsInput,
	) => Promise<void>;
	setProviderKey: (bridge: SettingsStoreBridge, provider: string, key: string) => Promise<void>;
	deleteProviderKey: (bridge: SettingsStoreBridge, provider: string) => Promise<void>;
	testProviderKey: (bridge: ProviderKeyTestBridge, provider: string) => Promise<DesktopProviderKeyTestResult>;
	startOAuthLogin: (bridge: SettingsStoreBridge, provider: string) => Promise<void>;
	submitOAuthLoginCode: (bridge: SettingsStoreBridge, provider: string, code: string) => Promise<void>;
	cancelOAuthLogin: (bridge: SettingsStoreBridge, provider: string) => Promise<void>;
	logoutOAuthProvider: (bridge: SettingsStoreBridge, provider: string) => Promise<void>;
	handleOAuthLoginEvent: (bridge: SettingsStoreBridge, event: DesktopOAuthLoginEvent) => Promise<void>;
}

export function createSettingsStore() {
	return createStore<SettingsStoreState>()((set) => {
		const runCommand = <TResult>(
			pendingKey: AsyncStorePendingKey,
			command: () => Promise<TResult>,
			applySuccess: (state: SettingsStoreState, result: TResult) => SettingsStoreState,
		) =>
			runAsyncStoreCommand({
				applySuccess,
				command,
				pendingKey,
				set: (update) => set((state) => update(state)),
			});
		const applyProviderCatalogState = (
			state: SettingsStoreState,
			providerCatalogState: Awaited<ReturnType<typeof loadProviderCatalogState>>,
		): SettingsStoreState => ({
			...state,
			...providerCatalogState,
		});

		return {
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
			applyWorkspaceOverview: (overview) => {
				set((state) => ({
					...state,
					settings: mergeDesktopSettings(state.settings, overview.settings),
					hasLoadedSettings: true,
					errorMessage: undefined,
				}));
			},
			applySettingsEvent: (event) => {
				set((state) => ({
					...state,
					settings: mergeDesktopSettings(state.settings, event.settings),
					hasLoadedSettings: true,
					errorMessage: undefined,
				}));
			},
			loadSettings: async (bridge) => {
				await runCommand(
					"isLoading",
					() => bridge.getSettings(),
					(state, settings) => ({
						...state,
						settings: mergeDesktopSettings(state.settings, settings),
						hasLoadedSettings: true,
					}),
				);
			},
			loadProviderCatalog: async (bridge) => {
				await runCommand("isLoading", () => loadProviderCatalogState(bridge), applyProviderCatalogState);
			},
			loadSettingsDetails: async (bridge) => {
				await runCommand(
					"isLoading",
					async () => {
						const settings = await bridge.getSettings();
						const providerCatalogState = await loadProviderCatalogState(bridge);
						const storageSecurityState = await bridge.getStorageSecurityState();
						const eventManagementCriteria = await bridge.getEventManagementCriteria?.();

						return {
							eventManagementCriteria,
							providerCatalogState,
							settings,
							storageSecurityState,
						};
					},
					(state, { eventManagementCriteria, providerCatalogState, settings, storageSecurityState }) => ({
						...state,
						settings: mergeDesktopSettings(state.settings, settings),
						...providerCatalogState,
						storageSecurityState,
						eventManagementCriteria: eventManagementCriteria ?? state.eventManagementCriteria,
						hasLoadedSettings: true,
						hasLoadedDetails: true,
					}),
				);
			},
			saveGeneralSettings: async (bridge, settings) => {
				await runCommand(
					"isSaving",
					async () => {
						if (hasOwnSetting(settings, "defaultProvider")) {
							await bridge.setSetting("defaultProvider", settings.defaultProvider);
						}
						if (hasOwnSetting(settings, "defaultModel")) {
							await bridge.setSetting("defaultModel", settings.defaultModel);
						}
						if (hasOwnSetting(settings, "defaultThinkingLevel")) {
							await bridge.setSetting("defaultThinkingLevel", settings.defaultThinkingLevel);
						}
						if (hasOwnSetting(settings, "showThinkingBlocks")) {
							await bridge.setSetting("showThinkingBlocks", settings.showThinkingBlocks);
						}
						if (hasOwnSetting(settings, "compactInstruction")) {
							await bridge.setSetting("compactInstruction", settings.compactInstruction);
						}
						if (hasOwnSetting(settings, "globalAgentsInstruction")) {
							await bridge.setSetting("globalAgentsInstruction", settings.globalAgentsInstruction);
						}

						return settings;
					},
					(state, savedSettings) => ({
						...state,
						settings: {
							...state.settings,
							...savedSettings,
						},
					}),
				);
			},
			saveEventManagementCriteria: async (bridge, request) => {
				return await runCommand(
					"isSaving",
					async () => {
						if (typeof bridge.saveEventManagementCriteria !== "function") {
							throw new Error("Event management criteria storage is not configured.");
						}
						return bridge.saveEventManagementCriteria(request);
					},
					(state, eventManagementCriteria) => ({
						...state,
						eventManagementCriteria,
					}),
				);
			},
			saveAppearanceSettings: async (bridge, appearance) => {
				await runCommand(
					"isSaving",
					async () => {
						await bridge.setSetting("appearance", appearance);
						return appearance;
					},
					(state, savedAppearance) => ({
						...state,
						settings: {
							...state.settings,
							appearance: savedAppearance,
						},
					}),
				);
			},
			savePermissionApprovalSettings: async (bridge, permissionApprovals) => {
				await runCommand(
					"isSaving",
					async () => {
						await bridge.setSetting("permissionApprovals", permissionApprovals);
						return permissionApprovals;
					},
					(state, savedPermissionApprovals) => ({
						...state,
						settings: {
							...state.settings,
							permissionApprovals: savedPermissionApprovals,
						},
					}),
				);
			},
			setProviderKey: async (bridge, provider, key) => {
				await runCommand(
					"isSaving",
					async () => {
						await bridge.setProviderKey(provider, key);
						return loadProviderCatalogState(bridge);
					},
					applyProviderCatalogState,
				);
			},
			deleteProviderKey: async (bridge, provider) => {
				await runCommand(
					"isSaving",
					async () => {
						await bridge.deleteProviderKey(provider);
						return loadProviderCatalogState(bridge);
					},
					applyProviderCatalogState,
				);
			},
			testProviderKey: async (bridge, provider) => {
				try {
					if (!bridge.testProviderKey) {
						return {
							provider,
							ok: false,
							message: "当前桥接不支持测试连接。",
						};
					}
					return await bridge.testProviderKey(provider);
				} catch (error: unknown) {
					return {
						provider,
						ok: false,
						message: getErrorMessage(error),
					};
				}
			},
			startOAuthLogin: async (bridge, provider) => {
				set((state) => ({
					...state,
					errorMessage: undefined,
					oauthLogin: {
						provider,
						isSigningIn: true,
						statusMessage: "Starting login...",
					},
				}));

				try {
					await bridge.startOAuthLogin(provider);
				} catch (error: unknown) {
					set((state) => ({
						...state,
						oauthLogin: {
							provider,
							isSigningIn: false,
							errorMessage: getErrorMessage(error),
						},
					}));
				}
			},
			submitOAuthLoginCode: async (bridge, provider, code) => {
				try {
					await bridge.submitOAuthLoginCode(provider, code);
					set((state) => ({
						...state,
						oauthLogin: {
							...state.oauthLogin,
							provider,
							statusMessage: "Completing login...",
							errorMessage: undefined,
						},
					}));
				} catch (error: unknown) {
					set((state) => ({
						...state,
						oauthLogin: {
							...state.oauthLogin,
							provider,
							errorMessage: getErrorMessage(error),
						},
					}));
				}
			},
			cancelOAuthLogin: async (bridge, provider) => {
				try {
					await bridge.cancelOAuthLogin(provider);
				} catch (error: unknown) {
					set((state) => ({
						...state,
						oauthLogin: {
							...state.oauthLogin,
							provider,
							errorMessage: getErrorMessage(error),
						},
					}));
				}
			},
			logoutOAuthProvider: async (bridge, provider) => {
				await runCommand(
					"isSaving",
					async () => {
						await bridge.logoutOAuthProvider(provider);
						return loadProviderCatalogState(bridge);
					},
					(state, providerCatalogState) => ({
						...state,
						...providerCatalogState,
						oauthLogin: { isSigningIn: false },
					}),
				);
			},
			handleOAuthLoginEvent: async (bridge, event) => {
				if (event.type === "credentials_changed") {
					const providerCatalogState = await loadProviderCatalogState(bridge);
					set((state) => ({
						...state,
						...providerCatalogState,
					}));
					return;
				}

				if (event.type === "success") {
					const providerCatalogState = await loadProviderCatalogState(bridge);
					set((state) => ({
						...state,
						...providerCatalogState,
						oauthLogin: {
							provider: event.provider,
							isSigningIn: false,
							statusMessage: "Signed in.",
						},
					}));
					return;
				}

				if (event.type === "error") {
					set((state) => ({
						...state,
						oauthLogin: {
							provider: event.provider,
							isSigningIn: false,
							errorMessage: event.message,
						},
					}));
					return;
				}

				if (event.type === "cancelled") {
					set((state) => ({
						...state,
						oauthLogin: {
							provider: event.provider,
							isSigningIn: false,
							statusMessage: "Login cancelled.",
						},
					}));
					return;
				}

				if (event.type === "auth_url") {
					set((state) => ({
						...state,
						oauthLogin: {
							...state.oauthLogin,
							provider: event.provider,
							isSigningIn: true,
							authUrl: event.url,
							instructions: event.instructions,
							statusMessage: "Waiting for browser authentication...",
							errorMessage: undefined,
						},
					}));
					return;
				}

				if (event.type === "manual_code_prompt") {
					set((state) => ({
						...state,
						oauthLogin: {
							...state.oauthLogin,
							provider: event.provider,
							isSigningIn: true,
							manualPrompt: event.message,
							manualPlaceholder: event.placeholder,
							errorMessage: undefined,
						},
					}));
					return;
				}

				set((state) => ({
					...state,
					oauthLogin: {
						...state.oauthLogin,
						provider: event.provider,
						isSigningIn: true,
						statusMessage: event.message,
						errorMessage: undefined,
					},
				}));
			},
		};
	});
}

export const settingsStore = createSettingsStore();

export function useSettingsStore<T>(selector: (state: SettingsStoreState) => T): T {
	return useStore(settingsStore, selector);
}
