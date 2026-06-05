const STANDALONE_REASONING_HEADING_PATTERN = /^\s*(?:[-*+]\s*)?(?:\*\*|__)\S[\s\S]*?(?:\*\*|__)\s*[:：]?\s*$/u;

export function stripStandaloneReasoningHeadings(text: string): string {
	return text
		.split(/\r?\n/u)
		.filter((line) => !STANDALONE_REASONING_HEADING_PATTERN.test(line))
		.join("\n")
		.replace(/(?:\n\s*){3,}/gu, "\n\n")
		.trim();
}
