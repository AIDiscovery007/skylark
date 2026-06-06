import { randomUUID } from "node:crypto";
import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import { copyDesktopEventAttachments, prepareDesktopEventAttachments } from "../events/event-attachment-service.ts";
import {
	createDesktopEventManagementProposal,
	type DesktopEventManagementGenerateText,
	readDesktopEventManagementCriteria,
	writeDesktopEventManagementCriteria,
} from "../events/event-management-service.ts";
import { runDesktopEvent } from "../events/event-run-service.ts";
import type { DesktopEventStore } from "../events/event-store.ts";
import type { DesktopEventStreamBroker } from "../events/event-stream-broker.ts";
import type { DesktopRuntimeHost } from "../runtime/desktop-runtime-host.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import {
	validateEventCommentCreateRequest,
	validateEventCreateRequest,
	validateEventDeleteRequest,
	validateEventListRequest,
	validateEventManagementApplyRequest,
	validateEventManagementCriteriaUpdateRequest,
	validateEventManagementProposalRequest,
	validateEventRunRequest,
	validateEventStatusUpdateRequest,
	validateEventUpdateRequest,
	validateOpenEventAttachmentsRequest,
	validatePrepareEventAttachmentsRequest,
	validateSessionId,
} from "./validate-ipc.ts";

export interface DesktopEventManagementBridgeServices {
	criteriaFilePath: string;
	generateText: DesktopEventManagementGenerateText;
}

export interface DesktopEventBridgeGroupOptions {
	eventBroker: DesktopEventStreamBroker;
	eventStore: DesktopEventStore;
	host: Pick<DesktopRuntimeHost, "newSession" | "prompt">;
	managementServices?: DesktopEventManagementBridgeServices;
}

export interface DesktopEventBridgeGroup {
	group: DesktopBridgeGroupDescriptor;
	markRunAwaitingReviewForSession(sessionId: string): Promise<void>;
}

