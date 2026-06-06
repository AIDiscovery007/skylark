import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralSettings } from "../../src/renderer/components/settings/GeneralSettings.tsx";
import { PermissionSettings } from "../../src/renderer/components/settings/PermissionSettings.tsx";
import { SettingsPage } from "../../src/renderer/components/settings/SettingsPage.tsx";
import {
	DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
	DEFAULT_DESKTOP_COMPACT_INSTRUCTION,
	DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
} from "../../src/shared/types.ts";

afterEach(() => {
	cleanup();
});

type SettingsPageProps = ComponentProps<typeof SettingsPage>;

function renderSettingsPage(overrides: Partial<SettingsPageProps> = {}) {
	const props: SettingsPageProps = {
		errorMessage: undefined,
		isLoading: false,
		isSaving: false,
		onBack: () => undefined,
		onCancelOAuthLogin: async () => undefined,
		onDeleteProviderKey: async () => undefined,
		onLogoutOAuthProvider: async () => undefined,
		onSaveAppearanceSettings: async () => undefined,
		onSaveEventManagementCriteria: async () => undefined,
		onSaveGeneralSettings: async () => undefined,
		onSavePermissionApprovalSettings: async () => undefined,
		onSaveProviderKey: async () => undefined,
		onStartOAuthLogin: async () => undefined,
		onSubmitOAuthLoginCode: async () => undefined,
		onTestProviderKey: async (provider) => ({ provider, ok: true, message: "连接正常" }),
		oauthLogin: { isSigningIn: false },
		oauthProviders: [
			{
				id: "anthropic",
				name: "Anthropic",
				configured: false,
				source: "shared-auth",
				usesCallbackServer: true,
			},
			{
				id: "github-copilot",
				name: "GitHub Copilot",
				configured: false,
				source: "shared-auth",
				usesCallbackServer: false,
			},
			{
				id: "openai-codex",
				name: "OpenAI Codex",
				configured: false,
				source: "shared-auth",
				usesCallbackServer: true,
			},
		],
		providerKeys: [],
		runtimeCatalog: {
			defaultTools: ["read", "bash"],
			providers: [
				{
					id: "anthropic",
					name: "Anthropic",
					configured: false,
					authMethods: ["oauth" as const, "api_key" as const],
					models: [{ id: "claude-sonnet", name: "Claude Sonnet", reasoning: true, contextWindow: 200000 }],
				},
				{
					id: "github-copilot",
					name: "GitHub Copilot",
					configured: false,
					authMethods: ["oauth" as const],
					models: [{ id: "gpt-4o", name: "GPT-4o", reasoning: false, contextWindow: 128000 }],
				},
				{
					id: "openai",
					name: "OpenAI",
					configured: false,
					authMethods: ["api_key" as const],
					models: [{ id: "gpt-5.5", name: "GPT-5.5", reasoning: true, contextWindow: 400000 }],
				},
				{
					id: "openai-codex",
					name: "OpenAI Codex",
					configured: false,
					authMethods: ["oauth" as const],
					models: [{ id: "gpt-5.5", name: "GPT-5.5", reasoning: true, contextWindow: 400000 }],
				},
			],
		},
		eventManagementCriteria: {
			path: "/Users/qiaochao/.skylark/events/EVENTS.md",
			content: "Use P0 for blockers.",
		},
		settings: {},
		storageSecurityState: {
			providerKeysEncrypted: true,
			secureStorageAvailable: true,
		},
		...overrides,
	};

	return render(<SettingsPage {...props} />);
}

