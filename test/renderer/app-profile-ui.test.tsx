import { readFileSync } from "node:fs";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App.tsx";
import { TooltipProvider } from "../../src/renderer/components/ui/tooltip.tsx";
import { INITIAL_AGENT_RENDERER_STATE } from "../../src/renderer/lib/conversation-timeline-projection.ts";
import { resolveSidebarSessionsByProjectId } from "../../src/renderer/lib/main-workbench-coordination.ts";
import { agentStore } from "../../src/renderer/stores/agent-store.ts";
import { approvalStore } from "../../src/renderer/stores/approval-store.ts";
import { capabilitiesStore } from "../../src/renderer/stores/capabilities-store.ts";
import { projectStore } from "../../src/renderer/stores/project-store.ts";
import { sessionStore } from "../../src/renderer/stores/session-store.ts";
import { settingsStore } from "../../src/renderer/stores/settings-store.ts";
import type { DesktopAgentBridge } from "../../src/shared/ipc-contract.ts";
import type { DesktopAgentSnapshot, SerializedAgentEvent } from "../../src/shared/serialized-agent-event.ts";
import type {
	DesktopApprovalEvent,
	DesktopCapabilityCatalog,
	DesktopEnvironmentResource,
	DesktopEventSummary,
	DesktopOAuthLoginEvent,
	DesktopProjectSummary,
	DesktopReviewSnapshot,
	DesktopSessionProfileUpdateRequest,
	DesktopSessionSummary,
} from "../../src/shared/types.ts";

const activeSession: DesktopSessionSummary = {
	id: "session-1",
	title: "E2E profile session",
	cwd: "/workspace/project",
	createdAt: "2026-04-25T08:00:00.000Z",
	updatedAt: "2026-04-25T08:30:00.000Z",
	messageCount: 1,
	agentMode: "execute",
	provider: "kimi-coding",
	modelId: "kimi-for-coding",
};

const activeProject: DesktopProjectSummary = {
	id: "project-1",
	name: "project",
	cwd: "/workspace/project",
	createdAt: "2026-04-25T07:00:00.000Z",
	updatedAt: "2026-04-25T08:30:00.000Z",
	sessionCount: 1,
	lastOpenedSessionId: "session-1",
};

const baseSnapshot: DesktopAgentSnapshot = {
	sessionId: "session-1",
	cwd: "/workspace/project",
	agentMode: "execute",
	diagnostics: [],
	model: {
		id: "kimi-for-coding",
		name: "kimi-for-coding",
		provider: "kimi-coding",
		reasoning: true,
		contextWindow: 128000,
	},
	thinkingLevel: "low",
	availableTools: ["read", "bash", "edit", "write"],
	messages: [{ role: "user", content: "hello", timestamp: 1 }],
	pendingToolCalls: [],
	isStreaming: false,
};

function createCompactionSummaryMessage(summary: string, timestamp: number): AgentMessage {
	return {
		role: "compactionSummary" as const,
		summary,
		tokensBefore: 42_000,
		timestamp,
	} as unknown as AgentMessage;
}

const cleanReviewSnapshot: DesktopReviewSnapshot = {
	status: "clean",
	cwd: activeProject.cwd,
	repositoryRoot: activeProject.cwd,
	branch: "main",
	files: [],
	totals: { files: 0, additions: 0, deletions: 0 },
	generatedAt: "2026-05-01T00:00:00.000Z",
	actions: {
		commit: false,
		push: false,
		createPullRequest: false,
		createBranch: false,
		reason: "只读审查模式暂不执行 Git 写操作。",
	},
};

const environmentResource: DesktopEnvironmentResource = {
	id: "env_tmux_progress",
	sessionId: "session-1",
	cwd: "/workspace/project",
	kind: "tmux_session",
	provider: "tmux",
	title: "Workspace progress",
	status: "running",
	metadata: {
		tmuxSessionName: "pi_session_progress",
	},
	createdAt: "2026-05-20T08:00:00.000Z",
	updatedAt: "2026-05-20T08:30:00.000Z",
	lastSeenAt: "2026-05-20T08:30:00.000Z",
};

const terminalMocks = vi.hoisted(() => {
	class MockTerminal {
		static instances: MockTerminal[] = [];
		cols = 80;
		rows = 24;

		constructor() {
			MockTerminal.instances.push(this);
		}

		loadAddon(_addon: unknown): void {}

		open(_element: HTMLElement): void {}

		focus(): void {}

		write(_data: string): void {}

		onData(_handler: (data: string) => void): { dispose: () => void } {
			return {
				dispose: () => undefined,
			};
		}

		dispose(): void {}
	}

	class MockFitAddon {
		fit(): void {}
	}

	return { MockFitAddon, MockTerminal };
});

vi.mock("@xterm/xterm", () => ({ Terminal: terminalMocks.MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: terminalMocks.MockFitAddon }));

function resetStores(): void {
	agentStore.setState({
		...INITIAL_AGENT_RENDERER_STATE,
		activeSessionId: undefined,
		sessionStateAccessedAt: {},
		sessionStates: {},
	});
	projectStore.setState({
		projects: [],
		sessionsByProjectId: {},
		activeProjectId: undefined,
		isLoading: false,
		isCreating: false,
		isSwitching: false,
		errorMessage: undefined,
	});
	sessionStore.setState({
		sessions: [],
		projectId: undefined,
		activeSessionId: undefined,
		hasLoadedProjectSessions: false,
		isLoading: false,
		isCreating: false,
		isSwitching: false,
		isDeleting: false,
		errorMessage: undefined,
	});
	settingsStore.setState({
		settings: {},
		runtimeCatalog: undefined,
		providerKeys: [],
		oauthProviders: [],
		oauthLogin: { isSigningIn: false },
		storageSecurityState: undefined,
		hasLoadedSettings: false,
		hasLoadedDetails: false,
		isLoading: false,
		isSaving: false,
		errorMessage: undefined,
	});
	capabilitiesStore.setState({
		catalog: {
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		},
		hasLoaded: false,
		isLoading: false,
		isSaving: false,
		errorMessage: undefined,
	});
	approvalStore.getState().resetApprovals();
}

async function waitForMs(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferredPromise<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
}

function installDesktopAgentBridge(overrides: Partial<DesktopAgentBridge> = {}) {
	const getSnapshot = vi.fn(async () => baseSnapshot);
	const listSessions = vi.fn(async (_projectId?: string) => [activeSession]);
	const getSettings = vi.fn(async () => ({
		lastOpenedProjectId: "project-1",
		lastOpenedSessionId: "session-1",
		showThinkingBlocks: true,
	}));
	const listProjects = vi.fn(async () => [activeProject]);
	const updateSessionProfile = vi.fn(async (request: DesktopSessionProfileUpdateRequest) => ({
		...baseSnapshot,
		thinkingLevel: request.thinkingLevel ?? baseSnapshot.thinkingLevel,
	}));
	const getWorkspaceOverview = vi.fn(async () => {
		const settings = overrides.getSettings ? await overrides.getSettings() : await getSettings();
		const projects = overrides.listProjects ? await overrides.listProjects() : await listProjects();
		const activeProjectId = settings.lastOpenedProjectId ?? projects[0]?.id;
		const activeSessions = activeProjectId
			? overrides.listSessions
				? await overrides.listSessions(activeProjectId)
				: await listSessions(activeProjectId)
			: [];
		return {
			settings,
			projects,
			sessionsByProjectId: activeProjectId ? { [activeProjectId]: activeSessions } : {},
			activeProjectId,
			activeSessionId: settings.lastOpenedSessionId ?? activeSessions[0]?.id,
		};
	});
	const bridge: DesktopAgentBridge = {
		getWorkspaceOverview,
		getSnapshot,
		getRuntimeCatalog: vi.fn(async () => ({
			defaultTools: ["read", "bash", "edit", "write"],
			providers: [
				{
					id: "kimi-coding",
					name: "Kimi For Coding",
					configured: true,
					authMethods: ["api_key" as const],
					models: [
						{
							id: "kimi-for-coding",
							name: "kimi-for-coding",
							reasoning: true,
							contextWindow: 128000,
						},
					],
				},
			],
		})),
		getSettings,
		setSetting: vi.fn(async () => undefined),
		listProviderKeys: vi.fn(async () => [{ provider: "kimi-coding", configured: true }]),
		listOAuthProviders: vi.fn(async () => []),
		setProviderKey: vi.fn(async () => undefined),
		deleteProviderKey: vi.fn(async () => undefined),
		startOAuthLogin: vi.fn(async () => undefined),
		submitOAuthLoginCode: vi.fn(async () => undefined),
		cancelOAuthLogin: vi.fn(async () => undefined),
		logoutOAuthProvider: vi.fn(async () => undefined),
		subscribeToAuthEvents: vi.fn(() => () => undefined),
		getStorageSecurityState: vi.fn(async () => ({
			secureStorageAvailable: true,
			providerKeysEncrypted: true,
		})),
		getReviewSnapshot: vi.fn(async () => cleanReviewSnapshot),
		getSubagentSnapshot: vi.fn(async () => {
			throw new Error("unused");
		}),
		listCapabilities: vi.fn(async () => ({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		})),
		getCapabilityDetail: vi.fn(async () => ({
			type: "skill" as const,
			name: "empty",
			description: "Empty capability",
			body: "",
			filePath: "/workspace/.pi/skills/empty/SKILL.md",
			disableModelInvocation: false,
			source: { label: "project", scope: "project" as const },
		})),
		createSkill: vi.fn(async () => ({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		})),
		upsertPromptTemplate: vi.fn(async () => ({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		})),
		deletePromptTemplate: vi.fn(async () => ({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		})),
		upsertMcpServer: vi.fn(async () => ({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		})),
		setMcpServerEnabled: vi.fn(async () => ({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		})),
		testMcpServer: vi.fn(async () => {
			throw new Error("unused");
		}),
		restartMcpServer: vi.fn(async () => ({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		})),
		reloadCapabilities: vi.fn(async () => ({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		})),
		listProjects,
		createProjectFromFolder: vi.fn(async () => activeProject),
		switchProject: vi.fn(async () => activeProject),
		listSessions,
		newSession: vi.fn(async () => activeSession),
		switchSession: vi.fn(async () => activeSession),
		deleteSession: vi.fn(async () => activeSession),
		listEnvironmentResources: vi.fn(async () => []),
		detachEnvironmentResource: vi.fn(async () => environmentResource),
		listWorkspaceRuntimes: vi.fn(async () => []),
		createDebugWorkspaceRuntime: vi.fn(async () => {
			throw new Error("unused");
		}),
		openWorkspaceRuntime: vi.fn(async () => {
			throw new Error("unused");
		}),
		pauseWorkspaceRuntime: vi.fn(async () => {
			throw new Error("unused");
		}),
		resumeWorkspaceRuntime: vi.fn(async () => {
			throw new Error("unused");
		}),
		archiveWorkspaceRuntime: vi.fn(async () => {
			throw new Error("unused");
		}),
		captureWorkspaceRuntimeContext: vi.fn(async () => {
			throw new Error("unused");
		}),
		takeOverWorkspaceRuntimePane: vi.fn(async () => {
			throw new Error("unused");
		}),
		sendWorkspaceRuntimePaneText: vi.fn(async () => {
			throw new Error("unused");
		}),
		returnWorkspaceRuntimePaneControl: vi.fn(async () => {
			throw new Error("unused");
		}),
		createTerminal: vi.fn(async () => undefined),
		writeTerminal: vi.fn(async () => undefined),
		resizeTerminal: vi.fn(async () => undefined),
		disposeTerminal: vi.fn(async () => undefined),
		resolveApproval: vi.fn(async () => undefined),
		prompt: vi.fn(async () => undefined),
		preparePromptAttachments: vi.fn(async () => ({ attachments: [], errors: [] })),
		openPromptAttachments: vi.fn(async () => ({ attachments: [], errors: [] })),
		listEvents: vi.fn(async () => []),
		getEvent: vi.fn(async () => undefined),
		createEvent: vi.fn(async () => {
			throw new Error("unused");
		}),
		updateEvent: vi.fn(async () => {
			throw new Error("unused");
		}),
		addEventComment: vi.fn(async () => {
			throw new Error("unused");
		}),
		getEventManagementCriteria: vi.fn(async () => ({
			path: "/Users/qiaochao/.skylark/events/EVENTS.md",
			content: "P0 means blocker.",
		})),
		saveEventManagementCriteria: vi.fn(async (request) => ({
			path: "/Users/qiaochao/.skylark/events/EVENTS.md",
			content: request.content,
		})),
		createEventManagementProposal: vi.fn(async () => ({
			id: "proposal-1",
			items: [],
			createdAt: "2026-05-21T00:00:00.000Z",
			criteriaPath: "/Users/qiaochao/.skylark/events/EVENTS.md",
		})),
		applyEventManagementProposal: vi.fn(async () => []),
		setEventStatus: vi.fn(async () => {
			throw new Error("unused");
		}),
		deleteEvent: vi.fn(async () => undefined),
		openEventAttachments: vi.fn(async () => ({ attachments: [], errors: [] })),
		prepareEventAttachments: vi.fn(async () => ({ attachments: [], errors: [] })),
		runEvent: vi.fn(async () => {
			throw new Error("unused");
		}),
		compact: vi.fn(async () => baseSnapshot),
		updateSessionProfile,
		setSessionMode: vi.fn(async (request) => ({ ...baseSnapshot, agentMode: request.agentMode })),
		consumeProposedPlan: vi.fn(async () => baseSnapshot),
		executePlan: vi.fn(async () => ({ ...baseSnapshot, agentMode: "execute" as const })),
		abort: vi.fn(async () => undefined),
		getNativeAppearance: vi.fn(async () => ({
			accentColor: "#0a84ff",
			colorScheme: "light" as const,
			forcedColors: false,
			highContrast: false,
			invertedColors: false,
			reducedTransparency: false,
		})),
		notifyFirstInteractive: vi.fn(async () => undefined),
		openExternalUrl: vi.fn(async () => undefined),
		openSettingsWindow: vi.fn(async () => undefined),
		openPreviewFiles: vi.fn(async () => []),
		openWorkspacePreviewFile: vi.fn(async () => ({
			path: "/workspace/project/src/App.tsx",
			name: "App.tsx",
			mimeType: "text/typescript",
			size: 24,
			kind: "text" as const,
			content: "export const app = true;\n",
			updatedAt: "2026-05-01T00:00:00.000Z",
		})),
		refreshPreviewFile: vi.fn(async () => {
			throw new Error("unused");
		}),
		subscribeToAgentEvents: vi.fn(() => () => undefined),
		subscribeToApprovalEvents: vi.fn(() => () => undefined),
		subscribeToCapabilityEvents: vi.fn(() => () => undefined),
		subscribeToEnvironmentEvents: vi.fn(() => () => undefined),
		subscribeToEventEvents: vi.fn(() => () => undefined),
		subscribeToSettingsEvents: vi.fn(() => () => undefined),
		subscribeToSettingsOpenRequests: vi.fn(() => () => undefined),
		subscribeToSubagentEvents: vi.fn(() => () => undefined),
		subscribeToTerminalEvents: vi.fn(() => () => undefined),
		subscribeToWorkspaceRuntimeEvents: vi.fn(() => () => undefined),
		...overrides,
		listWorkspaceFiles: overrides.listWorkspaceFiles ?? vi.fn(async () => ({ files: [], truncated: false })),
		testProviderKey:
			overrides.testProviderKey ??
			vi.fn(async (provider: string) => ({
				provider,
				ok: true,
				message: "连接正常",
			})),
	};

	Object.defineProperty(window, "desktopAgent", {
		configurable: true,
		value: bridge,
	});

	return { bridge, getSnapshot, listSessions, updateSessionProfile };
}

