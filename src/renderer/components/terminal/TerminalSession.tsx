import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import { getErrorMessage } from "../../../shared/errors.ts";
import type { SerializedTerminalEvent } from "../../../shared/serialized-terminal-event.ts";
import type { DesktopTerminalSource } from "../../../shared/types.ts";
import { useSubscribedResource } from "../../hooks/use-subscribed-resource.ts";
import { markRendererPerformance, measureRendererPerformance } from "../../lib/performance-marks.ts";
import { observeElementResize } from "../../lib/resize-observer.ts";

const FALLBACK_TERMINAL_SIZE = { cols: 80, rows: 24 };
const FALLBACK_TERMINAL_FONT_FAMILY =
	'"SFMono-Regular", "SF Mono", ui-monospace, Menlo, Consolas, "JetBrains Mono", "Jetbrains Mono", "Liberation Mono", "Courier New", monospace';
const FALLBACK_TERMINAL_FONT_SIZE = 12;

type TerminalThemeColorKey =
	| "foreground"
	| "background"
	| "cursor"
	| "cursorAccent"
	| "selectionBackground"
	| "black"
	| "red"
	| "green"
	| "yellow"
	| "blue"
	| "magenta"
	| "cyan"
	| "white"
	| "brightBlack"
	| "brightRed"
	| "brightGreen"
	| "brightYellow"
	| "brightBlue"
	| "brightMagenta"
	| "brightCyan"
	| "brightWhite";

const TERMINAL_THEME_VARIABLES: Record<TerminalThemeColorKey, string> = {
	background: "--terminal-background",
	black: "--terminal-ansi-black",
	blue: "--terminal-ansi-blue",
	brightBlack: "--terminal-ansi-bright-black",
	brightBlue: "--terminal-ansi-bright-blue",
	brightCyan: "--terminal-ansi-bright-cyan",
	brightGreen: "--terminal-ansi-bright-green",
	brightMagenta: "--terminal-ansi-bright-magenta",
	brightRed: "--terminal-ansi-bright-red",
	brightWhite: "--terminal-ansi-bright-white",
	brightYellow: "--terminal-ansi-bright-yellow",
	cursor: "--terminal-cursor",
	cursorAccent: "--terminal-cursor-accent",
	cyan: "--terminal-ansi-cyan",
	foreground: "--terminal-foreground",
	green: "--terminal-ansi-green",
	magenta: "--terminal-ansi-magenta",
	red: "--terminal-ansi-red",
	selectionBackground: "--terminal-selection-background",
	white: "--terminal-ansi-white",
	yellow: "--terminal-ansi-yellow",
};

const FALLBACK_TERMINAL_THEME: Record<TerminalThemeColorKey, string> = {
	background: "#f8fafc",
	black: "#1f2937",
	blue: "#2563eb",
	brightBlack: "#64748b",
	brightBlue: "#3b82f6",
	brightCyan: "#06b6d4",
	brightGreen: "#16a34a",
	brightMagenta: "#d946ef",
	brightRed: "#ef4444",
	brightWhite: "#f8fafc",
	brightYellow: "#eab308",
	cursor: "#2563eb",
	cursorAccent: "#f8fafc",
	cyan: "#0891b2",
	foreground: "#111827",
	green: "#15803d",
	magenta: "#c026d3",
	red: "#dc2626",
	selectionBackground: "rgba(37, 99, 235, 0.22)",
	white: "#e5e7eb",
	yellow: "#ca8a04",
};

interface TerminalSize {
	cols: number;
	rows: number;
}

export interface TerminalSessionProps {
	isActive: boolean;
	isPanelOpen: boolean;
	onErrorMessageChange: (message: string | undefined) => void;
	onExitMessageChange: (message: string | undefined) => void;
	restartToken: number;
	sessionId: string;
	source: DesktopTerminalSource;
	terminalId: string;
}

function getTerminalSize(terminal: Terminal): TerminalSize {
	const cols = terminal.cols > 0 ? terminal.cols : FALLBACK_TERMINAL_SIZE.cols;
	const rows = terminal.rows > 0 ? terminal.rows : FALLBACK_TERMINAL_SIZE.rows;
	return { cols, rows };
}

function formatExit(exitCode: number, signal?: number): string {
	return signal !== undefined ? `process exited with signal ${signal}` : `process exited with code ${exitCode}`;
}