describe("Settings workbench UI", () => {
	it("renders a standalone settings shell without the capabilities section", () => {
		const { container } = renderSettingsPage();
		const shell = container.querySelector("[data-slot='desktop-settings-shell']");
		const sidebar = screen.getByLabelText("设置导航");

		expect(shell).toBeTruthy();
		expect(shell?.className).toContain("relative");
		expect(sidebar.className).toContain("pt-[var(--desktop-titlebar-safe-area)]");
		expect(container.querySelector("[data-slot='desktop-settings-titlebar-drag-region']")).toBeTruthy();
		expect(screen.getAllByRole("button", { name: /返回应用/ }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("button", { name: "外观" }).length).toBeGreaterThan(0);
		expect(screen.queryByRole("button", { name: "能力库" })).toBeNull();
		expect(screen.queryByText("Agent 能力库")).toBeNull();
	});

	it("opens directly to credentials and focuses the requested provider", () => {
		const onStartOAuthLogin = vi.fn(async () => undefined);
		const onSaveProviderKey = vi.fn(async () => undefined);
		const { container } = renderSettingsPage({
			onSaveProviderKey,
			onStartOAuthLogin,
			settingsOpenRequest: { section: "credentials", providerId: "openai" },
		});

		expect(
			screen
				.getAllByRole("button", { name: "凭据" })
				.some((button) => button.getAttribute("aria-current") === "page"),
		).toBe(true);
		expect(screen.getByRole("heading", { name: "凭据" })).toBeTruthy();
		const focusedProvider = container.querySelector("[data-focused-credential-provider='openai']");
		expect(focusedProvider).toBeTruthy();
		expect(within(focusedProvider as HTMLElement).getByRole("button", { name: /配置 key/i })).toBeTruthy();
		expect(onStartOAuthLogin).not.toHaveBeenCalled();
		expect(onSaveProviderKey).not.toHaveBeenCalled();
	});

	it("auto-saves appearance settings after editing the light theme accent", async () => {
		const user = userEvent.setup();
		const onSaveAppearanceSettings = vi.fn(async () => undefined);

		renderSettingsPage({ onSaveAppearanceSettings });

		await user.click(screen.getAllByRole("button", { name: "外观" })[0]);
		expect(screen.queryByRole("button", { name: /保存更改/i })).toBeNull();

		const accentInput = screen.getByRole("textbox", { name: "浅色主题强调色" });
		await user.clear(accentInput);
		await user.type(accentInput, "#526FFF");

		await waitFor(() => {
			expect(onSaveAppearanceSettings).toHaveBeenCalledWith({
				...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
				lightTheme: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme,
					accentColor: "#526fff",
				},
			});
		});
	});

	it("applies a Color Hunt appearance preset before saving", async () => {
		const user = userEvent.setup();
		const onSaveAppearanceSettings = vi.fn(async () => undefined);

		renderSettingsPage({ onSaveAppearanceSettings });

		await user.click(screen.getAllByRole("button", { name: "外观" })[0]);
		expect(screen.queryByRole("button", { name: /保存更改/i })).toBeNull();
		expect(screen.getAllByRole("button", { name: /应用 Color Hunt 配色/ })).toHaveLength(10);

		await user.click(screen.getByRole("button", { name: "应用 Color Hunt 配色 01" }));

		await waitFor(() => {
			expect(onSaveAppearanceSettings).toHaveBeenCalledWith({
				...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
				lightTheme: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme,
					accentColor: "#c9b59c",
					backgroundColor: "#f9f8f6",
					foregroundColor: "#3d342d",
					contrast: 50,
				},
				darkTheme: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme,
					accentColor: "#d9cfc7",
					backgroundColor: "#2f2924",
					foregroundColor: "#f9f8f6",
					contrast: 58,
				},
			});
		});
	});

	it("auto-saves global appearance font sizes without letting presets overwrite them", async () => {
		const user = userEvent.setup();
		const onSaveAppearanceSettings = vi.fn(async () => undefined);
		const appearance = {
			...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
			uiFontSize: 14,
			codeFontSize: 15,
		};

		renderSettingsPage({
			onSaveAppearanceSettings,
			settings: { appearance },
		});

		await user.click(screen.getAllByRole("button", { name: "外观" })[0]);

		const uiFontSizeInput = screen.getByRole("spinbutton", { name: "UI 字号" }) as HTMLInputElement;
		const codeFontSizeInput = screen.getByRole("spinbutton", { name: "代码字体大小" }) as HTMLInputElement;
		expect(uiFontSizeInput.value).toBe("14");
		expect(codeFontSizeInput.value).toBe("15");

		fireEvent.change(uiFontSizeInput, { target: { value: "16" } });

		await waitFor(() => {
			expect(onSaveAppearanceSettings).toHaveBeenCalledWith({
				...appearance,
				uiFontSize: 16,
			});
		});

		await user.click(screen.getByRole("button", { name: "应用 Color Hunt 配色 01" }));

		await waitFor(() => {
			expect(onSaveAppearanceSettings).toHaveBeenCalledWith(
				expect.objectContaining({
					uiFontSize: 16,
					codeFontSize: 15,
					lightTheme: expect.objectContaining({
						accentColor: "#c9b59c",
					}),
				}),
			);
		});
	});

	it("auto-saves general settings after toggling thinking visibility without touching instruction resources", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn(async () => undefined);

		render(
			<GeneralSettings
				isLoading={false}
				isSaving={false}
				eventManagementCriteria={{
					path: "/Users/qiaochao/.skylark/events/EVENTS.md",
					content: "Use P0 for blockers.",
				}}
				onSave={onSave}
				onSaveEventManagementCriteria={async () => undefined}
				runtimeCatalog={{
					defaultTools: ["read", "bash"],
					providers: [
						{
							id: "anthropic",
							name: "Anthropic",
							configured: true,
							authMethods: ["api_key" as const],
							models: [{ id: "claude-sonnet", name: "Claude Sonnet", reasoning: true, contextWindow: 200000 }],
						},
					],
				}}
				settings={{
					defaultProvider: "anthropic",
					defaultModel: "claude-sonnet",
					defaultThinkingLevel: "off",
					showThinkingBlocks: false,
				}}
			/>,
		);

		await user.click(screen.getByRole("switch", { name: /显示推理内容/i }));

		await waitFor(() => {
			expect(onSave).toHaveBeenCalledWith({
				defaultModel: "claude-sonnet",
				defaultProvider: "anthropic",
				defaultThinkingLevel: "off",
				showThinkingBlocks: true,
			});
		});
	});

	it("saves a custom compact instruction from general settings", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn(async () => undefined);

		render(
			<GeneralSettings
				isLoading={false}
				isSaving={false}
				eventManagementCriteria={{
					path: "/Users/qiaochao/.skylark/events/EVENTS.md",
					content: "Use P0 for blockers.",
				}}
				onSave={onSave}
				onSaveEventManagementCriteria={async () => undefined}
				runtimeCatalog={{ defaultTools: ["read", "bash"], providers: [] }}
				settings={{}}
			/>,
		);

		const textarea = screen.getByRole("textbox", { name: "Compact 指令" }) as HTMLTextAreaElement;
		expect(textarea.value).toBe(DEFAULT_DESKTOP_COMPACT_INSTRUCTION);

		await user.clear(textarea);
		await user.type(textarea, "Keep the implementation status and pending checks.");
		expect(onSave).not.toHaveBeenCalled();
		const compactRow = textarea.closest("[data-settings-row-layout='stacked']");
		expect(compactRow).not.toBeNull();
		await user.click(within(compactRow as HTMLElement).getByRole("button", { name: "保存" }));

		await waitFor(() => {
			expect(onSave).toHaveBeenCalledWith({
				compactInstruction: "Keep the implementation status and pending checks.",
			});
		});
	});

	it("saves a global AGENTS.md instruction from general settings", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn(async () => undefined);

		render(
			<GeneralSettings
				isLoading={false}
				isSaving={false}
				eventManagementCriteria={{
					path: "/Users/qiaochao/.skylark/events/EVENTS.md",
					content: "Use P0 for blockers.",
				}}
				onSave={onSave}
				onSaveEventManagementCriteria={async () => undefined}
				runtimeCatalog={{ defaultTools: ["read", "bash"], providers: [] }}
				settings={{}}
			/>,
		);

		const textarea = screen.getByRole("textbox", { name: "全局 AGENTS.md 指令" }) as HTMLTextAreaElement;
		expect(textarea.value).toBe("");

		await user.type(textarea, "Always keep responses concise.");
		expect(onSave).not.toHaveBeenCalled();
		const globalAgentsRow = textarea.closest("[data-settings-row-layout='stacked']");
		expect(globalAgentsRow).not.toBeNull();
		await user.click(within(globalAgentsRow as HTMLElement).getByRole("button", { name: "保存" }));

		await waitFor(() => {
			expect(onSave).toHaveBeenCalledWith({
				globalAgentsInstruction: "Always keep responses concise.",
			});
		});
	});

	it("gives the compact instruction input its own stacked settings row", () => {
		render(
			<GeneralSettings
				isLoading={false}
				isSaving={false}
				eventManagementCriteria={{
					path: "/Users/qiaochao/.skylark/events/EVENTS.md",
					content: "Use P0 for blockers.",
				}}
				onSave={async () => undefined}
				onSaveEventManagementCriteria={async () => undefined}
				runtimeCatalog={{ defaultTools: ["read", "bash"], providers: [] }}
				settings={{}}
			/>,
		);

		const textarea = screen.getByRole("textbox", { name: "Compact 指令" });
		expect(textarea.closest("[data-settings-row-layout='stacked']")).toBeTruthy();
	});

	it("uses fixed scrollable viewports for instruction textareas", () => {
		render(
			<GeneralSettings
				isLoading={false}
				isSaving={false}
				eventManagementCriteria={{
					path: "/Users/qiaochao/.skylark/events/EVENTS.md",
					content: "Use P0 for blockers.",
				}}
				onSave={async () => undefined}
				onSaveEventManagementCriteria={async () => undefined}
				runtimeCatalog={{ defaultTools: ["read", "bash"], providers: [] }}
				settings={{}}
			/>,
		);

		const compactTextarea = screen.getByRole("textbox", { name: "Compact 指令" });
		const globalAgentsTextarea = screen.getByRole("textbox", { name: "全局 AGENTS.md 指令" });
		const eventCriteriaTextarea = screen.getByRole("textbox", { name: "事件 EVENTS.md 准则" });

		for (const textarea of [compactTextarea, globalAgentsTextarea, eventCriteriaTextarea]) {
			expect(textarea.className).toContain("uix-flat-field");
			expect(textarea.className).toContain("field-sizing-fixed");
			expect(textarea.className).toContain("overflow-y-auto");
			expect(textarea.className).toContain("resize-none");
		}
		expect(compactTextarea.className).toContain("h-32");
		expect(globalAgentsTextarea.className).toContain("h-72");
		expect(eventCriteriaTextarea.className).toContain("h-48");
	});

	it("saves event EVENTS.md criteria from general settings", async () => {
		const user = userEvent.setup();
		const onSaveEventManagementCriteria = vi.fn(async (request: { content: string }) => ({
			path: "/Users/qiaochao/.skylark/events/EVENTS.md",
			content: request.content,
		}));

		render(
			<GeneralSettings
				isLoading={false}
				isSaving={false}
				eventManagementCriteria={{
					path: "/Users/qiaochao/.skylark/events/EVENTS.md",
					content: "Use P0 for blockers.",
				}}
				onSave={async () => undefined}
				onSaveEventManagementCriteria={onSaveEventManagementCriteria}
				runtimeCatalog={{ defaultTools: ["read", "bash"], providers: [] }}
				settings={{}}
			/>,
		);

		const textarea = screen.getByRole("textbox", { name: "事件 EVENTS.md 准则" }) as HTMLTextAreaElement;
		expect(textarea.value).toBe("Use P0 for blockers.");

		await user.clear(textarea);
		await user.type(textarea, "Discard low-value stale events.");
		expect(onSaveEventManagementCriteria).not.toHaveBeenCalled();
		const criteriaRow = textarea.closest("[data-settings-row-layout='stacked']");
		expect(criteriaRow).not.toBeNull();
		await user.click(within(criteriaRow as HTMLElement).getByRole("button", { name: "保存" }));

		await waitFor(() => {
			expect(onSaveEventManagementCriteria).toHaveBeenCalledWith({
				content: "Discard low-value stale events.",
			});
		});
	});

	it("restores instruction textareas from persisted settings after a settings detail reload", async () => {
		const user = userEvent.setup();
		const persistedGlobalAgentsInstruction = "Always keep responses concise.";
		const persistedEventManagementCriteria = "Use P0 for blockers.";
		const props: ComponentProps<typeof GeneralSettings> = {
			isLoading: false,
			isSaving: false,
			eventManagementCriteria: {
				path: "/Users/qiaochao/.skylark/events/EVENTS.md",
				content: persistedEventManagementCriteria,
			},
			onSave: async () => undefined,
			onSaveEventManagementCriteria: async () => undefined,
			runtimeCatalog: { defaultTools: ["read", "bash"], providers: [] },
			settings: {
				globalAgentsInstruction: persistedGlobalAgentsInstruction,
			},
		};

		const { rerender } = render(<GeneralSettings {...props} />);

		const globalAgentsTextarea = screen.getByRole("textbox", {
			name: "全局 AGENTS.md 指令",
		}) as HTMLTextAreaElement;
		const eventCriteriaTextarea = screen.getByRole("textbox", {
			name: "事件 EVENTS.md 准则",
		}) as HTMLTextAreaElement;

		expect(globalAgentsTextarea.value).toBe(persistedGlobalAgentsInstruction);
		expect(eventCriteriaTextarea.value).toBe(persistedEventManagementCriteria);

		await user.clear(globalAgentsTextarea);
		await user.clear(eventCriteriaTextarea);

		expect(globalAgentsTextarea.value).toBe("");
		expect(eventCriteriaTextarea.value).toBe("");

		rerender(<GeneralSettings {...props} isLoading={true} />);
		rerender(<GeneralSettings {...props} isLoading={false} />);

		expect((screen.getByRole("textbox", { name: "全局 AGENTS.md 指令" }) as HTMLTextAreaElement).value).toBe(
			persistedGlobalAgentsInstruction,
		);
		expect((screen.getByRole("textbox", { name: "事件 EVENTS.md 准则" }) as HTMLTextAreaElement).value).toBe(
			persistedEventManagementCriteria,
		);
	});

	it("auto-saves permission approval settings after toggling terminal approval", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn(async () => undefined);

		render(
			<PermissionSettings
				isLoading={false}
				isSaving={false}
				onSave={onSave}
				settings={{ permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS }}
			/>,
		);

		await user.click(screen.getByRole("switch", { name: /终端启动/i }));
		expect(screen.queryByRole("button", { name: /保存更改/i })).toBeNull();

		await waitFor(() => {
			expect(onSave).toHaveBeenCalledWith({
				...DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
				terminal: false,
			});
		});
	});

	it("switches to credentials tab and shows subscription and API key provider groups", async () => {
		const user = userEvent.setup();

		renderSettingsPage();

		await user.click(screen.getAllByRole("button", { name: "凭据" })[0]);

		expect(screen.getByText("订阅账号")).toBeTruthy();
		expect(screen.getByText("Provider API keys")).toBeTruthy();
		expect(screen.getAllByText("Anthropic").length).toBeGreaterThan(0);
		expect(screen.getByText("GitHub Copilot")).toBeTruthy();
		expect(screen.getByText("OpenAI Codex")).toBeTruthy();
		expect(screen.getByText("OpenAI")).toBeTruthy();
		expect(screen.getByText("anthropic")).toBeTruthy();
		expect(screen.getByText("openai")).toBeTruthy();
	});

	it("expands a runtime provider row to save and remove a provider key", async () => {
		const user = userEvent.setup();
		const onSaveProviderKey = vi.fn(async () => undefined);
		const onDeleteProviderKey = vi.fn(async () => undefined);

		renderSettingsPage({
			onDeleteProviderKey,
			onSaveProviderKey,
			providerKeys: [{ provider: "anthropic", configured: true }],
		});

		await user.click(screen.getAllByRole("button", { name: "凭据" })[0]);
		const anthropicRow = screen.getByText("anthropic").closest("[data-settings-row-layout]");
		expect(anthropicRow).not.toBeNull();
		await user.click(within(anthropicRow as HTMLElement).getByRole("button", { name: /更新 key/i }));
		await user.type(screen.getByLabelText("Anthropic API key"), "sk-test");
		await user.click(within(anthropicRow as HTMLElement).getByRole("button", { name: /保存 key/i }));

		await waitFor(() => {
			expect(onSaveProviderKey).toHaveBeenCalledWith("anthropic", "sk-test");
		});

		await user.click(within(anthropicRow as HTMLElement).getByRole("button", { name: /移除/i }));

		await waitFor(() => {
			expect(onDeleteProviderKey).toHaveBeenCalledWith("anthropic");
		});
	});

	it("tests a saved runtime provider key connection", async () => {
		const user = userEvent.setup();
		const onTestProviderKey = vi.fn(async (provider: string) => ({
			provider,
			ok: true as const,
			message: "连接正常",
		}));

		renderSettingsPage({
			onTestProviderKey,
			providerKeys: [{ provider: "anthropic", configured: true }],
		});

		await user.click(screen.getAllByRole("button", { name: "凭据" })[0]);
		const anthropicRow = screen.getByText("anthropic").closest("[data-settings-row-layout]");
		expect(anthropicRow).not.toBeNull();
		await user.click(within(anthropicRow as HTMLElement).getByRole("button", { name: /测试连接/i }));

		await waitFor(() => {
			expect(onTestProviderKey).toHaveBeenCalledWith("anthropic");
			expect(screen.getByText("连接正常")).toBeTruthy();
		});
	});

	it("keeps a folded custom provider key entry", async () => {
		const user = userEvent.setup();
		const onSaveProviderKey = vi.fn(async () => undefined);

		renderSettingsPage({ onSaveProviderKey });

		await user.click(screen.getAllByRole("button", { name: "凭据" })[0]);
		await user.click(screen.getByRole("button", { name: /自定义 provider/i }));
		await user.type(screen.getByLabelText("自定义 Provider"), "custom-provider");
		await user.type(screen.getByLabelText("自定义 API key"), "sk-custom");
		await user.click(screen.getByRole("button", { name: /保存自定义 key/i }));

		await waitFor(() => {
			expect(onSaveProviderKey).toHaveBeenCalledWith("custom-provider", "sk-custom");
		});
	});

	it("starts subscription logins for GitHub Copilot and Codex", async () => {
		const user = userEvent.setup();
		const onStartOAuthLogin = vi.fn(async () => undefined);

		renderSettingsPage({ onStartOAuthLogin });

		await user.click(screen.getAllByRole("button", { name: "凭据" })[0]);
		const copilotRow = screen.getByText("GitHub Copilot").closest("[data-settings-row-layout]");
		const codexRow = screen.getByText("OpenAI Codex").closest("[data-settings-row-layout]");
		expect(copilotRow).not.toBeNull();
		expect(codexRow).not.toBeNull();
		await user.click(within(copilotRow as HTMLElement).getByRole("button", { name: /^登录$/i }));
		await user.click(within(codexRow as HTMLElement).getByRole("button", { name: /^登录$/i }));

		await waitFor(() => {
			expect(onStartOAuthLogin).toHaveBeenCalledWith("github-copilot");
			expect(onStartOAuthLogin).toHaveBeenCalledWith("openai-codex");
		});
	});

	it("submits a pasted Codex redirect URL", async () => {
		const user = userEvent.setup();
		const onStartOAuthLogin = vi.fn(async () => undefined);
		const onSubmitOAuthLoginCode = vi.fn(async () => undefined);

		const { rerender } = renderSettingsPage({ onStartOAuthLogin, onSubmitOAuthLoginCode });

		await user.click(screen.getAllByRole("button", { name: "凭据" })[0]);
		const codexRow = screen.getByText("OpenAI Codex").closest("[data-settings-row-layout]");
		expect(codexRow).not.toBeNull();
		await user.click(within(codexRow as HTMLElement).getByRole("button", { name: /^登录$/i }));

		await waitFor(() => {
			expect(onStartOAuthLogin).toHaveBeenCalledWith("openai-codex");
		});

		rerender(
			<SettingsPage
				errorMessage={undefined}
				isLoading={false}
				isSaving={false}
				onBack={() => undefined}
				onCancelOAuthLogin={async () => undefined}
				onDeleteProviderKey={async () => undefined}
				onLogoutOAuthProvider={async () => undefined}
				onSaveAppearanceSettings={async () => undefined}
				onSaveEventManagementCriteria={async () => undefined}
				onSaveGeneralSettings={async () => undefined}
				onSavePermissionApprovalSettings={async () => undefined}
				onSaveProviderKey={async () => undefined}
				onStartOAuthLogin={onStartOAuthLogin}
				onSubmitOAuthLoginCode={onSubmitOAuthLoginCode}
				onTestProviderKey={async (provider) => ({ provider, ok: true, message: "连接正常" })}
				oauthLogin={{
					provider: "openai-codex",
					isSigningIn: true,
					manualPrompt: "Paste redirect URL below, or complete login in browser:",
				}}
				oauthProviders={[
					{
						id: "anthropic",
						name: "Anthropic",
						configured: false,
						source: "shared-auth",
						usesCallbackServer: true,
					},
					{
						id: "github-copilot",
						name: "GitHub Copilot",
						configured: false,
						source: "shared-auth",
						usesCallbackServer: false,
					},
					{
						id: "openai-codex",
						name: "OpenAI Codex",
						configured: false,
						source: "shared-auth",
						usesCallbackServer: true,
					},
				]}
				providerKeys={[]}
				runtimeCatalog={{
					defaultTools: ["read", "bash"],
					providers: [
						{
							id: "openai-codex",
							name: "OpenAI Codex",
							configured: false,
							authMethods: ["oauth" as const],
							models: [{ id: "gpt-5.5", name: "GPT-5.5", reasoning: true, contextWindow: 400000 }],
						},
					],
				}}
				eventManagementCriteria={{
					path: "/Users/qiaochao/.skylark/events/EVENTS.md",
					content: "Use P0 for blockers.",
				}}
				settings={{}}
				storageSecurityState={{ providerKeysEncrypted: true, secureStorageAvailable: true }}
			/>,
		);

		await user.type(screen.getByLabelText(/paste redirect url/i), "http://localhost:1455/auth/callback?code=test");
		await user.click(screen.getByRole("button", { name: /提交/i }));

		await waitFor(() => {
			expect(onSubmitOAuthLoginCode).toHaveBeenCalledWith(
				"openai-codex",
				"http://localhost:1455/auth/callback?code=test",
			);
		});
	});

	it("does not render the old preferences tabs", () => {
		renderSettingsPage();

		expect(screen.queryByRole("tab")).toBeNull();
	});
});
