import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import type { DesktopProviderKeyTestResult, DesktopRuntimeCatalog } from "../../shared/types.ts";
import type { DesktopAuthService } from "../auth/desktop-auth-service.ts";
import { testDesktopProviderKey } from "../auth/provider-key-test-service.ts";
import type { DesktopProviderKeysStore } from "../storage/provider-keys-store.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import { openAuthStream } from "./open-auth-stream.ts";
import { validateOAuthCode, validateProviderId, validateProviderKey } from "./validate-ipc.ts";

export interface DesktopAuthBridgeGroupOptions {
	authService: DesktopAuthService;
	getRuntimeCatalog: () => Promise<DesktopRuntimeCatalog>;
	providerKeysStore: DesktopProviderKeysStore;
	testProviderKey?: (provider: string) => Promise<DesktopProviderKeyTestResult>;
}

export function createAuthBridgeGroup(options: DesktopAuthBridgeGroupOptions): DesktopBridgeGroupDescriptor {
	const testProviderKey =
		options.testProviderKey ??
		(async (provider: string) =>
			testDesktopProviderKey({
				provider,
				providerKeysStore: options.providerKeysStore,
				runtimeCatalog: await options.getRuntimeCatalog(),
			}));

	return {
		commands: [
			{
				channel: IPC_CHANNELS.listProviderKeys,
				handle: async () => options.providerKeysStore.list(),
			},
			{
				channel: IPC_CHANNELS.setProviderKey,
				handle: async (_event, provider: unknown, key: unknown) => {
					const providerId = validateProviderId(provider);
					await options.providerKeysStore.set(providerId, validateProviderKey(key));
					options.authService.notifyCredentialsChanged(providerId);
				},
			},
			{
				channel: IPC_CHANNELS.deleteProviderKey,
				handle: async (_event, provider: unknown) => {
					const providerId = validateProviderId(provider);
					await options.providerKeysStore.delete(providerId);
					options.authService.notifyCredentialsChanged(providerId);
				},
			},
			{
				channel: IPC_CHANNELS.testProviderKey,
				handle: async (_event, provider: unknown) => testProviderKey(validateProviderId(provider)),
			},
			{
				channel: IPC_CHANNELS.listOAuthProviders,
				handle: async () => options.authService.listOAuthProviders(),
			},
			{
				channel: IPC_CHANNELS.startOAuthLogin,
				handle: async (_event, provider: unknown) =>
					options.authService.startOAuthLogin(validateProviderId(provider)),
			},
			{
				channel: IPC_CHANNELS.submitOAuthLoginCode,
				handle: async (_event, provider: unknown, code: unknown) =>
					options.authService.submitOAuthLoginCode(validateProviderId(provider), validateOAuthCode(code)),
			},
			{
				channel: IPC_CHANNELS.cancelOAuthLogin,
				handle: async (_event, provider: unknown) =>
					options.authService.cancelOAuthLogin(validateProviderId(provider)),
			},
			{
				channel: IPC_CHANNELS.logoutOAuthProvider,
				handle: async (_event, provider: unknown) =>
					options.authService.logoutOAuthProvider(validateProviderId(provider)),
			},
			{
				channel: IPC_CHANNELS.getStorageSecurityState,
				handle: async () => options.providerKeysStore.getSecurityState(),
			},
		],
		streams: [
			{
				channel: IPC_CHANNELS.openAuthStream,
				open: (port) => openAuthStream(options.authService, port),
			},
		],
	};
}
