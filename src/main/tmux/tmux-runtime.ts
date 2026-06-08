import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { getErrorMessage } from "../../shared/errors.ts";

const execFileAsync = promisify(execFile);

const DEFAULT_TMUX_TIMEOUT_MS = 10_000;
const DEFAULT_CAPTURE_LINES = 1000;
const MAX_CAPTURE_LINES = 5000;
const TMUX_ISOLATED_CONFIG_ARGS = ["-f", "/dev/null"] as const;
const TMUX_FIELD_DELIMITER = "__PI_TMUX_FIELD_DELIMITER__";
const TMUX_PANE_FORMAT = [
	"#{session_name}",
	"#{window_id}",
	"#{window_name}",
	"#{pane_id}",
	"#{pane_index}",
	"#{pane_current_command}",
	"#{pane_current_path}",
	"#{pane_dead}",
].join(TMUX_FIELD_DELIMITER);

export type TmuxRuntimeErrorCode =
	| "tmux_command_failed"
	| "tmux_command_timeout"
	| "tmux_invalid_input"
	| "tmux_unavailable";

export class TmuxRuntimeError extends Error {
	constructor(
		readonly code: TmuxRuntimeErrorCode,
		message: string,
		readonly cause?: unknown,
	) {
		super(message);
		this.name = "TmuxRuntimeError";
	}
}

export interface TmuxCommandResult {
	stdout: string;
	stderr: string;
}

export interface TmuxCommandOptions {
	timeoutMs?: number;
}

export type TmuxCommandRunner = (args: string[], options?: TmuxCommandOptions) => Promise<TmuxCommandResult>;

export interface TmuxPaneInfo {
	sessionName: string;
	windowId: string;
	windowName: string;
	paneId: string;
	paneIndex: number;
	currentCommand: string;
	currentPath: string;
	dead: boolean;
}

export interface TmuxRuntime {
	isTmuxAvailable(): Promise<boolean>;
	hasSession(input: { socketPath: string; sessionName: string }): Promise<boolean>;
	ensureSession(input: {
		socketPath: string;
		sessionName: string;
		cwd: string;
		historyLimit?: number;
	}): Promise<{ created: boolean; sessionName: string }>;
	newWindow(input: {
		socketPath: string;
		sessionName: string;
		windowName: string;
		cwd: string;
		command?: string;
	}): Promise<void>;
	listPanes(input: { socketPath: string; sessionName?: string }): Promise<TmuxPaneInfo[]>;
	capturePane(input: {
		socketPath: string;
		paneId: string;
		lines?: number;
		joinWrappedLines?: boolean;
	}): Promise<string>;
	sendText(input: { socketPath: string; paneId: string; text: string; pressEnter?: boolean }): Promise<void>;
	killWindow(input: { socketPath: string; sessionName: string; windowName: string }): Promise<void>;
	killSession(input: { socketPath: string; sessionName: string }): Promise<void>;
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

function isMissingExecutableError(error: unknown): boolean {
	return getErrorCode(error) === "ENOENT";
}

function isCommandExitError(error: unknown): boolean {
	return typeof getErrorCode(error) === "number";
}

function isCommandTimeoutError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(("killed" in error && (error as { killed?: unknown }).killed === true) || getErrorCode(error) === "ETIMEDOUT")
	);
}

function clampCaptureLines(lines: number | undefined): number {
	if (lines === undefined) {
		return DEFAULT_CAPTURE_LINES;
	}
	if (!Number.isFinite(lines)) {
		return DEFAULT_CAPTURE_LINES;
	}
	return Math.min(MAX_CAPTURE_LINES, Math.max(1, Math.floor(lines)));
}

function withIsolatedTmuxConfig(args: string[]): string[] {
	return [...TMUX_ISOLATED_CONFIG_ARGS, ...args];
}

function assertAbsoluteSocketPath(socketPath: string): void {
	if (!isAbsolute(socketPath)) {
		throw new TmuxRuntimeError("tmux_invalid_input", "tmux socketPath must be absolute.");
	}
}

function assertSafeTmuxName(kind: string, value: string): void {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) {
		throw new TmuxRuntimeError(
			"tmux_invalid_input",
			`tmux ${kind} may only contain letters, numbers, underscores, and hyphens.`,
		);
	}
}

function assertSafePaneId(paneId: string): void {
	if (!/^%[0-9]+$/.test(paneId)) {
		throw new TmuxRuntimeError("tmux_invalid_input", "tmux paneId must use the %<number> format.");
	}
}

