import { Code2, Contrast, Palette, PanelLeft, Type } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
	type DesktopAppearanceSettings,
	type DesktopSettingsData,
	type DesktopThemeMode,
	type DesktopThemePalette,
} from "../../../shared/types.ts";
import { SettingsGroup, SettingsRow } from "./SettingsList.tsx";

const THEME_MODE_LABELS: Record<DesktopThemeMode, string> = {
	light: "浅色",
	dark: "深色",
	system: "系统",
};
const MIN_APPEARANCE_FONT_SIZE = 10;
const MAX_APPEARANCE_FONT_SIZE = 20;

interface AppearanceSettingsProps {
	settings: DesktopSettingsData;
	isLoading: boolean;
	onSave: (settings: DesktopAppearanceSettings) => Promise<void>;
}

interface PaletteEditorProps {
	label: string;
	palette: DesktopThemePalette;
	onChange: (palette: DesktopThemePalette) => void;
}

interface ColorHuntPreset {
	label: string;
	code: string;
	swatches: [string, string, string, string];
	lightTheme: DesktopThemePalette;
	darkTheme: DesktopThemePalette;
}

function themePalette(
	base: DesktopThemePalette,
	colors: Pick<DesktopThemePalette, "accentColor" | "backgroundColor" | "foregroundColor" | "contrast">,
): DesktopThemePalette {
	return { ...base, ...colors };
}

