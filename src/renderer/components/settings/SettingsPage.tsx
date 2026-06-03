import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, KeyRound, Palette, Settings2, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusDot } from "@/components/ui/status-dot";
import { subtleReveal } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type {
	DesktopEventManagementCriteria,
	DesktopEventManagementCriteriaUpdateRequest,
	DesktopOAuthProviderStatus,
	DesktopPermissionApprovalSettings,
	DesktopProviderKeyStatus,
	DesktopProviderKeyTestResult,
	DesktopRuntimeCatalog,
	DesktopSettingsData,
	DesktopSettingsOpenRequest,
	DesktopSettingsSectionId,
	DesktopStorageSecurityState,
} from "../../../shared/types.ts";
import type { OAuthLoginState } from "../../stores/settings-store.ts";
import { ApiKeySettings } from "./ApiKeySettings.tsx";
import { AppearanceSettings } from "./AppearanceSettings.tsx";
import { GeneralSettings } from "./GeneralSettings.tsx";
import { PermissionSettings } from "./PermissionSettings.tsx";

interface SettingsNavItem {
	description: string;
	icon: LucideIcon;
	id: DesktopSettingsSectionId;
	label: string;
}

const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
	{
		id: "general",
		label: "常规",
		description: "设置新建对话默认使用的模型、推理强度和消息呈现方式。",
		icon: Settings2,
	},
	{
		id: "appearance",
		label: "外观",
		description: "配置浅色、深色和系统主题下的颜色、字体、侧栏透明度和对比度。",
		icon: Palette,
	},
	{
		id: "permissions",
		label: "权限",
		description: "控制 Agent 执行本地命令、文件修改和 MCP 调用前的确认策略。",
		icon: ShieldCheck,
	},
	{
		id: "credentials",
		label: "凭据",
		description: "管理订阅登录、本机 API key 和 provider 配置状态。",
		icon: KeyRound,
	},
];

interface SettingsPageProps {
	eventManagementCriteria?: DesktopEventManagementCriteria;
	settings: DesktopSettingsData;
	runtimeCatalog?: DesktopRuntimeCatalog;
	providerKeys: DesktopProviderKeyStatus[];
	oauthProviders: DesktopOAuthProviderStatus[];
	oauthLogin: OAuthLoginState;
	storageSecurityState?: DesktopStorageSecurityState;
	isLoading: boolean;
	isSaving: boolean;
	errorMessage?: string;
	settingsOpenRequest?: DesktopSettingsOpenRequest;
	onBack?: () => void;
	onSaveAppearanceSettings: (settings: NonNullable<DesktopSettingsData["appearance"]>) => Promise<void>;
	onSaveEventManagementCriteria: (
		request: DesktopEventManagementCriteriaUpdateRequest,
	) => Promise<DesktopEventManagementCriteria | undefined>;
	onSaveGeneralSettings: (settings: {
		defaultProvider?: string;
		defaultModel?: string;
		defaultThinkingLevel?: ThinkingLevel;
		showThinkingBlocks?: boolean;
		compactInstruction?: string;
		globalAgentsInstruction?: string;
	}) => Promise<void>;
	onSavePermissionApprovalSettings: (settings: DesktopPermissionApprovalSettings) => Promise<void>;
	onSaveProviderKey: (provider: string, key: string) => Promise<void>;
	onDeleteProviderKey: (provider: string) => Promise<void>;
	onTestProviderKey: (provider: string) => Promise<DesktopProviderKeyTestResult>;
	onStartOAuthLogin: (provider: string) => Promise<void>;
	onSubmitOAuthLoginCode: (provider: string, code: string) => Promise<void>;
	onCancelOAuthLogin: (provider: string) => Promise<void>;
	onLogoutOAuthProvider: (provider: string) => Promise<void>;
}

function SettingsNavButton({
	item,
	isActive,
	onSelect,
}: {
	item: SettingsNavItem;
	isActive: boolean;
	onSelect: () => void;
}) {
	const Icon = item.icon;

	return (
		<Button
			aria-current={isActive ? "page" : undefined}
			className={cn(
				"h-9 w-full justify-start gap-2 rounded-lg px-3 text-[13px] font-medium text-[color:var(--color-sidebar-ink)] shadow-none hover:bg-[color:var(--color-sidebar-project-hover)]",
				isActive &&
					"bg-[color:var(--color-sidebar-selected)] text-[color:var(--color-sidebar-active)] hover:bg-[color:var(--color-sidebar-selected-hover)]",
			)}
			onClick={onSelect}
			type="button"
			variant="ghost"
		>
			<Icon className="size-4 text-[color:var(--color-sidebar-icon)]" />
			<span>{item.label}</span>
		</Button>
	);
}