async function assertExistingCwd(cwd: string): Promise<void> {
	try {
		await access(cwd);
	} catch (error) {
		throw new TmuxRuntimeError("tmux_invalid_input", `Workspace cwd does not exist: ${cwd}`, error);
	}
}

async function defaultRunTmux(args: string[], options: TmuxCommandOptions = {}): Promise<TmuxCommandResult> {
	const { stdout, stderr } = await execFileAsync("tmux", args, {
		maxBuffer: 8 * 1024 * 1024,
		timeout: options.timeoutMs ?? DEFAULT_TMUX_TIMEOUT_MS,
		windowsHide: true,
	});
	return { stdout, stderr };
}

function wrapTmuxError(error: unknown, timeoutMs = DEFAULT_TMUX_TIMEOUT_MS): TmuxRuntimeError {
	if (error instanceof TmuxRuntimeError) {
		return error;
	}
	if (isMissingExecutableError(error)) {
		return new TmuxRuntimeError("tmux_unavailable", "tmux is not installed or is not available on PATH.", error);
	}
	if (isCommandTimeoutError(error)) {
		return new TmuxRuntimeError("tmux_command_timeout", `tmux command timed out after ${timeoutMs}ms.`, error);
	}
	return new TmuxRuntimeError("tmux_command_failed", getErrorMessage(error), error);
}

export function parseTmuxPaneList(output: string): TmuxPaneInfo[] {
	return output
		.split(/\r?\n/)
		.filter((line) => line.length > 0)
		.map((line) => {
			const [
				sessionName = "",
				windowId = "",
				windowName = "",
				paneId = "",
				paneIndex = "0",
				currentCommand = "",
				currentPath = "",
				dead = "0",
			] = line.split(TMUX_FIELD_DELIMITER);
			return {
				sessionName,
				windowId,
				windowName,
				paneId,
				paneIndex: Number.parseInt(paneIndex, 10) || 0,
				currentCommand,
				currentPath,
				dead: dead === "1",
			};
		});
}

export class DefaultTmuxRuntime implements TmuxRuntime {
	constructor(
		private readonly runTmux: TmuxCommandRunner = defaultRunTmux,
		private readonly timeoutMs = DEFAULT_TMUX_TIMEOUT_MS,
	) {}

	async isTmuxAvailable(): Promise<boolean> {
		try {
			await this.runTmux(withIsolatedTmuxConfig(["-V"]), { timeoutMs: this.timeoutMs });
			return true;
		} catch (error) {
			if (isMissingExecutableError(error)) {
				return false;
			}
			throw wrapTmuxError(error, this.timeoutMs);
		}
	}

	async hasSession(input: { socketPath: string; sessionName: string }): Promise<boolean> {
		assertAbsoluteSocketPath(input.socketPath);
		assertSafeTmuxName("sessionName", input.sessionName);
		try {
			await this.runTmux(withIsolatedTmuxConfig(["-S", input.socketPath, "has-session", "-t", input.sessionName]), {
				timeoutMs: this.timeoutMs,
			});
			return true;
		} catch (error) {
			if (isMissingExecutableError(error)) {
				throw wrapTmuxError(error, this.timeoutMs);
			}
			if (isCommandExitError(error)) {
				return false;
			}
			throw wrapTmuxError(error, this.timeoutMs);
		}
	}

	async ensureSession(input: {
		socketPath: string;
		sessionName: string;
		cwd: string;
		historyLimit?: number;
	}): Promise<{ created: boolean; sessionName: string }> {
		assertAbsoluteSocketPath(input.socketPath);
		assertSafeTmuxName("sessionName", input.sessionName);
		await assertExistingCwd(input.cwd);
		await mkdir(dirname(input.socketPath), { recursive: true });

		if (await this.hasSession(input)) {
			return { created: false, sessionName: input.sessionName };
		}

		try {
			await this.runTmux(
				withIsolatedTmuxConfig([
					"-S",
					input.socketPath,
					"new-session",
					"-d",
					"-s",
					input.sessionName,
					"-c",
					input.cwd,
				]),
				{ timeoutMs: this.timeoutMs },
			);
			await this.runTmux(
				withIsolatedTmuxConfig([
					"-S",
					input.socketPath,
					"set-option",
					"-t",
					input.sessionName,
					"history-limit",
					String(input.historyLimit ?? 20_000),
				]),
				{ timeoutMs: this.timeoutMs },
			);
			return { created: true, sessionName: input.sessionName };
		} catch (error) {
			throw wrapTmuxError(error, this.timeoutMs);
		}
	}

