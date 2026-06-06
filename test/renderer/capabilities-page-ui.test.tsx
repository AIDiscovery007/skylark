import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilitiesPage } from "../../src/renderer/components/capabilities/CapabilitiesPage.tsx";
import type { DesktopCapabilityCatalog, DesktopCapabilityDetail } from "../../src/shared/types.ts";

afterEach(() => {
	cleanup();
});

function createCatalog(): DesktopCapabilityCatalog {
	return {
		diagnostics: [],
		mcpServers: [
			{
				id: "server-1",
				name: "Fake MCP",
				command: "node",
				args: ["server.js"],
				env: {},
				enabled: false,
				status: "disabled",
				tools: [
					{
						name: "echo",
						adapterName: "mcp__server_1__echo",
						description: "Echo text",
						inputSchema: { type: "object" },
					},
				],
				updatedAt: "2026-04-30T00:00:00.000Z",
			},
		],
		prompts: [
			{
				name: "brief",
				description: "Create a brief",
				argumentHint: "[TEXT]",
				filePath: "/workspace/.pi/prompts/brief.md",
				source: { label: "project", scope: "project" },
			},
		],
		skills: [
			{
				name: "review",
				description: "Review changes",
				filePath: "/workspace/.pi/skills/review/SKILL.md",
				baseDir: "/workspace/.pi/skills/review",
				disableModelInvocation: false,
				source: { label: "project", scope: "project" },
			},
		],
		slashCommands: [],
	};
}

type CapabilitiesPageProps = ComponentProps<typeof CapabilitiesPage>;

function renderCapabilitiesPage(overrides: Partial<CapabilitiesPageProps> = {}) {
	const props: CapabilitiesPageProps = {
		catalog: createCatalog(),
		isLoading: false,
		isSaving: false,
		onCreateSkill: async () => undefined,
		onGetCapabilityDetail: async () => ({
			type: "skill",
			name: "empty",
			description: "Empty capability",
			body: "",
			filePath: "/workspace/.pi/skills/empty/SKILL.md",
			disableModelInvocation: false,
			source: { label: "project", scope: "project" },
		}),
		onReload: async () => undefined,
		onRestartMcpServer: async () => undefined,
		onSetMcpServerEnabled: async () => undefined,
		onTestMcpServer: async () => undefined,
		onUpsertMcpServer: async () => undefined,
		onUpsertPromptTemplate: async () => undefined,
		...overrides,
	};

	return render(<CapabilitiesPage {...props} />);
}

