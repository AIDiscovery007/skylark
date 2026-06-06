import type { MessagePortMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import type {
	DesktopEnvironmentEvent,
	DesktopEnvironmentResource,
	DesktopEnvironmentResourceListRequest,
} from "../../shared/types.ts";
import type { JsonEnvironmentResourceStore } from "../environment/environment-resource-store.ts";
import type { DesktopSubagentRuntimeBroker } from "../runtime/subagent-runtime-broker.ts";
import { readSubagentSnapshot } from "../runtime/subagent-snapshot.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import {
	validateEnvironmentResourceDetachRequest,
	validateEnvironmentResourceListRequest,
	validateSubagentSnapshotRequest,
} from "./validate-ipc.ts";

export interface DesktopEnvironmentBridgeServices {
	environmentResourceStore: Pick<JsonEnvironmentResourceStore, "detachResource" | "listResources">;
	refreshEnvironmentResources?: () => Promise<DesktopEnvironmentResource[]>;
	subagentRuntimeBroker?: Pick<DesktopSubagentRuntimeBroker, "openPort">;
	subagentSessionsDir?: string;
}

export interface DesktopEnvironmentBridgeGroup {
	group: DesktopBridgeGroupDescriptor;
	refreshAndPublishResources(request?: DesktopEnvironmentResourceListRequest): Promise<DesktopEnvironmentResource[]>;
}

export function createEnvironmentBridgeGroup(
	services?: DesktopEnvironmentBridgeServices,
): DesktopEnvironmentBridgeGroup {
	const ports = new Set<MessagePortMain>();

	const publishEnvironmentEvent = (event: DesktopEnvironmentEvent): void => {
		for (const port of ports) {
			port.postMessage(event);
		}
	};

	const refreshAndPublishResources = async (
		request?: DesktopEnvironmentResourceListRequest,
	): Promise<DesktopEnvironmentResource[]> => {
		if (!services) {
			return [];
		}
		const resources = services.refreshEnvironmentResources
			? await services.refreshEnvironmentResources()
			: await services.environmentResourceStore.listResources();
		const filtered = request
			? resources.filter((resource) => !request.sessionId || resource.sessionId === request.sessionId)
			: resources;
		publishEnvironmentEvent({
			type: "environment_resources_updated",
			resources,
			updatedAt: new Date().toISOString(),
		});
		return filtered;
	};

	return {
		group: {
			commands: [
				{
					channel: IPC_CHANNELS.listEnvironmentResources,
					handle: async (_event, request?: unknown) =>
						refreshAndPublishResources(validateEnvironmentResourceListRequest(request)),
				},
				{
					channel: IPC_CHANNELS.detachEnvironmentResource,
					handle: async (_event, request: unknown) => {
						if (!services) {
							throw new Error("Environment resources are not available.");
						}
						const validatedRequest = validateEnvironmentResourceDetachRequest(request);
						const resource = await services.environmentResourceStore.detachResource(validatedRequest.resourceId);
						publishEnvironmentEvent({
							type: "environment_resource_detached",
							resource,
							updatedAt: new Date().toISOString(),
						});
						return resource;
					},
				},
				{
					channel: IPC_CHANNELS.getSubagentSnapshot,
					handle: async (_event, request: unknown) => {
						if (!services?.subagentSessionsDir) {
							throw new Error("Subagent snapshots are not available.");
						}
						return readSubagentSnapshot({
							environmentResourceStore: services.environmentResourceStore,
							request: validateSubagentSnapshotRequest(request),
							subagentSessionsDir: services.subagentSessionsDir,
						});
					},
				},
			],
			streams: [
				{
					channel: IPC_CHANNELS.openEnvironmentStream,
					open: (port) => {
						ports.add(port);
						port.start();
						port.on("close", () => {
							ports.delete(port);
						});
					},
				},
				{
					channel: IPC_CHANNELS.openSubagentStream,
					open: (port) => {
						services?.subagentRuntimeBroker?.openPort(port);
					},
				},
			],
		},
		refreshAndPublishResources,
	};
}
