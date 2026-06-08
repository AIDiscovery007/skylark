import { type DesktopAgentBridge, IPC_CHANNELS } from "../shared/ipc-contract.ts";
import type { SerializedAgentEvent } from "../shared/serialized-agent-event.ts";
import type { SerializedTerminalEvent } from "../shared/serialized-terminal-event.ts";
import type {
	DesktopApprovalEvent,
	DesktopCapabilityEvent,
	DesktopEnvironmentEvent,
	DesktopEventEvent,
	DesktopOAuthLoginEvent,
	DesktopSettingsEvent,
	DesktopSettingsOpenRequest,
	DesktopSubagentRuntimeEvent,
	DesktopWebPreviewEvent,
} from "../shared/types.ts";

export interface BridgeMessageEvent<TData = unknown> {
	data: TData;
}

export interface BridgeMessagePort<TData = unknown> {
	start(): void;
	addEventListener(type: "message", listener: (event: BridgeMessageEvent<TData>) => void): void;
	removeEventListener(type: "message", listener: (event: BridgeMessageEvent<TData>) => void): void;
}

export interface BridgeMessageChannel<TData = unknown> {
	port1: BridgeMessagePort<TData>;
	port2: object;
}

export interface BridgeIpcRenderer {
	invoke(channel: string, ...args: unknown[]): Promise<unknown>;
	off?(channel: string, listener: (event: unknown, request: unknown) => void): void;
	on?(channel: string, listener: (event: unknown, request: unknown) => void): void;
	postMessage(channel: string, message: unknown, transfer: object[]): void;
}

function createDefaultMessageChannel(): BridgeMessageChannel {
	return new MessageChannel() as unknown as BridgeMessageChannel;
}

type DesktopAgentInvokeMethodName = {
	[TName in keyof DesktopAgentBridge]: DesktopAgentBridge[TName] extends (...args: never[]) => Promise<unknown>
		? TName
		: never;
}[keyof DesktopAgentBridge];

