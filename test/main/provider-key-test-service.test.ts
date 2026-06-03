import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { testDesktopProviderKey } from "../../src/main/auth/provider-key-test-service.ts";
import type { DesktopProviderKeysStore } from "../../src/main/storage/provider-keys-store.ts";

type FakeComplete = (model: Model<Api>, context: Context, options: SimpleStreamOptions) => Promise<AssistantMessage>;

class FakeProviderKeysStore {
	constructor(private readonly keys: Record<string, string> = {}) {}

	async get(provider: string): Promise<string | undefined> {
		return this.keys[provider];
	}
}

function createAssistantMessage(provider: string, model: string): AssistantMessage {
	return {
		role: "assistant",
		api: "anthropic-messages",
		provider,
		model,
		content: [{ type: "text", text: "ok" }],
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("testDesktopProviderKey", () => {
	it("tests a saved provider key with a catalog model", async () => {
		const complete = vi.fn<FakeComplete>(async (model) => createAssistantMessage(model.provider, model.id));

		const result = await testDesktopProviderKey({
			provider: "anthropic",
			providerKeysStore: new FakeProviderKeysStore({ anthropic: "sk-test" }) as unknown as DesktopProviderKeysStore,
			runtimeCatalog: {
				defaultTools: ["read"],
				providers: [
					{
						id: "anthropic",
						name: "Anthropic",
						configured: true,
						authMethods: ["oauth", "api_key"],
						models: [
							{
								id: "claude-sonnet-4-20250514",
								name: "Claude Sonnet",
								reasoning: true,
								contextWindow: 200000,
							},
						],
					},
				],
			},
			complete,
		});

		expect(result.ok).toBe(true);
		expect(result.provider).toBe("anthropic");
		expect(result.message).toBe("连接正常");
		expect(complete).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "anthropic" }),
			expect.objectContaining({
				messages: [expect.objectContaining({ role: "user", content: "Reply exactly: ok" })],
			}),
			expect.objectContaining({ apiKey: "sk-test", maxTokens: 8 }),
		);
	});

	it("returns a failed result when the provider rejects the key", async () => {
		const complete = vi.fn<FakeComplete>(async () => {
			throw new Error("401 Unauthorized");
		});

		const result = await testDesktopProviderKey({
			provider: "anthropic",
			providerKeysStore: new FakeProviderKeysStore({ anthropic: "bad-key" }) as unknown as DesktopProviderKeysStore,
			runtimeCatalog: {
				defaultTools: ["read"],
				providers: [
					{
						id: "anthropic",
						name: "Anthropic",
						configured: true,
						authMethods: ["oauth", "api_key"],
						models: [
							{
								id: "claude-sonnet-4-20250514",
								name: "Claude Sonnet",
								reasoning: true,
								contextWindow: 200000,
							},
						],
					},
				],
			},
			complete,
		});

		expect(result).toEqual({
			provider: "anthropic",
			ok: false,
			message: "401 Unauthorized",
		});
	});
});
