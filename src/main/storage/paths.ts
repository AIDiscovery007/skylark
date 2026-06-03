import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export interface DesktopStoragePaths {
	rootDir: string;
	agentRootDir: string;
	platformRootDir: string;
	settingsFilePath: string;
	providerKeysFilePath: string;
	projectIndexFilePath: string;
	mcpServersFilePath: string;
	sessionIndexFilePath: string;
	environmentResourceIndexFilePath: string;
	eventIndexFilePath: string;
	eventManagementCriteriaFilePath: string;
	workspaceIndexFilePath: string;
	workspaceSnapshotIndexFilePath: string;
	runtimeAuditLogFilePath: string;
	tmuxSocketDir: string;
	agentSessionsDir: string;
	subagentSessionsDir: string;
	sessionsDir: string;
	archivedSessionsDir: string;
	eventsDir: string;
	eventAttachmentsDir: string;
	platformStateFilePath: string;
}

function getTmuxSocketDir(): string {
	return process.platform === "darwin" ? join("/tmp", "pda-tmux") : join(tmpdir(), "pda-tmux");
}

export interface CreateDesktopStoragePathsOptions {
	agentRootDir?: string;
	homeDir?: string;
}

export interface CreateDesktopMainStoragePathsOptions {
	homeDir?: string;
	isPackaged: boolean;
}

export function createDesktopStoragePaths(
	userDataPath: string,
	options: CreateDesktopStoragePathsOptions = {},
): DesktopStoragePaths {
	const agentRootDir = options.agentRootDir ?? join(options.homeDir ?? homedir(), ".skylark");
	const platformRootDir = join(userDataPath, "desktop-agent");
	const rootDir = agentRootDir;

	return {
		rootDir,
		agentRootDir,
		platformRootDir,
		settingsFilePath: join(agentRootDir, "settings.json"),
		providerKeysFilePath: join(agentRootDir, "provider-keys.json"),
		projectIndexFilePath: join(rootDir, "projects", "index.json"),
		mcpServersFilePath: join(agentRootDir, "mcp-servers.json"),
		sessionIndexFilePath: join(agentRootDir, "session_index.jsonl"),
		environmentResourceIndexFilePath: join(rootDir, "environment", "resources.json"),
		eventIndexFilePath: join(rootDir, "events", "index.json"),
		eventManagementCriteriaFilePath: join(rootDir, "events", "EVENTS.md"),
		workspaceIndexFilePath: join(rootDir, "workspaces", "index.json"),
		workspaceSnapshotIndexFilePath: join(rootDir, "workspaces", "snapshots", "index.json"),
		runtimeAuditLogFilePath: join(rootDir, "workspaces", "runtime-audit.json"),
		tmuxSocketDir: getTmuxSocketDir(),
		agentSessionsDir: join(rootDir, "sessions"),
		subagentSessionsDir: join(rootDir, "subagents"),
		sessionsDir: join(rootDir, "sessions"),
		archivedSessionsDir: join(rootDir, "archived_sessions"),
		eventsDir: join(rootDir, "events", "data"),
		eventAttachmentsDir: join(rootDir, "events", "attachments"),
		platformStateFilePath: join(platformRootDir, "platform-state.json"),
	};
}

export function createDesktopMainStoragePaths(
	userDataPath: string,
	options: CreateDesktopMainStoragePathsOptions,
): DesktopStoragePaths {
	return createDesktopStoragePaths(
		userDataPath,
		options.isPackaged ? { agentRootDir: join(userDataPath, "desktop-agent") } : { homeDir: options.homeDir },
	);
}
