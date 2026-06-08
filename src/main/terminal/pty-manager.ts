import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { type IDisposable, type IPty, spawn } from "node-pty";
import type { SerializedTerminalEvent } from "../../shared/serialized-terminal-event.ts";
import type {
	DesktopEnvironmentResource,
	DesktopTerminalCreateRequest,
	DesktopTerminalResizeRequest,
	DesktopTerminalWriteRequest,
} from "../../shared/types.ts";
import { Listeners } from "../util/port-fanout.ts";

type PtySpawn = typeof spawn;
const require = createRequire(import.meta.url);
const NODE_PTY_PACKAGE_ROOT = dirname(dirname(require.resolve("node-pty")));
const DEFAULT_TERMINAL_LOCALE = "en_US.UTF-8";
const DEFAULT_TERMINAL_NAME = "xterm-256color";

interface ActiveTerminal {
	terminalId: string;
	sessionId: string;
	pty: IPty;
	readOnly: boolean;
	dataSubscription: IDisposable;
	exitSubscription: IDisposable;
	isDisposing: boolean;
}

export interface DesktopPtyEnvironmentResourceStore {
	getResource(resourceId: string): Promise<DesktopEnvironmentResource | null>;
}

export interface DesktopPtyManagerOptions {
	environmentResourceStore?: DesktopPtyEnvironmentResourceStore;
}

function getDefaultShell(): string {
	if (process.platform === "win32") {
		return process.env.COMSPEC ?? "powershell.exe";
	}

	return process.env.SHELL ?? "/bin/bash";
}

function isUtf8Locale(value: string | undefined): boolean {
	return value !== undefined && /utf-?8/i.test(value);
}

export function createPtyEnvironment(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...baseEnv };
	const terminalLocale = isUtf8Locale(env.LC_ALL)
		? env.LC_ALL
		: isUtf8Locale(env.LANG)
			? env.LANG
			: isUtf8Locale(env.LC_CTYPE)
				? env.LC_CTYPE
				: DEFAULT_TERMINAL_LOCALE;

	env.TERM = DEFAULT_TERMINAL_NAME;
	if (env.LC_ALL && !isUtf8Locale(env.LC_ALL)) {
		env.LC_ALL = terminalLocale;
	}
	if (!isUtf8Locale(env.LANG)) {
		env.LANG = terminalLocale;
	}
	if (!isUtf8Locale(env.LC_CTYPE)) {
		env.LC_CTYPE = terminalLocale;
	}

	return env;
}

export function resolvePtySpawnHelperPath(
	packageRoot: string = NODE_PTY_PACKAGE_ROOT,
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): string | undefined {
	if (platform === "win32") {
		return undefined;
	}

	const helperCandidates = [
		join(packageRoot, "build", "Release", "spawn-helper"),
		join(packageRoot, "build", "Debug", "spawn-helper"),
		join(packageRoot, "prebuilds", `${platform}-${arch}`, "spawn-helper"),
	];

	for (const helperPath of helperCandidates) {
		const unpackedHelperPath = resolveAsarUnpackedPath(helperPath);
		if (unpackedHelperPath && existsSync(unpackedHelperPath)) {
			return unpackedHelperPath;
		}
		if (existsSync(helperPath)) {
			return helperPath;
		}
	}

	return undefined;
}

function resolveAsarUnpackedPath(filePath: string): string | undefined {
	const asarPathMarker = `.asar${sep}`;
	const asarPathIndex = filePath.indexOf(asarPathMarker);
	if (asarPathIndex === -1) {
		return undefined;
	}

	return `${filePath.slice(0, asarPathIndex)}.asar.unpacked${filePath.slice(asarPathIndex + ".asar".length)}`;
}

export function ensurePtySpawnHelperExecutable(
	packageRoot: string = NODE_PTY_PACKAGE_ROOT,
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): void {
	const helperPath = resolvePtySpawnHelperPath(packageRoot, platform, arch);
	if (!helperPath) {
		return;
	}

	const stats = statSync(helperPath);
	if ((stats.mode & 0o111) !== 0) {
		return;
	}

	chmodSync(helperPath, stats.mode | 0o755);
}

export class DesktopPtyManager {
	private readonly activeTerminals = new Map<string, ActiveTerminal>();
	private readonly listeners = new Listeners<SerializedTerminalEvent>();

	constructor(
		private readonly spawnPty: PtySpawn = spawn,
		private readonly options: DesktopPtyManagerOptions = {},
	) {}

	private broadcast(event: SerializedTerminalEvent): void {
		this.listeners.emit(event);
	}

	private getActiveTerminal(terminalId: string): ActiveTerminal {
		const activeTerminal = this.activeTerminals.get(terminalId);
		if (!activeTerminal || activeTerminal.isDisposing) {
			throw new Error(`No active terminal '${terminalId}'`);
		}

		return activeTerminal;
	}