interface BridgeInvokeDescriptor {
	channel: (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
	mapArgs?: (...args: unknown[]) => unknown[];
}

const optionalSingleArgument = (value?: unknown): unknown[] => (value === undefined ? [] : [value]);

const BRIDGE_INVOKE_DESCRIPTORS = {
	getWorkspaceOverview: { channel: IPC_CHANNELS.getWorkspaceOverview },
	getSnapshot: { channel: IPC_CHANNELS.getSnapshot },
	getSessionMessages: { channel: IPC_CHANNELS.getSessionMessages },
	getSubagentSnapshot: { channel: IPC_CHANNELS.getSubagentSnapshot },
	getRuntimeCatalog: { channel: IPC_CHANNELS.getRuntimeCatalog },
	getSettings: { channel: IPC_CHANNELS.getSettings },
	setSetting: { channel: IPC_CHANNELS.setSetting },
	listProviderKeys: { channel: IPC_CHANNELS.listProviderKeys },
	setProviderKey: { channel: IPC_CHANNELS.setProviderKey },
	deleteProviderKey: { channel: IPC_CHANNELS.deleteProviderKey },
	testProviderKey: { channel: IPC_CHANNELS.testProviderKey },
	listOAuthProviders: { channel: IPC_CHANNELS.listOAuthProviders },
	startOAuthLogin: { channel: IPC_CHANNELS.startOAuthLogin },
	submitOAuthLoginCode: { channel: IPC_CHANNELS.submitOAuthLoginCode },
	cancelOAuthLogin: { channel: IPC_CHANNELS.cancelOAuthLogin },
	logoutOAuthProvider: { channel: IPC_CHANNELS.logoutOAuthProvider },
	getStorageSecurityState: { channel: IPC_CHANNELS.getStorageSecurityState },
	listCapabilities: { channel: IPC_CHANNELS.listCapabilities },
	getCapabilityDetail: { channel: IPC_CHANNELS.getCapabilityDetail },
	createSkill: { channel: IPC_CHANNELS.createSkill },
	upsertPromptTemplate: { channel: IPC_CHANNELS.upsertPromptTemplate },
	deletePromptTemplate: { channel: IPC_CHANNELS.deletePromptTemplate },
	upsertMcpServer: { channel: IPC_CHANNELS.upsertMcpServer },
	setMcpServerEnabled: { channel: IPC_CHANNELS.setMcpServerEnabled },
	testMcpServer: { channel: IPC_CHANNELS.testMcpServer },
	restartMcpServer: { channel: IPC_CHANNELS.restartMcpServer },
	reloadCapabilities: { channel: IPC_CHANNELS.reloadCapabilities },
	listProjects: { channel: IPC_CHANNELS.listProjects },
	createProjectFromFolder: { channel: IPC_CHANNELS.createProjectFromFolder },
	switchProject: { channel: IPC_CHANNELS.switchProject },
	listSessions: { channel: IPC_CHANNELS.listSessions, mapArgs: optionalSingleArgument },
	newSession: { channel: IPC_CHANNELS.newSession, mapArgs: optionalSingleArgument },
	switchSession: { channel: IPC_CHANNELS.switchSession },
	deleteSession: { channel: IPC_CHANNELS.deleteSession },
	listEnvironmentResources: { channel: IPC_CHANNELS.listEnvironmentResources, mapArgs: optionalSingleArgument },
	detachEnvironmentResource: { channel: IPC_CHANNELS.detachEnvironmentResource },
	listWorkspaceRuntimes: { channel: IPC_CHANNELS.listWorkspaceRuntimes },
	createDebugWorkspaceRuntime: { channel: IPC_CHANNELS.createDebugWorkspaceRuntime },
	openWorkspaceRuntime: { channel: IPC_CHANNELS.openWorkspaceRuntime },
	pauseWorkspaceRuntime: { channel: IPC_CHANNELS.pauseWorkspaceRuntime },
	resumeWorkspaceRuntime: { channel: IPC_CHANNELS.resumeWorkspaceRuntime },
	archiveWorkspaceRuntime: { channel: IPC_CHANNELS.archiveWorkspaceRuntime },
	captureWorkspaceRuntimeContext: { channel: IPC_CHANNELS.captureWorkspaceRuntimeContext },
	takeOverWorkspaceRuntimePane: { channel: IPC_CHANNELS.takeOverWorkspaceRuntimePane },
	sendWorkspaceRuntimePaneText: { channel: IPC_CHANNELS.sendWorkspaceRuntimePaneText },
	returnWorkspaceRuntimePaneControl: { channel: IPC_CHANNELS.returnWorkspaceRuntimePaneControl },
	createTerminal: { channel: IPC_CHANNELS.createTerminal },
	writeTerminal: { channel: IPC_CHANNELS.writeTerminal },
	resizeTerminal: { channel: IPC_CHANNELS.resizeTerminal },
	disposeTerminal: { channel: IPC_CHANNELS.disposeTerminal },
	resolveApproval: { channel: IPC_CHANNELS.resolveApproval },
	getNativeAppearance: { channel: IPC_CHANNELS.getNativeAppearance },
	openSettingsWindow: { channel: IPC_CHANNELS.openSettingsWindow, mapArgs: optionalSingleArgument },
	notifyFirstInteractive: { channel: IPC_CHANNELS.notifyFirstInteractive },
	openExternalUrl: { channel: IPC_CHANNELS.openExternalUrl },
	showWebPreview: { channel: IPC_CHANNELS.showWebPreview },
	updateWebPreviewBounds: { channel: IPC_CHANNELS.updateWebPreviewBounds },
	controlWebPreview: { channel: IPC_CHANNELS.controlWebPreview },
	clearWebPreviewStorage: { channel: IPC_CHANNELS.clearWebPreviewStorage },
	setWebPreviewElementSelectionMode: { channel: IPC_CHANNELS.setWebPreviewElementSelectionMode },
	closeWebPreview: { channel: IPC_CHANNELS.closeWebPreview },
	prompt: { channel: IPC_CHANNELS.prompt },
	preparePromptAttachments: { channel: IPC_CHANNELS.preparePromptAttachments },
	openPromptAttachments: { channel: IPC_CHANNELS.openPromptAttachments },
	listEvents: { channel: IPC_CHANNELS.listEvents, mapArgs: optionalSingleArgument },
	getEvent: { channel: IPC_CHANNELS.getEvent },
	createEvent: { channel: IPC_CHANNELS.createEvent },
	updateEvent: { channel: IPC_CHANNELS.updateEvent },
	addEventComment: { channel: IPC_CHANNELS.addEventComment },
	getEventManagementCriteria: { channel: IPC_CHANNELS.getEventManagementCriteria },
	saveEventManagementCriteria: { channel: IPC_CHANNELS.saveEventManagementCriteria },
	createEventManagementProposal: {
		channel: IPC_CHANNELS.createEventManagementProposal,
		mapArgs: optionalSingleArgument,
	},
	applyEventManagementProposal: { channel: IPC_CHANNELS.applyEventManagementProposal },
	setEventStatus: { channel: IPC_CHANNELS.setEventStatus },
	deleteEvent: { channel: IPC_CHANNELS.deleteEvent },
	prepareEventAttachments: { channel: IPC_CHANNELS.prepareEventAttachments },
	openEventAttachments: { channel: IPC_CHANNELS.openEventAttachments, mapArgs: optionalSingleArgument },
	runEvent: { channel: IPC_CHANNELS.runEvent },
	compact: { channel: IPC_CHANNELS.compact },
	updateSessionProfile: { channel: IPC_CHANNELS.updateSessionProfile },
	setSessionMode: { channel: IPC_CHANNELS.setSessionMode },
	consumeProposedPlan: { channel: IPC_CHANNELS.consumeProposedPlan },
	executePlan: { channel: IPC_CHANNELS.executePlan },
	abort: { channel: IPC_CHANNELS.abort },
	getReviewSnapshot: { channel: IPC_CHANNELS.getReviewSnapshot },
	getReviewFilePatch: { channel: IPC_CHANNELS.getReviewFilePatch },
	openPreviewFiles: { channel: IPC_CHANNELS.openPreviewFiles },
	openWorkspacePreviewFile: { channel: IPC_CHANNELS.openWorkspacePreviewFile },
	listWorkspaceFiles: { channel: IPC_CHANNELS.listWorkspaceFiles },
	refreshPreviewFile: { channel: IPC_CHANNELS.refreshPreviewFile },
} satisfies Record<DesktopAgentInvokeMethodName, BridgeInvokeDescriptor>;

function createInvokeBridgeMethods(
	ipcRenderer: BridgeIpcRenderer,
): Pick<DesktopAgentBridge, DesktopAgentInvokeMethodName> {
	const methods: Partial<Record<DesktopAgentInvokeMethodName, unknown>> = {};
	for (const methodName of Object.keys(BRIDGE_INVOKE_DESCRIPTORS) as DesktopAgentInvokeMethodName[]) {
		const descriptor: BridgeInvokeDescriptor = BRIDGE_INVOKE_DESCRIPTORS[methodName];
		methods[methodName] = async (...args: unknown[]) => {
			const invokeArgs = descriptor.mapArgs ? descriptor.mapArgs(...args) : args;
			return ipcRenderer.invoke(descriptor.channel, ...invokeArgs);
		};
	}
	return methods as Pick<DesktopAgentBridge, DesktopAgentInvokeMethodName>;
}

function subscribeToPort<TData>(port: BridgeMessagePort<TData>, listener: (event: TData) => void): () => void {
	const handleMessage = (event: BridgeMessageEvent<TData>) => {
		listener(event.data);
	};
	port.addEventListener("message", handleMessage);
	return () => port.removeEventListener("message", handleMessage);
}

export function createDesktopAgentBridge(
	ipcRenderer: BridgeIpcRenderer,
	createMessageChannel: () => BridgeMessageChannel = createDefaultMessageChannel,
): DesktopAgentBridge {
	let agentStreamPort: BridgeMessagePort<SerializedAgentEvent> | undefined;
	let terminalStreamPort: BridgeMessagePort<SerializedTerminalEvent> | undefined;
	let authStreamPort: BridgeMessagePort<DesktopOAuthLoginEvent> | undefined;
	let capabilityStreamPort: BridgeMessagePort<DesktopCapabilityEvent> | undefined;
	let approvalStreamPort: BridgeMessagePort<DesktopApprovalEvent> | undefined;
	let eventStreamPort: BridgeMessagePort<DesktopEventEvent> | undefined;
	let settingsStreamPort: BridgeMessagePort<DesktopSettingsEvent> | undefined;
	let environmentStreamPort: BridgeMessagePort<DesktopEnvironmentEvent> | undefined;
	let subagentStreamPort: BridgeMessagePort<DesktopSubagentRuntimeEvent> | undefined;
	let webPreviewStreamPort: BridgeMessagePort<DesktopWebPreviewEvent> | undefined;

	const ensureAgentStreamPort = (): BridgeMessagePort<SerializedAgentEvent> => {
		if (agentStreamPort) {
			return agentStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<SerializedAgentEvent>;
		agentStreamPort = channel.port1;
		agentStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openStream, null, [channel.port2]);
		return agentStreamPort;
	};

	const ensureTerminalStreamPort = (): BridgeMessagePort<SerializedTerminalEvent> => {
		if (terminalStreamPort) {
			return terminalStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<SerializedTerminalEvent>;
		terminalStreamPort = channel.port1;
		terminalStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openTerminalStream, null, [channel.port2]);
		return terminalStreamPort;
	};

	const ensureAuthStreamPort = (): BridgeMessagePort<DesktopOAuthLoginEvent> => {
		if (authStreamPort) {
			return authStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopOAuthLoginEvent>;
		authStreamPort = channel.port1;
		authStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openAuthStream, null, [channel.port2]);
		return authStreamPort;
	};

	const ensureCapabilityStreamPort = (): BridgeMessagePort<DesktopCapabilityEvent> => {
		if (capabilityStreamPort) {
			return capabilityStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopCapabilityEvent>;
		capabilityStreamPort = channel.port1;
		capabilityStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openCapabilityStream, null, [channel.port2]);
		return capabilityStreamPort;
	};

	const ensureApprovalStreamPort = (): BridgeMessagePort<DesktopApprovalEvent> => {
		if (approvalStreamPort) {
			return approvalStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopApprovalEvent>;
		approvalStreamPort = channel.port1;
		approvalStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openApprovalStream, null, [channel.port2]);
		return approvalStreamPort;
	};

	const ensureEventStreamPort = (): BridgeMessagePort<DesktopEventEvent> => {
		if (eventStreamPort) {
			return eventStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopEventEvent>;
		eventStreamPort = channel.port1;
		eventStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openEventStream, null, [channel.port2]);
		return eventStreamPort;
	};

	const ensureSettingsStreamPort = (): BridgeMessagePort<DesktopSettingsEvent> => {
		if (settingsStreamPort) {
			return settingsStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopSettingsEvent>;
		settingsStreamPort = channel.port1;
		settingsStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openSettingsStream, null, [channel.port2]);
		return settingsStreamPort;
	};

	const ensureEnvironmentStreamPort = (): BridgeMessagePort<DesktopEnvironmentEvent> => {
		if (environmentStreamPort) {
			return environmentStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopEnvironmentEvent>;
		environmentStreamPort = channel.port1;
		environmentStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openEnvironmentStream, null, [channel.port2]);
		return environmentStreamPort;
	};

	const ensureSubagentStreamPort = (): BridgeMessagePort<DesktopSubagentRuntimeEvent> => {
		if (subagentStreamPort) {
			return subagentStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopSubagentRuntimeEvent>;
		subagentStreamPort = channel.port1;
		subagentStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openSubagentStream, null, [channel.port2]);
		return subagentStreamPort;
	};

	const ensureWebPreviewStreamPort = (): BridgeMessagePort<DesktopWebPreviewEvent> => {
		if (webPreviewStreamPort) {
			return webPreviewStreamPort;
		}

		const channel = createMessageChannel() as BridgeMessageChannel<DesktopWebPreviewEvent>;
		webPreviewStreamPort = channel.port1;
		webPreviewStreamPort.start();
		ipcRenderer.postMessage(IPC_CHANNELS.openWebPreviewStream, null, [channel.port2]);
		return webPreviewStreamPort;
	};

	const invokeMethods = createInvokeBridgeMethods(ipcRenderer);

	return {
		...invokeMethods,
		subscribeToSettingsOpenRequests(listener: (request: DesktopSettingsOpenRequest) => void): () => void {
			if (!ipcRenderer.on) {
				return () => undefined;
			}
			const handler = (_event: unknown, request: unknown): void => {
				listener((request ?? {}) as DesktopSettingsOpenRequest);
			};
			ipcRenderer.on(IPC_CHANNELS.settingsNavigationRequest, handler);
			return () => ipcRenderer.off?.(IPC_CHANNELS.settingsNavigationRequest, handler);
		},
		subscribeToWebPreviewEvents(listener: (event: DesktopWebPreviewEvent) => void): () => void {
			return subscribeToPort(ensureWebPreviewStreamPort(), listener);
		},
		subscribeToAgentEvents(listener: (event: SerializedAgentEvent) => void): () => void {
			return subscribeToPort(ensureAgentStreamPort(), listener);
		},
		subscribeToTerminalEvents(listener: (event: SerializedTerminalEvent) => void): () => void {
			return subscribeToPort(ensureTerminalStreamPort(), listener);
		},
		subscribeToAuthEvents(listener: (event: DesktopOAuthLoginEvent) => void): () => void {
			return subscribeToPort(ensureAuthStreamPort(), listener);
		},
		subscribeToCapabilityEvents(listener: (event: DesktopCapabilityEvent) => void): () => void {
			return subscribeToPort(ensureCapabilityStreamPort(), listener);
		},
		subscribeToApprovalEvents(listener: (event: DesktopApprovalEvent) => void): () => void {
			return subscribeToPort(ensureApprovalStreamPort(), listener);
		},
		subscribeToEventEvents(listener: (event: DesktopEventEvent) => void): () => void {
			return subscribeToPort(ensureEventStreamPort(), listener);
		},
		subscribeToSettingsEvents(listener: (event: DesktopSettingsEvent) => void): () => void {
			return subscribeToPort(ensureSettingsStreamPort(), listener);
		},
		subscribeToEnvironmentEvents(listener: (event: DesktopEnvironmentEvent) => void): () => void {
			return subscribeToPort(ensureEnvironmentStreamPort(), listener);
		},
		subscribeToSubagentEvents(listener: (event: DesktopSubagentRuntimeEvent) => void): () => void {
			return subscribeToPort(ensureSubagentStreamPort(), listener);
		},
	};
}
