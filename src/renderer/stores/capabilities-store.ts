import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { DesktopAgentBridge } from "../../shared/ipc-contract.ts";
import type {
	DesktopCapabilityCatalog,
	DesktopCapabilityDetail,
	DesktopCapabilityDetailRequest,
	DesktopCapabilityEvent,
	DesktopCreateSkillRequest,
	DesktopMcpServerUpsertRequest,
	DesktopPromptTemplateDeleteRequest,
	DesktopPromptTemplateUpsertRequest,
} from "../../shared/types.ts";

export type CapabilitiesStoreBridge = Pick<
	DesktopAgentBridge,
	| "createSkill"
	| "deletePromptTemplate"
	| "getCapabilityDetail"
	| "listCapabilities"
	| "reloadCapabilities"
	| "restartMcpServer"
	| "setMcpServerEnabled"
	| "subscribeToCapabilityEvents"
	| "testMcpServer"
	| "upsertMcpServer"
	| "upsertPromptTemplate"
>;

function emptyCatalog(): DesktopCapabilityCatalog {
	return {
		skills: [],
		prompts: [],
		slashCommands: [],
		mcpServers: [],
		diagnostics: [],
	};
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface CapabilitiesStoreState {
	catalog: DesktopCapabilityCatalog;
	hasLoaded: boolean;
	isLoading: boolean;
	isSaving: boolean;
	errorMessage?: string;
	getCapabilityDetail: (
		bridge: CapabilitiesStoreBridge,
		request: DesktopCapabilityDetailRequest,
	) => Promise<DesktopCapabilityDetail>;
	loadCapabilities: (bridge: CapabilitiesStoreBridge) => Promise<void>;
	reloadCapabilities: (bridge: CapabilitiesStoreBridge) => Promise<void>;
	createSkill: (bridge: CapabilitiesStoreBridge, request: DesktopCreateSkillRequest) => Promise<void>;
	upsertPromptTemplate: (
		bridge: CapabilitiesStoreBridge,
		request: DesktopPromptTemplateUpsertRequest,
	) => Promise<void>;
	deletePromptTemplate: (
		bridge: CapabilitiesStoreBridge,
		request: DesktopPromptTemplateDeleteRequest,
	) => Promise<void>;
	upsertMcpServer: (bridge: CapabilitiesStoreBridge, request: DesktopMcpServerUpsertRequest) => Promise<void>;
	setMcpServerEnabled: (bridge: CapabilitiesStoreBridge, serverId: string, enabled: boolean) => Promise<void>;
	testMcpServer: (bridge: CapabilitiesStoreBridge, serverId: string) => Promise<void>;
	restartMcpServer: (bridge: CapabilitiesStoreBridge, serverId: string) => Promise<void>;
	handleCapabilityEvent: (event: DesktopCapabilityEvent) => void;
}

export function createCapabilitiesStore() {
	return createStore<CapabilitiesStoreState>()((set, get) => ({
		catalog: emptyCatalog(),
		hasLoaded: false,
		isLoading: false,
		isSaving: false,
		errorMessage: undefined,
		getCapabilityDetail: async (bridge, request) => bridge.getCapabilityDetail(request),
		loadCapabilities: async (bridge) => {
			if (get().hasLoaded) {
				return;
			}
			set((state) => ({ ...state, isLoading: true, errorMessage: undefined }));
			try {
				const catalog = await bridge.listCapabilities();
				set((state) => ({ ...state, catalog, hasLoaded: true, isLoading: false }));
			} catch (error: unknown) {
				set((state) => ({ ...state, isLoading: false, errorMessage: getErrorMessage(error) }));
			}
		},
		reloadCapabilities: async (bridge) => {
			set((state) => ({ ...state, isSaving: true, errorMessage: undefined }));
			try {
				const catalog = await bridge.reloadCapabilities();
				set((state) => ({ ...state, catalog, hasLoaded: true, isSaving: false }));
			} catch (error: unknown) {
				set((state) => ({ ...state, isSaving: false, errorMessage: getErrorMessage(error) }));
			}
		},
		createSkill: async (bridge, request) => {
			set((state) => ({ ...state, isSaving: true, errorMessage: undefined }));
			try {
				const catalog = await bridge.createSkill(request);
				set((state) => ({ ...state, catalog, hasLoaded: true, isSaving: false }));
			} catch (error: unknown) {
				set((state) => ({ ...state, isSaving: false, errorMessage: getErrorMessage(error) }));
			}
		},
		upsertPromptTemplate: async (bridge, request) => {
			set((state) => ({ ...state, isSaving: true, errorMessage: undefined }));
			try {
				const catalog = await bridge.upsertPromptTemplate(request);
				set((state) => ({ ...state, catalog, hasLoaded: true, isSaving: false }));
			} catch (error: unknown) {
				set((state) => ({ ...state, isSaving: false, errorMessage: getErrorMessage(error) }));
			}
		},
		deletePromptTemplate: async (bridge, request) => {
			set((state) => ({ ...state, isSaving: true, errorMessage: undefined }));
			try {
				const catalog = await bridge.deletePromptTemplate(request);
				set((state) => ({ ...state, catalog, hasLoaded: true, isSaving: false }));
			} catch (error: unknown) {
				set((state) => ({ ...state, isSaving: false, errorMessage: getErrorMessage(error) }));
			}
		},
		upsertMcpServer: async (bridge, request) => {
			set((state) => ({ ...state, isSaving: true, errorMessage: undefined }));
			try {
				const catalog = await bridge.upsertMcpServer(request);
				set((state) => ({ ...state, catalog, hasLoaded: true, isSaving: false }));
			} catch (error: unknown) {
				set((state) => ({ ...state, isSaving: false, errorMessage: getErrorMessage(error) }));
			}
		},
		setMcpServerEnabled: async (bridge, serverId, enabled) => {
			set((state) => ({ ...state, isSaving: true, errorMessage: undefined }));
			try {
				const catalog = await bridge.setMcpServerEnabled(serverId, enabled);
				set((state) => ({ ...state, catalog, hasLoaded: true, isSaving: false }));
			} catch (error: unknown) {
				set((state) => ({ ...state, isSaving: false, errorMessage: getErrorMessage(error) }));
			}
		},
		testMcpServer: async (bridge, serverId) => {
			set((state) => ({ ...state, isSaving: true, errorMessage: undefined }));
			try {
				await bridge.testMcpServer(serverId);
				const catalog = await bridge.listCapabilities();
				set((state) => ({ ...state, catalog, hasLoaded: true, isSaving: false }));
			} catch (error: unknown) {
				set((state) => ({ ...state, isSaving: false, errorMessage: getErrorMessage(error) }));
			}
		},
		restartMcpServer: async (bridge, serverId) => {
			set((state) => ({ ...state, isSaving: true, errorMessage: undefined }));
			try {
				const catalog = await bridge.restartMcpServer(serverId);
				set((state) => ({ ...state, catalog, hasLoaded: true, isSaving: false }));
			} catch (error: unknown) {
				set((state) => ({ ...state, isSaving: false, errorMessage: getErrorMessage(error) }));
			}
		},
		handleCapabilityEvent: (event) => {
			set((state) => {
				if (event.type === "catalog_changed") {
					return { ...state, catalog: event.catalog, hasLoaded: true };
				}
				return {
					...state,
					catalog: {
						...state.catalog,
						mcpServers: state.catalog.mcpServers.map((server) =>
							server.id === event.server.id ? event.server : server,
						),
					},
				};
			});
		},
	}));
}

export const capabilitiesStore = createCapabilitiesStore();

export function useCapabilitiesStore<T>(selector: (state: CapabilitiesStoreState) => T): T {
	return useStore(capabilitiesStore, selector);
}
