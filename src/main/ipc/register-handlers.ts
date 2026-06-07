import { ipcMain } from "electron";
import type { DesktopProviderKeyTestResult, DesktopRuntimeCatalog } from "../../shared/types.ts";
import type { DesktopAuthService } from "../auth/desktop-auth-service.ts";
import type { DesktopEventManagementGenerateText } from "../events/event-management-service.ts";
import type { DesktopEventStore } from "../events/event-store.ts";
import { DesktopEventStreamBroker } from "../events/event-stream-broker.ts";
import type { DesktopMcpManager } from "../mcp/mcp-manager.ts";
import type { DesktopRuntimeHost } from "../runtime/desktop-runtime-host.ts";
import type { DesktopApprovalBroker } from "../security/approval-broker.ts";
import type { DesktopInstructionStore } from "../storage/instruction-store.ts";
import type { DesktopProjectStore } from "../storage/project-store.ts";
import type { DesktopProviderKeysStore } from "../storage/provider-keys-store.ts";
import type { DesktopSessionStore } from "../storage/session-store.ts";
import type { DesktopSettingsStore } from "../storage/settings-store.ts";
import type { DesktopPtyManager } from "../terminal/pty-manager.ts";
import { createAgentStreamBridgeGroup, installAgentLifecycleSideEffects } from "./agent-event-handlers.ts";
import type { DesktopAppShellBridgeServices } from "./app-shell-handlers.ts";
import { createAppShellBridgeGroup } from "./app-shell-handlers.ts";
import { createApprovalBridgeGroup } from "./approval-handlers.ts";
import { createAuthBridgeGroup } from "./auth-handlers.ts";
import { createCapabilityBridgeGroup } from "./capability-handlers.ts";
import { registerDesktopBridgeGroup } from "./desktop-bridge-registry.ts";
import { createEnvironmentBridgeGroup, type DesktopEnvironmentBridgeServices } from "./environment-handlers.ts";
import { createEventBridgeGroup } from "./event-handlers.ts";
import { createSettingsBridgeGroup } from "./settings-handlers.ts";
import { createTerminalBridgeGroup } from "./terminal-handlers.ts";
import { createWebPreviewBridgeGroup, type DesktopWebPreviewBridgeServices } from "./web-preview-view-handlers.ts";
import {
	createWorkspaceRuntimeBridgeGroup,
	type WorkspaceRuntimeHandlerServices,
} from "./workspace-runtime-handlers.ts";
import {
	createPreviewBridgeGroup,
	createProjectBridgeGroup,
	createPromptBridgeGroup,
	createSessionBridgeGroup,
} from "./workspace-session-handlers.ts";

export interface DesktopShellHandlerServices extends DesktopAppShellBridgeServices {
	promptAttachmentsDir?: string;
}

export interface DesktopAuthHandlerServices {
	testProviderKey?: (provider: string) => Promise<DesktopProviderKeyTestResult>;
}

export interface DesktopEventHandlerServices {
	criteriaFilePath: string;
	eventBroker?: DesktopEventStreamBroker;
	generateText: DesktopEventManagementGenerateText;
}

export interface DesktopAgentHandlerStores {
	eventStore: DesktopEventStore;
	instructionStore?: DesktopInstructionStore;
	projectStore: DesktopProjectStore;
	providerKeysStore: DesktopProviderKeysStore;
	sessionStore: DesktopSessionStore;
	settingsStore: DesktopSettingsStore;
}

export interface DesktopPreviewUrlService {
	createPreviewUrl(path: string): Promise<string>;
}

