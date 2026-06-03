import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	createDesktopEventManagementProposal,
	readDesktopEventManagementCriteria,
	writeDesktopEventManagementCriteria,
} from "../../src/main/events/event-management-service.ts";
import { DesktopEventStore } from "../../src/main/events/event-store.ts";

async function createStoreFixture(): Promise<{
	criteriaFilePath: string;
	rootDir: string;
	store: DesktopEventStore;
}> {
	const rootDir = await mkdtemp(join(tmpdir(), "desktop-event-management-"));
	return {
		criteriaFilePath: join(rootDir, "events", "EVENTS.md"),
		rootDir,
		store: new DesktopEventStore(
			join(rootDir, "events", "index.json"),
			join(rootDir, "events", "data"),
			join(rootDir, "events", "attachments"),
		),
	};
}

describe("event management service", () => {
	it("creates and updates the default event management criteria file", async () => {
		const { criteriaFilePath } = await createStoreFixture();

		const initial = await readDesktopEventManagementCriteria(criteriaFilePath);
		expect(initial.path).toBe(criteriaFilePath);
		expect(initial.content).toContain("Event Management Criteria");
		expect(initial.content).toContain("discard");

		const updated = await writeDesktopEventManagementCriteria(criteriaFilePath, "Prioritize release blockers.");
		expect(updated.content).toBe("Prioritize release blockers.");
		expect((await readDesktopEventManagementCriteria(criteriaFilePath)).content).toBe("Prioritize release blockers.");
	});

	it("deletes legacy event criteria files and creates EVENTS.md", async () => {
		const { criteriaFilePath, rootDir } = await createStoreFixture();
		const legacyCriteriaFilePath = join(rootDir, "events", "events.md");
		await mkdir(join(rootDir, "events"), { recursive: true });
		await writeFile(legacyCriteriaFilePath, "Legacy event criteria.", "utf8");

		const created = await readDesktopEventManagementCriteria(criteriaFilePath);

		expect(criteriaFilePath.endsWith("EVENTS.md")).toBe(true);
		expect(created.path).toBe(criteriaFilePath);
		expect(created.content).toContain("Event Management Criteria");
		await expect(readFile(criteriaFilePath, "utf8")).resolves.toContain("Event Management Criteria");
		await expect(readdir(join(rootDir, "events"))).resolves.toContain("EVENTS.md");

		const secondFixture = await createStoreFixture();
		const legacyAgentsFilePath = join(secondFixture.rootDir, "events", "AGENTS.md");
		await mkdir(join(secondFixture.rootDir, "events"), { recursive: true });
		await writeFile(legacyAgentsFilePath, "Legacy agent-style criteria.", "utf8");

		const createdAfterAgentsFile = await readDesktopEventManagementCriteria(secondFixture.criteriaFilePath);

		expect(createdAfterAgentsFile.path).toBe(secondFixture.criteriaFilePath);
		expect(createdAfterAgentsFile.content).toContain("Event Management Criteria");
		await expect(readFile(secondFixture.criteriaFilePath, "utf8")).resolves.toContain("Event Management Criteria");
		await expect(readFile(legacyAgentsFilePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("builds an active-event-only proposal from criteria and validates structured items", async () => {
		const { criteriaFilePath, store } = await createStoreFixture();
		await writeDesktopEventManagementCriteria(criteriaFilePath, "P0 means release blocking.");
		const active = await store.createEvent({ body: "Fix release blocker", priority: "P2" });
		const stale = await store.createEvent({ body: "Old low-value idea" });
		await store.setEventStatus(stale.id, "ready");
		await store.addEventComment(active.id, { author: "user", body: "Needed today." });
		await store.createEvent({ body: "Completed item" }).then((event) => store.setEventStatus(event.id, "completed"));
		await store.createEvent({ body: "Discarded item" }).then((event) => store.setEventStatus(event.id, "discarded"));

		const generateText = vi.fn(async ({ prompt }: { prompt: string }) => {
			expect(prompt).toContain("P0 means release blocking.");
			expect(prompt).toContain("Fix release blocker");
			expect(prompt).toContain("Old low-value idea");
			expect(prompt).toContain("Needed today.");
			expect(prompt).not.toContain("Completed item");
			expect(prompt).not.toContain("Discarded item");
			return JSON.stringify({
				items: [
					{
						id: "proposal-item-1",
						eventId: active.id,
						priority: "P0",
						status: "ready",
						commentBody: "Release blocker should be handled first.",
						reason: "Matches the event criteria.",
					},
					{
						id: "proposal-item-2",
						eventId: stale.id,
						status: "discarded",
						commentBody: "Discarding because this idea no longer matches the criteria.",
						reason: "Low-value stale idea.",
					},
				],
			});
		});

		const proposal = await createDesktopEventManagementProposal({
			criteriaFilePath,
			eventStore: store,
			generateText,
		});

		expect(proposal.criteriaPath).toBe(criteriaFilePath);
		expect(proposal.items).toEqual([
			expect.objectContaining({
				eventId: active.id,
				priority: "P0",
				status: "ready",
				reason: "Matches the event criteria.",
			}),
			expect.objectContaining({
				eventId: stale.id,
				status: "discarded",
				reason: "Low-value stale idea.",
			}),
		]);
		expect(generateText).toHaveBeenCalledTimes(1);
	});

	it("ignores proposal items that reference events outside the management context", async () => {
		const { criteriaFilePath, store } = await createStoreFixture();
		const active = await store.createEvent({ body: "Known event" });

		const proposal = await createDesktopEventManagementProposal({
			criteriaFilePath,
			eventStore: store,
			generateText: async () =>
				JSON.stringify({
					items: [
						{
							id: "unknown",
							eventId: "missing",
							priority: "P1",
							status: "ready",
							commentBody: "Unknown event.",
							reason: "Invalid.",
						},
						{
							id: "known",
							eventId: active.id,
							priority: "P1",
							status: "ready",
							commentBody: "Valid event.",
							reason: "Still actionable.",
						},
					],
				}),
		});

		expect(proposal.items).toEqual([
			expect.objectContaining({
				id: "known",
				eventId: active.id,
				priority: "P1",
				status: "ready",
			}),
		]);
	});

	it("treats running events as comment-only management context", async () => {
		const { criteriaFilePath, store } = await createStoreFixture();
		const running = await store.createEvent({ body: "Already in progress", priority: "P1" });
		await store.beginEventRun({
			eventId: running.id,
			projectId: "project-1",
			promptText: "Run it",
			attachmentIds: [],
		});

		const commentOnly = await createDesktopEventManagementProposal({
			criteriaFilePath,
			eventStore: store,
			generateText: async ({ prompt }) => {
				expect(prompt).toContain('"managementMode": "observe_only"');
				return JSON.stringify({
					items: [
						{
							id: "running-comment",
							eventId: running.id,
							commentBody: "Keep this in progress; revisit after the active run finishes.",
							reason: "Already in progress.",
						},
					],
				});
			},
		});

		expect(commentOnly.items).toEqual([
			expect.objectContaining({
				eventId: running.id,
				commentBody: "Keep this in progress; revisit after the active run finishes.",
			}),
		]);

		await expect(
			createDesktopEventManagementProposal({
				criteriaFilePath,
				eventStore: store,
				generateText: async () =>
					JSON.stringify({
						items: [
							{
								id: "running-discard",
								eventId: running.id,
								status: "discarded",
								commentBody: "Discard it.",
								reason: "Invalid while running.",
							},
						],
					}),
			}),
		).rejects.toThrow(/comment-only/i);

		await expect(
			createDesktopEventManagementProposal({
				criteriaFilePath,
				eventStore: store,
				generateText: async () =>
					JSON.stringify({
						items: [
							{
								id: "running-priority",
								eventId: running.id,
								priority: "P3",
								commentBody: "Downgrade it.",
								reason: "Invalid while running.",
							},
						],
					}),
			}),
		).rejects.toThrow(/comment-only/i);
	});

	it("rejects proposals for running status updates", async () => {
		const { criteriaFilePath, store } = await createStoreFixture();
		await store.createEvent({ body: "Known event" });

		await expect(
			createDesktopEventManagementProposal({
				criteriaFilePath,
				eventStore: store,
				generateText: async () =>
					JSON.stringify({
						items: [
							{
								id: "running",
								eventId: (await store.listEvents())[0]?.id,
								priority: "P1",
								status: "running",
								commentBody: "Cannot set running.",
								reason: "Invalid.",
							},
						],
					}),
			}),
		).rejects.toThrow(/running/i);
	});
});
