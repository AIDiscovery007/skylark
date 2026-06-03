import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { Bot, Cpu, FileText, Save, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { normalizeDesktopProviderIdentifier } from "../../../shared/provider-id.ts";
import {
	DEFAULT_DESKTOP_COMPACT_INSTRUCTION,
	type DesktopEventManagementCriteria,
	type DesktopEventManagementCriteriaUpdateRequest,
	type DesktopRuntimeCatalog,
	type DesktopSettingsData,
} from "../../../shared/types.ts";
import { THINKING_LEVEL_OPTIONS } from "../../stores/settings-store.ts";
import { SettingsGroup, SettingsRow } from "./SettingsList.tsx";

function normalizeValue(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeProviderValue(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return undefined;
	}

	return normalizeDesktopProviderIdentifier(trimmed);
}

interface GeneralSettingsProps {
	eventManagementCriteria?: DesktopEventManagementCriteria;
	settings: DesktopSettingsData;
	runtimeCatalog?: DesktopRuntimeCatalog;
	isLoading: boolean;
	isSaving: boolean;
	onSave: (settings: {
		defaultProvider?: string;
		defaultModel?: string;
		defaultThinkingLevel?: ThinkingLevel;
		showThinkingBlocks?: boolean;
		compactInstruction?: string;
		globalAgentsInstruction?: string;
	}) => Promise<void>;
	onSaveEventManagementCriteria: (
		request: DesktopEventManagementCriteriaUpdateRequest,
	) => Promise<DesktopEventManagementCriteria | undefined>;
}

interface SelectOption {
	value: string;
	label: string;
}

const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
	off: "关闭",
	minimal: "最小",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "极高",
};

function getProviderOptions(
	runtimeCatalog: DesktopRuntimeCatalog | undefined,
	currentProvider?: string,
): SelectOption[] {
	const options =
		runtimeCatalog?.providers.map((provider) => {
			const requiredAuth = provider.authMethods.includes("oauth") ? "需要登录" : "需要 key";
			return {
				value: provider.id,
				label: provider.configured ? provider.id : `${provider.id} (${requiredAuth})`,
			};
		}) ?? [];

	if (currentProvider && !options.some((option) => option.value === currentProvider)) {
		options.push({
			value: currentProvider,
			label: `${currentProvider} (不可用)`,
		});
	}

	return options;
}

function getModelOptions(
	runtimeCatalog: DesktopRuntimeCatalog | undefined,
	providerId?: string,
	currentModel?: string,
): SelectOption[] {
	const provider = runtimeCatalog?.providers.find((entry) => entry.id === providerId);
	const options =
		provider?.models.map((model) => ({
			value: model.id,
			label: model.reasoning ? `${model.id} (支持推理)` : model.id,
		})) ?? [];

	if (currentModel && !options.some((option) => option.value === currentModel)) {
		options.push({
			value: currentModel,
			label: `${currentModel} (不可用)`,
		});
	}

	return options;
}

