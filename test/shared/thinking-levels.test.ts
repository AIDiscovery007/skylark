import { describe, expect, it } from "vitest";
import {
	clampDesktopThinkingLevelForModel,
	getDesktopThinkingLevelsForModel,
} from "../../src/shared/thinking-levels.ts";

describe("desktop thinking levels", () => {
	it("keeps xhigh available for GPT-5.5 reasoning models", () => {
		const model = {
			id: "gpt-5.5",
			reasoning: true,
		};

		expect(getDesktopThinkingLevelsForModel(model)).toContain("xhigh");
		expect(clampDesktopThinkingLevelForModel("xhigh", model)).toBe("xhigh");
	});
});
