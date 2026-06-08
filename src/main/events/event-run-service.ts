import { getErrorMessage } from "../../shared/errors.ts";
import type {
	DesktopEventDetail,
	DesktopEventRunRequest,
	DesktopEventRunResult,
	DesktopPreparedPromptAttachment,
	DesktopSessionSummary,
} from "../../shared/types.ts";
import type { DesktopRuntimeHost } from "../runtime/desktop-runtime-host.ts";
import type { DesktopEventStore } from "./event-store.ts";

function buildEventPromptAttachments(
	event: DesktopEventDetail,
	attachmentIds: readonly string[],
): DesktopPreparedPromptAttachment[] {
	if (attachmentIds.length === 0) {
		return [];
	}
	const attachmentsById = new Map(event.attachments.map((attachment) => [attachment.id, attachment]));
	return attachmentIds.map((attachmentId) => {
		const attachment = attachmentsById.get(attachmentId);
		if (!attachment) {
			throw new Error(`Event attachment '${attachmentId}' does not exist.`);
		}
		if (!attachment.textSnapshot || attachment.extractionError) {
			throw new Error(`Event attachment '${attachment.name}' has no usable text snapshot.`);
		}
		return {
			id: attachment.id,
			kind: "text",
			name: attachment.name,
			path: attachment.originalPath,
			mimeType: attachment.mimeType,
			size: attachment.size,
			promptText: attachment.textSnapshot,
			images: [],
		};
	});
}

export async function runDesktopEvent(input: {
	eventStore: DesktopEventStore;
	host: Pick<DesktopRuntimeHost, "newSession" | "prompt">;
	request: DesktopEventRunRequest;
}): Promise<DesktopEventRunResult> {
	const event = await input.eventStore.getEvent(input.request.eventId);
	if (!event) {
		throw new Error(`Event '${input.request.eventId}' does not exist.`);
	}
	const attachments = buildEventPromptAttachments(event, input.request.attachmentIds ?? []);
	const { run } = await input.eventStore.beginEventRun(input.request);
	let session: DesktopSessionSummary | undefined;

	try {
		session = await input.host.newSession(input.request.projectId);
		if (!session) {
			throw new Error(`Project '${input.request.projectId}' does not exist.`);
		}
		const eventWithSession = await input.eventStore.updateRunSession(event.id, run.id, session.id);
		await input.host.prompt(session.id, {
			text: input.request.promptText,
			...(attachments.length > 0 ? { attachments } : {}),
		});
		return {
			event: (await input.eventStore.getEvent(event.id)) ?? eventWithSession,
			session,
		};
	} catch (error) {
		await input.eventStore.markRunFailed(event.id, run.id, getErrorMessage(error));
		throw error;
	}
}
