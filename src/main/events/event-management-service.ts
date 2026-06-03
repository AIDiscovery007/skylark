import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
	DesktopEventDetail,
	DesktopEventManagementCriteria,
	DesktopEventManagementProposal,
	DesktopEventManagementProposalItem,
	DesktopEventManagementProposalRequest,
	DesktopEventPriority,
	DesktopEventStatus,
} from "../../shared/types.ts";
import { DESKTOP_EVENT_PRIORITIES } from "../../shared/types.ts";
import type { DesktopEventStore } from "./event-store.ts";

const DEFAULT_EVENT_MANAGEMENT_CRITERIA = `# Event Management Criteria

Use this file to tell Skylark how to manage events.

- Treat urgent blockers as P0.
- Treat important near-term work as P1.
- Treat useful but non-urgent work as P2.
- Treat low-value or someday work as P3.
- Suggest discarding inbox or ready events that no longer match these criteria, are stale, low-value, or not worth pursuing.
- Add concise comments that explain the priority or status recommendation.
`;
const LEGACY_EVENT_MANAGEMENT_CRITERIA_FILE_NAMES = ["events.md", "AGENTS.md"] as const;

const EVENT_MANAGEMENT_SYSTEM_PROMPT = [
	"You are Skylark's restricted event management agent.",
	"Use only the event data and criteria provided in the prompt.",
	"Return only valid JSON with an items array.",
	"Each item must include id, eventId, reason, commentBody, and may include priority or status.",
	"Only use eventId values that appear in the provided events_json. Omit any event you are unsure about.",
	"Allowed priority values are P0, P1, P2, P3.",
	"Allowed status values are inbox, ready, completed, discarded. Never set status to running.",
	"You may suggest discarded for inbox or ready events that no longer match the user's criteria, are stale, low-value, or not worth pursuing.",
	"For discarded recommendations, explain why the event is not worth keeping in both reason and commentBody.",
	"For events with managementMode observe_only, omit priority and status. Only add a comment recommendation.",
].join("\n");

const MAX_EVENT_MANAGEMENT_BODY_CHARS = 4_000;
const MAX_EVENT_MANAGEMENT_COMMENTS = 8;

const ALLOWED_PRIORITIES = new Set<DesktopEventPriority>(DESKTOP_EVENT_PRIORITIES);
const ALLOWED_MANAGEMENT_STATUSES = new Set<Exclude<DesktopEventStatus, "running">>([
	"inbox",
	"ready",
	"completed",
	"discarded",
]);

export interface DesktopEventManagementGenerateInput {
	systemPrompt: string;
	prompt: string;
}

export type DesktopEventManagementGenerateText = (input: DesktopEventManagementGenerateInput) => Promise<string>;

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

async function canonicalizeCriteriaPath(criteriaFilePath: string): Promise<void> {
	const criteriaDir = dirname(criteriaFilePath);
	const criteriaFileName = basename(criteriaFilePath);
	const matchingEntry = (await readdir(criteriaDir)).find(
		(entry) => entry.toLowerCase() === criteriaFileName.toLowerCase(),
	);
	if (!matchingEntry || matchingEntry === criteriaFileName) {
		return;
	}
	const currentPath = join(criteriaDir, matchingEntry);
	const temporaryPath = join(criteriaDir, `${criteriaFileName}.${randomUUID()}.tmp`);
	await rename(currentPath, temporaryPath);
	await rename(temporaryPath, criteriaFilePath);
}

async function deleteLegacyCriteriaFiles(criteriaDir: string): Promise<void> {
	const entries = await readdir(criteriaDir);
	for (const entry of entries) {
		if ((LEGACY_EVENT_MANAGEMENT_CRITERIA_FILE_NAMES as readonly string[]).includes(entry)) {
			await unlink(join(criteriaDir, entry));
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRequiredString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`Event management proposal ${label} must be a string.`);
	}
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`Event management proposal ${label} must not be empty.`);
	}
	return normalized;
}

