#!/usr/bin/env node

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopWorkspacePaneRole } from "../shared/types.ts";
import { DESKTOP_PRODUCT_NAME } from "./app-identity.ts";
import { ContextHarvester, JsonPaneSnapshotStore } from "./context/context-harvester.ts";
import { createDesktopStoragePaths } from "./storage/paths.ts";
import { DefaultTmuxRuntime } from "./tmux/tmux-runtime.ts";
import { WorkspaceRuntimeOrchestrator } from "./workspace/workspace-runtime-orchestrator.ts";
import { DesktopWorkspaceStore } from "./workspace/workspace-store.ts";

const READ_ONLY_COMMANDS = new Set(["archive", "open", "pause", "resume", "send", "takeover"]);
const PANE_ROLES = new Set(["agent", "shell", "dev-server", "test", "logs"]);

type WorkspaceRuntimeCliCommand = "capture" | "latest-summary" | "list-panes" | "status";

interface ParsedWorkspaceRuntimeCliArgs {
	agentHomeDir?: string;
	command: WorkspaceRuntimeCliCommand;
	lines?: number;
	roles?: DesktopWorkspacePaneRole[];
	userDataDir?: string;
	workspaceId?: string;
}

interface WorkspaceRuntimeCliIo {
	stderr: { write(chunk: string): void };
	stdout: { write(chunk: string): void };
}

export interface WorkspaceRuntimeCliServices {
	contextHarvester: Pick<ContextHarvester, "captureWorkspaceContext" | "captureWorkspacePane" | "listPaneSnapshots">;
	workspaceRuntime: Pick<WorkspaceRuntimeOrchestrator, "getWorkspaceRuntimeState">;
	workspaceStore: Pick<DesktopWorkspaceStore, "listWorkspaces">;
}

export interface WorkspaceRuntimeCliResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}

function resolveDefaultUserDataDir(): string {
	if (process.env.PI_DESKTOP_USER_DATA_DIR) {
		return resolve(process.env.PI_DESKTOP_USER_DATA_DIR);
	}
	if (process.platform === "darwin") {
		return join(homedir(), "Library", "Application Support", DESKTOP_PRODUCT_NAME);
	}
	if (process.platform === "win32") {
		return join(process.env.APPDATA ?? homedir(), DESKTOP_PRODUCT_NAME);
	}
	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pi-desktop-agent");
}

