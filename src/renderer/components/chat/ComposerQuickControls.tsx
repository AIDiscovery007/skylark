import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { ArrowLeft, Bot, Brain, Check, type LucideIcon } from "lucide-react";
import { type ComponentProps, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { DesktopAgentModel } from "../../../shared/serialized-agent-event.ts";
import { DESKTOP_THINKING_LEVEL_OPTIONS, getDesktopThinkingLevelsForModel } from "../../../shared/thinking-levels.ts";
import type {
	DesktopAgentMode,
	DesktopOAuthProviderStatus,
	DesktopProviderKeyStatus,
	DesktopRuntimeCatalog,
	DesktopRuntimeCatalogModel,
	DesktopRuntimeCatalogProvider,
	DesktopSessionProfileUpdateInput,
	DesktopSettingsOpenRequest,
} from "../../../shared/types.ts";
import { cn } from "../../lib/utils.ts";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorTrigger,
} from "../ai-elements/model-selector.tsx";

type ModelPickerStep = "providers" | "models";

interface ComposerQuickControlsProps {
	agentMode?: DesktopAgentMode;
	disabled?: boolean;
	isStreaming: boolean;
	model?: DesktopAgentModel;
	oauthProviders?: DesktopOAuthProviderStatus[];
	onOpenSettings?: (request?: DesktopSettingsOpenRequest) => void;
	onSetSessionMode?: (agentMode: DesktopAgentMode) => Promise<void>;
	onUpdateSessionProfile?: (update: DesktopSessionProfileUpdateInput) => Promise<void>;
	providerKeys?: DesktopProviderKeyStatus[];
	runtimeCatalog?: DesktopRuntimeCatalog;
	thinkingLevel: ThinkingLevel;
}

interface StatusTriggerProps {
	disabled?: boolean;
	icon: LucideIcon;
	label: string;
	tone?: "idle" | "running";
}

type StatusTriggerButtonProps = StatusTriggerProps & Omit<ComponentProps<typeof Button>, "aria-label" | "children">;

type ProviderConfigurationStatus = "oauth" | "api_key" | "configured" | "unconfigured";

interface ProviderOption {
	provider: DesktopRuntimeCatalogProvider;
	status: ProviderConfigurationStatus;
	statusLabel: string;
	sortRank: number;
}

function getProviderStatusLabel(status: ProviderConfigurationStatus): string {
	if (status === "oauth") {
		return "已登录";
	}
	if (status === "api_key") {
		return "API key";
	}
	if (status === "configured") {
		return "已配置";
	}
	return "未配置";
}

function getProviderStatusDotClassName(status: ProviderConfigurationStatus): string {
	return cn(
		"inline-block size-2.5 shrink-0 rounded-full",
		status === "unconfigured" ? "bg-[color:var(--text-tertiary)] opacity-55" : "bg-[color:var(--success)]",
	);
}

function getProviderOptionStatus(
	provider: DesktopRuntimeCatalogProvider,
	configuredKeyProviders: ReadonlySet<string>,
	configuredOAuthProviders: ReadonlySet<string>,
): ProviderConfigurationStatus {
	if (provider.authMethods.includes("oauth") && configuredOAuthProviders.has(provider.id)) {
		return "oauth";
	}
	if (provider.authMethods.includes("api_key") && configuredKeyProviders.has(provider.id)) {
		return "api_key";
	}
	return provider.configured ? "configured" : "unconfigured";
}

function getProviderSortRank(status: ProviderConfigurationStatus): number {
	if (status === "oauth") {
		return 0;
	}
	if (status === "api_key" || status === "configured") {
		return 1;
	}
	return 2;
}

function formatProviderLabel(provider: DesktopRuntimeCatalogProvider): string {
	return provider.name && provider.name !== provider.id ? provider.name : provider.id;
}

function getProviderOptions(
	runtimeCatalog: DesktopRuntimeCatalog | undefined,
	providerKeys: DesktopProviderKeyStatus[] | undefined,
	oauthProviders: DesktopOAuthProviderStatus[] | undefined,
): ProviderOption[] {
	const configuredKeyProviders = new Set(
		(providerKeys ?? []).filter((providerKey) => providerKey.configured).map((providerKey) => providerKey.provider),
	);
	const configuredOAuthProviders = new Set(
		(oauthProviders ?? []).filter((provider) => provider.configured).map((provider) => provider.id),
	);
	return [...(runtimeCatalog?.providers ?? [])]
		.map((provider) => {
			const status = getProviderOptionStatus(provider, configuredKeyProviders, configuredOAuthProviders);
			return {
				provider,
				status,
				statusLabel: getProviderStatusLabel(status),
				sortRank: getProviderSortRank(status),
			};
		})
		.sort((left, right) => {
			if (left.sortRank !== right.sortRank) {
				return left.sortRank - right.sortRank;
			}
			return formatProviderLabel(left.provider).localeCompare(formatProviderLabel(right.provider));
		});
}