describe("CapabilitiesPage", () => {
	it("renders repository-style capability rows and MCP actions", async () => {
		const user = userEvent.setup();
		const onReload = vi.fn(async () => undefined);
		const onSetMcpServerEnabled = vi.fn(async () => undefined);
		const onTestMcpServer = vi.fn(async () => undefined);
		const onRestartMcpServer = vi.fn(async () => undefined);

		renderCapabilitiesPage({ onReload, onRestartMcpServer, onSetMcpServerEnabled, onTestMcpServer });

		expect(screen.getByText("Agent 能力库")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Back to chat" })).toBeNull();
		const workbench = document.querySelector("[data-slot='capabilities-workbench']");
		const header = document.querySelector("[data-slot='capabilities-panel-header']");
		const toolbar = document.querySelector("[data-slot='capabilities-toolbar']");
		const tabPanel = document.querySelector("[data-slot='capabilities-tab-panel']");

		expect(workbench?.className).toContain("grid h-full");
		expect(workbench?.className).not.toContain("rounded-[var(--radius-xl)]");
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
		expect(screen.getByText("Agent 能力库").closest("[data-slot='capabilities-panel-header']")).toBe(header);
		expect(header?.querySelector("[data-slot='workbench-page-header-title']")?.className).toContain(
			"text-[13px] font-medium",
		);
		expect(screen.getByText("1 MCP / 1 Skills / 1 Prompts")).toBeTruthy();
		const reloadButton = screen.getByRole("button", { name: "重新加载" });
		expect(reloadButton.getAttribute("data-slot")).toBe("icon-button");
		expect(reloadButton.className).not.toContain("border border-[color:var(--border-subtle)]");
		expect(reloadButton.querySelector("svg")?.getAttribute("class")).toContain("size-3.5");
		expect(screen.queryByText("重新加载")).toBeNull();
		await user.click(reloadButton);
		expect(onReload).toHaveBeenCalledTimes(1);
		expect(toolbar).toBeTruthy();
		expect(toolbar?.textContent).toContain("MCP");
		expect(toolbar?.textContent).toContain("Skills");
		expect(toolbar?.textContent).toContain("Prompts");
		expect(tabPanel).toBeTruthy();
		expect(screen.getByText("Fake MCP")).toBeTruthy();
		expect(screen.getByText("1 tools: echo")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: /启用/i }));
		await user.click(screen.getByRole("button", { name: /测试/i }));
		await user.click(screen.getByRole("button", { name: /重启/i }));

		expect(onSetMcpServerEnabled).toHaveBeenCalledWith("server-1", true);
		expect(onTestMcpServer).toHaveBeenCalledWith("server-1");
		expect(onRestartMcpServer).toHaveBeenCalledWith("server-1");
	});

	it("keeps the top header rows clear of collapsed sidebar titlebar controls", () => {
		renderCapabilitiesPage({ isSidebarCollapsed: true });

		const titlebarRow = document.querySelector("[data-slot='capabilities-titlebar-row']");
		const toolbar = document.querySelector("[data-slot='capabilities-toolbar']");
		const dragRegion = document.querySelector("[data-slot='workbench-page-header-drag-region']");
		const titleRegion = document.querySelector("[data-slot='workbench-page-header-title-region']");
		expect(titlebarRow?.getAttribute("data-titlebar-inset")).toBe("app-titlebar-controls");
		expect(toolbar?.getAttribute("data-titlebar-inset")).toBe("app-titlebar-controls");
		expect(dragRegion?.className).toContain("desktop-window-drag-region");
		expect(dragRegion?.className).toContain("left-[var(--desktop-titlebar-content-inset)]");
		expect(titleRegion?.getAttribute("data-titlebar-drag-region")).toBe("enabled");
		expect(titleRegion?.className).toContain("desktop-window-drag-region");
		expect((titlebarRow as HTMLElement | null)?.style.paddingLeft).toBe("var(--desktop-titlebar-content-inset)");
		expect((toolbar as HTMLElement | null)?.style.paddingLeft).toBe("var(--desktop-titlebar-content-inset)");
	});

	it("adds skills, prompt templates, and MCP servers from the modal", async () => {
		const user = userEvent.setup();
		const onCreateSkill = vi.fn(async () => undefined);
		const onUpsertPromptTemplate = vi.fn(async () => undefined);
		const onUpsertMcpServer = vi.fn(async () => undefined);

		renderCapabilitiesPage({ onCreateSkill, onUpsertMcpServer, onUpsertPromptTemplate });

		await user.click(screen.getByRole("button", { name: /^Skills/i }));
		await user.click(screen.getByRole("button", { name: /添加 skill/i }));
		await user.type(screen.getByLabelText("Skill name"), "reviewer");
		await user.type(screen.getByLabelText("Skill description"), "Review the current diff");
		await user.type(screen.getByLabelText("Skill body"), "Inspect changes before final response.");
		await user.click(screen.getByRole("button", { name: /^保存$/i }));

		await waitFor(() => {
			expect(onCreateSkill).toHaveBeenCalledWith({
				name: "reviewer",
				description: "Review the current diff",
				content: "Inspect changes before final response.",
				scope: "project",
				overwrite: true,
			});
		});

		await user.click(screen.getByRole("button", { name: /^Prompts/i }));
		await user.click(screen.getByRole("button", { name: /添加 prompt/i }));
		await user.type(screen.getByLabelText("Prompt template name"), "brief");
		await user.type(screen.getByLabelText("Prompt template description"), "Create a brief");
		await user.type(screen.getByLabelText("Prompt template argument hint"), "TEXT");
		await user.type(screen.getByLabelText("Prompt template body"), "Summarize $ARGUMENTS");
		await user.click(screen.getByRole("button", { name: /^保存$/i }));

		await waitFor(() => {
			expect(onUpsertPromptTemplate).toHaveBeenCalledWith({
				name: "brief",
				description: "Create a brief",
				argumentHint: "TEXT",
				content: "Summarize $ARGUMENTS",
				scope: "project",
				overwrite: true,
			});
		});

		await user.click(screen.getByRole("button", { name: /^MCP/i }));
		await user.click(screen.getByRole("button", { name: /添加 mcp/i }));
		await user.type(screen.getByLabelText("MCP server name"), "Filesystem");
		await user.type(screen.getByLabelText("MCP command"), "node");
		await user.type(screen.getByLabelText("MCP args"), "server.js --stdio");
		await user.type(screen.getByLabelText("MCP env"), "MODE=test");
		await user.click(screen.getByRole("checkbox", { name: /保存后连接/i }));
		await user.click(screen.getByRole("button", { name: /^保存$/i }));

		await waitFor(() => {
			expect(onUpsertMcpServer).toHaveBeenCalledWith({
				name: "Filesystem",
				command: "node",
				args: ["server.js", "--stdio"],
				cwd: undefined,
				env: { MODE: "test" },
				enabled: true,
				connectNow: true,
			});
		});
	});

	it("opens parsed skill details from a skill row", async () => {
		const user = userEvent.setup();
		const onGetCapabilityDetail = vi.fn(
			async (): Promise<DesktopCapabilityDetail> => ({
				type: "skill",
				name: "review",
				description: "Review changes",
				body: "Inspect the current diff and summarize risks.",
				filePath: "/workspace/.pi/skills/review/SKILL.md",
				disableModelInvocation: false,
				source: { label: "project", scope: "project", readOnly: false },
			}),
		);

		renderCapabilitiesPage({ onGetCapabilityDetail });

		await user.click(screen.getByRole("button", { name: /^Skills/i }));
		await user.click(screen.getByRole("button", { name: /review/i }));

		expect(await screen.findByRole("dialog", { name: /review/i })).toBeTruthy();
		expect(onGetCapabilityDetail).toHaveBeenCalledWith({
			type: "skill",
			filePath: "/workspace/.pi/skills/review/SKILL.md",
		});
		expect(screen.getByText("Inspect the current diff and summarize risks.")).toBeTruthy();
		expect(screen.getByText("/workspace/.pi/skills/review/SKILL.md")).toBeTruthy();
	});

	it("opens parsed prompt template details from a prompt row", async () => {
		const user = userEvent.setup();
		const onGetCapabilityDetail = vi.fn(
			async (): Promise<DesktopCapabilityDetail> => ({
				type: "prompt_template",
				name: "brief",
				description: "Create a brief",
				argumentHint: "[TEXT]",
				body: "Summarize $ARGUMENTS",
				filePath: "/workspace/.pi/prompts/brief.md",
				source: { label: "project", scope: "project", readOnly: false },
			}),
		);

		renderCapabilitiesPage({ onGetCapabilityDetail });

		await user.click(screen.getByRole("button", { name: /^Prompts/i }));
		await user.click(screen.getByRole("button", { name: /brief/i }));

		expect(await screen.findByRole("dialog", { name: /brief/i })).toBeTruthy();
		expect(onGetCapabilityDetail).toHaveBeenCalledWith({
			type: "prompt_template",
			filePath: "/workspace/.pi/prompts/brief.md",
		});
		expect(screen.getByText("Summarize $ARGUMENTS")).toBeTruthy();
		expect(screen.getAllByText("[TEXT]").length).toBeGreaterThan(0);
	});

	it("virtualizes high-volume skill lists", async () => {
		const user = userEvent.setup();
		const catalog = createCatalog();
		catalog.skills = Array.from({ length: 80 }, (_, index) => {
			const id = String(index).padStart(3, "0");
			return {
				name: `Skill ${id}`,
				description: `Review capability ${index}`,
				filePath: `/workspace/.pi/skills/skill-${id}/SKILL.md`,
				baseDir: `/workspace/.pi/skills/skill-${id}`,
				disableModelInvocation: false,
				source: { label: "project", scope: "project" as const },
			};
		});
		renderCapabilitiesPage({ catalog });

		await user.click(screen.getByRole("button", { name: /^Skills/i }));
		const skillsGrid = document.querySelector("[data-slot='capabilities-skills-virtual-grid']");
		if (!(skillsGrid instanceof HTMLElement)) {
			throw new Error("Expected virtualized skills grid.");
		}

		await waitFor(() => {
			expect(screen.getByText("Skill 000")).toBeTruthy();
		});
		expect(screen.queryByText("Skill 079")).toBeNull();
		expect(skillsGrid.querySelectorAll("[data-slot='virtual-stack-item']").length).toBeLessThan(
			catalog.skills.length / 2,
		);

		skillsGrid.scrollTop = 3_000;
		fireEvent.scroll(skillsGrid);

		await waitFor(() => {
			expect(screen.getByText("Skill 068")).toBeTruthy();
		});
	});
});
