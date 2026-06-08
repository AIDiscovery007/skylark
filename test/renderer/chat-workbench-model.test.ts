import { describe, expect, it } from "vitest";
import {
	DESKTOP_CAPABILITY_INVOCATIONS_METADATA_KEY,
	DESKTOP_COMPACTION_NOTICE_METADATA_KEY,
	DESKTOP_FILE_REFERENCES_METADATA_KEY,
	DESKTOP_PROPOSED_PLAN_METADATA_KEY,
	type DesktopThreadMessage,
} from "../../src/renderer/lib/assistant-runtime-adapter.ts";
import {
	createCapabilityInvocationFromSlashCommand,
	estimateTimelineMessageSize,
	findLatestCompletedProposedPlanMessageId,
	getCompactInstructions,
	getCompactionNotice,
	getMessageCapabilityInvocations,
	getMessageFileReferences,
	getMessageProposedPlan,
	getThreadActivityParts,
	getThreadContentParts,
	getThreadImageParts,
	getThreadTextParts,
	isCompactCommand,
	shouldCollapseProposedPlan,
	shouldRenderTimelineMessage,
	toPromptAttachmentFilePart,
	toThreadImageAttachmentFilePart,
	upsertCapabilityInvocation,
} from "../../src/renderer/lib/chat-workbench-model.ts";
import type { DesktopPreparedPromptAttachment, DesktopPromptAttachmentDisplay } from "../../src/shared/types.ts";

function createMessage(overrides: Partial<DesktopThreadMessage>): DesktopThreadMessage {
	return {
		id: "message-1",
		role: "assistant",
		content: "",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	} as DesktopThreadMessage;
}