function getCurrentProvider(model: DesktopAgentModel | undefined, providers: readonly ProviderOption[]): string {
	if (model?.provider) {
		return model.provider;
	}
	return (
		providers.find((provider) => provider.status !== "unconfigured")?.provider.id ?? providers[0]?.provider.id ?? ""
	);
}

function getProviderModels(
	runtimeCatalog: DesktopRuntimeCatalog | undefined,
	providerId: string,
): DesktopRuntimeCatalogModel[] {
	return runtimeCatalog?.providers.find((provider) => provider.id === providerId)?.models ?? [];
}

function formatModelName(model: DesktopRuntimeCatalogModel): string {
	return model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id;
}

function StatusTrigger({
	className,
	disabled,
	icon: Icon,
	label,
	tone = "idle",
	...buttonProps
}: StatusTriggerButtonProps) {
	return (
		<Button
			{...buttonProps}
			aria-label={label}
			className={cn(
				"size-7 rounded-[var(--radius-md)] border border-transparent px-0 text-[color:var(--text-tertiary)] shadow-none hover:border-[color:var(--border-subtle)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)]",
				tone === "running" &&
					"bg-[color:color-mix(in_oklch,var(--info)_8%,transparent)] text-[color:var(--color-tool-running)]",
				className,
			)}
			data-slot="composer-status-icon"
			disabled={disabled}
			size="icon-xs"
			type="button"
			variant="ghost"
		>
			<Icon className="size-4" strokeWidth={2} />
		</Button>
	);
}

