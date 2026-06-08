import type { DesktopSlashCommandSummary, DesktopWorkspaceFileEntry } from "../../shared/types.ts";

export type SlashCommandSectionKey = "commands" | "skills" | "prompts";

export interface SlashCommandSection {
	key: SlashCommandSectionKey;
	title: string;
	commands: DesktopSlashCommandSummary[];
}

export interface AtReferenceToken {
	start: number;
	end: number;
	query: string;
}

export function resolveSlashCommandSuggestions(
	text: string,
	commands: DesktopSlashCommandSummary[],
): DesktopSlashCommandSummary[] {
	if (!text.startsWith("/") || text.includes("\n")) {
		return [];
	}
	const slashBody = text.slice(1);
	if (/\s/.test(slashBody)) {
		return [];
	}
	const query = slashBody.toLowerCase();
	return commands
		.filter((command) => !query || command.name.toLowerCase().includes(query))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export function groupSlashCommandSuggestions(commands: DesktopSlashCommandSummary[]): SlashCommandSection[] {
	const sections: SlashCommandSection[] = [
		{ key: "commands", title: "Commands", commands: [] },
		{ key: "skills", title: "Skills", commands: [] },
		{ key: "prompts", title: "Prompt templates", commands: [] },
	];
	for (const command of commands) {
		if (command.source === "skill") {
			sections[1]?.commands.push(command);
			continue;
		}
		if (command.source === "prompt") {
			sections[2]?.commands.push(command);
			continue;
		}
		sections[0]?.commands.push(command);
	}
	return sections.filter((section) => section.commands.length > 0);
}

function getAtReferenceTokenEnd(text: string, start: number): number {
	let end = start;
	while (end < text.length && !/\s/.test(text[end] ?? "")) {
		end += 1;
	}
	return end;
}

function isAtTokenBoundary(text: string, atIndex: number): boolean {
	if (atIndex === 0) {
		return true;
	}
	const previous = text[atIndex - 1];
	return previous === undefined || /[\s([{'"`]/.test(previous);
}

export function resolveAtReferenceToken(text: string, cursor: number | undefined): AtReferenceToken | undefined {
	const cursorIndex = Math.min(Math.max(cursor ?? text.length, 0), text.length);
	const beforeCursor = text.slice(0, cursorIndex);
	const atIndex = beforeCursor.lastIndexOf("@");
	if (atIndex < 0 || !isAtTokenBoundary(text, atIndex)) {
		return undefined;
	}
	const query = text.slice(atIndex + 1, cursorIndex);
	if (/\s/.test(query)) {
		return undefined;
	}
	return {
		start: atIndex,
		end: getAtReferenceTokenEnd(text, atIndex),
		query,
	};
}

export function filterWorkspaceFileSuggestions(
	files: DesktopWorkspaceFileEntry[],
	query: string,
): DesktopWorkspaceFileEntry[] {
	const normalizedQuery = query.replace(/^"/, "").toLowerCase();
	if (!normalizedQuery) {
		return files;
	}
	return files.filter(
		(file) => file.name.toLowerCase().includes(normalizedQuery) || file.path.toLowerCase().includes(normalizedQuery),
	);
}

export function formatWorkspaceFileReference(path: string): string {
	if (!/\s/.test(path)) {
		return `@${path}`;
	}
	return `@"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
