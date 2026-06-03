import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopPlatformStateStore } from "../../src/main/storage/platform-state-store.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-platform-state-store-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

describe("DesktopPlatformStateStore", () => {
	it("persists window state separately from user agent settings", async () => {
		const directoryPath = createTempDirectory();
		const filePath = join(directoryPath, "platform-state.json");
		const store = new DesktopPlatformStateStore(filePath);

		await store.set("windowStates", {
			main: { x: 10, y: 20, width: 1200, height: 800, isMaximized: true },
		});

		const reloadedStore = new DesktopPlatformStateStore(filePath);
		expect(await reloadedStore.getAll()).toEqual({
			windowStates: {
				main: { x: 10, y: 20, width: 1200, height: 800, isMaximized: true },
			},
		});
	});
});
