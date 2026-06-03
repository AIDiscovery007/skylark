import { useEffect, useRef, useState } from "react";
import type { DesktopEventManagementCriteriaUpdateRequest } from "../../shared/types.ts";
import { markRendererPerformance, measureRendererPerformance } from "../lib/performance-marks.ts";
import type {
	AppearanceSettingsInput,
	GeneralSettingsInput,
	PermissionApprovalSettingsInput,
	SettingsStoreBridge,
} from "../stores/settings-store.ts";
import { useSettingsStore } from "../stores/settings-store.ts";

export interface UseSettingsOptions {
	bridge?: SettingsStoreBridge;
	loadDetails?: boolean;
	loadProviderCatalog?: boolean;
	loadInitial?: boolean;
}

export function useSettings(options: UseSettingsOptions = {}) {
	const bridge = options.bridge ?? window.desktopAgent;
	const cancelOAuthLogin = useSettingsStore((state) => state.cancelOAuthLogin);
	const deleteProviderKey = useSettingsStore((state) => state.deleteProviderKey);
	const errorMessage = useSettingsStore((state) => state.errorMessage);
	const handleOAuthLoginEvent = useSettingsStore((state) => state.handleOAuthLoginEvent);
	const applySettingsEvent = useSettingsStore((state) => state.applySettingsEvent);
	const isLoading = useSettingsStore((state) => state.isLoading);
	const isSaving = useSettingsStore((state) => state.isSaving);
	const hasLoadedSettings = useSettingsStore((state) => state.hasLoadedSettings);
	const loadProviderCatalog = useSettingsStore((state) => state.loadProviderCatalog);
	const loadSettings = useSettingsStore((state) => state.loadSettings);
	const loadSettingsDetails = useSettingsStore((state) => state.loadSettingsDetails);
	const logoutOAuthProvider = useSettingsStore((state) => state.logoutOAuthProvider);
	const oauthLogin = useSettingsStore((state) => state.oauthLogin);
	const oauthProviders = useSettingsStore((state) => state.oauthProviders);
	const providerKeys = useSettingsStore((state) => state.providerKeys);
	const runtimeCatalog = useSettingsStore((state) => state.runtimeCatalog);
	const saveAppearanceSettings = useSettingsStore((state) => state.saveAppearanceSettings);
	const saveEventManagementCriteria = useSettingsStore((state) => state.saveEventManagementCriteria);
	const saveGeneralSettings = useSettingsStore((state) => state.saveGeneralSettings);
	const savePermissionApprovalSettings = useSettingsStore((state) => state.savePermissionApprovalSettings);
	const setProviderKey = useSettingsStore((state) => state.setProviderKey);
	const settings = useSettingsStore((state) => state.settings);
	const startOAuthLogin = useSettingsStore((state) => state.startOAuthLogin);
	const storageSecurityState = useSettingsStore((state) => state.storageSecurityState);
	const eventManagementCriteria = useSettingsStore((state) => state.eventManagementCriteria);
	const submitOAuthLoginCode = useSettingsStore((state) => state.submitOAuthLoginCode);
	const testProviderKey = useSettingsStore((state) => state.testProviderKey);
	const loadDetails = options.loadDetails ?? false;
	const loadInitial = options.loadInitial ?? true;
	const shouldLoadProviderCatalog = options.loadProviderCatalog ?? false;
	const [isDetailsRequestPending, setIsDetailsRequestPending] = useState(loadDetails);
	const previousLoadDetails = useRef(loadDetails);
	const isEnteringDetails = loadDetails && !previousLoadDetails.current;
	const isHydratingProviderCatalog = shouldLoadProviderCatalog && runtimeCatalog === undefined;
	const isHydratingSettings =
		!errorMessage &&
		((loadInitial && !hasLoadedSettings) ||
			isHydratingProviderCatalog ||
			(loadDetails && (isDetailsRequestPending || isEnteringDetails)));

	useEffect(() => {
		previousLoadDetails.current = loadDetails;
	}, [loadDetails]);

	useEffect(() => {
		if (!loadInitial || hasLoadedSettings) {
			return;
		}
		markRendererPerformance("renderer:settings:load:start");
		void loadSettings(bridge).finally(() => {
			markRendererPerformance("renderer:settings:load:end");
			measureRendererPerformance(
				"renderer settings load",
				"renderer:settings:load:start",
				"renderer:settings:load:end",
			);
		});
	}, [bridge, hasLoadedSettings, loadInitial, loadSettings]);

	useEffect(() => {
		if (!shouldLoadProviderCatalog || runtimeCatalog !== undefined) {
			return;
		}
		markRendererPerformance("renderer:provider-catalog:load:start");
		void loadProviderCatalog(bridge).finally(() => {
			markRendererPerformance("renderer:provider-catalog:load:end");
			measureRendererPerformance(
				"renderer provider catalog load",
				"renderer:provider-catalog:load:start",
				"renderer:provider-catalog:load:end",
			);
		});
	}, [bridge, loadProviderCatalog, runtimeCatalog, shouldLoadProviderCatalog]);

	useEffect(() => {
		if (!loadDetails) {
			setIsDetailsRequestPending(false);
			return;
		}
		let isDisposed = false;
		setIsDetailsRequestPending(true);
		markRendererPerformance("renderer:settings-details:load:start");
		void loadSettingsDetails(bridge).finally(() => {
			markRendererPerformance("renderer:settings-details:load:end");
			measureRendererPerformance(
				"renderer settings details load",
				"renderer:settings-details:load:start",
				"renderer:settings-details:load:end",
			);
			if (!isDisposed) {
				setIsDetailsRequestPending(false);
			}
		});
		return () => {
			isDisposed = true;
		};
	}, [bridge, loadDetails, loadSettingsDetails]);

	useEffect(() => {
		return bridge.subscribeToAuthEvents((event) => {
			void handleOAuthLoginEvent(bridge, event);
		});
	}, [bridge, handleOAuthLoginEvent]);

	useEffect(() => {
		if (typeof bridge.subscribeToSettingsEvents !== "function") {
			return;
		}
		return bridge.subscribeToSettingsEvents((event) => {
			applySettingsEvent(event);
		});
	}, [applySettingsEvent, bridge]);

	return {
		settings,
		eventManagementCriteria,
		runtimeCatalog,
		providerKeys,
		oauthProviders,
		oauthLogin,
		storageSecurityState,
		isLoading: isLoading || isHydratingSettings,
		isSaving,
		errorMessage,
		saveAppearanceSettings: (nextSettings: AppearanceSettingsInput) => saveAppearanceSettings(bridge, nextSettings),
		saveEventManagementCriteria: (request: DesktopEventManagementCriteriaUpdateRequest) =>
			saveEventManagementCriteria(bridge, request),
		saveGeneralSettings: (nextSettings: GeneralSettingsInput) => saveGeneralSettings(bridge, nextSettings),
		savePermissionApprovalSettings: (nextSettings: PermissionApprovalSettingsInput) =>
			savePermissionApprovalSettings(bridge, nextSettings),
		setProviderKey: (provider: string, key: string) => setProviderKey(bridge, provider, key),
		deleteProviderKey: (provider: string) => deleteProviderKey(bridge, provider),
		testProviderKey: (provider: string) => testProviderKey(bridge, provider),
		startOAuthLogin: (provider: string) => startOAuthLogin(bridge, provider),
		submitOAuthLoginCode: (provider: string, code: string) => submitOAuthLoginCode(bridge, provider, code),
		cancelOAuthLogin: (provider: string) => cancelOAuthLogin(bridge, provider),
		logoutOAuthProvider: (provider: string) => logoutOAuthProvider(bridge, provider),
	};
}