function readValue(args: string[], index: number, label: string): { nextIndex: number; value: string } {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${label} requires a value.`);
	}
	return { nextIndex: index + 1, value };
}

function parsePaneRole(value: string): DesktopWorkspacePaneRole {
	if (!PANE_ROLES.has(value)) {
		throw new Error(`Unsupported pane role '${value}'.`);
	}
	return value as DesktopWorkspacePaneRole;
}

function parsePositiveInteger(value: string, label: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new Error(`${label} must be a positive integer.`);
	}
	return parsed;
}

function parseWorkspaceRuntimeCliArgs(args: string[]): ParsedWorkspaceRuntimeCliArgs {
	const [commandArg, ...rest] = args;
	if (!commandArg || commandArg === "--help" || commandArg === "-h") {
		throw new Error(
			"Usage: skylark-workspace-runtime <status|list-panes|capture|latest-summary> [--user-data-dir <path>] [--agent-home <path>] [--workspace <id>] [--role <role>] [--lines <count>]",
		);
	}
	if (READ_ONLY_COMMANDS.has(commandArg)) {
		throw new Error(`'${commandArg}' is not available from this read-only CLI.`);
	}
	if (!["capture", "latest-summary", "list-panes", "status"].includes(commandArg)) {
		throw new Error(`Unknown workspace runtime command '${commandArg}'.`);
	}

	const parsed: ParsedWorkspaceRuntimeCliArgs = { command: commandArg as WorkspaceRuntimeCliCommand };
	for (let index = 0; index < rest.length; index += 1) {
		const arg = rest[index];
		if (!arg) {
			continue;
		}
		if (arg.startsWith("--agent-home=")) {
			parsed.agentHomeDir = resolve(arg.slice("--agent-home=".length));
			continue;
		}
		if (arg === "--agent-home") {
			const next = readValue(rest, index, "--agent-home");
			parsed.agentHomeDir = resolve(next.value);
			index = next.nextIndex;
			continue;
		}
		if (arg.startsWith("--user-data-dir=")) {
			parsed.userDataDir = resolve(arg.slice("--user-data-dir=".length));
			continue;
		}
		if (arg === "--user-data-dir") {
			const next = readValue(rest, index, "--user-data-dir");
			parsed.userDataDir = resolve(next.value);
			index = next.nextIndex;
			continue;
		}
		if (arg.startsWith("--workspace=")) {
			parsed.workspaceId = arg.slice("--workspace=".length);
			continue;
		}
		if (arg === "--workspace") {
			const next = readValue(rest, index, "--workspace");
			parsed.workspaceId = next.value;
			index = next.nextIndex;
			continue;
		}
		if (arg.startsWith("--role=")) {
			parsed.roles = [...(parsed.roles ?? []), parsePaneRole(arg.slice("--role=".length))];
			continue;
		}
		if (arg === "--role") {
			const next = readValue(rest, index, "--role");
			parsed.roles = [...(parsed.roles ?? []), parsePaneRole(next.value)];
			index = next.nextIndex;
			continue;
		}
		if (arg.startsWith("--lines=")) {
			parsed.lines = parsePositiveInteger(arg.slice("--lines=".length), "--lines");
			continue;
		}
		if (arg === "--lines") {
			const next = readValue(rest, index, "--lines");
			parsed.lines = parsePositiveInteger(next.value, "--lines");
			index = next.nextIndex;
			continue;
		}
		throw new Error(`Unknown option '${arg}'.`);
	}

	if (parsed.command !== "status" && !parsed.workspaceId) {
		throw new Error(`'${parsed.command}' requires --workspace.`);
	}
	return parsed;
}

export function createWorkspaceRuntimeCliServices(
	userDataDir: string,
	agentHomeDir?: string,
): WorkspaceRuntimeCliServices {
	const storagePaths = createDesktopStoragePaths(userDataDir, agentHomeDir ? { agentRootDir: agentHomeDir } : {});
	const workspaceStore = new DesktopWorkspaceStore(storagePaths.workspaceIndexFilePath);
	const tmuxRuntime = new DefaultTmuxRuntime();
	const snapshotStore = new JsonPaneSnapshotStore(storagePaths.workspaceSnapshotIndexFilePath);
	const contextHarvester = new ContextHarvester({
		runtimeRootDir: storagePaths.rootDir,
		snapshotStore,
		tmuxRuntime,
		tmuxSocketRootDir: storagePaths.tmuxSocketDir,
		workspaceStore,
	});
	const workspaceRuntime = new WorkspaceRuntimeOrchestrator({
		runtimeRootDir: storagePaths.rootDir,
		tmuxRuntime,
		tmuxSocketRootDir: storagePaths.tmuxSocketDir,
		workspaceStore,
	});
	return { contextHarvester, workspaceRuntime, workspaceStore };
}

async function executeWorkspaceRuntimeCliCommand(
	parsed: ParsedWorkspaceRuntimeCliArgs,
	services: WorkspaceRuntimeCliServices,
): Promise<unknown> {
	switch (parsed.command) {
		case "status": {
			const workspaces = await services.workspaceStore.listWorkspaces();
			const summaries = await Promise.all(
				workspaces.map(async (workspace) => ({
					runtime: await services.workspaceRuntime.getWorkspaceRuntimeState(workspace.id),
					workspace: {
						id: workspace.id,
						repoPath: workspace.repoPath,
						status: workspace.status,
						taskTitle: workspace.taskTitle,
					},
				})),
			);
			return { workspaces: summaries };
		}
		case "list-panes":
			return services.workspaceRuntime.getWorkspaceRuntimeState(parsed.workspaceId!);
		case "capture":
			if (parsed.roles?.length === 1) {
				return services.contextHarvester.captureWorkspacePane({
					...(parsed.lines ? { lines: parsed.lines } : {}),
					paneRole: parsed.roles[0],
					reason: "workspace runtime CLI capture",
					workspaceId: parsed.workspaceId!,
				});
			}
			return services.contextHarvester.captureWorkspaceContext({
				...(parsed.lines ? { linesPerPane: parsed.lines } : {}),
				...(parsed.roles?.length ? { roles: parsed.roles } : {}),
				reason: "workspace runtime CLI capture",
				workspaceId: parsed.workspaceId!,
			});
		case "latest-summary": {
			const [runtime, latestSnapshots] = await Promise.all([
				services.workspaceRuntime.getWorkspaceRuntimeState(parsed.workspaceId!),
				services.contextHarvester.listPaneSnapshots(parsed.workspaceId!),
			]);
			return { runtime, latestSnapshots };
		}
	}
}

export async function runWorkspaceRuntimeCli(
	args: string[],
	options: {
		createServices?: (userDataDir: string, agentHomeDir?: string) => WorkspaceRuntimeCliServices;
		io?: WorkspaceRuntimeCliIo;
	} = {},
): Promise<WorkspaceRuntimeCliResult> {
	let stdout = "";
	let stderr = "";
	const io = options.io ?? {
		stdout: {
			write: (chunk: string) => {
				stdout += chunk;
			},
		},
		stderr: {
			write: (chunk: string) => {
				stderr += chunk;
			},
		},
	};
	try {
		const parsed = parseWorkspaceRuntimeCliArgs(args);
		const userDataDir = parsed.userDataDir ?? resolveDefaultUserDataDir();
		const services =
			options.createServices?.(userDataDir, parsed.agentHomeDir) ??
			createWorkspaceRuntimeCliServices(userDataDir, parsed.agentHomeDir);
		const output = await executeWorkspaceRuntimeCliCommand(parsed, services);
		io.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		return { exitCode: 0, stderr, stdout };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		io.stderr.write(`${message}\n`);
		return { exitCode: 1, stderr: stderr || `${message}\n`, stdout };
	}
}

async function main(): Promise<void> {
	const result = await runWorkspaceRuntimeCli(process.argv.slice(2), {
		io: {
			stdout: process.stdout,
			stderr: process.stderr,
		},
	});
	process.exitCode = result.exitCode;
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
	void main();
}
