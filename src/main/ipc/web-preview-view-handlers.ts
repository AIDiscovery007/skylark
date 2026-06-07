import { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import { DesktopWebPreviewViewService } from "../preview/web-preview-view-service.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import {
	validateWebPreviewBoundsRequest,
	validateWebPreviewCloseRequest,
	validateWebPreviewControlRequest,
	validateWebPreviewSelectionModeRequest,
	validateWebPreviewShowRequest,
	validateWebPreviewStorageRequest,
} from "./validate-ipc.ts";

export interface DesktopWebPreviewBridgeServices {
	webPreviewViewService?: DesktopWebPreviewViewService;
}

export function createWebPreviewBridgeGroup(
	services: DesktopWebPreviewBridgeServices = {},
): DesktopBridgeGroupDescriptor {
	const webPreviewViewService = services.webPreviewViewService ?? new DesktopWebPreviewViewService();

	return {
		commands: [
			{
				channel: IPC_CHANNELS.showWebPreview,
				handle: async (event, request: unknown) => {
					const window = BrowserWindow.fromWebContents(event.sender);
					if (!window) {
						throw new Error("Web preview requires an active BrowserWindow.");
					}
					return webPreviewViewService.show({
						...validateWebPreviewShowRequest(request),
						window,
					});
				},
			},
			{
				channel: IPC_CHANNELS.updateWebPreviewBounds,
				handle: async (_event, request: unknown) => {
					const validatedRequest = validateWebPreviewBoundsRequest(request);
					return webPreviewViewService.updateBounds(
						validatedRequest.id,
						validatedRequest.bounds,
						validatedRequest.occluded,
					);
				},
			},
			{
				channel: IPC_CHANNELS.controlWebPreview,
				handle: async (_event, request: unknown) => {
					const validatedRequest = validateWebPreviewControlRequest(request);
					return webPreviewViewService.control(validatedRequest.id, validatedRequest.action);
				},
			},
			{
				channel: IPC_CHANNELS.clearWebPreviewStorage,
				handle: async (_event, request: unknown) => {
					const validatedRequest = validateWebPreviewStorageRequest(request);
					return webPreviewViewService.clearStorage(validatedRequest.id, validatedRequest.storage);
				},
			},
			{
				channel: IPC_CHANNELS.setWebPreviewElementSelectionMode,
				handle: async (_event, request: unknown) => {
					const validatedRequest = validateWebPreviewSelectionModeRequest(request);
					return webPreviewViewService.setElementSelectionMode(validatedRequest.id, validatedRequest.enabled);
				},
			},
			{
				channel: IPC_CHANNELS.closeWebPreview,
				handle: async (_event, request: unknown) => {
					webPreviewViewService.close(validateWebPreviewCloseRequest(request).id);
				},
			},
		],
		streams: [
			{
				channel: IPC_CHANNELS.openWebPreviewStream,
				open: (port) => {
					webPreviewViewService.openPort(port);
				},
			},
		],
	};
}
