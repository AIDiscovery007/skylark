import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDesktopAgentEventCreator } from "../../src/main/events/agent-event-creation-service.ts";
import { DesktopEventStore } from "../../src/main/events/event-store.ts";
import { DesktopEventStreamBroker } from "../../src/main/events/event-stream-broker.ts";

async function createStore(): Promise<DesktopEventStore> {
	const rootDir = await mkdtemp(join(tmpdir(), "desktop-agent-events-"));
	return new DesktopEventStore(
		join(rootDir, "events", "index.json"),
		join(rootDir, "events", "data"),
		join(rootDir, "events", "attachments"),
	);
}

class FakeMessagePort {
	readonly messages: unknown[] = [];
	readonly start = vi.fn();

	postMessage(message: unknown): void {
		this.messages.push(message);
	}

	on(): void {}
}

describe("createDesktopAgentEventCreator", () => {
	it("creates agent-requested events and publishes event updates", async () => {
		const eventStore = await createStore();
		const eventBroker = new DesktopEventStreamBroker();
		const port = new FakeMessagePort();
		eventBroker.openPort(port as never);
		const createEvents = createDesktopAgentEventCreator({ eventStore, eventBroker });

		const created = await createEvents([
			{ title: "Follow up with design", body: "Ask for final copy." },
			{ body: "Prepare release notes." },
		]);

		expect(created).toHaveLength(2);
		expect(created[0]).toEqual(
			expect.objectContaining({
				title: "Follow up with design",
				body: "Ask for final copy.",
				status: "inbox",
			}),
		);
		expect(created[1]).toEqual(
			expect.objectContaining({
				title: "Prepare release notes.",
				body: "Prepare release notes.",
				status: "inbox",
			}),
		);
		expect(port.start).toHaveBeenCalledOnce();
		expect(port.messages).toEqual([
			expect.objectContaining({ type: "event_updated", event: expect.objectContaining({ id: created[0]?.id }) }),
			expect.objectContaining({ type: "event_updated", event: expect.objectContaining({ id: created[1]?.id }) }),
		]);
		await expect(eventStore.listEvents()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: created[0]?.id }),
				expect.objectContaining({ id: created[1]?.id }),
			]),
		);
	});
});