const COLOR_HUNT_PRESETS: ColorHuntPreset[] = [
	{
		label: "Color Hunt 01",
		code: "f9f8f6efe9e3d9cfc7c9b59c",
		swatches: ["#f9f8f6", "#efe9e3", "#d9cfc7", "#c9b59c"],
		lightTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme, {
			accentColor: "#c9b59c",
			backgroundColor: "#f9f8f6",
			foregroundColor: "#3d342d",
			contrast: 50,
		}),
		darkTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme, {
			accentColor: "#d9cfc7",
			backgroundColor: "#2f2924",
			foregroundColor: "#f9f8f6",
			contrast: 58,
		}),
	},
	{
		label: "Color Hunt 02",
		code: "0f28541c4d8d4988c4bde8f5",
		swatches: ["#0f2854", "#1c4d8d", "#4988c4", "#bde8f5"],
		lightTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme, {
			accentColor: "#1c4d8d",
			backgroundColor: "#bde8f5",
			foregroundColor: "#0f2854",
			contrast: 54,
		}),
		darkTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme, {
			accentColor: "#4988c4",
			backgroundColor: "#0f2854",
			foregroundColor: "#bde8f5",
			contrast: 60,
		}),
	},
	{
		label: "Color Hunt 03",
		code: "fcf5eeffc4c4ee6983850e35",
		swatches: ["#fcf5ee", "#ffc4c4", "#ee6983", "#850e35"],
		lightTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme, {
			accentColor: "#ee6983",
			backgroundColor: "#fcf5ee",
			foregroundColor: "#850e35",
			contrast: 52,
		}),
		darkTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme, {
			accentColor: "#ee6983",
			backgroundColor: "#850e35",
			foregroundColor: "#fcf5ee",
			contrast: 60,
		}),
	},
	{
		label: "Color Hunt 04",
		code: "efece38fabd44a70a9000000",
		swatches: ["#efece3", "#8fabd4", "#4a70a9", "#000000"],
		lightTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme, {
			accentColor: "#4a70a9",
			backgroundColor: "#efece3",
			foregroundColor: "#000000",
			contrast: 50,
		}),
		darkTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme, {
			accentColor: "#8fabd4",
			backgroundColor: "#000000",
			foregroundColor: "#efece3",
			contrast: 62,
		}),
	},
	{
		label: "Color Hunt 05",
		code: "21344854779294b4c1eae0cf",
		swatches: ["#213448", "#547792", "#94b4c1", "#eae0cf"],
		lightTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme, {
			accentColor: "#547792",
			backgroundColor: "#eae0cf",
			foregroundColor: "#213448",
			contrast: 52,
		}),
		darkTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme, {
			accentColor: "#94b4c1",
			backgroundColor: "#213448",
			foregroundColor: "#eae0cf",
			contrast: 58,
		}),
	},
	{
		label: "Color Hunt 06",
		code: "3558727aaace9cd5fff7f8f0",
		swatches: ["#355872", "#7aaace", "#9cd5ff", "#f7f8f0"],
		lightTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme, {
			accentColor: "#7aaace",
			backgroundColor: "#f7f8f0",
			foregroundColor: "#355872",
			contrast: 52,
		}),
		darkTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme, {
			accentColor: "#9cd5ff",
			backgroundColor: "#355872",
			foregroundColor: "#f7f8f0",
			contrast: 58,
		}),
	},
	{
		label: "Color Hunt 07",
		code: "113f6734699a58a0c8fdf5aa",
		swatches: ["#113f67", "#34699a", "#58a0c8", "#fdf5aa"],
		lightTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme, {
			accentColor: "#34699a",
			backgroundColor: "#fdf5aa",
			foregroundColor: "#113f67",
			contrast: 54,
		}),
		darkTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme, {
			accentColor: "#58a0c8",
			backgroundColor: "#113f67",
			foregroundColor: "#fdf5aa",
			contrast: 60,
		}),
	},
	{
		label: "Color Hunt 08",
		code: "222831393e46948979dfd0b8",
		swatches: ["#222831", "#393e46", "#948979", "#dfd0b8"],
		lightTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme, {
			accentColor: "#948979",
			backgroundColor: "#dfd0b8",
			foregroundColor: "#222831",
			contrast: 54,
		}),
		darkTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme, {
			accentColor: "#948979",
			backgroundColor: "#222831",
			foregroundColor: "#dfd0b8",
			contrast: 60,
		}),
	},
	{
		label: "Color Hunt 09",
		code: "181c143c3d37697565ecdfcc",
		swatches: ["#181c14", "#3c3d37", "#697565", "#ecdfcc"],
		lightTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme, {
			accentColor: "#697565",
			backgroundColor: "#ecdfcc",
			foregroundColor: "#181c14",
			contrast: 54,
		}),
		darkTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme, {
			accentColor: "#697565",
			backgroundColor: "#181c14",
			foregroundColor: "#ecdfcc",
			contrast: 60,
		}),
	},
	{
		label: "Color Hunt 10",
		code: "02152603346e6eacdae2e2b6",
		swatches: ["#021526", "#03346e", "#6eacda", "#e2e2b6"],
		lightTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme, {
			accentColor: "#6eacda",
			backgroundColor: "#e2e2b6",
			foregroundColor: "#021526",
			contrast: 54,
		}),
		darkTheme: themePalette(DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme, {
			accentColor: "#6eacda",
			backgroundColor: "#021526",
			foregroundColor: "#e2e2b6",
			contrast: 60,
		}),
	},
];

function normalizeHexColor(value: string): string {
	return value.trim().toLowerCase();
}

function isValidHexColor(value: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function isValidFontFamily(value: string): boolean {
	const fontFamily = value.trim();
	return fontFamily.length > 0 && !/[\u0000-\u001f\u007f;{}]/u.test(fontFamily);
}

function normalizeFontFamily(value: string): string {
	return value.trim();
}

function normalizeContrast(value: string | number): number {
	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numericValue)) {
		return 50;
	}
	return Math.min(100, Math.max(0, Math.round(numericValue)));
}

function normalizeFontSize(value: string | number, fallback: number): number {
	const numericValue = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numericValue)) {
		return fallback;
	}
	return Math.min(MAX_APPEARANCE_FONT_SIZE, Math.max(MIN_APPEARANCE_FONT_SIZE, Math.round(numericValue)));
}

