import { describe, expect, it } from "vitest";
import {
	createDesktopNativeAppearance,
	normalizeNativeAccentColor,
} from "../../src/main/appearance/native-appearance.ts";

describe("native appearance", () => {
	it("normalizes the macOS accent color into a CSS color", () => {
		expect(normalizeNativeAccentColor("0A84FF")).toBe("#0a84ff");
		expect(normalizeNativeAccentColor("#FF375F")).toBe("#ff375f");
		expect(normalizeNativeAccentColor("not-a-color")).toBe("#0a84ff");
	});

	it("converts Electron native theme state into renderer-safe appearance data", () => {
		const appearance = createDesktopNativeAppearance(
			{
				inForcedColorsMode: false,
				prefersReducedTransparency: true,
				shouldUseDarkColors: true,
				shouldUseHighContrastColors: true,
				shouldUseInvertedColorScheme: false,
			},
			{
				getAccentColor: () => "BF5AF2",
			},
		);

		expect(appearance).toEqual({
			accentColor: "#bf5af2",
			colorScheme: "dark",
			forcedColors: false,
			highContrast: true,
			invertedColors: false,
			reducedTransparency: true,
		});
	});
});
