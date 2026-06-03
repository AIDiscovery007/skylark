import {
	type Api,
	type AssistantMessage,
	type Context,
	completeSimple,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { deriveFallbackSessionTitleFromText, normalizeSessionTitle } from "../session-title-utils.ts";

const SESSION_TITLE_SYSTEM_PROMPT = "你是桌面 AI agent 的会话命名器。只输出一个中文短标题，不要解释。";

type SessionTitleCompletion = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export interface GenerateSessionTitleOptions {
	text: string;
	model: Model<Api>;
	apiKey?: string;
	complete?: SessionTitleCompletion;
}

function getAssistantText(message: AssistantMessage): string | undefined {
	const text = message.content
		.filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join(" ")
		.trim();

	return text || undefined;
}

function buildSessionTitlePrompt(text: string): string {
	return [
		"根据用户第一条指令为会话命名。",
		"要求：",
		"- 10 个中文字符以内。",
		"- 只保留核心任务或主题。",
		"- 不要使用“请、帮我、处理、这个、一下、事件”等虚词。",
		"- 不要标点、引号、编号、前后缀。",
		"",
		"用户指令：",
		`<request>${text.trim()}</request>`,
	].join("\n");
}

export async function generateSessionTitleFromPrompt({
	apiKey,
	complete = completeSimple,
	model,
	text,
}: GenerateSessionTitleOptions): Promise<string> {
	const fallbackTitle = deriveFallbackSessionTitleFromText(text);
	if (!text.trim()) {
		return fallbackTitle;
	}

	try {
		const response = await complete(
			model,
			{
				systemPrompt: SESSION_TITLE_SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: buildSessionTitlePrompt(text),
						timestamp: Date.now(),
					},
				],
			},
			{
				maxTokens: 24,
				temperature: 0,
				...(apiKey ? { apiKey } : {}),
			},
		);

		if (response.stopReason === "error") {
			return fallbackTitle;
		}

		return normalizeSessionTitle(getAssistantText(response)) ?? fallbackTitle;
	} catch {
		return fallbackTitle;
	}
}
