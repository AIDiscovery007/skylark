import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { OAuthProviderInterface } from "@earendil-works/pi-ai";
import {
	type FauxProviderRegistration,
	type RegisterFauxProviderOptions,
	registerFauxProvider as registerTopLevelFauxProvider,
} from "@earendil-works/pi-ai";
import {
	registerOAuthProvider as registerTopLevelOAuthProvider,
	resetOAuthProviders as resetTopLevelOAuthProviders,
} from "@earendil-works/pi-ai/oauth";

type PiAiModule = typeof import("@earendil-works/pi-ai");
type PiAiOAuthModule = typeof import("@earendil-works/pi-ai/oauth");

const nestedPiAi = await importOptionalPiModule<PiAiModule>(
	"node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.js",
);
const nestedPiAiOAuth = await importOptionalPiModule<PiAiOAuthModule>(
	"node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/oauth.js",
);

async function importOptionalPiModule<T>(relativePath: string): Promise<T | undefined> {
	try {
		return (await import(pathToFileURL(resolve(process.cwd(), relativePath)).href)) as T;
	} catch {
		return undefined;
	}
}

export function registerFauxProvider(options: RegisterFauxProviderOptions = {}): FauxProviderRegistration {
	const primary = registerTopLevelFauxProvider(options);
	const primaryModel = primary.getModel();
	const secondary = nestedPiAi?.registerFauxProvider({
		...options,
		api: primary.api,
		provider: primaryModel.provider,
	});
	if (!secondary) {
		return primary;
	}
	const state = {
		get callCount() {
			return primary.state.callCount + secondary.state.callCount;
		},
	};

	return {
		...primary,
		state,
		setResponses(responses) {
			primary.setResponses(responses);
			secondary.setResponses(responses);
		},
		appendResponses(responses) {
			primary.appendResponses(responses);
			secondary.appendResponses(responses);
		},
		getPendingResponseCount() {
			return Math.min(primary.getPendingResponseCount(), secondary.getPendingResponseCount());
		},
		unregister() {
			secondary.unregister();
			primary.unregister();
		},
	};
}

export function registerOAuthProvider(provider: OAuthProviderInterface): void {
	registerTopLevelOAuthProvider(provider);
	nestedPiAiOAuth?.registerOAuthProvider(provider);
}

export function resetOAuthProviders(): void {
	resetTopLevelOAuthProviders();
	nestedPiAiOAuth?.resetOAuthProviders();
}
