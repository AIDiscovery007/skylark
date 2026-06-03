import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileStore } from "../../src/main/storage/json-file-store.ts";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-json-store-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

describe("JsonFileStore", () => {
	it("supports concurrent writes without losing the target file", async () => {
		const directoryPath = createTempDirectory();
		const filePath = join(directoryPath, "store.json");
		const store = new JsonFileStore(filePath, { value: "initial" });

		await Promise.all([store.write({ value: "first" }), store.write({ value: "second" })]);

		const fileContent = JSON.parse(await readFile(filePath, "utf8")) as { value: string };
		expect(["first", "second"]).toContain(fileContent.value);
	});
});
