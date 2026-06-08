import { describe, expect, it } from "vitest";
import { isRecord } from "../../src/shared/guards.ts";

describe("guards", () => {
	it("accepts non-array objects", () => {
		expect(isRecord({ id: "workspace" })).toBe(true);
		expect(isRecord(new Date("2026-06-07T00:00:00.000Z"))).toBe(true);
	});

	it("rejects null, arrays, and primitives", () => {
		expect(isRecord(null)).toBe(false);
		expect(isRecord([])).toBe(false);
		expect(isRecord("workspace")).toBe(false);
		expect(isRecord(1)).toBe(false);
	});
});
