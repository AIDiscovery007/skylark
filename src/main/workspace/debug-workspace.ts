import { access, readFile } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";
import { isRecord } from "../../shared/guards.ts";
import type { DesktopWorkspacePaneDefinition, DesktopWorkspacePaneRole } from "../../shared/types.ts";
import type { DesktopWorkspaceCreateInput } from "./workspace-store.ts";

export interface DebugWorkspaceProjectInput {
	issue?: string;
	projectId?: string;
	repoPath: string;
	taskTitle?: string;
}

type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

const DEBUG_WORKSPACE_TASK_TITLE = "Workspace";
const SCRIPT_CANDIDATES: Record<"dev-server" | "logs" | "test", readonly string[]> = {
	"dev-server": ["dev", "start", "serve"],
	logs: ["logs", "log", "logs:dev", "dev:logs"],
	test: ["test", "test:run", "unit", "test:unit"],
};

function normalizeRepoPath(repoPath: string): string {
	return normalize(resolve(repoPath));
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function detectPackageManager(repoPath: string): Promise<PackageManager> {
	if (await fileExists(join(repoPath, "pnpm-lock.yaml"))) {
		return "pnpm";
	}
	if (await fileExists(join(repoPath, "yarn.lock"))) {
		return "yarn";
	}
	if ((await fileExists(join(repoPath, "bun.lockb"))) || (await fileExists(join(repoPath, "bun.lock")))) {
		return "bun";
	}
	return "npm";
}

async function readPackageScripts(repoPath: string): Promise<Record<string, string>> {
	let rawPackageJson: string;
	try {
		rawPackageJson = await readFile(join(repoPath, "package.json"), "utf8");
	} catch {
		return {};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawPackageJson);
	} catch {
		return {};
	}

	if (!isRecord(parsed) || !isRecord(parsed.scripts)) {
		return {};
	}

	const scripts: Record<string, string> = {};
	for (const [name, command] of Object.entries(parsed.scripts)) {
		if (typeof command === "string" && command.trim()) {
			scripts[name] = command;
		}
	}
	return scripts;
}

function findScriptName(scripts: Record<string, string>, candidates: readonly string[]): string | undefined {
	return candidates.find((scriptName) => scripts[scriptName]);
}

function formatScriptCommand(packageManager: PackageManager, scriptName: string): string {
	return `${packageManager} run ${scriptName}`;
}

function createPaneDefinition(input: {
	command?: string;
	cwd?: string;
	id: string;
	role: DesktopWorkspacePaneRole;
	title: string;
}): DesktopWorkspacePaneDefinition {
	return {
		id: input.id,
		role: input.role,
		title: input.title,
		...(input.command ? { command: input.command } : {}),
		...(input.cwd ? { cwd: input.cwd } : {}),
	};
}

function createCommandPane(
	role: "dev-server" | "logs" | "test",
	title: string,
	scripts: Record<string, string>,
	packageManager: PackageManager,
	repoPath: string,
): DesktopWorkspacePaneDefinition {
	const scriptName = findScriptName(scripts, SCRIPT_CANDIDATES[role]);
	return createPaneDefinition({
		...(scriptName ? { command: formatScriptCommand(packageManager, scriptName), cwd: repoPath } : {}),
		id: role,
		role,
		title,
	});
}

export async function createDebugWorkspaceInputFromProject(
	input: DebugWorkspaceProjectInput,
): Promise<DesktopWorkspaceCreateInput> {
	const repoPath = normalizeRepoPath(input.repoPath);
	const [packageManager, scripts] = await Promise.all([detectPackageManager(repoPath), readPackageScripts(repoPath)]);
	return {
		...(input.projectId ? { projectId: input.projectId } : {}),
		repoPath,
		taskTitle: input.taskTitle?.trim() || DEBUG_WORKSPACE_TASK_TITLE,
		paneDefinitions: [
			createPaneDefinition({ id: "agent", role: "agent", title: "Agent" }),
			createPaneDefinition({ id: "shell", role: "shell", title: "Shell" }),
			createCommandPane("dev-server", "Dev Server", scripts, packageManager, repoPath),
			createCommandPane("test", "Test", scripts, packageManager, repoPath),
			createCommandPane("logs", "Logs", scripts, packageManager, repoPath),
		],
	};
}