function normalizePalette(palette: DesktopThemePalette): DesktopThemePalette {
	return {
		accentColor: normalizeHexColor(palette.accentColor),
		backgroundColor: normalizeHexColor(palette.backgroundColor),
		foregroundColor: normalizeHexColor(palette.foregroundColor),
		uiFontFamily: normalizeFontFamily(palette.uiFontFamily),
		codeFontFamily: normalizeFontFamily(palette.codeFontFamily),
		translucentSidebar: palette.translucentSidebar,
		contrast: normalizeContrast(palette.contrast),
	};
}

function normalizeAppearance(settings: DesktopAppearanceSettings): DesktopAppearanceSettings {
	return {
		themeMode: settings.themeMode,
		uiFontSize: normalizeFontSize(settings.uiFontSize, DEFAULT_DESKTOP_APPEARANCE_SETTINGS.uiFontSize),
		codeFontSize: normalizeFontSize(settings.codeFontSize, DEFAULT_DESKTOP_APPEARANCE_SETTINGS.codeFontSize),
		lightTheme: normalizePalette(settings.lightTheme),
		darkTheme: normalizePalette(settings.darkTheme),
	};
}

function hasInvalidColor(palette: DesktopThemePalette): boolean {
	return (
		!isValidHexColor(palette.accentColor) ||
		!isValidHexColor(palette.backgroundColor) ||
		!isValidHexColor(palette.foregroundColor)
	);
}

function hasInvalidPaletteInput(palette: DesktopThemePalette): boolean {
	return (
		hasInvalidColor(palette) || !isValidFontFamily(palette.uiFontFamily) || !isValidFontFamily(palette.codeFontFamily)
	);
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	const color = isValidHexColor(value) ? normalizeHexColor(value) : "transparent";

	return (
		<div className="flex items-center gap-2">
			<span
				aria-hidden="true"
				className="size-5 shrink-0 rounded-full border border-[color:var(--border-subtle)]"
				style={{ backgroundColor: color }}
			/>
			<Input
				aria-label={label}
				className="h-9 font-mono"
				onChange={(event) => onChange(event.currentTarget.value)}
				value={value}
			/>
		</div>
	);
}

function FontSizeInput({
	label,
	value,
	onChange,
}: {
	label: string;
	value: number;
	onChange: (value: number) => void;
}) {
	return (
		<div className="flex items-center gap-2">
			<Input
				aria-label={label}
				className="h-9 text-right tabular-nums"
				max={MAX_APPEARANCE_FONT_SIZE}
				min={MIN_APPEARANCE_FONT_SIZE}
				onChange={(event) => onChange(normalizeFontSize(event.currentTarget.value, value))}
				step={1}
				type="number"
				value={value}
			/>
			<span className="w-6 shrink-0 text-muted-foreground">px</span>
		</div>
	);
}

function ColorHuntPresetPicker({ onSelect }: { onSelect: (preset: ColorHuntPreset) => void }) {
	return (
		<SettingsGroup>
			<SettingsRow
				description="从 Color Hunt 选出的 10 套配色；点击后会立即应用到浅色和深色主题。"
				icon={Palette}
				layout="stacked"
				title="Color Hunt 配色"
			>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
					{COLOR_HUNT_PRESETS.map((preset, index) => (
						<Button
							aria-label={`应用 Color Hunt 配色 ${String(index + 1).padStart(2, "0")}`}
							className="h-14 min-w-0 flex-col items-stretch gap-1.5 overflow-hidden rounded-lg p-1.5"
							key={preset.code}
							onClick={() => onSelect(preset)}
							title={`https://colorhunt.co/palette/${preset.code}`}
							type="button"
							variant="outline"
						>
							<span
								aria-hidden="true"
								className="grid h-6 w-full grid-cols-4 overflow-hidden rounded-md border border-border/60"
							>
								{preset.swatches.map((swatch) => (
									<span key={swatch} style={{ backgroundColor: swatch }} />
								))}
							</span>
							<span className="truncate text-[11px] leading-4 text-muted-foreground">{preset.label}</span>
						</Button>
					))}
				</div>
			</SettingsRow>
		</SettingsGroup>
	);
}

