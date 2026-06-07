import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clampReviewPanelWidth,
	REVIEW_PANEL_WIDTH,
	ReviewWorkspacePanel,
	resolveReviewPanelMaxWidth,
} from "../../src/renderer/components/review/ReviewWorkspacePanel.tsx";
import { TooltipProvider } from "../../src/renderer/components/ui/tooltip.tsx";
import type { DesktopAgentBridge } from "../../src/shared/ipc-contract.ts";
import type { SerializedAgentEvent } from "../../src/shared/serialized-agent-event.ts";
import type {
	DesktopEnvironmentEvent,
	DesktopPreviewFile,
	DesktopPreviewFileRequest,
	DesktopReviewFilePatchRequest,
	DesktopReviewSnapshot,
	DesktopReviewSnapshotRequest,
	DesktopSubagentRuntimeEvent,
	DesktopSubagentSnapshot,
	DesktopWebPreviewEvent,
	DesktopWebPreviewState,
	DesktopWorkspaceFileEntry,
	DesktopWorkspaceFileListResult,
	DesktopWorkspacePreviewFileRequest,
} from "../../src/shared/types.ts";
import {
	createRendererBridgeEventChannel,
	installRendererDesktopAgentBridge,
	removeRendererDesktopAgentBridge,
} from "../support/renderer-desktop-agent-bridge.ts";

const changedSnapshot: DesktopReviewSnapshot = {
	status: "changed",
	cwd: "/workspace/project",
	repositoryRoot: "/workspace/project",
	branch: "feature/review",
	files: [
		{
			path: "src/App.tsx",
			status: "modified",
			additions: 1,
			deletions: 0,
			staged: false,
			unstaged: true,
			isBinary: false,
			isTooLarge: false,
			patch: [
				"diff --git a/src/App.tsx b/src/App.tsx",
				"index 1111111..2222222 100644",
				"--- a/src/App.tsx",
				"+++ b/src/App.tsx",
				"@@ -1,2 +1,3 @@",
				" const value = 1;",
				"+const review = true;",
				" export default value;",
			].join("\n"),
		},
		{
			path: "src/stores/review-store.ts",
			status: "untracked",
			additions: 2,
			deletions: 0,
			staged: false,
			unstaged: true,
			isBinary: false,
			isTooLarge: false,
			patch: [
				"diff --git a/src/stores/review-store.ts b/src/stores/review-store.ts",
				"new file mode 100644",
				"--- /dev/null",
				"+++ b/src/stores/review-store.ts",
				"@@ -0,0 +1,2 @@",
				"+export const ready = true;",
				"+export const count = 1;",
			].join("\n"),
		},
	],
	totals: { files: 2, additions: 3, deletions: 0 },
	patch: "",
	generatedAt: "2026-05-01T00:00:00.000Z",
	actions: {
		commit: false,
		push: false,
		createPullRequest: false,
		createBranch: false,
		reason: "只读审查模式暂不执行 Git 写操作。",
	},
};

const secondSnapshot: DesktopReviewSnapshot = {
	...changedSnapshot,
	branch: "feature/second",
	files: [
		{
			path: "src/Second.tsx",
			status: "modified",
			additions: 1,
			deletions: 0,
			staged: false,
			unstaged: true,
			isBinary: false,
			isTooLarge: false,
			patch: [
				"diff --git a/src/Second.tsx b/src/Second.tsx",
				"index 3333333..4444444 100644",
				"--- a/src/Second.tsx",
				"+++ b/src/Second.tsx",
				"@@ -1,1 +1,2 @@",
				" const value = 2;",
				"+const second = true;",
			].join("\n"),
		},
	],
	totals: { files: 1, additions: 1, deletions: 0 },
};

const textPreviewFile: DesktopPreviewFile = {
	path: "/workspace/project/notes.txt",
	name: "notes.txt",
	mimeType: "text/plain",
	size: 14,
	kind: "text",
	content: "hello preview\n",
	updatedAt: "2026-05-01T00:00:00.000Z",
};
const typescriptPreviewFile: DesktopPreviewFile = {
	path: "/workspace/project/.pi/extensions/tps.ts",
	name: "tps.ts",
	mimeType: "text/typescript",
	size: 34,
	kind: "text",
	content: "export const ready: boolean = true;\n",
	updatedAt: "2026-05-01T00:00:00.000Z",
};
const workspaceFileEntries: DesktopWorkspaceFileEntry[] = [
	{
		path: "notes.txt",
		name: "notes.txt",
		type: "docs",
		size: 14,
		updatedAt: "2026-05-01T00:00:00.000Z",
	},
	{
		path: ".pi/extensions/tps.ts",
		name: "tps.ts",
		type: "code",
		size: 34,
		updatedAt: "2026-05-01T00:00:00.000Z",
	},
	{
		path: "src/App.tsx",
		name: "App.tsx",
		type: "code",
		size: 84,
		updatedAt: "2026-05-01T00:00:00.000Z",
	},
];
const htmlPreviewFile: DesktopPreviewFile = {
	path: "/workspace/project/chart.html",
	name: "chart.html",
	mimeType: "text/html",
	size: 48,
	kind: "html",
	content: "<!doctype html><html><body>Chart</body></html>",
	previewUrl: "skylark-preview://session/chart.html",
	updatedAt: "2026-05-01T00:00:00.000Z",
};
const svgPreviewFile: DesktopPreviewFile = {
	path: "/workspace/project/shape.svg",
	name: "shape.svg",
	mimeType: "image/svg+xml",
	size: 70,
	kind: "svg",
	content: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" /></svg>',
	previewUrl: "skylark-preview://session/shape.svg",
	updatedAt: "2026-05-01T00:00:00.000Z",
};

function createWebPreviewState(
	id: string,
	url: string,
	title = url,
	isSelectingElement?: boolean,
): DesktopWebPreviewState {
	return {
		canGoBack: false,
		canGoForward: false,
		id,
		...(isSelectingElement === undefined ? {} : { isSelectingElement }),
		isLoading: false,
		title,
		url,
	};
}

type ReviewSnapshotSource =
	| DesktopReviewSnapshot
	| ((request: DesktopReviewSnapshotRequest) => DesktopReviewSnapshot | Promise<DesktopReviewSnapshot>);

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const subagentSnapshot: DesktopSubagentSnapshot = {
	parentSessionId: "session-1",
	subagentId: "subagent-1",
	resource: {
		createdAt: "2026-05-27T01:00:00.000Z",
		cwd: "/workspace/project",
		id: "env_subagent_subagent_1",
		kind: "subagent",
		lastSeenAt: "2026-05-27T01:01:00.000Z",
		metadata: {
			contextSummary: "Parent is checking the auth flow.",
			expectedOutput: "Concise Markdown summary with evidence.",
			limitReached: "true",
			limitReason: "max_turns",
			maxTurns: "1",
			scope: "Read-only auth inspection.",
			subagentId: "subagent-1",
			successCriteria: "Identify the auth entry point.",
			suggestedApproach: "Read README.md, then stop.",
			toolCallId: "subagent-tool-1",
			transcriptPath: "/Users/qiaochao/.skylark/subagents/session-1/subagent-1.jsonl",
			turnCount: "1",
		},
		provider: "subagent",
		sessionId: "session-1",
		status: "completed",
		title: "Inspect auth flow",
		updatedAt: "2026-05-27T01:01:00.000Z",
	},
	sessionId: "subagent-1",
	cwd: "/workspace/project",
	agentMode: "execute",
	diagnostics: [],
	thinkingLevel: "off",
	availableTools: [],
	messages: [
		{
			role: "user",
			content: [{ type: "text", text: "Find where auth starts." }],
			timestamp: 1,
		},
		{
			role: "assistant",
			api: "faux",
			content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "README.md" } }],
			model: "faux-model",
			provider: "faux",
			stopReason: "toolUse",
			timestamp: 2,
			usage: EMPTY_USAGE,
		},
		{
			role: "toolResult",
			content: [{ type: "text", text: "Login starts in src/auth.ts." }],
			isError: false,
			timestamp: 3,
			toolCallId: "read-1",
			toolName: "read",
		},
		{
			role: "assistant",
			api: "faux",
			content: [{ type: "text", text: "Auth starts in `src/auth.ts`." }],
			model: "faux-model",
			provider: "faux",
			stopReason: "stop",
			timestamp: 4,
			usage: EMPTY_USAGE,
		},
	],
	pendingToolCalls: [],
	isStreaming: false,
};

