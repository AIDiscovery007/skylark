import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopEventStore } from "../../src/main/events/event-store.ts";

async function createStore(): Promise<DesktopEventStore> {
	const rootDir = await mkdtemp(join(tmpdir(), "desktop-events-"));
	return new DesktopEventStore(
		join(rootDir, "events", "index.json"),
		join(rootDir, "events", "data"),
		join(rootDir, "events", "attachments"),
	);
}

async function createStoreFixture(): Promise<{ rootDir: string; store: DesktopEventStore }> {
	const rootDir = await mkdtemp(join(tmpdir(), "desktop-events-"));
	return {
		rootDir,
		store: new DesktopEventStore(
			join(rootDir, "events", "index.json"),
			join(rootDir, "events", "data"),
			join(rootDir, "events", "attachments"),
		),
	};
}

describe("DesktopEventStore", () => {
	it("normalizes legacy events that do not have management metadata", async () => {
		const { rootDir, store } = await createStoreFixture();
		const eventId = "legacy-event";
		const event = {
			id: eventId,
			title: "Legacy event",
			bodyPreview: "Legacy body",
			status: "inbox",
			attachmentCount: 0,
			createdAt: "2026-05-20T00:00:00.000Z",
			updatedAt: "2026-05-20T00:00:00.000Z",
			statusChangedAt: "2026-05-20T00:00:00.000Z",
			body: "Legacy body",
			attachments: [],
			runs: [],
		};
		await mkdir(join(rootDir, "events", "data"), { recursive: true });
		await writeFile(join(rootDir, "events", "index.json"), JSON.stringify({ [eventId]: event }), "utf8");
		await writeFile(join(rootDir, "events", "data", `${eventId}.json`), JSON.stringify(event), "utf8");

		const summaries = await store.listEvents();
		const detail = await store.getEvent(eventId);

		expect(summaries[0]).toEqual(
			expect.objectContaining({
				id: eventId,
				commentCount: 0,
			}),
		);
		expect(summaries[0]?.priority).toBeUndefined();
		expect(detail).toEqual(
			expect.objectContaining({
				id: eventId,
				commentCount: 0,
				comments: [],
			}),
		);
		expect(detail?.priority).toBeUndefined();
	});

	it("persists priority, comments, and selected management proposal updates", async () => {
		const store = await createStore();
		const created = await store.createEvent({ body: "Ship event management.", priority: "P2" });
		const stale = await store.createEvent({ body: "Discard stale idea." });
		await store.setEventStatus(stale.id, "ready");

		expect(created.priority).toBe("P2");
		expect(created.comments).toEqual([]);
		expect(created.commentCount).toBe(0);

		const userComment = await store.addEventComment(created.id, {
			author: "user",
			body: "This matters this week.",
		});
		expect(userComment.comments).toHaveLength(1);
		expect(userComment.commentCount).toBe(1);
		expect(userComment.latestCommentAt).toBe(userComment.comments[0]?.createdAt);

		const applied = await store.applyEventManagementProposal({
			proposalId: "proposal-1",
			selectedItemIds: ["item-1"],
			items: [
				{
					id: "item-1",
					eventId: created.id,
					priority: "P0",
					status: "ready",
					commentBody: "Escalated because it blocks the current release.",
					reason: "Release blocker.",
				},
				{
					id: "item-skipped",
					eventId: created.id,
					priority: "P3",
					status: "discarded",
					commentBody: "Should not apply.",
					reason: "Skipped item.",
				},
			],
		});

		expect(applied).toHaveLength(1);
		expect(applied[0]?.priority).toBe("P0");
		expect(applied[0]?.status).toBe("ready");
		expect(applied[0]?.comments.map((comment) => comment.body)).toEqual([
			"This matters this week.",
			"Escalated because it blocks the current release.",
		]);
		expect(applied[0]?.comments[1]).toEqual(
			expect.objectContaining({
				author: "agent",
				source: "management_proposal",
				proposalId: "proposal-1",
			}),
		);

		const discarded = await store.applyEventManagementProposal({
			proposalId: "proposal-2",
			selectedItemIds: ["discard-stale"],
			items: [
				{
					id: "discard-stale",
					eventId: stale.id,
					status: "discarded",
					commentBody: "Discarding because it no longer matches the event criteria.",
					reason: "Stale low-value event.",
				},
			],
		});

		expect(discarded[0]).toEqual(
			expect.objectContaining({
				id: stale.id,
				status: "discarded",
				commentCount: 1,
			}),
		);
		expect(discarded[0]?.comments[0]).toEqual(
			expect.objectContaining({
				author: "agent",
				body: "Discarding because it no longer matches the event criteria.",
				source: "management_proposal",
				proposalId: "proposal-2",
			}),
		);
		expect(await store.listEvents()).toEqual([expect.objectContaining({ id: created.id })]);
	});

	it("allows only comment-only management proposals for running events", async () => {
		const store = await createStore();
		const created = await store.createEvent({ body: "Already running work.", priority: "P1" });
		const { event } = await store.beginEventRun({
			eventId: created.id,
			projectId: "project-1",
			promptText: "Run it",
			attachmentIds: [],
		});

		const commented = await store.applyEventManagementProposal({
			proposalId: "proposal-1",
			selectedItemIds: ["running-comment"],
			items: [
				{
					id: "running-comment",
					eventId: event.id,
					commentBody: "Keep in progress until the current run reaches review.",
					reason: "Already running.",
				},
			],
		});

		expect(commented[0]).toEqual(
			expect.objectContaining({
				id: event.id,
				status: "running",
				priority: "P1",
				commentCount: 1,
			}),
		);

		await expect(
			store.applyEventManagementProposal({
				proposalId: "proposal-2",
				selectedItemIds: ["running-priority"],
				items: [
					{
						id: "running-priority",
						eventId: event.id,
						priority: "P3",
						commentBody: "Do not downgrade while running.",
						reason: "Invalid.",
					},
				],
			}),
		).rejects.toThrow(/comment-only/i);

		await expect(
			store.applyEventManagementProposal({
				proposalId: "proposal-3",
				selectedItemIds: ["running-discard"],
				items: [
					{
						id: "running-discard",
						eventId: event.id,
						status: "discarded",
						commentBody: "Do not discard while running.",
						reason: "Invalid.",
					},
				],
			}),
		).rejects.toThrow(/comment-only/i);
	});

	it("preserves event input bodies while deriving display titles", async () => {
		const store = await createStore();

		const singleLine = await store.createEvent({ body: "Prepare release notes." });
		expect(singleLine.title).toBe("Prepare release notes.");
		expect(singleLine.body).toBe("Prepare release notes.");
		expect(singleLine.bodyPreview).toBe("Prepare release notes.");

		const multiLine = await store.createEvent({ body: "Prepare release notes\nCollect final changelog entries." });
		expect(multiLine.title).toBe("Prepare release notes");
		expect(multiLine.body).toBe("Prepare release notes\nCollect final changelog entries.");
		expect(multiLine.bodyPreview).toBe("Prepare release notes Collect final changelog entries.");

		const explicitDuplicate = await store.createEvent({
			title: "Review launch plan",
			body: "Review launch plan",
		});
		expect(explicitDuplicate.title).toBe("Review launch plan");
		expect(explicitDuplicate.body).toBe("Review launch plan");
	});

	it("sorts events by priority and updated time", async () => {
		const { rootDir, store } = await createStoreFixture();
		await mkdir(join(rootDir, "events"), { recursive: true });
		const baseEvent = {
			attachmentCount: 0,
			bodyPreview: "",
			commentCount: 0,
			createdAt: "2026-05-20T00:00:00.000Z",
			status: "inbox",
			statusChangedAt: "2026-05-20T00:00:00.000Z",
			title: "Event",
		};
		await writeFile(
			join(rootDir, "events", "index.json"),
			JSON.stringify({
				"unset-new": {
					...baseEvent,
					id: "unset-new",
					updatedAt: "2026-05-20T00:04:00.000Z",
				},
				"p2-old": {
					...baseEvent,
					id: "p2-old",
					priority: "P2",
					updatedAt: "2026-05-20T00:01:00.000Z",
				},
				"p0-new": {
					...baseEvent,
					id: "p0-new",
					priority: "P0",
					updatedAt: "2026-05-20T00:02:00.000Z",
				},
				"p2-new": {
					...baseEvent,
					id: "p2-new",
					priority: "P2",
					updatedAt: "2026-05-20T00:03:00.000Z",
				},
				"p3-new": {
					...baseEvent,
					id: "p3-new",
					priority: "P3",
					updatedAt: "2026-05-20T00:05:00.000Z",
				},
			}),
			"utf8",
		);

		expect((await store.listEvents()).map((event) => event.id)).toEqual([
			"p0-new",
			"p2-new",
			"p2-old",
			"p3-new",
			"unset-new",
		]);
	});

	it("persists event CRUD with soft discard and restore", async () => {
		const store = await createStore();
		const created = await store.createEvent({ body: "Build the event board\nwith compact columns." });

		expect(created.status).toBe("inbox");
		expect(created.title).toBe("Build the event board");
		expect(await store.listEvents()).toHaveLength(1);

		const updated = await store.updateEvent(created.id, {
			title: "Event board",
			body: "Compact board body",
		});
		expect(updated.title).toBe("Event board");
		expect(updated.bodyPreview).toBe("Compact board body");

		const discarded = await store.setEventStatus(created.id, "discarded");
		expect(discarded.discardedAt).toBeTruthy();
		expect(await store.listEvents()).toEqual([]);
		expect(await store.listEvents({ includeDiscarded: true })).toHaveLength(1);

		const restored = await store.setEventStatus(created.id, "ready");
		expect(restored.status).toBe("ready");
		expect(restored.discardedAt).toBeUndefined();
		expect(await store.listEvents()).toHaveLength(1);

		await store.deleteEvent(created.id);
		expect(await store.getEvent(created.id)).toBeNull();
		expect(await store.listEvents({ includeDiscarded: true })).toEqual([]);
	});

	it("tracks run history without auto-completing event status", async () => {
		const store = await createStore();
		const event = await store.createEvent({ body: "Ship the runner." });

		const firstRun = await store.beginEventRun({
			eventId: event.id,
			projectId: "project-1",
			promptText: "Run it",
			attachmentIds: [],
		});
		expect(firstRun.event.status).toBe("running");
		expect(firstRun.event.activeRunStatus).toBe("running");

		const withSession = await store.updateRunSession(event.id, firstRun.run.id, "session-1");
		expect(withSession.activeSessionId).toBe("session-1");
		await expect(
			store.beginEventRun({
				eventId: event.id,
				projectId: "project-1",
				promptText: "Run again",
				attachmentIds: [],
			}),
		).rejects.toThrow(/already running/);

		const awaitingReview = await store.markRunAwaitingReviewForSession("session-1");
		expect(awaitingReview?.status).toBe("running");
		expect(awaitingReview?.activeRunStatus).toBeUndefined();
		expect(awaitingReview?.latestRunStatus).toBe("awaiting_review");

		const secondRun = await store.beginEventRun({
			eventId: event.id,
			projectId: "project-2",
			promptText: "Run follow-up",
			attachmentIds: [],
		});
		expect(secondRun.event.runs).toHaveLength(2);
		expect(secondRun.event.runs[1]?.status).toBe("running");
	});

	it("serializes concurrent mutations across parallel events", async () => {
		const store = await createStore();
		const events = await Promise.all(
			Array.from({ length: 40 }, (_, index) =>
				store.createEvent({ id: `event-${index}`, body: `Capture event ${index}` }),
			),
		);

		expect(await store.listEvents()).toHaveLength(40);

		await Promise.all(
			events.map((event, index) => store.setEventStatus(event.id, index % 2 === 0 ? "ready" : "completed")),
		);
		expect(await store.listEvents()).toHaveLength(40);

		const runs = await Promise.all(
			events.slice(0, 20).map((event, index) =>
				store.beginEventRun({
					eventId: event.id,
					projectId: "project-1",
					promptText: `Run event ${index}`,
					attachmentIds: [],
				}),
			),
		);
		await Promise.all(
			runs.map(({ event, run }, index) => store.updateRunSession(event.id, run.id, `session-${index}`)),
		);

		const runningEvents = await store.listEvents();
		expect(runningEvents.filter((event) => event.activeRunStatus === "running")).toHaveLength(20);

		await Promise.all(
			Array.from({ length: 20 }, (_, index) => store.markRunAwaitingReviewForSession(`session-${index}`)),
		);

		const awaitingReviewEvents = await store.listEvents();
		expect(awaitingReviewEvents.filter((event) => event.latestRunStatus === "awaiting_review")).toHaveLength(20);
		expect(awaitingReviewEvents.filter((event) => event.activeRunStatus === "running")).toHaveLength(0);
	});
});
