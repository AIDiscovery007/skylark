import type { FileUIPart } from "ai";
import type {
	DesktopCapabilityCatalog,
	DesktopPreparedPromptAttachment,
	DesktopPromptAttachmentDisplay,
	DesktopPromptCapabilityInvocation,
	DesktopSlashCommandSummary,
} from "../../shared/types.ts";
import type {
	DesktopCompactionNoticeMetadata,
	DesktopProposedPlanMetadata,
	DesktopThreadContentPart,
	DesktopThreadFileReference,
	DesktopThreadMessage,
} from "./assistant-runtime-adapter.ts";
import {
	DESKTOP_CAPABILITY_INVOCATIONS_METADATA_KEY,
	DESKTOP_COMPACTION_NOTICE_METADATA_KEY,
	DESKTOP_FILE_REFERENCES_METADATA_KEY,
	DESKTOP_PROPOSED_PLAN_METADATA_KEY,
	getUserPromptAttachments,
} from "./assistant-runtime-adapter.ts";

const PROPOSED_PLAN_COLLAPSED_LINES = 12;
const PROPOSED_PLAN_COLLAPSED_LENGTH = 900;

export type DesktopTextPart = Extract<DesktopThreadContentPart, { type: "text" }>;
export type DesktopImagePart = Extract<DesktopThreadContentPart, { type: "image" }>;
export type DesktopActivityPart = Extract<DesktopThreadContentPart, { type: "reasoning" | "tool-call" }>;

export type DesktopAttachmentFilePart = FileUIPart & {
	id: string;
	desktopKind: DesktopPromptAttachmentDisplay["kind"];
	size: number;
};

export type ThreadImageAttachmentFilePart = FileUIPart & {
	id: string;
};

export type AssistantTimelineItem =
	| {
			key: string;
			message: DesktopThreadMessage;
			type: "message";
	  }
	| {
			key: string;
			type: "compaction-running";
	  };

export function getThreadContentParts(message: DesktopThreadMessage): DesktopThreadContentPart[] {
	if (typeof message.content === "string") {
		return message.content.length > 0 ? [{ type: "text", text: message.content }] : [];
	}
	return [...message.content];
}

export function getThreadTextParts(message: DesktopThreadMessage): DesktopTextPart[] {
	return getThreadContentParts(message).filter((part): part is DesktopTextPart => part.type === "text");
}

export function getThreadImageParts(message: DesktopThreadMessage): DesktopImagePart[] {
	return getThreadContentParts(message).filter((part): part is DesktopImagePart => part.type === "image");
}

export function getThreadActivityParts(message: DesktopThreadMessage): DesktopActivityPart[] {
	return getThreadContentParts(message).filter(
		(part): part is DesktopActivityPart => part.type === "reasoning" || part.type === "tool-call",
	);
}

export function toPromptAttachmentFilePart(
	attachment: DesktopPromptAttachmentDisplay | DesktopPreparedPromptAttachment,
): DesktopAttachmentFilePart {
	const image = "images" in attachment ? attachment.images[0] : undefined;
	const canPreviewImage = attachment.kind === "image" && image !== undefined;
	return {
		type: "file",
		desktopKind: attachment.kind,
		filename: attachment.name,
		id: attachment.id,
		mediaType: canPreviewImage
			? attachment.mimeType
			: attachment.kind === "image"
				? "application/octet-stream"
				: attachment.mimeType,
		size: attachment.size,
		url: canPreviewImage ? `data:${image.mimeType};base64,${image.data}` : `desktop-attachment://${attachment.id}`,
	};
}

function getDataUrlMediaType(value: string): string {
	const match = /^data:([^;,]+)[;,]/i.exec(value);
	return match?.[1] ?? "image/*";
}

export function toThreadImageAttachmentFilePart(image: DesktopImagePart, id: string): ThreadImageAttachmentFilePart {
	const filename = image.filename ?? "Attached visual";
	return {
		type: "file",
		filename,
		id,
		mediaType: getDataUrlMediaType(image.image),
		url: image.image,
	};
}

export function isCompactCommand(text: string): boolean {
	return text === "/compact" || text.startsWith("/compact ");
}

export function getCompactInstructions(text: string): string | undefined {
	if (!text.startsWith("/compact ")) {
		return undefined;
	}
	const instructions = text.slice("/compact ".length).trim();
	return instructions.length > 0 ? instructions : undefined;
}

export function emptyCapabilityCatalog(): DesktopCapabilityCatalog {
	return {
		skills: [],
		prompts: [],
		slashCommands: [],
		mcpServers: [],
		diagnostics: [],
	};
}

export function createCapabilityInvocationFromSlashCommand(
	command: DesktopSlashCommandSummary,
): DesktopPromptCapabilityInvocation | undefined {
	if (command.source === "skill" && command.name.startsWith("skill:")) {
		return {
			type: "skill",
			name: command.name.slice("skill:".length),
			...(command.description ? { description: command.description } : {}),
			...(command.sourcePath ? { sourcePath: command.sourcePath } : {}),
		};
	}
	if (command.source === "prompt") {
		return {
			type: "prompt_template",
			name: command.name,
			...(command.description ? { description: command.description } : {}),
			...(command.sourcePath ? { sourcePath: command.sourcePath } : {}),
		};
	}
	return undefined;
}

