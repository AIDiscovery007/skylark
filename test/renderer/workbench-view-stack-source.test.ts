import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench view stack layering", () => {
	it("keeps only the active primary workbench view above retained inactive views", () => {
		const appSource = readFileSync("src/renderer/App.tsx", "utf8");
		const coordinationSource = readFileSync("src/renderer/lib/main-workbench-coordination.ts", "utf8");

		expect(coordinationSource).toContain("function getWorkbenchViewClass(isActive: boolean): string");
		expect(coordinationSource).toContain(
			'isActive ? "visible z-10 opacity-100" : "invisible z-0 pointer-events-none opacity-0"',
		);
		expect(appSource).toContain("getWorkbenchViewClass(isChatView)");
		expect(appSource).toContain("getWorkbenchViewClass(isCapabilitiesView)");
		expect(appSource).toContain("getWorkbenchViewClass(isEventsView)");
	});
});