function PaletteEditor({ label, palette, onChange }: PaletteEditorProps) {
	const updatePalette = (changes: Partial<DesktopThemePalette>): void => {
		onChange({ ...palette, ...changes });
	};

	return (
		<SettingsGroup>
			<div className="border-b border-border/65 px-5 py-3">
				<p className="text-[13px] font-semibold leading-5 text-foreground">{label}</p>
			</div>
			<SettingsRow
				contentClassName="w-full sm:w-[280px]"
				description="用于按钮、焦点、链接和运行状态的主强调色。"
				icon={Palette}
				id={`${label}-accent`}
				title="强调色"
			>
				<ColorInput
					label={`${label}强调色`}
					onChange={(value) => updatePalette({ accentColor: value })}
					value={palette.accentColor}
				/>
			</SettingsRow>
			<SettingsRow
				contentClassName="w-full sm:w-[280px]"
				description="应用窗口和主工作区的基础底色。"
				icon={Palette}
				id={`${label}-background`}
				title="背景"
			>
				<ColorInput
					label={`${label}背景`}
					onChange={(value) => updatePalette({ backgroundColor: value })}
					value={palette.backgroundColor}
				/>
			</SettingsRow>
			<SettingsRow
				contentClassName="w-full sm:w-[280px]"
				description="正文、标题和主要控件文本颜色。"
				icon={Palette}
				id={`${label}-foreground`}
				title="前景"
			>
				<ColorInput
					label={`${label}前景`}
					onChange={(value) => updatePalette({ foregroundColor: value })}
					value={palette.foregroundColor}
				/>
			</SettingsRow>
			<SettingsRow
				contentClassName="w-full sm:w-[280px]"
				description="普通界面文本使用的字体栈。"
				icon={Type}
				id={`${label}-ui-font`}
				title="UI 字体"
			>
				<Input
					aria-label={`${label}UI 字体`}
					className="h-9"
					onChange={(event) => updatePalette({ uiFontFamily: event.currentTarget.value })}
					value={palette.uiFontFamily}
				/>
			</SettingsRow>
			<SettingsRow
				contentClassName="w-full sm:w-[280px]"
				description="代码块、终端和行内代码使用的字体栈。"
				icon={Code2}
				id={`${label}-code-font`}
				title="代码字体"
			>
				<Input
					aria-label={`${label}代码字体`}
					className="h-9"
					onChange={(event) => updatePalette({ codeFontFamily: event.currentTarget.value })}
					value={palette.codeFontFamily}
				/>
			</SettingsRow>
			<SettingsRow
				contentClassName="flex justify-start sm:justify-end"
				description="打开后侧栏会从主题背景中混入透明度，保留 macOS 桌面感。"
				icon={PanelLeft}
				id={`${label}-translucent-sidebar`}
				title="半透明侧边栏"
			>
				<Switch
					checked={palette.translucentSidebar}
					id={`${label}-translucent-sidebar`}
					onCheckedChange={(value: boolean) => updatePalette({ translucentSidebar: value })}
				/>
			</SettingsRow>
			<SettingsRow
				contentClassName="w-full sm:w-[120px]"
				description="调高会增强边框、分隔和层级差异。"
				icon={Contrast}
				id={`${label}-contrast`}
				title="对比度"
			>
				<Input
					aria-label={`${label}对比度`}
					className="h-9"
					max={100}
					min={0}
					onChange={(event) => updatePalette({ contrast: normalizeContrast(event.currentTarget.value) })}
					type="number"
					value={palette.contrast}
				/>
			</SettingsRow>
		</SettingsGroup>
	);
}