function ModelQuickControl({
	disabled,
	isStreaming,
	model,
	oauthProviders,
	onOpenSettings,
	onUpdateSessionProfile,
	providerKeys,
	runtimeCatalog,
}: ComposerQuickControlsProps) {
	const providers = useMemo(
		() => getProviderOptions(runtimeCatalog, providerKeys, oauthProviders),
		[oauthProviders, providerKeys, runtimeCatalog],
	);
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState<ModelPickerStep>("providers");
	const [selectedProvider, setSelectedProvider] = useState(() => getCurrentProvider(model, providers));
	const [providerFilter, setProviderFilter] = useState("");
	const [modelFilter, setModelFilter] = useState("");
	const [applyingModelId, setApplyingModelId] = useState<string | undefined>();
	const [errorMessage, setErrorMessage] = useState<string | undefined>();
	const currentModelLabel = model ? `${model.provider} / ${model.id}` : "Model unavailable";
	const isDisabled = disabled || isStreaming || (!onUpdateSessionProfile && !onOpenSettings);
	const selectedProviderModels = useMemo(
		() => getProviderModels(runtimeCatalog, selectedProvider),
		[runtimeCatalog, selectedProvider],
	);
	const filteredProviders = providers.filter((option) => {
		const query = providerFilter.trim().toLowerCase();
		if (!query) {
			return true;
		}
		return `${option.provider.id} ${option.provider.name} ${option.statusLabel}`.toLowerCase().includes(query);
	});
	const filteredModels = selectedProviderModels.filter((providerModel) => {
		const query = modelFilter.trim().toLowerCase();
		if (!query) {
			return true;
		}
		return `${providerModel.id} ${providerModel.name}`.toLowerCase().includes(query);
	});

	useEffect(() => {
		if (!open) {
			return;
		}
		setSelectedProvider(getCurrentProvider(model, providers));
		setStep("providers");
		setProviderFilter("");
		setModelFilter("");
		setErrorMessage(undefined);
	}, [model, open, providers]);

	const selectProvider = (option: ProviderOption): void => {
		if (option.status === "unconfigured") {
			setOpen(false);
			onOpenSettings?.({ section: "credentials", providerId: option.provider.id });
			return;
		}
		setSelectedProvider(option.provider.id);
		setStep("models");
	};

	const applyModel = async (modelId: string): Promise<void> => {
		if (!onUpdateSessionProfile || !selectedProvider) {
			return;
		}
		if (model?.provider === selectedProvider && model.id === modelId) {
			setOpen(false);
			return;
		}

		setApplyingModelId(modelId);
		setErrorMessage(undefined);
		try {
			await onUpdateSessionProfile({ provider: selectedProvider, modelId });
			setOpen(false);
		} catch (error: unknown) {
			setErrorMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setApplyingModelId(undefined);
		}
	};

	return (
		<ModelSelector onOpenChange={setOpen} open={open}>
			<ModelSelectorTrigger asChild>
				<StatusTrigger disabled={isDisabled} icon={Bot} label={`Model ${currentModelLabel}`} />
			</ModelSelectorTrigger>
			<ModelSelectorContent className="max-w-[26rem] shadow-[var(--uix-flat-shadow-floating)]" title="Session model">
				{step === "providers" ? (
					<>
						<ModelSelectorInput
							onValueChange={setProviderFilter}
							placeholder="Filter providers"
							value={providerFilter}
						/>
						<ModelSelectorList className="max-h-[20rem]">
							{runtimeCatalog === undefined ? (
								<ModelSelectorEmpty>Loading providers...</ModelSelectorEmpty>
							) : filteredProviders.length > 0 ? (
								<ModelSelectorGroup heading="Providers">
									{filteredProviders.map((option) => {
										const providerLabel = formatProviderLabel(option.provider);
										const isActive = model?.provider === option.provider.id;
										return (
											<ModelSelectorItem
												className={cn(
													"grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3",
													option.status === "unconfigured" && "text-muted-foreground",
												)}
												key={option.provider.id}
												onSelect={() => selectProvider(option)}
												value={`${providerLabel} ${option.provider.id} ${option.statusLabel}`}
											>
												<span className="min-w-0">
													<span className="flex min-w-0 items-center gap-2">
														<span className="truncate">{providerLabel}</span>
														{isActive ? <Check className="size-3.5 shrink-0" /> : null}
													</span>
													{providerLabel !== option.provider.id ? (
														<span className="block truncate text-xs text-muted-foreground">
															{option.provider.id}
														</span>
													) : null}
												</span>
												<span
													aria-label={`${providerLabel} ${option.statusLabel}`}
													className={getProviderStatusDotClassName(option.status)}
													data-provider-status={
														option.status === "unconfigured" ? "unconfigured" : "configured"
													}
													role="img"
													title={option.statusLabel}
												/>
											</ModelSelectorItem>
										);
									})}
								</ModelSelectorGroup>
							) : providers.length > 0 ? (
								<ModelSelectorEmpty>No providers match.</ModelSelectorEmpty>
							) : (
								<ModelSelectorEmpty>No providers available.</ModelSelectorEmpty>
							)}
						</ModelSelectorList>
					</>
				) : (
					<>
						<div className="flex items-center gap-2 px-1">
							<Button
								aria-label="Back to providers"
								onClick={() => setStep("providers")}
								size="icon-xs"
								type="button"
								variant="ghost"
							>
								<ArrowLeft className="size-3.5" />
							</Button>
							<p className="min-w-0 truncate text-sm font-medium text-foreground">{selectedProvider}</p>
						</div>
						<ModelSelectorInput onValueChange={setModelFilter} placeholder="Filter models" value={modelFilter} />
						<ModelSelectorList className="max-h-[19rem]">
							{filteredModels.length > 0 ? (
								<ModelSelectorGroup heading="Models">
									{filteredModels.map((providerModel) => {
										const isActive = model?.provider === selectedProvider && model.id === providerModel.id;
										const isApplying = applyingModelId === providerModel.id;
										return (
											<ModelSelectorItem
												className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
												disabled={applyingModelId !== undefined}
												key={providerModel.id}
												onSelect={() => void applyModel(providerModel.id)}
												value={`${providerModel.id} ${providerModel.name}`}
											>
												<span className="min-w-0">
													<span className="block truncate">{formatModelName(providerModel)}</span>
													{providerModel.reasoning ? (
														<span className="text-xs text-muted-foreground">reasoning</span>
													) : null}
												</span>
												{isApplying ? (
													<Spinner className="size-3.5 shrink-0" label={`Applying ${providerModel.id}`} />
												) : isActive ? (
													<Check className="size-3.5 shrink-0" />
												) : null}
											</ModelSelectorItem>
										);
									})}
								</ModelSelectorGroup>
							) : (
								<ModelSelectorEmpty>No models match.</ModelSelectorEmpty>
							)}
						</ModelSelectorList>
					</>
				)}
				{errorMessage ? <p className="px-3.5 py-2 text-xs text-destructive">{errorMessage}</p> : null}
			</ModelSelectorContent>
		</ModelSelector>
	);
}

