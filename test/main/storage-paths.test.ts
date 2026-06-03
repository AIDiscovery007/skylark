import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopMainStoragePaths, createDesktopStoragePaths } from "../../src/main/storage/paths.ts";

describe("createDesktopStoragePaths", () => {
	it("keeps agent data in the visible Skylark home and platform data in Electron userData", () => {
		const paths = createDesktopStoragePaths("/Users/test/Library/Application Support/Skylark Development", {
			homeDir: "/Users/test",
		});

		expect(paths.agentRootDir).toBe(join("/Users/test", ".skylark"));
		expect(paths.platformRootDir).toBe(
			join("/Users/test/Library/Application Support/Skylark Development", "desktop-agent"),
		);
		expect(paths.rootDir).toBe(paths.agentRootDir);
		expect(paths.settingsFilePath).toBe(join("/Users/test", ".skylark", "settings.json"));
		expect(paths.providerKeysFilePath).toBe(join("/Users/test", ".skylark", "provider-keys.json"));
		expect(paths.sessionIndexFilePath).toBe(join("/Users/test", ".skylark", "session_index.jsonl"));
		expect(paths.eventManagementCriteriaFilePath).toBe(join("/Users/test", ".skylark", "events", "EVENTS.md"));
		expect(paths.sessionsDir).toBe(join("/Users/test", ".skylark", "sessions"));
		expect(paths.archivedSessionsDir).toBe(join("/Users/test", ".skylark", "archived_sessions"));
		expect(paths.platformStateFilePath).toBe(
			join("/Users/test/Library/Application Support/Skylark Development", "desktop-agent", "platform-state.json"),
		);
	});

	it("supports an explicit agent home for isolated desktop tooling", () => {
		const paths = createDesktopStoragePaths("/tmp/user-data", {
			agentRootDir: "/tmp/skylark-home",
		});

		expect(paths.agentRootDir).toBe("/tmp/skylark-home");
		expect(paths.sessionsDir).toBe(join("/tmp/skylark-home", "sessions"));
	});

	it("keeps packaged release state inside Electron userData for a fresh installed app", () => {
		const paths = createDesktopMainStoragePaths("/Users/test/Library/Application Support/Skylark", {
			homeDir: "/Users/test",
			isPackaged: true,
		});

		expect(paths.agentRootDir).toBe(join("/Users/test/Library/Application Support/Skylark", "desktop-agent"));
		expect(paths.rootDir).toBe(paths.agentRootDir);
		expect(paths.projectIndexFilePath).toBe(
			join("/Users/test/Library/Application Support/Skylark", "desktop-agent", "projects", "index.json"),
		);
		expect(paths.sessionIndexFilePath).toBe(
			join("/Users/test/Library/Application Support/Skylark", "desktop-agent", "session_index.jsonl"),
		);
	});

	it("keeps local development state in the visible Skylark home", () => {
		const paths = createDesktopMainStoragePaths("/Users/test/Library/Application Support/Skylark Development", {
			homeDir: "/Users/test",
			isPackaged: false,
		});

		expect(paths.agentRootDir).toBe(join("/Users/test", ".skylark"));
		expect(paths.platformRootDir).toBe(
			join("/Users/test/Library/Application Support/Skylark Development", "desktop-agent"),
		);
	});
});
