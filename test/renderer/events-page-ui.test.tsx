import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventsPage } from "../../src/renderer/components/events/EventsPage.tsx";
import type {
	DesktopEventDetail,
	DesktopEventManagementProposal,
	DesktopEventSummary,
	DesktopProjectSummary,
} from "../../src/shared/types.ts";

afterEach(() => {
	cleanup();
});

const project: DesktopProjectSummary = {
	id: "project-1",
	name: "pi-mono",
	cwd: "/workspace/pi-mono",
	createdAt: "2026-05-22T00:00:00.000Z",
	updatedAt: "2026-05-22T00:00:00.000Z",
	sessionCount: 1,
};

const otherProject: DesktopProjectSummary = {
	id: "project-2",
	name: "Downloads",
	cwd: "/Users/qiaochao/Downloads",
	createdAt: "2026-05-22T00:00:00.000Z",
	updatedAt: "2026-05-22T00:00:00.000Z",
	sessionCount: 0,
};

function createEvent(overrides: Partial<DesktopEventDetail> = {}): DesktopEventDetail {
	return {
		id: "event-1",
		title: "Implement event board",
		body: "Build compact columns and run sessions.",
		bodyPreview: "Build compact columns and run sessions.",
		status: "ready",
		attachmentCount: 1,
		commentCount: 0,
		createdAt: "2026-05-21T00:00:00.000Z",
		updatedAt: "2026-05-21T01:00:00.000Z",
		statusChangedAt: "2026-05-21T01:00:00.000Z",
		attachments: [
			{
				id: "attachment-1",
				name: "idea.md",
				originalPath: "/workspace/idea.md",
				storedPath: "/app/events/idea.md",
				mimeType: "text/markdown",
				size: 12,
				textSnapshot: "idea snapshot",
				createdAt: "2026-05-21T00:00:00.000Z",
			},
		],
		comments: [],
		runs: [
			{
				id: "run-1",
				projectId: "project-1",
				sessionId: "session-1",
				promptText: "Run",
				attachmentIds: ["attachment-1"],
				status: "awaiting_review",
				createdAt: "2026-05-21T02:00:00.000Z",
				updatedAt: "2026-05-21T03:00:00.000Z",
				completedAt: "2026-05-21T03:00:00.000Z",
			},
		],
		latestRunStatus: "awaiting_review",
		latestRunAt: "2026-05-21T03:00:00.000Z",
		latestSessionId: "session-1",
		...overrides,
	};
}

function toSummary(event: DesktopEventDetail): DesktopEventSummary {
	const { attachments: _attachments, body: _body, comments: _comments, runs: _runs, ...summary } = event;
	return summary;
}

type EventsPageProps = ComponentProps<typeof EventsPage>;

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

async function confirmEventManagement(user: ReturnType<typeof userEvent.setup>): Promise<void> {
	await user.click(screen.getByRole("button", { name: "整理事件" }));
	await user.click(screen.getByRole("button", { name: "确认整理事件" }));
}

function renderEventsPage(overrides: Partial<EventsPageProps> = {}) {
	const activeEvent = createEvent();
	const props: EventsPageProps = {
		activeEvent,
		activeEventId: activeEvent.id,
		activeProjectId: project.id,
		events: [
			toSummary(activeEvent),
			toSummary(
				createEvent({
					id: "event-2",
					title: "Discard old idea",
					status: "discarded",
					discardedAt: "2026-05-21T04:00:00.000Z",
				}),
			),
		],
		isLoading: false,
		isManagingEvents: false,
		isRunning: false,
		isSaving: false,
		onAddEventComment: vi.fn(async () => undefined),
		onApplyEventManagementProposal: vi.fn(async () => undefined),
		onClearEventManagementProposal: vi.fn(() => undefined),
		onCreateProjectFromFolder: vi.fn(async () => undefined),
		onCreateEventManagementProposal: vi.fn(async () => undefined),
		onDeleteEvent: vi.fn(async () => undefined),
		onOpenSession: vi.fn(async () => undefined),
		onRefreshEvents: vi.fn(async () => undefined),
		onRunEvent: vi.fn(async () => undefined),
		onSelectEvent: vi.fn(async () => undefined),
		onSetEventStatus: vi.fn(async () => undefined),
		onUpdateEvent: vi.fn(async () => undefined),
		projects: [project],
		...overrides,
	};

	return {
		...render(<EventsPage {...props} />),
		props,
	};
}

