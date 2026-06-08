import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTrackedTempDir } from "../support/temp-dir.ts";

describe.sequential("createTrackedTempDir", () => {
	let createdDirectoryPath: string | undefined;

	it("creates a temporary directory", () => {
		createdDirectoryPath = createTrackedTempDir("skylark-temp-dir-test-");
		writeFileSync(join(createdDirectoryPath, "marker.txt"), "ok", "utf8");

		expect(existsSync(createdDirectoryPath)).toBe(true);
	});

	it("removes created directories after each test", () => {
		expect(createdDirectoryPath).toBeDefined();
		expect(existsSync(createdDirectoryPath as string)).toBe(false);
	});
});
