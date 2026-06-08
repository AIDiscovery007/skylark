import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const trackedTempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		trackedTempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

export function createTrackedTempDir(prefix: string): string {
	const directoryPath = mkdtempSync(join(tmpdir(), prefix));
	trackedTempDirectories.push(directoryPath);
	return directoryPath;
}
