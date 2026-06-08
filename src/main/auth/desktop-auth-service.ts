import type { OAuthLoginCallbacks, OAuthPrompt, OAuthSelectPrompt } from "@earendil-works/pi-ai";
import { getOAuthProvider, getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { shell } from "electron";
import { getErrorMessage } from "../../shared/errors.ts";
import type { DesktopOAuthLoginEvent, DesktopOAuthProviderStatus } from "../../shared/types.ts";
import type { DesktopProviderKeysStore } from "../storage/provider-keys-store.ts";
import { Listeners } from "../util/port-fanout.ts";

const DESKTOP_OAUTH_PROVIDER_IDS = ["anthropic", "github-copilot", "openai-codex"] as const;
const DESKTOP_OAUTH_PROVIDER_ID_SET = new Set<string>(DESKTOP_OAUTH_PROVIDER_IDS);
type DesktopOAuthProviderId = (typeof DESKTOP_OAUTH_PROVIDER_IDS)[number];

interface PendingOAuthLogin {
	providerId: DesktopOAuthProviderId;
	abortController: AbortController;
	cancelled: boolean;
	resolveManualInput?: (value: string) => void;
	rejectManualInput?: (error: Error) => void;
}

function isDesktopOAuthProviderId(providerId: string): providerId is DesktopOAuthProviderId {
	return DESKTOP_OAUTH_PROVIDER_ID_SET.has(providerId);
}

export class DesktopAuthService {
	private readonly listeners = new Listeners<DesktopOAuthLoginEvent>();
	private pendingLogin?: PendingOAuthLogin;

	constructor(
		private readonly providerKeysStore: DesktopProviderKeysStore,
		private readonly authStorage = AuthStorage.create(),
		private readonly openExternal: (url: string) => Promise<void> = (url) => shell.openExternal(url),
	) {}

	subscribe(listener: (event: DesktopOAuthLoginEvent) => void): () => void {
		return this.listeners.subscribe(listener);
	}

	async getApiKey(provider: string): Promise<string | undefined> {
		const desktopKey = await this.providerKeysStore.get(provider);
		if (desktopKey) {
			return desktopKey;
		}

		this.authStorage.reload();
		return this.authStorage.getApiKey(provider);
	}

	async hasAuth(provider: string): Promise<boolean> {
		if (await this.providerKeysStore.has(provider)) {
			return true;
		}

		this.authStorage.reload();
		return this.authStorage.hasAuth(provider);
	}

	listOAuthProviders(): DesktopOAuthProviderStatus[] {
		this.authStorage.reload();
		const statuses: DesktopOAuthProviderStatus[] = [];
		for (const provider of getOAuthProviders()) {
			const providerId = provider.id;
			if (!isDesktopOAuthProviderId(providerId)) {
				continue;
			}
			statuses.push({
				id: providerId,
				name: provider.name,
				configured: this.authStorage.get(providerId)?.type === "oauth",
				source: "shared-auth",
				usesCallbackServer: provider.usesCallbackServer ?? false,
			});
		}
		return statuses;
	}

	startOAuthLogin(providerId: string): void {
		if (!isDesktopOAuthProviderId(providerId)) {
			throw new Error(`Unsupported desktop OAuth provider: ${providerId}`);
		}
		if (this.pendingLogin) {
			throw new Error(`OAuth login for ${this.pendingLogin.providerId} is already in progress.`);
		}

		const provider = getOAuthProvider(providerId);
		if (!provider) {
			throw new Error(`Unknown OAuth provider: ${providerId}`);
		}

		const pending: PendingOAuthLogin = {
			providerId,
			abortController: new AbortController(),
			cancelled: false,
		};
		this.pendingLogin = pending;

		void this.authStorage
			.login(providerId, this.createLoginCallbacks(pending))
			.then(() => {
				if (this.pendingLogin === pending) {
					this.pendingLogin = undefined;
				}
				if (pending.cancelled) {
					return;
				}
				this.emit({ type: "success", provider: providerId });
				this.notifyCredentialsChanged(providerId);
			})
			.catch((error: unknown) => {
				if (this.pendingLogin === pending) {
					this.pendingLogin = undefined;
				}
				if (pending.cancelled) {
					return;
				}
				const message = getErrorMessage(error);
				if (message === "Login cancelled") {
					this.emit({ type: "cancelled", provider: providerId });
					return;
				}
				this.emit({ type: "error", provider: providerId, message });
			});
	}

	submitOAuthLoginCode(providerId: string, code: string): void {
		const pending = this.requirePendingLogin(providerId);
		if (!pending.resolveManualInput) {
			throw new Error(`OAuth login for ${providerId} is not waiting for manual input.`);
		}

		const resolve = pending.resolveManualInput;
		pending.resolveManualInput = undefined;
		pending.rejectManualInput = undefined;
		resolve(code);
	}

	cancelOAuthLogin(providerId: string): void {
		const pending = this.requirePendingLogin(providerId);
		pending.cancelled = true;
		this.pendingLogin = undefined;
		pending.abortController.abort();
		pending.rejectManualInput?.(new Error("Login cancelled"));
		this.emit({ type: "cancelled", provider: pending.providerId });
	}

	logoutOAuthProvider(providerId: string): void {
		if (!isDesktopOAuthProviderId(providerId)) {
			throw new Error(`Unsupported desktop OAuth provider: ${providerId}`);
		}
		if (this.pendingLogin?.providerId === providerId) {
			this.cancelOAuthLogin(providerId);
		}
		this.authStorage.reload();
		this.authStorage.logout(providerId);
		this.notifyCredentialsChanged(providerId);
	}

	notifyCredentialsChanged(provider?: string): void {
		this.emit({
			type: "credentials_changed",
			...(provider ? { provider } : {}),
		});
	}

	dispose(): void {
		const pending = this.pendingLogin;
		if (!pending) {
			this.listeners.clear();
			return;
		}

		pending.cancelled = true;
		this.pendingLogin = undefined;
		pending.abortController.abort();
		pending.rejectManualInput?.(new Error("Login cancelled"));
		this.emit({ type: "cancelled", provider: pending.providerId });
		this.listeners.clear();
	}

	private createLoginCallbacks(pending: PendingOAuthLogin): OAuthLoginCallbacks {
		return {
			onAuth: (info) => {
				this.emit({
					type: "auth_url",
					provider: pending.providerId,
					url: info.url,
					instructions: info.instructions,
				});
				void this.openExternal(info.url).catch((error: unknown) => {
					this.emit({
						type: "progress",
						provider: pending.providerId,
						message: `Open browser manually: ${getErrorMessage(error)}`,
					});
				});
			},
			onDeviceCode: (info) => {
				const expiry = info.expiresInSeconds
					? ` Code expires in ${Math.ceil(info.expiresInSeconds / 60)} minutes.`
					: "";
				this.emit({
					type: "progress",
					provider: pending.providerId,
					message: `Open ${info.verificationUri} and enter code ${info.userCode}.${expiry}`,
				});
				void this.openExternal(info.verificationUri).catch((error: unknown) => {
					this.emit({
						type: "progress",
						provider: pending.providerId,
						message: `Open device login page manually: ${getErrorMessage(error)}`,
					});
				});
			},
			onPrompt: (prompt) => this.createManualInputPrompt(pending, prompt),
			onManualCodeInput: () =>
				this.createManualInputPrompt(pending, {
					message: "Paste the redirect URL below, or complete login in browser:",
				}),
			onSelect: (prompt) => Promise.resolve(this.selectOAuthOption(prompt)),
			onProgress: (message) => {
				this.emit({ type: "progress", provider: pending.providerId, message });
			},
			signal: pending.abortController.signal,
		};
	}

	private selectOAuthOption(prompt: OAuthSelectPrompt): string | undefined {
		const browserOption = prompt.options.find(
			(option) => option.id === "browser" || option.label.toLowerCase().includes("browser"),
		);
		return browserOption?.id ?? prompt.options[0]?.id;
	}

	private createManualInputPrompt(pending: PendingOAuthLogin, prompt: OAuthPrompt): Promise<string> {
		if (pending.abortController.signal.aborted) {
			return Promise.reject(new Error("Login cancelled"));
		}

		this.emit({
			type: "manual_code_prompt",
			provider: pending.providerId,
			message: prompt.message,
			placeholder: prompt.placeholder,
			allowEmpty: prompt.allowEmpty,
		});

		return new Promise((resolve, reject) => {
			pending.resolveManualInput = resolve;
			pending.rejectManualInput = reject;
		});
	}

	private requirePendingLogin(providerId: string): PendingOAuthLogin {
		const pending = this.pendingLogin;
		if (!pending || pending.providerId !== providerId) {
			throw new Error(`No OAuth login in progress for ${providerId}.`);
		}
		return pending;
	}

	private emit(event: DesktopOAuthLoginEvent): void {
		this.listeners.emit(event);
	}
}