describe("chat workbench model", () => {
	it("normalizes thread content into text, image, and activity parts", () => {
		const message = createMessage({
			content: [
				{ type: "text", text: "hello" },
				{ type: "image", image: "data:image/png;base64,abc", filename: "panel.png" },
				{ type: "reasoning", text: "thinking" },
				{ type: "tool-call", toolCallId: "call-1", toolName: "read", result: "done" },
			],
		});

		expect(getThreadContentParts(createMessage({ content: "hello" }))).toEqual([{ type: "text", text: "hello" }]);
		expect(getThreadContentParts(createMessage({ content: "" }))).toEqual([]);
		expect(getThreadTextParts(message)).toEqual([{ type: "text", text: "hello" }]);
		expect(getThreadImageParts(message)).toEqual([
			{ type: "image", image: "data:image/png;base64,abc", filename: "panel.png" },
		]);
		expect(getThreadActivityParts(message).map((part) => part.type)).toEqual(["reasoning", "tool-call"]);
	});

	it("builds prompt and thread image attachment file parts", () => {
		const imageAttachment: DesktopPreparedPromptAttachment = {
			id: "attachment-image",
			kind: "image",
			name: "panel.png",
			mimeType: "image/png",
			path: "/workspace/panel.png",
			promptText: "image prompt",
			size: 120,
			images: [{ type: "image", data: "abc", mimeType: "image/png" }],
		};
		const textAttachment: DesktopPromptAttachmentDisplay = {
			id: "attachment-text",
			kind: "text",
			name: "notes.md",
			mimeType: "text/markdown",
			size: 32,
		};

		expect(toPromptAttachmentFilePart(imageAttachment)).toMatchObject({
			desktopKind: "image",
			mediaType: "image/png",
			url: "data:image/png;base64,abc",
		});
		expect(toPromptAttachmentFilePart({ ...imageAttachment, images: [] })).toMatchObject({
			mediaType: "application/octet-stream",
			url: "desktop-attachment://attachment-image",
		});
		expect(toPromptAttachmentFilePart(textAttachment)).toMatchObject({
			filename: "notes.md",
			mediaType: "text/markdown",
			url: "desktop-attachment://attachment-text",
		});
		expect(
			toThreadImageAttachmentFilePart(
				{ type: "image", image: "data:image/jpeg;base64,xyz", filename: "photo.jpg" },
				"message-image-0",
			),
		).toMatchObject({
			filename: "photo.jpg",
			id: "message-image-0",
			mediaType: "image/jpeg",
		});
	});

	it("parses compact commands and capability invocations", () => {
		expect(isCompactCommand("/compact")).toBe(true);
		expect(isCompactCommand("/compact keep failures")).toBe(true);
		expect(isCompactCommand("/compactly")).toBe(false);
		expect(getCompactInstructions("/compact keep failures")).toBe("keep failures");
		expect(getCompactInstructions("/compact   ")).toBeUndefined();

		const skillInvocation = createCapabilityInvocationFromSlashCommand({
			name: "skill:tdd",
			description: "TDD",
			source: "skill",
			sourcePath: "/skills/tdd/SKILL.md",
		});
		expect(skillInvocation).toEqual({
			type: "skill",
			name: "tdd",
			description: "TDD",
			sourcePath: "/skills/tdd/SKILL.md",
		});
		expect(
			createCapabilityInvocationFromSlashCommand({
				name: "review",
				description: "Review",
				source: "prompt",
				sourcePath: "/prompts/review.md",
			}),
		).toEqual({
			type: "prompt_template",
			name: "review",
			description: "Review",
			sourcePath: "/prompts/review.md",
		});
		expect(createCapabilityInvocationFromSlashCommand({ name: "compact", source: "builtin" })).toBeUndefined();

		expect(
			upsertCapabilityInvocation(
				[
					{ type: "prompt_template", name: "old" },
					{ type: "skill", name: "tdd" },
				],
				{ type: "prompt_template", name: "new" },
			),
		).toEqual([
			{ type: "prompt_template", name: "new" },
			{ type: "skill", name: "tdd" },
		]);
		expect(upsertCapabilityInvocation([{ type: "skill", name: "tdd" }], { type: "skill", name: "tdd" })).toEqual([
			{ type: "skill", name: "tdd" },
		]);
	});

	it("filters message metadata and plan state", () => {
		const customMetadata = {
			[DESKTOP_CAPABILITY_INVOCATIONS_METADATA_KEY]: [
				{ type: "skill", name: "tdd" },
				{ type: "prompt_template", name: "review" },
				{ type: "skill", name: "" },
			],
			[DESKTOP_FILE_REFERENCES_METADATA_KEY]: [
				{ kind: "changed", path: "src/App.tsx", displayPath: "src/App.tsx", toolName: "edit" },
				{ kind: "other", path: "bad", displayPath: "bad", toolName: "read" },
			],
			[DESKTOP_PROPOSED_PLAN_METADATA_KEY]: { text: "1. Ship it" },
		};

		expect(getMessageCapabilityInvocations(customMetadata)).toEqual([
			{ type: "skill", name: "tdd" },
			{ type: "prompt_template", name: "review" },
		]);
		expect(getMessageFileReferences(customMetadata)).toEqual([
			{ kind: "changed", path: "src/App.tsx", displayPath: "src/App.tsx", toolName: "edit" },
		]);
		expect(getMessageProposedPlan(customMetadata)).toEqual({ text: "1. Ship it" });
		expect(
			findLatestCompletedProposedPlanMessageId([
				createMessage({
					id: "old",
					status: { type: "complete", reason: "stop" },
					metadata: { custom: customMetadata },
				}),
				createMessage({ id: "running", status: { type: "running" }, metadata: { custom: customMetadata } }),
				createMessage({
					id: "latest",
					status: { type: "complete", reason: "stop" },
					metadata: { custom: customMetadata },
				}),
			]),
		).toBe("latest");
		expect(shouldCollapseProposedPlan("short")).toBe(false);
		expect(shouldCollapseProposedPlan(Array.from({ length: 13 }, (_, index) => `${index}`).join("\n"))).toBe(true);
	});

	it("recognizes compaction timeline messages and estimates item height", () => {
		const systemMessage = createMessage({
			role: "system",
			metadata: {
				custom: {
					[DESKTOP_COMPACTION_NOTICE_METADATA_KEY]: { status: "completed", tokensBefore: 42000 },
				},
			},
		});
		const userMessage = createMessage({
			role: "user",
			content: [{ type: "text", text: "x".repeat(200) }],
		});
		const assistantMessage = createMessage({
			role: "assistant",
			content: [
				{ type: "text", text: "x".repeat(200) },
				{ type: "reasoning", text: "thinking" },
			],
		});

		expect(getCompactionNotice({ status: "completed", tokensBefore: 42000 })).toEqual({
			status: "completed",
			tokensBefore: 42000,
		});
		expect(shouldRenderTimelineMessage(systemMessage)).toBe(true);
		expect(shouldRenderTimelineMessage(createMessage({ role: "system" }))).toBe(false);
		expect(estimateTimelineMessageSize(userMessage)).toBeGreaterThanOrEqual(92);
		expect(estimateTimelineMessageSize(assistantMessage)).toBeGreaterThan(116);
	});
});
