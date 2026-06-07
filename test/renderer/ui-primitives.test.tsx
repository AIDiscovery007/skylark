import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { Search } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "../../src/renderer/components/ui/badge.tsx";
import { Button } from "../../src/renderer/components/ui/button.tsx";
import { EntityRow } from "../../src/renderer/components/ui/entity-row.tsx";
import { ErrorNotice } from "../../src/renderer/components/ui/error-notice.tsx";
import { IconButton } from "../../src/renderer/components/ui/icon-button.tsx";
import { Input } from "../../src/renderer/components/ui/input.tsx";
import { Select, SelectTrigger, SelectValue } from "../../src/renderer/components/ui/select.tsx";
import { Spinner } from "../../src/renderer/components/ui/spinner.tsx";
import { StatusDot } from "../../src/renderer/components/ui/status-dot.tsx";
import { Textarea } from "../../src/renderer/components/ui/textarea.tsx";
import {
	menuSurfaceTransition,
	motionDurations,
	panelSpring,
	reviewPanelTransition,
	sidebarContentTransition,
	sidebarWidthTransition,
} from "../../src/renderer/lib/motion.ts";

afterEach(() => {
	cleanup();
});

describe("UI primitives", () => {
	it("renders an accessible compact spinner", () => {
		render(<Spinner label="Loading session" />);

		const spinner = screen.getByRole("status", { name: "Loading session" });

		expect(spinner.getAttribute("data-slot")).toBe("spinner");
		expect(spinner.className).toContain("text-current");
		expect(spinner.className).toContain("size-4");
	});

	it("renders an accessible icon button with desktop sizing", () => {
		render(
			<IconButton aria-label="Search sessions">
				<Search />
			</IconButton>,
		);

		const button = screen.getByRole("button", { name: "Search sessions" });

		expect(button.getAttribute("data-slot")).toBe("icon-button");
		expect(button.className).toContain("size-8");
		expect(button.className).toContain("hover:bg-[color:var(--surface-2)]");
		expect(button.className).toContain("hover:shadow-[var(--shadow-minimal)]");
		expect(button.className).not.toContain("transform");
		expect(button.className).not.toContain("translate");
		expect(button.className).not.toContain("scale");
	});

	it("keeps dense buttons visually stable without positional press motion", () => {
		render(<Button>Run check</Button>);

		const button = screen.getByRole("button", { name: "Run check" });

		expect(button.className).toContain("duration-[var(--duration-fast)]");
		expect(button.className).not.toContain("transform");
		expect(button.className).not.toContain("translate");
		expect(button.className).not.toContain("scale");
	});

	it("keeps text editing controls selectable under native chrome selection policy", () => {
		render(
			<>
				<Input aria-label="Title" />
				<Textarea aria-label="Body" />
			</>,
		);

		expect(screen.getByLabelText("Title").className).toContain("select-text");
		expect(screen.getByLabelText("Body").className).toContain("select-text");
	});

	it("uses the shared lightweight focus shadow for editing controls", () => {
		render(
			<>
				<Input aria-label="Title" />
				<Textarea aria-label="Body" />
				<Select>
					<SelectTrigger aria-label="Priority">
						<SelectValue placeholder="Priority" />
					</SelectTrigger>
				</Select>
			</>,
		);

		for (const control of [
			screen.getByLabelText("Title"),
			screen.getByLabelText("Body"),
			screen.getByRole("combobox", { name: "Priority" }),
		]) {
			expect(control.className).toContain("focus-visible:shadow-[var(--control-focus-shadow)]");
			expect(control.className).not.toContain("focus-visible:ring-[3px]");
		}
	});

	it("renders low-saturation semantic badges", () => {
		render(<Badge variant="success">Connected</Badge>);

		const badge = screen.getByText("Connected");

		expect(badge.getAttribute("data-slot")).toBe("badge");
		expect(badge.getAttribute("data-variant")).toBe("success");
		expect(badge.className).toContain("var(--success)");
		expect(badge.className).not.toContain("text-white");
	});

	it("renders semantic status dots with a restrained running pulse", () => {
		render(<StatusDot label="Agent running" status="running" />);

		const dot = screen.getByLabelText("Agent running");

		expect(dot.getAttribute("data-slot")).toBe("status-dot");
		expect(dot.getAttribute("data-status")).toBe("running");
		expect(dot.className).toContain("motion-breathing-dot");
		expect(dot.className).toContain("var(--info)");
	});

	it("renders a reusable destructive-tint error notice", () => {
		render(
			<ErrorNotice
				actions={<button type="button">Retry</button>}
				description="Could not load the session."
				title="Session failed"
			/>,
		);

		const notice = screen.getByRole("alert");

		expect(notice.getAttribute("data-slot")).toBe("error-notice");
		expect(notice.className).toContain("var(--destructive)");
		expect(screen.getByText("Session failed")).toBeTruthy();
		expect(screen.getByText("Could not load the session.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});

	it("renders selectable entity rows without requiring a product-specific list", () => {
		render(
			<EntityRow
				icon={<Search aria-hidden="true" />}
				selected
				subtitle="Today"
				title="Debug session"
				trailing="3"
			/>,
		);

		const row = screen.getByRole("button", { name: /Debug session/ });

		expect(row.getAttribute("data-slot")).toBe("entity-row");
		expect(row.getAttribute("data-selected")).toBe("true");
		expect(row.className).toContain("before:bg-[color:var(--accent)]");
		expect(screen.getByText("Today")).toBeTruthy();
		expect(screen.getByText("3")).toBeTruthy();
	});

	it("renders action-safe entity rows without nesting interactive controls", () => {
		render(
			<EntityRow
				actions={<button type="button">Delete</button>}
				as="div"
				selected
				title={<button type="button">Open session</button>}
				trailing="now"
			/>,
		);

		const row = document.querySelector("[data-slot='entity-row']");

		expect(row?.tagName.toLowerCase()).toBe("div");
		expect(row?.getAttribute("data-selected")).toBe("true");
		expect(row?.className).toContain("before:bg-[color:var(--accent)]");
		expect(screen.getByRole("button", { name: "Open session" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
	});

	it("defines a global reduced-motion fallback for all animated surfaces", () => {
		const css = readFileSync("src/renderer/styles/globals.css", "utf8");

		expect(css).toContain("@media (prefers-reduced-motion: reduce)");
		expect(css).toContain("animation-duration: 0.001ms !important");
		expect(css).toContain("transition-duration: 0.001ms !important");
		expect(css).toContain("scroll-behavior: auto !important");
	});

	it("defines shared boundary state tokens and utilities", () => {
		const css = readFileSync("src/renderer/styles/globals.css", "utf8");

		expect(css).toContain("--boundary-state-max-width");
		expect(css).toContain("--boundary-state-min-height");
		expect(css).toContain(".boundary-state");
		expect(css).toContain(".boundary-state-loading");
		expect(css).toContain(".boundary-state-error");
	});

	it("exposes shared motion constants for stable workbench interactions", () => {
		expect(motionDurations.instant).toBe(0);
		expect(motionDurations.fast).toBe(0.12);
		expect(panelSpring).toMatchObject({ type: "spring", stiffness: 600, damping: 49 });
		expect(menuSurfaceTransition).toMatchObject({ duration: motionDurations.fast });
	});

	it("keeps structural motion coordinated without matching every duration", () => {
		expect(sidebarWidthTransition.ease).toBe(reviewPanelTransition.ease);
		expect(sidebarWidthTransition.duration).toBeLessThan(reviewPanelTransition.duration);
		expect(sidebarContentTransition.duration).toBeLessThan(sidebarWidthTransition.duration);
	});

	it("keeps structural drawer contracts motion-driven", () => {
		const appLayoutSource = readFileSync("src/renderer/components/layout/AppLayout.tsx", "utf8");
		const reviewPanelSource = readFileSync("src/renderer/components/review/ReviewWorkspacePanel.tsx", "utf8");
		const css = readFileSync("src/renderer/styles/globals.css", "utf8");

		expect(css).toContain("--duration-sidebar-drawer");
		expect(appLayoutSource).toContain('data-motion="structural-drawer"');
		expect(appLayoutSource).toContain("w-[var(--structural-drawer-size)]");
		expect(appLayoutSource).toMatch(/animate=\{\{\s*width:\s*resolvedSidebarWidth\s*\}\}/);
		expect(appLayoutSource).toContain('reducedMotion="never"');
		expect(appLayoutSource).not.toMatch(/style=\{\{\s*width:\s*resolvedSidebarWidth\s*\}\}/);
		expect(reviewPanelSource).toContain('data-slot="review-workspace-spacer"');
		expect(reviewPanelSource).toContain('data-slot="review-workspace-panel"');
		expect(reviewPanelSource).not.toContain("<Drawer");
	});

	it("keeps app titlebar chrome ownership explicit", () => {
		const css = readFileSync("src/renderer/styles/globals.css", "utf8");
		const appLayoutSource = readFileSync("src/renderer/components/layout/AppLayout.tsx", "utf8");
		const appSource = readFileSync("src/renderer/App.tsx", "utf8");
		const coordinationSource = readFileSync("src/renderer/lib/main-workbench-coordination.ts", "utf8");
		const pageHeaderSource = readFileSync("src/renderer/components/layout/WorkbenchPageHeader.tsx", "utf8");
		const capabilitiesSource = readFileSync("src/renderer/components/capabilities/CapabilitiesPage.tsx", "utf8");
		const eventsSource = readFileSync("src/renderer/components/events/EventsPage.tsx", "utf8");

		expect(css).toContain("--desktop-titlebar-controls-safe-width");
		expect(css).toContain("--desktop-titlebar-native-control-reserve: 5.75rem");
		expect(css).toContain("--desktop-titlebar-control-left: var(--desktop-titlebar-native-control-reserve)");
		expect(css).toContain("--desktop-titlebar-content-inset: calc(");
		expect(css).toContain("var(--desktop-titlebar-control-left) + var(--desktop-titlebar-controls-safe-width)");
		expect(css).toContain('[data-chrome-layer="app-titlebar"]');
		expect(css).toContain("-webkit-app-region: drag;\n\t\tpointer-events: auto;\n\t\tisolation: isolate;");
		expect(css).toContain('[data-chrome-layer="app-titlebar"] *');
		expect(css).toContain("pointer-events: auto");
		expect(appLayoutSource).toContain('data-slot="desktop-titlebar-native-drag-region"');
		expect(appLayoutSource).toContain('data-chrome-layer="app-titlebar"');
		expect(appLayoutSource).toContain('data-chrome-owner="app-layout"');
		expect(appLayoutSource).toContain("min-w-[var(--desktop-titlebar-controls-safe-width)]");
		expect(appLayoutSource).toContain('import { PanelLeft } from "lucide-react"');
		expect(appLayoutSource).toContain('<PanelLeft className="size-3.5 translate-y-px stroke-[1.75]" />');
		expect(appSource).toContain('<PencilLine className="size-3.5 translate-y-px stroke-[1.75]" />');
		expect(appLayoutSource).not.toContain("PanelLeftClose");
		expect(appLayoutSource).not.toContain("PanelLeftOpen");
		expect(appLayoutSource).not.toContain("desktop-window-no-drag pointer-events-auto absolute");
		expect(appSource).toContain('data-chrome-content="review-fullscreen-summary"');
		expect(appSource).toContain("isReviewTitlebarSummaryVisible(isSidebarCollapsed)");
		expect(coordinationSource).toContain("function getWorkbenchViewClass(isActive: boolean): string");
		expect(coordinationSource).toContain('"invisible z-0 pointer-events-none opacity-0"');
		expect(appSource).toContain("getWorkbenchViewClass(isChatView)");
		expect(appSource).toContain("getWorkbenchViewClass(isCapabilitiesView)");
		expect(appSource).toContain("getWorkbenchViewClass(isEventsView)");
		expect(pageHeaderSource).toContain('type WorkbenchPageHeaderTitlebarInset = "none" | "app-titlebar-controls"');
		expect(pageHeaderSource).toContain("const titlebarDragRegion = !embedded");
		expect(pageHeaderSource).toContain('data-slot="workbench-page-header-drag-region"');
		expect(pageHeaderSource).toContain(
			'return inset === "app-titlebar-controls" ? "left-[var(--desktop-titlebar-content-inset)]" : "left-0"',
		);
		expect(pageHeaderSource).toContain("data-titlebar-drag-region={");
		expect(pageHeaderSource).toContain("data-titlebar-inset={titlebarInsetAttribute}");
		expect(pageHeaderSource).not.toContain("titlebarSafeInset");
		expect(capabilitiesSource).toContain("titlebarInset={titlebarInset}");
		expect(eventsSource).toContain('titlebarInset={isSidebarCollapsed ? "app-titlebar-controls" : "none"}');
		expect(capabilitiesSource).not.toContain("desktop-titlebar-content-inset");
		expect(eventsSource).not.toContain("desktop-titlebar-content-inset");
	});

	it("keeps desktop drag regions out of interactive chrome controls", () => {
		const sources = [
			readFileSync("src/renderer/components/sidebar/Sidebar.tsx", "utf8"),
			readFileSync("src/renderer/components/settings/SettingsPage.tsx", "utf8"),
			readFileSync("src/renderer/components/layout/WorkbenchHeader.tsx", "utf8"),
			readFileSync("src/renderer/components/layout/WorkbenchPageHeader.tsx", "utf8"),
			readFileSync("src/renderer/components/review/ReviewWorkspacePanel.tsx", "utf8"),
		];
		const combinedSource = sources.join("\n");
		const reviewPanelSource = sources[4] ?? "";

		expect(combinedSource.match(/desktop-window-drag-region/g) ?? []).toHaveLength(9);
		expect(combinedSource).toContain('data-slot="sidebar-titlebar-drag-region"');
		expect(combinedSource).toContain('data-slot="desktop-settings-titlebar-drag-region"');
		expect(combinedSource).toContain('data-slot="workbench-page-header-drag-region"');
		expect(combinedSource).toContain('className="workbench-header relative');
		expect(combinedSource).not.toContain('className="workbench-header desktop-window-drag-region');
		expect(combinedSource).toContain('data-slot="workbench-header-drag-region"');
		expect(combinedSource).toContain("workbench-header-drag-region");
		expect(combinedSource).toContain(
			'className="desktop-window-drag-region relative z-10 flex h-full shrink-0 items-center justify-end gap-2"',
		);
		expect(combinedSource).toContain('data-slot="review-workspace-header"');
		expect(combinedSource).toContain(
			'className="desktop-window-drag-region flex h-full shrink-0 items-center gap-1"',
		);
		expect(combinedSource).toContain('data-slot="workbench-header-title-region"');
		expect(combinedSource).toContain('data-slot="workbench-page-header-title-region"');
		expect(combinedSource).toContain('data-slot="review-workspace-tab-strip"');
		expect(combinedSource).not.toContain('data-slot="review-workspace-title-text-region"');
		expect(combinedSource).not.toContain('data-slot="review-workspace-title-block"');
		expect(reviewPanelSource).toContain('className="desktop-window-no-drag flex h-full');
		expect(reviewPanelSource).toContain('className="desktop-window-no-drag"');
		expect(combinedSource).toContain(
			'className="desktop-window-no-drag relative z-10 flex min-w-0 items-center justify-end gap-2 justify-self-end"',
		);
		expect(combinedSource).not.toContain("desktop-window-no-drag flex shrink-0 items-center justify-end gap-2");
		expect(combinedSource).not.toContain("desktop-window-no-drag flex shrink-0 items-center gap-1");
	});

	it("keeps popover, select, and tooltip surfaces free of heavy zoom or slide motion", () => {
		const sourceFiles = [
			"src/renderer/components/ui/popover.tsx",
			"src/renderer/components/ui/select.tsx",
			"src/renderer/components/ui/tooltip.tsx",
		].map((path) => readFileSync(path, "utf8"));

		for (const source of sourceFiles) {
			expect(source).not.toContain("zoom-in");
			expect(source).not.toContain("zoom-out");
			expect(source).not.toContain("slide-in");
			expect(source).not.toContain("slide-out");
		}
	});

	it("keeps dense workbench controls free of positional hover or press motion", () => {
		const denseInteractionSources = [
			"src/renderer/components/ui/button.tsx",
			"src/renderer/components/ui/icon-button.tsx",
			"src/renderer/components/sidebar/Sidebar.tsx",
			"src/renderer/components/sidebar/SessionList.tsx",
			"src/renderer/components/chat/InlineToolRail.tsx",
		].map((path) => readFileSync(path, "utf8"));

		for (const source of denseInteractionSources) {
			expect(source).not.toMatch(/hover:translate|active:translate|hover:scale|active:scale/);
			expect(source).not.toMatch(/transition-\[[^\]]*transform/);
		}
	});
});
