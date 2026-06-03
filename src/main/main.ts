import { join } from "node:path";
import { AuthStorage, getAgentDir } from "@earendil-works/pi-coding-agent";
import { app } from "electron";
import { installDesktopApplicationIdentity } from "./app-identity.ts";
import { DesktopAuthService } from "./auth/desktop-auth-service.ts";
import { ContextHarvester, JsonPaneSnapshotStore } from "./context/context-harvester.ts";
import {
	JsonEnvironmentResourceStore,
	migrateWorkspaceRuntimeToEnvironmentResources,
	reconcileTmuxEnvironmentResources,
} from "./environment/environment-resource-store.ts";
import { DefaultTmuxEnvironmentInspector } from "./environment/tmux-environment-watcher.ts";
import { createDesktopAgentEventCreator } from "./events/agent-event-creation-service.ts";
import { DesktopEventStore } from "./events/event-store.ts";
import { DesktopEventStreamBroker } from "./events/event-stream-broker.ts";
import { registerDesktopAgentHandlers } from "./ipc/register-handlers.ts";
import { DesktopMcpManager } from "./mcp/mcp-manager.ts";
import { DesktopMcpStore } from "./mcp/mcp-store.ts";
import { markMainPerformance, measureMainAsync, measureMainPerformance } from "./performance.ts";
import {
	createDesktopAgentRuntime,
	createDesktopEventManagementGenerateText,
	createDesktopRuntimeCatalog,
} from "./runtime/create-runtime.ts";
import { DesktopRuntimeHost } from "./runtime/desktop-runtime-host.ts";
import { DesktopSubagentRuntimeBroker } from "./runtime/subagent-runtime-broker.ts";
import { JsonRuntimeAuditStore, RuntimePermissionGate } from "./runtime-permissions/runtime-permission-gate.ts";
import { DesktopApprovalBroker } from "./security/approval-broker.ts";
import { migrateDesktopAgentHome } from "./storage/agent-home-migration.ts";
import { DesktopInstructionStore } from "./storage/instruction-store.ts";
import { createDesktopMainStoragePaths } from "./storage/paths.ts";
import { DesktopPlatformStateStore } from "./storage/platform-state-store.ts";
import { DesktopProjectStore } from "./storage/project-store.ts";
import { DesktopProviderKeysStore } from "./storage/provider-keys-store.ts";
import { DesktopSessionStore } from "./storage/session-store.ts";
import { DesktopSettingsStore } from "./storage/settings-store.ts";
import { DesktopPtyManager } from "./terminal/pty-manager.ts";
import { DefaultTmuxRuntime } from "./tmux/tmux-runtime.ts";
import {
	createDesktopWindowManager,
	type DesktopWindowManager,
	installDesktopApplicationMenu,
} from "./window/desktop-window-manager.ts";
import { WorkspaceResourceGovernor } from "./workspace/resource-governor.ts";
import { WorkspaceRuntimeOrchestrator } from "./workspace/workspace-runtime-orchestrator.ts";
import { DesktopWorkspaceStore } from "./workspace/workspace-store.ts";

let desktopHost: DesktopRuntimeHost | undefined;
let terminalManager: DesktopPtyManager | undefined;
let windowManager: DesktopWindowManager | undefined;
let shutdownPromise: Promise<void> | undefined;

const SHUTDOWN_TIMEOUT_MS = 2_000;

installDesktopApplicationIdentity(app);

async function waitForShutdownStep(step: Promise<void>): Promise<void> {
	let timeout: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			step,
			new Promise<void>((resolve) => {
				timeout = setTimeout(() => resolve(), SHUTDOWN_TIMEOUT_MS);
				timeout.unref();
			}),
		]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

export function createDesktopShutdown(options: {
	authService: DesktopAuthService;
	approvalBroker: DesktopApprovalBroker;
	host: DesktopRuntimeHost;
	mcpManager: DesktopMcpManager;
	terminalManager: DesktopPtyManager;
}): () => Promise<void> {
	let didStart = false;
	return async () => {
		if (didStart) {
			return;
		}
		didStart = true;
		await measureMainAsync("main shutdown", async () => {
			options.terminalManager.disposeAll();
			options.authService.dispose();
			options.approvalBroker.dispose("Application is quitting.");
			await Promise.all([
				waitForShutdownStep(options.host.disposeAll()),
				waitForShutdownStep(options.mcpManager.disposeAll()),
			]);
		});
	};
}

