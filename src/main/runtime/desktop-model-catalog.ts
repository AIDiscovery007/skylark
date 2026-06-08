import { getModels, getProviders, type KnownProvider, type Model } from "@earendil-works/pi-ai";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import { normalizeDesktopProviderIdentifier } from "../../shared/provider-id.ts";
import type { DesktopProviderAuthMethod } from "../../shared/types.ts";

const DESKTOP_MODEL_PREFERENCE: KnownProvider[] = [
	"anthropic",
	"openai",
	"google",
	"openrouter",
	"google-vertex",
	"amazon-bedrock",
	"mistral",
	"xai",
	"groq",
	"cerebras",
	"vercel-ai-gateway",
	"zai",
	"github-copilot",
	"azure-openai-responses",
	"huggingface",
	"minimax",
	"minimax-cn",
	"opencode",
	"opencode-go",
	"kimi-coding",
	"openai-codex",
];

const DESKTOP_PROVIDER_MODEL_PREFERENCES: Partial<Record<KnownProvider, readonly string[]>> = {
	groq: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"],
	"kimi-coding": ["kimi-for-coding"],
};

const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding";
const DESKTOP_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	anthropic: "Anthropic",
	"amazon-bedrock": "Amazon Bedrock",
	"azure-openai-responses": "Azure OpenAI Responses",
	cerebras: "Cerebras",
	"cloudflare-ai-gateway": "Cloudflare AI Gateway",
	"cloudflare-workers-ai": "Cloudflare Workers AI",
	deepseek: "DeepSeek",
	fireworks: "Fireworks",
	google: "Google Gemini",
	"google-vertex": "Google Vertex AI",
	groq: "Groq",
	"github-copilot": "GitHub Copilot",
	huggingface: "Hugging Face",
	"kimi-coding": "Kimi For Coding",
	mistral: "Mistral",
	minimax: "MiniMax",
	"minimax-cn": "MiniMax (China)",
	moonshotai: "Moonshot AI",
	"moonshotai-cn": "Moonshot AI (China)",
	opencode: "OpenCode Zen",
	"opencode-go": "OpenCode Go",
	openai: "OpenAI",
	"openai-codex": "OpenAI Codex",
	openrouter: "OpenRouter",
	together: "Together AI",
	"vercel-ai-gateway": "Vercel AI Gateway",
	xai: "xAI",
	zai: "ZAI",
};

export function getDesktopOrderedKnownProviders(): KnownProvider[] {
	const availableProviders = new Set(getProviders());
	const orderedProviders = DESKTOP_MODEL_PREFERENCE.filter((provider) => availableProviders.has(provider));

	for (const provider of getProviders()) {
		if (!orderedProviders.includes(provider)) {
			orderedProviders.push(provider);
		}
	}

	return orderedProviders;
}

export function getDesktopCatalogProviders(): string[] {
	const providers = [...getDesktopOrderedKnownProviders()];
	if (!providers.includes("kimi-coding")) {
		providers.push("kimi-coding");
	}
	return providers;
}

export function getDesktopCatalogModelsForProvider(provider: string): Model<any>[] {
	if (provider === "kimi-coding") {
		return [createKimiCodingModel("kimi-for-coding")];
	}

	if ((getProviders() as string[]).includes(provider)) {
		return [...getModels(provider as KnownProvider)];
	}

	return [];
}

export function getDesktopProviderAuthMethods(provider: string): DesktopProviderAuthMethod[] {
	if (provider === "anthropic") {
		return ["oauth", "api_key"];
	}
	if (provider === "github-copilot" || provider === "openai-codex") {
		return ["oauth"];
	}
	return ["api_key"];
}

export function getDesktopProviderDisplayName(provider: string): string {
	return DESKTOP_PROVIDER_DISPLAY_NAMES[provider] ?? getOAuthProvider(provider)?.name ?? provider;
}

export function findDesktopCatalogModel(provider: string, modelId: string): Model<any> | undefined {
	return getDesktopCatalogModelsForProvider(normalizeDesktopProviderIdentifier(provider)).find(
		(model) => model.id === modelId,
	);
}

export function isPositiveNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function hydrateDesktopModelMetadata(model: Model<any>): Model<any> {
	if (isPositiveNumber(model.contextWindow) && isPositiveNumber(model.maxTokens)) {
		return model;
	}

	const catalogModel = findDesktopCatalogModel(model.provider, model.id);
	if (!catalogModel) {
		return model;
	}

	return {
		...catalogModel,
		...model,
		contextWindow: isPositiveNumber(model.contextWindow) ? model.contextWindow : catalogModel.contextWindow,
		maxTokens: isPositiveNumber(model.maxTokens) ? model.maxTokens : catalogModel.maxTokens,
	};
}

export function pickPreferredDesktopModelForProvider(
	provider: KnownProvider,
	models: readonly Model<any>[],
	preferredModelId?: string,
): Model<any> | undefined {
	if (preferredModelId) {
		const configuredModel = models.find((model) => model.id === preferredModelId);
		if (configuredModel) {
			return configuredModel;
		}
	}

	const preferredModelIds = DESKTOP_PROVIDER_MODEL_PREFERENCES[provider];
	if (!preferredModelIds) {
		return models[0];
	}

	for (const modelId of preferredModelIds) {
		const preferredModel = models.find((model) => model.id === modelId);
		if (preferredModel) {
			return preferredModel;
		}
	}

	return models[0];
}

export function createKimiCodingModel(modelId: string): Model<"anthropic-messages"> {
	return {
		id: modelId,
		name: modelId,
		api: "anthropic-messages",
		provider: "kimi-coding",
		baseUrl: KIMI_CODING_BASE_URL,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 256000,
		maxTokens: 16384,
	};
}
