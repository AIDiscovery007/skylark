import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getErrorMessage } from "../../shared/errors.ts";
import type { DesktopAgentBridge } from "../../shared/ipc-contract.ts";
import type {
	DesktopEventCommentCreateRequest,
	DesktopEventCreateRequest,
	DesktopEventDetail,
	DesktopEventEvent,
	DesktopEventManagementApplyRequest,
	DesktopEventManagementProposal,
	DesktopEventManagementProposalRequest,
	DesktopEventRunRequest,
	DesktopEventRunResult,
	DesktopEventStatus,
	DesktopEventSummary,
	DesktopOpenEventAttachmentsRequest,
	DesktopPrepareEventAttachmentsRequest,
	DesktopPrepareEventAttachmentsResult,
} from "../../shared/types.ts";
import { resolveDesktopAgentBridge } from "../lib/desktop-agent-bridge.ts";
import { useSubscribedResource } from "./use-subscribed-resource.ts";

type EventBridge = Pick<
	DesktopAgentBridge,
	| "addEventComment"
	| "applyEventManagementProposal"
	| "createEvent"
	| "createEventManagementProposal"
	| "deleteEvent"
	| "getEvent"
	| "listEvents"
	| "openEventAttachments"
	| "prepareEventAttachments"
	| "runEvent"
	| "setEventStatus"
	| "subscribeToEventEvents"
	| "updateEvent"
>;

export interface UseEventsResult {
	events: DesktopEventSummary[];
	activeEvent?: DesktopEventDetail;
	activeEventId?: string;
	eventManagementProposal?: DesktopEventManagementProposal;
	errorMessage?: string;
	hasLoaded: boolean;
	isLoading: boolean;
	isManagingEvents: boolean;
	isPreparingAttachments: boolean;
	isSaving: boolean;
	isRunning: boolean;
	addEventComment: (
		input: Omit<DesktopEventCommentCreateRequest, "author">,
	) => Promise<DesktopEventDetail | undefined>;
	applyEventManagementProposal: (
		request: DesktopEventManagementApplyRequest,
	) => Promise<DesktopEventDetail[] | undefined>;
	clearEventManagementProposal: () => void;
	createEvent: (request: DesktopEventCreateRequest) => Promise<DesktopEventDetail | undefined>;
	createEventManagementProposal: (
		request?: DesktopEventManagementProposalRequest,
	) => Promise<DesktopEventManagementProposal | undefined>;
	deleteEvent: (eventId: string) => Promise<void>;
	prepareEventAttachments: (
		request: DesktopPrepareEventAttachmentsRequest,
	) => Promise<DesktopPrepareEventAttachmentsResult>;
	openEventAttachments: (
		request?: DesktopOpenEventAttachmentsRequest,
	) => Promise<DesktopPrepareEventAttachmentsResult>;
	refreshEvents: () => Promise<void>;
	runEvent: (request: DesktopEventRunRequest) => Promise<DesktopEventRunResult | undefined>;
	selectEvent: (eventId: string) => Promise<void>;
	setEventStatus: (eventId: string, status: DesktopEventStatus) => Promise<DesktopEventDetail | undefined>;
	updateEvent: (eventId: string, input: { title?: string; body?: string }) => Promise<DesktopEventDetail | undefined>;
}

function toSummary(event: DesktopEventDetail): DesktopEventSummary {
	const { attachments: _attachments, body: _body, comments: _comments, runs: _runs, ...summary } = event;
	return summary;
}

function replaceEventSummary(events: DesktopEventSummary[], event: DesktopEventDetail): DesktopEventSummary[] {
	const summary = toSummary(event);
	const eventIndex = events.findIndex((candidate) => candidate.id === event.id);
	if (eventIndex === -1) {
		return [summary, ...events];
	}
	const nextEvents = events.slice();
	nextEvents[eventIndex] = summary;
	return nextEvents;
}

