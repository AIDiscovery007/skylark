import { describe, expect, it } from "vitest";
import {
	filterWorkspaceFileSuggestions,
	formatWorkspaceFileReference,
	groupSlashCommandSuggestions,
	resolveAtReferenceToken,
	resolveSlashCommandSuggestions,
} from "../../src/renderer/lib/chat-composer-model.ts";
import type { DesktopSlashCommandSummary, DesktopWorkspaceFileEntry } from "../../src/shared/types.ts";

const slashCommands: DesktopSlashCommandSummary[] = [
	{ name: "zeta", description: "Zeta", source: "builtin" },
	{ name: "skill:tdd", description: "TDD", source: "skill" },
	{ name: "review", description: "Review", source: "prompt" },
	{ name: "alpha", description: "Alpha", source: "builtin" },
];

function workspaceFile(path: string, name = path.split("/").pop() ?? path): DesktopWorkspaceFileEntry {
	return {
		path,
		name,
		type: "code",
		size: 10,
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

describe("chat composer model", () => {
	it("resolves slash command suggestions for single-token slash drafts", () => {
		expect(resolveSlashCommandSuggestions("/", slashCommands).map((command) => command.name)).toEqual([
			"alpha",
			"review",
			"skill:tdd",
			"zeta",
		]);
		expect(resolveSlashCommandSuggestions("/t", slashCommands).map((command) => command.name)).toEqual([
			"skill:tdd",
			"zeta",
		]);
		expect(resolveSlashCommandSuggestions("/t dd", slashCommands)).toEqual([]);
		expect(resolveSlashCommandSuggestions("/t\n", slashCommands)).toEqual([]);
		expect(resolveSlashCommandSuggestions("hello /t", slashCommands)).toEqual([]);
	});

	it("groups slash command suggestions by source", () => {
		expect(groupSlashCommandSuggestions(slashCommands)).toEqual([
			{
				key: "commands",
				title: "Commands",
				commands: [
					{ name: "zeta", description: "Zeta", source: "builtin" },
					{ name: "alpha", description: "Alpha", source: "builtin" },
				],
			},
			{
				key: "skills",
				title: "Skills",
				commands: [{ name: "skill:tdd", description: "TDD", source: "skill" }],
			},
			{
				key: "prompts",
				title: "Prompt templates",
				commands: [{ name: "review", description: "Review", source: "prompt" }],
			},
		]);
	});

	it("resolves @ file reference tokens at cursor boundaries", () => {
		expect(resolveAtReferenceToken("Open @src/App.tsx please", 17)).toEqual({
			start: 5,
			end: 17,
			query: "src/App.tsx",
		});
		expect(resolveAtReferenceToken("email@test.com", "email@test".length)).toBeUndefined();
		expect(resolveAtReferenceToken("Open @src/App.tsx", "Open @src".length)).toEqual({
			start: 5,
			end: 17,
			query: "src",
		});
		expect(resolveAtReferenceToken("Open @src/App.tsx and", "Open @src/App.tsx and".length)).toBeUndefined();
	});

	it("filters and formats workspace file references", () => {
		const files = [
			workspaceFile("src/App.tsx", "App.tsx"),
			workspaceFile("docs/Release Notes.md", "Release Notes.md"),
		];

		expect(filterWorkspaceFileSuggestions(files, "app")).toEqual([files[0]]);
		expect(filterWorkspaceFileSuggestions(files, '"release')).toEqual([files[1]]);
		expect(formatWorkspaceFileReference("src/App.tsx")).toBe("@src/App.tsx");
		expect(formatWorkspaceFileReference('docs/Release "Notes".md')).toBe('@"docs/Release \\"Notes\\".md"');
		expect(formatWorkspaceFileReference("docs\\Release Notes.md")).toBe('@"docs\\\\Release Notes.md"');
	});
});
