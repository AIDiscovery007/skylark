import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const DEFAULT_SESSION_TITLE = "New Session";
export const SESSION_TITLE_MAX_CHARS = 10;

const GENERIC_SESSION_TITLES = new Set(["", DEFAULT_SESSION_TITLE, "New session", "新会话"]);
const LEADING_FILLER_PATTERN =
	/^(请你?|帮我|帮忙|麻烦|可以|能否|我想|我要|需要|处理|看一下|读一下|扫一下|扫描|这个|一下|事件|任务|问题|先|直接)+/;
const TITLE_PREFIX_PATTERN = /^(会话)?标题[:：\-\s]*/;
const WRAPPING_QUOTES_PATTERN = /^[`"'“”‘’「」『』【】\s]+|[`"'“”‘’「」『』【】\s]+$/g;
const LEADING_SEPARATOR_PATTERN = /^[\s。.!?！？、，,;；:：-]+/;

function toTitleChars(value: string): string[] {
	return Array.from(value);
}

export function clampSessionTitle(value: string): string {
	return toTitleChars(value).slice(0, SESSION_TITLE_MAX_CHARS).join("");
}

export function normalizeSessionTitle(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const firstLine = value
		.trim()
		.split(/\s*(?:\r?\n|[。.!?！？])\s*/)[0]
		?.replace(/\s+/g, " ")
		?.replace(TITLE_PREFIX_PATTERN, "")
		.replace(WRAPPING_QUOTES_PATTERN, "")
		.trim();
	if (!firstLine) {
		return undefined;
	}

	return clampSessionTitle(firstLine);
}

export function isGenericSessionTitle(value: string | undefined): boolean {
	return GENERIC_SESSION_TITLES.has(value?.trim() ?? "");
}

export function getAgentMessageText(message: AgentMessage): string | undefined {
	if (message.role !== "user") {
		return undefined;
	}

	if (typeof message.content === "string") {
		return message.content;
	}

	return message.content
		.filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join(" ");
}

export function getFirstUserMessageText(messages: readonly AgentMessage[]): string | undefined {
	for (const message of messages) {
		const text = getAgentMessageText(message);
		if (text?.trim()) {
			return text;
		}
	}

	return undefined;
}

function normalizePromptForComparison(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function isLegacyAutoDerivedSessionTitle(messages: readonly AgentMessage[], title: string | undefined): boolean {
	const firstUserText = getFirstUserMessageText(messages);
	if (!firstUserText || !title) {
		return false;
	}

	return normalizePromptForComparison(firstUserText).slice(0, 80) === normalizePromptForComparison(title);
}

function pickEnglishTitle(value: string): string | undefined {
	const words = value.match(/[A-Za-z0-9][A-Za-z0-9._-]*/g);
	if (!words?.length) {
		return undefined;
	}

	let title = "";
	for (const word of words.slice(0, 3)) {
		const nextTitle = title ? `${title} ${word}` : word;
		if (toTitleChars(nextTitle).length > SESSION_TITLE_MAX_CHARS) {
			break;
		}
		title = nextTitle;
	}

	return title || clampSessionTitle(words[0] ?? "");
}

function stripLeadingFiller(value: string): string {
	let nextValue = value;
	for (let index = 0; index < 3; index += 1) {
		const stripped = nextValue.replace(LEADING_SEPARATOR_PATTERN, "").replace(LEADING_FILLER_PATTERN, "").trim();
		if (stripped === nextValue) {
			return stripped;
		}
		nextValue = stripped;
	}

	return nextValue;
}

export function deriveFallbackSessionTitleFromText(text: string | undefined): string {
	const normalized = text?.replace(/\s+/g, " ").trim() ?? "";
	if (!normalized) {
		return DEFAULT_SESSION_TITLE;
	}

	const withoutFiller = stripLeadingFiller(normalized) || normalized;
	const firstThought = withoutFiller.split(/[。.!?！？,，；;]/)[0]?.trim() || withoutFiller;
	const cjkText = firstThought.replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, "");
	if (/\p{Script=Han}/u.test(cjkText)) {
		return clampSessionTitle(cjkText);
	}

	return normalizeSessionTitle(pickEnglishTitle(firstThought)) ?? DEFAULT_SESSION_TITLE;
}

export function deriveFallbackSessionTitle(messages: readonly AgentMessage[], currentTitle?: string): string {
	const normalizedTitle = normalizeSessionTitle(currentTitle);
	if (
		normalizedTitle &&
		!isGenericSessionTitle(currentTitle) &&
		!isLegacyAutoDerivedSessionTitle(messages, currentTitle)
	) {
		return normalizedTitle;
	}

	return (
		deriveFallbackSessionTitleFromText(getFirstUserMessageText(messages)) ?? normalizedTitle ?? DEFAULT_SESSION_TITLE
	);
}
