import type { DesktopNativeAppearance, DesktopSettingsData, DesktopThemePalette } from "../../shared/types.ts";

const CUSTOM_THEME_PROPERTIES = [
	"--accent",
	"--background",
	"--foreground",
	"--desktop-ui-font-family",
	"--desktop-code-font-family",
	"--desktop-ui-font-size",
	"--desktop-code-font-size",
	"--appearance-surface-1-mix",
	"--appearance-surface-2-mix",
	"--appearance-surface-3-mix",
	"--appearance-border-subtle-mix",
	"--appearance-border-strong-mix",
] as const;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function formatPercent(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}%`;
}

function setContrastVariables(root: HTMLElement, contrast: number): void {
	const delta = clamp(contrast, 0, 100) - 50;
	root.style.setProperty("--appearance-surface-1-mix", formatPercent(clamp(2 + delta * 0.04, 0, 12)));
	root.style.setProperty("--appearance-surface-2-mix", formatPercent(clamp(4 + delta * 0.08, 0, 18)));
	root.style.setProperty("--appearance-surface-3-mix", formatPercent(clamp(7 + delta * 0.12, 0, 24)));
	root.style.setProperty("--appearance-border-subtle-mix", formatPercent(clamp(10 + delta * 0.2, 0, 28)));
	root.style.setProperty("--appearance-border-strong-mix", formatPercent(clamp(15 + delta * 0.3, 0, 36)));
}

function clearCustomTheme(root: HTMLElement): void {
	for (const property of CUSTOM_THEME_PROPERTIES) {
		root.style.removeProperty(property);
	}
	root.dataset.desktopAppearanceCustomized = "false";
	delete root.dataset.desktopSidebarTranslucent;
}

function applyPalette(root: HTMLElement, palette: DesktopThemePalette): void {
	root.style.setProperty("--accent", palette.accentColor);
	root.style.setProperty("--background", palette.backgroundColor);
	root.style.setProperty("--foreground", palette.foregroundColor);
	root.style.setProperty("--desktop-ui-font-family", palette.uiFontFamily);
	root.style.setProperty("--desktop-code-font-family", palette.codeFontFamily);
	setContrastVariables(root, palette.contrast);
	root.dataset.desktopAppearanceCustomized = "true";
	root.dataset.desktopSidebarTranslucent = String(palette.translucentSidebar);
}

function applyFontSizes(root: HTMLElement, settings: NonNullable<DesktopSettingsData["appearance"]>): void {
	root.style.setProperty("--desktop-ui-font-size", `${settings.uiFontSize}px`);
	root.style.setProperty("--desktop-code-font-size", `${settings.codeFontSize}px`);
}

export function applyDesktopAppearanceTheme(
	root: HTMLElement,
	settings: Pick<DesktopSettingsData, "appearance">,
	nativeAppearance: DesktopNativeAppearance,
): void {
	root.style.setProperty("--system-accent", nativeAppearance.accentColor);
	root.dataset.nativeHighContrast = String(nativeAppearance.highContrast || nativeAppearance.forcedColors);
	root.dataset.nativeReducedTransparency = String(nativeAppearance.reducedTransparency);

	const appearance = settings.appearance;
	if (!appearance) {
		root.classList.toggle("dark", nativeAppearance.colorScheme === "dark");
		clearCustomTheme(root);
		return;
	}

	const resolvedScheme = appearance.themeMode === "system" ? nativeAppearance.colorScheme : appearance.themeMode;
	root.classList.toggle("dark", resolvedScheme === "dark");
	applyPalette(root, resolvedScheme === "dark" ? appearance.darkTheme : appearance.lightTheme);
	applyFontSizes(root, appearance);
}