export function SettingsPage({
	eventManagementCriteria,
	settings,
	runtimeCatalog,
	providerKeys,
	oauthProviders,
	oauthLogin,
	storageSecurityState,
	isLoading,
	isSaving,
	errorMessage,
	settingsOpenRequest,
	onBack,
	onSaveAppearanceSettings,
	onSaveEventManagementCriteria,
	onSaveGeneralSettings,
	onSavePermissionApprovalSettings,
	onSaveProviderKey,
	onDeleteProviderKey,
	onTestProviderKey,
	onStartOAuthLogin,
	onSubmitOAuthLoginCode,
	onCancelOAuthLogin,
	onLogoutOAuthProvider,
}: SettingsPageProps) {
	const requestedSection =
		settingsOpenRequest?.section ?? (settingsOpenRequest?.providerId ? "credentials" : undefined);
	const [activeSection, setActiveSection] = useState<DesktopSettingsSectionId>(requestedSection ?? "general");
	const activeItem = SETTINGS_NAV_ITEMS.find((item) => item.id === activeSection) ??
		SETTINGS_NAV_ITEMS[0] ?? {
			description: "",
			icon: Settings2,
			id: "general",
			label: "常规",
		};
	const activeIsSaving = isSaving;

	useEffect(() => {
		if (requestedSection) {
			setActiveSection(requestedSection);
		}
	}, [requestedSection]);

	return (
		<div
			className="relative flex h-[100dvh] min-h-0 overflow-hidden bg-background text-foreground"
			data-slot="desktop-settings-shell"
		>
			<div
				aria-hidden="true"
				className="desktop-window-drag-region absolute inset-x-0 top-0 z-10 h-[var(--desktop-titlebar-drag-height)]"
				data-slot="desktop-settings-titlebar-drag-region"
			/>
			<aside
				aria-label="设置导航"
				className="hidden w-[280px] shrink-0 border-r border-[color:var(--color-sidebar-border)] bg-[color:var(--color-sidebar-surface)] px-3 pb-4 pt-[var(--desktop-titlebar-safe-area)] md:flex md:flex-col"
			>
				{onBack ? (
					<Button
						className="mb-5 h-8 justify-start gap-2 px-2 text-[13px] text-[color:var(--color-sidebar-muted)] hover:text-[color:var(--color-sidebar-active)]"
						onClick={onBack}
						type="button"
						variant="ghost"
					>
						<ArrowLeft className="size-4" />
						<span>返回应用</span>
					</Button>
				) : null}
				<nav className="grid gap-1">
					{SETTINGS_NAV_ITEMS.map((item) => (
						<SettingsNavButton
							isActive={activeSection === item.id}
							item={item}
							key={item.id}
							onSelect={() => setActiveSection(item.id)}
						/>
					))}
				</nav>
			</aside>

			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<div className="border-b border-border/70 bg-[color:var(--color-sidebar-surface)] px-3 py-3 md:hidden">
					<div className="flex items-center justify-between gap-3">
						{onBack ? (
							<Button className="gap-2 px-2" onClick={onBack} size="sm" type="button" variant="ghost">
								<ArrowLeft className="size-4" />
								<span>返回应用</span>
							</Button>
						) : null}
						<p className="truncate text-[13px] font-medium text-foreground">设置</p>
					</div>
					<div className="mt-3 flex gap-1 overflow-x-auto pb-1">
						{SETTINGS_NAV_ITEMS.map((item) => {
							const Icon = item.icon;
							const isActive = activeSection === item.id;
							return (
								<Button
									aria-current={isActive ? "page" : undefined}
									className={cn("h-8 shrink-0 gap-1.5 px-3", isActive && "bg-background shadow-xs")}
									key={item.id}
									onClick={() => setActiveSection(item.id)}
									size="sm"
									type="button"
									variant="ghost"
								>
									<Icon className="size-4" />
									<span>{item.label}</span>
								</Button>
							);
						})}
					</div>
				</div>

				<ScrollArea className="min-h-0 flex-1">
					<main className="mx-auto min-h-full w-full max-w-[820px] px-5 py-8 md:px-10 md:py-14">
						<motion.div className="space-y-6" key={activeSection} {...subtleReveal}>
							<header className="grid gap-2">
								<div className="flex items-center justify-between gap-4">
									<h1 className="text-[17px] font-semibold leading-7 tracking-tight text-foreground">
										{activeItem.label}
									</h1>
									<StatusDot
										className="size-2.5"
										label={activeIsSaving ? "正在保存" : "已就绪"}
										status={activeIsSaving ? "running" : "idle"}
									/>
								</div>
								<p className="max-w-[62ch] text-[13px] leading-6 text-muted-foreground">
									{activeItem.description}
								</p>
							</header>

							{errorMessage ? <ErrorNotice description={errorMessage} title="设置更新失败" /> : null}

							{activeSection === "general" ? (
								<GeneralSettings
									eventManagementCriteria={eventManagementCriteria}
									isLoading={isLoading}
									isSaving={isSaving}
									onSave={onSaveGeneralSettings}
									onSaveEventManagementCriteria={onSaveEventManagementCriteria}
									runtimeCatalog={runtimeCatalog}
									settings={settings}
								/>
							) : null}

							{activeSection === "appearance" ? (
								<AppearanceSettings
									isLoading={isLoading}
									onSave={onSaveAppearanceSettings}
									settings={settings}
								/>
							) : null}

							{activeSection === "permissions" ? (
								<PermissionSettings
									isLoading={isLoading}
									onSave={onSavePermissionApprovalSettings}
									settings={settings}
								/>
							) : null}

							{activeSection === "credentials" ? (
								<ApiKeySettings
									focusedProviderId={settingsOpenRequest?.providerId}
									isLoading={isLoading}
									isSaving={isSaving}
									oauthLogin={oauthLogin}
									oauthProviders={oauthProviders}
									onCancelOAuthLogin={onCancelOAuthLogin}
									onLogoutOAuthProvider={onLogoutOAuthProvider}
									onRemoveKey={onDeleteProviderKey}
									onSaveKey={onSaveProviderKey}
									onStartOAuthLogin={onStartOAuthLogin}
									onSubmitOAuthLoginCode={onSubmitOAuthLoginCode}
									onTestKey={onTestProviderKey}
									providerKeys={providerKeys}
									runtimeCatalog={runtimeCatalog}
									storageSecurityState={storageSecurityState}
								/>
							) : null}
						</motion.div>
					</main>
				</ScrollArea>
			</div>
		</div>
	);
}
