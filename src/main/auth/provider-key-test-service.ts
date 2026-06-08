import {
	type Api,
	type AssistantMessage,
	type Context,
	completeSimple,
	type KnownProvider,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { getErrorMessage } from "../../shared/errors.ts";
import type { DesktopProviderKeyTestResult, DesktopRuntimeCatalog } from "../../shared/types.ts";
import { getDesktopCatalogModelsForProvider, pickPreferredDesktopModelForProvider } from "../runtime/create-runtime.ts";
import type { DesktopProviderKeysStore } from "../storage/provider-keys-store.ts";

const PROVIDER_KEY_TEST_TIMEOUT_MS = 15_000;

type ProviderKeyTestComplete = (
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export interface TestDesktopProviderKeyOptions {
	provider: string;
	providerKeysStore: Pick<DesktopProviderKeysStore, "get">;
	runtimeCatalog: DesktopRuntimeCatalog;
	complete?: ProviderKeyTestComplete;
}

function createFailedResult(provider: string, message: string): DesktopProviderKeyTestResult {
	return {
		provider,
		ok: false,
		message,
	};
}

export async function testDesktopProviderKey({
	provider,
	providerKeysStore,
	runtimeCatalog,
	complete = completeSimple,
}: TestDesktopProviderKeyOptions): Promise<DesktopProviderKeyTestResult> {
	const apiKey = await providerKeysStore.get(provider);
	if (!apiKey) {
		return createFailedResult(provider, "未找到本机 API key。");
	}

	const runtimeProvider = runtimeCatalog.providers.find((candidate) => candidate.id === provider);
	if (!runtimeProvider || !runtimeProvider.authMethods.includes("api_key")) {
		return createFailedResult(provider, "该 provider 不支持 API key 测试。");
	}

	const model = pickPreferredDesktopModelForProvider(
		provider as KnownProvider,
		getDesktopCatalogModelsForProvider(provider),
	);
	if (!model) {
		return createFailedResult(provider, "该 provider 没有可用于测试的模型。");
	}

	try {
		const response = await complete(
			model,
			{
				systemPrompt: "Credential connectivity probe. Reply exactly: ok.",
				messages: [{ role: "user", content: "Reply exactly: ok", timestamp: Date.now() }],
			},
			{
				apiKey,
				cacheRetention: "none",
				maxTokens: 8,
				temperature: 0,
				timeoutMs: PROVIDER_KEY_TEST_TIMEOUT_MS,
			},
		);
		if (response.stopReason === "error") {
			return createFailedResult(provider, response.errorMessage ?? "Provider 返回错误。");
		}
		return {
			provider,
			ok: true,
			message: "连接正常",
			modelId: model.id,
		};
	} catch (error: unknown) {
		return createFailedResult(provider, getErrorMessage(error));
	}
}