export function GeneralSettings({
	eventManagementCriteria,
	settings,
	runtimeCatalog,
	isLoading,
	isSaving,
	onSave,
	onSaveEventManagementCriteria,
}: GeneralSettingsProps) {
	const persistedCompactInstruction = settings.compactInstruction ?? DEFAULT_DESKTOP_COMPACT_INSTRUCTION;
	const persistedGlobalAgentsInstruction = settings.globalAgentsInstruction ?? "";
	const persistedEventManagementCriteria = eventManagementCriteria?.content ?? "";
	const [defaultProvider, setDefaultProvider] = useState(normalizeProviderValue(settings.defaultProvider) ?? "");
	const [defaultModel, setDefaultModel] = useState(settings.defaultModel ?? "");
	const [defaultThinkingLevel, setDefaultThinkingLevel] = useState<ThinkingLevel>(
		settings.defaultThinkingLevel ?? "off",
	);
	const [showThinkingBlocks, setShowThinkingBlocks] = useState(settings.showThinkingBlocks ?? false);
	const [compactInstruction, setCompactInstruction] = useState(persistedCompactInstruction);
	const [globalAgentsInstruction, setGlobalAgentsInstruction] = useState(persistedGlobalAgentsInstruction);
	const [eventManagementCriteriaContent, setEventManagementCriteriaContent] = useState(
		persistedEventManagementCriteria,
	);
	const wasLoading = useRef(isLoading);
	const lastPersistedCompactInstruction = useRef(persistedCompactInstruction);
	const lastPersistedGlobalAgentsInstruction = useRef(persistedGlobalAgentsInstruction);
	const lastPersistedEventManagementCriteria = useRef(persistedEventManagementCriteria);
	const hasEditedCompactInstruction = useRef(false);
	const hasEditedGlobalAgentsInstruction = useRef(false);
	const hasEditedEventManagementCriteria = useRef(false);

	useEffect(() => {
		const didFinishLoading = wasLoading.current && !isLoading;
		wasLoading.current = isLoading;
		setDefaultProvider(normalizeProviderValue(settings.defaultProvider) ?? "");
		setDefaultModel(settings.defaultModel ?? "");
		setDefaultThinkingLevel(settings.defaultThinkingLevel ?? "off");
		setShowThinkingBlocks(settings.showThinkingBlocks ?? false);
		setCompactInstruction((current) => {
			const previousPersistedCompactInstruction = lastPersistedCompactInstruction.current;
			lastPersistedCompactInstruction.current = persistedCompactInstruction;
			if (
				didFinishLoading ||
				!hasEditedCompactInstruction.current ||
				current === previousPersistedCompactInstruction ||
				persistedCompactInstruction !== previousPersistedCompactInstruction
			) {
				hasEditedCompactInstruction.current = false;
				return persistedCompactInstruction;
			}
			return current;
		});
		setGlobalAgentsInstruction((current) => {
			const previousPersistedGlobalAgentsInstruction = lastPersistedGlobalAgentsInstruction.current;
			lastPersistedGlobalAgentsInstruction.current = persistedGlobalAgentsInstruction;
			if (
				didFinishLoading ||
				!hasEditedGlobalAgentsInstruction.current ||
				current === previousPersistedGlobalAgentsInstruction ||
				persistedGlobalAgentsInstruction !== previousPersistedGlobalAgentsInstruction
			) {
				hasEditedGlobalAgentsInstruction.current = false;
				return persistedGlobalAgentsInstruction;
			}
			return current;
		});
		setEventManagementCriteriaContent((current) => {
			const previousPersistedEventManagementCriteria = lastPersistedEventManagementCriteria.current;
			lastPersistedEventManagementCriteria.current = persistedEventManagementCriteria;
			if (
				didFinishLoading ||
				!hasEditedEventManagementCriteria.current ||
				current === previousPersistedEventManagementCriteria ||
				persistedEventManagementCriteria !== previousPersistedEventManagementCriteria
			) {
				hasEditedEventManagementCriteria.current = false;
				return persistedEventManagementCriteria;
			}
			return current;
		});
	}, [
		isLoading,
		settings.defaultModel,
		settings.defaultProvider,
		settings.defaultThinkingLevel,
		settings.showThinkingBlocks,
		persistedCompactInstruction,
		persistedGlobalAgentsInstruction,
		persistedEventManagementCriteria,
	]);

	const providerOptions = useMemo(
		() => getProviderOptions(runtimeCatalog, normalizeProviderValue(defaultProvider)),
		[defaultProvider, runtimeCatalog],
	);
	const modelOptions = useMemo(
		() => getModelOptions(runtimeCatalog, normalizeProviderValue(defaultProvider), normalizeValue(defaultModel)),
		[defaultModel, defaultProvider, runtimeCatalog],
	);
	const selectedProvider = runtimeCatalog?.providers.find(
		(provider) => provider.id === normalizeProviderValue(defaultProvider),
	);

	useEffect(() => {
		if (!normalizeProviderValue(defaultProvider)) {
			if (defaultModel !== "") {
				setDefaultModel("");
			}
			return;
		}

		if (modelOptions.length === 0) {
			if (defaultModel !== "") {
				setDefaultModel("");
			}
			return;
		}

		const normalizedModel = normalizeValue(defaultModel);
		if (normalizedModel && !modelOptions.some((option) => option.value === normalizedModel)) {
			setDefaultModel(modelOptions[0]?.value ?? "");
		}
	}, [defaultModel, defaultProvider, modelOptions]);

	const normalizedCompactInstruction = normalizeValue(compactInstruction) ?? DEFAULT_DESKTOP_COMPACT_INSTRUCTION;
	const normalizedGlobalAgentsInstruction = normalizeValue(globalAgentsInstruction);
	const normalizedEventManagementCriteria = normalizeValue(eventManagementCriteriaContent);
	const isCompactInstructionDirty = normalizedCompactInstruction !== persistedCompactInstruction;
	const isGlobalAgentsInstructionDirty =
		(normalizedGlobalAgentsInstruction ?? "") !== persistedGlobalAgentsInstruction;
	const isEventManagementCriteriaDirty =
		(normalizedEventManagementCriteria ?? "") !== persistedEventManagementCriteria;

	const saveGeneralSettings = (changes: {
		defaultProvider?: string;
		defaultModel?: string;
		defaultThinkingLevel?: ThinkingLevel;
		showThinkingBlocks?: boolean;
	}): void => {
		void onSave({
			defaultProvider: normalizeProviderValue(changes.defaultProvider ?? defaultProvider),
			defaultModel: normalizeValue(changes.defaultModel ?? defaultModel),
			defaultThinkingLevel: changes.defaultThinkingLevel ?? defaultThinkingLevel,
			showThinkingBlocks: changes.showThinkingBlocks ?? showThinkingBlocks,
		});
	};

	const handleDefaultProviderChange = (value: string): void => {
		const normalizedProvider = normalizeProviderValue(value);
		const nextModelOptions = getModelOptions(runtimeCatalog, normalizedProvider);
		const nextDefaultModel = nextModelOptions[0]?.value ?? "";
		setDefaultProvider(value);
		setDefaultModel(nextDefaultModel);
		saveGeneralSettings({ defaultProvider: value, defaultModel: nextDefaultModel });
	};

	const handleDefaultModelChange = (value: string): void => {
		setDefaultModel(value);
		saveGeneralSettings({ defaultModel: value });
	};

	const handleDefaultThinkingLevelChange = (value: ThinkingLevel): void => {
		setDefaultThinkingLevel(value);
		saveGeneralSettings({ defaultThinkingLevel: value });
	};

	const handleShowThinkingBlocksChange = (value: boolean): void => {
		setShowThinkingBlocks(value);
		saveGeneralSettings({ showThinkingBlocks: value });
	};

	const saveCompactInstruction = (): void => {
		void onSave({
			compactInstruction: normalizedCompactInstruction,
		});
	};

	const saveGlobalAgentsInstruction = (): void => {
		void onSave({
			globalAgentsInstruction: normalizedGlobalAgentsInstruction,
		});
	};

	const saveEventManagementCriteria = (): void => {
		if (!normalizedEventManagementCriteria) {
			return;
		}
		void onSaveEventManagementCriteria({
			content: normalizedEventManagementCriteria,
		});
	};

	if (isLoading) {
		return (
			<SettingsGroup>
				<div className="space-y-4 px-5 py-5">
					<Skeleton className="h-5 w-40" />
					<Skeleton className="h-10 w-full rounded-lg" />
					<Skeleton className="h-10 w-full rounded-lg" />
					<Skeleton className="h-10 w-full rounded-lg" />
				</div>
			</SettingsGroup>
		);
	}

	return (
		<SettingsGroup>
			<SettingsRow
				contentClassName="w-full sm:w-[280px]"
				description="新建对话默认使用的模型服务商。"
				icon={Bot}
				id="default-provider"
				title="默认 Provider"
			>
				<Select onValueChange={handleDefaultProviderChange} value={defaultProvider || undefined}>
					<SelectTrigger className="h-9 w-full rounded-lg bg-background/80" id="default-provider">
						<SelectValue placeholder="选择 Provider" />
					</SelectTrigger>
					<SelectContent>
						{providerOptions.length > 0 ? (
							providerOptions.map((providerOption) => (
								<SelectItem key={providerOption.value} value={providerOption.value}>
									{providerOption.label}
								</SelectItem>
							))
						) : (
							<SelectItem disabled value="__no-provider">
								暂无可用 Provider
							</SelectItem>
						)}
					</SelectContent>
				</Select>
			</SettingsRow>

			<SettingsRow
				contentClassName="w-full sm:w-[280px]"
				description={
					selectedProvider
						? selectedProvider.configured
							? `${selectedProvider.id} 当前有 ${selectedProvider.models.length} 个可用模型。`
							: `${selectedProvider.id} 尚未配置，使用前需要${
									selectedProvider.authMethods.includes("oauth") ? "登录" : "添加 API key"
								}。`
						: "选择 Provider 后再指定默认模型。"
				}
				icon={Cpu}
				id="default-model"
				title="默认模型"
			>
				<Select
					disabled={!normalizeProviderValue(defaultProvider) || modelOptions.length === 0}
					onValueChange={handleDefaultModelChange}
					value={defaultModel || undefined}
				>
					<SelectTrigger className="h-9 w-full rounded-lg bg-background/80" id="default-model">
						<SelectValue placeholder={normalizeProviderValue(defaultProvider) ? "选择模型" : "先选择 Provider"} />
					</SelectTrigger>
					<SelectContent>
						{modelOptions.length > 0 ? (
							modelOptions.map((modelOption) => (
								<SelectItem key={modelOption.value} value={modelOption.value}>
									{modelOption.label}
								</SelectItem>
							))
						) : (
							<SelectItem disabled value="__no-model">
								暂无可用模型
							</SelectItem>
						)}
					</SelectContent>
				</Select>
			</SettingsRow>

			<SettingsRow
				contentClassName="w-full sm:w-[280px]"
				description="控制默认推理强度；越高越适合复杂任务，但响应会更慢。"
				icon={Sparkles}
				id="default-thinking"
				title="推理强度"
			>
				<Select
					onValueChange={(value: string) => handleDefaultThinkingLevelChange(value as ThinkingLevel)}
					value={defaultThinkingLevel}
				>
					<SelectTrigger className="h-9 w-full rounded-lg bg-background/80" id="default-thinking">
						<SelectValue placeholder="选择推理强度" />
					</SelectTrigger>
					<SelectContent>
						{THINKING_LEVEL_OPTIONS.map((thinkingLevelOption) => (
							<SelectItem key={thinkingLevelOption} value={thinkingLevelOption}>
								{THINKING_LEVEL_LABELS[thinkingLevelOption]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</SettingsRow>

			<SettingsRow
				contentClassName="flex justify-start sm:justify-end"
				description="关闭后对话记录更安静，只保留最终回复和工具结果。"
				icon={Sparkles}
				id="show-thinking-blocks"
				title="显示推理内容"
			>
				<Switch
					checked={showThinkingBlocks}
					id="show-thinking-blocks"
					onCheckedChange={handleShowThinkingBlocksChange}
				/>
			</SettingsRow>

			<SettingsRow
				className="py-4"
				contentClassName="w-full"
				description="保存到 Agent Home 的 COMPACT.md；/compact 后仍可追加临时指令覆盖本次任务。"
				icon={FileText}
				id="compact-instruction"
				layout="stacked"
				title="Compact 指令"
			>
				<div className="space-y-3">
					<Textarea
						aria-label="Compact 指令"
						className="uix-flat-field h-32 field-sizing-fixed resize-none overflow-y-auto px-[var(--uix-flat-field-padding-x)] py-[var(--uix-flat-field-padding-y)] text-[13px] leading-5"
						id="compact-instruction"
						onChange={(event) => {
							hasEditedCompactInstruction.current = true;
							setCompactInstruction(event.currentTarget.value);
						}}
						value={compactInstruction}
					/>
					<div className="flex justify-end">
						<Button
							disabled={!isCompactInstructionDirty || isSaving}
							onClick={saveCompactInstruction}
							type="button"
						>
							<Save className="size-4" />
							保存
						</Button>
					</div>
				</div>
			</SettingsRow>

			<SettingsRow
				className="py-4"
				contentClassName="w-full"
				description="保存到 Agent Home 的 AGENTS.md；项目内 AGENTS.md 仍会继续补充。"
				icon={FileText}
				id="global-agents-instruction"
				layout="stacked"
				title="全局 AGENTS.md 指令"
			>
				<div className="space-y-3">
					<Textarea
						aria-label="全局 AGENTS.md 指令"
						className="uix-flat-field h-72 field-sizing-fixed resize-none overflow-y-auto px-[var(--uix-flat-field-padding-x)] py-[var(--uix-flat-field-padding-y)] font-mono text-[13px] leading-5"
						id="global-agents-instruction"
						onChange={(event) => {
							hasEditedGlobalAgentsInstruction.current = true;
							setGlobalAgentsInstruction(event.currentTarget.value);
						}}
						placeholder="写入所有项目都应遵守的全局指令。"
						value={globalAgentsInstruction}
					/>
					<div className="flex justify-end">
						<Button
							disabled={!isGlobalAgentsInstructionDirty || isSaving}
							onClick={saveGlobalAgentsInstruction}
							type="button"
						>
							<Save className="size-4" />
							保存
						</Button>
					</div>
				</div>
			</SettingsRow>

			<SettingsRow
				className="py-4"
				contentClassName="w-full"
				description="保存到 Agent Home 的 events/EVENTS.md；整理事件时用于排优先级、断舍离和评论建议。"
				icon={FileText}
				id="event-management-criteria"
				layout="stacked"
				title="事件 EVENTS.md 准则"
			>
				<div className="space-y-3">
					<Textarea
						aria-label="事件 EVENTS.md 准则"
						className="uix-flat-field h-48 field-sizing-fixed resize-none overflow-y-auto px-[var(--uix-flat-field-padding-x)] py-[var(--uix-flat-field-padding-y)] font-mono text-[13px] leading-5"
						id="event-management-criteria"
						onChange={(event) => {
							hasEditedEventManagementCriteria.current = true;
							setEventManagementCriteriaContent(event.currentTarget.value);
						}}
						placeholder="写入整理事件时应遵守的判断准则。"
						value={eventManagementCriteriaContent}
					/>
					<div className="flex justify-end">
						<Button
							disabled={!normalizedEventManagementCriteria || !isEventManagementCriteriaDirty || isSaving}
							onClick={saveEventManagementCriteria}
							type="button"
						>
							<Save className="size-4" />
							保存
						</Button>
					</div>
				</div>
			</SettingsRow>
		</SettingsGroup>
	);
}