function getTopNewConversationButton(): HTMLElement {
	const button = screen.getAllByRole("button", { name: "新对话" })[0];
	if (!button) {
		throw new Error("Expected top new conversation button.");
	}
	return button;
}

function getSidebarSessionButton(name: RegExp): HTMLElement {
	const button = screen
		.getAllByRole("button", { name })
		.find((candidate) => candidate.getAttribute("aria-label")?.startsWith("删除对话") !== true);
	if (!button) {
		throw new Error(`Expected sidebar session button matching ${name.toString()}.`);
	}
	return button;
}

function getSidebarSessionOrder(titles: string[]): string[] {
	const projectTree = document.querySelector(".sidebar-project-tree");
	if (!projectTree) {
		throw new Error("Expected sidebar project tree.");
	}

	return Array.from(projectTree.querySelectorAll("button")).flatMap((button) => {
		const buttonText = button.textContent ?? "";
		return titles.filter((title) => buttonText.includes(title));
	});
}

beforeEach(() => {
	window.history.replaceState(null, "", "/");
	resetStores();
});

afterEach(() => {
	cleanup();
	terminalMocks.MockTerminal.instances.length = 0;
	resetStores();
	vi.useRealTimers();
	Reflect.deleteProperty(window, "desktopAgent");
});

describe("App profile controls", () => {
	it("renders an explicit preload bridge error instead of white screening", () => {
		render(<App />);

		expect(screen.getByRole("alert").textContent).toContain("Desktop bridge unavailable");
		expect(screen.getByText(/Renderer preload bridge is unavailable/i)).toBeTruthy();
	});

	it("keeps non-first-screen workbench surfaces on lazy renderer boundaries", () => {
		const source = readFileSync("src/renderer/App.tsx", "utf8");
		const styleSource = readFileSync("src/renderer/styles/globals.css", "utf8");

		expect(source).toContain("const CapabilitiesPage = lazy");
		expect(source).toContain("const EventsPage = lazy");
		expect(source).toContain("const ReviewWorkspacePanel = lazy");
		expect(source).toContain("const SettingsPage = lazy");
		expect(source).toContain("preloadCapabilitiesPage");
		expect(source).toContain("preloadEventsPage");
		expect(source).toContain("preloadReviewWorkspacePanel");
		expect(source).toContain('data-slot="lazy-boundary-fallback"');
		expect(source).not.toContain('fallback={<LazyWorkbenchFallback label="Loading capabilities" />}');
		expect(source).not.toContain('fallback={<LazyWorkbenchFallback label="Loading events" />}');
		expect(source).toContain('data-slot="workbench-view-stack"');
		expect(source).toContain('data-slot="chat-workbench-view"');
		expect(source).toContain('data-slot="capabilities-workbench-view"');
		expect(source).toContain('data-sidebar-attachment={isSidebarCollapsed ? "detached" : "attached"}');
		expect(source).toContain('data-slot="review-fullscreen-titlebar-summary"');
		expect(source).toContain("data-review-attachment={");
		expect(source).toContain('isReviewOpen && !isReviewFullscreenActive ? "attached" : "detached"');
		expect(styleSource).toContain('[data-slot="main-workbench-panel"][data-sidebar-attachment="attached"]');
		expect(styleSource).toContain("border-top-left-radius: 0");
		expect(styleSource).toContain("border-bottom-left-radius: 0");
		expect(styleSource).toContain("border-left-color: transparent");
		expect(styleSource).toContain('[data-slot="main-workbench-panel"][data-review-attachment="attached"]');
		expect(styleSource).toContain("border-top-right-radius: 0");
		expect(styleSource).toContain("border-bottom-right-radius: 0");
		expect(styleSource).toContain("border-right-color: transparent");
		expect(styleSource).toContain('[data-slot="review-workspace-panel"][data-workbench-attachment="attached"]');
		expect(source).not.toContain('mode="wait"');
		expect(source).not.toContain("import { CapabilitiesPage }");
		expect(source).not.toContain("import { EventsPage }");
		expect(source).not.toContain("import { ReviewWorkspacePanel }");
		expect(source).not.toContain("import { SettingsPage }");
	});

	it("keeps chat visible while prewarming the capabilities view", async () => {
		const user = userEvent.setup();
		const catalogLoad = createDeferredPromise<DesktopCapabilityCatalog>();
		const listCapabilities = vi.fn(async () => catalogLoad.promise);
		installDesktopAgentBridge({ listCapabilities });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: "能力库" }));

		await waitFor(() => expect(listCapabilities).toHaveBeenCalled());
		expect(document.querySelector("[data-slot='chat-workbench-view']")?.getAttribute("data-view-state")).toBe(
			"active",
		);
		expect(document.querySelector("[data-slot='capabilities-workbench-view']")?.getAttribute("data-view-state")).toBe(
			"inactive",
		);
		expect(document.querySelector("[data-slot='lazy-boundary-fallback']")).toBeNull();

		catalogLoad.resolve({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		});

		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='capabilities-workbench-view']")?.getAttribute("data-view-state"),
			).toBe("active");
		});
		expect(screen.getByRole("heading", { name: "Agent 能力库" })).toBeTruthy();
	});

	it("loads the provider catalog on the chat first screen", async () => {
		const { bridge } = installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");

		await waitFor(() => {
			expect(bridge.getRuntimeCatalog).toHaveBeenCalled();
			expect(bridge.listProviderKeys).toHaveBeenCalled();
			expect(bridge.listOAuthProviders).toHaveBeenCalled();
		});
	});

	it("opens Settings credentials for an unconfigured chat provider", async () => {
		const user = userEvent.setup();
		const openSettingsWindow = vi.fn(async () => undefined);
		installDesktopAgentBridge({
			getRuntimeCatalog: vi.fn(async () => ({
				defaultTools: ["read", "bash"],
				providers: [
					{
						id: "kimi-coding",
						name: "Kimi For Coding",
						configured: true,
						authMethods: ["api_key" as const],
						models: [
							{
								id: "kimi-for-coding",
								name: "kimi-for-coding",
								reasoning: true,
								contextWindow: 128000,
							},
						],
					},
					{
						id: "openai",
						name: "OpenAI",
						configured: false,
						authMethods: ["api_key" as const],
						models: [{ id: "gpt-5.5", name: "GPT-5.5", reasoning: true, contextWindow: 400000 }],
					},
				],
			})),
			openSettingsWindow,
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByLabelText("Model kimi-coding / kimi-for-coding"));
		await user.click(screen.getByRole("option", { name: /GPT-5\.5.*OpenAI.*未配置/i }));

		expect(openSettingsWindow).toHaveBeenCalledWith({ section: "credentials", providerId: "openai" });
	});

	it("keeps settings navigation requests out of the main chat window", async () => {
		let settingsOpenListener: ((request: { section: "credentials"; providerId: string }) => void) | undefined;
		installDesktopAgentBridge({
			subscribeToSettingsOpenRequests: vi.fn((listener) => {
				settingsOpenListener = listener;
				return () => undefined;
			}),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");

		act(() => {
			settingsOpenListener?.({ section: "credentials", providerId: "openai" });
		});

		expect(document.querySelector("[data-slot='chat-workbench-view']")?.getAttribute("data-view-state")).toBe(
			"active",
		);
		expect(document.querySelector("[data-slot='desktop-settings-shell']")).toBeNull();
	});

	it("refreshes the chat provider catalog after credential changes", async () => {
		let authListener: ((event: DesktopOAuthLoginEvent) => void) | undefined;
		const listProviderKeys = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ provider: "openai", configured: true }]);
		const subscribeToAuthEvents = vi.fn((listener: (event: DesktopOAuthLoginEvent) => void) => {
			authListener = listener;
			return () => undefined;
		});
		installDesktopAgentBridge({
			listProviderKeys,
			subscribeToAuthEvents,
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await waitFor(() => expect(listProviderKeys).toHaveBeenCalledTimes(1));

		act(() => {
			authListener?.({ type: "credentials_changed", provider: "openai" });
		});

		await waitFor(() => expect(listProviderKeys).toHaveBeenCalledTimes(2));
	});

	it("keeps chat visible while prewarming the events view", async () => {
		const user = userEvent.setup();
		const firstInteractive = createDeferredPromise<void>();
		const eventsLoad = createDeferredPromise<DesktopEventSummary[]>();
		const listEvents = vi.fn(async () => eventsLoad.promise);
		installDesktopAgentBridge({
			listEvents,
			notifyFirstInteractive: vi.fn(async () => firstInteractive.promise),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: "事件" }));

		await waitFor(() => expect(listEvents).toHaveBeenCalled());
		expect(document.querySelector("[data-slot='chat-workbench-view']")?.getAttribute("data-view-state")).toBe(
			"active",
		);
		expect(document.querySelector("[data-slot='events-workbench-view']")?.getAttribute("data-view-state")).toBe(
			"inactive",
		);
		expect(document.querySelector("[data-slot='lazy-boundary-fallback']")).toBeNull();

		eventsLoad.resolve([]);

		await waitFor(() => {
			expect(document.querySelector("[data-slot='events-workbench-view']")?.getAttribute("data-view-state")).toBe(
				"active",
			);
		});
		expect(screen.getByRole("heading", { name: "事件" })).toBeTruthy();
	});

	it("reports first interactive before non-first-screen event loading", async () => {
		const { bridge } = installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await waitFor(() => {
			expect(bridge.notifyFirstInteractive).toHaveBeenCalled();
			expect(bridge.listEvents).toHaveBeenCalled();
		});
		const [firstInteractiveOrder] = vi.mocked(bridge.notifyFirstInteractive).mock.invocationCallOrder;
		const [eventLoadOrder] = vi.mocked(bridge.listEvents).mock.invocationCallOrder;

		expect(firstInteractiveOrder).toBeLessThan(eventLoadOrder);
	});

	it("does not mount active session cache under a different active project", () => {
		const sessionsByProjectId = resolveSidebarSessionsByProjectId(
			{
				"project-1": [activeSession],
				"project-2": [],
			},
			"project-2",
			"project-1",
			[activeSession],
		);

		expect(sessionsByProjectId["project-2"]).toEqual([]);
		expect(sessionsByProjectId["project-1"]).toEqual([activeSession]);
	});

	it("keeps target project sidebar session order when selecting across projects", async () => {
		const user = userEvent.setup();
		const downloadsProject: DesktopProjectSummary = {
			id: "project-2",
			name: "Downloads",
			cwd: "/workspace/downloads",
			createdAt: "2026-04-25T07:30:00.000Z",
			updatedAt: "2026-04-25T08:00:00.000Z",
			sessionCount: 3,
			lastOpenedSessionId: "session-downloads-hello",
		};
		const helloSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-downloads-hello",
			title: "Hello",
			cwd: downloadsProject.cwd,
			createdAt: "2026-04-25T08:00:00.000Z",
			updatedAt: "2026-04-25T10:00:00.000Z",
		};
		const snakeSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-downloads-snake",
			title: "Snake",
			cwd: downloadsProject.cwd,
			createdAt: "2026-04-25T08:30:00.000Z",
			updatedAt: "2026-04-25T09:30:00.000Z",
		};
		const htmlSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-downloads-html",
			title: "HTML",
			cwd: downloadsProject.cwd,
			createdAt: "2026-04-24T08:00:00.000Z",
			updatedAt: "2026-04-24T09:00:00.000Z",
		};
		const projectSessions = [helloSession, snakeSession, htmlSession];
		const projects = [activeProject, downloadsProject];
		const getSettings = vi.fn(async () => ({
			lastOpenedProjectId: activeProject.id,
			lastOpenedSessionId: activeSession.id,
			showThinkingBlocks: true,
		}));
		const getWorkspaceOverview = vi.fn(async () => ({
			settings: await getSettings(),
			projects,
			sessionsByProjectId: {
				[activeProject.id]: [activeSession],
				[downloadsProject.id]: projectSessions,
			},
			activeProjectId: activeProject.id,
			activeSessionId: activeSession.id,
		}));
		const listProjects = vi.fn(async () => projects);
		const listSessions = vi.fn(async (projectId?: string) =>
			projectId === downloadsProject.id ? projectSessions : [activeSession],
		);
		const switchProject = vi.fn(async (projectId: string) =>
			projectId === downloadsProject.id ? downloadsProject : activeProject,
		);
		const switchSession = vi.fn(async () => ({
			...snakeSession,
			updatedAt: "2026-04-25T10:30:00.000Z",
		}));
		const getSnapshot = vi.fn(async (sessionId?: string) =>
			sessionId === snakeSession.id ? { ...baseSnapshot, sessionId: snakeSession.id } : baseSnapshot,
		);
		installDesktopAgentBridge({
			getSettings,
			getSnapshot,
			getWorkspaceOverview,
			listProjects,
			listSessions,
			switchProject,
			switchSession,
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("Hello");
		expect(getSidebarSessionOrder(["Hello", "Snake", "HTML"])).toEqual(["Hello", "Snake", "HTML"]);

		await user.click(getSidebarSessionButton(/Snake/i));

		await waitFor(() => expect(switchProject).toHaveBeenCalledWith(downloadsProject.id));
		await waitFor(() => expect(switchSession).toHaveBeenCalledWith(snakeSession.id));
		expect(getSidebarSessionOrder(["Hello", "Snake", "HTML"])).toEqual(["Hello", "Snake", "HTML"]);
	});

	it("updates thinking level without refreshing the session list", async () => {
		const user = userEvent.setup();
		const { listSessions, updateSessionProfile } = installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByLabelText("Thinking low");
		await waitFor(() => {
			expect(listSessions).toHaveBeenCalled();
		});
		const initialListSessionCalls = listSessions.mock.calls.length;

		await user.click(screen.getByLabelText("Thinking low"));
		await user.click(screen.getByRole("button", { name: /^high$/i }));

		await waitFor(() => {
			expect(updateSessionProfile).toHaveBeenCalledWith({
				sessionId: "session-1",
				thinkingLevel: "high",
			});
			expect(screen.getByLabelText("Thinking high")).toBeTruthy();
		});
		expect(listSessions).toHaveBeenCalledTimes(initialListSessionCalls);
	});

	it("refreshes the active transcript with the selected session id", async () => {
		const { getSnapshot } = installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");

		await waitFor(() => {
			expect(getSnapshot).toHaveBeenCalledWith("session-1");
		});
		expect(getSnapshot).not.toHaveBeenCalledWith();
	});

	it("routes sidebar project new-session actions through chat activation and snapshot hydration", async () => {
		const user = userEvent.setup();
		const runningSession: DesktopSessionSummary = {
			...activeSession,
			isStreaming: true,
			runStartedAt: "2026-04-25T08:29:00.000Z",
		};
		const createdSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-created",
			title: "New Session",
			createdAt: "2026-04-25T08:31:00.000Z",
			updatedAt: "2026-04-25T08:31:00.000Z",
			messageCount: 0,
			isStreaming: false,
			runStartedAt: undefined,
		};
		let hasCreatedSession = false;
		const listSessions = vi.fn(async () => (hasCreatedSession ? [createdSession, runningSession] : [runningSession]));
		const newSession = vi.fn(async () => {
			hasCreatedSession = true;
			return createdSession;
		});
		const getSnapshot = vi.fn(async (sessionId?: string) => ({
			...baseSnapshot,
			sessionId: sessionId ?? runningSession.id,
			messages: sessionId === createdSession.id ? [] : baseSnapshot.messages,
			isStreaming: sessionId === runningSession.id,
		}));
		installDesktopAgentBridge({ getSnapshot, listSessions, newSession });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: "事件" }));
		expect(await screen.findByRole("heading", { name: "待评估" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: `在 ${activeProject.name} 中新建对话` }));

		await waitFor(() => expect(newSession).toHaveBeenCalledWith(activeProject.id));
		await waitFor(() => expect(getSnapshot).toHaveBeenCalledWith(createdSession.id));
		await waitFor(() => {
			expect(document.querySelector("[data-slot='chat-workbench-view']")?.getAttribute("data-view-state")).toBe(
				"active",
			);
		});
		expect(document.querySelector("[data-slot='events-workbench-view']")?.getAttribute("data-view-state")).toBe(
			"inactive",
		);
	});

	it("keeps the chat runtime mounted safely when a project new-session action interrupts a streaming run", async () => {
		const user = userEvent.setup();
		const runningSession: DesktopSessionSummary = {
			...activeSession,
			title: "Streaming source session",
			isStreaming: true,
			runStartedAt: "2026-04-25T08:29:00.000Z",
		};
		const createdSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-created-during-run",
			title: "New Session",
			createdAt: "2026-04-25T08:31:00.000Z",
			updatedAt: "2026-04-25T08:31:00.000Z",
			messageCount: 0,
			isStreaming: false,
			runStartedAt: undefined,
		};
		let hasCreatedSession = false;
		const listSessions = vi.fn(async () => (hasCreatedSession ? [createdSession, runningSession] : [runningSession]));
		const newSession = vi.fn(async () => {
			hasCreatedSession = true;
			return createdSession;
		});
		const getSnapshot = vi.fn(async (sessionId?: string) => ({
			...baseSnapshot,
			sessionId: sessionId ?? runningSession.id,
			messages: sessionId === createdSession.id ? [] : baseSnapshot.messages,
			isStreaming: sessionId === runningSession.id,
			streamingMessage:
				sessionId === runningSession.id
					? ({
							role: "assistant",
							content: [{ type: "text", text: "Still working" }],
							api: "faux",
							model: "faux-model",
							provider: "faux",
							stopReason: "stop",
							timestamp: 1_777_777,
							usage: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								totalTokens: 0,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
							},
						} as AgentMessage)
					: undefined,
		}));
		installDesktopAgentBridge({ getSnapshot, listSessions, newSession });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: `在 ${activeProject.name} 中新建对话` }));

		await waitFor(() => expect(newSession).toHaveBeenCalledWith(activeProject.id));
		await waitFor(() => expect(getSnapshot).toHaveBeenCalledWith(createdSession.id));
		await waitFor(() => expect(screen.getByRole("heading", { name: "New session" })).toBeTruthy());
		expect(screen.queryByText("Desktop bridge unavailable")).toBeNull();
	});

	it("keeps a newly running session visible in its source project after switching projects", async () => {
		const user = userEvent.setup();
		const downloadsProject: DesktopProjectSummary = {
			id: "project-downloads",
			name: "Downloads",
			cwd: "/workspace/downloads",
			createdAt: "2026-04-25T07:30:00.000Z",
			updatedAt: "2026-04-25T08:00:00.000Z",
			sessionCount: 1,
			lastOpenedSessionId: "session-downloads",
		};
		const downloadsSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-downloads",
			title: "Downloads session",
			cwd: downloadsProject.cwd,
			createdAt: "2026-04-25T08:00:00.000Z",
			updatedAt: "2026-04-25T08:00:00.000Z",
		};
		const createdSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-created-cross-project",
			title: "New Session",
			createdAt: "2026-04-25T08:31:00.000Z",
			updatedAt: "2026-04-25T08:31:00.000Z",
			messageCount: 0,
			isStreaming: false,
			runStartedAt: undefined,
		};
		let hasCreatedSession = false;
		const agentEventListeners: Array<(event: SerializedAgentEvent) => void> = [];
		const listSessions = vi.fn(async (projectId?: string) => {
			if (projectId === downloadsProject.id) {
				return [downloadsSession];
			}
			return hasCreatedSession ? [createdSession, activeSession] : [activeSession];
		});
		const getSettings = vi.fn(async () => ({
			lastOpenedProjectId: activeProject.id,
			lastOpenedSessionId: activeSession.id,
			showThinkingBlocks: true,
		}));
		const getWorkspaceOverview = vi.fn(async () => ({
			settings: await getSettings(),
			projects: [activeProject, downloadsProject],
			sessionsByProjectId: {
				[activeProject.id]: [activeSession],
				[downloadsProject.id]: [downloadsSession],
			},
			activeProjectId: activeProject.id,
			activeSessionId: activeSession.id,
		}));
		const newSession = vi.fn(async () => {
			hasCreatedSession = true;
			return createdSession;
		});
		const switchProject = vi.fn(async (projectId: string) =>
			projectId === downloadsProject.id ? downloadsProject : activeProject,
		);
		const getSnapshot = vi.fn(async (sessionId?: string) => ({
			...baseSnapshot,
			sessionId: sessionId ?? activeSession.id,
			cwd: sessionId === downloadsSession.id ? downloadsProject.cwd : activeProject.cwd,
			messages: sessionId === createdSession.id ? [] : baseSnapshot.messages,
			isStreaming: sessionId === createdSession.id,
		}));
		installDesktopAgentBridge({
			getSettings,
			getSnapshot,
			getWorkspaceOverview,
			listProjects: vi.fn(async () => [activeProject, downloadsProject]),
			listSessions,
			newSession,
			subscribeToAgentEvents: vi.fn((listener) => {
				agentEventListeners.push(listener);
				return () => undefined;
			}),
			switchProject,
			switchSession: vi.fn(async (sessionId: string) =>
				sessionId === downloadsSession.id ? downloadsSession : activeSession,
			),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: `在 ${activeProject.name} 中新建对话` }));
		await waitFor(() => expect(newSession).toHaveBeenCalledWith(activeProject.id));
		await waitFor(() => expect(getSnapshot).toHaveBeenCalledWith(createdSession.id));

		act(() => {
			for (const listener of agentEventListeners) {
				listener({ type: "agent_start", sessionId: createdSession.id });
				listener({
					type: "message_end",
					sessionId: createdSession.id,
					message: { role: "user", content: "Background prompt", timestamp: 1 },
				});
			}
		});
		await waitFor(() => {
			expect(getSidebarSessionOrder(["Background prompt"])).toEqual(["Background prompt"]);
		});

		await user.click(screen.getByTitle(downloadsProject.cwd));
		await waitFor(() => expect(switchProject).toHaveBeenCalledWith(downloadsProject.id));
		await waitFor(() => {
			expect(getSidebarSessionOrder(["Downloads session"])).toEqual(["Downloads session"]);
		});

		expect(getSidebarSessionOrder(["Background prompt", "Downloads session"])).toEqual([
			"Background prompt",
			"Downloads session",
		]);
	});

	it("renders a persisted assistant message with missing usage metadata without white screening", async () => {
		const malformedSnapshot: DesktopAgentSnapshot = {
			...baseSnapshot,
			messages: [
				{ role: "user", content: "Show persisted answer", timestamp: 1 },
				{
					role: "assistant",
					content: [{ type: "text", text: "Persisted answer without usage" }],
					stopReason: "stop",
					timestamp: 2,
				} as AgentMessage,
			],
		};
		installDesktopAgentBridge({
			getSnapshot: vi.fn(async () => malformedSnapshot),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		expect(await screen.findByText("Persisted answer without usage")).toBeTruthy();
		expect(screen.queryByText("Desktop bridge unavailable")).toBeNull();
	});

	it("keeps the session mounted when persisted assistant content is malformed", async () => {
		const malformedSnapshot: DesktopAgentSnapshot = {
			...baseSnapshot,
			messages: [
				{ role: "user", content: "Show broken persisted answer", timestamp: 1 },
				{
					role: "assistant",
					stopReason: "stop",
					timestamp: 2,
				} as AgentMessage,
			],
		};
		installDesktopAgentBridge({
			getSnapshot: vi.fn(async () => malformedSnapshot),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		expect(await screen.findByText("Show broken persisted answer")).toBeTruthy();
		expect(screen.getByRole("heading", { name: activeSession.title })).toBeTruthy();
		expect(screen.queryByText("Desktop bridge unavailable")).toBeNull();
	});

	it("keeps the session mounted when a live streaming assistant message is malformed", async () => {
		const malformedSnapshot: DesktopAgentSnapshot = {
			...baseSnapshot,
			isStreaming: true,
			messages: [{ role: "user", content: "Show broken live answer", timestamp: 1 }],
			streamingMessage: {
				role: "assistant",
				stopReason: "stop",
				timestamp: 2,
			} as AgentMessage,
		};
		installDesktopAgentBridge({
			getSnapshot: vi.fn(async () => malformedSnapshot),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		expect(await screen.findByText("Show broken live answer")).toBeTruthy();
		expect(screen.getByRole("heading", { name: activeSession.title })).toBeTruthy();
		expect(screen.queryByText("Desktop bridge unavailable")).toBeNull();
	});

	it("switches from a running tool-call session to a completed project session without stale streaming content", async () => {
		const user = userEvent.setup();
		const downloadsProject: DesktopProjectSummary = {
			id: "project-downloads-stale-streaming",
			name: "Downloads",
			cwd: "/workspace/downloads",
			createdAt: "2026-04-25T07:30:00.000Z",
			updatedAt: "2026-04-25T08:00:00.000Z",
			sessionCount: 1,
			lastOpenedSessionId: "session-downloads-completed",
		};
		const runningSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-running-tool-call",
			title: "Running tool call session",
			isStreaming: true,
			runStartedAt: "2026-04-25T08:29:00.000Z",
		};
		const downloadsSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-downloads-completed",
			title: "Completed Downloads session",
			cwd: downloadsProject.cwd,
			createdAt: "2026-04-25T08:00:00.000Z",
			updatedAt: "2026-04-25T08:00:00.000Z",
			messageCount: 2,
			isStreaming: false,
			runStartedAt: undefined,
		};
		const runningSnapshot: DesktopAgentSnapshot = {
			...baseSnapshot,
			sessionId: runningSession.id,
			isStreaming: true,
			messages: [
				{ role: "user", content: "Run a long command", timestamp: 1 },
				{
					role: "assistant",
					api: "faux",
					content: [{ type: "toolCall", id: "call-running", name: "bash", arguments: { command: "sleep 45" } }],
					model: "faux-model",
					provider: "faux",
					stopReason: "toolUse",
					timestamp: 2,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				} as AgentMessage,
			],
			streamingMessage: {
				role: "assistant",
				api: "faux",
				content: [{ type: "toolCall", id: "call-stale", name: "bash", arguments: { command: "sleep 45" } }],
				model: "faux-model",
				provider: "faux",
				stopReason: "toolUse",
				timestamp: 3,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			} as AgentMessage,
		};
		const completedSnapshot: DesktopAgentSnapshot = {
			...baseSnapshot,
			sessionId: downloadsSession.id,
			cwd: downloadsProject.cwd,
			isStreaming: false,
			messages: [
				{ role: "user", content: "Read the downloaded note", timestamp: 4 },
				{
					role: "assistant",
					api: "faux",
					content: [{ type: "text", text: "Completed Downloads answer." }],
					model: "faux-model",
					provider: "faux",
					stopReason: "stop",
					timestamp: 5,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				} as AgentMessage,
			],
			streamingMessage: undefined,
		};
		const getWorkspaceOverview = vi.fn(async () => ({
			settings: {
				lastOpenedProjectId: activeProject.id,
				lastOpenedSessionId: runningSession.id,
				showThinkingBlocks: true,
			},
			projects: [activeProject, downloadsProject],
			sessionsByProjectId: {
				[activeProject.id]: [runningSession],
				[downloadsProject.id]: [downloadsSession],
			},
			activeProjectId: activeProject.id,
			activeSessionId: runningSession.id,
		}));
		const getSnapshot = vi.fn(async (sessionId?: string) =>
			sessionId === downloadsSession.id ? completedSnapshot : runningSnapshot,
		);
		installDesktopAgentBridge({
			getSnapshot,
			getWorkspaceOverview,
			listProjects: vi.fn(async () => [activeProject, downloadsProject]),
			listSessions: vi.fn(async (projectId?: string) =>
				projectId === downloadsProject.id ? [downloadsSession] : [runningSession],
			),
			switchProject: vi.fn(async (projectId: string) =>
				projectId === downloadsProject.id ? downloadsProject : activeProject,
			),
			switchSession: vi.fn(async (sessionId: string) =>
				sessionId === downloadsSession.id ? downloadsSession : runningSession,
			),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("Run a long command");
		await user.click(getSidebarSessionButton(/Completed Downloads session/i));

		expect(await screen.findByText("Completed Downloads answer.")).toBeTruthy();
		expect(screen.queryByText("sleep 45")).toBeNull();
		expect(screen.queryByText("Desktop bridge unavailable")).toBeNull();
	});

	it("keeps non-critical workbench data loads idle during chat startup", async () => {
		const listCapabilities = vi.fn(async () => ({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [],
		}));
		const { bridge } = installDesktopAgentBridge({ listCapabilities });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await waitForMs(500);

		expect(listCapabilities).not.toHaveBeenCalled();
		expect(bridge.getReviewSnapshot).not.toHaveBeenCalled();
		const reviewPanel = document.querySelector("[data-slot='review-workspace-panel']");
		expect(reviewPanel?.getAttribute("aria-hidden")).toBe("true");
		expect(reviewPanel?.hasAttribute("inert")).toBe(true);
	});

	it("does not show an in-app back control inside the dedicated settings window", async () => {
		window.history.replaceState(null, "", "/?view=settings");
		installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByRole("heading", { level: 1, name: "常规" });

		expect(screen.queryByRole("button", { name: "返回应用" })).toBeNull();
	});

	it("frames chat and terminal in the main workbench while keeping review as a sibling utility panel", async () => {
		const user = userEvent.setup();
		installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		const mainPanel = document.querySelector("[data-slot='main-workbench-panel']");

		expect(mainPanel).toBeTruthy();
		expect(mainPanel?.getAttribute("data-sidebar-attachment")).toBe("attached");
		expect(mainPanel?.getAttribute("data-review-attachment")).toBe("detached");
		expect(mainPanel?.querySelector("[data-slot='panel-header']")).toBeTruthy();
		expect(mainPanel?.querySelector("[data-slot='assistant-chat-shell']")).toBeTruthy();
		const terminalPanel = mainPanel?.querySelector("[data-slot='terminal-panel']");
		const terminalToggle = screen.getByRole("button", { name: "展开 Terminal" });
		expect(terminalPanel).toBeTruthy();
		expect(terminalPanel?.getAttribute("data-state")).toBe("closed");
		expect(terminalPanel?.getAttribute("style")).toContain("--structural-drawer-size: 0px");
		expect(terminalPanel?.className).not.toContain("border-t");
		expect(terminalToggle.getAttribute("data-slot")).toBe("terminal-toggle");
		expect(terminalToggle.getAttribute("aria-pressed")).toBe("false");
		expect(screen.queryByText("Terminal")).toBeNull();
		expect(screen.queryByRole("button", { name: "运行现场" })).toBeNull();

		await user.click(terminalToggle);
		await waitFor(() => expect(terminalPanel?.getAttribute("data-state")).toBe("open"));
		expect(screen.getByRole("button", { name: "收起 Terminal" }).getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByLabelText("Collapse terminal")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		await waitFor(() => expect(mainPanel?.getAttribute("data-sidebar-attachment")).toBe("detached"));
		expect(mainPanel?.querySelector("[data-slot='terminal-panel']")).toBe(terminalPanel);
		expect(screen.getByRole("button", { name: "收起 Terminal" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
		await waitFor(() => expect(mainPanel?.getAttribute("data-sidebar-attachment")).toBe("attached"));

		await user.click(screen.getByRole("button", { name: "审查" }));
		const reviewPanel = await screen.findByLabelText("Review workspace");
		const reviewSpacer = document.querySelector('[data-slot="review-workspace-spacer"]');

		expect(mainPanel?.getAttribute("data-review-attachment")).toBe("attached");
		expect(reviewPanel.getAttribute("data-workbench-attachment")).toBe("attached");
		expect(mainPanel?.contains(reviewPanel)).toBe(false);
		expect(reviewPanel.closest("[data-slot='chat-workbench']")).toBeTruthy();
		expect(reviewSpacer?.getAttribute("data-motion")).toBe("structural-drawer");
		expect(reviewSpacer?.getAttribute("data-motion-engine")).toBe("motion");
		expect(reviewSpacer?.getAttribute("data-motion-owner")).toBe("spacer");
		expect(reviewSpacer?.getAttribute("data-structural-layout-driver")).toBe("width");
		expect(reviewPanel.getAttribute("data-motion")).toBe("structural-drawer");
		expect(reviewPanel.getAttribute("data-motion-engine")).toBe("motion");
		expect(reviewPanel.getAttribute("data-motion-owner")).toBe("fixed-content");
		expect(reviewPanel.closest("[data-slot='review-workspace-spacer']")).toBe(reviewSpacer);
		expect(screen.getByRole("separator", { name: "Resize review panel" })).toBeTruthy();
	});

	it("prewarms the review workspace as a closed drawer before the first open", async () => {
		const user = userEvent.setup();
		const { bridge } = installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		const reviewSpacer = await waitFor(() => {
			const mountedSpacer = document.querySelector('[data-slot="review-workspace-spacer"]');
			expect(mountedSpacer).toBeTruthy();
			return mountedSpacer;
		});
		const reviewPanel = reviewSpacer?.querySelector('[data-slot="review-workspace-panel"]');

		expect(reviewSpacer?.getAttribute("data-state")).toBe("closed");
		expect(reviewPanel?.getAttribute("aria-hidden")).toBe("true");
		expect(reviewPanel?.hasAttribute("inert")).toBe(true);
		expect(bridge.getReviewSnapshot).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "审查" }));

		expect(document.querySelector('[data-slot="review-workspace-spacer"]')).toBe(reviewSpacer);
		await waitFor(() => expect(reviewSpacer?.getAttribute("data-state")).toBe("open"));
		await waitFor(() => {
			expect(bridge.getReviewSnapshot).toHaveBeenCalledWith({ projectId: "project-1" });
		});
	});

	it("keeps review fullscreen inside the workbench while sidebar navigation stays usable", async () => {
		const user = userEvent.setup();
		const { bridge } = installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		const mainPanel = document.querySelector("[data-slot='main-workbench-panel']");
		await user.click(screen.getByRole("button", { name: "审查" }));
		const reviewPanel = await screen.findByLabelText("Review workspace");
		const reviewSpacer = document.querySelector('[data-slot="review-workspace-spacer"]');

		await user.click(screen.getByRole("button", { name: "Enter review workspace fullscreen" }));
		expect(reviewSpacer?.getAttribute("data-display-mode")).toBe("fullscreen");
		expect(reviewSpacer?.className).toContain("z-50");
		expect(reviewPanel.getAttribute("data-display-mode")).toBe("fullscreen");
		expect(reviewPanel.closest("[data-slot='workbench-sidebar']")).toBeNull();
		expect(reviewPanel.closest("[data-slot='chat-workbench']")).toBeTruthy();
		expect(mainPanel?.getAttribute("aria-hidden")).toBe("true");
		expect(mainPanel?.hasAttribute("inert")).toBe(true);
		expect(mainPanel?.className).toContain("opacity-0");
		expect(screen.queryByRole("separator", { name: "Resize review panel" })).toBeNull();

		await user.click(screen.getByRole("button", { name: "能力库" }));
		expect(await screen.findByText("Agent 能力库")).toBeTruthy();

		await user.click(getSidebarSessionButton(/e2e profile session/i));
		await waitFor(() => {
			expect(document.querySelector("[data-slot='chat-workbench-view']")?.getAttribute("data-view-state")).toBe(
				"active",
			);
		});
		expect(screen.getByLabelText("Review workspace").getAttribute("data-display-mode")).toBe("fullscreen");

		await user.click(screen.getByRole("button", { name: "设置" }));
		await waitFor(() => {
			expect(bridge.openSettingsWindow).toHaveBeenCalledTimes(1);
			expect(document.querySelector("[data-slot='chat-workbench-view']")?.getAttribute("data-view-state")).toBe(
				"active",
			);
		});
		expect(screen.getByLabelText("Review workspace").getAttribute("data-display-mode")).toBe("fullscreen");
	});

	it("moves review fullscreen metadata into the collapsed titlebar controls", async () => {
		const user = userEvent.setup();
		const getReviewSnapshot = vi.fn(
			async (): Promise<DesktopReviewSnapshot> => ({
				...cleanReviewSnapshot,
				branch: "feature/review",
				totals: { files: 1, additions: 2, deletions: 1 },
			}),
		);
		installDesktopAgentBridge({ getReviewSnapshot });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("true");
		});

		await user.click(screen.getByRole("button", { name: "审查" }));
		await waitFor(() => expect(getReviewSnapshot).toHaveBeenCalledTimes(1));
		await user.click(screen.getByRole("button", { name: "Enter review workspace fullscreen" }));

		const titlebarControls = document.querySelector('[data-slot="desktop-titlebar-controls"]');
		const summary = await waitFor(() => {
			const mountedSummary = titlebarControls?.querySelector('[data-slot="review-fullscreen-titlebar-summary"]');
			expect(mountedSummary).toBeTruthy();
			return mountedSummary as HTMLElement;
		});
		const reviewHeader = document.querySelector('[data-slot="review-workspace-header"]');
		const newConversationButton = getTopNewConversationButton();
		const titlebarChildren = Array.from(titlebarControls?.children ?? []);
		expect(titlebarControls?.contains(summary)).toBe(true);
		expect(titlebarChildren.indexOf(newConversationButton)).toBeLessThan(titlebarChildren.indexOf(summary));
		expect(titlebarControls?.className).toContain("z-[var(--z-popover)]");
		expect(document.querySelector('[data-slot="review-workspace-spacer"]')?.className).toContain("z-50");
		expect(reviewHeader?.getAttribute("data-titlebar-summary-visible")).toBe("true");
		expect(reviewHeader?.className).not.toContain("desktop-window-drag-region");

		const summaryText = summary.textContent ?? "";
		const expectedOrder = ["综合面板", "+2", "-1", "feature/review", "/workspace/project", "审查"];
		let previousIndex = -1;
		for (const label of expectedOrder) {
			const currentIndex = summaryText.indexOf(label);
			expect(currentIndex).toBeGreaterThan(previousIndex);
			previousIndex = currentIndex;
		}
		expect(getReviewSnapshot).toHaveBeenCalledTimes(1);

		await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("false");
		});
		await user.click(screen.getByRole("button", { name: "能力库" }));
		expect(await screen.findByText("Agent 能力库")).toBeTruthy();
		expect(document.querySelector("[data-slot='chat-workbench-view']")?.className).toContain("invisible");
		expect(document.querySelector('[data-slot="review-fullscreen-titlebar-summary"]')).toBeNull();
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("true");
		});
		expect(document.querySelector('[data-slot="review-fullscreen-titlebar-summary"]')).toBeNull();
		expect(document.querySelector("[data-slot='capabilities-titlebar-row']")?.textContent).toContain("Agent 能力库");

		await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("false");
		});
		await user.click(screen.getByRole("button", { name: "事件" }));
		expect(await screen.findByRole("heading", { name: "事件" })).toBeTruthy();
		expect(document.querySelector("[data-slot='chat-workbench-view']")?.className).toContain("invisible");
		expect(document.querySelector('[data-slot="review-fullscreen-titlebar-summary"]')).toBeNull();
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("true");
		});
		expect(document.querySelector('[data-slot="review-fullscreen-titlebar-summary"]')).toBeNull();
		expect(document.querySelector("[data-slot='events-titlebar-row']")?.textContent).toContain("事件");

		await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("false");
		});
		await user.click(getSidebarSessionButton(/e2e profile session/i));
		await waitFor(() => {
			expect(document.querySelector("[data-slot='chat-workbench-view']")?.getAttribute("data-view-state")).toBe(
				"active",
			);
		});
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("true");
		});
		expect(screen.getByLabelText("Review workspace").getAttribute("data-display-mode")).toBe("fullscreen");
		expect(document.querySelector('[data-slot="review-fullscreen-titlebar-summary"]')).toBeTruthy();
	});

	it("keeps compact review metadata visible in fullscreen when the sidebar remains open", async () => {
		const user = userEvent.setup();
		const getReviewSnapshot = vi.fn(
			async (): Promise<DesktopReviewSnapshot> => ({
				...cleanReviewSnapshot,
				branch: "feature/review",
				totals: { files: 1, additions: 2, deletions: 1 },
			}),
		);
		installDesktopAgentBridge({ getReviewSnapshot });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: "审查" }));
		await waitFor(() => expect(getReviewSnapshot).toHaveBeenCalledTimes(1));
		await user.click(screen.getByRole("button", { name: "Enter review workspace fullscreen" }));

		expect(document.querySelector('[data-slot="review-fullscreen-titlebar-summary"]')).toBeNull();
		const titleBlock = await waitFor(() => {
			const mountedTitleBlock = document.querySelector('[data-slot="review-workspace-title-block"]');
			expect(mountedTitleBlock).toBeTruthy();
			return mountedTitleBlock as HTMLElement;
		});
		expect(titleBlock.className).not.toContain("hidden");
		const titleText = titleBlock.textContent ?? "";
		const expectedOrder = ["综合面板", "+2", "-1", "feature/review", "/workspace/project"];
		let previousIndex = -1;
		for (const label of expectedOrder) {
			const currentIndex = titleText.indexOf(label);
			expect(currentIndex).toBeGreaterThan(previousIndex);
			previousIndex = currentIndex;
		}
		expect(screen.queryByRole("tab", { name: "审查" })).toBeNull();
		expect(getReviewSnapshot).toHaveBeenCalledTimes(1);
	});

	it("remembers review open and fullscreen state per active session for the current app run", async () => {
		const user = userEvent.setup();
		const secondSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-2",
			title: "Second session",
			updatedAt: "2026-04-25T08:45:00.000Z",
		};
		const secondSnapshot: DesktopAgentSnapshot = {
			...baseSnapshot,
			sessionId: secondSession.id,
			messages: [{ role: "user", content: "second session message", timestamp: 2 }],
		};
		const getSnapshot = vi.fn(async (sessionId: string) =>
			sessionId === secondSession.id ? secondSnapshot : baseSnapshot,
		);
		const listSessions = vi.fn(async () => [activeSession, secondSession]);
		const switchSession = vi.fn(async (sessionId: string) =>
			sessionId === secondSession.id ? secondSession : activeSession,
		);
		installDesktopAgentBridge({ getSnapshot, listSessions, switchSession });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: "审查" }));
		await screen.findByLabelText("Review workspace");
		await user.click(screen.getByRole("button", { name: "Enter review workspace fullscreen" }));
		expect(screen.getByLabelText("Review workspace").getAttribute("data-display-mode")).toBe("fullscreen");

		await user.click(getSidebarSessionButton(/second session/i));
		await waitFor(() => expect(switchSession).toHaveBeenCalledWith("session-2"));
		await waitFor(() => {
			expect(document.querySelector("[data-slot='chat-workbench']")?.getAttribute("data-review-open")).toBe("false");
		});
		expect(screen.getByLabelText("Review workspace").getAttribute("aria-hidden")).toBe("true");
		expect(screen.getByRole("button", { name: "审查" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "审查" }));
		await waitFor(() => {
			expect(document.querySelector("[data-slot='chat-workbench']")?.getAttribute("data-review-open")).toBe("true");
		});
		expect(screen.getByLabelText("Review workspace").getAttribute("data-display-mode")).toBe("panel");

		await user.click(getSidebarSessionButton(/e2e profile session/i));
		await waitFor(() => expect(switchSession).toHaveBeenCalledWith("session-1"));
		await waitFor(() => {
			expect(screen.getByLabelText("Review workspace").getAttribute("data-display-mode")).toBe("fullscreen");
		});
		expect(screen.getByRole("button", { name: "Exit review workspace fullscreen" })).toBeTruthy();

		await user.click(getSidebarSessionButton(/second session/i));
		await waitFor(() => expect(switchSession).toHaveBeenCalledWith("session-2"));
		await waitFor(() => {
			expect(screen.getByLabelText("Review workspace").getAttribute("data-display-mode")).toBe("panel");
		});
		expect(screen.getByRole("button", { name: "Enter review workspace fullscreen" })).toBeTruthy();
	});

	it("opens the independent capabilities library from the sidebar", async () => {
		const user = userEvent.setup();
		installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		const chatWorkbench = document.querySelector("[data-slot='chat-workbench']");
		await user.click(screen.getByRole("button", { name: "能力库" }));

		expect(await screen.findByText("Agent 能力库")).toBeTruthy();
		expect(screen.getByRole("button", { name: "添加 MCP" })).toBeTruthy();
		expect(document.body.contains(chatWorkbench)).toBe(true);
		const chatWorkbenchView = document.querySelector("[data-slot='chat-workbench-view']");
		const capabilitiesWorkbenchView = document.querySelector("[data-slot='capabilities-workbench-view']");
		expect(chatWorkbenchView?.getAttribute("data-view-state")).toBe("inactive");
		expect(chatWorkbenchView?.getAttribute("data-paint-state")).toBe("painted");
		expect(chatWorkbenchView?.className).toContain("invisible");
		expect(chatWorkbenchView?.getAttribute("aria-hidden")).toBe("true");
		expect(chatWorkbenchView?.hasAttribute("inert")).toBe(true);
		expect(capabilitiesWorkbenchView?.getAttribute("data-view-state")).toBe("active");
		expect(screen.getByRole("button", { name: "能力库" }).className).toContain(
			"bg-[color:var(--color-sidebar-selected)]",
		);
		const sessionButton = screen
			.getAllByRole("button", { name: /e2e profile session/i })
			.find((button) => button.getAttribute("aria-label") !== "删除对话 E2E profile session");
		if (!sessionButton) {
			throw new Error("Expected sidebar session button.");
		}
		expect(sessionButton.getAttribute("aria-current")).toBeNull();
		expect(sessionButton.closest("[data-slot='entity-row']")?.getAttribute("data-selected")).toBe("false");
		expect(screen.queryByRole("button", { name: "Back to chat" })).toBeNull();
	});

	it("returns from capabilities when the active sidebar session is selected", async () => {
		const user = userEvent.setup();
		const { bridge } = installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: "能力库" }));
		expect(await screen.findByText("Agent 能力库")).toBeTruthy();

		const sessionButton = screen
			.getAllByRole("button", { name: /e2e profile session/i })
			.find((button) => button.getAttribute("aria-label") !== "删除对话 E2E profile session");
		if (!sessionButton) {
			throw new Error("Expected sidebar session button.");
		}
		expect(sessionButton.getAttribute("aria-current")).toBeNull();
		expect(sessionButton.closest("[data-slot='entity-row']")?.getAttribute("data-selected")).toBe("false");
		await user.click(sessionButton);

		await waitFor(() => {
			const chatWorkbenchView = document.querySelector("[data-slot='chat-workbench-view']");
			const capabilitiesWorkbenchView = document.querySelector("[data-slot='capabilities-workbench-view']");
			expect(chatWorkbenchView?.getAttribute("data-view-state")).toBe("active");
			expect(chatWorkbenchView?.getAttribute("data-paint-state")).toBe("painted");
			expect(chatWorkbenchView?.className).not.toContain("invisible");
			expect(chatWorkbenchView?.hasAttribute("inert")).toBe(false);
			expect(capabilitiesWorkbenchView?.getAttribute("data-view-state")).toBe("inactive");
			expect(capabilitiesWorkbenchView?.hasAttribute("inert")).toBe(true);
		});
		expect(document.querySelector("[data-slot='assistant-chat-shell']")).toBeTruthy();
		expect(bridge.switchSession).not.toHaveBeenCalled();
	});

	it("returns from capabilities to a cross-project session without leaving the capabilities title visible", async () => {
		const user = userEvent.setup();
		const projectSwitch = createDeferredPromise<DesktopProjectSummary>();
		const downloadsProject: DesktopProjectSummary = {
			id: "project-downloads-title-switch",
			name: "Downloads",
			cwd: "/workspace/downloads",
			createdAt: "2026-04-25T07:30:00.000Z",
			updatedAt: "2026-04-25T08:00:00.000Z",
			sessionCount: 1,
			lastOpenedSessionId: "session-downloads-title-switch",
		};
		const downloadsSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-downloads-title-switch",
			title: "Downloads title switch",
			cwd: downloadsProject.cwd,
			createdAt: "2026-04-25T08:00:00.000Z",
			updatedAt: "2026-04-25T08:00:00.000Z",
		};
		const getWorkspaceOverview = vi.fn(async () => ({
			settings: {
				lastOpenedProjectId: activeProject.id,
				lastOpenedSessionId: activeSession.id,
				showThinkingBlocks: true,
			},
			projects: [activeProject, downloadsProject],
			sessionsByProjectId: {
				[activeProject.id]: [activeSession],
				[downloadsProject.id]: [downloadsSession],
			},
			activeProjectId: activeProject.id,
			activeSessionId: activeSession.id,
		}));
		const switchProject = vi.fn(async () => projectSwitch.promise);
		const switchSession = vi.fn(async () => downloadsSession);
		installDesktopAgentBridge({
			getWorkspaceOverview,
			listProjects: vi.fn(async () => [activeProject, downloadsProject]),
			listSessions: vi.fn(async (projectId?: string) =>
				projectId === downloadsProject.id ? [downloadsSession] : [activeSession],
			),
			switchProject,
			switchSession,
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: "能力库" }));
		expect(await screen.findByText("Agent 能力库")).toBeTruthy();

		await user.click(getSidebarSessionButton(/Downloads title switch/i));

		await waitFor(() => expect(switchProject).toHaveBeenCalledWith(downloadsProject.id));
		expect(document.querySelector("[data-slot='chat-workbench-view']")?.getAttribute("data-view-state")).toBe(
			"active",
		);
		expect(document.querySelector("[data-slot='capabilities-workbench-view']")?.getAttribute("data-view-state")).toBe(
			"inactive",
		);
		expect(document.querySelector("[data-slot='panel-header'] h1")?.textContent).toBe("Downloads title switch");

		projectSwitch.resolve(downloadsProject);
		await waitFor(() => expect(switchSession).toHaveBeenCalledWith(downloadsSession.id));
	});

	it("switches session header text optimistically while the session switch is pending", async () => {
		const user = userEvent.setup();
		const sessionSwitch = createDeferredPromise<DesktopSessionSummary>();
		const secondSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-title-optimistic",
			title: "Optimistic title session",
			updatedAt: "2026-04-25T08:45:00.000Z",
		};
		const switchSession = vi.fn(async () => sessionSwitch.promise);
		installDesktopAgentBridge({
			listSessions: vi.fn(async () => [activeSession, secondSession]),
			switchSession,
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		expect(document.querySelector("[data-slot='panel-header'] h1")?.textContent).toBe(activeSession.title);

		await user.click(getSidebarSessionButton(/Optimistic title session/i));

		await waitFor(() => expect(switchSession).toHaveBeenCalledWith(secondSession.id));
		expect(document.querySelector("[data-slot='panel-header'] h1")?.textContent).toBe("Optimistic title session");

		sessionSwitch.resolve(secondSession);
		await waitFor(() => {
			expect(document.querySelector("[data-slot='panel-header'] h1")?.textContent).toBe("Optimistic title session");
		});
	});

	it("keeps collapsed capabilities titlebar controls usable when creating a new session", async () => {
		const user = userEvent.setup();
		const freshSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-fresh",
			title: "New session",
			createdAt: "2026-04-25T09:00:00.000Z",
			updatedAt: "2026-04-25T09:00:00.000Z",
			messageCount: 0,
		};
		const freshSnapshot: DesktopAgentSnapshot = {
			...baseSnapshot,
			sessionId: freshSession.id,
			messages: [],
		};
		let hasCreatedFreshSession = false;
		const getSnapshot = vi.fn(async (sessionId: string) =>
			sessionId === freshSession.id ? freshSnapshot : baseSnapshot,
		);
		const listSessions = vi.fn(async (_projectId?: string) =>
			hasCreatedFreshSession ? [freshSession, activeSession] : [activeSession],
		);
		const newSession = vi.fn(async (_projectId?: string) => {
			hasCreatedFreshSession = true;
			return freshSession;
		});
		const { bridge } = installDesktopAgentBridge({ getSnapshot, listSessions, newSession });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: "能力库" }));
		expect(await screen.findByText("Agent 能力库")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("true");
		});
		expect(
			document
				.querySelector("[data-slot='capabilities-titlebar-row'] [data-slot='workbench-page-header-title-region']")
				?.getAttribute("data-titlebar-drag-region"),
		).toBe("enabled");
		expect(
			document.querySelector(
				"[data-slot='capabilities-titlebar-row'] [data-slot='workbench-page-header-drag-region']",
			),
		).toBeTruthy();
		expect(document.querySelector("[data-slot='desktop-titlebar-controls']")?.className).toContain(
			"min-w-[var(--desktop-titlebar-controls-safe-width)]",
		);

		await user.click(getTopNewConversationButton());

		await waitFor(() => {
			expect(document.querySelector("[data-slot='chat-workbench-view']")?.getAttribute("data-view-state")).toBe(
				"active",
			);
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByLabelText("Message Skylark"));
		});
		expect(newSession).toHaveBeenCalledWith("project-1");
		expect(bridge.switchSession).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("false");
		});
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("true");
		});
		const focusAnchor = document.createElement("button");
		document.body.append(focusAnchor);
		focusAnchor.focus();
		expect(document.activeElement).toBe(focusAnchor);
		await user.click(getTopNewConversationButton());
		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByLabelText("Message Skylark"));
		});
		expect(newSession).toHaveBeenCalledTimes(1);
		focusAnchor.remove();
	});

	it("keeps collapsed events titlebar controls usable", async () => {
		const user = userEvent.setup();
		const freshSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-fresh-from-events",
			title: "New session",
			createdAt: "2026-04-25T09:00:00.000Z",
			updatedAt: "2026-04-25T09:00:00.000Z",
			messageCount: 0,
		};
		const freshSnapshot: DesktopAgentSnapshot = {
			...baseSnapshot,
			sessionId: freshSession.id,
			messages: [],
		};
		let hasCreatedFreshSession = false;
		const getSnapshot = vi.fn(async (sessionId: string) =>
			sessionId === freshSession.id ? freshSnapshot : baseSnapshot,
		);
		const listSessions = vi.fn(async (_projectId?: string) =>
			hasCreatedFreshSession ? [freshSession, activeSession] : [activeSession],
		);
		const newSession = vi.fn(async (_projectId?: string) => {
			hasCreatedFreshSession = true;
			return freshSession;
		});
		installDesktopAgentBridge({ getSnapshot, listSessions, newSession });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.click(screen.getByRole("button", { name: "事件" }));
		expect(await screen.findByRole("heading", { name: "事件" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("true");
		});
		expect(
			document
				.querySelector("[data-slot='events-titlebar-row'] [data-slot='workbench-page-header-title-region']")
				?.getAttribute("data-titlebar-drag-region"),
		).toBe("enabled");
		expect(
			document.querySelector("[data-slot='events-titlebar-row'] [data-slot='workbench-page-header-drag-region']"),
		).toBeTruthy();
		expect(document.querySelector("[data-slot='desktop-titlebar-controls']")?.className).toContain(
			"min-w-[var(--desktop-titlebar-controls-safe-width)]",
		);

		await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("false");
		});
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("true");
		});
		await user.click(getTopNewConversationButton());

		await waitFor(() => {
			expect(document.querySelector("[data-slot='chat-workbench-view']")?.getAttribute("data-view-state")).toBe(
				"active",
			);
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByLabelText("Message Skylark"));
		});
		expect(newSession).toHaveBeenCalledWith("project-1");

		await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("false");
		});
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='workbench-app-shell']")?.getAttribute("data-sidebar-collapsed"),
			).toBe("true");
		});
		const focusAnchor = document.createElement("button");
		document.body.append(focusAnchor);
		focusAnchor.focus();
		expect(document.activeElement).toBe(focusAnchor);
		await user.click(getTopNewConversationButton());
		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByLabelText("Message Skylark"));
		});
		expect(newSession).toHaveBeenCalledTimes(1);
		focusAnchor.remove();
	});

	it("returns from capabilities to the existing blank session without creating or refreshing", async () => {
		const user = userEvent.setup();
		const blankSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-blank",
			title: "New session",
			messageCount: 0,
		};
		const blankSnapshot: DesktopAgentSnapshot = {
			...baseSnapshot,
			sessionId: blankSession.id,
			messages: [],
		};
		const getSnapshot = vi.fn(async () => blankSnapshot);
		const listSessions = vi.fn(async () => [blankSession]);
		const newSession = vi.fn(async () => blankSession);
		installDesktopAgentBridge({ getSnapshot, listSessions, newSession });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("What should we work on?");
		await user.click(screen.getByRole("button", { name: "能力库" }));
		expect(await screen.findByText("Agent 能力库")).toBeTruthy();
		const snapshotCallCount = getSnapshot.mock.calls.length;
		const listSessionsCallCount = listSessions.mock.calls.length;

		await user.click(getTopNewConversationButton());

		await waitFor(() => {
			expect(document.querySelector("[data-slot='chat-workbench-view']")?.getAttribute("data-view-state")).toBe(
				"active",
			);
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByLabelText("Message Skylark"));
		});
		expect(newSession).not.toHaveBeenCalled();
		expect(getSnapshot).toHaveBeenCalledTimes(snapshotCallCount);
		expect(listSessions).toHaveBeenCalledTimes(listSessionsCallCount);
	});

	it("focuses the composer from an existing blank chat without creating or refreshing", async () => {
		const user = userEvent.setup();
		const blankSession: DesktopSessionSummary = {
			...activeSession,
			id: "session-blank",
			title: "New session",
			messageCount: 0,
		};
		const blankSnapshot: DesktopAgentSnapshot = {
			...baseSnapshot,
			sessionId: blankSession.id,
			messages: [],
		};
		const getSnapshot = vi.fn(async () => blankSnapshot);
		const listSessions = vi.fn(async () => [blankSession]);
		const newSession = vi.fn(async () => blankSession);
		installDesktopAgentBridge({ getSnapshot, listSessions, newSession });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("What should we work on?");
		const snapshotCallCount = getSnapshot.mock.calls.length;
		const listSessionsCallCount = listSessions.mock.calls.length;

		await user.click(getTopNewConversationButton());

		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByLabelText("Message Skylark"));
		});
		expect(newSession).not.toHaveBeenCalled();
		expect(getSnapshot).toHaveBeenCalledTimes(snapshotCallCount);
		expect(listSessions).toHaveBeenCalledTimes(listSessionsCallCount);
	});

	it("opens the read-only review workspace from the chat header", async () => {
		const user = userEvent.setup();
		const { bridge } = installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		expect(screen.getByRole("button", { name: "审查" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "审查" }));

		await waitFor(() => {
			expect(bridge.getReviewSnapshot).toHaveBeenCalledWith({ projectId: "project-1" });
		});
		expect(document.querySelector('[data-slot="chat-workbench"]')?.getAttribute("data-review-open")).toBe("true");
		expect(document.querySelector('[data-slot="review-header-divider"]')).toBeNull();
		const reviewSpacer = document.querySelector('[data-slot="review-workspace-spacer"]');
		expect(reviewSpacer?.className).toContain("shrink-0");
		expect(reviewSpacer?.getAttribute("data-motion")).toBe("structural-drawer");
		expect(reviewSpacer?.getAttribute("data-motion-owner")).toBe("spacer");
		expect(reviewSpacer?.getAttribute("data-structural-layout-driver")).toBe("width");
		const reviewPanel = screen.getByLabelText("Review workspace");
		expect(reviewPanel.className).toContain("absolute");
		expect(reviewPanel.getAttribute("aria-hidden")).toBe("false");
		expect(reviewPanel.hasAttribute("inert")).toBe(false);
		expect(reviewPanel.getAttribute("data-motion")).toBe("structural-drawer");
		expect(reviewPanel.getAttribute("data-motion-owner")).toBe("fixed-content");
		expect(reviewPanel.closest("[data-slot='review-workspace-spacer']")).toBe(reviewSpacer);
		expect(reviewPanel.querySelector('[data-slot="review-workspace-icon"]')).toBeTruthy();
		expect(screen.getByRole("separator", { name: "Resize review panel" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "审查" })).toBeNull();
		expect(await screen.findByText("尚无文件更改")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Close review workspace" }));
		expect(reviewPanel.getAttribute("aria-hidden")).toBe("true");
		expect(reviewPanel.hasAttribute("inert")).toBe(true);
		expect(screen.getByRole("button", { name: "审查" })).toBeTruthy();
	});

	it("toggles the workspace panel from the chat header without a mini pill", async () => {
		const user = userEvent.setup();
		const listEnvironmentResources = vi.fn(async () => [environmentResource]);
		const subscribeToEnvironmentEvents = vi.fn(() => () => undefined);
		installDesktopAgentBridge({ listEnvironmentResources, subscribeToEnvironmentEvents });

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		const workspaceToggle = await screen.findByRole("button", { name: "隐藏 Workspace 面板" });
		expect(workspaceToggle.getAttribute("data-slot")).toBe("workspace-status-toggle");
		expect(workspaceToggle.getAttribute("aria-pressed")).toBe("true");
		expect(workspaceToggle.hasAttribute("disabled")).toBe(false);
		expect(screen.getByRole("button", { name: "审查" })).toBeTruthy();
		expect(await screen.findByText("Workspace progress")).toBeTruthy();
		expect(document.querySelector("[data-slot='assistant-workspace-status-mini']")).toBeNull();
		await waitFor(() => expect(listEnvironmentResources).toHaveBeenCalled());
		expect(subscribeToEnvironmentEvents).toHaveBeenCalled();

		await user.click(workspaceToggle);
		await waitFor(() => expect(screen.queryByLabelText("Environment")).toBeNull());
		const collapsedToggle = screen.getByRole("button", { name: "显示 Workspace 面板" });
		expect(collapsedToggle.getAttribute("aria-pressed")).toBe("false");
		expect(document.querySelector("[data-slot='assistant-workspace-status-mini']")).toBeNull();

		await user.click(collapsedToggle);
		expect(await screen.findByText("Workspace progress")).toBeTruthy();
		expect(screen.getByRole("button", { name: "隐藏 Workspace 面板" }).getAttribute("aria-pressed")).toBe("true");
		expect(listEnvironmentResources.mock.calls.length).toBeLessThanOrEqual(2);
		expect(subscribeToEnvironmentEvents.mock.calls.length).toBeLessThanOrEqual(2);
	});

	it("keeps the workspace header toggle mounted and disabled without workspace status", async () => {
		installDesktopAgentBridge();

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		const workspaceToggle = screen.getByRole("button", { name: "显示 Workspace 面板" });
		expect(workspaceToggle.getAttribute("data-slot")).toBe("workspace-status-toggle");
		expect(workspaceToggle.getAttribute("aria-pressed")).toBe("false");
		expect(workspaceToggle.hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("button", { name: "审查" })).toBeTruthy();
		expect(screen.queryByLabelText("Environment")).toBeNull();
	});

	it("opens thread file links in the review workspace preview panel", async () => {
		const user = userEvent.setup();
		const openWorkspacePreviewFile = vi.fn(async () => ({
			path: "/workspace/project/src/App.tsx",
			name: "App.tsx",
			mimeType: "text/typescript",
			size: 24,
			kind: "text" as const,
			content: "export const app = true;\n",
			updatedAt: "2026-05-01T00:00:00.000Z",
		}));
		installDesktopAgentBridge({
			getSnapshot: vi.fn(async () => ({
				...baseSnapshot,
				messages: [
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: "Open [App](src/App.tsx:12)." }],
						timestamp: 1,
					},
				],
			})),
			openWorkspacePreviewFile,
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await user.click(await screen.findByRole("link", { name: "App" }));

		await waitFor(() => {
			expect(openWorkspacePreviewFile).toHaveBeenCalledWith({
				path: "src/App.tsx:12",
				projectId: "project-1",
			});
		});
		expect(document.querySelector('[data-slot="chat-workbench"]')?.getAttribute("data-review-open")).toBe("true");
		expect(await screen.findByRole("tab", { name: /App\.tsx/i })).toBeTruthy();
		await waitFor(() => expect(screen.getByText("export")).toBeTruthy());
		expect(screen.getByText("app")).toBeTruthy();
	});

	it("surfaces pending approvals in the workbench header", async () => {
		let approvalListener: ((event: DesktopApprovalEvent) => void) | undefined;
		installDesktopAgentBridge({
			subscribeToApprovalEvents: vi.fn((listener: (event: DesktopApprovalEvent) => void) => {
				approvalListener = listener;
				return () => {
					approvalListener = undefined;
				};
			}),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");

		act(() => {
			approvalListener?.({
				type: "approval_requested",
				request: {
					id: "approval-1",
					category: "bash",
					action: "bash",
					title: "Run shell command",
					description: "Execute a shell command from an agent tool call.",
					subject: "pwd",
					cwd: "/workspace/project",
					createdAt: "2026-05-01T00:00:00.000Z",
				},
			});
		});

		const status = await screen.findByText("Waiting for approval");
		expect(status.closest("[data-slot='agent-status-indicator']")?.getAttribute("data-state")).toBe(
			"waiting_for_user",
		);
	});

	it("shows queued status while a prompt submission is awaiting the runtime", async () => {
		const user = userEvent.setup();
		let resolvePrompt: (() => void) | undefined;
		installDesktopAgentBridge({
			prompt: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						resolvePrompt = resolve;
					}),
			),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.type(screen.getByPlaceholderText("Message Skylark"), "scan workspace");
		await user.click(screen.getByLabelText("Send message"));

		const status = await screen.findByText("Queued");
		expect(status.closest("[data-slot='agent-status-indicator']")?.getAttribute("data-state")).toBe("queued");

		act(() => {
			resolvePrompt?.();
		});
	});

	it("routes /compact through manual compaction and keeps existing transcript visible", async () => {
		const user = userEvent.setup();
		const existingMessage = baseSnapshot.messages[0];
		if (!existingMessage) {
			throw new Error("Expected base snapshot to include a visible history message.");
		}
		const compactedSnapshot = {
			...baseSnapshot,
			messages: [createCompactionSummaryMessage("internal summary", 2), existingMessage],
		};
		const { bridge } = installDesktopAgentBridge({
			compact: vi.fn(async () => compactedSnapshot),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		await user.type(screen.getByPlaceholderText("Message Skylark"), "/compact keep visible history");
		await user.click(screen.getByLabelText("Send message"));

		await waitFor(() => {
			expect(bridge.compact).toHaveBeenCalledWith({
				sessionId: "session-1",
				customInstructions: "keep visible history",
			});
		});
		expect(bridge.prompt).not.toHaveBeenCalled();
		expect(screen.getByText("hello")).toBeTruthy();
		expect(screen.getByText("上下文已压缩")).toBeTruthy();
	});

	it("opens slash command options from the active app composer when only slash is typed", async () => {
		const user = userEvent.setup();
		const listCapabilities = vi.fn(async () => ({
			diagnostics: [],
			mcpServers: [],
			prompts: [],
			skills: [],
			slashCommands: [
				{
					name: "desktop-prompt",
					description: "Expand inside AgentSession",
					source: "prompt" as const,
					sourcePath: "/workspace/project/.pi/prompts/desktop-prompt.md",
				},
				{
					name: "skill:review",
					description: "Review skill",
					source: "skill" as const,
					sourcePath: "/workspace/project/.pi/skills/review/SKILL.md",
				},
			],
		}));
		installDesktopAgentBridge({
			listCapabilities,
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		const input = screen.getByLabelText("Message Skylark");
		await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
		expect(listCapabilities).not.toHaveBeenCalled();

		await user.type(input, "/");
		await waitFor(() => expect(listCapabilities).toHaveBeenCalledTimes(1));
		expect((input as HTMLTextAreaElement).value).toBe("/");

		expect(await screen.findByRole("listbox", { name: "Composer suggestions" })).toBeTruthy();
		expect(screen.getByText("Skills")).toBeTruthy();
		expect(screen.getByText("Prompt templates")).toBeTruthy();
		expect(screen.getByText("/desktop-prompt")).toBeTruthy();
		expect(screen.getByText("/skill:review")).toBeTruthy();
	});

	it("shows completed status briefly after a run ends", async () => {
		let agentListener: ((event: SerializedAgentEvent) => void) | undefined;
		installDesktopAgentBridge({
			subscribeToAgentEvents: vi.fn((listener: (event: SerializedAgentEvent) => void) => {
				agentListener = listener;
				return () => {
					agentListener = undefined;
				};
			}),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");
		vi.useFakeTimers();

		act(() => {
			agentListener?.({ sessionId: "session-1", type: "agent_start" });
		});
		expect(document.querySelector('[data-slot="agent-status-indicator"]')?.getAttribute("aria-label")).toBe(
			"Working",
		);

		act(() => {
			agentListener?.({ sessionId: "session-1", type: "agent_end", messages: baseSnapshot.messages });
		});
		expect(document.querySelector('[data-slot="agent-status-indicator"]')?.getAttribute("aria-label")).toBe(
			"Completed",
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1800);
		});
		expect(document.querySelector('[data-slot="agent-status-indicator"]')).toBeNull();
	});

	it("shows failed status when a run ends with an agent error", async () => {
		let agentListener: ((event: SerializedAgentEvent) => void) | undefined;
		installDesktopAgentBridge({
			subscribeToAgentEvents: vi.fn((listener: (event: SerializedAgentEvent) => void) => {
				agentListener = listener;
				return () => {
					agentListener = undefined;
				};
			}),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("hello");

		act(() => {
			agentListener?.({ sessionId: "session-1", type: "agent_start" });
			agentListener?.({
				sessionId: "session-1",
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						api: "faux",
						content: [{ type: "text", text: "failed" }],
						errorMessage: "Provider key missing.",
						model: "faux-model",
						provider: "faux",
						stopReason: "error",
						timestamp: 2,
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
					},
				],
			});
		});

		const status = await screen.findByText("Failed");
		expect(status.closest("[data-slot='agent-status-indicator']")?.getAttribute("data-state")).toBe("error");
	});

	it("shows an empty project workspace without creating a default session", async () => {
		const emptyProject: DesktopProjectSummary = {
			id: "project-empty",
			name: "opencode",
			cwd: "/workspace/opencode",
			createdAt: "2026-04-25T07:00:00.000Z",
			updatedAt: "2026-04-25T08:30:00.000Z",
			sessionCount: 0,
		};
		const getSnapshot = vi.fn(async () => baseSnapshot);
		const listSessions = vi.fn(async () => []);
		const newSession = vi.fn(async () => activeSession);

		installDesktopAgentBridge({
			getSettings: vi.fn(async () => ({
				lastOpenedProjectId: "project-empty",
				lastOpenedSessionId: undefined,
				showThinkingBlocks: true,
			})),
			getSnapshot,
			listProjects: vi.fn(async () => [emptyProject]),
			listSessions,
			newSession,
			switchProject: vi.fn(async () => emptyProject),
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		expect(await screen.findByText("暂无对话，点击左上角新对话开始。")).toBeTruthy();
		expect(screen.getAllByText("opencode").length).toBeGreaterThan(0);
		await waitFor(() => {
			expect(listSessions).toHaveBeenCalledWith("project-empty");
		});
		expect(getSnapshot).not.toHaveBeenCalled();
		expect(newSession).not.toHaveBeenCalled();
	});

	it("switches to an empty project from its sidebar row", async () => {
		const user = userEvent.setup();
		const emptyProject: DesktopProjectSummary = {
			id: "project-empty",
			name: "opencode",
			cwd: "/workspace/opencode",
			createdAt: "2026-04-25T07:00:00.000Z",
			updatedAt: "2026-04-25T08:30:00.000Z",
			sessionCount: 0,
		};
		const projects = [activeProject, emptyProject];
		const listSessions = vi.fn(async (projectId?: string) => (projectId === emptyProject.id ? [] : [activeSession]));
		const switchProject = vi.fn(async () => emptyProject);

		installDesktopAgentBridge({
			getSettings: vi.fn(async () => ({
				lastOpenedProjectId: activeProject.id,
				lastOpenedSessionId: activeSession.id,
				showThinkingBlocks: true,
			})),
			getWorkspaceOverview: vi.fn(async () => ({
				settings: {
					lastOpenedProjectId: activeProject.id,
					lastOpenedSessionId: activeSession.id,
					showThinkingBlocks: true,
				},
				projects,
				sessionsByProjectId: {
					[activeProject.id]: [activeSession],
					[emptyProject.id]: [],
				},
				activeProjectId: activeProject.id,
				activeSessionId: activeSession.id,
			})),
			listProjects: vi.fn(async () => projects),
			listSessions,
			switchProject,
		});

		render(
			<TooltipProvider>
				<App />
			</TooltipProvider>,
		);

		await screen.findByText("E2E profile session");
		await user.click(screen.getByRole("button", { name: /^opencode$/i }));

		await waitFor(() => expect(switchProject).toHaveBeenCalledWith(emptyProject.id));
		expect(await screen.findByText("暂无对话，点击左上角新对话开始。")).toBeTruthy();
		expect(listSessions).toHaveBeenCalledWith(emptyProject.id);
	});
});
