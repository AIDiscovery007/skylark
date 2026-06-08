const PROMPT_FILE_BLOCK_PATTERN = /(?:\n{0,2}<file\b[^>]*>[\s\S]*?<\/file>\n*)+/gi;

export function stripPromptFileBlocks(text: string): string {
	return text
		.replace(PROMPT_FILE_BLOCK_PATTERN, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