function normalizeOptionalPriority(value: unknown): DesktopEventPriority | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string" || !ALLOWED_PRIORITIES.has(value as DesktopEventPriority)) {
		throw new Error("Event management proposal priority must be P0, P1, P2, or P3.");
	}
	return value as DesktopEventPriority;
}

function normalizeOptionalStatus(value: unknown): Exclude<DesktopEventStatus, "running"> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "running") {
		throw new Error("Event management proposal cannot set status to running.");
	}
	if (typeof value !== "string" || !ALLOWED_MANAGEMENT_STATUSES.has(value as Exclude<DesktopEventStatus, "running">)) {
		throw new Error("Event management proposal status must be inbox, ready, completed, or discarded.");
	}
	return value as Exclude<DesktopEventStatus, "running">;
}

function getEventManagementBody(body: string): string {
	const normalized = body.trim();
	return normalized.length <= MAX_EVENT_MANAGEMENT_BODY_CHARS
		? normalized
		: normalized.slice(0, MAX_EVENT_MANAGEMENT_BODY_CHARS);
}

function isObserveOnlyManagementEvent(event: DesktopEventDetail): boolean {
	return event.status === "running" || event.activeRunStatus === "running";
}

function toManagementEventContext(event: DesktopEventDetail): Record<string, unknown> {
	return {
		id: event.id,
		title: event.title,
		status: event.status,
		priority: event.priority ?? null,
		managementMode: isObserveOnlyManagementEvent(event) ? "observe_only" : "manage",
		body: getEventManagementBody(event.body),
		attachmentCount: event.attachments.length,
		activeRunStatus: event.activeRunStatus ?? null,
		latestRunStatus: event.latestRunStatus ?? null,
		comments: event.comments.slice(-MAX_EVENT_MANAGEMENT_COMMENTS).map((comment) => ({
			author: comment.author,
			body: comment.body,
			createdAt: comment.createdAt,
		})),
		createdAt: event.createdAt,
		updatedAt: event.updatedAt,
	};
}

function buildEventManagementPrompt(input: { criteria: string; events: readonly DesktopEventDetail[] }): string {
	return [
		"<event_management_criteria>",
		input.criteria.trim(),
		"</event_management_criteria>",
		"",
		"Return JSON only in this shape:",
		'{"items":[{"id":"string","eventId":"string","priority":"P0|P1|P2|P3","status":"inbox|ready|completed|discarded","reason":"string","commentBody":"string"}]}',
		"",
		"<events_json>",
		JSON.stringify(input.events.map(toManagementEventContext), null, 2),
		"</events_json>",
	].join("\n");
}

function parseProposalJson(rawText: string): unknown {
	const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(rawText);
	const candidate = fencedMatch?.[1] ?? rawText;
	const startIndex = candidate.indexOf("{");
	const endIndex = candidate.lastIndexOf("}");
	if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
		throw new Error("Event management proposal did not include a JSON object.");
	}
	return JSON.parse(candidate.slice(startIndex, endIndex + 1));
}