describe("EventsPage", () => {
	it("renders compact board columns and toggles discarded events", async () => {
		const user = userEvent.setup();
		renderEventsPage();

		expect(document.querySelector("[data-slot='events-workbench']")?.className).not.toContain(
			"rounded-[var(--radius-xl)]",
		);
		expect(document.querySelector("[data-slot='events-workbench']")?.className).toContain("select-none");
		const header = document.querySelector("[data-slot='events-panel-header']");
		expect(header?.getAttribute("data-layout")).toBe("panel-header");
		expect(header?.getAttribute("data-page-header")).toBe("workbench");
		expect(header?.className).not.toContain("desktop-window-drag-region");
		expect(header?.className).not.toContain("border-b");
		expect(header?.querySelector("[data-slot='workbench-page-header-drag-region']")?.className).toContain("left-0");
		expect(header?.querySelector("[data-slot='workbench-page-header-title-region']")?.className).toContain(
			"desktop-window-drag-region",
		);
		expect(header?.querySelector("[data-slot='workbench-page-header-actions']")?.className).toContain(
			"desktop-window-no-drag",
		);
		const headerActions = header?.querySelector("[data-slot='workbench-page-header-actions']");
		if (!(headerActions instanceof HTMLElement)) {
			throw new Error("Expected event header actions.");
		}
		expect(within(headerActions).queryByRole("button", { name: "管理准则" })).toBeNull();
		expect(within(headerActions).getByRole("button", { name: "整理事件" })).toBeTruthy();
		expect(within(headerActions).getByRole("button", { name: "刷新事件" })).toBeTruthy();
		const discardedToggle = within(headerActions).getByRole("button", { name: "显示丢弃" });
		const headerActionButtons = within(headerActions).getAllByRole("button");
		expect(headerActionButtons).toHaveLength(3);
		for (const button of headerActionButtons) {
			expect(button.getAttribute("data-slot")).toBe("icon-button");
			expect(button.className).not.toContain("border border-[color:var(--border-subtle)]");
		}
		expect(within(headerActions).queryByText("管理准则")).toBeNull();
		expect(within(headerActions).queryByText("整理事件")).toBeNull();
		expect(within(headerActions).queryByText("显示丢弃")).toBeNull();
		expect(header?.querySelector("[data-slot='workbench-page-header-title']")?.className).toContain(
			"text-[13px] font-medium",
		);
		expect(screen.getByText("事件")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "待评估" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "待处理" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "进行中" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "已完成" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "已丢弃" })).toBeNull();
		expect(screen.queryByLabelText("记录事件")).toBeNull();
		expect(screen.queryByLabelText("事件标题")).toBeNull();

		await user.click(discardedToggle);

		expect(screen.getByRole("heading", { name: "已丢弃" })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Discard old idea/i })).toBeTruthy();
		const activeDiscardedToggle = within(headerActions).getByRole("button", { name: "隐藏丢弃" });
		expect(activeDiscardedToggle.getAttribute("data-slot")).toBe("icon-button");
		expect(activeDiscardedToggle.getAttribute("aria-pressed")).toBe("true");
		expect(activeDiscardedToggle.className).toContain("bg-[color:var(--surface-2)]");
		expect(within(headerActions).queryByText("隐藏丢弃")).toBeNull();

		await user.click(screen.getByRole("button", { name: /Implement event board/i }));

		expect(screen.queryByLabelText("事件标题")).toBeNull();
		const inspectorTitle = document.querySelector("[data-slot='event-inspector-title']");
		expect(inspectorTitle?.textContent).toBe("Implement event board");
		expect(inspectorTitle?.className).toContain("line-clamp-2");
	});

	it("keeps the page header clear of collapsed sidebar titlebar controls", () => {
		renderEventsPage({ isSidebarCollapsed: true });

		const titlebarRow = document.querySelector("[data-slot='events-titlebar-row']");
		const dragRegion = document.querySelector("[data-slot='workbench-page-header-drag-region']");
		const titleRegion = document.querySelector("[data-slot='workbench-page-header-title-region']");
		expect(titlebarRow?.getAttribute("data-titlebar-inset")).toBe("app-titlebar-controls");
		expect(dragRegion?.className).toContain("desktop-window-drag-region");
		expect(dragRegion?.className).toContain("left-[var(--desktop-titlebar-content-inset)]");
		expect(titleRegion?.getAttribute("data-titlebar-drag-region")).toBe("enabled");
		expect(titleRegion?.className).toContain("desktop-window-drag-region");
		expect((titlebarRow as HTMLElement | null)?.style.paddingLeft).toBe("var(--desktop-titlebar-content-inset)");
	});

	it("asks for confirmation before creating an event management proposal", async () => {
		const user = userEvent.setup();
		const onCreateEventManagementProposal = vi.fn(async () => undefined);
		renderEventsPage({ onCreateEventManagementProposal });

		await user.click(screen.getByRole("button", { name: "整理事件" }));

		expect(screen.queryByText("根据 EVENTS.md 整理当前活跃事件")).toBeNull();
		expect(screen.queryByRole("button", { name: "整理事件" })).toBeNull();
		expect(screen.getByRole("button", { name: "确认整理事件" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "取消整理事件" })).toBeTruthy();
		expect(onCreateEventManagementProposal).not.toHaveBeenCalled();

		await user.click(screen.getByText("事件"));
		expect(screen.getByRole("button", { name: "整理事件" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "确认整理事件" })).toBeNull();

		await user.click(screen.getByRole("button", { name: "整理事件" }));
		await user.click(screen.getByRole("button", { name: "取消整理事件" }));
		expect(screen.getByRole("button", { name: "整理事件" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "确认整理事件" })).toBeNull();

		await user.click(screen.getByRole("button", { name: "整理事件" }));
		await user.click(screen.getByRole("button", { name: "确认整理事件" }));

		expect(onCreateEventManagementProposal).toHaveBeenCalledTimes(1);
	});

	it("shows a bottom progress float while event management is working", async () => {
		const user = userEvent.setup();
		const deferred = createDeferred<DesktopEventManagementProposal | undefined>();
		const proposal: DesktopEventManagementProposal = {
			id: "proposal-1",
			criteriaPath: "/Users/qiaochao/.skylark/events/EVENTS.md",
			createdAt: "2026-05-21T05:00:00.000Z",
			items: [
				{
					id: "item-1",
					eventId: "event-1",
					priority: "P1",
					reason: "Important next step.",
					commentBody: "Move this near the top.",
				},
			],
		};
		const onCreateEventManagementProposal = vi.fn(() => deferred.promise);
		renderEventsPage({ onCreateEventManagementProposal });

		await confirmEventManagement(user);

		const workingFloat = screen.getByRole("status", { name: "正在整理事件" });
		expect(workingFloat.textContent).toContain("正在整理事件");
		expect(workingFloat.textContent).toContain("EVENTS.md");
		expect(screen.getByRole("button", { name: "整理事件" })).toHaveProperty("disabled", true);

		deferred.resolve(proposal);

		await waitFor(() => {
			const completedFloat = screen.getByRole("status", { name: "整理事件完成" });
			expect(completedFloat.textContent).toContain("1 条整理建议");
		});

		const completedFloat = screen.getByRole("status", { name: "整理事件完成" });
		const progressFloat = completedFloat.closest("[data-slot='event-management-progress-float']");
		if (!(progressFloat instanceof HTMLElement)) {
			throw new Error("Expected completed event management progress float.");
		}
		await user.hover(progressFloat);
		await user.click(screen.getByRole("button", { name: "关闭整理状态" }));

		expect(screen.queryByRole("status", { name: "整理事件完成" })).toBeNull();
	});

	it("shows a bottom failure float when event management does not return a proposal", async () => {
		const user = userEvent.setup();
		const onCreateEventManagementProposal = vi.fn(async () => undefined);
		renderEventsPage({
			errorMessage: "Event management proposal generation failed.",
			onCreateEventManagementProposal,
		});

		await confirmEventManagement(user);

		await waitFor(() => {
			const failedFloat = screen.getByRole("status", { name: "整理事件失败" });
			expect(failedFloat.textContent).toContain("整理失败");
		});
		expect(screen.getByText("Event management proposal generation failed.")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "关闭整理状态" }));

		expect(screen.queryByRole("status", { name: "整理事件失败" })).toBeNull();
	});

	it("shows priority sorting and applies selected management proposals", async () => {
		const user = userEvent.setup();
		const activeEvent = createEvent({ priority: "P2" });
		const p0Event = createEvent({
			id: "event-p0",
			title: "Release blocker",
			priority: "P0",
			updatedAt: "2026-05-21T00:30:00.000Z",
		});
		const proposal: DesktopEventManagementProposal = {
			id: "proposal-1",
			criteriaPath: "/Users/qiaochao/.skylark/events/EVENTS.md",
			createdAt: "2026-05-21T05:00:00.000Z",
			items: [
				{
					id: "item-1",
					eventId: "event-p0",
					priority: "P0",
					status: "ready",
					reason: "Blocks release.",
					commentBody: "Handle before other ready work.",
				},
				{
					id: "item-2",
					eventId: "event-1",
					status: "discarded",
					reason: "**Low value** now.",
					commentBody: "Discard because it no longer matches the event criteria.",
				},
			],
		};
		const onApplyEventManagementProposal = vi.fn(async () => []);
		const onClearEventManagementProposal = vi.fn();
		renderEventsPage({
			activeEvent,
			eventManagementProposal: proposal,
			events: [toSummary(activeEvent), toSummary(p0Event)],
			onApplyEventManagementProposal,
			onClearEventManagementProposal,
		});

		const readyColumn = document.querySelector("[data-event-status='ready']");
		if (!(readyColumn instanceof HTMLElement)) {
			throw new Error("Expected ready column.");
		}
		const readyCards = within(readyColumn).getAllByRole("button");
		expect(readyCards[0]?.textContent).toContain("Release blocker");
		expect(readyCards[0]?.textContent).toContain("P0");
		expect(readyCards[1]?.textContent).toContain("Implement event board");
		expect(readyCards[1]?.textContent).toContain("P2");

		const proposalPanel = screen.getByText("整理建议").closest("section");
		if (!(proposalPanel instanceof HTMLElement)) {
			throw new Error("Expected proposal panel.");
		}
		const checkboxes = within(proposalPanel).getAllByRole("checkbox");
		expect(checkboxes).toHaveLength(2);
		expect(checkboxes[0]).toHaveProperty("checked", true);
		expect(checkboxes[1]).toHaveProperty("checked", true);
		expect(proposalPanel.textContent).toContain("已丢弃");
		expect(proposalPanel.textContent).toContain("Low value");

		await user.click(checkboxes[1]!);
		await user.click(within(proposalPanel).getByRole("button", { name: "应用选中" }));

		expect(onApplyEventManagementProposal).toHaveBeenCalledWith({
			proposalId: "proposal-1",
			selectedItemIds: ["item-1"],
			items: proposal.items,
		});

		await user.click(within(proposalPanel).getByRole("button", { name: "取消" }));
		expect(onClearEventManagementProposal).toHaveBeenCalledTimes(1);
	});

	it("edits the event problem from the run section, runs an event, and opens session history", async () => {
		const user = userEvent.setup();
		const onUpdateEvent = vi.fn(async () => createEvent({ body: "Compact updated body." }));
		const onRunEvent = vi.fn(async () => undefined);
		const onOpenSession = vi.fn(async () => undefined);
		renderEventsPage({ onOpenSession, onRunEvent, onUpdateEvent, projects: [project, otherProject] });

		await user.click(screen.getByRole("button", { name: /Implement event board/i }));
		expect(screen.queryByRole("heading", { name: "内容" })).toBeNull();
		const runProblemInput = screen.getByLabelText("事件问题");
		expect(runProblemInput).toHaveProperty("value", "Build compact columns and run sessions.");
		expect(runProblemInput).not.toHaveProperty("value", expect.stringContaining("请先深入思考目标、约束和风险"));
		await user.clear(runProblemInput);
		await user.type(runProblemInput, "Compact updated body.");
		await user.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() => {
			expect(onUpdateEvent).toHaveBeenCalledWith("event-1", {
				body: "Compact updated body.",
			});
		});

		await user.selectOptions(screen.getByLabelText("选择运行项目"), otherProject.id);
		await user.click(screen.getByRole("button", { name: "运行事件" }));
		await waitFor(() => {
			expect(onRunEvent).toHaveBeenCalledWith({
				eventId: "event-1",
				projectId: "project-2",
				promptText: "Compact updated body.\n\n请先深入思考目标、约束和风险，再给出清晰的下一步行动。",
				attachmentIds: ["attachment-1"],
			});
		});

		const history = screen.getByText("历史").closest("section");
		if (!(history instanceof HTMLElement)) {
			throw new Error("Expected history section.");
		}
		await user.click(within(history).getByRole("button", { name: "打开 session" }));

		expect(onOpenSession).toHaveBeenCalledWith("session-1", "project-1");
	});

	it("builds event run prompts without duplicated event body or leading boilerplate", async () => {
		const user = userEvent.setup();
		const duplicatedEvent = createEvent({
			title: "Prepare release notes.",
			body: "Prepare release notes.",
			attachments: [],
			attachmentCount: 0,
		});
		const onRunEvent = vi.fn(async () => undefined);
		renderEventsPage({
			activeEvent: duplicatedEvent,
			activeEventId: duplicatedEvent.id,
			events: [toSummary(duplicatedEvent)],
			onRunEvent,
		});

		await user.click(screen.getByRole("button", { name: /Prepare release notes/i }));
		await user.click(screen.getByRole("button", { name: "运行事件" }));

		await waitFor(() => {
			expect(onRunEvent).toHaveBeenCalledWith({
				eventId: duplicatedEvent.id,
				projectId: "project-1",
				promptText: "Prepare release notes.\n\n请先深入思考目标、约束和风险，再给出清晰的下一步行动。",
				attachmentIds: [],
			});
		});
	});

	it("does not use the read-only event title as hidden run prompt content", async () => {
		const user = userEvent.setup();
		const titleOnlyEvent = createEvent({
			title: "Read-only event title",
			body: "",
			bodyPreview: "",
		});
		const onRunEvent = vi.fn(async () => undefined);
		renderEventsPage({
			activeEvent: titleOnlyEvent,
			activeEventId: titleOnlyEvent.id,
			events: [toSummary(titleOnlyEvent)],
			onRunEvent,
		});

		await user.click(screen.getByRole("button", { name: /Read-only event title/i }));
		expect(screen.getByLabelText("事件问题")).toHaveProperty("value", "");
		await user.click(screen.getByRole("button", { name: "运行事件" }));

		await waitFor(() => {
			expect(onRunEvent).toHaveBeenCalledWith({
				eventId: titleOnlyEvent.id,
				projectId: "project-1",
				promptText: "请先深入思考目标、约束和风险，再给出清晰的下一步行动。",
				attachmentIds: ["attachment-1"],
			});
		});
	});

	it("persists an unsaved event problem before running it", async () => {
		const user = userEvent.setup();
		const onUpdateEvent = vi.fn(async (_eventId: string, input: { body?: string }) =>
			createEvent({ body: input.body ?? "" }),
		);
		const onRunEvent = vi.fn(async () => undefined);
		renderEventsPage({ onRunEvent, onUpdateEvent });

		await user.click(screen.getByRole("button", { name: /Implement event board/i }));
		const runProblemInput = screen.getByLabelText("事件问题");
		await user.clear(runProblemInput);
		await user.type(runProblemInput, "Run this revised problem.");
		await user.click(screen.getByRole("button", { name: "运行事件" }));

		await waitFor(() => {
			expect(onUpdateEvent).toHaveBeenCalledWith("event-1", {
				body: "Run this revised problem.",
			});
			expect(onRunEvent).toHaveBeenCalledWith({
				eventId: "event-1",
				projectId: "project-1",
				promptText: "Run this revised problem.\n\n请先深入思考目标、约束和风险，再给出清晰的下一步行动。",
				attachmentIds: ["attachment-1"],
			});
		});
		expect(onUpdateEvent.mock.invocationCallOrder[0]).toBeLessThan(onRunEvent.mock.invocationCallOrder[0]!);
	});

	it("adds manual comments in the event drawer", async () => {
		const user = userEvent.setup();
		const activeEvent = createEvent({
			commentCount: 1,
			latestCommentAt: "2026-05-21T04:00:00.000Z",
			comments: [
				{
					id: "comment-1",
					author: "agent",
					body: "Prioritized by criteria.",
					createdAt: "2026-05-21T04:00:00.000Z",
					source: "management_proposal",
					proposalId: "proposal-1",
				},
			],
		});
		const onAddEventComment = vi.fn(async () => createEvent());
		renderEventsPage({
			activeEvent,
			events: [toSummary(activeEvent)],
			onAddEventComment,
		});

		await user.click(screen.getByRole("button", { name: /Implement event board/i }));

		expect(screen.getByText("Prioritized by criteria.")).toBeTruthy();
		await user.type(screen.getByLabelText("事件评论"), "I agree.");
		await user.click(screen.getByRole("button", { name: "添加评论" }));

		expect(onAddEventComment).toHaveBeenCalledWith({
			eventId: "event-1",
			body: "I agree.",
		});
	});

	it("keeps failed attachment snapshots visible in the event drawer", async () => {
		const user = userEvent.setup();
		const failedEvent = createEvent({
			attachments: [
				{
					id: "attachment-failed",
					name: "broken.docx",
					originalPath: "/workspace/broken.docx",
					storedPath: "/app/events/broken.docx",
					mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					size: 10,
					extractionError: "bad zip",
					createdAt: "2026-05-21T00:00:00.000Z",
				},
			],
		});
		renderEventsPage({
			activeEvent: failedEvent,
			events: [toSummary(failedEvent)],
		});

		await user.click(screen.getByRole("button", { name: /Implement event board/i }));

		expect(screen.getByText("bad zip")).toBeTruthy();
		const failedAttachmentCheckbox = screen.getByRole("checkbox");
		expect(failedAttachmentCheckbox).toHaveProperty("disabled", true);
	});
});