export function upsertCapabilityInvocation(
	current: DesktopPromptCapabilityInvocation[],
	invocation: DesktopPromptCapabilityInvocation,
): DesktopPromptCapabilityInvocation[] {
	if (invocation.type === "prompt_template") {
		return [invocation, ...current.filter((item) => item.type !== "prompt_template")];
	}
	if (current.some((item) => item.type === "skill" && item.name === invocation.name)) {
		return current;
	}
	return [...current, invocation];
}

export function removeCapabilityInvocation(
	current: DesktopPromptCapabilityInvocation[],
	target: DesktopPromptCapabilityInvocation,
): DesktopPromptCapabilityInvocation[] {
	return current.filter((item) => item.type !== target.type || item.name !== target.name);
}

export function getCapabilityInvocationLabel(invocation: DesktopPromptCapabilityInvocation): string {
	return invocation.type === "skill" ? invocation.name : invocation.name;
}

export function getMessageCapabilityInvocations(customMetadata: unknown): DesktopPromptCapabilityInvocation[] {
	if (!customMetadata || typeof customMetadata !== "object") {
		return [];
	}
	const value = (customMetadata as Record<string, unknown>)[DESKTOP_CAPABILITY_INVOCATIONS_METADATA_KEY];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is DesktopPromptCapabilityInvocation => {
		if (!item || typeof item !== "object") {
			return false;
		}
		const record = item as Record<string, unknown>;
		return (
			(record.type === "skill" || record.type === "prompt_template") &&
			typeof record.name === "string" &&
			record.name.length > 0
		);
	});
}

export function getMessageFileReferences(value: unknown): DesktopThreadFileReference[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return [];
	}
	const record = value as Record<string, unknown>;
	const references = record[DESKTOP_FILE_REFERENCES_METADATA_KEY];
	if (!Array.isArray(references)) {
		return [];
	}
	return references.filter((reference): reference is DesktopThreadFileReference => {
		if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
			return false;
		}
		const item = reference as Record<string, unknown>;
		return (
			(item.kind === "changed" || item.kind === "found") &&
			typeof item.path === "string" &&
			item.path.length > 0 &&
			typeof item.displayPath === "string" &&
			item.displayPath.length > 0 &&
			typeof item.toolName === "string" &&
			item.toolName.length > 0
		);
	});
}

export function getMessageProposedPlan(value: unknown): DesktopProposedPlanMetadata | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const plan = (value as Record<string, unknown>)[DESKTOP_PROPOSED_PLAN_METADATA_KEY];
	if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
		return undefined;
	}
	const text = (plan as Record<string, unknown>).text;
	return typeof text === "string" && text.trim().length > 0 ? { text } : undefined;
}

export function findLatestCompletedProposedPlanMessageId(
	messages: readonly DesktopThreadMessage[],
): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (
			message?.role === "assistant" &&
			message.status?.type === "complete" &&
			getMessageProposedPlan(message.metadata?.custom)
		) {
			return message.id;
		}
	}
	return undefined;
}

export function shouldCollapseProposedPlan(text: string): boolean {
	return text.length > PROPOSED_PLAN_COLLAPSED_LENGTH || text.split("\n").length > PROPOSED_PLAN_COLLAPSED_LINES;
}

export function getCompactionNotice(value: unknown): DesktopCompactionNoticeMetadata | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as { status?: unknown; tokensBefore?: unknown };
	if (record.status !== "completed" || typeof record.tokensBefore !== "number") {
		return undefined;
	}
	return {
		status: record.status,
		tokensBefore: record.tokensBefore,
	};
}

export function shouldRenderTimelineMessage(message: DesktopThreadMessage): boolean {
	if (message.role !== "system") {
		return true;
	}
	const messageCustomMetadata = message.metadata?.custom;
	return Boolean(getCompactionNotice(messageCustomMetadata?.[DESKTOP_COMPACTION_NOTICE_METADATA_KEY]));
}

export function estimateTimelineMessageSize(message: DesktopThreadMessage): number {
	if (message.role === "user") {
		const imageCount = getThreadImageParts(message).length;
		const attachmentCount = getUserPromptAttachments(message.metadata?.custom).length;
		const textLength = getThreadTextParts(message).reduce((total, part) => total + part.text.length, 0);
		return Math.max(92, 76 + imageCount * 112 + attachmentCount * 44 + Math.ceil(textLength / 90) * 18);
	}
	if (message.role === "assistant") {
		const activityCount = getThreadActivityParts(message).length;
		const imageCount = getThreadImageParts(message).length;
		const textLength = getThreadTextParts(message).reduce((total, part) => total + part.text.length, 0);
		return Math.max(116, 88 + activityCount * 72 + imageCount * 112 + Math.ceil(textLength / 80) * 20);
	}
	return 56;
}

export function estimateAssistantTimelineItemSize(item: AssistantTimelineItem): number {
	if (item.type === "compaction-running") {
		return 56;
	}
	return estimateTimelineMessageSize(item.message);
}
