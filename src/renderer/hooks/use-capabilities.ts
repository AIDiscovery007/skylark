import { useEffect } from "react";
import type {
	DesktopCapabilityDetailRequest,
	DesktopCapabilityEvent,
	DesktopCreateSkillRequest,
	DesktopMcpServerUpsertRequest,
	DesktopPromptTemplateDeleteRequest,
	DesktopPromptTemplateUpsertRequest,
} from "../../shared/types.ts";
import { resolveDesktopAgentBridge } from "../lib/desktop-agent-bridge.ts";
import { markRendererPerformance, measureRendererPerformance, scheduleIdleWork } from "../lib/performance-marks.ts";
import type { CapabilitiesStoreBridge } from "../stores/capabilities-store.ts";
import { useCapabilitiesStore } from "../stores/capabilities-store.ts";
import { useSubscribedResource } from "./use-subscribed-resource.ts";

export interface UseCapabilitiesOptions {
	bridge?: CapabilitiesStoreBridge;
	defer?: "idle" | "immediate";
	enabled?: boolean;
}

export function useCapabilities(options: UseCapabilitiesOptions = {}) {
	const bridge = resolveDesktopAgentBridge(options.bridge);
	const defer = options.defer ?? "immediate";
	const enabled = options.enabled ?? true;
	const catalog = useCapabilitiesStore((state) => state.catalog);
	const createSkill = useCapabilitiesStore((state) => state.createSkill);
	const deletePromptTemplate = useCapabilitiesStore((state) => state.deletePromptTemplate);
	const errorMessage = useCapabilitiesStore((state) => state.errorMessage);
	const getCapabilityDetail = useCapabilitiesStore((state) => state.getCapabilityDetail);
	const handleCapabilityEvent = useCapabilitiesStore((state) => state.handleCapabilityEvent);
	const hasLoaded = useCapabilitiesStore((state) => state.hasLoaded);
	const isLoading = useCapabilitiesStore((state) => state.isLoading);
	const isSaving = useCapabilitiesStore((state) => state.isSaving);
	const loadCapabilities = useCapabilitiesStore((state) => state.loadCapabilities);
	const reloadCapabilities = useCapabilitiesStore((state) => state.reloadCapabilities);
	const restartMcpServer = useCapabilitiesStore((state) => state.restartMcpServer);
	const setMcpServerEnabled = useCapabilitiesStore((state) => state.setMcpServerEnabled);
	const testMcpServer = useCapabilitiesStore((state) => state.testMcpServer);
	const upsertMcpServer = useCapabilitiesStore((state) => state.upsertMcpServer);
	const upsertPromptTemplate = useCapabilitiesStore((state) => state.upsertPromptTemplate);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const load = () => {
			markRendererPerformance("renderer:capabilities:load:start");
			void loadCapabilities(bridge).finally(() => {
				markRendererPerformance("renderer:capabilities:load:end");
				measureRendererPerformance(
					"renderer capabilities load",
					"renderer:capabilities:load:start",
					"renderer:capabilities:load:end",
				);
			});
		};

		if (defer === "idle") {
			return scheduleIdleWork(load, 350);
		}

		load();
	}, [bridge, defer, enabled, loadCapabilities]);

	useSubscribedResource<DesktopCapabilityEvent>(
		(onEvent) => bridge.subscribeToCapabilityEvents(onEvent),
		(event) => {
			handleCapabilityEvent(event);
		},
		[bridge, handleCapabilityEvent],
	);

	return {
		catalog,
		hasLoaded,
		isLoading,
		isSaving,
		errorMessage,
		getCapabilityDetail: (request: DesktopCapabilityDetailRequest) => getCapabilityDetail(bridge, request),
		createSkill: (request: DesktopCreateSkillRequest) => createSkill(bridge, request),
		upsertPromptTemplate: (request: DesktopPromptTemplateUpsertRequest) => upsertPromptTemplate(bridge, request),
		deletePromptTemplate: (request: DesktopPromptTemplateDeleteRequest) => deletePromptTemplate(bridge, request),
		upsertMcpServer: (request: DesktopMcpServerUpsertRequest) => upsertMcpServer(bridge, request),
		setMcpServerEnabled: (serverId: string, enabled: boolean) => setMcpServerEnabled(bridge, serverId, enabled),
		testMcpServer: (serverId: string) => testMcpServer(bridge, serverId),
		restartMcpServer: (serverId: string) => restartMcpServer(bridge, serverId),
		loadCapabilities: () => loadCapabilities(bridge),
		reloadCapabilities: () => reloadCapabilities(bridge),
	};
}
