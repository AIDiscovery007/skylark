import type { DesktopAgentCreateEventInput, DesktopEventDetail } from "../../shared/types.ts";
import type { DesktopEventStore } from "./event-store.ts";
import type { DesktopEventStreamBroker } from "./event-stream-broker.ts";

export function createDesktopAgentEventCreator(services: {
	eventBroker: Pick<DesktopEventStreamBroker, "publishEventUpdate">;
	eventStore: Pick<DesktopEventStore, "createEvent">;
}): (events: DesktopAgentCreateEventInput[]) => Promise<DesktopEventDetail[]> {
	return async (events) => {
		const createdEvents: DesktopEventDetail[] = [];
		for (const event of events) {
			const createdEvent = await services.eventStore.createEvent({
				title: event.title,
				body: event.body,
			});
			services.eventBroker.publishEventUpdate(createdEvent);
			createdEvents.push(createdEvent);
		}
		return createdEvents;
	};
}
