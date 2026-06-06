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
const htmlPreviewFile: DesktopPreviewFile = {
	path: "/workspace/project/chart.html",
	name: "chart.html",
	mimeType: "text/html",
	size: 48,
	kind: "html",
	content: "<!doctype html><html><body>Chart</body></html>",
	updatedAt: "2026-05-01T00:00:00.000Z",
};

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

function installBridge(snapshot: ReviewSnapshotSource = changedSnapshot, previewFiles: DesktopPreviewFile[] = []) {
	const agentEvents = createRendererBridgeEventChannel<SerializedAgentEvent>();
	const environmentEvents = createRendererBridgeEventChannel<DesktopEnvironmentEvent>();
	const subagentEvents = createRendererBridgeEventChannel<DesktopSubagentRuntimeEvent>();
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
		openPreviewFiles: vi.fn(async () => previewFiles),
		openWorkspacePreviewFile: vi.fn(async (request: DesktopWorkspacePreviewFileRequest) => {
			const previewFile = previewFiles.find(
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
	} as Pick<
		DesktopAgentBridge,
		| "getSubagentSnapshot"
		| "getReviewFilePatch"
		| "getReviewSnapshot"
		| "openPreviewFiles"
		| "openWorkspacePreviewFile"
		| "refreshPreviewFile"
		| "subscribeToAgentEvents"
		| "subscribeToEnvironmentEvents"
		| "subscribeToSubagentEvents"
	>;

	installRendererDesktopAgentBridge(bridge);

	return {
		bridge,
		emitAgentEvent: agentEvents.emit,
		emitEnvironmentEvent: environmentEvents.emit,
		emitSubagentEvent: subagentEvents.emit,
	};
}

function renderPanel(snapshot?: DesktopReviewSnapshot) {
	const helpers = installBridge(snapshot);
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

	it("renders changed file tree, selected diff, and disabled git actions", async () => {
		const user = userEvent.setup();
		const { bridge } = renderPanel();

		await waitFor(() => {
			expect(bridge.getReviewSnapshot).toHaveBeenCalledWith({ projectId: "project-1" });
		});
		expect(await screen.findByText("feature/review / 2 个文件")).toBeTruthy();
		expect(await screen.findByText("App.tsx")).toBeTruthy();
		expect(await screen.findByText("const review = true;")).toBeTruthy();
		expect(bridge.getReviewFilePatch).toHaveBeenCalledWith({
			path: "src/App.tsx",
			projectId: "project-1",
		});
		const header = document.querySelector('[data-slot="review-workspace-header"]');
		const titleBlock = document.querySelector('[data-slot="review-workspace-title-block"]');
		const titleTextRegion = document.querySelector('[data-slot="review-workspace-title-text-region"]');
		const collapseButton = screen.getByRole("button", { name: "Collapse review workspace" });
		expect(header?.className).toContain("desktop-window-drag-region");
		expect(titleBlock?.className).not.toContain("desktop-window-drag-region");
		expect(titleTextRegion?.className).toContain("desktop-window-drag-region");
		const headerActions = document.querySelector('[data-slot="review-workspace-header-actions"]');
		expect(headerActions?.className).toContain("desktop-window-drag-region");
		expect(headerActions?.className).toContain("h-full");
		expect(headerActions?.className).not.toContain("desktop-window-no-drag");
		expect(collapseButton.className).toContain("desktop-window-no-drag");
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
				activeItemLabel: "审查",
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

		await screen.findByText("综合面板");
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

		await screen.findByText("综合面板");
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

	it("previews html files in a sandbox and switches to source", async () => {
		const user = userEvent.setup();
		installBridge(changedSnapshot, [htmlPreviewFile]);
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

		const frame = await screen.findByTitle("HTML preview: chart.html");
		const viewport = frame.closest('[data-slot="workspace-preview-viewport"]');
		expect(frame.getAttribute("data-slot")).toBe("workspace-preview-frame");
		expect(frame.className).toContain("absolute");
		expect(frame.className).toContain("block");
		expect(viewport?.className).toContain("relative");
		expect(viewport?.className).toContain("min-w-0");
		expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
		expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
		expect(frame.getAttribute("srcdoc")).toContain("Chart");

		await user.click(screen.getByRole("button", { name: "源码" }));
		const sourceCode = document.querySelector('[data-slot="preview-source-code"]');
		expect(sourceCode?.getAttribute("data-language")).toBe("html");
		await waitFor(() => {
			expect(sourceCode?.textContent).toContain("<!doctype html>");
			expect(sourceCode?.textContent).toContain("Chart");
		});
	});

	it("opens a restricted browser tab from the workspace panel menu", async () => {
		const user = userEvent.setup();
		installBridge();
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

		await screen.findByText("综合面板");
		await user.click(await findWorkspaceCreateMenuItem(user, "浏览器"));
		await user.type(screen.getByLabelText("Browser URL"), "example.com");
		await user.click(screen.getByRole("button", { name: "刷新浏览器" }));

		const frame = screen.getByTitle("Browser preview");
		expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
		expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
		expect(frame.getAttribute("src")).toBe("https://example.com/");
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

		await screen.findByText("综合面板");
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
			element.className.includes("bg-emerald-600"),
		);
		const normalLineBar = Array.from(document.querySelectorAll('[data-slot="diff-change-bar"]')).find((element) =>
			element.className.includes("bg-background"),
		);
		const lineNumber = document.querySelector('[data-slot="diff-line-number"]');
		const hunkHeader = document.querySelector('[data-slot="diff-hunk-header"]');

		expect(diffViewer.className).toContain("overflow-x-auto");
		expect(diffViewer.className).toContain("overflow-y-auto");
		expect(changedLineBar?.className).toContain("sticky left-0");
		expect(changedLineBar?.className).toContain("bg-emerald-600");
		expect(normalLineBar?.className).toContain("sticky left-0");
		expect(normalLineBar?.className).toContain("bg-background");
		expect(lineNumber?.className).toContain("sticky left-[4px]");
		expect(document.querySelector('[data-slot="diff-line-marker"]')).toBeNull();
		expect(hunkHeader?.className).toContain("sticky left-2");
		expect(hunkHeader?.className).not.toContain("w-[34rem]");
		expect(hunkHeader?.className).toContain("overflow-hidden");
		expect(hunkHeader?.className).toContain("border");
		expect(hunkHeader?.className).toContain("shadow-[");
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
		expect(fileTreeContent?.className).toContain("border-l");
		expect(fileTreeSpacer?.getAttribute("data-width")).toBe("340");
		expect(fileTreePanel?.style.width).toBe("340px");
		expect(fileTreePanel?.getAttribute("data-width")).toBe("340");
		fireEvent.keyDown(resizer, { key: "ArrowLeft" });
		expect(resizer.getAttribute("aria-valuenow")).toBe("356");
		expect(fileTreeSpacer?.getAttribute("data-width")).toBe("356");
		expect(fileTreePanel?.style.width).toBe("356px");
		expect(fileTreePanel?.getAttribute("data-width")).toBe("356");

		await user.click(screen.getByRole("button", { name: "Hide changed files panel" }));
		await waitFor(() => {
			expect(screen.queryByLabelText("Changed files tree")).toBeNull();
			expect(screen.queryByRole("separator", { name: "Resize changed files panel" })).toBeNull();
		});

		await user.click(screen.getByRole("button", { name: "Show changed files panel" }));
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

	it("marks review panel pointer resizing before the cursor can enter preview iframes", async () => {
		installBridge(changedSnapshot, [htmlPreviewFile]);
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

		const frame = await screen.findByTitle("HTML preview: chart.html");
		const resizer = screen.getByRole("separator", { name: "Resize review panel" });
		const reviewSpacer = document.querySelector('[data-slot="review-workspace-spacer"]') as HTMLElement | null;

		expect(frame.getAttribute("data-slot")).toBe("workspace-preview-frame");
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
		const fullscreenTitleBlock = document.querySelector('[data-slot="review-workspace-title-block"]');
		expect(fullscreenTitleBlock?.className).not.toContain("hidden");
		expect(fullscreenTitleBlock?.textContent).toContain("综合面板");
		expect(fullscreenTitleBlock?.textContent).toContain("/workspace/project");
		expect(screen.queryByRole("tab", { name: "审查" })).toBeNull();
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
		expect(document.querySelector('[data-slot="review-workspace-title-block"]')?.className).not.toContain("hidden");
		expect(screen.getByRole("tab", { name: "审查" })).toBeTruthy();
		expect(screen.getByRole("separator", { name: "Resize review panel" }).getAttribute("aria-valuenow")).toBe("836");
	});

	it("hides the fullscreen title block when the app titlebar owns the summary", async () => {
		const user = userEvent.setup();
		installBridge();
		render(<ReviewPanelHarness isTitlebarSummaryVisible />);

		await screen.findByText("App.tsx");
		await user.click(screen.getByRole("button", { name: "Enter review workspace fullscreen" }));

		expect(document.querySelector('[data-slot="review-workspace-title-block"]')?.className).toContain("hidden");
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

		await screen.findByText("App.tsx");
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
		await waitFor(() => expect(screen.getByText("feature/review / 2 个文件")).toBeTruthy());

		expect(document.querySelector('[data-slot="review-workspace-body-deferred"]')).toBeTruthy();
		expect(screen.queryByLabelText("Diff viewer")).toBeNull();
		expect(screen.queryByText("const review = true;")).toBeNull();

		await new Promise((resolve) => window.setTimeout(resolve, 360));

		expect(await screen.findByLabelText("Diff viewer")).toBeTruthy();
		expect(screen.getByText("const review = true;")).toBeTruthy();
	});

	it("lets users collapse the review panel from the header review icon", async () => {
		const user = userEvent.setup();
		installBridge();
		render(<ReviewPanelHarness />);

		await screen.findByText("App.tsx");
		const iconButton = screen.getByRole("button", { name: "Collapse review workspace" });
		const reviewPanel = screen.getByLabelText("Review workspace");

		expect(iconButton.getAttribute("data-slot")).toBe("review-workspace-icon");
		await user.click(iconButton);

		await waitFor(() => {
			expect(screen.queryByRole("separator", { name: "Resize review panel" })).toBeNull();
		});
		expect(reviewPanel.textContent).toContain("feature/review / 2 个文件");
		expect(reviewPanel.textContent).toContain("+3");
		expect(reviewPanel.textContent).toContain("-0");
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
		resolveSecondSnapshot(secondSnapshot);

		expect(await screen.findByText("const second = true;")).toBeTruthy();
	});
});