function resolveThemeColor(container: HTMLElement, variableName: string, fallback: string): string {
	const { ownerDocument } = container;
	const probe = ownerDocument.createElement("span");
	probe.style.color = `var(${variableName})`;
	probe.style.pointerEvents = "none";
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	(ownerDocument.body ?? container).append(probe);
	const color = ownerDocument.defaultView?.getComputedStyle(probe).color;
	probe.remove();
	return color && color.trim().length > 0 ? color : fallback;
}

function getTerminalTheme(container: HTMLElement): ITheme {
	const theme: ITheme = {};
	for (const key of Object.keys(TERMINAL_THEME_VARIABLES) as TerminalThemeColorKey[]) {
		theme[key] = resolveThemeColor(container, TERMINAL_THEME_VARIABLES[key], FALLBACK_TERMINAL_THEME[key]);
	}
	return theme;
}

function getTerminalFontSize(container: HTMLElement): number {
	const root = container.ownerDocument.documentElement;
	const rawValue = container.ownerDocument.defaultView
		?.getComputedStyle(root)
		.getPropertyValue("--desktop-code-font-size")
		.trim();
	const fontSize = rawValue ? Number.parseFloat(rawValue) : Number.NaN;
	return Number.isFinite(fontSize) && fontSize > 0 ? fontSize : FALLBACK_TERMINAL_FONT_SIZE;
}