function PlanModeQuickControl({
	agentMode = "execute",
	disabled,
	isStreaming,
	onSetSessionMode,
}: ComposerQuickControlsProps) {
	const [applyingMode, setApplyingMode] = useState<DesktopAgentMode | undefined>();
	const isDisabled = disabled || isStreaming || !onSetSessionMode;
	const isApplying = applyingMode !== undefined;
	const visualMode = applyingMode ?? agentMode;
	const isPlanMode = visualMode === "plan";
	const nextMode: DesktopAgentMode = agentMode === "plan" ? "execute" : "plan";

	const togglePlanMode = async (): Promise<void> => {
		if (!onSetSessionMode || isApplying) {
			return;
		}
		setApplyingMode(nextMode);
		try {
			await onSetSessionMode(nextMode);
		} finally {
			setApplyingMode(undefined);
		}
	};

	return (
		<Button
			aria-label={isPlanMode ? "Turn off plan mode" : "Turn on plan mode"}
			aria-pressed={isPlanMode}
			className={cn(
				"h-7 shrink-0 rounded-[var(--radius-md)] border px-2 text-[12px] font-medium shadow-none transition-colors",
				isPlanMode
					? "border-[color:color-mix(in_oklch,var(--info)_24%,transparent)] bg-[color:color-mix(in_oklch,var(--info)_10%,transparent)] text-[color:var(--color-tool-running)] hover:bg-[color:color-mix(in_oklch,var(--info)_14%,transparent)]"
					: "border-transparent text-[color:var(--text-tertiary)] hover:border-[color:var(--border-subtle)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)]",
			)}
			aria-busy={isApplying}
			data-slot="composer-mode-control"
			disabled={isDisabled}
			onClick={() => void togglePlanMode().catch(() => undefined)}
			size="xs"
			type="button"
			variant="ghost"
		>
			<span>Plan</span>
		</Button>
	);
}

function ThinkingQuickControl({
	disabled,
	isStreaming,
	model,
	onUpdateSessionProfile,
	thinkingLevel,
}: ComposerQuickControlsProps) {
	const [open, setOpen] = useState(false);
	const [applyingLevel, setApplyingLevel] = useState<ThinkingLevel | undefined>();
	const [errorMessage, setErrorMessage] = useState<string | undefined>();
	const availableLevels = getDesktopThinkingLevelsForModel(model);
	const isDisabled = disabled || isStreaming || !onUpdateSessionProfile;

	const applyThinkingLevel = async (level: ThinkingLevel): Promise<void> => {
		if (!onUpdateSessionProfile) {
			return;
		}
		if (level === thinkingLevel) {
			setOpen(false);
			return;
		}

		setApplyingLevel(level);
		setErrorMessage(undefined);
		try {
			await onUpdateSessionProfile({ thinkingLevel: level });
			setOpen(false);
		} catch (error: unknown) {
			setErrorMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setApplyingLevel(undefined);
		}
	};

	return (
		<Popover
			onOpenChange={(nextOpen: boolean) => {
				setOpen(nextOpen);
				if (nextOpen) {
					setErrorMessage(undefined);
				}
			}}
			open={open}
		>
			<PopoverTrigger asChild>
				<StatusTrigger disabled={isDisabled} icon={Brain} label={`Thinking ${thinkingLevel}`} />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-56 shadow-[var(--uix-flat-shadow-floating)]" side="top">
				<div className="space-y-0.5 p-2.5">
					{DESKTOP_THINKING_LEVEL_OPTIONS.map((level) => {
						const isAvailable = availableLevels.includes(level);
						const isActive = thinkingLevel === level;
						const isApplying = applyingLevel === level;
						return (
							<button
								className={cn(
									"flex h-8 w-full items-center justify-between rounded-[var(--radius-md)] px-2.5 text-left text-[13px] leading-4 text-[color:var(--text-primary)] transition-colors hover:bg-[color:var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[var(--control-focus-shadow)] disabled:cursor-not-allowed disabled:text-[color:var(--text-tertiary)] disabled:opacity-50",
									isActive && "bg-[color:var(--surface-2)]",
								)}
								disabled={!isAvailable || applyingLevel !== undefined}
								key={level}
								onClick={() => void applyThinkingLevel(level)}
								type="button"
							>
								<span>{level}</span>
								{isApplying ? (
									<Spinner className="size-3.5" label={`Applying thinking ${level}`} />
								) : isActive ? (
									<Check className="size-3.5 text-[color:var(--text-secondary)]" />
								) : null}
							</button>
						);
					})}
				</div>
				{errorMessage ? (
					<p className="px-3 py-2 pb-2.5 text-[12px] leading-4 text-destructive">{errorMessage}</p>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

export function ComposerQuickControls(props: ComposerQuickControlsProps) {
	return (
		<>
			<PlanModeQuickControl {...props} />
			<ModelQuickControl {...props} />
			<ThinkingQuickControl {...props} />
		</>
	);
}
