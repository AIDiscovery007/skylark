import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containRealPath, isPathInside } from "../../src/main/util/path-scope.ts";
import { createTrackedTempDir } from "../support/temp-dir.ts";

describe("path-scope", () => {
	it("accepts a directory and its descendants", () => {
		const root = "/tmp/skylark/project";

		expect(isPathInside(root, root)).toBe(true);
		expect(isPathInside(root, "/tmp/skylark/project/src/index.ts")).toBe(true);
	});

	it("rejects sibling-prefix and parent traversal paths", () => {
		const root = "/tmp/skylark/project";

		expect(isPathInside(root, "/tmp/skylark/project-other/index.ts")).toBe(false);
		expect(isPathInside(root, "/tmp/skylark/project/../secret.txt")).toBe(false);
	});

	it("rejects paths whose relative result is absolute", () => {
		expect(isPathInside("relative-root", "/tmp/skylark/absolute-child")).toBe(false);
	});

	it("returns the target realpath for contained paths", async () => {
		const root = createTrackedTempDir("skylark-path-scope-");
		const filePath = join(root, "src", "index.ts");
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(filePath, "export const ready = true;\n", "utf8");

		await expect(containRealPath(root, filePath)).resolves.toBe(realpathSync(filePath));
	});

	it("rejects symlink escapes after realpath normalization", async () => {
		const root = createTrackedTempDir("skylark-path-scope-");
		const outsideRoot = createTrackedTempDir("skylark-path-scope-outside-");
		const outsideFilePath = join(outsideRoot, "secret.txt");
		const linkPath = join(root, "secret-link.txt");
		writeFileSync(outsideFilePath, "secret\n", "utf8");
		symlinkSync(outsideFilePath, linkPath);

		await expect(containRealPath(root, linkPath)).resolves.toBeNull();
	});
});
