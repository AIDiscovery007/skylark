import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "../../src/renderer/components/terminal/TerminalPanel.tsx";
import type { DesktopAgentBridge } from "../../src/shared/ipc-contract.ts";
import type { SerializedTerminalEvent } from "../../src/shared/serialized-terminal-event.ts";
import type { DesktopReviewSnapshot } from "../../src/shared/types.ts";
import {
	createRendererBridgeEventChannel,
	installRendererDesktopAgentBridge,
	removeRendererDesktopAgentBridge,
} from "../support/renderer-desktop-agent-bridge.ts";

const cleanReviewSnapshot: DesktopReviewSnapshot = {
	status: "clean",
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

const terminalMocks = vi.hoisted(() => {
	class MockTerminal {
		static instances: MockTerminal[] = [];
		cols = 80;
		rows = 24;
		writes: string[] = [];
		disposeCount = 0;
		focusCount = 0;
		options: { fontFamily?: string; fontSize?: number; theme?: unknown };
		private dataHandler?: (data: string) => void;

		constructor(options: { fontFamily?: string; fontSize?: number; theme?: unknown } = {}) {
			this.options = { ...options };
			MockTerminal.instances.push(this);
		}

		loadAddon(_addon: unknown): void {}

		openedElement?: HTMLElement;

		open(element: HTMLElement): void {
			this.openedElement = element;
		}

		focus(): void {
			this.focusCount += 1;
		}

		write(data: string): void {
			this.writes.push(data);
		}

		onData(handler: (data: string) => void): { dispose: () => void } {
			this.dataHandler = handler;
			return {
				dispose: () => {
					this.dataHandler = undefined;
				},
			};
		}

		emitData(data: string): void {
			this.dataHandler?.(data);
		}

		dispose(): void {
			this.disposeCount += 1;
		}
	}

	class MockFitAddon {
		fitCount = 0;

		fit(): void {
			this.fitCount += 1;
		}
	}

	return { MockFitAddon, MockTerminal };
});

vi.mock("@xterm/xterm", () => ({ Terminal: terminalMocks.MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: terminalMocks.MockFitAddon }));

function installBridge() {
	const terminalEvents = createRendererBridgeEventChannel<SerializedTerminalEvent>();
	const bridge: DesktopAgentBridge = {
		abort: vi.fn(async () => undefined),
		cancelOAuthLogin: vi.fn(async () => undefined),
		createProjectFromFolder: vi.fn(async () => undefined),
		createTerminal: vi.fn(async () => undefined),
		deleteProviderKey: vi.fn(async () => undefined),
		deleteSession: vi.fn(async () => undefined),
		disposeTerminal: vi.fn(async () => undefined),
		testProviderKey: vi.fn(async (provider: string) => ({
			provider,
			ok: true,
			message: "连接正常",
		})),
		getRuntimeCatalog: vi.fn(async () => ({ defaultTools: [], providers: [] })),
		getNativeAppearance: vi.fn(async () => ({
			accentColor: "#0a84ff",
			colorScheme: "light" as const,
			forcedColors: false,
			highContrast: false,
			invertedColors: false,
			reducedTransparency: false,
		})),
		getSettings: vi.fn(async () => ({})),
		getWorkspaceOverview: vi.fn(async () => ({
			settings: {},
			projects: [],
			sessionsByProjectId: {},
		})),
		getSnapshot: vi.fn(async () => {
			throw new Error("unused");
		}),
		getSessionMessages: vi.fn(async () => ({
			sessionId: "session-1",
			messages: [],
			window: { start: 0, end: 0, total: 0, hasMoreBefore: false },
		})),
		getStorageSecurityState: vi.fn(async () => ({
			providerKeysEncrypted: false,
			secureStorageAvailable: false,
		})),
		getReviewSnapshot: vi.fn(async () => cleanReviewSnapshot),
		getReviewFilePatch: vi.fn(async (request) => ({
			path: request.path,
			status: "modified" as const,
			additions: 0,
			deletions: 0,
			staged: false,
			unstaged: false,
			isBinary: false,
			isTooLarge: false,
			patch: "",
		})),
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
		listOAuthProviders: vi.fn(async () => []),
		listProjects: vi.fn(async () => []),
		listProviderKeys: vi.fn(async () => []),
		listSessions: vi.fn(async () => []),
		logoutOAuthProvider: vi.fn(async () => undefined),
		newSession: vi.fn(async () => undefined),
		notifyFirstInteractive: vi.fn(async () => undefined),
		listEnvironmentResources: vi.fn(async () => []),
		detachEnvironmentResource: vi.fn(async () => {
			throw new Error("unused");
		}),
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
		openPreviewFiles: vi.fn(async () => []),
		openExternalUrl: vi.fn(async () => undefined),
		openSettingsWindow: vi.fn(async () => undefined),
		listWorkspaceFiles: vi.fn(async () => ({ files: [], truncated: false })),
		openWorkspacePreviewFile: vi.fn(async () => {
			throw new Error("unused");
		}),
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
		compact: vi.fn(async () => {
			throw new Error("unused");
		}),
		setSessionMode: vi.fn(async () => {
			throw new Error("unused");
		}),
		consumeProposedPlan: vi.fn(async () => {
			throw new Error("unused");
		}),
		executePlan: vi.fn(async () => {
			throw new Error("unused");
		}),
		refreshPreviewFile: vi.fn(async () => {
			throw new Error("unused");
		}),
		resizeTerminal: vi.fn(async () => undefined),
		resolveApproval: vi.fn(async () => undefined),
		setProviderKey: vi.fn(async () => undefined),
		setSetting: vi.fn(async () => undefined),
		startOAuthLogin: vi.fn(async () => undefined),
		submitOAuthLoginCode: vi.fn(async () => undefined),
		subscribeToAgentEvents: vi.fn(() => () => undefined),
		subscribeToApprovalEvents: vi.fn(() => () => undefined),
		subscribeToAuthEvents: vi.fn(() => () => undefined),
		subscribeToCapabilityEvents: vi.fn(() => () => undefined),
		subscribeToEnvironmentEvents: vi.fn(() => () => undefined),
		subscribeToEventEvents: vi.fn(() => () => undefined),
		subscribeToSettingsEvents: vi.fn(() => () => undefined),
		subscribeToSettingsOpenRequests: vi.fn(() => () => undefined),
		subscribeToSubagentEvents: vi.fn(() => () => undefined),
		subscribeToTerminalEvents: terminalEvents.subscribe,
		subscribeToWorkspaceRuntimeEvents: vi.fn(() => () => undefined),
		switchProject: vi.fn(async () => undefined),
		switchSession: vi.fn(async () => undefined),
		updateSessionProfile: vi.fn(async () => {
			throw new Error("unused");
		}),
		writeTerminal: vi.fn(async () => undefined),
	};

	installRendererDesktopAgentBridge(bridge);

	return {
		bridge,
		emitTerminalEvent: terminalEvents.emit,
	};
}

afterEach(() => {
	cleanup();
	document.documentElement.style.removeProperty("--desktop-code-font-family");
	document.documentElement.style.removeProperty("--desktop-code-font-size");
	document.documentElement.style.removeProperty("--font-mono");
	terminalMocks.MockTerminal.instances.length = 0;
	removeRendererDesktopAgentBridge();
});

function ControlledTerminalPanel({
	cwd = "/workspace",
	initialOpen = false,
	openEnvironmentResourceRequest,
	sessionId = "session-1",
}: {
	cwd?: string;
	initialOpen?: boolean;
	openEnvironmentResourceRequest?: {
		requestId: number;
		resourceId: string;
		title: string;
	};
	sessionId?: string;
}) {
	const [isOpen, setIsOpen] = useState(initialOpen);

	return (
		<TerminalPanel
			cwd={cwd}
			isOpen={isOpen}
			onOpenChange={setIsOpen}
			openEnvironmentResourceRequest={openEnvironmentResourceRequest}
			sessionId={sessionId}
		/>
	);
}

describe("TerminalPanel", () => {
	it("keeps xterm out of the collapsed terminal shell module", () => {
		const shellSource = readFileSync("src/renderer/components/terminal/TerminalPanel.tsx", "utf8");
		const sessionSource = readFileSync("src/renderer/components/terminal/TerminalSession.tsx", "utf8");

		expect(shellSource).toContain("const TerminalSession = lazy");
		expect(shellSource).not.toContain("@xterm/xterm");
		expect(shellSource).not.toContain("@xterm/addon-fit");
		expect(sessionSource).toContain("@xterm/xterm");
		expect(sessionSource).toContain("@xterm/addon-fit");
		expect(sessionSource).not.toContain("#0f172a");
	});

	it("collapses to zero height without rendering a bottom terminal entry", () => {
		const { bridge } = installBridge();

		render(<ControlledTerminalPanel />);

		const terminalPanel = document.querySelector("[data-slot='terminal-panel']");
		expect(bridge.createTerminal).not.toHaveBeenCalled();
		expect(terminalPanel?.getAttribute("data-state")).toBe("closed");
		expect(terminalPanel?.getAttribute("style")).toContain("--structural-drawer-size: 0px");
		expect(screen.queryByRole("button", { name: "Expand terminal" })).toBeNull();
		expect(screen.queryByText("Terminal")).toBeNull();
	});

	it("creates and streams the active session terminal without disposing on collapse", async () => {
		const { bridge, emitTerminalEvent } = installBridge();

		render(<ControlledTerminalPanel />);

		expect(bridge.createTerminal).not.toHaveBeenCalled();
		cleanup();

		render(<ControlledTerminalPanel initialOpen />);

		await waitFor(() => {
			expect(bridge.createTerminal).toHaveBeenCalledWith({
				cols: 80,
				rows: 24,
				sessionId: "session-1",
				source: { type: "shell", cwd: "/workspace" },
				terminalId: "terminal-1",
			});
		});

		const terminal = terminalMocks.MockTerminal.instances[0];
		const terminalPanel = document.querySelector("[data-slot='terminal-panel']");
		const terminalToolbar = document.querySelector("[data-slot='terminal-toolbar']");
		const terminalTab = document.querySelector("[data-slot='terminal-tab']");
		const terminalBody = document.querySelector("[data-slot='terminal-body']");
		const terminalViewportShell = document.querySelector("[data-slot='terminal-viewport-shell']");
		const terminalViewport = document.querySelector("[data-slot='terminal-viewport']");
		expect(terminalPanel?.getAttribute("data-motion")).toBe("structural-drawer");
		expect(terminalPanel?.getAttribute("data-motion-origin")).toBe("bottom");
		expect(terminalPanel?.getAttribute("data-motion-owner")).toBe("spacer");
		expect(terminalPanel?.getAttribute("data-structural-layout-driver")).toBe("height");
		expect(terminalPanel?.className).toContain("shadow-none");
		expect(terminalPanel?.className).not.toContain("border-t");
		expect(terminalToolbar?.className).not.toContain("border-b");
		expect(terminalTab?.className).not.toContain("border");
		expect(terminalTab?.className).toContain("bg-[color:var(--surface-2)]");
		expect(terminalBody?.className).toContain("bg-[color:var(--terminal-background)]");
		expect(terminalBody?.classList.contains("hidden")).toBe(false);
		expect(terminalViewportShell?.className).toContain("px-4");
		expect(terminalViewportShell?.className).toContain("pt-2");
		expect(terminalViewportShell?.className).toContain("pb-4");
		expect(terminalViewportShell?.className).toContain("bg-[color:var(--terminal-background)]");
		expect(terminalViewport?.className).toContain("overflow-hidden");
		expect(terminal.openedElement).toBe(terminalViewport);

		terminal.emitData("pwd\n");
		expect(bridge.writeTerminal).toHaveBeenCalledWith({ data: "pwd\n", terminalId: "terminal-1" });

		emitTerminalEvent({ data: "ok", terminalId: "terminal-1", sessionId: "session-1", type: "terminal_data" });
		expect(terminal.writes).toContain("ok");

		fireEvent.click(screen.getByLabelText("Collapse terminal"));
		await waitFor(() => {
			expect(terminalPanel?.getAttribute("data-state")).toBe("closed");
		});
		expect(bridge.disposeTerminal).not.toHaveBeenCalled();
		expect(terminal.disposeCount).toBe(0);
	});

	it("uses the root code font size for xterm and refreshes when appearance changes", async () => {
		const { bridge } = installBridge();
		document.documentElement.style.setProperty("--desktop-code-font-size", "15px");

		render(<ControlledTerminalPanel initialOpen />);

		await waitFor(() => {
			expect(bridge.createTerminal).toHaveBeenCalledWith(
				expect.objectContaining({ sessionId: "session-1", terminalId: "terminal-1" }),
			);
		});

		const terminal = terminalMocks.MockTerminal.instances[0];
		expect(terminal.options.fontSize).toBe(15);

		document.documentElement.style.setProperty("--desktop-code-font-size", "18px");

		await waitFor(() => {
			expect(terminal.options.fontSize).toBe(18);
		});
	});

	it("passes a resolved monospace font family to xterm", async () => {
		const { bridge } = installBridge();
		document.documentElement.style.setProperty("--desktop-code-font-family", "var(--font-mono)");
		document.documentElement.style.setProperty("--font-mono", '"Skylark Mono", Menlo, monospace');

		render(<ControlledTerminalPanel initialOpen />);

		await waitFor(() => {
			expect(bridge.createTerminal).toHaveBeenCalledWith(
				expect.objectContaining({ sessionId: "session-1", terminalId: "terminal-1" }),
			);
		});

		const terminal = terminalMocks.MockTerminal.instances[0];
		expect(terminal.options.fontFamily).toBe('"Skylark Mono", Menlo, monospace');
		expect(terminal.options.fontFamily).not.toContain("var(");
	});

	it("adds, routes, switches, and closes terminal tabs independently", async () => {
		const { bridge, emitTerminalEvent } = installBridge();

		render(<ControlledTerminalPanel initialOpen />);

		await waitFor(() => {
			expect(bridge.createTerminal).toHaveBeenCalledWith(
				expect.objectContaining({ sessionId: "session-1", terminalId: "terminal-1" }),
			);
		});

		fireEvent.click(screen.getByLabelText("New terminal"));
		await waitFor(() => {
			expect(bridge.createTerminal).toHaveBeenCalledWith(
				expect.objectContaining({ sessionId: "session-1", terminalId: "terminal-2" }),
			);
		});

		const firstTerminal = terminalMocks.MockTerminal.instances[0];
		const secondTerminal = terminalMocks.MockTerminal.instances[1];
		expect(firstTerminal.disposeCount).toBe(0);

		emitTerminalEvent({
			data: "first",
			terminalId: "terminal-1",
			sessionId: "session-1",
			type: "terminal_data",
		});
		emitTerminalEvent({
			data: "second",
			terminalId: "terminal-2",
			sessionId: "session-1",
			type: "terminal_data",
		});

		expect(firstTerminal.writes).toContain("first");
		expect(firstTerminal.writes).not.toContain("second");
		expect(secondTerminal.writes).toContain("second");
		expect(secondTerminal.writes).not.toContain("first");

		fireEvent.click(screen.getByRole("tab", { name: "Terminal 1" }));
		firstTerminal.emitData("whoami\n");
		expect(bridge.writeTerminal).toHaveBeenCalledWith({ data: "whoami\n", terminalId: "terminal-1" });

		fireEvent.click(screen.getByLabelText("Close Terminal 1"));
		await waitFor(() => {
			expect(bridge.disposeTerminal).toHaveBeenCalledWith({ terminalId: "terminal-1" });
		});
		expect(firstTerminal.disposeCount).toBe(1);
		expect(secondTerminal.disposeCount).toBe(0);

		fireEvent.click(screen.getByLabelText("Close Terminal 2"));
		await waitFor(() => {
			expect(bridge.disposeTerminal).toHaveBeenCalledWith({ terminalId: "terminal-2" });
		});
		expect(screen.getAllByRole("button", { name: "New terminal" }).length).toBeGreaterThan(0);
	});

	it("opens environment resource tabs as read-only terminals", async () => {
		const { bridge } = installBridge();

		const { rerender } = render(<ControlledTerminalPanel />);
		rerender(
			<ControlledTerminalPanel
				openEnvironmentResourceRequest={{
					requestId: 1,
					resourceId: "env_tmux_tests",
					title: "Tests",
				}}
			/>,
		);

		await waitFor(() => {
			expect(bridge.createTerminal).toHaveBeenCalledWith({
				cols: 80,
				rows: 24,
				sessionId: "session-1",
				source: { type: "environment_resource", resourceId: "env_tmux_tests", readOnly: true },
				terminalId: "terminal-1",
			});
		});

		const terminal = terminalMocks.MockTerminal.instances[0];
		terminal.emitData("should-not-write\n");
		expect(bridge.writeTerminal).not.toHaveBeenCalled();
		expect(screen.getByRole("tab", { name: "Tests" })).toBeTruthy();
	});
});
