import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type {
	DesktopEventAttachment,
	DesktopEventComment,
	DesktopEventCommentAuthor,
	DesktopEventDetail,
	DesktopEventManagementApplyRequest,
	DesktopEventManagementProposalItem,
	DesktopEventPriority,
	DesktopEventRun,
	DesktopEventRunRequest,
	DesktopEventStatus,
	DesktopEventSummary,
} from "../../shared/types.ts";
import { JsonFileStore } from "../storage/json-file-store.ts";

type EventIndex = Record<string, DesktopEventSummary>;

export interface CreateDesktopEventInput {
	id?: string;
	title?: string;
	body?: string;
	priority?: DesktopEventPriority;
	attachments?: DesktopEventAttachment[];
}

export interface UpdateDesktopEventInput {
	title?: string;
	body?: string;
	priority?: DesktopEventPriority | null;
}

export interface AddDesktopEventCommentInput {
	author: DesktopEventCommentAuthor;
	body: string;
	source?: DesktopEventComment["source"];
	proposalId?: string;
}

function getEventFilePath(eventsDir: string, eventId: string): string {
	return join(eventsDir, `${eventId}.json`);
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function getBodyPreview(body: string): string {
	return normalizeWhitespace(body).slice(0, 160);
}

function getEventTitle(input: {
	title?: string;
	body?: string;
	attachments?: readonly DesktopEventAttachment[];
	currentTitle?: string;
}): string {
	const explicitTitle = input.title?.trim();
	if (explicitTitle) {
		return explicitTitle.slice(0, 160);
	}
	const currentTitle = input.currentTitle?.trim();
	if (currentTitle) {
		return currentTitle;
	}
	const firstBodyLine = input.body
		?.split(/\r?\n/)
		.map((line) => normalizeWhitespace(line))
		.find(Boolean);
	if (firstBodyLine) {
		return firstBodyLine.slice(0, 80);
	}
	const firstAttachmentName = input.attachments?.[0]?.name.trim();
	return firstAttachmentName ? firstAttachmentName.slice(0, 80) : "Untitled event";
}

function getLatestRun(runs: readonly DesktopEventRun[]): DesktopEventRun | undefined {
	return runs.at(-1);
}

function getActiveRun(runs: readonly DesktopEventRun[]): DesktopEventRun | undefined {
	return runs.find((run) => run.status === "running");
}

function isObserveOnlyManagementEvent(event: DesktopEventDetail): boolean {
	return event.status === "running" || Boolean(getActiveRun(event.runs));
}

function getLatestComment(comments: readonly DesktopEventComment[]): DesktopEventComment | undefined {
	return comments.at(-1);
}

function normalizeEventDetail(event: DesktopEventDetail): DesktopEventDetail {
	const attachments = event.attachments ?? [];
	const runs = event.runs ?? [];
	const comments = event.comments ?? [];
	const activeRun = getActiveRun(runs);
	const latestRun = getLatestRun(runs);
	const latestComment = getLatestComment(comments);
	return {
		...event,
		attachments,
		runs,
		comments,
		commentCount: comments.length,
		latestCommentAt: latestComment?.createdAt,
		activeRunStatus: activeRun ? "running" : undefined,
		activeSessionId: activeRun?.sessionId,
		latestRunStatus: latestRun?.status,
		latestRunAt: latestRun?.updatedAt,
		latestSessionId: latestRun?.sessionId,
	};
}

function toSummary(event: DesktopEventDetail): DesktopEventSummary {
	const activeRun = getActiveRun(event.runs);
	const latestRun = getLatestRun(event.runs);
	const latestComment = getLatestComment(event.comments);
	return {
		id: event.id,
		title: event.title,
		bodyPreview: getBodyPreview(event.body),
		status: event.status,
		...(event.priority ? { priority: event.priority } : {}),
		attachmentCount: event.attachments.length,
		commentCount: event.comments.length,
		createdAt: event.createdAt,
		updatedAt: event.updatedAt,
		statusChangedAt: event.statusChangedAt,
		...(event.completedAt ? { completedAt: event.completedAt } : {}),
		...(event.discardedAt ? { discardedAt: event.discardedAt } : {}),
		...(latestComment ? { latestCommentAt: latestComment.createdAt } : {}),
		...(activeRun ? { activeRunStatus: "running" as const, activeSessionId: activeRun.sessionId } : {}),
		...(latestRun ? { latestRunStatus: latestRun.status, latestRunAt: latestRun.updatedAt } : {}),
		...(latestRun?.sessionId ? { latestSessionId: latestRun.sessionId } : {}),
	};
}

function normalizeEventSummary(event: DesktopEventSummary): DesktopEventSummary {
	return {
		...event,
		commentCount: event.commentCount ?? 0,
	};
}

function getPriorityRank(priority: DesktopEventPriority | undefined): number {
	switch (priority) {
		case "P0":
			return 0;
		case "P1":
			return 1;
		case "P2":
			return 2;
		case "P3":
			return 3;
		default:
			return 4;
	}
}

function sortEventSummaries(summaries: DesktopEventSummary[]): DesktopEventSummary[] {
	return [...summaries].sort((left, right) => {
		const priorityDelta = getPriorityRank(left.priority) - getPriorityRank(right.priority);
		if (priorityDelta !== 0) {
			return priorityDelta;
		}
		const updatedDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
		if (updatedDelta !== 0) {
			return updatedDelta;
		}
		return right.id.localeCompare(left.id);
	});
}

function applyStatusTimestamps(
	event: DesktopEventDetail,
	status: DesktopEventStatus,
	timestamp: string,
): DesktopEventDetail {
	return {
		...event,
		status,
		statusChangedAt: timestamp,
		updatedAt: timestamp,
		completedAt: status === "completed" ? timestamp : undefined,
		discardedAt: status === "discarded" ? timestamp : undefined,
	};
}

export class DesktopEventStore {
	private readonly indexStore: JsonFileStore<EventIndex>;
	private mutationQueue = Promise.resolve();

	constructor(
		indexFilePath: string,
		private readonly eventsDir: string,
		readonly attachmentsRootDir: string,
	) {
		this.indexStore = new JsonFileStore(indexFilePath, {});
	}

	private createDetailStore(eventId: string): JsonFileStore<DesktopEventDetail | null> {
		return new JsonFileStore<DesktopEventDetail | null>(getEventFilePath(this.eventsDir, eventId), null);
	}

	private async saveDetail(event: DesktopEventDetail): Promise<DesktopEventDetail> {
		const normalizedDetail = normalizeEventDetail(event);
		const summary = toSummary(normalizedDetail);
		const normalizedEvent: DesktopEventDetail = {
			...normalizedDetail,
			...summary,
			completedAt: summary.completedAt,
			discardedAt: summary.discardedAt,
			latestCommentAt: summary.latestCommentAt,
			activeRunStatus: summary.activeRunStatus,
			activeSessionId: summary.activeSessionId,
			latestRunStatus: summary.latestRunStatus,
			latestRunAt: summary.latestRunAt,
			latestSessionId: summary.latestSessionId,
		};
		await this.createDetailStore(event.id).write(normalizedEvent);
		await this.indexStore.update((current) => ({
			...current,
			[summary.id]: summary,
		}));
		return normalizedEvent;
	}

	private runMutation<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.mutationQueue.catch(() => undefined).then(operation);
		this.mutationQueue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	async listEvents(options: { includeDiscarded?: boolean } = {}): Promise<DesktopEventSummary[]> {
		const index = await this.indexStore.read();
		const events = Object.values(index)
			.map(normalizeEventSummary)
			.filter((event) => options.includeDiscarded === true || event.status !== "discarded");
		return sortEventSummaries(events);
	}

	async getEvent(eventId: string): Promise<DesktopEventDetail | null> {
		const event = await this.createDetailStore(eventId).read();
		return event ? normalizeEventDetail(event) : event;
	}

	async createEvent(input: CreateDesktopEventInput): Promise<DesktopEventDetail> {
		return this.runMutation(async () => {
			const timestamp = new Date().toISOString();
			const attachments = input.attachments ?? [];
			const body = input.body?.trim() ?? "";
			const event: DesktopEventDetail = {
				id: input.id ?? randomUUID(),
				title: getEventTitle({ title: input.title, body, attachments }),
				bodyPreview: getBodyPreview(body),
				status: "inbox",
				...(input.priority ? { priority: input.priority } : {}),
				attachmentCount: attachments.length,
				commentCount: 0,
				createdAt: timestamp,
				updatedAt: timestamp,
				statusChangedAt: timestamp,
				body,
				attachments,
				runs: [],
				comments: [],
			};
			return this.saveDetail(event);
		});
	}

	async updateEvent(eventId: string, input: UpdateDesktopEventInput): Promise<DesktopEventDetail> {
		return this.runMutation(async () => {
			const event = await this.getEvent(eventId);
			if (!event) {
				throw new Error(`Event '${eventId}' does not exist.`);
			}
			const timestamp = new Date().toISOString();
			return this.saveDetail({
				...event,
				title: getEventTitle({
					title: input.title,
					body: input.body ?? event.body,
					attachments: event.attachments,
					currentTitle: input.title === undefined ? event.title : undefined,
				}),
				body: input.body ?? event.body,
				...(input.priority === undefined
					? {}
					: input.priority === null
						? { priority: undefined }
						: { priority: input.priority }),
				updatedAt: timestamp,
			});
		});
	}

	async addEventComment(eventId: string, input: AddDesktopEventCommentInput): Promise<DesktopEventDetail> {
		return this.runMutation(async () => {
			const event = await this.getEvent(eventId);
			if (!event) {
				throw new Error(`Event '${eventId}' does not exist.`);
			}
			const timestamp = new Date().toISOString();
			const body = input.body.trim();
			if (!body) {
				throw new Error("Event comment must not be empty.");
			}
			const comment: DesktopEventComment = {
				id: randomUUID(),
				author: input.author,
				body,
				createdAt: timestamp,
				...(input.source ? { source: input.source } : {}),
				...(input.proposalId ? { proposalId: input.proposalId } : {}),
			};
			return this.saveDetail({
				...event,
				comments: [...event.comments, comment],
				updatedAt: timestamp,
			});
		});
	}

	async applyEventManagementProposal(input: DesktopEventManagementApplyRequest): Promise<DesktopEventDetail[]> {
		return this.runMutation(async () => {
			const selectedItemIds = new Set(input.selectedItemIds);
			const selectedItems = input.items.filter((item) => selectedItemIds.has(item.id));
			const selectedEventIds = new Set<string>();
			const updatedEvents: DesktopEventDetail[] = [];

			for (const item of selectedItems) {
				if (selectedEventIds.has(item.eventId)) {
					throw new Error(`Event '${item.eventId}' has multiple selected management updates.`);
				}
				selectedEventIds.add(item.eventId);
				updatedEvents.push(await this.applyEventManagementProposalItem(input.proposalId, item));
			}

			return updatedEvents;
		});
	}

	private async applyEventManagementProposalItem(
		proposalId: string,
		item: DesktopEventManagementProposalItem,
	): Promise<DesktopEventDetail> {
		const event = await this.getEvent(item.eventId);
		if (!event) {
			throw new Error(`Event '${item.eventId}' does not exist.`);
		}
		if (isObserveOnlyManagementEvent(event) && (item.priority !== undefined || item.status !== undefined)) {
			throw new Error(`Event '${item.eventId}' is running and only accepts comment-only management updates.`);
		}
		if (item.status && item.status !== event.status && getActiveRun(event.runs)) {
			throw new Error(`Event '${item.eventId}' has an active run and cannot change status.`);
		}

		const timestamp = new Date().toISOString();
		const commentBody = item.commentBody.trim();
		const nextComments =
			commentBody.length > 0
				? [
						...event.comments,
						{
							id: randomUUID(),
							author: "agent" as const,
							body: commentBody,
							createdAt: timestamp,
							source: "management_proposal" as const,
							proposalId,
						},
					]
				: event.comments;
		const nextEvent = {
			...event,
			...(item.priority ? { priority: item.priority } : {}),
			comments: nextComments,
			updatedAt: timestamp,
		};
		const eventWithStatus =
			item.status && item.status !== event.status
				? applyStatusTimestamps(nextEvent, item.status, timestamp)
				: nextEvent;
		return this.saveDetail(eventWithStatus);
	}

	async setEventStatus(eventId: string, status: DesktopEventStatus): Promise<DesktopEventDetail> {
		return this.runMutation(async () => {
			const event = await this.getEvent(eventId);
			if (!event) {
				throw new Error(`Event '${eventId}' does not exist.`);
			}
			if (event.status === status) {
				return event;
			}
			return this.saveDetail(applyStatusTimestamps(event, status, new Date().toISOString()));
		});
	}

	async deleteEvent(eventId: string): Promise<void> {
		await this.runMutation(async () => {
			await this.indexStore.update((current) => {
				if (!Object.hasOwn(current, eventId)) {
					return current;
				}
				const next = { ...current };
				delete next[eventId];
				return next;
			});
			await rm(getEventFilePath(this.eventsDir, eventId), { force: true });
			await rm(join(this.attachmentsRootDir, eventId), { force: true, recursive: true });
		});
	}

	async beginEventRun(request: DesktopEventRunRequest): Promise<{ event: DesktopEventDetail; run: DesktopEventRun }> {
		return this.runMutation(async () => {
			const event = await this.getEvent(request.eventId);
			if (!event) {
				throw new Error(`Event '${request.eventId}' does not exist.`);
			}
			if (getActiveRun(event.runs)) {
				throw new Error(`Event '${request.eventId}' is already running.`);
			}
			const timestamp = new Date().toISOString();
			const run: DesktopEventRun = {
				id: randomUUID(),
				projectId: request.projectId,
				promptText: request.promptText,
				attachmentIds: request.attachmentIds ?? [],
				status: "running",
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			const nextEvent = applyStatusTimestamps(
				{
					...event,
					runs: [...event.runs, run],
				},
				"running",
				timestamp,
			);
			return { event: await this.saveDetail(nextEvent), run };
		});
	}

	async updateRunSession(eventId: string, runId: string, sessionId: string): Promise<DesktopEventDetail> {
		return this.runMutation(async () => {
			const event = await this.getEvent(eventId);
			if (!event) {
				throw new Error(`Event '${eventId}' does not exist.`);
			}
			const timestamp = new Date().toISOString();
			const runs = event.runs.map((run) =>
				run.id === runId
					? {
							...run,
							sessionId,
							updatedAt: timestamp,
						}
					: run,
			);
			return this.saveDetail({ ...event, runs, updatedAt: timestamp });
		});
	}

	async markRunFailed(eventId: string, runId: string, errorMessage: string): Promise<DesktopEventDetail> {
		return this.runMutation(async () => {
			const event = await this.getEvent(eventId);
			if (!event) {
				throw new Error(`Event '${eventId}' does not exist.`);
			}
			const timestamp = new Date().toISOString();
			const runs = event.runs.map((run) =>
				run.id === runId
					? {
							...run,
							status: "failed" as const,
							updatedAt: timestamp,
							completedAt: timestamp,
							errorMessage,
						}
					: run,
			);
			return this.saveDetail({ ...event, runs, updatedAt: timestamp });
		});
	}

	async markRunAwaitingReviewForSession(sessionId: string): Promise<DesktopEventDetail | undefined> {
		return this.runMutation(async () => {
			const index = await this.indexStore.read();
			const summary = Object.values(index).find((event) => event.activeSessionId === sessionId);
			if (!summary) {
				return undefined;
			}
			const event = await this.getEvent(summary.id);
			if (!event) {
				return undefined;
			}
			const activeRun = getActiveRun(event.runs);
			if (!activeRun || activeRun.sessionId !== sessionId) {
				return undefined;
			}
			const timestamp = new Date().toISOString();
			const runs = event.runs.map((run) =>
				run.id === activeRun.id
					? {
							...run,
							status: "awaiting_review" as const,
							updatedAt: timestamp,
							completedAt: timestamp,
						}
					: run,
			);
			return this.saveDetail({
				...event,
				status: "running",
				runs,
				updatedAt: timestamp,
			});
		});
	}
}