function installBridge(
	snapshot: ReviewSnapshotSource = changedSnapshot,
	previewFiles: DesktopPreviewFile[] = [],
	workspaceFileList: DesktopWorkspaceFileListResult = {
		files: workspaceFileEntries,
		rootPath: "/workspace/project",
		truncated: false,
	},
	workspacePreviewFiles: DesktopPreviewFile[] = previewFiles,
) {
	const agentEvents = createRendererBridgeEventChannel<SerializedAgentEvent>();
	const environmentEvents = createRendererBridgeEventChannel<DesktopEnvironmentEvent>();
	const subagentEvents = createRendererBridgeEventChannel<DesktopSubagentRuntimeEvent>();
	const webPreviewEvents = createRendererBridgeEventChannel<DesktopWebPreviewEvent>();
	const webPreviewStatesById = new Map<string, DesktopWebPreviewState>();
	const getWebPreviewState = (id: string): DesktopWebPreviewState =>
		webPreviewStatesById.get(id) ?? createWebPreviewState(id, "https://example.com/");
	const rememberWebPreviewState = (state: DesktopWebPreviewState): DesktopWebPreviewState => {
		webPreviewStatesById.set(state.id, state);
		return state;
	};
	const resolveSnapshot = async (request: DesktopReviewSnapshotRequest): Promise<DesktopReviewSnapshot> =>
		typeof snapshot === "function" ? snapshot(request) : snapshot;
	const stripSnapshotPatches = (sourceSnapshot: DesktopReviewSnapshot): DesktopReviewSnapshot => ({
		...sourceSnapshot,
		patch: undefined,
		files: sourceSnapshot.files.map(({ patch: _patch, ...file }) => file),
	});
	const bridge = {
		getReviewSnapshot: vi.fn(async (request: DesktopReviewSnapshotRequest) =>
			stripSnapshotPatches(await resolveSnapshot(request)),
		),
		getReviewFilePatch: vi.fn(async (request: DesktopReviewFilePatchRequest) => {
			const sourceSnapshot = await resolveSnapshot(request);
			const file = sourceSnapshot.files.find((entry) => entry.path === request.path);
			if (!file) {
				throw new Error("Review file not found");
			}
			return file;
		}),
		getSubagentSnapshot: vi.fn(async () => subagentSnapshot),
		openExternalUrl: vi.fn(async () => undefined),
		openPreviewFiles: vi.fn(async () => previewFiles),
		listWorkspaceFiles: vi.fn(async () => workspaceFileList),
		showWebPreview: vi.fn(async (request) => {
			const currentState = getWebPreviewState(request.id);
			return rememberWebPreviewState({
				...createWebPreviewState(request.id, request.url),
				canGoBack: currentState.canGoBack,
				canGoForward: currentState.canGoForward,
			});
		}),
		updateWebPreviewBounds: vi.fn(async (request) =>
			request.occluded ? { dataUrl: "data:image/png;base64,preview" } : undefined,
		),
		controlWebPreview: vi.fn(async (request) => {
			const currentState = getWebPreviewState(request.id);
			const state = createWebPreviewState(request.id, currentState.url, currentState.title);
			if (request.action === "back") {
				state.canGoForward = true;
			}
			if (request.action === "forward") {
				state.canGoBack = true;
			}
			return rememberWebPreviewState(state);
		}),
		clearWebPreviewStorage: vi.fn(async (request) => getWebPreviewState(request.id)),
		setWebPreviewElementSelectionMode: vi.fn(async (request) =>
			rememberWebPreviewState({
				...getWebPreviewState(request.id),
				isSelectingElement: request.enabled,
			}),
		),
		closeWebPreview: vi.fn(async () => undefined),
		openWorkspacePreviewFile: vi.fn(async (request: DesktopWorkspacePreviewFileRequest) => {
			const previewFile = workspacePreviewFiles.find(
				(file) => file.path === request.path || file.path.endsWith(request.path),
			);
			if (!previewFile) {
				throw new Error("Preview file not found");
			}
			return previewFile;
		}),
		refreshPreviewFile: vi.fn(async (request: DesktopPreviewFileRequest) => {
			const previewFile = previewFiles.find((file) => file.path === request.path);
			if (!previewFile) {
				throw new Error("Preview file not found");
			}
			return previewFile;
		}),
		subscribeToAgentEvents: agentEvents.subscribe,
		subscribeToEnvironmentEvents: environmentEvents.subscribe,
		subscribeToSubagentEvents: subagentEvents.subscribe,
		subscribeToWebPreviewEvents: webPreviewEvents.subscribe,
	} as Pick<
		DesktopAgentBridge,
		| "closeWebPreview"
		| "controlWebPreview"
		| "clearWebPreviewStorage"
		| "getSubagentSnapshot"
		| "getReviewFilePatch"
		| "getReviewSnapshot"
		| "listWorkspaceFiles"
		| "openPreviewFiles"
		| "openExternalUrl"
		| "openWorkspacePreviewFile"
		| "refreshPreviewFile"
		| "setWebPreviewElementSelectionMode"
		| "showWebPreview"
		| "subscribeToAgentEvents"
		| "subscribeToEnvironmentEvents"
		| "subscribeToSubagentEvents"
		| "subscribeToWebPreviewEvents"
		| "updateWebPreviewBounds"
	>;

	installRendererDesktopAgentBridge(bridge);

	return {
		bridge,
		emitAgentEvent: agentEvents.emit,
		emitEnvironmentEvent: environmentEvents.emit,
		emitSubagentEvent: subagentEvents.emit,
		emitWebPreviewEvent: (event: DesktopWebPreviewEvent) => {
			if (event.type === "web_preview_state") {
				rememberWebPreviewState(event.state);
			}
			webPreviewEvents.emit(event);
		},
	};
}

function renderPanel(
	snapshot: ReviewSnapshotSource = changedSnapshot,
	options: {
		openReview?: boolean;
		previewFiles?: DesktopPreviewFile[];
		workspaceFileList?: DesktopWorkspaceFileListResult;
	} = {},
) {
	const helpers = installBridge(snapshot, options.previewFiles, options.workspaceFileList);
	render(
		<TooltipProvider>
			<div className="relative h-[720px]">
				<ReviewWorkspacePanel
					isFullscreen={false}
					onClose={vi.fn()}
					onFullscreenChange={vi.fn()}
					open
					projectId="project-1"
					sessionId="session-1"
					workspaceLabel="/workspace/project"
				/>
			</div>
		</TooltipProvider>,
	);
	if (options.openReview ?? true) {
		fireEvent.click(screen.getByRole("button", { name: "审查" }));
	}
	return helpers;
}

async function findWorkspaceCreateMenuItem(
	user: ReturnType<typeof userEvent.setup>,
	name: string,
): Promise<HTMLElement> {
	await user.click(screen.getByRole("button", { name: "New workspace item" }));
	if (!screen.queryByRole("button", { name })) {
		fireEvent.click(screen.getByRole("button", { name: "New workspace item" }));
	}
	return screen.findByRole("button", { name }, { timeout: 3000 });
}

function ReviewPanelHarness({ isTitlebarSummaryVisible = false }: { isTitlebarSummaryVisible?: boolean }) {
	const [open, setOpen] = useState(true);
	const [isFullscreen, setIsFullscreen] = useState(false);

	return (
		<TooltipProvider>
			<button onClick={() => setOpen(true)} type="button">
				Open review
			</button>
			<div className="relative h-[720px]">
				<ReviewWorkspacePanel
					isFullscreen={isFullscreen}
					isTitlebarSummaryVisible={isTitlebarSummaryVisible}
					onClose={() => setOpen(false)}
					onFullscreenChange={setIsFullscreen}
					open={open}
					projectId="project-1"
					sessionId="session-1"
					workspaceLabel="/workspace/project"
				/>
			</div>
		</TooltipProvider>
	);
}

function ClosedReviewPanelHarness() {
	const [open, setOpen] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);

	return (
		<TooltipProvider>
			<button onClick={() => setOpen(true)} type="button">
				Open review
			</button>
			<div className="relative h-[720px]">
				<ReviewWorkspacePanel
					isFullscreen={isFullscreen}
					onClose={() => setOpen(false)}
					onFullscreenChange={setIsFullscreen}
					open={open}
					projectId="project-1"
					sessionId="session-1"
					workspaceLabel="/workspace/project"
				/>
			</div>
		</TooltipProvider>
	);
}

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	removeRendererDesktopAgentBridge();
});