	private disposeTerminal(activeTerminal: ActiveTerminal): void {
		if (!activeTerminal || activeTerminal.isDisposing) {
			return;
		}

		activeTerminal.isDisposing = true;
		activeTerminal.pty.kill();
	}

	private cleanupTerminal(activeTerminal: ActiveTerminal): void {
		activeTerminal.dataSubscription.dispose();
		activeTerminal.exitSubscription.dispose();

		if (this.activeTerminals.get(activeTerminal.terminalId)?.pty === activeTerminal.pty) {
			this.activeTerminals.delete(activeTerminal.terminalId);
		}
	}

	async create(request: DesktopTerminalCreateRequest): Promise<void> {
		this.dispose(request.terminalId);
		ensurePtySpawnHelperExecutable();

		const spawnInput = await this.resolveSpawnInput(request);
		const pty = this.spawnPty(spawnInput.command, spawnInput.args, {
			name: DEFAULT_TERMINAL_NAME,
			cols: request.cols,
			rows: request.rows,
			cwd: spawnInput.cwd,
			env: createPtyEnvironment(),
		});

		const activeTerminal: ActiveTerminal = {
			terminalId: request.terminalId,
			sessionId: request.sessionId,
			pty,
			readOnly: spawnInput.readOnly,
			dataSubscription: { dispose() {} },
			exitSubscription: { dispose() {} },
			isDisposing: false,
		};
		const isCurrentTerminal = () => this.activeTerminals.get(request.terminalId)?.pty === pty;
		this.activeTerminals.set(request.terminalId, activeTerminal);

		activeTerminal.dataSubscription = pty.onData((data) => {
			if (!isCurrentTerminal()) {
				return;
			}

			this.broadcast({
				type: "terminal_data",
				terminalId: request.terminalId,
				sessionId: request.sessionId,
				data,
			});
		});
		activeTerminal.exitSubscription = pty.onExit(({ exitCode, signal }) => {
			if (isCurrentTerminal()) {
				this.broadcast({
					type: "terminal_exit",
					terminalId: request.terminalId,
					sessionId: request.sessionId,
					exitCode,
					signal,
				});
			}
			this.cleanupTerminal(activeTerminal);
		});
	}

	write(request: DesktopTerminalWriteRequest): void {
		const activeTerminal = this.getActiveTerminal(request.terminalId);
		if (activeTerminal.readOnly) {
			throw new Error(`Terminal '${request.terminalId}' is read-only.`);
		}
		activeTerminal.pty.write(request.data);
	}

	resize(request: DesktopTerminalResizeRequest): void {
		const activeTerminal = this.activeTerminals.get(request.terminalId);
		if (!activeTerminal || activeTerminal.isDisposing) {
			return;
		}
		activeTerminal.pty.resize(request.cols, request.rows);
	}

	dispose(terminalId: string): void {
		const activeTerminal = this.activeTerminals.get(terminalId);
		if (!activeTerminal || activeTerminal.isDisposing) {
			return;
		}

		this.disposeTerminal(activeTerminal);
	}

	disposeSession(sessionId: string): void {
		for (const activeTerminal of this.activeTerminals.values()) {
			if (activeTerminal.sessionId === sessionId) {
				this.disposeTerminal(activeTerminal);
			}
		}
	}

	disposeAll(): void {
		for (const activeTerminal of this.activeTerminals.values()) {
			this.disposeTerminal(activeTerminal);
		}
	}

	subscribe(listener: (event: SerializedTerminalEvent) => void): () => void {
		return this.listeners.subscribe(listener);
	}

	private async resolveSpawnInput(request: DesktopTerminalCreateRequest): Promise<{
		args: string[];
		command: string;
		cwd: string;
		readOnly: boolean;
	}> {
		if (request.source.type === "shell") {
			return {
				args: [],
				command: getDefaultShell(),
				cwd: request.source.cwd,
				readOnly: false,
			};
		}
		const store = this.options.environmentResourceStore;
		if (!store) {
			throw new Error("Environment resource terminals are not available.");
		}
		const resource = await store.getResource(request.source.resourceId);
		if (!resource) {
			throw new Error(`Environment resource '${request.source.resourceId}' does not exist.`);
		}
		if (resource.provider !== "tmux") {
			throw new Error(`Environment resource '${request.source.resourceId}' is not a tmux resource.`);
		}
		const tmuxSessionName = resource.metadata.tmuxSessionName;
		if (!tmuxSessionName) {
			throw new Error(`Environment resource '${request.source.resourceId}' has no tmux session name.`);
		}
		const target =
			resource.kind === "tmux_window" && resource.metadata.tmuxWindowName
				? `${tmuxSessionName}:${resource.metadata.tmuxWindowName}`
				: tmuxSessionName;
		return {
			args: [
				"-f",
				"/dev/null",
				...(resource.metadata.tmuxSocketPath ? ["-S", resource.metadata.tmuxSocketPath] : []),
				"attach-session",
				"-r",
				"-t",
				target,
			],
			command: "tmux",
			cwd: resource.cwd,
			readOnly: true,
		};
	}
}
