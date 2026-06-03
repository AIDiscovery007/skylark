import { nativeTheme, systemPreferences } from "electron";
import type { DesktopNativeAppearance } from "../../shared/types.ts";

const DEFAULT_ACCENT_COLOR = "#0a84ff";

export interface NativeThemeSnapshot {
	inForcedColorsMode: boolean;
	prefersReducedTransparency: boolean;
	shouldUseDarkColors: boolean;
	shouldUseHighContrastColors: boolean;
	shouldUseInvertedColorScheme: boolean;
}

export interface SystemPreferencesSnapshot {
	getAccentColor(): string;
}

export function normalizeNativeAccentColor(value: string): string {
	const normalized = value.trim().replace(/^#/, "").toLowerCase();
	return /^[0-9a-f]{6}$/.test(normalized) ? `#${normalized}` : DEFAULT_ACCENT_COLOR;
}

export function createDesktopNativeAppearance(
	theme: NativeThemeSnapshot = nativeTheme,
	preferences: SystemPreferencesSnapshot = systemPreferences,
): DesktopNativeAppearance {
	let accentColor = DEFAULT_ACCENT_COLOR;
	try {
		accentColor = normalizeNativeAccentColor(preferences.getAccentColor());
	} catch {
		accentColor = DEFAULT_ACCENT_COLOR;
	}

	return {
		accentColor,
		colorScheme: theme.shouldUseDarkColors ? "dark" : "light",
		forcedColors: theme.inForcedColorsMode,
		highContrast: theme.shouldUseHighContrastColors,
		invertedColors: theme.shouldUseInvertedColorScheme,
		reducedTransparency: theme.prefersReducedTransparency,
	};
}