function normalizeCssValue(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function getRootCssProperty(container: HTMLElement, variableName: string): string | undefined {
	const root = container.ownerDocument.documentElement;
	const value = container.ownerDocument.defaultView?.getComputedStyle(root).getPropertyValue(variableName);
	const normalizedValue = normalizeCssValue(value ?? "");
	return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function resolveRootCssValue(
	container: HTMLElement,
	rawValue: string | undefined,
	visitedVariables = new Set<string>(),
): string | undefined {
	const value = normalizeCssValue(rawValue ?? "");
	if (value.length === 0) {
		return undefined;
	}

	const variableMatch = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)$/.exec(value);
	if (!variableMatch) {
		return value;
	}

	const [, variableName, fallbackValue] = variableMatch;
	if (!visitedVariables.has(variableName)) {
		visitedVariables.add(variableName);
		const resolvedVariableValue = resolveRootCssValue(
			container,
			getRootCssProperty(container, variableName),
			visitedVariables,
		);
		if (resolvedVariableValue) {
			return resolvedVariableValue;
		}
	}

	return resolveRootCssValue(container, fallbackValue, visitedVariables);
}

function getTerminalFontFamily(container: HTMLElement): string {
	return (
		resolveRootCssValue(container, getRootCssProperty(container, "--desktop-code-font-family")) ??
		resolveRootCssValue(container, getRootCssProperty(container, "--font-mono")) ??
		FALLBACK_TERMINAL_FONT_FAMILY
	);
}

export function TerminalSession({
	isActive,
	isPanelOpen,
	onErrorMessageChange,
	onExitMessageChange,
	restartToken,
	sessionId,
	source,
	terminalId,
}: TerminalSessionProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const lastSizeRef = useRef<TerminalSize | undefined>(undefined);
	const hasCreatedPtyRef = useRef(false);
	const canResizeRef = useRef(false);
	const onErrorMessageChangeRef = useRef(onErrorMessageChange);
	const onExitMessageChangeRef = useRef(onExitMessageChange);

	canResizeRef.current = isActive && isPanelOpen;

	useEffect(() => {
		onErrorMessageChangeRef.current = onErrorMessageChange;
		onExitMessageChangeRef.current = onExitMessageChange;
	}, [onErrorMessageChange, onExitMessageChange]);

	const recordError = useCallback((error: unknown) => {
		onErrorMessageChangeRef.current(getErrorMessage(error));
	}, []);

	const applyTerminalAppearance = useCallback(() => {
		const container = containerRef.current;
		const terminal = terminalRef.current;
		if (!container || !terminal) {
			return;
		}

		terminal.options.theme = getTerminalTheme(container);
		terminal.options.fontFamily = getTerminalFontFamily(container);
		terminal.options.fontSize = getTerminalFontSize(container);
	}, []);

	const fitAndResize = useCallback(
		(options: { focus?: boolean } = {}) => {
			const terminal = terminalRef.current;
			const fitAddon = fitAddonRef.current;
			if (!terminal || !fitAddon || !canResizeRef.current) {
				return;
			}

			try {
				fitAddon.fit();
			} catch {
				return;
			}

			const nextSize = getTerminalSize(terminal);
			const previousSize = lastSizeRef.current;
			lastSizeRef.current = nextSize;
			if (
				hasCreatedPtyRef.current &&
				(!previousSize || previousSize.cols !== nextSize.cols || previousSize.rows !== nextSize.rows)
			) {
				void window.desktopAgent.resizeTerminal({ ...nextSize, terminalId }).catch(recordError);
			}

			if (options.focus) {
				terminal.focus();
			}
		},
		[recordError, terminalId],
	);

	useEffect(() => {
		if (isActive && isPanelOpen) {
			applyTerminalAppearance();
			fitAndResize({ focus: true });
		}
	}, [applyTerminalAppearance, fitAndResize, isActive, isPanelOpen]);

	useSubscribedResource<SerializedTerminalEvent>(
		(onEvent) => window.desktopAgent.subscribeToTerminalEvents(onEvent),
		(event) => {
			if (event.sessionId !== sessionId || event.terminalId !== terminalId) {
				return;
			}

			const terminal = terminalRef.current;
			if (!terminal) {
				return;
			}
			if (event.type === "terminal_data") {
				terminal.write(event.data);
				return;
			}

			const nextExitMessage = formatExit(event.exitCode, event.signal);
			onExitMessageChangeRef.current(nextExitMessage);
			terminal.write(`\r\n[${nextExitMessage}]\r\n`);
		},
		[sessionId, terminalId],
	);

	useEffect(() => {
		void restartToken;
		const container = containerRef.current;
		if (!container) {
			return;
		}

		const terminal = new Terminal({
			convertEol: true,
			cursorBlink: true,
			fontFamily: getTerminalFontFamily(container),
			fontSize: getTerminalFontSize(container),
			lineHeight: 1.25,
			scrollback: 4000,
			theme: getTerminalTheme(container),
		});
		const fitAddon = new FitAddon();
		let isDisposed = false;

		onErrorMessageChangeRef.current(undefined);
		onExitMessageChangeRef.current(undefined);
		lastSizeRef.current = undefined;
		hasCreatedPtyRef.current = false;
		terminalRef.current = terminal;
		fitAddonRef.current = fitAddon;
		terminal.loadAddon(fitAddon);
		terminal.open(container);

		const recordActiveError = (error: unknown) => {
			if (!isDisposed) {
				recordError(error);
			}
		};

		const terminalDataDisposable = terminal.onData((data) => {
			if (source.type !== "environment_resource") {
				void window.desktopAgent.writeTerminal({ data, terminalId }).catch(recordActiveError);
			}
		});

		fitAndResize();
		const initialSize = getTerminalSize(terminal);
		lastSizeRef.current = initialSize;
		markRendererPerformance("renderer:terminal:open:start");
		void window.desktopAgent
			.createTerminal({
				...initialSize,
				sessionId,
				source,
				terminalId,
			})
			.then(() => {
				hasCreatedPtyRef.current = true;
				fitAndResize({ focus: true });
			})
			.catch(recordActiveError)
			.finally(() => {
				markRendererPerformance("renderer:terminal:open:end");
				measureRendererPerformance(
					"renderer terminal open",
					"renderer:terminal:open:start",
					"renderer:terminal:open:end",
				);
			});

		const cleanupResizeObserver = observeElementResize(container, fitAndResize, { notifyImmediately: false });

		const themeObserver =
			typeof MutationObserver === "undefined"
				? undefined
				: new MutationObserver(() => {
						applyTerminalAppearance();
						fitAndResize();
					});
		themeObserver?.observe(container.ownerDocument.documentElement, {
			attributeFilter: ["class", "data-desktop-appearance-customized", "data-desktop-sidebar-translucent", "style"],
			attributes: true,
		});

		return () => {
			isDisposed = true;
			cleanupResizeObserver();
			themeObserver?.disconnect();
			terminalDataDisposable.dispose();
			terminal.dispose();
			if (terminalRef.current === terminal) {
				terminalRef.current = null;
				fitAddonRef.current = null;
				hasCreatedPtyRef.current = false;
			}
			void window.desktopAgent.disposeTerminal({ terminalId }).catch(() => undefined);
		};
	}, [applyTerminalAppearance, fitAndResize, recordError, restartToken, sessionId, source, terminalId]);

	return (
		<div
			className="h-full min-h-0 bg-[color:var(--terminal-background)] px-4 pt-2 pb-4"
			data-slot="terminal-viewport-shell"
		>
			<div className="h-full min-h-0 w-full overflow-hidden" data-slot="terminal-viewport" ref={containerRef} />
		</div>
	);
}
