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
import { type AsyncStorePendingKey, runAsyncStoreCommand } from "../lib/async-store-command.ts";

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
	return createStore<CapabilitiesStoreState>()((set, get) => {
		const runCommand = <TResult>(
			pendingKey: AsyncStorePendingKey,
			command: () => Promise<TResult>,
			applySuccess: (state: CapabilitiesStoreState, result: TResult) => CapabilitiesStoreState,
		) =>
			runAsyncStoreCommand({
				applySuccess,
				command,
				pendingKey,
				set: (update) => set((state) => update(state)),
			});
		const applyCatalog = (
			state: CapabilitiesStoreState,
			catalog: DesktopCapabilityCatalog,
		): CapabilitiesStoreState => ({
			...state,
			catalog,
			hasLoaded: true,
		});
		const runCatalogCommand = (pendingKey: AsyncStorePendingKey, command: () => Promise<DesktopCapabilityCatalog>) =>
			runCommand(pendingKey, command, applyCatalog);

		return {
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
				await runCatalogCommand("isLoading", () => bridge.listCapabilities());
			},
			reloadCapabilities: async (bridge) => {
				await runCatalogCommand("isSaving", () => bridge.reloadCapabilities());
			},
			createSkill: async (bridge, request) => {
				await runCatalogCommand("isSaving", () => bridge.createSkill(request));
			},
			upsertPromptTemplate: async (bridge, request) => {
				await runCatalogCommand("isSaving", () => bridge.upsertPromptTemplate(request));
			},
			deletePromptTemplate: async (bridge, request) => {
				await runCatalogCommand("isSaving", () => bridge.deletePromptTemplate(request));
			},
			upsertMcpServer: async (bridge, request) => {
				await runCatalogCommand("isSaving", () => bridge.upsertMcpServer(request));
			},
			setMcpServerEnabled: async (bridge, serverId, enabled) => {
				await runCatalogCommand("isSaving", () => bridge.setMcpServerEnabled(serverId, enabled));
			},
			testMcpServer: async (bridge, serverId) => {
				await runCatalogCommand("isSaving", async () => {
					await bridge.testMcpServer(serverId);
					return bridge.listCapabilities();
				});
			},
			restartMcpServer: async (bridge, serverId) => {
				await runCatalogCommand("isSaving", () => bridge.restartMcpServer(serverId));
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
		};
	});
}

export const capabilitiesStore = createCapabilitiesStore();

export function useCapabilitiesStore<T>(selector: (state: CapabilitiesStoreState) => T): T {
	return useStore(capabilitiesStore, selector);
}
