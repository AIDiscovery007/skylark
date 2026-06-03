import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { generateSessionTitleFromPrompt } from "../../src/main/runtime/session-title-generator.ts";
import {
	deriveFallbackSessionTitle,
	deriveFallbackSessionTitleFromText,
	isLegacyAutoDerivedSessionTitle,
	normalizeSessionTitle,
	SESSION_TITLE_MAX_CHARS,
} from "../../src/main/session-title-utils.ts";

const model = {
	id: "title-model",
	name: "Title Model",
	api: "faux-title",
	provider: "faux",
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 128,
} satisfies Model<Api>;

function createAssistantMessage(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	};
}

describe("session title naming", () => {
	it("normalizes generated titles to a concise ten-character label", async () => {
		const title = await generateSessionTitleFromPrompt({
			text: "请处理这个事件。先快速评估目标和约束，然后直接推进可执行部分。",
			model,
			complete: async (_model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) =>
				createAssistantMessage("标题：流动性风险监控策略模板"),
		});

		expect(Array.from(title)).toHaveLength(SESSION_TITLE_MAX_CHARS);
		expect(title).toBe("流动性风险监控策略模");
	});

	it("falls back to a local short title when the model cannot name the session", async () => {
		const title = await generateSessionTitleFromPrompt({
			text: "请处理这个事件。先快速评估目标和约束。",
			model,
			complete: async () => createAssistantMessage("failed", "error"),
		});

		expect(title).toBe("快速评估目标和约束");
		expect(Array.from(title).length).toBeLessThanOrEqual(SESSION_TITLE_MAX_CHARS);
	});

	it("recognizes and replaces legacy titles copied from the first user prompt", () => {
		const messages = [
			{
				role: "user" as const,
				content: "请处理这个事件。先快速评估目标和约束，然后直接推进可执行部分。",
				timestamp: 1,
			},
		];
		const legacyTitle = "请处理这个事件。先快速评估目标和约束，然后直接推进可执行部分。";

		expect(isLegacyAutoDerivedSessionTitle(messages, legacyTitle)).toBe(true);
		expect(deriveFallbackSessionTitle(messages, legacyTitle)).toBe("快速评估目标和约束");
	});

	it("keeps explicit short titles and trims noisy title output", () => {
		expect(normalizeSessionTitle("标题：代码审查\n说明")).toBe("代码审查");
		expect(deriveFallbackSessionTitle([], "代码审查")).toBe("代码审查");
		expect(deriveFallbackSessionTitleFromText("Read package.json in this workspace")).toBe("Read");
	});
});
