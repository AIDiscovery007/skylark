import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppLayout, clampSidebarWidth, SIDEBAR_WIDTH } from "../../src/renderer/components/layout/AppLayout.tsx";
import { formatRelativeUpdatedAt, SessionList } from "../../src/renderer/components/sidebar/SessionList.tsx";
import { Sidebar } from "../../src/renderer/components/sidebar/Sidebar.tsx";
import type {
	DesktopEventAttachmentDraft,
	DesktopEventDetail,
	DesktopProjectSummary,
	DesktopSessionSummary,
} from "../../src/shared/types.ts";

afterEach(() => {
	cleanup();
});

function createProject(
	id: string,
	name: string,
	sessionCount: number,
	cwd = `/workspace/${name}`,
): DesktopProjectSummary {
	return {
		id,
		name,
		cwd,
		createdAt: "2026-04-22T00:00:00.000Z",
		updatedAt: "2026-04-22T00:00:00.000Z",
		sessionCount,
	};
}

function createSession(id: string, title: string, updatedAt: string, messageCount = 3): DesktopSessionSummary {
	return {
		id,
		title,
		cwd: "/workspace/project",
		createdAt: updatedAt,
		updatedAt,
		messageCount,
		agentMode: "execute",
		provider: "kimi-coding",
		modelId: "kimi-for-coding",
	};
}

function createEventDetail(overrides: Partial<DesktopEventDetail> = {}): DesktopEventDetail {
	return {
		id: "event-created",
		title: "Capture idea",
		body: "Capture a sidebar idea",
		bodyPreview: "Capture a sidebar idea",
		status: "inbox",
		attachmentCount: 0,
		commentCount: 0,
		createdAt: "2026-05-22T00:00:00.000Z",
		updatedAt: "2026-05-22T00:00:00.000Z",
		statusChangedAt: "2026-05-22T00:00:00.000Z",
		attachments: [],
		comments: [],
		runs: [],
		...overrides,
	};
}

function getWorkbenchShell(container: HTMLElement): HTMLElement {
	const shell = container.querySelector("[data-slot='workbench-app-shell']");
	if (!(shell instanceof HTMLElement)) {
		throw new Error("Workbench shell was not rendered.");
	}

	return shell;
}

function createDeferredPromise<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
}