export function createEventBridgeGroup(options: DesktopEventBridgeGroupOptions): DesktopEventBridgeGroup {
	const publishEventUpdate = (event: Awaited<ReturnType<DesktopEventStore["getEvent"]>> | undefined): void => {
		options.eventBroker.publishEventUpdate(event);
	};
	const requireManagementServices = (): DesktopEventManagementBridgeServices => {
		if (!options.managementServices) {
			throw new Error("Event management services are not configured.");
		}
		return options.managementServices;
	};

	return {
		group: {
			commands: [
				{
					channel: IPC_CHANNELS.listEvents,
					handle: async (_event, request: unknown) =>
						options.eventStore.listEvents(validateEventListRequest(request)),
				},
				{
					channel: IPC_CHANNELS.getEvent,
					handle: async (_event, eventId: unknown) => {
						const event = await options.eventStore.getEvent(validateSessionId(eventId));
						return event ?? undefined;
					},
				},
				{
					channel: IPC_CHANNELS.prepareEventAttachments,
					handle: async (_event, request: unknown) => {
						const validatedRequest = validatePrepareEventAttachmentsRequest(request);
						return prepareDesktopEventAttachments(validatedRequest.candidates);
					},
				},
				{
					channel: IPC_CHANNELS.openEventAttachments,
					handle: async (event, request: unknown) => {
						const validatedRequest = validateOpenEventAttachmentsRequest(request);
						const browserWindow = BrowserWindow.fromWebContents(event.sender);
						const dialogOptions: OpenDialogOptions = {
							filters: [{ name: "Event documents", extensions: ["txt", "md", "docx"] }],
							properties: ["openFile", "multiSelections"],
							...(validatedRequest.defaultPath ? { defaultPath: validatedRequest.defaultPath } : {}),
						};
						const result = browserWindow
							? await dialog.showOpenDialog(browserWindow, dialogOptions)
							: await dialog.showOpenDialog(dialogOptions);
						if (result.canceled) {
							return { attachments: [], errors: [] };
						}
						return prepareDesktopEventAttachments(
							result.filePaths.map((filePath) => ({ type: "path", path: filePath })),
						);
					},
				},
				{
					channel: IPC_CHANNELS.createEvent,
					handle: async (_event, request: unknown) => {
						const validatedRequest = validateEventCreateRequest(request);
						const eventId = randomUUID();
						const attachments = validatedRequest.attachments
							? await copyDesktopEventAttachments({
									eventId,
									attachmentsRootDir: options.eventStore.attachmentsRootDir,
									drafts: validatedRequest.attachments,
								})
							: [];
						const event = await options.eventStore.createEvent({
							title: validatedRequest.title,
							body: validatedRequest.body,
							priority: validatedRequest.priority,
							...(attachments.length > 0 ? { attachments } : {}),
							id: eventId,
						});
						publishEventUpdate(event);
						return event;
					},
				},
				{
					channel: IPC_CHANNELS.updateEvent,
					handle: async (_event, request: unknown) => {
						const validatedRequest = validateEventUpdateRequest(request);
						const event = await options.eventStore.updateEvent(validatedRequest.eventId, validatedRequest);
						publishEventUpdate(event);
						return event;
					},
				},
				{
					channel: IPC_CHANNELS.addEventComment,
					handle: async (_event, request: unknown) => {
						const validatedRequest = validateEventCommentCreateRequest(request);
						const event = await options.eventStore.addEventComment(validatedRequest.eventId, {
							author: validatedRequest.author,
							body: validatedRequest.body,
							source: "manual",
						});
						publishEventUpdate(event);
						return event;
					},
				},
				{
					channel: IPC_CHANNELS.getEventManagementCriteria,
					handle: async () => {
						const services = requireManagementServices();
						return readDesktopEventManagementCriteria(services.criteriaFilePath);
					},
				},
				{
					channel: IPC_CHANNELS.saveEventManagementCriteria,
					handle: async (_event, request: unknown) => {
						const services = requireManagementServices();
						return writeDesktopEventManagementCriteria(
							services.criteriaFilePath,
							validateEventManagementCriteriaUpdateRequest(request).content,
						);
					},
				},
				{
					channel: IPC_CHANNELS.createEventManagementProposal,
					handle: async (_event, request: unknown) => {
						const services = requireManagementServices();
						return createDesktopEventManagementProposal({
							criteriaFilePath: services.criteriaFilePath,
							eventStore: options.eventStore,
							generateText: services.generateText,
							request: validateEventManagementProposalRequest(request),
						});
					},
				},
				{
					channel: IPC_CHANNELS.applyEventManagementProposal,
					handle: async (_event, request: unknown) => {
						const validatedRequest = validateEventManagementApplyRequest(request);
						const events = await options.eventStore.applyEventManagementProposal(validatedRequest);
						for (const event of events) {
							publishEventUpdate(event);
						}
						return events;
					},
				},
				{
					channel: IPC_CHANNELS.setEventStatus,
					handle: async (_event, request: unknown) => {
						const validatedRequest = validateEventStatusUpdateRequest(request);
						const event = await options.eventStore.setEventStatus(
							validatedRequest.eventId,
							validatedRequest.status,
						);
						publishEventUpdate(event);
						return event;
					},
				},
				{
					channel: IPC_CHANNELS.deleteEvent,
					handle: async (_event, request: unknown) => {
						const validatedRequest = validateEventDeleteRequest(request);
						await options.eventStore.deleteEvent(validatedRequest.eventId);
						options.eventBroker.publishEventDelete(validatedRequest.eventId);
					},
				},
				{
					channel: IPC_CHANNELS.runEvent,
					handle: async (_event, request: unknown) => {
						const validatedRequest = validateEventRunRequest(request);
						try {
							const result = await runDesktopEvent({
								eventStore: options.eventStore,
								host: options.host,
								request: validatedRequest,
							});
							publishEventUpdate(result.event);
							return result;
						} catch (error) {
							publishEventUpdate(await options.eventStore.getEvent(validatedRequest.eventId));
							throw error;
						}
					},
				},
			],
			streams: [
				{
					channel: IPC_CHANNELS.openEventStream,
					open: (port) => {
						options.eventBroker.openPort(port);
					},
				},
			],
		},
		async markRunAwaitingReviewForSession(sessionId: string): Promise<void> {
			publishEventUpdate(await options.eventStore.markRunAwaitingReviewForSession(sessionId));
		},
	};
}
