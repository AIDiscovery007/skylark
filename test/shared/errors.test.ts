import { describe, expect, it } from "vitest";
import { getErrorMessage } from "../../src/shared/errors.ts";

describe("errors", () => {
	it("returns Error messages", () => {
		expect(getErrorMessage(new Error("failed to load"))).toBe("failed to load");
	});

	it("stringifies non-Error values", () => {
		expect(getErrorMessage("plain failure")).toBe("plain failure");
		expect(getErrorMessage(404)).toBe("404");
		expect(getErrorMessage(null)).toBe("null");
	});
});
