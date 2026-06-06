import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { Bot, Brain, Check, ChevronDown, type LucideIcon } from "lucide-react";
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
	ModelSelectorLogo,
	ModelSelectorName,
	ModelSelectorTrigger,
} from "../ai-elements/model-selector.tsx";

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

const DEFAULT_MODEL_SELECTOR_PROVIDER_LIMIT = 3;
const DEFAULT_MODEL_SELECTOR_MODELS_PER_PROVIDER = 8;

interface ProviderOption {
	provider: DesktopRuntimeCatalogProvider;
	status: ProviderConfigurationStatus;
	statusLabel: string;
	sortRank: number;
}

interface ModelOption {
	model: DesktopRuntimeCatalogModel;
	provider: DesktopRuntimeCatalogProvider;
	providerLabel: string;
	status: ProviderConfigurationStatus;
	statusLabel: string;
}

interface ModelGroup {
	options: ModelOption[];
	provider: DesktopRuntimeCatalogProvider;
	providerLabel: string;
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

function formatModelName(model: DesktopRuntimeCatalogModel): string {
	return model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id;
}

function formatModelTriggerName(model: DesktopAgentModel | undefined): string {
	if (!model) {
		return "Model";
	}
	return model.name && model.name !== model.id ? model.name : model.id;
}

function getModelGroups(providers: readonly ProviderOption[]): ModelGroup[] {
	return providers.flatMap((option) => {
		const providerLabel = formatProviderLabel(option.provider);
		const options = option.provider.models.map((providerModel) => ({
			model: providerModel,
			provider: option.provider,
			providerLabel,
			status: option.status,
			statusLabel: option.statusLabel,
		}));
		return options.length > 0 ? [{ options, provider: option.provider, providerLabel }] : [];
	});
}

function getDefaultModelGroups(
	modelGroups: readonly ModelGroup[],
	currentProviderId: string,
	currentModelId: string | undefined,
): ModelGroup[] {
	const defaultProviderIds = new Set<string>();
	for (const group of modelGroups) {
		if (group.provider.id === currentProviderId || group.options.some((option) => option.status !== "unconfigured")) {
			defaultProviderIds.add(group.provider.id);
		}
	}
	for (const group of modelGroups) {
		if (defaultProviderIds.size >= DEFAULT_MODEL_SELECTOR_PROVIDER_LIMIT) {
			break;
		}
		defaultProviderIds.add(group.provider.id);
	}
	return modelGroups
		.filter((group) => defaultProviderIds.has(group.provider.id))
		.map((group) => limitDefaultModelGroup(group, currentProviderId, currentModelId));
}

function limitDefaultModelGroup(
	group: ModelGroup,
	currentProviderId: string,
	currentModelId: string | undefined,
): ModelGroup {
	const visibleOptions = group.options.slice(0, DEFAULT_MODEL_SELECTOR_MODELS_PER_PROVIDER);
	if (group.provider.id !== currentProviderId || !currentModelId) {
		return { ...group, options: visibleOptions };
	}
	const activeOption = group.options.find((option) => option.model.id === currentModelId);
	if (!activeOption || visibleOptions.some((option) => option.model.id === currentModelId)) {
		return { ...group, options: visibleOptions };
	}
	return {
		...group,
		options: [activeOption, ...visibleOptions.slice(0, DEFAULT_MODEL_SELECTOR_MODELS_PER_PROVIDER - 1)],
	};
}

function normalizeModelSearchValue(option: ModelOption): string {
	return `${option.model.id} ${option.model.name} ${option.providerLabel} ${option.provider.id} ${option.statusLabel}`.toLocaleLowerCase();
}

function getFilteredModelGroups(modelGroups: readonly ModelGroup[], query: string): ModelGroup[] {
	const queryTokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
	if (queryTokens.length === 0) {
		return [...modelGroups];
	}
	return modelGroups.flatMap((group) => {
		const options = group.options.filter((option) => {
			const searchValue = normalizeModelSearchValue(option);
			return queryTokens.every((token) => searchValue.includes(token));
		});
		return options.length > 0 ? [{ ...group, options }] : [];
	});
}

function ProviderLogo({ className, providerId }: { className?: string; providerId?: string }) {
	if (!providerId) {
		return (
			<span
				className={cn(
					"grid size-4 shrink-0 place-items-center rounded-full bg-[color:var(--surface-2)] text-[color:var(--text-tertiary)]",
					className,
				)}
			>
				<Bot className="size-3" />
			</span>
		);
	}

	return (
		<span
			className={cn(
				"relative grid size-4 shrink-0 place-items-center overflow-hidden rounded-full bg-[color:var(--surface-2)] text-[color:var(--text-tertiary)]",
				className,
			)}
		>
			<Bot className="size-3" />
			<ModelSelectorLogo
				className="absolute inset-0 size-4 bg-[color:var(--surface-1)] p-0 dark:invert"
				onError={(event) => {
					event.currentTarget.style.display = "none";
				}}
				provider={providerId}
			/>
		</span>
	);
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
	const modelGroups = useMemo(() => getModelGroups(providers), [providers]);
	const [open, setOpen] = useState(false);
	const [modelQuery, setModelQuery] = useState("");
	const [applyingModelKey, setApplyingModelKey] = useState<string | undefined>();
	const [errorMessage, setErrorMessage] = useState<string | undefined>();
	const currentModelLabel = model ? `${model.provider} / ${model.id}` : "Model unavailable";
	const currentModelName = formatModelTriggerName(model);
	const currentProviderId = model?.provider ?? getCurrentProvider(model, providers);
	const displayedModelGroups = useMemo(() => {
		const trimmedQuery = modelQuery.trim();
		if (trimmedQuery.length > 0) {
			return getFilteredModelGroups(modelGroups, trimmedQuery);
		}
		return getDefaultModelGroups(modelGroups, currentProviderId, model?.id);
	}, [currentProviderId, model?.id, modelGroups, modelQuery]);
	const isDisabled = disabled || isStreaming || (!onUpdateSessionProfile && !onOpenSettings);

	useEffect(() => {
		if (!open) {
			return;
		}
		setErrorMessage(undefined);
	}, [open]);

	const handleModelSelectorOpenChange = (nextOpen: boolean): void => {
		setOpen(nextOpen);
		if (!nextOpen) {
			setModelQuery("");
		}
	};

	const closeModelSelector = (): void => {
		setOpen(false);
		setModelQuery("");
	};

	const applyModel = async (option: ModelOption): Promise<void> => {
		if (option.status === "unconfigured") {
			closeModelSelector();
			onOpenSettings?.({ section: "credentials", providerId: option.provider.id });
			return;
		}
		if (!onUpdateSessionProfile) {
			return;
		}
		if (model?.provider === option.provider.id && model.id === option.model.id) {
			closeModelSelector();
			return;
		}

		const nextModelKey = `${option.provider.id}:${option.model.id}`;
		setApplyingModelKey(nextModelKey);
		setErrorMessage(undefined);
		try {
			await onUpdateSessionProfile({ provider: option.provider.id, modelId: option.model.id });
			closeModelSelector();
		} catch (error: unknown) {
			setErrorMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setApplyingModelKey(undefined);
		}
	};

	return (
		<ModelSelector onOpenChange={handleModelSelectorOpenChange} open={open}>
			<ModelSelectorTrigger asChild>
				<Button
					aria-label={`Model ${currentModelLabel}`}
					className="h-7 min-w-0 max-w-[13rem] gap-1.5 rounded-[var(--radius-md)] border border-transparent px-2 text-[12px] font-medium text-[color:var(--text-tertiary)] shadow-none hover:border-[color:var(--border-subtle)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)]"
					data-slot="composer-model-selector-trigger"
					disabled={isDisabled}
					size="xs"
					title={`Model ${currentModelLabel}`}
					type="button"
					variant="ghost"
				>
					<ProviderLogo providerId={currentProviderId} />
					<ModelSelectorName className="max-w-[8.5rem] flex-none text-[12px]">
						{currentModelName}
					</ModelSelectorName>
					<ChevronDown className="size-3 shrink-0 opacity-65" />
				</Button>
			</ModelSelectorTrigger>
			<ModelSelectorContent className="max-w-[26rem] shadow-[var(--uix-flat-shadow-floating)]" title="Session model">
				<ModelSelectorInput onValueChange={setModelQuery} placeholder="Filter models" value={modelQuery} />
				<ModelSelectorList className="max-h-[22rem]">
					{runtimeCatalog === undefined ? (
						<ModelSelectorEmpty>Loading models...</ModelSelectorEmpty>
					) : displayedModelGroups.length > 0 ? (
						<>
							<ModelSelectorEmpty>No models match.</ModelSelectorEmpty>
							{displayedModelGroups.map((group) => (
								<ModelSelectorGroup heading={group.providerLabel} key={group.provider.id}>
									{group.options.map((option) => {
										const itemKey = `${option.provider.id}:${option.model.id}`;
										const isActive = model?.provider === option.provider.id && model.id === option.model.id;
										const isApplying = applyingModelKey === itemKey;
										return (
											<ModelSelectorItem
												aria-label={`${formatModelName(option.model)} ${option.providerLabel} ${option.statusLabel}`}
												className={cn(
													"grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5",
													option.status === "unconfigured" && "text-muted-foreground",
												)}
												disabled={applyingModelKey !== undefined}
												key={itemKey}
												onSelect={() => void applyModel(option)}
												value={`${option.model.id} ${option.model.name} ${option.providerLabel} ${option.provider.id} ${option.statusLabel}`}
											>
												<ProviderLogo providerId={option.provider.id} />
												<ModelSelectorName className="block min-w-0">
													<span className="block truncate">{formatModelName(option.model)}</span>
													{option.model.reasoning ? (
														<span className="block truncate text-xs text-muted-foreground">
															reasoning
														</span>
													) : null}
												</ModelSelectorName>
												{isApplying ? (
													<Spinner className="size-3.5 shrink-0" label={`Applying ${option.model.id}`} />
												) : isActive ? (
													<Check className="size-3.5 shrink-0" />
												) : null}
											</ModelSelectorItem>
										);
									})}
								</ModelSelectorGroup>
							))}
						</>
					) : (
						<ModelSelectorEmpty>No models available.</ModelSelectorEmpty>
					)}
				</ModelSelectorList>
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