function normalizeProposalItems(input: {
	activeEventsById: Map<string, DesktopEventDetail>;
	rawProposal: unknown;
}): DesktopEventManagementProposalItem[] {
	if (!isRecord(input.rawProposal) || !Array.isArray(input.rawProposal.items)) {
		throw new Error("Event management proposal must include an items array.");
	}

	const seenItemIds = new Set<string>();
	const items: DesktopEventManagementProposalItem[] = [];
	for (const [index, rawItem] of input.rawProposal.items.entries()) {
		if (!isRecord(rawItem)) {
			throw new Error(`Event management proposal item ${index + 1} must be an object.`);
		}
		const id = normalizeRequiredString(rawItem.id, `item ${index + 1} id`);
		const eventId = normalizeRequiredString(rawItem.eventId, `item ${index + 1} eventId`);
		const event = input.activeEventsById.get(eventId);
		if (!event) {
			continue;
		}
		if (seenItemIds.has(id)) {
			throw new Error(`Event management proposal duplicate item id '${id}'.`);
		}
		seenItemIds.add(id);
		const priority = normalizeOptionalPriority(rawItem.priority);
		const status = normalizeOptionalStatus(rawItem.status);
		if (isObserveOnlyManagementEvent(event) && (priority !== undefined || status !== undefined)) {
			throw new Error(`Event management proposal for running event '${eventId}' must be comment-only.`);
		}
		if (status && status !== event.status && event.activeRunStatus === "running") {
			throw new Error(`Event management proposal cannot change status for running event '${eventId}'.`);
		}
		items.push({
			id,
			eventId,
			...(priority ? { priority } : {}),
			...(status ? { status } : {}),
			reason: normalizeRequiredString(rawItem.reason, `item ${index + 1} reason`),
			commentBody: normalizeRequiredString(rawItem.commentBody, `item ${index + 1} commentBody`),
		});
	}
	return items;
}

export async function readDesktopEventManagementCriteria(
	criteriaFilePath: string,
): Promise<DesktopEventManagementCriteria> {
	const criteriaDir = dirname(criteriaFilePath);
	await mkdir(criteriaDir, { recursive: true });
	await deleteLegacyCriteriaFiles(criteriaDir);
	try {
		await canonicalizeCriteriaPath(criteriaFilePath);
		return {
			path: criteriaFilePath,
			content: await readFile(criteriaFilePath, "utf8"),
		};
	} catch (error) {
		if (!isMissingFileError(error)) {
			throw error;
		}
		await writeFile(criteriaFilePath, DEFAULT_EVENT_MANAGEMENT_CRITERIA, "utf8");
		return {
			path: criteriaFilePath,
			content: DEFAULT_EVENT_MANAGEMENT_CRITERIA,
		};
	}
}

export async function writeDesktopEventManagementCriteria(
	criteriaFilePath: string,
	content: string,
): Promise<DesktopEventManagementCriteria> {
	const criteriaDir = dirname(criteriaFilePath);
	await mkdir(criteriaDir, { recursive: true });
	await deleteLegacyCriteriaFiles(criteriaDir);
	await writeFile(criteriaFilePath, content, "utf8");
	return {
		path: criteriaFilePath,
		content,
	};
}

export async function createDesktopEventManagementProposal(input: {
	criteriaFilePath: string;
	eventStore: DesktopEventStore;
	generateText: DesktopEventManagementGenerateText;
	request?: DesktopEventManagementProposalRequest;
}): Promise<DesktopEventManagementProposal> {
	const criteria = await readDesktopEventManagementCriteria(input.criteriaFilePath);
	const summaries = await input.eventStore.listEvents({ includeDiscarded: false });
	const managedSummaries = summaries.filter((summary) => {
		if (summary.status === "discarded") {
			return false;
		}
		if (summary.status === "completed" && input.request?.includeCompleted !== true) {
			return false;
		}
		return true;
	});
	const managedEvents = (
		await Promise.all(managedSummaries.map((summary) => input.eventStore.getEvent(summary.id)))
	).filter((event): event is DesktopEventDetail => event !== null);
	const prompt = buildEventManagementPrompt({
		criteria: criteria.content,
		events: managedEvents,
	});
	const rawProposalText = await input.generateText({
		systemPrompt: EVENT_MANAGEMENT_SYSTEM_PROMPT,
		prompt,
	});
	const activeEventsById = new Map(managedEvents.map((event) => [event.id, event]));
	return {
		id: randomUUID(),
		items: normalizeProposalItems({
			activeEventsById,
			rawProposal: parseProposalJson(rawProposalText),
		}),
		createdAt: new Date().toISOString(),
		criteriaPath: criteria.path,
	};
}
