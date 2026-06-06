import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../../src/renderer/components/chat/Composer.tsx";
import { TooltipProvider } from "../../src/renderer/components/ui/tooltip.tsx";

afterEach(() => {
	cleanup();
});

describe("Composer UI", () => {
	it("submits the trimmed prompt on Enter", async () => {
		const user = userEvent.setup();
		const onSubmitPrompt = vi.fn(async () => undefined);

		render(
			<TooltipProvider>
				<Composer isStreaming={false} onAbort={async () => undefined} onSubmitPrompt={onSubmitPrompt} />
			</TooltipProvider>,
		);

		const textbox = screen.getByRole("textbox");
		await user.type(textbox, "  inspect app shell  ");
		await user.keyboard("{Enter}");

		await waitFor(() => {
			expect(onSubmitPrompt).toHaveBeenCalledWith("inspect app shell");
		});
	});

	it("keeps newline entry on Shift+Enter instead of submitting", async () => {
		const user = userEvent.setup();
		const onSubmitPrompt = vi.fn(async () => undefined);

		render(
			<TooltipProvider>
				<Composer isStreaming={false} onAbort={async () => undefined} onSubmitPrompt={onSubmitPrompt} />
			</TooltipProvider>,
		);

		const textbox = screen.getByRole("textbox");
		await user.type(textbox, "line 1");
		await user.keyboard("{Shift>}{Enter}{/Shift}");

		expect(onSubmitPrompt).not.toHaveBeenCalled();
		expect((textbox as HTMLTextAreaElement).value).toBe("line 1\n");
	});

	it("does not render a redundant run status indicator", () => {
		render(
			<TooltipProvider>
				<Composer isStreaming={true} onAbort={async () => undefined} onSubmitPrompt={async () => undefined} />
			</TooltipProvider>,
		);

		expect(screen.queryByLabelText("Ready")).toBeNull();
		expect(screen.queryByLabelText("Streaming")).toBeNull();
	});

	it("shows a compact context window usage entry", () => {
		render(
			<TooltipProvider>
				<Composer
					contextWindowUsage={{ usedTokens: 166000, totalTokens: 258000 }}
					isStreaming={false}
					onAbort={async () => undefined}
					onSubmitPrompt={async () => undefined}
				/>
			</TooltipProvider>,
		);

		expect(screen.getByLabelText("Context window 64% used")).toBeTruthy();
		expect(screen.getByText("64.3%")).toBeTruthy();
		expect(screen.getByRole("img", { name: "Model context usage" })).toBeTruthy();
		expect(screen.queryByText(/Codex/)).toBeNull();
	});

	it("renders the model selector and status entries without circular chrome", () => {
		const { container } = render(
			<TooltipProvider>
				<Composer
					contextWindowUsage={{ usedTokens: 166000, totalTokens: 258000 }}
					isStreaming={false}
					model={{
						id: "kimi-for-coding",
						name: "kimi-for-coding",
						provider: "kimi-coding",
						reasoning: true,
					}}
					onAbort={async () => undefined}
					onSubmitPrompt={async () => undefined}
					thinkingLevel="high"
				/>
			</TooltipProvider>,
		);

		const statusIcons = container.querySelectorAll("[data-slot='composer-status-icon']");
		const modelSelectorTrigger = container.querySelector("[data-slot='composer-model-selector-trigger']");

		expect(modelSelectorTrigger).toBeTruthy();
		expect(modelSelectorTrigger?.className).not.toContain("rounded-full");
		expect(modelSelectorTrigger?.className).not.toContain("bg-background");
		expect(modelSelectorTrigger?.textContent).toContain("kimi-for-coding");
		expect(statusIcons).toHaveLength(1);
		for (const statusIcon of statusIcons) {
			expect(statusIcon.className).not.toContain("rounded-full");
			expect(statusIcon.className).not.toContain("bg-background");
		}
		expect(screen.getByLabelText("Model kimi-coding / kimi-for-coding")).toBeTruthy();
		expect(screen.queryByLabelText(/active tools/i)).toBeNull();
		expect(screen.getByLabelText("Thinking high")).toBeTruthy();
	});

	it("opens the model picker and applies a selected model", async () => {
		const user = userEvent.setup();
		const onUpdateSessionProfile = vi.fn(async () => undefined);
		render(
			<TooltipProvider>
				<Composer
					isStreaming={false}
					model={{
						id: "claude-3-5-sonnet",
						name: "Claude 3.5 Sonnet",
						provider: "anthropic",
						reasoning: true,
					}}
					onAbort={async () => undefined}
					onSubmitPrompt={async () => undefined}
					onUpdateSessionProfile={onUpdateSessionProfile}
					runtimeCatalog={{
						defaultTools: ["read", "bash"],
						providers: [
							{
								id: "openai",
								name: "OpenAI",
								configured: false,
								authMethods: ["api_key" as const],
								models: [{ id: "gpt-5.4", name: "GPT-5.4", reasoning: true, contextWindow: 256000 }],
							},
							{
								id: "anthropic",
								name: "Anthropic",
								configured: true,
								authMethods: ["api_key" as const],
								models: [
									{
										id: "claude-3-5-sonnet",
										name: "Claude 3.5 Sonnet",
										reasoning: true,
										contextWindow: 200000,
									},
									{
										id: "claude-opus-4-6",
										name: "Claude Opus 4.6",
										reasoning: true,
										contextWindow: 200000,
									},
								],
							},
						],
					}}
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByLabelText("Model anthropic / claude-3-5-sonnet"));
		await user.type(screen.getByPlaceholderText("Filter models"), "opus");
		const modelItem = screen.getByText(/Claude Opus 4\.6/i).closest("[data-slot='command-item']");
		expect(modelItem).not.toBeNull();
		await user.click(modelItem!);

		await waitFor(() => {
			expect(onUpdateSessionProfile).toHaveBeenCalledWith({
				provider: "anthropic",
				modelId: "claude-opus-4-6",
			});
		});
	});

	it("opens Settings credentials for an unconfigured provider from the model picker", async () => {
		const user = userEvent.setup();
		const onOpenSettings = vi.fn();
		const onUpdateSessionProfile = vi.fn(async () => undefined);
		render(
			<TooltipProvider>
				<Composer
					isStreaming={false}
					model={{
						id: "claude-3-5-sonnet",
						name: "Claude 3.5 Sonnet",
						provider: "anthropic",
						reasoning: true,
					}}
					onAbort={async () => undefined}
					onOpenSettings={onOpenSettings}
					onSubmitPrompt={async () => undefined}
					onUpdateSessionProfile={onUpdateSessionProfile}
					runtimeCatalog={{
						defaultTools: [],
						providers: [
							{
								id: "openai",
								name: "OpenAI",
								configured: false,
								authMethods: ["api_key" as const],
								models: [{ id: "gpt-5.4", name: "GPT-5.4", reasoning: true, contextWindow: 256000 }],
							},
							{
								id: "anthropic",
								name: "Anthropic",
								configured: true,
								authMethods: ["api_key" as const],
								models: [
									{
										id: "claude-3-5-sonnet",
										name: "Claude 3.5 Sonnet",
										reasoning: true,
										contextWindow: 200000,
									},
								],
							},
						],
					}}
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByLabelText("Model anthropic / claude-3-5-sonnet"));
		expect(screen.getByLabelText(/GPT-5\.4.*OpenAI.*未配置/i)).toBeTruthy();
		expect(screen.queryByText("未配置")).toBeNull();
		const openAiModelItem = screen.getByText(/GPT-5\.4/i).closest("[data-slot='command-item']");
		expect(openAiModelItem).not.toBeNull();
		await user.click(openAiModelItem!);

		expect(onOpenSettings).toHaveBeenCalledWith({ section: "credentials", providerId: "openai" });
		expect(onUpdateSessionProfile).not.toHaveBeenCalled();
	});

	it("sorts configured providers first and filters the provider catalog", async () => {
		const user = userEvent.setup();
		render(
			<TooltipProvider>
				<Composer
					isStreaming={false}
					model={{
						id: "gpt-5.5",
						name: "GPT-5.5",
						provider: "openai-codex",
						reasoning: true,
					}}
					oauthProviders={[
						{
							id: "openai-codex",
							name: "OpenAI Codex",
							configured: true,
							source: "shared-auth",
							usesCallbackServer: true,
						},
					]}
					onAbort={async () => undefined}
					onSubmitPrompt={async () => undefined}
					onUpdateSessionProfile={async () => undefined}
					providerKeys={[{ provider: "anthropic", configured: true }]}
					runtimeCatalog={{
						defaultTools: [],
						providers: [
							{
								id: "openai",
								name: "OpenAI",
								configured: false,
								authMethods: ["api_key" as const],
								models: [{ id: "gpt-5.4", name: "GPT-5.4", reasoning: true, contextWindow: 256000 }],
							},
							{
								id: "anthropic",
								name: "Anthropic",
								configured: false,
								authMethods: ["api_key" as const],
								models: [
									{
										id: "claude-3-5-sonnet",
										name: "Claude 3.5 Sonnet",
										reasoning: true,
										contextWindow: 200000,
									},
								],
							},
							{
								id: "openai-codex",
								name: "OpenAI Codex",
								configured: false,
								authMethods: ["oauth" as const],
								models: [{ id: "gpt-5.5", name: "GPT-5.5", reasoning: true, contextWindow: 256000 }],
							},
						],
					}}
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByLabelText("Model openai-codex / gpt-5.5"));
		const providerGroups = Array.from(document.querySelectorAll("[data-slot='command-group']"));

		expect(providerGroups.map((item) => item.textContent)).toEqual([
			expect.stringContaining("OpenAI Codex"),
			expect.stringContaining("Anthropic"),
			expect.stringContaining("OpenAI"),
		]);
		expect(screen.getByLabelText(/GPT-5\.5.*OpenAI Codex.*已登录/i)).toBeTruthy();
		expect(screen.getByLabelText(/Claude 3\.5 Sonnet.*Anthropic.*API key/i)).toBeTruthy();
		expect(screen.getByLabelText(/GPT-5\.4.*OpenAI.*未配置/i)).toBeTruthy();
		expect(screen.queryByText("已登录")).toBeNull();
		expect(screen.queryByText("API key")).toBeNull();
		expect(screen.queryByText("未配置")).toBeNull();

		await user.type(screen.getByPlaceholderText("Filter models"), "anth");

		const visibleProviderGroups = Array.from(document.querySelectorAll("[data-slot='command-group']"))
			.filter((group) => !group.hasAttribute("hidden"))
			.map((group) => group.textContent ?? "");
		expect(visibleProviderGroups).toEqual([expect.stringContaining("Anthropic")]);
	});

	it("keeps the default model selector compact while searching the full catalog", async () => {
		const user = userEvent.setup();
		const anthropicModels = Array.from({ length: 9 }, (_, index) => ({
			id: `claude-model-${index + 1}`,
			name: `Claude Model ${index + 1}`,
			reasoning: true,
			contextWindow: 200000,
		}));
		anthropicModels.push({
			id: "claude-opus-ten",
			name: "Claude Opus Ten",
			reasoning: true,
			contextWindow: 200000,
		});

		render(
			<TooltipProvider>
				<Composer
					isStreaming={false}
					model={{
						id: "claude-model-1",
						name: "Claude Model 1",
						provider: "anthropic",
						reasoning: true,
					}}
					onAbort={async () => undefined}
					onSubmitPrompt={async () => undefined}
					onUpdateSessionProfile={async () => undefined}
					runtimeCatalog={{
						defaultTools: [],
						providers: [
							{
								id: "anthropic",
								name: "Anthropic",
								configured: true,
								authMethods: ["api_key" as const],
								models: anthropicModels,
							},
							{
								id: "openai",
								name: "OpenAI",
								configured: false,
								authMethods: ["api_key" as const],
								models: [{ id: "gpt-5.4", name: "GPT-5.4", reasoning: true, contextWindow: 256000 }],
							},
							{
								id: "google",
								name: "Google",
								configured: false,
								authMethods: ["api_key" as const],
								models: [{ id: "gemini-pro", name: "Gemini Pro", reasoning: true, contextWindow: 1000000 }],
							},
							{
								id: "mistral",
								name: "Mistral",
								configured: false,
								authMethods: ["api_key" as const],
								models: [
									{ id: "mistral-large", name: "Mistral Large", reasoning: false, contextWindow: 128000 },
								],
							},
							{
								id: "zz-hidden",
								name: "Zzz Hidden",
								configured: false,
								authMethods: ["api_key" as const],
								models: [
									{
										id: "zz-hidden-model",
										name: "Zzz Hidden Model",
										reasoning: false,
										contextWindow: 128000,
									},
								],
							},
						],
					}}
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByLabelText("Model anthropic / claude-model-1"));
		expect(screen.queryByText("Claude Opus Ten")).toBeNull();
		expect(screen.queryByLabelText(/Zzz Hidden Model.*Zzz Hidden.*未配置/i)).toBeNull();

		const filterInput = screen.getByPlaceholderText("Filter models");
		await user.type(filterInput, "opus ten");
		expect(screen.getByLabelText(/Claude Opus Ten.*Anthropic.*已配置/i)).toBeTruthy();

		await user.clear(filterInput);
		await user.type(filterInput, "zz hidden");
		expect(screen.getByLabelText(/Zzz Hidden Model.*Zzz Hidden.*未配置/i)).toBeTruthy();
	});

	it("opens the thinking popover and applies a selected level", async () => {
		const user = userEvent.setup();
		const onUpdateSessionProfile = vi.fn(async () => undefined);
		render(
			<TooltipProvider>
				<Composer
					isStreaming={false}
					model={{
						id: "gpt-5.4",
						name: "GPT-5.4",
						provider: "openai",
						reasoning: true,
					}}
					onAbort={async () => undefined}
					onSubmitPrompt={async () => undefined}
					onUpdateSessionProfile={onUpdateSessionProfile}
					thinkingLevel="off"
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByLabelText("Thinking off"));
		const popover = document.querySelector("[data-slot='popover-content']");

		expect(popover?.className).toContain("w-56");
		expect(popover?.className).toContain("shadow-[var(--uix-flat-shadow-floating)]");
		expect(screen.queryByText("Thinking level")).toBeNull();
		expect(screen.queryByText("Adjust this session")).toBeNull();
		expect(screen.queryByText("Current model does not reason")).toBeNull();
		await user.click(screen.getByRole("button", { name: /^high$/i }));

		await waitFor(() => {
			expect(onUpdateSessionProfile).toHaveBeenCalledWith({ thinkingLevel: "high" });
		});
	});

	it("keeps xhigh selectable for GPT-5.5 thinking sessions", async () => {
		const user = userEvent.setup();
		const onUpdateSessionProfile = vi.fn(async () => undefined);
		render(
			<TooltipProvider>
				<Composer
					isStreaming={false}
					model={{
						id: "gpt-5.5",
						name: "GPT-5.5",
						provider: "openai-codex",
						reasoning: true,
					}}
					onAbort={async () => undefined}
					onSubmitPrompt={async () => undefined}
					onUpdateSessionProfile={onUpdateSessionProfile}
					thinkingLevel="high"
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByLabelText("Thinking high"));
		const xhighButton = screen.getByRole("button", { name: /^xhigh$/i }) as HTMLButtonElement;

		expect(xhighButton.disabled).toBe(false);
		await user.click(xhighButton);

		await waitFor(() => {
			expect(onUpdateSessionProfile).toHaveBeenCalledWith({ thinkingLevel: "xhigh" });
		});
	});

	it("disables model and thinking profile controls while streaming", () => {
		render(
			<TooltipProvider>
				<Composer
					isStreaming={true}
					model={{
						id: "gpt-5.4",
						name: "GPT-5.4",
						provider: "openai",
						reasoning: true,
					}}
					onAbort={async () => undefined}
					onSubmitPrompt={async () => undefined}
					onUpdateSessionProfile={async () => undefined}
					thinkingLevel="medium"
				/>
			</TooltipProvider>,
		);

		expect((screen.getByLabelText("Model openai / gpt-5.4") as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByLabelText("Thinking medium") as HTMLButtonElement).disabled).toBe(true);
	});

	it("does not render the context control when the context window size is not available", () => {
		render(
			<TooltipProvider>
				<Composer
					contextWindowUsage={{ usedTokens: 70000 }}
					isStreaming={false}
					onAbort={async () => undefined}
					onSubmitPrompt={async () => undefined}
				/>
			</TooltipProvider>,
		);

		expect(screen.queryByLabelText(/Context window/i)).toBeNull();
		expect(screen.queryByText("未知 已用")).toBeNull();
		expect(screen.queryByText(/共 未知/)).toBeNull();
		expect(screen.queryByText(/Codex/)).toBeNull();
	});
});