export interface DesktopAgentHandlerOptions {
	approvalBroker: DesktopApprovalBroker;
	authHandlerServices?: DesktopAuthHandlerServices;
	authService: DesktopAuthService;
	environmentServices?: DesktopEnvironmentBridgeServices;
	eventServices?: DesktopEventHandlerServices;
	getRuntimeCatalog: () => Promise<DesktopRuntimeCatalog>;
	host: DesktopRuntimeHost;
	mcpManager: DesktopMcpManager;
	ptyManager: DesktopPtyManager;
	previewUrlService?: DesktopPreviewUrlService;
	shellServices?: DesktopShellHandlerServices;
	stores: DesktopAgentHandlerStores;
	webPreviewServices?: DesktopWebPreviewBridgeServices;
	workspaceRuntimeServices?: WorkspaceRuntimeHandlerServices;
}

export function registerDesktopAgentHandlers(options: DesktopAgentHandlerOptions): void {
	const { stores } = options;
	const shellServices = options.shellServices ?? {};
	const eventBroker = options.eventServices?.eventBroker ?? new DesktopEventStreamBroker();
	const eventBridge = createEventBridgeGroup({
		eventBroker,
		eventStore: stores.eventStore,
		host: options.host,
		managementServices: options.eventServices
			? {
					criteriaFilePath: options.eventServices.criteriaFilePath,
					generateText: options.eventServices.generateText,
				}
			: undefined,
	});
	const environmentBridge = createEnvironmentBridgeGroup(options.environmentServices);

	registerDesktopBridgeGroup(ipcMain, createAppShellBridgeGroup(shellServices));
	registerDesktopBridgeGroup(ipcMain, createAgentStreamBridgeGroup(options.host));
	registerDesktopBridgeGroup(ipcMain, createApprovalBridgeGroup(options.approvalBroker));
	registerDesktopBridgeGroup(
		ipcMain,
		createAuthBridgeGroup({
			authService: options.authService,
			getRuntimeCatalog: options.getRuntimeCatalog,
			providerKeysStore: stores.providerKeysStore,
			testProviderKey: options.authHandlerServices?.testProviderKey,
		}),
	);
	registerDesktopBridgeGroup(
		ipcMain,
		createCapabilityBridgeGroup({
			approvalBroker: options.approvalBroker,
			host: options.host,
			mcpManager: options.mcpManager,
		}),
	);
	registerDesktopBridgeGroup(ipcMain, environmentBridge.group);
	registerDesktopBridgeGroup(ipcMain, eventBridge.group);
	registerDesktopBridgeGroup(
		ipcMain,
		createPreviewBridgeGroup({
			host: options.host,
			previewUrlService: options.previewUrlService,
		}),
	);
	registerDesktopBridgeGroup(
		ipcMain,
		createProjectBridgeGroup({
			host: options.host,
			ptyManager: options.ptyManager,
		}),
	);
	registerDesktopBridgeGroup(
		ipcMain,
		createPromptBridgeGroup({
			host: options.host,
			promptAttachmentsDir: shellServices.promptAttachmentsDir,
		}),
	);
	registerDesktopBridgeGroup(
		ipcMain,
		createSessionBridgeGroup({
			getRuntimeCatalog: options.getRuntimeCatalog,
			host: options.host,
			instructionStore: stores.instructionStore,
			settingsStore: stores.settingsStore,
		}),
	);
	registerDesktopBridgeGroup(ipcMain, createSettingsBridgeGroup(stores));
	registerDesktopBridgeGroup(
		ipcMain,
		createTerminalBridgeGroup({
			approvalBroker: options.approvalBroker,
			ptyManager: options.ptyManager,
		}),
	);
	registerDesktopBridgeGroup(ipcMain, createWebPreviewBridgeGroup(options.webPreviewServices));

	if (options.workspaceRuntimeServices) {
		registerDesktopBridgeGroup(
			ipcMain,
			createWorkspaceRuntimeBridgeGroup({
				projectStore: stores.projectStore,
				services: options.workspaceRuntimeServices,
			}),
		);
	}

	installAgentLifecycleSideEffects({
		host: options.host,
		onAgentEnd: (sessionId) => eventBridge.markRunAwaitingReviewForSession(sessionId),
		onSubagentActivity: () => environmentBridge.refreshAndPublishResources(),
	});
}
