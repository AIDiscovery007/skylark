import {
	ChevronDown,
	ChevronRight,
	ExternalLink,
	KeyRound,
	LockKeyhole,
	LogIn,
	LogOut,
	ShieldAlert,
	X,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { layoutSpring, subtleReveal } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "../../../shared/errors.ts";
import type {
	DesktopOAuthProviderStatus,
	DesktopProviderKeyStatus,
	DesktopProviderKeyTestResult,
	DesktopRuntimeCatalog,
	DesktopRuntimeCatalogProvider,
	DesktopStorageSecurityState,
} from "../../../shared/types.ts";
import type { OAuthLoginState } from "../../stores/settings-store.ts";
import { SettingsActionBar, SettingsGroup, SettingsRow } from "./SettingsList.tsx";

function getStorageLabel(storageSecurityState?: DesktopStorageSecurityState): string {
	if (!storageSecurityState) {
		return "存储状态不可用。";
	}

	if (storageSecurityState.providerKeysEncrypted) {
		return "Provider key 已加密保存。";
	}

	if (storageSecurityState.secureStorageAvailable) {
		return "系统安全存储可用。";
	}

	return "当前使用明文存储。";
}

function getProviderKeyMap(providerKeys: DesktopProviderKeyStatus[]): Map<string, DesktopProviderKeyStatus> {
	return new Map(providerKeys.map((providerKey) => [providerKey.provider, providerKey]));
}

function getApiKeyProviders(
	runtimeCatalog: DesktopRuntimeCatalog | undefined,
	providerKeys: DesktopProviderKeyStatus[],
): DesktopRuntimeCatalogProvider[] {
	const runtimeProviders =
		runtimeCatalog?.providers.filter((provider) => provider.authMethods.includes("api_key")) ?? [];
	const runtimeProviderIds = new Set(runtimeProviders.map((provider) => provider.id));
	const customProviders: DesktopRuntimeCatalogProvider[] = providerKeys
		.filter((providerKey) => !runtimeProviderIds.has(providerKey.provider))
		.map((providerKey) => ({
			id: providerKey.provider,
			name: providerKey.provider,
			configured: providerKey.configured,
			authMethods: ["api_key"],
			models: [],
		}));

	return [...runtimeProviders, ...customProviders];
}

function SettingsGroupHeader({ description, title }: { description: string; title: string }) {
	return (
		<div className="border-b border-border/65 px-4 py-3.5 sm:px-5">
			<p className="text-[13px] font-semibold leading-5 text-foreground">{title}</p>
			<p className="mt-1 text-[12px] leading-5 text-muted-foreground">{description}</p>
		</div>
	);
}

interface ApiKeySettingsProps {
	providerKeys: DesktopProviderKeyStatus[];
	oauthProviders: DesktopOAuthProviderStatus[];
	oauthLogin: OAuthLoginState;
	focusedProviderId?: string;
	runtimeCatalog?: DesktopRuntimeCatalog;
	storageSecurityState?: DesktopStorageSecurityState;
	isLoading: boolean;
	isSaving: boolean;
	onSaveKey: (provider: string, key: string) => Promise<void>;
	onRemoveKey: (provider: string) => Promise<void>;
	onTestKey: (provider: string) => Promise<DesktopProviderKeyTestResult>;
	onStartOAuthLogin: (provider: string) => Promise<void>;
	onSubmitOAuthLoginCode: (provider: string, code: string) => Promise<void>;
	onCancelOAuthLogin: (provider: string) => Promise<void>;
	onLogoutOAuthProvider: (provider: string) => Promise<void>;
}

export function ApiKeySettings({
	providerKeys,
	oauthProviders,
	oauthLogin,
	focusedProviderId,
	runtimeCatalog,
	storageSecurityState,
	isLoading,
	isSaving,
	onSaveKey,
	onRemoveKey,
	onTestKey,
	onStartOAuthLogin,
	onSubmitOAuthLoginCode,
	onCancelOAuthLogin,
	onLogoutOAuthProvider,
}: ApiKeySettingsProps) {
	const [editingProvider, setEditingProvider] = useState<string | undefined>();
	const [editingKeyValue, setEditingKeyValue] = useState("");
	const [customProvider, setCustomProvider] = useState("");
	const [customKeyValue, setCustomKeyValue] = useState("");
	const [customProviderOpen, setCustomProviderOpen] = useState(false);
	const [testingProvider, setTestingProvider] = useState<string | undefined>();
	const [providerTestResults, setProviderTestResults] = useState<Record<string, DesktopProviderKeyTestResult>>({});
	const [manualCode, setManualCode] = useState("");
	const focusedProviderElements = useRef(new Map<string, HTMLDivElement>());
	const providerKeyMap = useMemo(() => getProviderKeyMap(providerKeys), [providerKeys]);
	const apiKeyProviders = useMemo(
		() => getApiKeyProviders(runtimeCatalog, providerKeys),
		[runtimeCatalog, providerKeys],
	);
	const customProviderName = customProvider.trim();

	useEffect(() => {
		if (!focusedProviderId) {
			return;
		}
		focusedProviderElements.current.get(focusedProviderId)?.scrollIntoView?.({ block: "center" });
	}, [focusedProviderId]);

	const setFocusedProviderElement = (providerId: string, element: HTMLDivElement | null): void => {
		if (element) {
			focusedProviderElements.current.set(providerId, element);
			return;
		}
		focusedProviderElements.current.delete(providerId);
	};

	const clearProviderTestResult = (provider: string) => {
		setProviderTestResults((current) => {
			const next = { ...current };
			delete next[provider];
			return next;
		});
	};

	if (isLoading) {
		return (
			<SettingsGroup>
				<div className="space-y-4 px-5 py-5">
					<Skeleton className="h-6 w-44" />
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-11 w-full rounded-xl" />
					<Skeleton className="h-11 w-full rounded-xl" />
					<Skeleton className="h-28 w-full rounded-2xl" />
				</div>
			</SettingsGroup>
		);
	}

	return (
		<motion.div className="space-y-5" layout transition={layoutSpring}>
			<SettingsGroup>
				<SettingsGroupHeader description="使用共享 pi CLI auth，不写入本机 provider key。" title="订阅账号" />
				{oauthProviders.length > 0 ? (
					oauthProviders.map((oauthProvider) => {
						const isSigningIn = oauthLogin.provider === oauthProvider.id && oauthLogin.isSigningIn;
						const statusMessage =
							oauthLogin.provider === oauthProvider.id && oauthLogin.statusMessage
								? oauthLogin.statusMessage
								: undefined;
						const authUrl = oauthLogin.provider === oauthProvider.id ? oauthLogin.authUrl : undefined;
						const manualPrompt =
							oauthLogin.provider === oauthProvider.id && oauthLogin.manualPrompt
								? oauthLogin.manualPrompt
								: undefined;
						const errorMessage =
							oauthLogin.provider === oauthProvider.id && oauthLogin.errorMessage
								? oauthLogin.errorMessage
								: undefined;

						const isFocusedProvider = focusedProviderId === oauthProvider.id;

						return (
							<motion.div
								className={cn(
									isFocusedProvider &&
										"bg-[color:color-mix(in_oklch,var(--accent)_8%,transparent)] ring-1 ring-inset ring-[color:color-mix(in_oklch,var(--accent)_28%,transparent)]",
								)}
								data-focused-credential-provider={isFocusedProvider ? oauthProvider.id : undefined}
								key={oauthProvider.id}
								layout
								ref={(element) => setFocusedProviderElement(oauthProvider.id, element)}
								{...subtleReveal}
							>
								<SettingsRow
									contentClassName="flex flex-wrap items-center gap-2 sm:justify-end"
									description="共享 pi CLI auth，用于订阅账号登录。"
									icon={ExternalLink}
									title={oauthProvider.name}
								>
									<Badge className="rounded-full" variant={oauthProvider.configured ? "secondary" : "outline"}>
										{oauthProvider.configured ? "已登录" : "未登录"}
									</Badge>
									{oauthProvider.configured ? (
										<Button
											disabled={isSaving || isSigningIn}
											onClick={() => {
												void onLogoutOAuthProvider(oauthProvider.id);
											}}
											type="button"
											variant="outline"
										>
											<LogOut className="size-4" />
											退出登录
										</Button>
									) : isSigningIn ? (
										<Button
											disabled={isSaving}
											onClick={() => {
												void onCancelOAuthLogin(oauthProvider.id);
											}}
											type="button"
											variant="outline"
										>
											<X className="size-4" />
											取消
										</Button>
									) : (
										<Button
											disabled={isSaving}
											onClick={() => {
												setManualCode("");
												void onStartOAuthLogin(oauthProvider.id);
											}}
											type="button"
										>
											<LogIn className="size-4" />
											登录
										</Button>
									)}
								</SettingsRow>

								{statusMessage ? (
									<div className="border-t border-border/65 px-5 py-3 text-[12px] leading-5 text-muted-foreground">
										{statusMessage}
									</div>
								) : null}
								{authUrl ? (
									<div className="break-all border-t border-border/65 bg-muted/20 px-5 py-3 font-mono text-[12px] leading-5 text-muted-foreground">
										{authUrl}
									</div>
								) : null}
								{manualPrompt ? (
									<motion.div
										className="grid gap-3 border-t border-border/65 px-5 py-4"
										layout
										{...subtleReveal}
									>
										<Label htmlFor={`${oauthProvider.id}-manual-code`}>{manualPrompt}</Label>
										<Input
											className="h-10 rounded-lg bg-background/80 shadow-none"
											id={`${oauthProvider.id}-manual-code`}
											onChange={(event) => setManualCode(event.target.value)}
											placeholder={oauthLogin.manualPlaceholder ?? "http://localhost:1455/auth/callback?..."}
											value={manualCode}
										/>
										<div className="flex justify-end">
											<Button
												disabled={manualCode.trim().length === 0 || isSaving}
												onClick={() => {
													void onSubmitOAuthLoginCode(oauthProvider.id, manualCode).then(() => {
														setManualCode("");
													});
												}}
												type="button"
											>
												<LogIn className="size-4" />
												提交
											</Button>
										</div>
									</motion.div>
								) : null}
								{errorMessage ? (
									<div className="border-t border-border/65 px-5 py-3 text-[12px] leading-5 text-destructive">
										{errorMessage}
									</div>
								) : null}
							</motion.div>
						);
					})
				) : (
					<motion.div
						className="border-border/65 border-t px-5 py-8 text-center text-[13px] text-muted-foreground"
						{...subtleReveal}
					>
						暂无可用订阅登录。
					</motion.div>
				)}
			</SettingsGroup>

			<SettingsGroup>
				<SettingsGroupHeader description={getStorageLabel(storageSecurityState)} title="Provider API keys" />
				{apiKeyProviders.length > 0 ? (
					apiKeyProviders.map((runtimeProvider) => {
						const savedKey = providerKeyMap.get(runtimeProvider.id);
						const hasSavedKey = savedKey?.configured === true;
						const isEditing = editingProvider === runtimeProvider.id;
						const isTesting = testingProvider === runtimeProvider.id;
						const testResult = providerTestResults[runtimeProvider.id];
						const inputId = `api-key-${runtimeProvider.id}`;

						const isFocusedProvider = focusedProviderId === runtimeProvider.id;

						return (
							<SettingsRow
								className={cn(
									isFocusedProvider &&
										"bg-[color:color-mix(in_oklch,var(--accent)_8%,transparent)] ring-1 ring-inset ring-[color:color-mix(in_oklch,var(--accent)_28%,transparent)]",
								)}
								contentClassName="flex flex-wrap items-center gap-2 sm:justify-end"
								data-focused-credential-provider={isFocusedProvider ? runtimeProvider.id : undefined}
								description={<span className="break-all font-mono">{runtimeProvider.id}</span>}
								icon={KeyRound}
								key={runtimeProvider.id}
								ref={(element) => setFocusedProviderElement(runtimeProvider.id, element)}
								title={runtimeProvider.name}
							>
								{isEditing ? (
									<div className="grid w-full gap-2 sm:w-[280px]">
										<Label htmlFor={inputId}>{runtimeProvider.name} API key</Label>
										<Input
											className="h-9 rounded-lg bg-background/80 shadow-none"
											id={inputId}
											onChange={(event) => setEditingKeyValue(event.target.value)}
											placeholder="sk-..."
											type="password"
											value={editingKeyValue}
										/>
										<div className="flex justify-end gap-2">
											<Button
												disabled={isSaving}
												onClick={() => {
													setEditingProvider(undefined);
													setEditingKeyValue("");
												}}
												size="sm"
												type="button"
												variant="outline"
											>
												<X className="size-4" />
												取消
											</Button>
											<Button
												disabled={editingKeyValue.trim().length === 0 || isSaving}
												onClick={() => {
													void onSaveKey(runtimeProvider.id, editingKeyValue).then(() => {
														clearProviderTestResult(runtimeProvider.id);
														setEditingProvider(undefined);
														setEditingKeyValue("");
													});
												}}
												size="sm"
												type="button"
											>
												<LockKeyhole className="size-4" />
												保存 key
											</Button>
										</div>
									</div>
								) : (
									<div className="flex w-full flex-col items-end gap-2">
										<div className="flex flex-wrap items-center justify-end gap-2">
											<Badge className="rounded-full" variant={hasSavedKey ? "secondary" : "outline"}>
												{hasSavedKey ? "已保存" : "未保存"}
											</Badge>
											<Button
												disabled={isSaving}
												onClick={() => {
													setEditingProvider(runtimeProvider.id);
													setEditingKeyValue("");
													clearProviderTestResult(runtimeProvider.id);
												}}
												type="button"
												variant={hasSavedKey ? "outline" : "default"}
											>
												<LockKeyhole className="size-4" />
												{hasSavedKey ? "更新 key" : "配置 key"}
											</Button>
											{hasSavedKey ? (
												<>
													<Button
														disabled={isSaving || isTesting}
														onClick={() => {
															setTestingProvider(runtimeProvider.id);
															void onTestKey(runtimeProvider.id)
																.then((result) => {
																	setProviderTestResults((current) => ({
																		...current,
																		[runtimeProvider.id]: result,
																	}));
																})
																.catch((error: unknown) => {
																	setProviderTestResults((current) => ({
																		...current,
																		[runtimeProvider.id]: {
																			provider: runtimeProvider.id,
																			ok: false,
																			message: getErrorMessage(error),
																		},
																	}));
																})
																.finally(() => {
																	setTestingProvider(undefined);
																});
														}}
														type="button"
														variant="outline"
													>
														<KeyRound className="size-4" />
														{isTesting ? "测试中" : "测试连接"}
													</Button>
													<Button
														disabled={isSaving || isTesting}
														onClick={() => {
															clearProviderTestResult(runtimeProvider.id);
															void onRemoveKey(runtimeProvider.id);
														}}
														type="button"
														variant="outline"
													>
														<ShieldAlert className="size-4" />
														移除
													</Button>
												</>
											) : null}
										</div>
										{testResult ? (
											<p
												className={
													testResult.ok
														? "text-right text-[12px] leading-5 text-[color:var(--success)]"
														: "text-right text-[12px] leading-5 text-destructive"
												}
											>
												{testResult.message}
											</p>
										) : null}
									</div>
								)}
							</SettingsRow>
						);
					})
				) : (
					<motion.div
						className="border-border/65 border-t px-5 py-8 text-center text-[13px] text-muted-foreground first:border-t-0"
						{...subtleReveal}
					>
						暂无 runtime API key provider。
					</motion.div>
				)}
				<SettingsRow
					contentClassName="flex flex-wrap items-center gap-2 sm:justify-end"
					description="手动保存未出现在 runtime catalog 里的 provider key。"
					icon={KeyRound}
					title="自定义 provider"
				>
					<Button
						aria-expanded={customProviderOpen}
						disabled={isSaving}
						onClick={() => setCustomProviderOpen((current) => !current)}
						type="button"
						variant="outline"
					>
						{customProviderOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
						自定义 provider
					</Button>
				</SettingsRow>
				{customProviderOpen ? (
					<motion.div className="grid gap-3 border-t border-border/65 px-5 py-4" layout {...subtleReveal}>
						<div className="grid gap-2 sm:grid-cols-2">
							<div className="grid gap-2">
								<Label htmlFor="custom-provider">自定义 Provider</Label>
								<Input
									className="h-9 rounded-lg bg-background/80 shadow-none"
									id="custom-provider"
									onChange={(event) => setCustomProvider(event.target.value)}
									placeholder="custom-provider"
									value={customProvider}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="custom-provider-key">自定义 API key</Label>
								<Input
									className="h-9 rounded-lg bg-background/80 shadow-none"
									id="custom-provider-key"
									onChange={(event) => setCustomKeyValue(event.target.value)}
									placeholder="sk-..."
									type="password"
									value={customKeyValue}
								/>
							</div>
						</div>
						<SettingsActionBar className="-mx-5 -mb-4 border-b-0 px-5">
							<Button
								disabled={customProviderName.length === 0 || customKeyValue.trim().length === 0 || isSaving}
								onClick={() => {
									void onSaveKey(customProviderName, customKeyValue).then(() => {
										setCustomKeyValue("");
									});
								}}
								type="button"
							>
								<LockKeyhole className="size-4" />
								保存自定义 key
							</Button>
						</SettingsActionBar>
					</motion.div>
				) : null}
			</SettingsGroup>
		</motion.div>
	);
}