async function bootstrap(): Promise<void> {
	markMainPerformance("main:bootstrap:start");
	const storagePaths = createDesktopMainStoragePaths(app.getPath("userData"), { isPackaged: app.isPackaged });
	await migrateDesktopAgentHome({
		agentRootDir: storagePaths.agentRootDir,
		legacyDesktopRootDir: storagePaths.platformRootDir,
		legacyPiAgentDir: app.isPackaged ? undefined : getAgentDir(),
		platformStateFilePath: storagePaths.platformStateFilePath,
	});
	const settingsStore = new DesktopSettingsStore(storagePaths.settingsFilePath);
	const instructionStore = new DesktopInstructionStore({ agentDir: storagePaths.agentRootDir });
	await instructionStore.migrateLegacySettings(settingsStore);
	const getDesktopSettings = async () => ({
		...(await settingsStore.getAll()),
		...(await instructionStore.getAll()),
	});
	const platformStateStore = new DesktopPlatformStateStore(storagePaths.platformStateFilePath);
	const initialSettings = await getDesktopSettings();
	const initialPlatformState = await platformStateStore.getAll();
	let windowStates = initialPlatformState.windowStates ?? initialSettings.windowStates ?? {};
	const providerKeysStore = new DesktopProviderKeysStore(storagePaths.providerKeysFilePath);
	const projectStore = new DesktopProjectStore(storagePaths.projectIndexFilePath);
	const sessionStore = new DesktopSessionStore(storagePaths.sessionIndexFilePath, storagePaths.sessionsDir);
	const eventStore = new DesktopEventStore(
		storagePaths.eventIndexFilePath,
		storagePaths.eventsDir,
		storagePaths.eventAttachmentsDir,
	);
	const eventBroker = new DesktopEventStreamBroker();
	const createEventsFromAgent = createDesktopAgentEventCreator({ eventStore, eventBroker });
	const workspaceStore = new DesktopWorkspaceStore(storagePaths.workspaceIndexFilePath);
	const environmentResourceStore = new JsonEnvironmentResourceStore(storagePaths.environmentResourceIndexFilePath);
	const subagentRuntimeBroker = new DesktopSubagentRuntimeBroker();
	const tmuxEnvironmentInspector = new DefaultTmuxEnvironmentInspector();
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
		snapshotBeforePause: async (workspaceId) => {
			await contextHarvester.captureWorkspaceContext({ workspaceId, reason: "pause workspace runtime" });
		},
		tmuxRuntime,
		tmuxSocketRootDir: storagePaths.tmuxSocketDir,
		workspaceStore,
	});
	const mcpStore = new DesktopMcpStore(storagePaths.mcpServersFilePath);
	const approvalBroker = new DesktopApprovalBroker(() => settingsStore.getAll());
	const runtimePermissionGate = new RuntimePermissionGate({
		approvalBroker,
		auditStore: new JsonRuntimeAuditStore(storagePaths.runtimeAuditLogFilePath),
		tmuxRuntime,
		workspaceRuntime,
	});
	const resourceGovernor = new WorkspaceResourceGovernor({
		listPendingRuntimeApprovals: (workspaceId) => runtimePermissionGate.listPendingRuntimeApprovals(workspaceId),
		runtimeRootDir: storagePaths.rootDir,
		snapshotStore,
		tmuxRuntime,
		workspaceRuntime,
		workspaceStore,
	});
	const mcpManager = new DesktopMcpManager(mcpStore, { approvalRequester: approvalBroker });
	const authService = new DesktopAuthService(
		providerKeysStore,
		AuthStorage.create(join(storagePaths.agentRootDir, "auth.json")),
	);
	const refreshEnvironmentResources = async () => {
		await reconcileTmuxEnvironmentResources(environmentResourceStore, await tmuxEnvironmentInspector.discover());
		return environmentResourceStore.listResources();
	};

	void measureMainAsync("main environment resource migration", async () => {
		const workspaces = await workspaceStore.listWorkspaces();
		for (const workspace of workspaces) {
			await migrateWorkspaceRuntimeToEnvironmentResources(environmentResourceStore, workspace);
		}
	}).catch(() => undefined);

	const getApiKey = async (provider: string) => authService.getApiKey(provider);
	const getRuntimeCatalog = async () =>
		measureMainAsync("main runtime catalog load", () =>
			createDesktopRuntimeCatalog({
				getApiKey,
				hasAuth: (provider) => authService.hasAuth(provider),
			}),
		);
	const generateEventManagementText = async (
		input: Parameters<Awaited<ReturnType<typeof createDesktopEventManagementGenerateText>>>[0],
	) =>
		measureMainAsync("main event management proposal generate", async () => {
			const generateText = await createDesktopEventManagementGenerateText({
				getApiKey,
				hasAuth: (provider) => authService.hasAuth(provider),
				getSettings: getDesktopSettings,
			});
			return generateText(input);
		});

	desktopHost = new DesktopRuntimeHost(
		(options) =>
			measureMainAsync("main runtime create", () =>
				createDesktopAgentRuntime({
					...options,
					agentDir: storagePaths.agentRootDir,
					agentSessionsDir: storagePaths.agentSessionsDir,
					subagentSessionsDir: storagePaths.subagentSessionsDir,
					getApiKey,
					hasAuth: (provider) => authService.hasAuth(provider),
					getSettings: getDesktopSettings,
					mcpManager,
					approvalRequester: approvalBroker,
					environmentResourceStore,
					publishSubagentEvent: (event) => subagentRuntimeBroker.publish(event),
					createEvents: createEventsFromAgent,
				}),
			),
		{
			agentSessionsDir: storagePaths.agentSessionsDir,
			agentDir: storagePaths.agentRootDir,
			defaultCwd: process.cwd(),
			getApiKey,
			projectStore,
			sessionStore,
			settingsStore,
			instructionStore,
		},
	);
	terminalManager = new DesktopPtyManager(undefined, { environmentResourceStore });
	windowManager = createDesktopWindowManager({
		getWindowState: (kind) => windowStates[kind],
		saveWindowState: async (kind, state) => {
			windowStates = {
				...windowStates,
				[kind]: state,
			};
			await platformStateStore.set("windowStates", windowStates);
		},
	});
	registerDesktopAgentHandlers(
		desktopHost,
		authService,
		terminalManager,
		mcpManager,
		approvalBroker,
		getRuntimeCatalog,
		{
			settingsStore,
			instructionStore,
			providerKeysStore,
			projectStore,
			eventStore,
			sessionStore,
		},
		{
			contextHarvester,
			runtimePermissionGate,
			workspaceRuntime,
			workspaceStore,
		},
		{
			windowManager,
		},
		{
			environmentResourceStore,
			refreshEnvironmentResources,
			subagentRuntimeBroker,
			subagentSessionsDir: storagePaths.subagentSessionsDir,
		},
		{
			criteriaFilePath: storagePaths.eventManagementCriteriaFilePath,
			eventBroker,
			generateText: generateEventManagementText,
		},
	);
	installDesktopApplicationMenu({
		openSettingsWindow: () => {
			windowManager?.openSettingsWindow();
		},
	});
	windowManager.openMainWindow();
	void measureMainAsync("main workspace runtime reconcile", () =>
		resourceGovernor.reconcileWorkspacesOnStartup(),
	).catch(() => undefined);
	const shutdown = createDesktopShutdown({
		authService,
		approvalBroker,
		host: desktopHost,
		mcpManager,
		terminalManager,
	});
	app.on("before-quit", () => {
		shutdownPromise ??= shutdown();
		void shutdownPromise;
	});

	app.on("activate", () => {
		windowManager?.focusMainWindow();
	});
	markMainPerformance("main:bootstrap:end");
	measureMainPerformance("main bootstrap", "main:bootstrap:start", "main:bootstrap:end");
}

app.whenReady().then(() => {
	void bootstrap();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