describe("ReviewWorkspacePanel", () => {
	it("clamps the outer review panel width while protecting the main workbench", () => {
		expect(resolveReviewPanelMaxWidth(undefined)).toBe(REVIEW_PANEL_WIDTH.max);
		expect(resolveReviewPanelMaxWidth(1600)).toBe(1040);
		expect(clampReviewPanelWidth(2000, 2000)).toBe(REVIEW_PANEL_WIDTH.max);
		expect(clampReviewPanelWidth(200, 2000)).toBe(REVIEW_PANEL_WIDTH.min);
		expect(clampReviewPanelWidth(REVIEW_PANEL_WIDTH.default, 800)).toBe(240);
	});

	it("starts as a tabless workspace with file, browser, and review launch cards", async () => {
		const user = userEvent.setup();
		const { bridge } = renderPanel(changedSnapshot, { openReview: false, previewFiles: [textPreviewFile] });

		expect(screen.queryByRole("tablist", { name: "Workspace panel tabs" })).toBeNull();
		expect(screen.getByRole("button", { name: "文件" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "浏览器" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "审查" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "显示项目文件树" })).toBeNull();
		expect(screen.queryByRole("button", { name: "收起变更文件列表" })).toBeNull();
		expect(document.querySelector('[data-slot="review-workspace-title-block"]')).toBeNull();

		await user.click(screen.getByRole("button", { name: "浏览器" }));
		expect(await screen.findByRole("tab", { name: "网页预览" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "显示项目文件树" })).toBeNull();
		expect(screen.queryByRole("button", { name: "收起变更文件列表" })).toBeNull();
		await user.click(screen.getByRole("button", { name: "Close 网页预览" }));
		expect(screen.queryByRole("tablist", { name: "Workspace panel tabs" })).toBeNull();

		await user.click(screen.getByRole("button", { name: "文件" }));
		expect(bridge.openPreviewFiles).toHaveBeenCalledWith({ projectId: "project-1" });
		expect(await screen.findByRole("tab", { name: /notes\.txt/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: "显示项目文件树" })).toBeTruthy();
		expect(
			within(document.querySelector('[data-slot="review-workspace-header-actions"]') as HTMLElement).queryByRole(
				"button",
				{ name: "显示项目文件树" },
			),
		).toBeNull();
		expect(screen.queryByRole("button", { name: "收起变更文件列表" })).toBeNull();
		await user.click(screen.getByRole("button", { name: "Close notes.txt" }));

		await user.click(screen.getByRole("button", { name: "审查" }));
		expect(await screen.findByRole("tab", { name: "审查" })).toBeTruthy();
		expect(await screen.findByRole("button", { name: "收起变更文件列表" })).toBeTruthy();
		expect(
			within(document.querySelector('[data-slot="review-workspace-header-actions"]') as HTMLElement).queryByRole(
				"button",
				{ name: "收起变更文件列表" },
			),
		).toBeNull();
		expect(screen.queryByRole("button", { name: "显示项目文件树" })).toBeNull();
		await user.click(screen.getByRole("button", { name: "Close 审查" }));
		expect(screen.queryByRole("tablist", { name: "Workspace panel tabs" })).toBeNull();
	});

	it("renders changed file tree, selected diff, and disabled git actions", async () => {
		const user = userEvent.setup();
		const { bridge } = renderPanel();

		await waitFor(() => {
			expect(bridge.getReviewSnapshot).toHaveBeenCalledWith({ projectId: "project-1" });
		});
		expect(await screen.findByText("feature/review")).toBeTruthy();
		expect(await screen.findByRole("tab", { name: "审查" })).toBeTruthy();
		expect(await screen.findByText("App.tsx")).toBeTruthy();
		expect(await screen.findByText("const review = true;")).toBeTruthy();
		expect(bridge.getReviewFilePatch).toHaveBeenCalledWith({
			path: "src/App.tsx",
			projectId: "project-1",
		});
		const header = document.querySelector('[data-slot="review-workspace-header"]');
		const tabStrip = document.querySelector('[data-slot="review-workspace-tab-strip"]');
		expect(header?.className).toContain("desktop-window-drag-region");
		expect(document.querySelector('[data-slot="review-workspace-title-block"]')).toBeNull();
		expect(tabStrip?.className).toContain("min-w-0");
		expect(tabStrip?.className).toContain("flex-1");
		const headerActions = document.querySelector('[data-slot="review-workspace-header-actions"]');
		expect(headerActions?.className).toContain("desktop-window-drag-region");
		expect(headerActions?.className).toContain("h-full");
		expect(headerActions?.className).not.toContain("desktop-window-no-drag");
		expect(screen.queryByRole("button", { name: "Collapse review workspace" })).toBeNull();
		expect(screen.getByRole("button", { name: "Close review workspace" }).className).toContain(
			"desktop-window-no-drag",
		);
		expect(document.querySelector('[data-slot="review-selected-file-header"]')?.className).toContain("min-w-0");
		expect(screen.getByTitle("src/App.tsx").className).toContain("truncate");
		const fileRow = screen.getByRole("button", { name: /app.tsx/i });
		const fileName = within(fileRow).getByText("App.tsx");
		const statusBadge = fileRow.querySelector('[data-slot="review-file-status-badge"]');
		expect(fileRow.className).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
		expect(fileRow.className).toContain("min-w-0");
		expect(fileName.className).toContain("truncate");
		expect(statusBadge?.className).toContain("shrink-0");
		expect(statusBadge?.className).toContain("justify-self-end");

		await user.click(screen.getByLabelText("Open Git actions"));
		expect(screen.getByText("提交").closest("button")?.disabled).toBe(true);
		expect(screen.getByText("推送").closest("button")?.disabled).toBe(true);
		expect(screen.getByText("只读审查模式暂不执行 Git 写操作。")).toBeTruthy();
	});

	it("reports compact chrome summary from the loaded review snapshot without extra fetches", async () => {
		const onChromeSummaryChange = vi.fn();
		const { bridge } = installBridge();
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onChromeSummaryChange={onChromeSummaryChange}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await waitFor(() => {
			expect(onChromeSummaryChange).toHaveBeenLastCalledWith({
				activeItemLabel: "空面板",
				additions: 3,
				branchLabel: "feature/review",
				deletions: 0,
				title: "综合面板",
				workspaceLabel: "/workspace/project",
			});
		});
		expect(bridge.getReviewSnapshot).toHaveBeenCalledTimes(1);
	});

	it("opens selected code files as highlighted source preview tabs", async () => {
		const user = userEvent.setup();
		const { bridge } = installBridge(changedSnapshot, [typescriptPreviewFile]);
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByRole("button", { name: "New workspace item" });
		await user.click(await findWorkspaceCreateMenuItem(user, "打开文件"));

		expect(bridge.openPreviewFiles).toHaveBeenCalledWith({ projectId: "project-1" });
		expect(await screen.findByRole("tab", { name: /tps\.ts/i })).toBeTruthy();
		const closeButton = screen.getByRole("button", { name: "Close tps.ts" });
		expect(closeButton.className).toContain("opacity-0");
		expect(closeButton.className).toContain("size-3.5");
		expect(closeButton.className).toContain("rounded-full");
		expect(closeButton.className).toContain("group-hover:opacity-100");
		const sourceCode = document.querySelector('[data-slot="preview-source-code"]');
		expect(sourceCode?.getAttribute("data-language")).toBe("typescript");
		await waitFor(() => {
			expect(sourceCode?.textContent).toContain("export");
			expect(sourceCode?.textContent).toContain("ready");
		});
	});

	it("shows a project file tree from file tabs and opens selected workspace files", async () => {
		const user = userEvent.setup();
		const { bridge } = installBridge(
			changedSnapshot,
			[typescriptPreviewFile],
			{
				files: workspaceFileEntries,
				rootPath: "/workspace/project",
				truncated: true,
			},
			[typescriptPreviewFile, textPreviewFile],
		);
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByRole("button", { name: "New workspace item" });
		await user.click(await findWorkspaceCreateMenuItem(user, "打开文件"));
		expect(await screen.findByRole("tab", { name: /tps\.ts/i })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "显示项目文件树" }));
		expect(await screen.findByLabelText("Workspace files tree")).toBeTruthy();
		expect(screen.getByText("仅显示最近 5000 个文件")).toBeTruthy();
		expect(bridge.listWorkspaceFiles).toHaveBeenCalledWith({ limit: 5000, projectId: "project-1" });
		expect(screen.getByRole("button", { name: "收起项目文件树" }).getAttribute("aria-pressed")).toBe("true");

		await user.click(screen.getByRole("button", { name: /notes\.txt/i }));
		expect(bridge.openWorkspacePreviewFile).toHaveBeenCalledWith({ path: "notes.txt", projectId: "project-1" });
		expect(await screen.findByRole("tab", { name: /notes\.txt/i })).toBeTruthy();
		expect(await screen.findByText("hello preview")).toBeTruthy();
	});

	it("shows project file tree errors inside file tabs", async () => {
		const user = userEvent.setup();
		const { bridge } = renderPanel(changedSnapshot, {
			openReview: false,
			previewFiles: [textPreviewFile],
			workspaceFileList: { errorMessage: "无法读取 workspace", files: [], truncated: false },
		});

		await user.click(screen.getByRole("button", { name: "文件" }));
		expect(await screen.findByRole("tab", { name: /notes\.txt/i })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "显示项目文件树" }));
		expect(await screen.findByText("无法读取 workspace")).toBeTruthy();
		expect(bridge.listWorkspaceFiles).toHaveBeenCalledWith({ limit: 5000, projectId: "project-1" });
	});

	it("shows an empty project file tree state inside file tabs", async () => {
		const user = userEvent.setup();
		renderPanel(changedSnapshot, {
			openReview: false,
			previewFiles: [textPreviewFile],
			workspaceFileList: { files: [], truncated: false },
		});

		await user.click(screen.getByRole("button", { name: "文件" }));
		expect(await screen.findByRole("tab", { name: /notes\.txt/i })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "显示项目文件树" }));
		expect(await screen.findByText("没有可显示的项目文件")).toBeTruthy();
	});

	it("bounds retained workspace file preview tabs to the most recent files", async () => {
		const user = userEvent.setup();
		const previewFiles = Array.from(
			{ length: 10 },
			(_, index): DesktopPreviewFile => ({
				path: `/workspace/project/preview-${String(index).padStart(2, "0")}.txt`,
				name: `preview-${String(index).padStart(2, "0")}.txt`,
				mimeType: "text/plain",
				size: 12,
				kind: "text",
				content: `preview ${index}`,
				updatedAt: "2026-05-01T00:00:00.000Z",
			}),
		);
		installBridge(changedSnapshot, previewFiles);
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByRole("button", { name: "New workspace item" });
		await user.click(await findWorkspaceCreateMenuItem(user, "打开文件"));

		expect(await screen.findByRole("tab", { name: /preview-09\.txt/i })).toBeTruthy();
		expect(screen.queryByRole("tab", { name: /preview-00\.txt/i })).toBeNull();
		expect(screen.queryByRole("tab", { name: /preview-01\.txt/i })).toBeNull();
		expect(screen.getByRole("tab", { name: /preview-02\.txt/i })).toBeTruthy();
		expect(screen.getByText("preview 9")).toBeTruthy();
	});

	it("opens a subagent detail tab with persisted transcript and live runtime updates", async () => {
		const user = userEvent.setup();
		const { bridge, emitSubagentEvent } = installBridge();
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						subagentRequest={{
							nonce: 1,
							parentSessionId: "session-1",
							subagentId: "subagent-1",
							title: "Inspect auth flow",
						}}
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		expect(await screen.findByRole("tab", { name: /inspect auth flow/i })).toBeTruthy();
		expect(bridge.getSubagentSnapshot).toHaveBeenCalledWith({
			parentSessionId: "session-1",
			subagentId: "subagent-1",
		});
		expect(await screen.findByRole("button", { name: "Show subagent handoff brief" })).toBeTruthy();
		expect(screen.queryByText("Read-only auth inspection.")).toBeNull();
		expect(await screen.findByText("Find where auth starts.")).toBeTruthy();
		expect(await screen.findByText(/src\/auth\.ts/)).toBeTruthy();
		expect(screen.getByText("budget reached")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Show subagent handoff brief" }));
		expect(screen.getByText("Read-only auth inspection.")).toBeTruthy();

		emitSubagentEvent({
			parentSessionId: "session-1",
			subagentId: "subagent-1",
			event: {
				type: "message_end",
				message: {
					role: "assistant",
					api: "faux",
					content: [{ type: "text", text: "Live detail: also check `src/session.ts`." }],
					model: "faux-model",
					provider: "faux",
					stopReason: "stop",
					timestamp: 5,
					usage: EMPTY_USAGE,
				},
			},
		});

		expect(await screen.findByText(/src\/session\.ts/)).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Close Inspect auth flow" }));
		expect(screen.queryByText("Find where auth starts.")).toBeNull();
	});

	it("opens external workspace preview requests as selected file tabs", async () => {
		const { bridge } = installBridge(changedSnapshot, [textPreviewFile]);
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						previewRequest={{ nonce: 1, path: "notes.txt" }}
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByText("hello preview");
		expect(bridge.openWorkspacePreviewFile).toHaveBeenCalledWith({ path: "notes.txt", projectId: "project-1" });
		expect(screen.getByRole("tab", { name: /notes\.txt/i })).toBeTruthy();
		const reviewSpacer = document.querySelector('[data-slot="review-workspace-spacer"]') as HTMLElement | null;
		expect(reviewSpacer?.style.width).toBe(`${REVIEW_PANEL_WIDTH.default}px`);
	});

	it("keeps fullscreen workspace tabs aligned to the panel edge", async () => {
		installBridge(changedSnapshot, [textPreviewFile]);
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						previewRequest={{ nonce: 1, path: "notes.txt" }}
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByRole("tab", { name: /notes\.txt/i });
		const tabList = screen.getByRole("tablist", { name: "Workspace panel tabs" });
		expect(tabList.getAttribute("data-display-mode")).toBe("fullscreen");
		expect(tabList.className).not.toContain("desktop-titlebar-content-inset");
	});

	it("clears external preview tabs when switching workspace context", async () => {
		installBridge(changedSnapshot, [textPreviewFile]);
		const { rerender } = render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						previewRequest={{ nonce: 1, path: "notes.txt" }}
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		expect(await screen.findByRole("tab", { name: /notes\.txt/i })).toBeTruthy();

		rerender(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-2"
						sessionId="session-2"
						workspaceLabel="/workspace/second"
					/>
				</div>
			</TooltipProvider>,
		);

		await waitFor(() => expect(screen.queryByRole("tab", { name: /notes\.txt/i })).toBeNull());
	});

	it("opens local html files through the desktop web preview", async () => {
		const user = userEvent.setup();
		const { bridge } = installBridge(changedSnapshot, [htmlPreviewFile]);
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						previewRequest={{ nonce: 1, path: "chart.html" }}
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		expect(await screen.findByRole("tab", { name: /chart\.html/i })).toBeTruthy();
		await waitFor(() =>
			expect(bridge.showWebPreview).toHaveBeenCalledWith({
				bounds: { height: 0, width: 0, x: 0, y: 0 },
				id: expect.stringMatching(/^browser:file:/),
				url: "skylark-preview://session/chart.html",
			}),
		);
		const previewId = vi.mocked(bridge.showWebPreview).mock.calls[0]?.[0].id;
		expect(previewId).toBeTruthy();
		const viewport = document.querySelector('[data-slot="workspace-preview-viewport"]');
		expect(viewport?.className).toContain("relative");
		expect(viewport?.className).toContain("min-w-0");
		expect(screen.queryByTitle("HTML preview: chart.html")).toBeNull();
		expect(screen.queryByRole("button", { name: "源码" })).toBeNull();
		expect((screen.getByLabelText("Preview URL") as HTMLInputElement).value).toBe(
			"skylark-preview://session/chart.html",
		);
		expect((screen.getByRole("button", { name: "在浏览器打开" }) as HTMLButtonElement).disabled).toBe(true);

		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));
		expect(bridge.controlWebPreview).toHaveBeenCalledWith({ action: "reload", id: previewId });
		await user.click(screen.getByRole("button", { name: "选择页面元素" }));
		expect(bridge.setWebPreviewElementSelectionMode).toHaveBeenCalledWith({
			enabled: true,
			id: previewId,
		});
	});

	it("opens local svg files through the desktop web preview", async () => {
		const user = userEvent.setup();
		const { bridge } = installBridge(changedSnapshot, [svgPreviewFile]);
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						previewRequest={{ nonce: 1, path: "shape.svg" }}
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		expect(await screen.findByRole("tab", { name: /shape\.svg/i })).toBeTruthy();
		await waitFor(() =>
			expect(bridge.showWebPreview).toHaveBeenCalledWith({
				bounds: { height: 0, width: 0, x: 0, y: 0 },
				id: expect.stringMatching(/^browser:file:/),
				url: "skylark-preview://session/shape.svg",
			}),
		);
		const previewId = vi.mocked(bridge.showWebPreview).mock.calls[0]?.[0].id;
		expect(previewId).toBeTruthy();
		expect(screen.queryByTitle("SVG preview: shape.svg")).toBeNull();
		expect(screen.queryByRole("button", { name: "源码" })).toBeNull();
		expect((screen.getByLabelText("Preview URL") as HTMLInputElement).value).toBe(
			"skylark-preview://session/shape.svg",
		);

		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));
		expect(bridge.controlWebPreview).toHaveBeenCalledWith({ action: "reload", id: previewId });
	});

	it("opens a loopback browser tab from the workspace panel menu", async () => {
		const user = userEvent.setup();
		const onFullscreenChange = vi.fn();
		const { bridge, emitWebPreviewEvent } = installBridge();
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={onFullscreenChange}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByRole("button", { name: "New workspace item" });
		await user.click(await findWorkspaceCreateMenuItem(user, "网页预览"));
		await user.type(screen.getByLabelText("Preview URL"), "localhost:3000");
		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));

		expect(screen.queryByTitle("Browser preview")).toBeNull();
		await waitFor(() =>
			expect(bridge.showWebPreview).toHaveBeenCalledWith({
				bounds: { height: 0, width: 0, x: 0, y: 0 },
				id: expect.stringMatching(/^browser:/),
				url: "http://localhost:3000/",
			}),
		);
		const previewId = vi.mocked(bridge.showWebPreview).mock.calls[0]?.[0].id;
		expect(previewId).toBeTruthy();

		expect((screen.getByRole("button", { name: "后退" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "前进" }) as HTMLButtonElement).disabled).toBe(true);

		await user.click(screen.getByRole("button", { name: "Console" }));
		expect(screen.getByText("Console").closest("button")?.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("已打开 http://localhost:3000/")).toBeTruthy();

		await user.clear(screen.getByLabelText("Preview URL"));
		await user.type(screen.getByLabelText("Preview URL"), "localhost:3001");
		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));
		await waitFor(() => {
			expect(bridge.showWebPreview).toHaveBeenLastCalledWith({
				bounds: { height: 0, width: 0, x: 0, y: 0 },
				id: previewId,
				url: "http://localhost:3001/",
			});
		});
		emitWebPreviewEvent({
			state: {
				canGoBack: true,
				canGoForward: false,
				id: previewId!,
				isLoading: false,
				title: "Local app",
				url: "http://localhost:3001/",
			},
			type: "web_preview_state",
		});
		await waitFor(() => {
			expect((screen.getByRole("button", { name: "后退" }) as HTMLButtonElement).disabled).toBe(false);
		});

		await user.click(screen.getByRole("button", { name: "后退" }));
		expect(bridge.controlWebPreview).toHaveBeenCalledWith({ action: "back", id: previewId });
		emitWebPreviewEvent({
			state: {
				canGoBack: false,
				canGoForward: true,
				id: previewId!,
				isLoading: false,
				title: "Local app",
				url: "http://localhost:3000/",
			},
			type: "web_preview_state",
		});
		await waitFor(() => {
			expect((screen.getByLabelText("Preview URL") as HTMLInputElement).value).toBe("http://localhost:3000/");
			expect((screen.getByRole("button", { name: "前进" }) as HTMLButtonElement).disabled).toBe(false);
		});

		await user.click(screen.getByRole("button", { name: "前进" }));
		expect(bridge.controlWebPreview).toHaveBeenCalledWith({ action: "forward", id: previewId });

		const selectButton = screen.getByRole("button", { name: "选择页面元素" });
		await user.click(selectButton);
		expect(bridge.setWebPreviewElementSelectionMode).toHaveBeenCalledWith({
			enabled: true,
			id: previewId,
		});
		await waitFor(() => {
			expect(selectButton.getAttribute("aria-pressed")).toBe("true");
		});

		await user.click(screen.getByRole("button", { name: "在浏览器打开" }));
		expect(bridge.openExternalUrl).toHaveBeenCalledWith("http://localhost:3000/");

		expect(screen.queryByRole("button", { name: "全屏网页预览" })).toBeNull();
		await user.click(screen.getByRole("button", { name: "Enter review workspace fullscreen" }));
		expect(onFullscreenChange).toHaveBeenCalledWith(true);
	});

	it("closes the native web preview when the review panel collapses", async () => {
		const user = userEvent.setup();
		const { bridge } = installBridge();
		render(<ReviewPanelHarness />);

		await screen.findByRole("button", { name: "New workspace item" });
		await user.click(await findWorkspaceCreateMenuItem(user, "网页预览"));
		await user.type(screen.getByLabelText("Preview URL"), "google.com");
		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));

		await waitFor(() => expect(bridge.showWebPreview).toHaveBeenCalled());
		const previewId = vi.mocked(bridge.showWebPreview).mock.calls[0]?.[0].id;
		expect(previewId).toBeTruthy();
		expect(bridge.closeWebPreview).not.toHaveBeenCalledWith({ id: previewId });

		await user.click(screen.getByRole("button", { name: "Close review workspace" }));

		await waitFor(() => expect(bridge.closeWebPreview).toHaveBeenCalledWith({ id: previewId }));

		const showCallCount = vi.mocked(bridge.showWebPreview).mock.calls.length;
		await user.click(screen.getByRole("button", { name: "Open review" }));

		await waitFor(() => expect(bridge.showWebPreview).toHaveBeenCalledTimes(showCallCount + 1));
		expect(bridge.showWebPreview).toHaveBeenLastCalledWith({
			bounds: { height: 0, width: 0, x: 0, y: 0 },
			id: previewId,
			url: "https://google.com/",
		});
	});

	it("opens public browser urls through the desktop web preview bridge", async () => {
		const user = userEvent.setup();
		const { bridge, emitWebPreviewEvent } = installBridge();
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByRole("button", { name: "New workspace item" });
		await user.click(await findWorkspaceCreateMenuItem(user, "网页预览"));
		await screen.findByRole("tab", { name: "网页预览" });
		const urlInput = await screen.findByLabelText("Preview URL");
		await user.type(urlInput, "youtube");
		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));

		expect(screen.queryByTitle("Browser preview")).toBeNull();
		expect(document.querySelector('[data-slot="workspace-preview-viewport"]')).toBeTruthy();
		await waitFor(() =>
			expect(bridge.showWebPreview).toHaveBeenCalledWith({
				bounds: { height: 0, width: 0, x: 0, y: 0 },
				id: expect.stringMatching(/^browser:/),
				url: "https://youtube.com/",
			}),
		);

		const previewId = vi.mocked(bridge.showWebPreview).mock.calls[0]?.[0].id;
		expect(previewId).toBeTruthy();
		emitWebPreviewEvent({
			state: {
				canGoBack: true,
				canGoForward: false,
				id: previewId!,
				isLoading: false,
				title: "YouTube",
				url: "https://www.youtube.com/",
			},
			type: "web_preview_state",
		});

		await waitFor(() => {
			expect((urlInput as HTMLInputElement).value).toBe("https://www.youtube.com/");
		});

		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));
		expect(bridge.controlWebPreview).toHaveBeenCalledWith({ action: "reload", id: previewId });

		await user.click(screen.getByRole("button", { name: "更多网页预览操作" }));
		await user.click(await screen.findByRole("button", { name: "清除 Cookie" }));
		expect(bridge.clearWebPreviewStorage).toHaveBeenCalledWith({ id: previewId, storage: "cookies" });
		await user.click(screen.getByRole("button", { name: "更多网页预览操作" }));
		await user.click(await screen.findByRole("button", { name: "清除缓存" }));
		expect(bridge.clearWebPreviewStorage).toHaveBeenCalledWith({ id: previewId, storage: "cache" });
	});

	it("occludes the native web preview while header popovers are open", async () => {
		const user = userEvent.setup();
		const { bridge } = installBridge();
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByRole("button", { name: "New workspace item" });
		await user.click(await findWorkspaceCreateMenuItem(user, "网页预览"));
		await user.type(screen.getByLabelText("Preview URL"), "google.com");
		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));
		await waitFor(() => expect(bridge.showWebPreview).toHaveBeenCalled());

		const previewId = vi.mocked(bridge.showWebPreview).mock.calls[0]?.[0].id;
		await user.click(screen.getByRole("button", { name: "Open Git actions" }));

		await waitFor(() =>
			expect(bridge.updateWebPreviewBounds).toHaveBeenLastCalledWith({
				bounds: { height: 0, width: 0, x: 0, y: 0 },
				id: previewId,
				occluded: true,
			}),
		);
		await waitFor(() =>
			expect(document.querySelector('[data-slot="workspace-preview-snapshot"]')?.getAttribute("src")).toBe(
				"data:image/png;base64,preview",
			),
		);
		expect(bridge.closeWebPreview).not.toHaveBeenCalledWith({ id: previewId });

		await user.click(screen.getByRole("button", { name: "Open Git actions" }));
		await waitFor(() =>
			expect(bridge.updateWebPreviewBounds).toHaveBeenLastCalledWith({
				bounds: { height: 0, width: 0, x: 0, y: 0 },
				id: previewId,
				occluded: false,
			}),
		);
		await waitFor(() => expect(document.querySelector('[data-slot="workspace-preview-snapshot"]')).toBeNull());
		expect(bridge.closeWebPreview).not.toHaveBeenCalledWith({ id: previewId });
	});

	it("replaces the browser address when typing after clicking the URL input", async () => {
		const user = userEvent.setup();
		const { bridge, emitWebPreviewEvent } = installBridge();
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByRole("button", { name: "New workspace item" });
		await user.click(await findWorkspaceCreateMenuItem(user, "网页预览"));
		const urlInput = (await screen.findByLabelText("Preview URL")) as HTMLInputElement;
		await user.type(urlInput, "youtube");
		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));
		await waitFor(() => expect(bridge.showWebPreview).toHaveBeenCalled());

		const previewId = vi.mocked(bridge.showWebPreview).mock.calls[0]?.[0].id;
		expect(previewId).toBeTruthy();
		emitWebPreviewEvent({
			state: createWebPreviewState(previewId!, "https://www.youtube.com/", "YouTube"),
			type: "web_preview_state",
		});
		await waitFor(() => {
			expect(urlInput.value).toBe("https://www.youtube.com/");
		});

		await user.click(urlInput);
		expect(urlInput.selectionStart).toBe(0);
		expect(urlInput.selectionEnd).toBe("https://www.youtube.com/".length);
		await user.keyboard("google");
		expect(urlInput.value).toBe("google");
		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));

		await waitFor(() =>
			expect(bridge.showWebPreview).toHaveBeenLastCalledWith({
				bounds: { height: 0, width: 0, x: 0, y: 0 },
				id: previewId,
				url: "https://google.com/",
			}),
		);
		expect(vi.mocked(bridge.showWebPreview).mock.calls.map(([request]) => request.url)).not.toContain(
			"https://www.youtube.com/google",
		);
	});

	it("selects an element from an external web preview and reports it in the console", async () => {
		const user = userEvent.setup();
		const { bridge, emitWebPreviewEvent } = installBridge();
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByRole("button", { name: "New workspace item" });
		await user.click(await findWorkspaceCreateMenuItem(user, "网页预览"));
		const urlInput = await screen.findByLabelText("Preview URL");
		await user.type(urlInput, "example.com");
		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));

		await waitFor(() => expect(bridge.showWebPreview).toHaveBeenCalled());
		const previewId = vi.mocked(bridge.showWebPreview).mock.calls[0]?.[0].id;
		expect(previewId).toBeTruthy();

		const selectButton = screen.getByRole("button", { name: "选择页面元素" });
		await user.click(selectButton);

		expect(bridge.setWebPreviewElementSelectionMode).toHaveBeenCalledWith({
			enabled: true,
			id: previewId,
		});
		await waitFor(() => {
			expect(selectButton.getAttribute("aria-pressed")).toBe("true");
		});

		emitWebPreviewEvent({
			id: previewId!,
			selection: {
				ariaLabel: "Buy now",
				className: "primary",
				href: "",
				id: "buy",
				selector: "button#buy",
				tagName: "button",
				text: "Buy now",
			},
			type: "web_preview_element_selected",
		});

		await waitFor(() => {
			expect(selectButton.getAttribute("aria-pressed")).toBe("false");
		});
		await user.click(screen.getByRole("button", { name: "Console" }));
		expect(screen.getByText('已选择 button#buy "Buy now"')).toBeTruthy();
	});

	it("keeps public browser address edits while stale web preview state arrives", async () => {
		const user = userEvent.setup();
		const { bridge, emitWebPreviewEvent } = installBridge();
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByRole("button", { name: "New workspace item" });
		await user.click(await findWorkspaceCreateMenuItem(user, "网页预览"));
		const urlInput = (await screen.findByLabelText("Preview URL")) as HTMLInputElement;
		await user.type(urlInput, "youtube");
		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));
		await waitFor(() => expect(bridge.showWebPreview).toHaveBeenCalled());

		const previewId = vi.mocked(bridge.showWebPreview).mock.calls[0]?.[0].id;
		expect(previewId).toBeTruthy();
		await user.clear(urlInput);
		await user.type(urlInput, "google");
		const showUrlsBeforeStaleEvent = vi.mocked(bridge.showWebPreview).mock.calls.map(([request]) => request.url);
		emitWebPreviewEvent({
			state: createWebPreviewState(previewId!, "https://www.youtube.com/", "YouTube"),
			type: "web_preview_state",
		});

		expect(urlInput.value).toBe("google");
		expect(vi.mocked(bridge.showWebPreview).mock.calls.map(([request]) => request.url)).toEqual(
			showUrlsBeforeStaleEvent,
		);
		await user.keyboard("{Enter}");
		await waitFor(() =>
			expect(bridge.showWebPreview).toHaveBeenLastCalledWith({
				bounds: { height: 0, width: 0, x: 0, y: 0 },
				id: previewId,
				url: "https://google.com/",
			}),
		);
		expect(urlInput.value).toBe("https://google.com/");

		emitWebPreviewEvent({
			state: createWebPreviewState(previewId!, "https://www.youtube.com/", "YouTube"),
			type: "web_preview_state",
		});
		expect(urlInput.value).toBe("https://google.com/");
		expect(vi.mocked(bridge.showWebPreview).mock.calls.map(([request]) => request.url)).not.toContain(
			"https://www.youtube.com/",
		);

		await user.click(screen.getByRole("button", { name: "刷新网页预览" }));
		expect(bridge.controlWebPreview).toHaveBeenCalledWith({ action: "reload", id: previewId });
	});

	it("opens loopback web preview requests in the workspace panel", async () => {
		const { bridge } = installBridge();
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						webPreviewRequest={{ nonce: 1, url: "http://127.0.0.1:5173/app" }}
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await waitFor(() =>
			expect(bridge.showWebPreview).toHaveBeenCalledWith({
				bounds: { height: 0, width: 0, x: 0, y: 0 },
				id: "browser:http://127.0.0.1:5173/app",
				url: "http://127.0.0.1:5173/app",
			}),
		);
		expect(screen.queryByTitle("Browser preview")).toBeNull();
		expect(screen.getByRole("tab", { name: /127\.0\.0\.1:5173/i })).toBeTruthy();
	});

	it("refreshes open preview files after the active agent run ends", async () => {
		const user = userEvent.setup();
		const previewFiles = [textPreviewFile];
		const { bridge, emitAgentEvent } = installBridge(changedSnapshot, previewFiles);
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await screen.findByRole("button", { name: "New workspace item" });
		await user.click(await findWorkspaceCreateMenuItem(user, "打开文件"));
		expect(await screen.findByText("hello preview")).toBeTruthy();

		previewFiles[0] = {
			...textPreviewFile,
			content: "updated preview\n",
			updatedAt: "2026-05-01T00:00:01.000Z",
		};
		emitAgentEvent({ type: "agent_end", sessionId: "session-1", messages: [] });

		await waitFor(() =>
			expect(bridge.refreshPreviewFile).toHaveBeenCalledWith({ path: "/workspace/project/notes.txt" }),
		);
		expect(await screen.findByText("updated preview")).toBeTruthy();
	});

	it("filters the changed file tree", async () => {
		const user = userEvent.setup();
		renderPanel();

		await screen.findByText("App.tsx");
		await user.type(screen.getByPlaceholderText("筛选文件..."), "store");

		expect(screen.queryByText("App.tsx")).toBeNull();
		expect(screen.getByText("review-store.ts")).toBeTruthy();
	});

	it("virtualizes large changed file trees", async () => {
		const files = Array.from({ length: 120 }, (_, index) => {
			const fileNumber = String(index + 1).padStart(3, "0");
			return {
				...changedSnapshot.files[0]!,
				path: `src/generated/File${fileNumber}.tsx`,
				patch: "",
			};
		});

		renderPanel({
			...changedSnapshot,
			files,
			totals: { additions: 120, deletions: 0, files: files.length },
		});

		expect(await screen.findByText("File001.tsx")).toBeTruthy();
		const tree = screen.getByLabelText("Changed files tree");
		expect(tree.querySelectorAll("[data-slot='virtual-stack-item']").length).toBeLessThan(files.length);
		expect(screen.queryByText("File120.tsx")).toBeNull();

		tree.scrollTop = 32 * 115;
		fireEvent.scroll(tree);

		await waitFor(() => {
			expect(screen.getByText("File118.tsx")).toBeTruthy();
		});
		expect(screen.queryByText("File001.tsx")).toBeNull();
	});

	it("collapses and expands folders without losing filtered matches", async () => {
		const user = userEvent.setup();
		renderPanel();

		await screen.findByText("App.tsx");
		await user.click(screen.getByRole("button", { name: "src" }));

		expect(screen.queryByText("App.tsx")).toBeNull();
		expect(screen.queryByText("stores")).toBeNull();

		await user.click(screen.getByRole("button", { name: "src" }));
		expect(screen.getByText("App.tsx")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "src" }));
		await user.type(screen.getByPlaceholderText("筛选文件..."), "store");

		expect(screen.getByText("review-store.ts")).toBeTruthy();
		expect(screen.getByLabelText("Changed files tree").className).toContain("overflow-y-auto");
		expect(screen.getByLabelText("Changed files tree").className).toContain("pl-1");
	});

	it("collapses and expands diff hunks", async () => {
		const user = userEvent.setup();
		renderPanel();

		await screen.findByText("const review = true;");
		expect(screen.getByText("旧 1-2")).toBeTruthy();
		expect(screen.getByText("新 1-3")).toBeTruthy();
		expect(screen.queryByText("@@ -1,2 +1,3 @@")).toBeNull();

		await user.click(screen.getByRole("button", { name: "Collapse diff hunk old 1-2 new 1-3" }));

		expect(screen.queryByText("const review = true;")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Expand diff hunk old 1-2 new 1-3" }).getAttribute("aria-expanded"),
		).toBe("false");

		await user.click(screen.getByRole("button", { name: "Expand diff hunk old 1-2 new 1-3" }));
		expect(screen.getByText("const review = true;")).toBeTruthy();
	});

	it("allows the diff viewer to scroll horizontally for long lines", async () => {
		renderPanel();

		await screen.findByText("const review = true;");
		const diffViewer = screen.getByLabelText("Diff viewer");
		const changedLineBar = Array.from(document.querySelectorAll('[data-slot="diff-change-bar"]')).find((element) =>
			element.className.includes("bg-[color:var(--success)]"),
		);
		const normalLineBar = Array.from(document.querySelectorAll('[data-slot="diff-change-bar"]')).find((element) =>
			element.className.includes("bg-transparent"),
		);
		const lineNumber = document.querySelector('[data-slot="diff-line-number"]');
		const hunkHeader = document.querySelector('[data-slot="diff-hunk-header"]');

		expect(diffViewer.className).toContain("overflow-x-auto");
		expect(diffViewer.className).toContain("overflow-y-auto");
		expect(changedLineBar?.className).toContain("sticky left-0");
		expect(changedLineBar?.className).toContain("bg-[color:var(--success)]");
		expect(normalLineBar?.className).toContain("sticky left-0");
		expect(normalLineBar?.className).toContain("bg-transparent");
		expect(lineNumber?.className).toContain("sticky left-[4px]");
		expect(document.querySelector('[data-slot="diff-line-marker"]')).toBeNull();
		expect(hunkHeader?.className).toContain("sticky left-2");
		expect(hunkHeader?.className).not.toContain("w-[34rem]");
		expect(hunkHeader?.className).toContain("overflow-hidden");
		expect(hunkHeader?.className).not.toContain("border");
		expect(hunkHeader?.className).toContain("bg-[color:var(--surface-2)]");
		expect(hunkHeader?.className).toContain("shadow-[var(--shadow-minimal)]");
		expect(hunkHeader?.parentElement?.getAttribute("data-slot")).toBe("diff-hunk-row");
		expect(hunkHeader?.parentElement?.className).toContain("mb-1.5");
		expect(hunkHeader?.parentElement?.className).toContain("px-2");
		expect(hunkHeader?.parentElement?.parentElement?.className).not.toContain("px-2");
		expect(hunkHeader?.parentElement?.parentElement?.className).toContain("w-max");
	});

	it("lets users resize and collapse the changed files panel", async () => {
		const user = userEvent.setup();
		renderPanel();

		await screen.findByText("App.tsx");
		const resizer = screen.getByRole("separator", { name: "Resize changed files panel" });
		const fileTreeSpacer = document.querySelector('[data-slot="review-file-tree-spacer"]') as HTMLElement | null;
		const fileTreePanel = document.querySelector('[data-slot="review-file-tree-panel"]') as HTMLElement | null;
		const fileTreeContent = document.querySelector('[data-slot="review-file-tree-content"]') as HTMLElement | null;

		expect(resizer.getAttribute("aria-valuenow")).toBe("340");
		expect(resizer.className).toContain("absolute");
		expect(resizer.children).toHaveLength(0);
		expect(fileTreeSpacer?.className).toContain("overflow-hidden");
		expect(fileTreePanel?.parentElement).toBe(fileTreeSpacer);
		expect(fileTreeContent?.className).not.toContain("border-l");
		expect(fileTreeContent?.className).toContain("shadow-[inset_1px_0_0_var(--border-subtle)]");
		expect(fileTreeSpacer?.getAttribute("data-width")).toBe("340");
		expect(fileTreePanel?.style.width).toBe("340px");
		expect(fileTreePanel?.getAttribute("data-width")).toBe("340");
		fireEvent.keyDown(resizer, { key: "ArrowLeft" });
		expect(resizer.getAttribute("aria-valuenow")).toBe("356");
		expect(fileTreeSpacer?.getAttribute("data-width")).toBe("356");
		expect(fileTreePanel?.style.width).toBe("356px");
		expect(fileTreePanel?.getAttribute("data-width")).toBe("356");

		await user.click(screen.getByRole("button", { name: "收起变更文件列表" }));
		await waitFor(() => {
			expect(screen.queryByLabelText("Changed files tree")).toBeNull();
			expect(screen.queryByRole("separator", { name: "Resize changed files panel" })).toBeNull();
		});

		await user.click(screen.getByRole("button", { name: "显示变更文件列表" }));
		expect(await screen.findByLabelText("Changed files tree")).toBeTruthy();
		expect(screen.getByRole("separator", { name: "Resize changed files panel" }).getAttribute("aria-valuenow")).toBe(
			"356",
		);
	});

	it("lets users resize the outer review panel without overlaying the main workbench", async () => {
		renderPanel();

		await screen.findByText("App.tsx");
		const resizer = screen.getByRole("separator", { name: "Resize review panel" });
		const reviewPanel = screen.getByLabelText("Review workspace");
		const reviewSpacer = document.querySelector('[data-slot="review-workspace-spacer"]');
		const reviewBody = document.querySelector('[data-slot="review-workspace-body"]');

		expect(resizer.children).toHaveLength(0);
		expect(resizer.getAttribute("aria-valuenow")).toBe(String(REVIEW_PANEL_WIDTH.default));
		expect(resizer.getAttribute("aria-valuemin")).toBe(String(REVIEW_PANEL_WIDTH.min));
		expect(resizer.getAttribute("aria-valuemax")).toBe(String(REVIEW_PANEL_WIDTH.max));
		expect(reviewSpacer?.getAttribute("data-structural-layout-driver")).toBe("width");
		expect(reviewSpacer?.getAttribute("data-width")).toBe(String(REVIEW_PANEL_WIDTH.default));
		expect(reviewPanel.getAttribute("data-width")).toBe(String(REVIEW_PANEL_WIDTH.default));
		expect(reviewPanel.getAttribute("data-workbench-attachment")).toBe("attached");
		expect(reviewPanel.closest('[data-slot="review-workspace-spacer"]')).toBe(reviewSpacer);
		expect(reviewPanel.getAttribute("data-motion-owner")).toBe("fixed-content");
		expect(reviewBody?.getAttribute("data-resize-motion")).toBe("contents-static");

		fireEvent.keyDown(resizer, { key: "ArrowLeft" });
		expect(resizer.getAttribute("aria-valuenow")).toBe("836");
		expect(reviewSpacer?.getAttribute("data-width")).toBe("836");
		expect(reviewPanel.getAttribute("data-width")).toBe("836");

		fireEvent.keyDown(resizer, { key: "Home" });
		expect(resizer.getAttribute("aria-valuenow")).toBe(String(REVIEW_PANEL_WIDTH.min));

		fireEvent.keyDown(resizer, { key: "End" });
		expect(resizer.getAttribute("aria-valuenow")).toBe(String(REVIEW_PANEL_WIDTH.max));
	});

	it("resizes the outer review panel from a pointer drag in panel mode", async () => {
		renderPanel();

		await screen.findByText("App.tsx");
		const resizer = screen.getByRole("separator", { name: "Resize review panel" });
		const reviewPanel = screen.getByLabelText("Review workspace");
		const reviewSpacer = document.querySelector('[data-slot="review-workspace-spacer"]');

		fireEvent.pointerDown(resizer, { clientX: 700 });
		fireEvent.pointerMove(window, { clientX: 650 });

		expect(resizer.getAttribute("aria-valuenow")).toBe("870");
		expect(reviewSpacer?.getAttribute("data-width")).toBe("870");
		expect(reviewPanel.getAttribute("data-width")).toBe("870");

		fireEvent.pointerUp(window);
		await waitFor(() => expect(reviewSpacer?.getAttribute("data-review-resizing")).toBe("false"));
	});

	it("marks review panel pointer resizing while a local web preview is active", async () => {
		const { bridge } = installBridge(changedSnapshot, [htmlPreviewFile]);
		render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						previewRequest={{ nonce: 1, path: "chart.html" }}
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		await waitFor(() => expect(bridge.showWebPreview).toHaveBeenCalled());
		const resizer = screen.getByRole("separator", { name: "Resize review panel" });
		const reviewSpacer = document.querySelector('[data-slot="review-workspace-spacer"]') as HTMLElement | null;
		const viewport = document.querySelector('[data-slot="workspace-preview-viewport"]');

		expect(viewport).toBeTruthy();
		expect(screen.queryByTitle("HTML preview: chart.html")).toBeNull();
		expect(reviewSpacer?.dataset.reviewResizing).toBe("false");

		fireEvent.pointerDown(resizer);
		expect(reviewSpacer?.dataset.reviewResizing).toBe("true");
		expect(reviewSpacer?.getAttribute("data-width-transition")).toBe("instant");

		fireEvent.pointerUp(window);
		await waitFor(() => expect(reviewSpacer?.dataset.reviewResizing).toBe("false"));
	});

	it("toggles fullscreen display while preserving the normal review width", async () => {
		const user = userEvent.setup();
		installBridge();
		render(<ReviewPanelHarness />);

		await user.click(await screen.findByRole("button", { name: "审查" }));
		await screen.findByText("App.tsx");
		const reviewPanel = screen.getByLabelText("Review workspace");
		const reviewSpacer = document.querySelector('[data-slot="review-workspace-spacer"]');
		const resizer = screen.getByRole("separator", { name: "Resize review panel" });

		fireEvent.keyDown(resizer, { key: "ArrowLeft" });
		expect(resizer.getAttribute("aria-valuenow")).toBe("836");

		await user.click(screen.getByRole("button", { name: "Enter review workspace fullscreen" }));
		expect(reviewSpacer?.getAttribute("data-display-mode")).toBe("fullscreen");
		expect(reviewPanel.getAttribute("data-workbench-attachment")).toBe("detached");
		expect(reviewSpacer?.getAttribute("data-structural-layout-driver")).toBe("overlay");
		expect(reviewSpacer?.className).toContain("absolute");
		expect(reviewSpacer?.className).toContain("inset-0");
		expect(reviewSpacer?.className).not.toContain("shrink-0");
		expect(reviewPanel.getAttribute("data-display-mode")).toBe("fullscreen");
		expect(document.querySelector('[data-slot="review-workspace-title-block"]')).toBeNull();
		expect(screen.getByRole("tab", { name: "审查" })).toBeTruthy();
		expect(screen.queryByRole("separator", { name: "Resize review panel" })).toBeNull();
		expect(screen.getByRole("button", { name: "New workspace item" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Open Git actions" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Current branch" }).querySelector("span")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Exit review workspace fullscreen" }).getAttribute("aria-pressed"),
		).toBe("true");

		await user.click(screen.getByRole("button", { name: "Exit review workspace fullscreen" }));
		expect(reviewSpacer?.getAttribute("data-display-mode")).toBe("panel");
		expect(reviewPanel.getAttribute("data-display-mode")).toBe("panel");
		expect(document.querySelector('[data-slot="review-workspace-title-block"]')).toBeNull();
		expect(screen.getByRole("tab", { name: "审查" })).toBeTruthy();
		expect(screen.getByRole("separator", { name: "Resize review panel" }).getAttribute("aria-valuenow")).toBe("836");
	});

	it("hides the fullscreen title block when the app titlebar owns the summary", async () => {
		const user = userEvent.setup();
		installBridge();
		render(<ReviewPanelHarness isTitlebarSummaryVisible />);

		await user.click(await screen.findByRole("button", { name: "审查" }));
		await screen.findByText("App.tsx");
		await user.click(screen.getByRole("button", { name: "Enter review workspace fullscreen" }));

		expect(document.querySelector('[data-slot="review-workspace-title-block"]')).toBeNull();
		expect(screen.getByRole("button", { name: "New workspace item" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Open Git actions" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Current branch" }).querySelector("span")).toBeNull();
	});

	it("lets fullscreen file previews follow parent resize without resize-driven width state", async () => {
		installBridge(changedSnapshot, [textPreviewFile]);
		const originalResizeObserver = window.ResizeObserver;
		const observe = vi.fn();

		class MockResizeObserver implements ResizeObserver {
			disconnect = vi.fn();
			observe = observe;
			unobserve = vi.fn();
		}

		Object.defineProperty(window, "ResizeObserver", {
			configurable: true,
			value: MockResizeObserver,
		});

		try {
			render(
				<TooltipProvider>
					<div className="relative h-[720px]" data-slot="fullscreen-resize-container">
						<ReviewWorkspacePanel
							isFullscreen
							onClose={vi.fn()}
							onFullscreenChange={vi.fn()}
							open
							previewRequest={{ nonce: 1, path: "notes.txt" }}
							projectId="project-1"
							sessionId="session-1"
							workspaceLabel="/workspace/project"
						/>
					</div>
				</TooltipProvider>,
			);

			await screen.findByText("hello preview");
			const reviewPanel = screen.getByLabelText("Review workspace");
			const reviewSpacer = document.querySelector('[data-slot="review-workspace-spacer"]');

			expect(observe).not.toHaveBeenCalled();
			expect(reviewSpacer?.getAttribute("data-width-mode")).toBe("fill-parent");
			expect(reviewPanel.getAttribute("data-width-mode")).toBe("fill-parent");
			expect((reviewSpacer as HTMLElement | null)?.style.width).toBe("100%");
			expect(reviewPanel.style.width).toBe("100%");

			expect(observe).not.toHaveBeenCalled();
			expect(reviewSpacer?.getAttribute("data-width-mode")).toBe("fill-parent");
			expect(reviewPanel.getAttribute("data-width-mode")).toBe("fill-parent");
		} finally {
			if (originalResizeObserver) {
				Object.defineProperty(window, "ResizeObserver", {
					configurable: true,
					value: originalResizeObserver,
				});
			} else {
				Reflect.deleteProperty(window, "ResizeObserver");
			}
		}
	});

	it("keeps the user resized review width when closing and reopening in the same run", async () => {
		const user = userEvent.setup();
		installBridge();
		render(<ReviewPanelHarness />);

		await screen.findByRole("button", { name: "文件" });
		const resizer = screen.getByRole("separator", { name: "Resize review panel" });
		fireEvent.keyDown(resizer, { key: "ArrowLeft" });
		expect(resizer.getAttribute("aria-valuenow")).toBe("836");

		await user.click(screen.getByRole("button", { name: "Close review workspace" }));
		expect(screen.queryByRole("separator", { name: "Resize review panel" })).toBeNull();

		await user.click(screen.getByRole("button", { name: "Open review" }));
		expect(screen.getByRole("separator", { name: "Resize review panel" }).getAttribute("aria-valuenow")).toBe("836");
	});

	it("defers heavy review body hydration until after the first opening reveal", async () => {
		const user = userEvent.setup();
		const { bridge } = installBridge();
		render(<ClosedReviewPanelHarness />);

		await user.click(screen.getByRole("button", { name: "Open review" }));
		await waitFor(() => expect(bridge.getReviewSnapshot).toHaveBeenCalledWith({ projectId: "project-1" }));
		await user.click(await screen.findByRole("button", { name: "审查" }));

		expect(document.querySelector('[data-slot="review-workspace-body-deferred"]')).toBeTruthy();
		expect(screen.queryByLabelText("Diff viewer")).toBeNull();
		expect(screen.queryByText("const review = true;")).toBeNull();

		await new Promise((resolve) => window.setTimeout(resolve, 360));

		expect(await screen.findByLabelText("Diff viewer")).toBeTruthy();
		expect(screen.getByText("const review = true;")).toBeTruthy();
	});

	it("lets users close the review panel from the header close button", async () => {
		const user = userEvent.setup();
		installBridge();
		render(<ReviewPanelHarness />);

		await screen.findByRole("button", { name: "文件" });
		const closeButton = screen.getByRole("button", { name: "Close review workspace" });
		const reviewPanel = screen.getByLabelText("Review workspace");

		expect(screen.queryByRole("button", { name: "Collapse review workspace" })).toBeNull();
		await user.click(closeButton);

		await waitFor(() => {
			expect(screen.queryByRole("separator", { name: "Resize review panel" })).toBeNull();
		});
		expect(reviewPanel.textContent).toContain("文件");
		expect(reviewPanel.textContent).toContain("浏览器");
		expect(reviewPanel.textContent).toContain("审查");
		expect(screen.getByRole("button", { name: "Open review" })).toBeTruthy();
	});

	it("shows the empty state when there are no changes", async () => {
		renderPanel({
			...changedSnapshot,
			status: "clean",
			files: [],
			totals: { files: 0, additions: 0, deletions: 0 },
		});

		expect(await screen.findByText("尚无文件更改")).toBeTruthy();
	});

	it("refreshes after the active agent run ends", async () => {
		const { bridge, emitAgentEvent } = renderPanel();

		await waitFor(() => expect(bridge.getReviewSnapshot).toHaveBeenCalledTimes(1));
		emitAgentEvent({ type: "agent_end", sessionId: "session-1", messages: [] });

		await waitFor(() => expect(bridge.getReviewSnapshot).toHaveBeenCalledTimes(2));
	});

	it("clears the previous diff while loading a new review request", async () => {
		let resolveSecondSnapshot: (snapshot: DesktopReviewSnapshot) => void = () => {};
		const secondSnapshotPromise = new Promise<DesktopReviewSnapshot>((resolve) => {
			resolveSecondSnapshot = resolve;
		});
		installBridge((request) => (request.projectId === "project-2" ? secondSnapshotPromise : changedSnapshot));

		const { rerender } = render(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-1"
						sessionId="session-1"
						workspaceLabel="/workspace/project"
					/>
				</div>
			</TooltipProvider>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "审查" }));
		expect(await screen.findByText("const review = true;")).toBeTruthy();

		rerender(
			<TooltipProvider>
				<div className="relative h-[720px]">
					<ReviewWorkspacePanel
						isFullscreen={false}
						onClose={vi.fn()}
						onFullscreenChange={vi.fn()}
						open
						projectId="project-2"
						sessionId="session-2"
						workspaceLabel="/workspace/second"
					/>
				</div>
			</TooltipProvider>,
		);

		await waitFor(() => expect(screen.queryByText("const review = true;")).toBeNull());
		fireEvent.click(await screen.findByRole("button", { name: "审查" }));
		resolveSecondSnapshot(secondSnapshot);

		expect(await screen.findByText("const second = true;")).toBeTruthy();
	});
});
