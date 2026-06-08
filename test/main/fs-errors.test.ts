import { describe, expect, it } from "vitest";
import { isMissingFileError } from "../../src/main/storage/fs-errors.ts";

describe("fs-errors", () => {
	it("matches ENOENT errors", () => {
		expect(isMissingFileError(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBe(true);
	});

	it("rejects non-ENOENT values", () => {
		expect(isMissingFileError(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(false);
		expect(isMissingFileError({ code: "ENOFILE" })).toBe(false);
		expect(isMissingFileError(null)).toBe(false);
	});
});
