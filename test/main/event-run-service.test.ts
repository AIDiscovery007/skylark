import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runDesktopEvent } from "../../src/main/events/event-run-service.ts";
import { DesktopEventStore } from "../../src/main/events/event-store.ts";
import type { DesktopRuntimeHost } from "../../src/main/runtime/desktop-runtime-host.ts";
import type { DesktopEventAttachment, DesktopSessionSummary } from "../../src/shared/types.ts";

async function createStore(): Promise<DesktopEventStore> {
	const rootDir = await mkdtemp(join(tmpdir(), "desktop-event-run-"));
	return new DesktopEventStore(
		join(rootDir, "events", "index.json"),
		join(rootDir, "events", "data"),
		join(rootDir, "events", "attachments"),
	);
}

function createSession(id: string, projectId: string): DesktopSessionSummary {
	return {
		id,
		title: "New Session",
		cwd: `/workspace/${projectId}`,
		createdAt: "2026-05-22T00:00:00.000Z",
		updatedAt: "2026-05-22T00:00:00.000Z",
		messageCount: 0,
		agentMode: "execute",
		provider: "kimi-coding",
		modelId: "kimi-for-coding",
	};
}

function createAttachment(): DesktopEventAttachment {
	return {
		id: "attachment-1",
		name: "idea.md",
		originalPath: "/tmp/idea.md",
		storedPath: "/app/events/idea.md",
		mimeType: "text/markdown",
		size: 12,
		textSnapshot: "ship the event board",
		createdAt: "2026-05-22T00:00:00.000Z",
	};
}

describe("runDesktopEvent", () => {
	it("creates an independent session and starts the event prompt", async () => {
		const store = await createStore();
		const event = await store.createEvent({ body: "Run this event.", attachments: [createAttachment()] });
		const host: Pick<DesktopRuntimeHost, "newSession" | "prompt"> = {
			newSession: vi.fn(async (projectId?: string) => createSession("session-1", projectId ?? "project-1")),
			prompt: vi.fn(async () => undefined),
		};

		const result = await runDesktopEvent({
			eventStore: store,
			host,
			request: {
				eventId: event.id,
				projectId: "project-1",
				promptText: "Do it",
				attachmentIds: ["attachment-1"],
			},
		});

		expect(result.session.id).toBe("session-1");
		expect(result.event.status).toBe("running");
		expect(result.event.activeSessionId).toBe("session-1");
		expect(host.newSession).toHaveBeenCalledWith("project-1");
		expect(host.prompt).toHaveBeenCalledWith("session-1", {
			text: "Do it",
			attachments: [
				expect.objectContaining({
					id: "attachment-1",
					kind: "text",
					promptText: "ship the event board",
				}),
			],
		});
	});

	it("allows different events to run in parallel but rejects a second active run on the same event", async () => {
		const store = await createStore();
		const firstEvent = await store.createEvent({ body: "First event" });
		const secondEvent = await store.createEvent({ body: "Second event" });
		let sessionIndex = 0;
		const host: Pick<DesktopRuntimeHost, "newSession" | "prompt"> = {
			newSession: vi.fn(async (projectId?: string) => {
				sessionIndex += 1;
				return createSession(`session-${sessionIndex}`, projectId ?? "project-1");
			}),
			prompt: vi.fn(async () => undefined),
		};

		await runDesktopEvent({
			eventStore: store,
			host,
			request: { eventId: firstEvent.id, projectId: "project-1", promptText: "First", attachmentIds: [] },
		});
		await runDesktopEvent({
			eventStore: store,
			host,
			request: { eventId: secondEvent.id, projectId: "project-1", promptText: "Second", attachmentIds: [] },
		});

		await expect(
			runDesktopEvent({
				eventStore: store,
				host,
				request: { eventId: firstEvent.id, projectId: "project-1", promptText: "Again", attachmentIds: [] },
			}),
		).rejects.toThrow(/already running/);
		expect(host.prompt).toHaveBeenCalledTimes(2);
	});

	it("keeps the event in running status after agent_end marks the run awaiting review", async () => {
		const store = await createStore();
		const event = await store.createEvent({ body: "Review after run" });
		const host: Pick<DesktopRuntimeHost, "newSession" | "prompt"> = {
			newSession: vi.fn(async () => createSession("session-1", "project-1")),
			prompt: vi.fn(async () => undefined),
		};

		await runDesktopEvent({
			eventStore: store,
			host,
			request: { eventId: event.id, projectId: "project-1", promptText: "Run", attachmentIds: [] },
		});
		const updated = await store.markRunAwaitingReviewForSession("session-1");

		expect(updated?.status).toBe("running");
		expect(updated?.latestRunStatus).toBe("awaiting_review");
		expect(updated?.activeRunStatus).toBeUndefined();
	});

	it("marks a run failed when prompt startup fails", async () => {
		const store = await createStore();
		const event = await store.createEvent({ body: "Failure event" });
		const host: Pick<DesktopRuntimeHost, "newSession" | "prompt"> = {
			newSession: vi.fn(async () => createSession("session-1", "project-1")),
			prompt: vi.fn(async () => {
				throw new Error("startup failed");
			}),
		};

		await expect(
			runDesktopEvent({
				eventStore: store,
				host,
				request: { eventId: event.id, projectId: "project-1", promptText: "Run", attachmentIds: [] },
			}),
		).rejects.toThrow("startup failed");

		const updated = await store.getEvent(event.id);
		expect(updated?.latestRunStatus).toBe("failed");
		expect(updated?.runs[0]?.errorMessage).toBe("startup failed");
	});
});