describe("SessionList UI", () => {
	it("clamps sidebar resize target widths to the configured bounds", () => {
		expect(clampSidebarWidth(120)).toBe(SIDEBAR_WIDTH.min);
		expect(clampSidebarWidth(320)).toBe(320);
		expect(clampSidebarWidth(520)).toBe(SIDEBAR_WIDTH.max);
	});

	it("collapses the sidebar away and restores the previous expanded width", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<AppLayout
				sidebar={<div>expanded sidebar</div>}
				titlebarControls={({ isSidebarCollapsed }) =>
					isSidebarCollapsed ? (
						<button aria-label="新对话" type="button">
							new
						</button>
					) : null
				}
			>
				<div>content</div>
			</AppLayout>,
		);
		const shell = getWorkbenchShell(container);
		const sidebarFrame = screen.getByLabelText("Workspace sidebar");

		expect(shell.dataset.sidebarWidth).toBe(String(SIDEBAR_WIDTH.default));
		expect(screen.getByRole("separator", { name: "Resize sidebar" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "新对话" })).toBeNull();

		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

		expect(shell.dataset.sidebarCollapsed).toBe("true");
		expect(shell.dataset.sidebarWidth).toBe(String(SIDEBAR_WIDTH.collapsed));
		expect(sidebarFrame.getAttribute("data-state")).toBe("closed");
		expect(sidebarFrame.getAttribute("aria-hidden")).toBe("true");
		expect(screen.queryByRole("separator", { name: "Resize sidebar" })).toBeNull();
		expect(screen.getByRole("button", { name: "新对话" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

		expect(shell.dataset.sidebarCollapsed).toBe("false");
		expect(shell.dataset.sidebarWidth).toBe(String(SIDEBAR_WIDTH.default));
		expect(sidebarFrame.getAttribute("aria-hidden")).toBeNull();
		expect(screen.getByRole("separator", { name: "Resize sidebar" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "新对话" })).toBeNull();
	});

	it("exposes a motion structural drawer contract for sidebar width and content changes", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<AppLayout
				sidebar={({ isSidebarCollapsed }) => (
					<Sidebar
						activeProjectId="project-1"
						activeSessionId="session-full"
						isBusy={false}
						isLoading={false}
						isSidebarCollapsed={isSidebarCollapsed}
						onCreateProjectFromFolder={async () => undefined}
						onCreateSession={async () => undefined}
						onSelectProject={async () => undefined}
						onSelectSession={async () => undefined}
						projects={[createProject("project-1", "pi-mono", 1)]}
						sessionsByProjectId={{
							"project-1": [createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")],
						}}
					/>
				)}
			>
				<div>content</div>
			</AppLayout>,
		);

		const sidebarFrame = screen.getByLabelText("Workspace sidebar");
		const shell = getWorkbenchShell(container);
		const nativeTitlebarDragRegion = container.querySelector("[data-slot='desktop-titlebar-native-drag-region']");
		const titlebarControls = container.querySelector("[data-slot='desktop-titlebar-controls']");
		const sidebarInner = container.querySelector("[data-slot='workbench-sidebar-inner']");
		const sidebarContent = container.querySelector("[data-slot='sidebar-content']");
		const sidebarTitlebarDragRegion = container.querySelector("[data-slot='sidebar-titlebar-drag-region']");

		expect(sidebarFrame.getAttribute("data-motion")).toBe("structural-drawer");
		expect(sidebarFrame.getAttribute("data-motion-engine")).toBe("motion");
		expect(sidebarFrame.getAttribute("data-side")).toBe("left");
		expect(sidebarFrame.getAttribute("data-state")).toBe("open");
		expect(sidebarFrame.getAttribute("data-motion-scope")).toBe("structural");
		expect(sidebarFrame.style.getPropertyValue("--structural-drawer-size")).toBe(`${SIDEBAR_WIDTH.default}px`);
		expect(sidebarFrame.className).not.toContain("transition-[width]");
		expect(sidebarInner?.getAttribute("data-motion-owner")).toBe("fixed-content");
		expect(sidebarInner?.getAttribute("data-resize-motion")).toBe("contents-static");
		expect((sidebarInner as HTMLElement | null)?.style.width).toBe(`${SIDEBAR_WIDTH.default}px`);
		expect(nativeTitlebarDragRegion?.className).toContain("desktop-window-drag-region");
		expect(titlebarControls?.className).toContain("desktop-window-drag-region");
		expect(titlebarControls?.className).not.toContain("desktop-window-no-drag");
		expect(sidebarTitlebarDragRegion?.className).toContain("desktop-window-drag-region");
		expect(sidebarTitlebarDragRegion?.className).not.toContain("inset-x-0");
		expect(sidebarTitlebarDragRegion?.className).toContain("left-[var(--desktop-titlebar-content-inset)]");
		expect(sidebarContent?.getAttribute("data-motion")).toBe("sidebar-content");
		expect(sidebarContent?.getAttribute("data-motion-mode")).toBe("drawer");
		expect(sidebarContent?.getAttribute("data-motion-origin")).toBe("left");
		expect(sidebarContent?.getAttribute("data-motion-owner")).toBe("content");
		expect(sidebarContent?.getAttribute("data-motion-scope")).toBe("structural");
		expect(sidebarContent?.getAttribute("data-resize-motion")).toBe("contents-static");
		expect(sidebarContent?.className).toContain("pt-[var(--desktop-titlebar-safe-area)]");

		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

		expect(sidebarFrame.getAttribute("data-state")).toBe("closed");
		expect(shell.dataset.sidebarWidth).toBe(String(SIDEBAR_WIDTH.collapsed));
		expect(sidebarFrame.getAttribute("aria-hidden")).toBe("true");
		expect((sidebarInner as HTMLElement | null)?.style.width).toBe(`${SIDEBAR_WIDTH.default}px`);
	});

	it("marks native workbench chrome as non-selectable without marking main content as text", () => {
		const { container } = render(
			<AppLayout sidebar={<div>sidebar chrome label</div>}>
				<div>selectable conversation content</div>
			</AppLayout>,
		);
		const shell = getWorkbenchShell(container);
		const sidebarFrame = screen.getByLabelText("Workspace sidebar");
		const mainContent = container.querySelector("main");

		expect(shell.className).toContain("select-none");
		expect(sidebarFrame.className).toContain("select-none");
		expect(mainContent?.className).not.toContain("select-text");
	});

	it("resizes the sidebar from the keyboard within the configured bounds", () => {
		const { container } = render(
			<AppLayout sidebar={<div>sidebar</div>}>
				<div>content</div>
			</AppLayout>,
		);
		const shell = getWorkbenchShell(container);
		const separator = screen.getByRole("separator", { name: "Resize sidebar" });

		fireEvent.keyDown(separator, { key: "End" });
		expect(shell.dataset.sidebarWidth).toBe(String(SIDEBAR_WIDTH.max));
		expect(separator.getAttribute("aria-valuenow")).toBe(String(SIDEBAR_WIDTH.max));

		fireEvent.keyDown(separator, { key: "Home" });
		expect(shell.dataset.sidebarWidth).toBe(String(SIDEBAR_WIDTH.min));
		expect(separator.getAttribute("aria-valuenow")).toBe(String(SIDEBAR_WIDTH.min));

		fireEvent.keyDown(separator, { key: "ArrowRight" });
		expect(shell.dataset.sidebarWidth).toBe(String(SIDEBAR_WIDTH.min + 16));

		fireEvent.keyDown(separator, { key: "ArrowLeft" });
		expect(shell.dataset.sidebarWidth).toBe(String(SIDEBAR_WIDTH.min));
	});

	it("marks sidebar pointer resizing before the cursor can enter preview iframes", () => {
		const { container } = render(
			<AppLayout sidebar={<div>sidebar</div>}>
				<iframe data-slot="workspace-preview-frame" title="preview" />
			</AppLayout>,
		);
		const shell = getWorkbenchShell(container);
		const separator = screen.getByRole("separator", { name: "Resize sidebar" });

		expect(shell.dataset.sidebarResizing).toBe("false");

		fireEvent.pointerDown(separator);
		expect(shell.dataset.sidebarResizing).toBe("true");

		fireEvent.pointerUp(window);
		expect(shell.dataset.sidebarResizing).toBe("false");
	});

	it("renders no icon rail actions inside the collapsed sidebar", () => {
		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="session-full"
				isBusy={false}
				isLoading={false}
				isSidebarCollapsed={true}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "pi-mono", 1)]}
				sessionsByProjectId={{
					"project-1": [createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")],
				}}
			/>,
		);

		expect(screen.queryByLabelText("Expand sidebar")).toBeNull();
		expect(screen.queryByRole("button", { name: "新对话" })).toBeNull();
		expect(screen.queryByRole("button", { name: "搜索" })).toBeNull();
		expect(screen.queryByRole("button", { name: "设置" })).toBeNull();
		expect(screen.queryByText("项目")).toBeNull();
		expect(screen.queryByText("pi-mono")).toBeNull();
		expect(screen.queryByText("Inspect renderer shell")).toBeNull();
	});

	it("shows the events primary entry with count and selection state", async () => {
		const user = userEvent.setup();
		const onCreateEvent = vi.fn(async () => createEventDetail());
		const onOpenEventAttachments = vi.fn(async () => ({ attachments: [], errors: [] }));
		const onOpenEvents = vi.fn();
		render(
			<Sidebar
				activeProjectId="project-1"
				eventCount={3}
				isBusy={false}
				isLoading={false}
				onCreateEvent={onCreateEvent}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onOpenEventAttachments={onOpenEventAttachments}
				onOpenEvents={onOpenEvents}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "pi-mono", 1)]}
				runningEventCount={1}
				selectedPrimaryItem="events"
				sessionsByProjectId={{ "project-1": [] }}
			/>,
		);

		const eventsButton = screen.getByRole("button", { name: "事件" });
		const eventsRow = eventsButton.parentElement;
		const quickCreateButton = screen.getByRole("button", { name: "记录事件" });
		const eventCount = document.querySelector("[data-slot='sidebar-events-count']");
		expect(eventsRow?.className).toContain("bg-[color:var(--color-sidebar-selected)]");
		expect(eventsRow?.className).toContain("pr-2");
		expect(eventCount?.textContent).toContain("3");
		expect(quickCreateButton.nextElementSibling).toBe(eventCount);
		expect(quickCreateButton.className).not.toContain("shadow");
		expect(screen.getByLabelText("Running events")).toBeTruthy();

		await user.click(eventsButton);
		expect(onOpenEvents).toHaveBeenCalledTimes(1);
	});

	it("records an event from the sidebar without opening the events view", async () => {
		const user = userEvent.setup();
		const draftAttachment: DesktopEventAttachmentDraft = {
			id: "draft-1",
			name: "idea.md",
			sourcePath: "/workspace/pi-mono/idea.md",
			mimeType: "text/markdown",
			size: 14,
			textSnapshot: "draft idea",
		};
		const onCreateEvent = vi.fn(async () => createEventDetail({ attachments: [] }));
		const onOpenEventAttachments = vi.fn(async () => ({ attachments: [draftAttachment], errors: [] }));
		const onOpenEvents = vi.fn();

		render(
			<Sidebar
				activeProjectId="project-1"
				eventCount={3}
				isBusy={false}
				isLoading={false}
				onCreateEvent={onCreateEvent}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onOpenEventAttachments={onOpenEventAttachments}
				onOpenEvents={onOpenEvents}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "pi-mono", 1)]}
				sessionsByProjectId={{ "project-1": [] }}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "记录事件" }));
		const dialog = screen.getByRole("dialog", { name: "记录事件" });
		const dialogHeader = dialog.querySelector("[data-slot='sidebar-event-create-header']");
		const dialogFooter = dialog.querySelector("[data-slot='sidebar-event-create-footer']");
		const eventTextarea = screen.getByLabelText("记录事件内容");
		const attachmentButton = screen.getByRole("button", { name: "添加附件" });
		expect(dialog.className).toContain("uix-flat-panel");
		expect(dialogHeader?.className).not.toContain("border-b");
		expect(dialogFooter?.className).not.toContain("border-t");
		expect(eventTextarea.className).toContain("uix-flat-field");
		expect(eventTextarea.className).toContain("px-[var(--uix-flat-field-padding-x)]");
		expect(attachmentButton.className).toContain("uix-flat-action");

		await user.type(screen.getByLabelText("记录事件内容"), "Capture a sidebar idea");
		await user.click(screen.getByRole("button", { name: "添加附件" }));

		expect(onOpenEventAttachments).toHaveBeenCalledWith({ defaultPath: "/workspace/pi-mono" });
		expect(screen.getByText("idea.md")).toBeTruthy();

		await user.keyboard("{Meta>}{Enter}{/Meta}");

		await waitFor(() => {
			expect(onCreateEvent).toHaveBeenCalledWith({
				body: "Capture a sidebar idea",
				attachments: [draftAttachment],
			});
		});
		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "记录事件" })).toBeNull();
		});
		expect(onOpenEvents).not.toHaveBeenCalled();
	});

	it("hides empty historical sessions when another session has real messages", () => {
		const { container } = render(
			<SessionList
				onSelectSession={async () => undefined}
				sessions={[
					createSession("session-empty", "Reply with exactly OK.", "2026-04-22T00:00:00.000Z", 0),
					createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z"),
				]}
			/>,
		);

		expect(screen.getByText("Inspect renderer shell")).toBeTruthy();
		expect(screen.queryByText("Reply with exactly OK.")).toBeNull();
		expect(container.querySelector("[data-slot='sidebar-session-list']")?.getAttribute("data-resize-motion")).toBe(
			"contents-static",
		);
	});

	it("formats sidebar relative times in compact Chinese labels", () => {
		const now = new Date("2026-04-26T12:00:00.000Z");

		expect(formatRelativeUpdatedAt("2026-04-26T11:36:00.000Z", now)).toBe("24 分");
		expect(formatRelativeUpdatedAt("2026-04-26T05:00:00.000Z", now)).toBe("7 小时");
		expect(formatRelativeUpdatedAt("2026-04-24T12:00:00.000Z", now)).toBe("2 天");
		expect(formatRelativeUpdatedAt("2026-04-19T12:00:00.000Z", now)).toBe("1 周");
	});

	it("invokes session selection for visible sessions", async () => {
		const user = userEvent.setup();
		const onSelectSession = vi.fn(async () => undefined);

		render(
			<SessionList
				onSelectSession={onSelectSession}
				sessions={[createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")]}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /inspect renderer shell/i }));

		expect(onSelectSession).toHaveBeenCalledWith("session-full");
	});

	it("confirms session deletion without selecting the row", async () => {
		const user = userEvent.setup();
		const onDeleteSession = vi.fn(async () => undefined);
		const onSelectSession = vi.fn(async () => undefined);

		render(
			<SessionList
				onDeleteSession={onDeleteSession}
				onSelectSession={onSelectSession}
				projectId="project-1"
				sessions={[createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")]}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "删除对话 Inspect renderer shell" }));
		await user.click(screen.getByRole("button", { name: "确认删除对话 Inspect renderer shell" }));

		expect(onDeleteSession).toHaveBeenCalledWith("session-full", "project-1");
		expect(onSelectSession).not.toHaveBeenCalled();
	});

	it("dismisses session delete confirmation when clicking outside", async () => {
		const user = userEvent.setup();

		render(
			<div>
				<SessionList
					onDeleteSession={async () => undefined}
					onSelectSession={async () => undefined}
					projectId="project-1"
					sessions={[createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")]}
				/>
				<button type="button">Outside target</button>
			</div>,
		);

		await user.click(screen.getByRole("button", { name: "删除对话 Inspect renderer shell" }));
		expect(screen.getByRole("button", { name: "确认删除对话 Inspect renderer shell" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Outside target" }));

		expect(screen.queryByRole("button", { name: "确认删除对话 Inspect renderer shell" })).toBeNull();
	});

	it("does not keep the delete action visible from row focus alone", async () => {
		const user = userEvent.setup();

		render(
			<SessionList
				activeSessionId="session-full"
				onDeleteSession={async () => undefined}
				onSelectSession={async () => undefined}
				projectId="project-1"
				sessions={[createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")]}
			/>,
		);

		const sessionRow = screen
			.getAllByRole("button", { name: /inspect renderer shell/i })
			.find((button) => button.getAttribute("aria-current") === "page");
		if (!sessionRow) {
			throw new Error("Expected selected session row.");
		}
		await user.click(sessionRow);
		const deleteAction = screen.getByRole("button", { name: "删除对话 Inspect renderer shell" });

		expect(deleteAction.className).toContain("opacity-0");
		expect(deleteAction.className).toContain("group-hover/session:opacity-100");
		expect(deleteAction.className).not.toContain("group-focus-within/session:opacity-100");
	});

	it("dismisses session delete confirmation with Escape", async () => {
		const user = userEvent.setup();

		render(
			<SessionList
				onDeleteSession={async () => undefined}
				onSelectSession={async () => undefined}
				projectId="project-1"
				sessions={[createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")]}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "删除对话 Inspect renderer shell" }));
		expect(screen.getByRole("button", { name: "确认删除对话 Inspect renderer shell" })).toBeTruthy();

		await user.keyboard("{Escape}");

		expect(screen.queryByRole("button", { name: "确认删除对话 Inspect renderer shell" })).toBeNull();
	});

	it("dismisses session delete confirmation when the pending row leaves the list", async () => {
		const user = userEvent.setup();
		const { rerender } = render(
			<SessionList
				onDeleteSession={async () => undefined}
				onSelectSession={async () => undefined}
				projectId="project-1"
				sessions={[
					createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z"),
					createSession("session-next", "Next session", "2026-04-22T00:00:00.000Z"),
				]}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "删除对话 Inspect renderer shell" }));
		expect(screen.getByRole("button", { name: "确认删除对话 Inspect renderer shell" })).toBeTruthy();

		rerender(
			<SessionList
				onDeleteSession={async () => undefined}
				onSelectSession={async () => undefined}
				projectId="project-1"
				sessions={[createSession("session-next", "Next session", "2026-04-22T00:00:00.000Z")]}
			/>,
		);

		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "确认删除对话 Inspect renderer shell" })).toBeNull();
		});
		expect(screen.getByText("Next session")).toBeTruthy();
	});

	it("keeps empty running sessions visible with a quiet running indicator", () => {
		render(
			<SessionList
				onSelectSession={async () => undefined}
				sessions={[
					{
						...createSession("session-running", "Background task", "2026-04-22T00:00:00.000Z", 0),
						isStreaming: true,
						runStartedAt: "2026-04-22T00:00:00.000Z",
					},
					createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z"),
				]}
			/>,
		);

		expect(screen.getByText("新对话")).toBeTruthy();
		expect(screen.getByLabelText("Session running")).toBeTruthy();
	});

	it("renders projects with nested sessions for active and inactive projects", async () => {
		const user = userEvent.setup();
		const onSelectProject = vi.fn(async () => undefined);
		const onCreateProjectFromFolder = vi.fn(async () => undefined);
		const onCreateSession = vi.fn(async () => undefined);
		const onOpenSettings = vi.fn();

		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="session-full"
				errorMessage={undefined}
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={onCreateProjectFromFolder}
				onCreateSession={onCreateSession}
				onOpenSettings={onOpenSettings}
				onSelectProject={onSelectProject}
				onSelectSession={async () => undefined}
				projects={[
					createProject("project-1", "pi-mono", 1),
					createProject("project-2", "opencode", 0),
					createProject("project-3", "qiaochao", 1),
				]}
				sessionsByProjectId={{
					"project-1": [createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")],
					"project-3": [
						createSession("session-other", "Create local Obsidian plugin", "2026-04-22T02:00:00.000Z"),
					],
				}}
			/>,
		);

		expect(screen.getByText("项目")).toBeTruthy();
		expect(screen.getByRole("button", { name: "新对话" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "搜索" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
		expect(screen.getByText("pi-mono")).toBeTruthy();
		expect(screen.getByText("opencode")).toBeTruthy();
		expect(screen.getByText("Inspect renderer shell")).toBeTruthy();
		expect(screen.getByText("Create local Obsidian plugin")).toBeTruthy();

		await user.click(screen.getByLabelText("Use local folder"));
		await user.click(screen.getByRole("button", { name: "新对话" }));
		await user.click(screen.getByRole("button", { name: "设置" }));

		expect(onCreateProjectFromFolder).toHaveBeenCalledTimes(1);
		expect(onCreateSession).toHaveBeenCalledTimes(1);
		expect(onOpenSettings).toHaveBeenCalledTimes(1);
		expect(onSelectProject).not.toHaveBeenCalled();
	});

	it("disambiguates duplicate project names with cwd suffixes", () => {
		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId={undefined}
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[
					createProject("project-1", "skylark", 0, "/Users/qiaochao/projects/skylark"),
					createProject("project-2", "desktop-ai-agent", 0, "/Users/qiaochao/Downloads/desktop-ai-agent"),
				]}
				sessionsByProjectId={{ "project-1": [], "project-2": [] }}
			/>,
		);

		const packageProject = screen.getByRole("button", { name: "desktop-ai-agent · packages" });
		const downloadsProject = screen.getByRole("button", { name: "desktop-ai-agent · Downloads" });

		expect(packageProject.getAttribute("title")).toBe("/Users/qiaochao/projects/skylark");
		expect(downloadsProject.getAttribute("title")).toBe("/Users/qiaochao/Downloads/desktop-ai-agent");
	});

	it("routes the top new conversation action through the primary creation handler", async () => {
		const user = userEvent.setup();
		const onCreatePrimarySession = vi.fn(async () => undefined);
		const onCreateSession = vi.fn(async () => undefined);

		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="session-full"
				isBusy={false}
				isLoading={false}
				onCreatePrimarySession={onCreatePrimarySession}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={onCreateSession}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "pi-mono", 1)]}
				sessionsByProjectId={{
					"project-1": [createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")],
				}}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "新对话" }));

		expect(onCreatePrimarySession).toHaveBeenCalledTimes(1);
		expect(onCreateSession).not.toHaveBeenCalled();
	});

	it("shows a subtle empty hint under projects without sessions", () => {
		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId={undefined}
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "opencode", 0)]}
				sessionsByProjectId={{ "project-1": [] }}
			/>,
		);

		const emptyHint = screen.getByText("暂无对话");

		expect(emptyHint).toBeTruthy();
		expect(emptyHint.className).toContain("sidebar-empty-hint");
		expect(screen.queryByRole("button", { name: /^新对话$/i })).toBeTruthy();
	});

	it("keeps inactive empty project folders compact", () => {
		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId={undefined}
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "opencode", 0), createProject("project-2", "qiaochao", 0)]}
				sessionsByProjectId={{ "project-1": [], "project-2": [] }}
			/>,
		);

		const inactiveProjectButton = screen.getByRole("button", { name: /^qiaochao$/i });
		const projectStack = inactiveProjectButton.parentElement?.parentElement?.parentElement;

		expect(screen.getAllByText("暂无对话")).toHaveLength(1);
		expect(projectStack?.className).toContain("space-y-1");
		expect(projectStack?.className).not.toContain("space-y-5");
	});

	it("keeps only session rows selected while preserving row spacing", () => {
		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="session-full"
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "pi-mono", 1)]}
				sessionsByProjectId={{
					"project-1": [createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")],
				}}
			/>,
		);

		const projectButton = screen.getByRole("button", { name: /^pi-mono$/i });
		const projectSurface = projectButton.parentElement;
		const projectStack = projectSurface?.parentElement?.parentElement;
		const sessionButton = screen.getByRole("button", { name: /inspect renderer shell/i });
		const sessionSurface = sessionButton.closest("[data-slot='entity-row']");
		if (!(sessionSurface instanceof HTMLElement)) {
			throw new Error("Expected selected session row surface.");
		}

		expect(projectStack?.className).toContain("space-y-1");
		expect(projectSurface?.className).toContain("mx-3");
		expect(projectSurface?.className).toContain("h-8");
		expect(projectSurface?.className).toContain("rounded-[9px]");
		expect(projectSurface?.className).not.toContain("bg-[color:var(--color-sidebar-selected)]");
		expect(projectSurface?.className).toContain("hover:bg-[color:var(--color-sidebar-project-hover)]");
		expect(projectButton.className).toContain("pl-1");
		expect(sessionSurface.parentElement?.parentElement?.parentElement?.className).toContain("mt-1");
		expect(sessionSurface.parentElement?.className).toContain("px-3");
		expect(sessionSurface.className).toContain("h-8");
		expect(sessionSurface.className).toContain("rounded-[9px]");
		expect(sessionSurface.className).toContain("bg-[color:var(--color-sidebar-selected)]");
		expect(sessionSurface.className).toContain("before:bg-transparent");
		expect(sessionSurface.className).not.toContain("before:bg-[color:var(--accent)]");
		expect(sessionButton.className).toContain("h-8");
		expect(sessionButton.className).toContain("rounded-[9px]");
	});

	it("does not highlight the active project while capabilities is selected", () => {
		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId={undefined}
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "pi-mono", 0)]}
				selectedPrimaryItem="capabilities"
				sessionsByProjectId={{ "project-1": [] }}
			/>,
		);

		const projectButton = screen.getByRole("button", { name: /^pi-mono$/i });
		const projectSurface = projectButton.parentElement;

		expect(screen.getByRole("button", { name: "能力库" }).className).toContain(
			"bg-[color:var(--color-sidebar-selected)]",
		);
		expect(projectSurface?.className).not.toContain("bg-[color:var(--color-sidebar-selected)]");
	});

	it("renders selected session rows through action-safe EntityRow containers", () => {
		render(
			<SessionList
				activeSessionId="session-full"
				onDeleteSession={async () => undefined}
				onSelectSession={async () => undefined}
				projectId="project-1"
				sessions={[createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")]}
			/>,
		);

		const sessionButton = screen
			.getAllByRole("button", { name: /inspect renderer shell/i })
			.find((button) => button.getAttribute("aria-current") === "page");
		if (!sessionButton) {
			throw new Error("Expected selected session action.");
		}
		const sessionRow = sessionButton.closest("[data-slot='entity-row']");
		if (!(sessionRow instanceof HTMLElement)) {
			throw new Error("Expected the session action to be wrapped by EntityRow.");
		}

		expect(sessionRow.tagName).toBe("DIV");
		expect(sessionRow.dataset.selected).toBe("true");
		expect(sessionRow.className).toContain("before:bg-transparent");
		expect(sessionRow.className).not.toContain("before:bg-[color:var(--accent)]");
		expect(sessionRow.querySelector("button button")).toBeNull();
		expect(screen.getByRole("button", { name: "删除对话 Inspect renderer shell" })).toBeTruthy();
	});

	it("scopes the active session highlight to the active project", () => {
		render(
			<Sidebar
				activeProjectId="project-2"
				activeSessionId="shared-session"
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "Downloads", 1), createProject("project-2", "desktop-ai-agent", 1)]}
				sessionsByProjectId={{
					"project-1": [createSession("shared-session", "hello", "2026-04-22T01:00:00.000Z")],
					"project-2": [createSession("shared-session", "hello", "2026-04-22T01:00:00.000Z")],
				}}
			/>,
		);

		const helloRows = screen.getAllByRole("button", { name: /hello/i });

		expect(helloRows).toHaveLength(2);
		expect(helloRows[0]?.getAttribute("aria-current")).toBeNull();
		expect(helloRows[1]?.getAttribute("aria-current")).toBe("page");
	});

	it("toggles a project open and closed from the project collapse button", async () => {
		const user = userEvent.setup();
		const onSelectProject = vi.fn(async () => undefined);

		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="session-full"
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={onSelectProject}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "pi-mono", 1)]}
				sessionsByProjectId={{
					"project-1": [createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")],
				}}
			/>,
		);

		expect(screen.getByText("Inspect renderer shell")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "折叠项目 pi-mono" }));
		await waitFor(() => {
			expect(screen.queryByText("Inspect renderer shell")).toBeNull();
		});

		await user.click(screen.getByRole("button", { name: "展开项目 pi-mono" }));
		expect(screen.getByText("Inspect renderer shell")).toBeTruthy();
		expect(onSelectProject).not.toHaveBeenCalled();
	});

	it("selects inactive project rows without selecting a session", async () => {
		const user = userEvent.setup();
		const onSelectProject = vi.fn(async () => undefined);
		const onSelectSession = vi.fn(async () => undefined);

		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="session-full"
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={onSelectProject}
				onSelectSession={onSelectSession}
				projects={[createProject("project-1", "pi-mono", 1), createProject("project-2", "desktop-ai-agent", 1)]}
				sessionsByProjectId={{
					"project-1": [createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")],
					"project-2": [
						createSession("session-other", "Create local Obsidian plugin", "2026-04-22T02:00:00.000Z"),
					],
				}}
			/>,
		);

		expect(screen.getByText("Create local Obsidian plugin")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: /^desktop-ai-agent$/i }));

		await waitFor(() => {
			expect(onSelectProject).toHaveBeenCalledWith("project-2");
		});
		expect(screen.getByText("Create local Obsidian plugin")).toBeTruthy();
		expect(onSelectSession).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "折叠项目 desktop-ai-agent" }));

		await waitFor(() => {
			expect(screen.queryByText("Create local Obsidian plugin")).toBeNull();
		});
		expect(onSelectProject).toHaveBeenCalledTimes(1);
		expect(onSelectSession).not.toHaveBeenCalled();
	});

	it("creates a new conversation in the hovered project without toggling the project row", async () => {
		const user = userEvent.setup();
		const onCreatePrimarySession = vi.fn(async () => undefined);
		const onCreateSession = vi.fn(async () => undefined);
		const onSelectProject = vi.fn(async () => undefined);
		const onSelectSession = vi.fn(async () => undefined);

		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="session-full"
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreatePrimarySession={onCreatePrimarySession}
				onCreateSession={onCreateSession}
				onSelectProject={onSelectProject}
				onSelectSession={onSelectSession}
				projects={[createProject("project-1", "pi-mono", 1), createProject("project-2", "desktop-ai-agent", 1)]}
				sessionsByProjectId={{
					"project-1": [createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")],
					"project-2": [
						createSession("session-other", "Create local Obsidian plugin", "2026-04-22T02:00:00.000Z"),
					],
				}}
			/>,
		);

		await user.hover(screen.getByRole("button", { name: /^desktop-ai-agent$/i }));
		await user.click(screen.getByRole("button", { name: "在 desktop-ai-agent 中新建对话" }));

		expect(screen.getByText("Create local Obsidian plugin")).toBeTruthy();
		await waitFor(() => {
			expect(onSelectProject).toHaveBeenCalledWith("project-2");
			expect(onCreateSession).toHaveBeenCalledWith("project-2");
		});
		expect(onCreatePrimarySession).not.toHaveBeenCalled();
		expect(onSelectSession).not.toHaveBeenCalled();
	});

	it("keeps project session creation scoped to the clicked project action", async () => {
		const user = userEvent.setup();
		const creation = createDeferredPromise<DesktopSessionSummary | undefined>();
		const onCreateSession = vi.fn(async () => creation.promise);
		const onSelectProject = vi.fn(async () => undefined);
		const props = {
			activeProjectId: "project-2",
			activeSessionId: undefined,
			isLoading: false,
			onCreateProjectFromFolder: async () => undefined,
			onCreateSession,
			onSelectProject,
			onSelectSession: async () => undefined,
			projects: [
				createProject("project-1", "workspace-claw", 0),
				createProject("project-2", "desktop-ai-agent", 0),
				createProject("project-3", "Downloads", 1),
			],
			sessionsByProjectId: {
				"project-1": [],
				"project-2": [],
				"project-3": [createSession("session-downloads", "古风美女", "2026-04-22T02:00:00.000Z")],
			},
		};
		const { rerender } = render(<Sidebar {...props} isBusy={false} />);

		await user.click(screen.getByRole("button", { name: "在 desktop-ai-agent 中新建对话" }));
		rerender(<Sidebar {...props} isBusy={true} />);

		await waitFor(() => {
			expect(
				(screen.getByRole("button", { name: "在 desktop-ai-agent 中新建对话" }) as HTMLButtonElement).disabled,
			).toBe(true);
		});
		expect(onCreateSession).toHaveBeenCalledTimes(1);
		expect(onCreateSession).toHaveBeenCalledWith("project-2");
		expect(onSelectProject).not.toHaveBeenCalled();
		expect((screen.getByRole("button", { name: "新对话" }) as HTMLButtonElement).disabled).toBe(false);
		expect((screen.getByRole("button", { name: "在 workspace-claw 中新建对话" }) as HTMLButtonElement).disabled).toBe(
			false,
		);
		expect((screen.getByRole("button", { name: "在 Downloads 中新建对话" }) as HTMLButtonElement).disabled).toBe(
			false,
		);
		expect(screen.getByRole("button", { name: "在 workspace-claw 中新建对话" }).className).not.toContain(
			"group-focus-within/project:opacity-100",
		);

		creation.resolve(undefined);
	});

	it("opens sidebar search in an independent dialog and selects session results with project context", async () => {
		const user = userEvent.setup();
		const onSelectProject = vi.fn(async () => undefined);
		const onSelectSession = vi.fn(async () => undefined);

		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="session-full"
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={onSelectProject}
				onSelectSession={onSelectSession}
				projects={[createProject("project-1", "pi-mono", 1), createProject("project-2", "qiaochao", 1)]}
				sessionsByProjectId={{
					"project-1": [createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")],
					"project-2": [
						createSession("session-other", "Create local Obsidian plugin", "2026-04-22T02:00:00.000Z"),
					],
				}}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "搜索" }));
		const dialog = screen.getByRole("dialog", { name: "搜索" });
		const dialogHeader = dialog.querySelector("[data-slot='sidebar-search-header']");
		const inputSurface = dialog.querySelector("[data-slot='sidebar-search-input-surface']");
		const resultsSurface = dialog.querySelector("[data-slot='sidebar-search-results']");
		expect(dialog.className).toContain("uix-flat-panel");
		expect(dialogHeader?.className).not.toContain("border-b");
		expect(inputSurface?.className).toContain("uix-flat-field");
		expect(resultsSurface?.className).toContain("uix-flat-field");
		await user.type(within(dialog).getByRole("searchbox", { name: "搜索项目和对话" }), "Obsidian");

		expect(screen.getByText("pi-mono")).toBeTruthy();
		expect(screen.getByText("Inspect renderer shell")).toBeTruthy();

		const result = within(dialog).getByRole("button", { name: /Create local Obsidian plugin/i });
		expect(result).toBeTruthy();

		await user.click(result);

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "搜索" })).toBeNull();
		});
		expect(onSelectProject).not.toHaveBeenCalled();
		expect(onSelectSession).toHaveBeenCalledWith("session-other", "project-2");
	});

	it("limits project sessions and expands hidden rows on demand", async () => {
		const user = userEvent.setup();
		const sessions = Array.from({ length: 6 }, (_, index) =>
			createSession(`session-${index}`, `Session ${index + 1}`, `2026-04-22T0${index}:00:00.000Z`),
		);

		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="session-0"
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "pi-mono", 6)]}
				sessionsByProjectId={{ "project-1": sessions }}
			/>,
		);

		expect(screen.getByText("Session 5")).toBeTruthy();
		expect(screen.queryByText("Session 6")).toBeNull();

		await user.click(screen.getByRole("button", { name: "展开显示" }));

		expect(screen.getByText("Session 6")).toBeTruthy();
		expect(screen.getByRole("button", { name: "折叠显示" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "折叠显示" }));

		await waitFor(() => {
			expect(screen.queryByText("Session 6")).toBeNull();
		});
		expect(screen.getByRole("button", { name: "展开显示" })).toBeTruthy();
	});

	it("keeps session quantity expansion scoped to a single project", async () => {
		const user = userEvent.setup();
		const firstProjectSessions = Array.from({ length: 6 }, (_, index) =>
			createSession(
				`project-1-session-${index}`,
				`Project 1 Session ${index + 1}`,
				`2026-04-22T0${index}:00:00.000Z`,
			),
		);
		const secondProjectSessions = Array.from({ length: 6 }, (_, index) =>
			createSession(
				`project-2-session-${index}`,
				`Project 2 Session ${index + 1}`,
				`2026-04-22T0${index}:00:00.000Z`,
			),
		);

		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="project-1-session-0"
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "pi-mono", 6), createProject("project-2", "opencode", 6)]}
				sessionsByProjectId={{
					"project-1": firstProjectSessions,
					"project-2": secondProjectSessions,
				}}
			/>,
		);

		expect(screen.queryByText("Project 1 Session 6")).toBeNull();
		expect(screen.queryByText("Project 2 Session 6")).toBeNull();

		await user.click(screen.getAllByRole("button", { name: "展开显示" })[0]!);

		expect(screen.getByText("Project 1 Session 6")).toBeTruthy();
		expect(screen.queryByText("Project 2 Session 6")).toBeNull();

		await user.click(screen.getByRole("button", { name: "折叠项目 pi-mono" }));
		await waitFor(() => {
			expect(screen.queryByText("Project 1 Session 6")).toBeNull();
		});

		await user.click(screen.getByRole("button", { name: "展开项目 pi-mono" }));
		expect(screen.getByText("Project 1 Session 6")).toBeTruthy();
	});

	it("does not disable navigation rows or unrelated creation actions while sidebar actions are busy", () => {
		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="session-full"
				isBusy={true}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "pi-mono", 1)]}
				sessionsByProjectId={{
					"project-1": [createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")],
				}}
			/>,
		);

		expect((screen.getByRole("button", { name: "新对话" }) as HTMLButtonElement).disabled).toBe(false);
		expect((screen.getByLabelText("Use local folder") as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: /^pi-mono$/i }) as HTMLButtonElement).disabled).toBe(false);
		expect((screen.getByRole("button", { name: /inspect renderer shell/i }) as HTMLButtonElement).disabled).toBe(
			false,
		);
	});

	it("keeps the initial project loading state free of pulsing skeleton rows", () => {
		const { container } = render(
			<Sidebar
				isBusy={false}
				isLoading={true}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[]}
				sessionsByProjectId={{}}
			/>,
		);

		const projectTree = container.querySelector(".sidebar-project-tree");
		expect(projectTree?.querySelector("[data-slot='skeleton']")).toBeNull();
		expect(projectTree?.querySelector("[data-slot='sidebar-project-loading-state']")).toBeTruthy();
	});

	it("toolbar hides empty projects and collapses project sessions", async () => {
		const user = userEvent.setup();

		render(
			<Sidebar
				activeProjectId="project-1"
				activeSessionId="session-full"
				isBusy={false}
				isLoading={false}
				onCreateProjectFromFolder={async () => undefined}
				onCreateSession={async () => undefined}
				onSelectProject={async () => undefined}
				onSelectSession={async () => undefined}
				projects={[createProject("project-1", "pi-mono", 1), createProject("project-2", "opencode", 0)]}
				sessionsByProjectId={{
					"project-1": [createSession("session-full", "Inspect renderer shell", "2026-04-22T01:00:00.000Z")],
				}}
			/>,
		);

		expect(screen.getByText("opencode")).toBeTruthy();
		await user.click(screen.getByLabelText("Hide empty projects"));
		await waitFor(() => {
			expect(screen.queryByText("opencode")).toBeNull();
		});

		expect(screen.getByText("Inspect renderer shell")).toBeTruthy();
		await user.click(screen.getByLabelText("Collapse all projects"));
		await waitFor(() => {
			expect(screen.queryByText("Inspect renderer shell")).toBeNull();
		});
	});
});