export function useEvents(options: { bridge?: EventBridge; enabled?: boolean } = {}): UseEventsResult {
	const bridge = resolveDesktopAgentBridge(options.bridge);
	const enabled = options.enabled ?? true;
	const [events, setEvents] = useState<DesktopEventSummary[]>([]);
	const [activeEventId, setActiveEventId] = useState<string | undefined>();
	const [activeEvent, setActiveEvent] = useState<DesktopEventDetail | undefined>();
	const [eventManagementProposal, setEventManagementProposal] = useState<DesktopEventManagementProposal | undefined>();
	const [hasLoaded, setHasLoaded] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [isManagingEvents, setIsManagingEvents] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
	const [isRunning, setIsRunning] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | undefined>();
	const refreshPromiseRef = useRef<Promise<void> | undefined>(undefined);

	const refreshEvents = useCallback(async () => {
		if (refreshPromiseRef.current) {
			return refreshPromiseRef.current;
		}

		setIsLoading(true);
		setErrorMessage(undefined);
		const refreshPromise = (async () => {
			try {
				const nextEvents = await bridge.listEvents({ includeDiscarded: true });
				setEvents(nextEvents);
				setActiveEventId((current) => {
					if (current && nextEvents.some((event) => event.id === current)) {
						return current;
					}
					return nextEvents.find((event) => event.status !== "discarded")?.id ?? nextEvents[0]?.id;
				});
			} catch (error) {
				setErrorMessage(getErrorMessage(error));
			} finally {
				setHasLoaded(true);
				setIsLoading(false);
				refreshPromiseRef.current = undefined;
			}
		})();
		refreshPromiseRef.current = refreshPromise;
		return refreshPromise;
	}, [bridge]);

	useEffect(() => {
		if (!enabled || hasLoaded) {
			return;
		}
		void refreshEvents();
	}, [enabled, hasLoaded, refreshEvents]);

	useSubscribedResource<DesktopEventEvent>(
		(onEvent) => (enabled ? bridge.subscribeToEventEvents(onEvent) : undefined),
		(event) => {
			if (event.type === "event_deleted") {
				setEvents((currentEvents) => currentEvents.filter((candidate) => candidate.id !== event.eventId));
				setActiveEvent((currentEvent) => (currentEvent?.id === event.eventId ? undefined : currentEvent));
				setActiveEventId((currentEventId) => (currentEventId === event.eventId ? undefined : currentEventId));
				return;
			}

			setEvents((currentEvents) => replaceEventSummary(currentEvents, event.event));
			setActiveEvent((currentEvent) => (currentEvent?.id === event.event.id ? event.event : currentEvent));
		},
		[bridge, enabled],
	);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		if (!activeEventId) {
			setActiveEvent(undefined);
			return;
		}
		let isDisposed = false;
		void bridge
			.getEvent(activeEventId)
			.then((event) => {
				if (!isDisposed) {
					setActiveEvent(event);
				}
			})
			.catch((error) => {
				if (!isDisposed) {
					setErrorMessage(getErrorMessage(error));
				}
			});
		return () => {
			isDisposed = true;
		};
	}, [activeEventId, bridge, enabled]);

	const selectEvent = useCallback(async (eventId: string) => {
		setActiveEventId(eventId);
	}, []);

	const createEvent = useCallback(
		async (request: DesktopEventCreateRequest): Promise<DesktopEventDetail | undefined> => {
			setIsSaving(true);
			setErrorMessage(undefined);
			try {
				const event = await bridge.createEvent(request);
				setEvents((currentEvents) => replaceEventSummary(currentEvents, event));
				setActiveEventId(event.id);
				setActiveEvent(event);
				return event;
			} catch (error) {
				setErrorMessage(getErrorMessage(error));
				return undefined;
			} finally {
				setIsSaving(false);
			}
		},
		[bridge],
	);

	const updateEvent = useCallback(
		async (eventId: string, input: { title?: string; body?: string }): Promise<DesktopEventDetail | undefined> => {
			setIsSaving(true);
			setErrorMessage(undefined);
			try {
				const event = await bridge.updateEvent({ eventId, ...input });
				setEvents((currentEvents) => replaceEventSummary(currentEvents, event));
				setActiveEvent(event);
				return event;
			} catch (error) {
				setErrorMessage(getErrorMessage(error));
				return undefined;
			} finally {
				setIsSaving(false);
			}
		},
		[bridge],
	);

	const setEventStatus = useCallback(
		async (eventId: string, status: DesktopEventStatus): Promise<DesktopEventDetail | undefined> => {
			setIsSaving(true);
			setErrorMessage(undefined);
			try {
				const event = await bridge.setEventStatus({ eventId, status });
				setEvents((currentEvents) => replaceEventSummary(currentEvents, event));
				setActiveEvent(event);
				return event;
			} catch (error) {
				setErrorMessage(getErrorMessage(error));
				return undefined;
			} finally {
				setIsSaving(false);
			}
		},
		[bridge],
	);

	const addEventComment = useCallback(
		async (input: Omit<DesktopEventCommentCreateRequest, "author">): Promise<DesktopEventDetail | undefined> => {
			setIsSaving(true);
			setErrorMessage(undefined);
			try {
				const event = await bridge.addEventComment({ ...input, author: "user" });
				setEvents((currentEvents) => replaceEventSummary(currentEvents, event));
				setActiveEvent(event);
				return event;
			} catch (error) {
				setErrorMessage(getErrorMessage(error));
				return undefined;
			} finally {
				setIsSaving(false);
			}
		},
		[bridge],
	);

	const createEventManagementProposal = useCallback(
		async (request?: DesktopEventManagementProposalRequest): Promise<DesktopEventManagementProposal | undefined> => {
			setIsManagingEvents(true);
			setErrorMessage(undefined);
			try {
				const proposal = await bridge.createEventManagementProposal(request);
				setEventManagementProposal(proposal);
				return proposal;
			} catch (error) {
				setErrorMessage(getErrorMessage(error));
				return undefined;
			} finally {
				setIsManagingEvents(false);
			}
		},
		[bridge],
	);

	const applyEventManagementProposal = useCallback(
		async (request: DesktopEventManagementApplyRequest): Promise<DesktopEventDetail[] | undefined> => {
			setIsSaving(true);
			setErrorMessage(undefined);
			try {
				const updatedEvents = await bridge.applyEventManagementProposal(request);
				setEvents((currentEvents) =>
					updatedEvents.reduce((nextEvents, event) => replaceEventSummary(nextEvents, event), currentEvents),
				);
				setActiveEvent((currentEvent) => {
					if (!currentEvent) {
						return currentEvent;
					}
					return updatedEvents.find((event) => event.id === currentEvent.id) ?? currentEvent;
				});
				setEventManagementProposal(undefined);
				return updatedEvents;
			} catch (error) {
				setErrorMessage(getErrorMessage(error));
				return undefined;
			} finally {
				setIsSaving(false);
			}
		},
		[bridge],
	);

	const clearEventManagementProposal = useCallback(() => {
		setEventManagementProposal(undefined);
	}, []);

	const deleteEvent = useCallback(
		async (eventId: string): Promise<void> => {
			setIsSaving(true);
			setErrorMessage(undefined);
			try {
				await bridge.deleteEvent({ eventId });
				setEvents((currentEvents) => {
					const nextEvents = currentEvents.filter((event) => event.id !== eventId);
					setActiveEventId((currentId) =>
						currentId === eventId
							? (nextEvents.find((event) => event.status !== "discarded")?.id ?? nextEvents[0]?.id)
							: currentId,
					);
					return nextEvents;
				});
				setActiveEvent((currentEvent) => (currentEvent?.id === eventId ? undefined : currentEvent));
			} catch (error) {
				setErrorMessage(getErrorMessage(error));
			} finally {
				setIsSaving(false);
			}
		},
		[bridge],
	);

	const prepareEventAttachments = useCallback(
		async (request: DesktopPrepareEventAttachmentsRequest): Promise<DesktopPrepareEventAttachmentsResult> => {
			setIsPreparingAttachments(true);
			setErrorMessage(undefined);
			try {
				return await bridge.prepareEventAttachments(request);
			} catch (error) {
				setErrorMessage(getErrorMessage(error));
				return { attachments: [], errors: [{ name: "Attachments", message: getErrorMessage(error) }] };
			} finally {
				setIsPreparingAttachments(false);
			}
		},
		[bridge],
	);

	const openEventAttachments = useCallback(
		async (request?: DesktopOpenEventAttachmentsRequest): Promise<DesktopPrepareEventAttachmentsResult> => {
			setIsPreparingAttachments(true);
			setErrorMessage(undefined);
			try {
				return await bridge.openEventAttachments(request);
			} catch (error) {
				setErrorMessage(getErrorMessage(error));
				return { attachments: [], errors: [{ name: "Attachments", message: getErrorMessage(error) }] };
			} finally {
				setIsPreparingAttachments(false);
			}
		},
		[bridge],
	);

	const runEvent = useCallback(
		async (request: DesktopEventRunRequest): Promise<DesktopEventRunResult | undefined> => {
			setIsRunning(true);
			setErrorMessage(undefined);
			try {
				const result = await bridge.runEvent(request);
				setEvents((currentEvents) => replaceEventSummary(currentEvents, result.event));
				setActiveEvent(result.event);
				return result;
			} catch (error) {
				setErrorMessage(getErrorMessage(error));
				return undefined;
			} finally {
				setIsRunning(false);
			}
		},
		[bridge],
	);

	return useMemo(
		() => ({
			events,
			activeEvent,
			activeEventId,
			eventManagementProposal,
			errorMessage,
			hasLoaded,
			isLoading,
			isManagingEvents,
			isPreparingAttachments,
			isSaving,
			isRunning,
			addEventComment,
			applyEventManagementProposal,
			clearEventManagementProposal,
			createEvent,
			createEventManagementProposal,
			deleteEvent,
			openEventAttachments,
			prepareEventAttachments,
			refreshEvents,
			runEvent,
			selectEvent,
			setEventStatus,
			updateEvent,
		}),
		[
			activeEvent,
			activeEventId,
			addEventComment,
			applyEventManagementProposal,
			clearEventManagementProposal,
			createEvent,
			createEventManagementProposal,
			deleteEvent,
			eventManagementProposal,
			errorMessage,
			events,
			hasLoaded,
			isLoading,
			isManagingEvents,
			isPreparingAttachments,
			isRunning,
			isSaving,
			openEventAttachments,
			prepareEventAttachments,
			refreshEvents,
			runEvent,
			selectEvent,
			setEventStatus,
			updateEvent,
		],
	);
}
