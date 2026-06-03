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
		const { container } = render(
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
		expect(screen.getByText("背景信息窗口：")).toBeTruthy();
		expect(screen.getByText("64% 已用")).toBeTruthy();
		expect(screen.getByText("已用 166k 标记，共 258k")).toBeTruthy();
		expect(container.querySelector("[data-slot='context-window-progress']")?.getAttribute("style")).toContain(
			"conic-gradient",
		);
		expect(screen.queryByText(/Codex/)).toBeNull();
	});

	it("renders composer status entries as pure icons without circular chrome", () => {
		const { container } = render(
			<TooltipProvider>
				<Composer
					availableTools={["read", "bash", "edit", "write"]}
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

		expect(statusIcons).toHaveLength(4);
		for (const statusIcon of statusIcons) {
			expect(statusIcon.className).not.toContain("rounded-full");
			expect(statusIcon.className).not.toContain("bg-background");
		}
		expect(screen.getByLabelText("Model kimi-coding / kimi-for-coding")).toBeTruthy();
		expect(screen.getByLabelText("4 active tools")).toBeTruthy();
		expect(screen.getByLabelText("Thinking high")).toBeTruthy();
	});

	it("opens the tools popover with active tool names", async () => {
		const user = userEvent.setup();
		render(
			<TooltipProvider>
				<Composer
					availableTools={["read", "bash"]}
					isStreaming={false}
					onAbort={async () => undefined}
					onSubmitPrompt={async () => undefined}
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByLabelText("2 active tools"));

		expect(screen.getByText("Activated tools")).toBeTruthy();
		expect(screen.getByText("read")).toBeTruthy();
		expect(screen.getByText("bash")).toBeTruthy();
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
		const providerButton = screen.getByText("anthropic").closest("button");
		expect(providerButton).not.toBeNull();
		await user.click(providerButton!);
		await user.type(screen.getByPlaceholderText("Filter models"), "opus");
		await user.click(screen.getByRole("button", { name: /claude-opus-4-6/i }));

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
		expect(screen.getByLabelText("OpenAI 未配置")).toBeTruthy();
		expect(screen.queryByText("未配置")).toBeNull();
		await user.click(screen.getByRole("button", { name: /OpenAI/i }));

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
		const providerButtons = screen
			.getAllByRole("button")
			.filter((button) =>
				["OpenAI Codex", "Anthropic", "OpenAI"].some((label) => button.textContent?.includes(label)),
			);

		expect(providerButtons.map((button) => button.textContent)).toEqual([
			expect.stringContaining("OpenAI Codex"),
			expect.stringContaining("Anthropic"),
			expect.stringContaining("OpenAI"),
		]);
		expect(screen.getByLabelText("OpenAI Codex 已登录")).toBeTruthy();
		expect(screen.getByLabelText("Anthropic API key")).toBeTruthy();
		expect(screen.getByLabelText("OpenAI 未配置")).toBeTruthy();
		expect(screen.queryByText("已登录")).toBeNull();
		expect(screen.queryByText("API key")).toBeNull();
		expect(screen.queryByText("未配置")).toBeNull();

		await user.type(screen.getByPlaceholderText("Filter providers"), "anth");

		expect(screen.getByRole("button", { name: /Anthropic/i })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /OpenAI Codex/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /OpenAI 未配置/i })).toBeNull();
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

	it("avoids unknown percentage copy when the context window size is not available", () => {
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

		expect(screen.getByLabelText("Context window 70k tokens used")).toBeTruthy();
		expect(screen.getByText("已用 70k 标记")).toBeTruthy();
		expect(screen.queryByText("未知 已用")).toBeNull();
		expect(screen.queryByText(/共 未知/)).toBeNull();
		expect(screen.queryByText(/Codex/)).toBeNull();
	});
});
