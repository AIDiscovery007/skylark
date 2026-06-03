import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TmuxDiscoveredSession, TmuxDiscoveredWindow } from "./environment-resource-store.ts";

const execFileAsync = promisify(execFile);
const TMUX_ISOLATED_CONFIG_ARGS = ["-f", "/dev/null"] as const;
const FIELD_DELIMITER = "__SKYLARK_ENV_FIELD_DELIMITER__";
const PANE_FORMAT = ["#{window_name}", "#{pane_id}", "#{pane_current_command}", "#{pane_current_path}"].join(
	FIELD_DELIMITER,
);
const SKYLARK_TMUX_OPTIONS = [
	"@skylark-session-id",
	"@skylark-cwd",
	"@skylark-title",
	"@skylark-resource-kind",
] as const;
const LEGACY_PI_TMUX_OPTIONS = ["@pi-session-id", "@pi-cwd", "@pi-title", "@pi-resource-kind"] as const;
const TMUX_OPTIONS = [...SKYLARK_TMUX_OPTIONS, ...LEGACY_PI_TMUX_OPTIONS] as const;

type TmuxOption = (typeof TMUX_OPTIONS)[number];

export interface TmuxEnvironmentInspector {
	discover(): Promise<TmuxDiscoveredSession[]>;
}

export type TmuxCommandRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

async function defaultRunTmux(args: string[]): Promise<{ stdout: string; stderr: string }> {
	const { stdout, stderr } = await execFileAsync("tmux", [...TMUX_ISOLATED_CONFIG_ARGS, ...args], {
		maxBuffer: 8 * 1024 * 1024,
		timeout: 10_000,
		windowsHide: true,
	});
	return { stdout, stderr };
}

function getErrorCode(error: unknown): number | string | undefined {
	if (typeof error === "object" && error !== null && "code" in error) {
		const code = (error as { code?: unknown }).code;
		if (typeof code === "number" || typeof code === "string") {
			return code;
		}
	}
	return undefined;
}

function isExpectedMissingTmuxState(error: unknown): boolean {
	const code = getErrorCode(error);
	return code === "ENOENT" || typeof code === "number";
}

function splitLines(output: string): string[] {
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function parsePaneList(output: string): TmuxDiscoveredWindow[] {
	const windowsByName = new Map<string, TmuxDiscoveredWindow>();
	for (const line of splitLines(output)) {
		const [windowName = "", paneId = "", currentCommand = "", currentPath = ""] = line.split(FIELD_DELIMITER);
		if (!windowName || windowsByName.has(windowName)) {
			continue;
		}
		windowsByName.set(windowName, {
			windowName,
			...(paneId ? { paneId } : {}),
			...(currentCommand ? { currentCommand } : {}),
			...(currentPath ? { currentPath } : {}),
		});
	}
	return [...windowsByName.values()];
}

export class DefaultTmuxEnvironmentInspector implements TmuxEnvironmentInspector {
	constructor(private readonly runTmux: TmuxCommandRunner = defaultRunTmux) {}

	async discover(): Promise<TmuxDiscoveredSession[]> {
		const sessionNames = await this.listSessionNames();
		const sessions: TmuxDiscoveredSession[] = [];
		for (const sessionName of sessionNames) {
			const options = await this.readOptions(["show-options", "-qv", "-t", sessionName]);
			if (!options["@skylark-session-id"] && !options["@pi-session-id"]) {
				continue;
			}
			sessions.push({
				sessionName,
				options,
				windows: await this.listWindows(sessionName),
			});
		}
		return sessions;
	}

	private async listSessionNames(): Promise<string[]> {
		try {
			const result = await this.runTmux(["list-sessions", "-F", "#{session_name}"]);
			return splitLines(result.stdout);
		} catch (error) {
			if (isExpectedMissingTmuxState(error)) {
				return [];
			}
			throw error;
		}
	}

	private async listWindows(sessionName: string): Promise<TmuxDiscoveredWindow[]> {
		try {
			const result = await this.runTmux(["list-panes", "-t", sessionName, "-F", PANE_FORMAT]);
			const windows = parsePaneList(result.stdout);
			return Promise.all(
				windows.map(async (window) => ({
					...window,
					options: await this.readOptions([
						"show-options",
						"-w",
						"-qv",
						"-t",
						`${sessionName}:${window.windowName}`,
					]),
				})),
			);
		} catch (error) {
			if (isExpectedMissingTmuxState(error)) {
				return [];
			}
			throw error;
		}
	}

	private async readOptions(baseArgs: string[]): Promise<Record<TmuxOption, string | undefined>> {
		const options: Record<TmuxOption, string | undefined> = {
			"@pi-cwd": undefined,
			"@pi-resource-kind": undefined,
			"@pi-session-id": undefined,
			"@pi-title": undefined,
			"@skylark-cwd": undefined,
			"@skylark-resource-kind": undefined,
			"@skylark-session-id": undefined,
			"@skylark-title": undefined,
		};
		await Promise.all(
			TMUX_OPTIONS.map(async (option) => {
				try {
					const result = await this.runTmux([...baseArgs, option]);
					const value = result.stdout.trim();
					if (value) {
						options[option] = value;
					}
				} catch (error) {
					if (!isExpectedMissingTmuxState(error)) {
						throw error;
					}
				}
			}),
		);
		return options;
	}
}