export function AppearanceSettings({ settings, isLoading, onSave }: AppearanceSettingsProps) {
	const [appearance, setAppearance] = useState<DesktopAppearanceSettings>(
		settings.appearance ?? DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
	);

	useEffect(() => {
		setAppearance(settings.appearance ?? DEFAULT_DESKTOP_APPEARANCE_SETTINGS);
	}, [settings.appearance]);

	const persistedAppearance = useMemo(
		() => normalizeAppearance(settings.appearance ?? DEFAULT_DESKTOP_APPEARANCE_SETTINGS),
		[settings.appearance],
	);

	const commitAppearance = (nextAppearance: DesktopAppearanceSettings): void => {
		setAppearance(nextAppearance);
		if (hasInvalidPaletteInput(nextAppearance.lightTheme) || hasInvalidPaletteInput(nextAppearance.darkTheme)) {
			return;
		}
		const normalizedNextAppearance = normalizeAppearance(nextAppearance);
		if (JSON.stringify(normalizedNextAppearance) === JSON.stringify(persistedAppearance)) {
			return;
		}
		void onSave(normalizedNextAppearance);
	};

	if (isLoading) {
		return (
			<SettingsGroup>
				<div className="space-y-4 px-5 py-5">
					<Skeleton className="h-5 w-40" />
					<Skeleton className="h-10 w-full rounded-lg" />
					<Skeleton className="h-10 w-full rounded-lg" />
					<Skeleton className="h-10 w-full rounded-lg" />
				</div>
			</SettingsGroup>
		);
	}

	return (
		<div className="space-y-4">
			<SettingsGroup>
				<SettingsRow
					contentClassName="w-full sm:w-[280px]"
					description="选择固定浅色、固定深色，或跟随系统外观。"
					icon={Palette}
					id="appearance-theme-mode"
					title="主题"
				>
					<Select
						onValueChange={(value: string) =>
							commitAppearance({ ...appearance, themeMode: value as DesktopThemeMode })
						}
						value={appearance.themeMode}
					>
						<SelectTrigger className="h-9 w-full rounded-lg bg-background/80" id="appearance-theme-mode">
							<SelectValue placeholder="选择主题" />
						</SelectTrigger>
						<SelectContent>
							{Object.entries(THEME_MODE_LABELS).map(([value, label]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow
					contentClassName="w-full sm:w-[160px]"
					description="调整 Skylark UI 使用的基准字号。"
					icon={Type}
					id="appearance-ui-font-size"
					title="UI 字号"
				>
					<FontSizeInput
						label="UI 字号"
						onChange={(uiFontSize) => commitAppearance({ ...appearance, uiFontSize })}
						value={appearance.uiFontSize}
					/>
				</SettingsRow>
				<SettingsRow
					contentClassName="w-full sm:w-[160px]"
					description="调整聊天、差异视图和代码块使用的基础字号。"
					icon={Code2}
					id="appearance-code-font-size"
					title="代码字体大小"
				>
					<FontSizeInput
						label="代码字体大小"
						onChange={(codeFontSize) => commitAppearance({ ...appearance, codeFontSize })}
						value={appearance.codeFontSize}
					/>
				</SettingsRow>
			</SettingsGroup>
			<ColorHuntPresetPicker
				onSelect={(preset) =>
					commitAppearance({
						...appearance,
						lightTheme: preset.lightTheme,
						darkTheme: preset.darkTheme,
					})
				}
			/>
			<PaletteEditor
				label="浅色主题"
				onChange={(lightTheme) => commitAppearance({ ...appearance, lightTheme })}
				palette={appearance.lightTheme}
			/>
			<PaletteEditor
				label="深色主题"
				onChange={(darkTheme) => commitAppearance({ ...appearance, darkTheme })}
				palette={appearance.darkTheme}
			/>
		</div>
	);
}