	async newWindow(input: {
		socketPath: string;
		sessionName: string;
		windowName: string;
		cwd: string;
		command?: string;
	}): Promise<void> {
		assertAbsoluteSocketPath(input.socketPath);
		assertSafeTmuxName("sessionName", input.sessionName);
		assertSafeTmuxName("windowName", input.windowName);
		await assertExistingCwd(input.cwd);
		const args = [
			"-S",
			input.socketPath,
			"new-window",
			"-t",
			input.sessionName,
			"-n",
			input.windowName,
			"-c",
			input.cwd,
		];
		if (input.command) {
			args.push(input.command);
		}
		try {
			await this.runTmux(withIsolatedTmuxConfig(args), { timeoutMs: this.timeoutMs });
		} catch (error) {
			throw wrapTmuxError(error, this.timeoutMs);
		}
	}

	async listPanes(input: { socketPath: string; sessionName?: string }): Promise<TmuxPaneInfo[]> {
		assertAbsoluteSocketPath(input.socketPath);
		if (input.sessionName) {
			assertSafeTmuxName("sessionName", input.sessionName);
		}
		const args = ["-S", input.socketPath, "list-panes", "-a", "-F", TMUX_PANE_FORMAT];
		if (input.sessionName) {
			args.push("-t", input.sessionName);
		}
		try {
			const result = await this.runTmux(withIsolatedTmuxConfig(args), { timeoutMs: this.timeoutMs });
			return parseTmuxPaneList(result.stdout);
		} catch (error) {
			throw wrapTmuxError(error, this.timeoutMs);
		}
	}

	async capturePane(input: {
		socketPath: string;
		paneId: string;
		lines?: number;
		joinWrappedLines?: boolean;
	}): Promise<string> {
		assertAbsoluteSocketPath(input.socketPath);
		assertSafePaneId(input.paneId);
		const lines = clampCaptureLines(input.lines);
		const args = ["-S", input.socketPath, "capture-pane", "-p", "-S", `-${lines}`, "-E", "-1", "-t", input.paneId];
		if (input.joinWrappedLines !== false) {
			args.splice(4, 0, "-J");
		}
		try {
			const result = await this.runTmux(withIsolatedTmuxConfig(args), { timeoutMs: this.timeoutMs });
			return result.stdout;
		} catch (error) {
			throw wrapTmuxError(error, this.timeoutMs);
		}
	}

	async sendText(input: { socketPath: string; paneId: string; text: string; pressEnter?: boolean }): Promise<void> {
		assertAbsoluteSocketPath(input.socketPath);
		assertSafePaneId(input.paneId);
		try {
			await this.runTmux(
				withIsolatedTmuxConfig(["-S", input.socketPath, "send-keys", "-t", input.paneId, "-l", input.text]),
				{
					timeoutMs: this.timeoutMs,
				},
			);
			if (input.pressEnter) {
				await this.runTmux(
					withIsolatedTmuxConfig(["-S", input.socketPath, "send-keys", "-t", input.paneId, "Enter"]),
					{
						timeoutMs: this.timeoutMs,
					},
				);
			}
		} catch (error) {
			throw wrapTmuxError(error, this.timeoutMs);
		}
	}

	async killWindow(input: { socketPath: string; sessionName: string; windowName: string }): Promise<void> {
		assertAbsoluteSocketPath(input.socketPath);
		assertSafeTmuxName("sessionName", input.sessionName);
		assertSafeTmuxName("windowName", input.windowName);
		try {
			await this.runTmux(
				withIsolatedTmuxConfig([
					"-S",
					input.socketPath,
					"kill-window",
					"-t",
					`${input.sessionName}:${input.windowName}`,
				]),
				{ timeoutMs: this.timeoutMs },
			);
		} catch (error) {
			throw wrapTmuxError(error, this.timeoutMs);
		}
	}

	async killSession(input: { socketPath: string; sessionName: string }): Promise<void> {
		assertAbsoluteSocketPath(input.socketPath);
		assertSafeTmuxName("sessionName", input.sessionName);
		try {
			await this.runTmux(withIsolatedTmuxConfig(["-S", input.socketPath, "kill-session", "-t", input.sessionName]), {
				timeoutMs: this.timeoutMs,
			});
		} catch (error) {
			throw wrapTmuxError(error, this.timeoutMs);
		}
	}
}
