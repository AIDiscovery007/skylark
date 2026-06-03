import { describe, expect, it } from "vitest";
import { applyDesktopAppearanceTheme } from "../../src/renderer/lib/appearance-theme.ts";
import { DEFAULT_DESKTOP_APPEARANCE_SETTINGS } from "../../src/shared/types.ts";

describe("desktop appearance theme", () => {
	it("preserves default CSS theme variables when no custom appearance is saved", () => {
		const root = document.createElement("html");

		applyDesktopAppearanceTheme(
			root,
			{},
			{
				accentColor: "#bf5af2",
				colorScheme: "dark",
				forcedColors: false,
				highContrast: true,
				invertedColors: false,
				reducedTransparency: true,
			},
		);

		expect(root.classList.contains("dark")).toBe(true);
		expect(root.style.getPropertyValue("--system-accent")).toBe("#bf5af2");
		expect(root.style.getPropertyValue("--accent")).toBe("");
		expect(root.style.getPropertyValue("--background")).toBe("");
		expect(root.dataset.nativeHighContrast).toBe("true");
		expect(root.dataset.nativeReducedTransparency).toBe("true");
		expect(root.dataset.desktopAppearanceCustomized).toBe("false");
	});

	it("applies the saved dark palette when system mode resolves to dark", () => {
		const root = document.createElement("html");

		applyDesktopAppearanceTheme(
			root,
			{
				appearance: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
					themeMode: "system",
					uiFontSize: 14,
					codeFontSize: 15,
					darkTheme: {
						...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme,
						accentColor: "#cc7d5e",
						backgroundColor: "#2d2d2b",
						codeFontFamily: '"JetBrains Mono"',
						contrast: 60,
						foregroundColor: "#f9f9f7",
						translucentSidebar: true,
						uiFontFamily: "-apple-system, BlinkMacSystemFont",
					},
				},
			},
			{
				accentColor: "#0a84ff",
				colorScheme: "dark",
				forcedColors: false,
				highContrast: false,
				invertedColors: false,
				reducedTransparency: false,
			},
		);

		expect(root.classList.contains("dark")).toBe(true);
		expect(root.style.getPropertyValue("--accent")).toBe("#cc7d5e");
		expect(root.style.getPropertyValue("--background")).toBe("#2d2d2b");
		expect(root.style.getPropertyValue("--foreground")).toBe("#f9f9f7");
		expect(root.style.getPropertyValue("--desktop-code-font-family")).toBe('"JetBrains Mono"');
		expect(root.style.getPropertyValue("--desktop-ui-font-size")).toBe("14px");
		expect(root.style.getPropertyValue("--desktop-code-font-size")).toBe("15px");
		expect(root.dataset.desktopSidebarTranslucent).toBe("true");
		expect(root.dataset.desktopAppearanceCustomized).toBe("true");
		expect(root.style.getPropertyValue("--appearance-border-subtle-mix")).toBe("12%");
	});

	it("lets an explicit light theme mode override native dark appearance", () => {
		const root = document.createElement("html");

		applyDesktopAppearanceTheme(
			root,
			{
				appearance: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
					themeMode: "light",
				},
			},
			{
				accentColor: "#0a84ff",
				colorScheme: "dark",
				forcedColors: false,
				highContrast: false,
				invertedColors: false,
				reducedTransparency: false,
			},
		);

		expect(root.classList.contains("dark")).toBe(false);
		expect(root.style.getPropertyValue("--accent")).toBe(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme.accentColor);
	});
});
