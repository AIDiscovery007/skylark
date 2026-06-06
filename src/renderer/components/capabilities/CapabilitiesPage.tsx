import type { LucideIcon } from "lucide-react";
import {
	Check,
	ChevronsUpDown,
	PlugZap,
	Plus,
	RefreshCw,
	RotateCw,
	Save,
	Search,
	Sparkles,
	SquareSlash,
	TestTube2,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { VirtualStack } from "@/components/ui/virtual-stack";
import { subtleReveal } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type {
	DesktopCapabilityCatalog,
	DesktopCapabilityDetail,
	DesktopCapabilityDetailRequest,
	DesktopCapabilityScope,
	DesktopCreateSkillRequest,
	DesktopMcpServerStatus,
	DesktopMcpServerUpsertRequest,
	DesktopPromptTemplateUpsertRequest,
} from "../../../shared/types.ts";
import { WorkbenchPageHeader } from "../layout/WorkbenchPageHeader.tsx";

type CapabilityTab = "mcp" | "skills" | "prompts";

interface CapabilitiesPageProps {
	catalog: DesktopCapabilityCatalog;
	embedded?: boolean;
	errorMessage?: string;
	isLoading: boolean;
	isSaving: boolean;
	isSidebarCollapsed?: boolean;
	onCreateSkill: (request: DesktopCreateSkillRequest) => Promise<void>;
	onGetCapabilityDetail: (request: DesktopCapabilityDetailRequest) => Promise<DesktopCapabilityDetail>;
	onReload: () => Promise<void>;
	onRestartMcpServer: (serverId: string) => Promise<void>;
	onSetMcpServerEnabled: (serverId: string, enabled: boolean) => Promise<void>;
	onTestMcpServer: (serverId: string) => Promise<void>;
	onUpsertMcpServer: (request: DesktopMcpServerUpsertRequest) => Promise<void>;
	onUpsertPromptTemplate: (request: DesktopPromptTemplateUpsertRequest) => Promise<void>;
}

const STATUS_VARIANT: Record<DesktopMcpServerStatus, "error" | "info" | "neutral" | "success"> = {
	connected: "success",
	connecting: "info",
	disabled: "neutral",
	error: "error",
};

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function parseArgs(value: string): string[] {
	return value.split(/\s+/).filter(Boolean);
}

function parseEnv(value: string): Record<string, string> | undefined {
	const env: Record<string, string> = {};
	for (const line of value.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const separatorIndex = trimmed.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}
		env[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
	}
	return Object.keys(env).length > 0 ? env : undefined;
}

function createCapabilityRows<T>(items: readonly T[]): T[][] {
	const rows: T[][] = [];
	for (let index = 0; index < items.length; index += 2) {
		rows.push(items.slice(index, index + 2));
	}
	return rows;
}

function CapabilityVirtualGrid<T>({
	dataSlot,
	estimateSize,
	getKey,
	items,
	renderItem,
}: {
	dataSlot: string;
	estimateSize: (rowIndex: number) => number;
	getKey: (item: T, index: number) => string;
	items: readonly T[];
	renderItem: (item: T, index: number) => ReactNode;
}) {
	const rows = useMemo(() => createCapabilityRows(items), [items]);

	return (
		<VirtualStack
			className="native-scrollbar max-h-[min(68vh,760px)] overflow-y-auto pr-1"
			dataSlot={dataSlot}
			estimateSize={estimateSize}
			gap={12}
			getKey={(row, rowIndex) =>
				row.map((item, index) => getKey(item, rowIndex * 2 + index)).join("|") || `row-${rowIndex}`
			}
			initialViewportHeight={560}
			items={rows}
			measureItems
			overscan={4}
			paddingEnd={4}
			renderItem={({ item: row, index: rowIndex }) => (
				<div className="grid gap-x-10 gap-y-3 lg:grid-cols-2">
					{row.map((item, index) => (
						<div key={getKey(item, rowIndex * 2 + index)}>{renderItem(item, rowIndex * 2 + index)}</div>
					))}
				</div>
			)}
		/>
	);
}

export function CapabilitiesPage({
	catalog,
	embedded = false,
	errorMessage,
	isLoading,
	isSaving,
	isSidebarCollapsed = false,
	onCreateSkill,
	onGetCapabilityDetail,
	onReload,
	onRestartMcpServer,
	onSetMcpServerEnabled,
	onTestMcpServer,
	onUpsertMcpServer,
	onUpsertPromptTemplate,
}: CapabilitiesPageProps) {
	const [activeTab, setActiveTab] = useState<CapabilityTab>("mcp");
	const [query, setQuery] = useState("");
	const [isAddOpen, setIsAddOpen] = useState(false);
	const [detailPreview, setDetailPreview] = useState<{
		detail?: DesktopCapabilityDetail;
		errorMessage?: string;
		isLoading: boolean;
		request: DesktopCapabilityDetailRequest;
		title: string;
	}>();
	const normalizedQuery = normalize(query);
	const capabilitySummary = `${catalog.mcpServers.length} MCP / ${catalog.skills.length} Skills / ${catalog.prompts.length} Prompts`;
	const titlebarInset = !embedded && isSidebarCollapsed ? "app-titlebar-controls" : "none";
	const tabs = [
		{ id: "mcp" as const, label: "MCP", count: catalog.mcpServers.length },
		{ id: "skills" as const, label: "Skills", count: catalog.skills.length },
		{ id: "prompts" as const, label: "Prompts", count: catalog.prompts.length },
	];

	const filteredMcpServers = useMemo(
		() =>
			catalog.mcpServers.filter((server) => {
				if (!normalizedQuery) {
					return true;
				}
				return [server.name, server.command, server.args.join(" "), server.status].some((value) =>
					normalize(value).includes(normalizedQuery),
				);
			}),
		[catalog.mcpServers, normalizedQuery],
	);
	const filteredSkills = useMemo(
		() =>
			catalog.skills.filter((skill) => {
				if (!normalizedQuery) {
					return true;
				}
				return [skill.name, skill.description, skill.source.label].some((value) =>
					normalize(value).includes(normalizedQuery),
				);
			}),
		[catalog.skills, normalizedQuery],
	);
	const filteredPrompts = useMemo(
		() =>
			catalog.prompts.filter((prompt) => {
				if (!normalizedQuery) {
					return true;
				}
				return [prompt.name, prompt.description, prompt.argumentHint ?? "", prompt.source.label].some((value) =>
					normalize(value).includes(normalizedQuery),
				);
			}),
		[catalog.prompts, normalizedQuery],
	);

	useEffect(() => {
		if (!detailPreview) {
			return;
		}
		const stillExists =
			detailPreview.request.type === "skill"
				? catalog.skills.some((skill) => skill.filePath === detailPreview.request.filePath)
				: catalog.prompts.some((prompt) => prompt.filePath === detailPreview.request.filePath);
		if (!stillExists) {
			setDetailPreview(undefined);
		}
	}, [catalog.prompts, catalog.skills, detailPreview]);

	function handleTabChange(tab: CapabilityTab): void {
		setActiveTab(tab);
		setDetailPreview(undefined);
	}

	async function handlePreviewCapability(request: DesktopCapabilityDetailRequest, title: string): Promise<void> {
		setDetailPreview({ isLoading: true, request, title });
		try {
			const detail = await onGetCapabilityDetail(request);
			setDetailPreview({ detail, isLoading: false, request, title });
		} catch (error: unknown) {
			setDetailPreview({
				errorMessage: error instanceof Error ? error.message : String(error),
				isLoading: false,
				request,
				title,
			});
		}
	}

	return (
		<div
			className={cn(
				embedded
					? "flex min-h-0 w-full flex-col bg-transparent"
					: "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-[color:var(--border-subtle)] bg-[color:var(--background)] shadow-[var(--shadow-middle)]",
			)}
			data-slot="capabilities-workbench"
		>
			<WorkbenchPageHeader
				actions={
					<IconButton
						aria-label="重新加载"
						disabled={isLoading || isSaving}
						onClick={() => void onReload()}
						title="重新加载"
					>
						{isLoading || isSaving ? (
							<Spinner className="size-3.5" label="Reloading capabilities" />
						) : (
							<RefreshCw className="size-3.5" />
						)}
					</IconButton>
				}
				description={capabilitySummary}
				divider="none"
				embedded={embedded}
				headerSlot="capabilities-panel-header"
				title="Agent 能力库"
				titlebarInset={titlebarInset}
				titlebarSlot="capabilities-titlebar-row"
				toolbar={
					<>
						<div className="flex flex-wrap items-center gap-1" data-slot="capabilities-tabs">
							{tabs.map((tab) => (
								<button
									className={cn(
										"h-8 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
										activeTab === tab.id && "bg-muted/80 text-foreground",
									)}
									key={tab.id}
									onClick={() => handleTabChange(tab.id)}
									type="button"
								>
									{tab.label}
									<span className="ml-2 text-[11px] text-muted-foreground">{tab.count}</span>
								</button>
							))}
						</div>
						<div className="relative block min-w-0">
							<Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground" />
							<Input
								aria-label="Search capabilities"
								className="h-9 rounded-lg border-border/70 bg-transparent pl-9"
								onChange={(event) => setQuery(event.target.value)}
								placeholder="搜索 MCP、Skill、Prompt"
								value={query}
							/>
						</div>
						<Button className="gap-2" onClick={() => setIsAddOpen(true)} type="button">
							<Plus className="size-4" />
							<span>{getAddLabel(activeTab)}</span>
						</Button>
					</>
				}
				toolbarSlot="capabilities-toolbar"
			/>

			<div className={cn(embedded ? "py-5" : "min-h-0 overflow-y-auto px-5 py-6 md:px-7")}>
				<div className="mx-auto w-full max-w-5xl">
					<AnimatePresence initial={false}>
						{errorMessage ? (
							<motion.div className="mb-5" {...subtleReveal}>
								<ErrorNotice description={errorMessage} title="能力库更新失败" />
							</motion.div>
						) : null}
					</AnimatePresence>

					<div data-slot="capabilities-tab-panel">
						{activeTab === "mcp" ? (
							<CapabilitySection
								description={`已配置 ${filteredMcpServers.length} 个 server`}
								icon={PlugZap}
								title="MCP"
							>
								{filteredMcpServers.length === 0 ? (
									<EmptyState label="暂无 MCP server。" />
								) : (
									<CapabilityVirtualGrid
										dataSlot="capabilities-mcp-virtual-grid"
										estimateSize={() => 104}
										getKey={(server) => server.id}
										items={filteredMcpServers}
										renderItem={(server) => (
											<McpServerRow
												isSaving={isSaving}
												onRestart={() => void onRestartMcpServer(server.id)}
												onTest={() => void onTestMcpServer(server.id)}
												onToggle={() => void onSetMcpServerEnabled(server.id, !server.enabled)}
												server={server}
											/>
										)}
									/>
								)}
							</CapabilitySection>
						) : null}

						{activeTab === "skills" ? (
							<CapabilitySection
								description={`可用 ${filteredSkills.length} 个 skill`}
								icon={Sparkles}
								title="Skills"
							>
								{filteredSkills.length === 0 ? (
									<EmptyState label="暂无 skill。" />
								) : (
									<CapabilityVirtualGrid
										dataSlot="capabilities-skills-virtual-grid"
										estimateSize={() => 76}
										getKey={(skill) => skill.filePath}
										items={filteredSkills}
										renderItem={(skill) => (
											<CapabilityRow
												detail={skill.description}
												icon={Sparkles}
												meta={skill.source.scope ?? skill.source.label}
												onPreview={() =>
													void handlePreviewCapability(
														{ type: "skill", filePath: skill.filePath },
														skill.name,
													)
												}
												title={skill.name}
											/>
										)}
									/>
								)}
							</CapabilitySection>
						) : null}

						{activeTab === "prompts" ? (
							<CapabilitySection
								description={`可用 ${filteredPrompts.length} 个 prompt 模板`}
								icon={SquareSlash}
								title="Prompts"
							>
								{filteredPrompts.length === 0 ? (
									<EmptyState label="暂无 prompt 模板。" />
								) : (
									<CapabilityVirtualGrid
										dataSlot="capabilities-prompts-virtual-grid"
										estimateSize={() => 76}
										getKey={(prompt) => prompt.filePath}
										items={filteredPrompts}
										renderItem={(prompt) => (
											<CapabilityRow
												detail={prompt.description}
												icon={SquareSlash}
												meta={prompt.argumentHint || prompt.source.scope || prompt.source.label}
												onPreview={() =>
													void handlePreviewCapability(
														{ type: "prompt_template", filePath: prompt.filePath },
														`/${prompt.name}`,
													)
												}
												title={`/${prompt.name}`}
											/>
										)}
									/>
								)}
							</CapabilitySection>
						) : null}
					</div>
				</div>
			</div>

			<AddCapabilityDialog
				activeTab={activeTab}
				isOpen={isAddOpen}
				isSaving={isSaving}
				onClose={() => setIsAddOpen(false)}
				onCreateSkill={onCreateSkill}
				onUpsertMcpServer={onUpsertMcpServer}
				onUpsertPromptTemplate={onUpsertPromptTemplate}
			/>
			<CapabilityDetailSheet
				detail={detailPreview?.detail}
				errorMessage={detailPreview?.errorMessage}
				isLoading={detailPreview?.isLoading ?? false}
				onOpenChange={(open) => {
					if (!open) {
						setDetailPreview(undefined);
					}
				}}
				open={Boolean(detailPreview)}
				title={detailPreview?.title ?? "Capability detail"}
			/>
		</div>
	);
}

function getAddLabel(tab: CapabilityTab): string {
	if (tab === "mcp") {
		return "添加 MCP";
	}
	if (tab === "skills") {
		return "添加 Skill";
	}
	return "添加 Prompt";
}

function CapabilitySection({
	children,
	description,
	icon: Icon,
	title,
}: {
	children: ReactNode;
	description: string;
	icon: LucideIcon;
	title: string;
}) {
	return (
		<section className="mx-auto max-w-4xl">
			<div className="mb-4 flex items-center justify-between gap-4 border-b border-border/60 pb-3">
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex size-8 items-center justify-center rounded-lg border border-border/70 bg-background">
						<Icon className="size-4 text-muted-foreground" />
					</div>
					<div className="min-w-0">
						<h3 className="text-base font-medium tracking-tight text-foreground">{title}</h3>
						<p className="text-[13px] leading-5 text-muted-foreground">{description}</p>
					</div>
				</div>
				<ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
			</div>
			{children}
		</section>
	);
}

function CapabilityRow({
	detail,
	icon: Icon,
	meta,
	onPreview,
	title,
}: {
	detail: string;
	icon: LucideIcon;
	meta?: string;
	onPreview: () => void;
	title: string;
}) {
	return (
		<button
			className="grid min-h-16 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
			onClick={onPreview}
			type="button"
		>
			<div className="flex size-9 items-center justify-center rounded-lg border border-border/70 bg-background">
				<Icon className="size-4 text-muted-foreground" />
			</div>
			<div className="min-w-0">
				<p className="truncate text-[13px] font-medium leading-5 text-foreground">{title}</p>
				<p className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">{detail || "No description."}</p>
			</div>
			{meta ? <span className="max-w-28 truncate text-[11px] uppercase text-muted-foreground">{meta}</span> : null}
		</button>
	);
}

function CapabilityDetailSheet({
	detail,
	errorMessage,
	isLoading,
	onOpenChange,
	open,
	title,
}: {
	detail?: DesktopCapabilityDetail;
	errorMessage?: string;
	isLoading: boolean;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: string;
}) {
	const sourceLabel = detail
		? [detail.source.scope, detail.source.readOnly ? "read-only" : undefined].filter(Boolean).join(" / ")
		: undefined;
	const metadataLines = [
		sourceLabel,
		detail?.type === "prompt_template" ? detail.argumentHint : undefined,
		detail?.type === "skill" && detail.disableModelInvocation ? "Manual invocation only" : undefined,
	].filter((value): value is string => Boolean(value));

	return (
		<Sheet onOpenChange={onOpenChange} open={open}>
			<SheetContent className="w-[min(92vw,680px)] gap-0 sm:max-w-xl">
				<SheetHeader className="border-b border-border/70 px-5 py-4">
					<SheetTitle className="truncate pr-8 text-base">{detail?.name ?? title}</SheetTitle>
					<SheetDescription className="line-clamp-2">
						{detail?.description ?? (isLoading ? "Loading capability detail." : "Capability detail unavailable.")}
					</SheetDescription>
				</SheetHeader>
				<div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
					<div className="grid gap-2 border-b border-border/70 px-5 py-4 text-[12px] leading-5 text-muted-foreground">
						{metadataLines.map((line) => (
							<p className="truncate" key={line}>
								{line}
							</p>
						))}
						{detail?.filePath ? (
							<p className="truncate font-mono text-[11px]" title={detail.filePath}>
								{detail.filePath}
							</p>
						) : null}
					</div>
					<div className="min-h-0 overflow-auto bg-muted/20 p-5">
						{isLoading ? (
							<div className="flex items-center gap-2 text-[13px] text-muted-foreground">
								<Spinner className="size-4" label="Loading capability detail" />
								<span>加载详情</span>
							</div>
						) : errorMessage ? (
							<ErrorNotice description={errorMessage} title="详情读取失败" />
						) : (
							<pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-foreground">
								{detail?.body || "No content."}
							</pre>
						)}
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}

function McpServerRow({
	isSaving,
	onRestart,
	onTest,
	onToggle,
	server,
}: {
	isSaving: boolean;
	onRestart: () => void;
	onTest: () => void;
	onToggle: () => void;
	server: DesktopCapabilityCatalog["mcpServers"][number];
}) {
	return (
		<div className="grid min-h-20 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/35">
			<div className="flex size-9 items-center justify-center rounded-lg border border-border/70 bg-background">
				<PlugZap className="size-4 text-muted-foreground" />
			</div>
			<div className="min-w-0 space-y-2">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<p className="truncate text-[13px] font-medium leading-5 text-foreground">{server.name}</p>
					<Badge className="rounded-md border px-1.5 py-0 text-[11px]" variant={STATUS_VARIANT[server.status]}>
						{server.status}
					</Badge>
				</div>
				<p className="truncate font-mono text-[12px] leading-5 text-muted-foreground">
					{server.command} {server.args.join(" ")}
				</p>
				{server.tools.length > 0 ? (
					<p className="truncate text-[12px] leading-5 text-muted-foreground">
						{server.tools.length} tools: {server.tools.map((tool) => tool.name).join(", ")}
					</p>
				) : null}
				{server.lastError ? <p className="text-[12px] leading-5 text-destructive">{server.lastError}</p> : null}
				<div className="flex flex-wrap items-center gap-1.5">
					<Button disabled={isSaving} onClick={onTest} size="xs" type="button" variant="ghost">
						<TestTube2 className="size-3.5" />
						<span>测试</span>
					</Button>
					<Button disabled={isSaving} onClick={onRestart} size="xs" type="button" variant="ghost">
						<RotateCw className="size-3.5" />
						<span>重启</span>
					</Button>
					<Button disabled={isSaving} onClick={onToggle} size="xs" type="button" variant="outline">
						{server.enabled ? <X className="size-3.5" /> : <Check className="size-3.5" />}
						<span>{server.enabled ? "停用" : "启用"}</span>
					</Button>
				</div>
			</div>
		</div>
	);
}

function EmptyState({ label }: { label: string }) {
	return (
		<div className="rounded-lg border border-dashed border-border/75 px-4 py-10 text-center text-[13px] text-muted-foreground">
			{label}
		</div>
	);
}

function AddCapabilityDialog({
	activeTab,
	isOpen,
	isSaving,
	onClose,
	onCreateSkill,
	onUpsertMcpServer,
	onUpsertPromptTemplate,
}: {
	activeTab: CapabilityTab;
	isOpen: boolean;
	isSaving: boolean;
	onClose: () => void;
	onCreateSkill: (request: DesktopCreateSkillRequest) => Promise<void>;
	onUpsertMcpServer: (request: DesktopMcpServerUpsertRequest) => Promise<void>;
	onUpsertPromptTemplate: (request: DesktopPromptTemplateUpsertRequest) => Promise<void>;
}) {
	const [scope, setScope] = useState<DesktopCapabilityScope>("project");
	const [skill, setSkill] = useState({ name: "", description: "", content: "" });
	const [prompt, setPrompt] = useState({ name: "", description: "", argumentHint: "", content: "" });
	const [mcp, setMcp] = useState({ name: "", command: "", args: "", cwd: "", env: "", connectNow: false });
	const title = getAddLabel(activeTab);
	const canSave =
		activeTab === "mcp"
			? Boolean(mcp.name.trim() && mcp.command.trim())
			: activeTab === "skills"
				? Boolean(skill.name.trim() && skill.description.trim() && skill.content.trim())
				: Boolean(prompt.name.trim() && prompt.description.trim() && prompt.content.trim());

	async function handleSave(): Promise<void> {
		if (activeTab === "mcp") {
			await onUpsertMcpServer({
				name: mcp.name,
				command: mcp.command,
				args: parseArgs(mcp.args),
				cwd: mcp.cwd.trim() || undefined,
				env: parseEnv(mcp.env),
				enabled: mcp.connectNow,
				connectNow: mcp.connectNow,
			});
			setMcp({ name: "", command: "", args: "", cwd: "", env: "", connectNow: false });
		} else if (activeTab === "skills") {
			await onCreateSkill({ ...skill, scope, overwrite: true });
			setSkill({ name: "", description: "", content: "" });
		} else {
			await onUpsertPromptTemplate({ ...prompt, scope, overwrite: true });
			setPrompt({ name: "", description: "", argumentHint: "", content: "" });
		}
		onClose();
	}

	return (
		<AnimatePresence>
			{isOpen ? (
				<motion.div className="fixed inset-0 z-50 grid place-items-center p-5" role="presentation">
					<motion.button
						aria-label="Close add capability dialog"
						className="absolute inset-0 bg-background/55 backdrop-blur-[3px]"
						exit={{ opacity: 0 }}
						initial={{ opacity: 0 }}
						onClick={onClose}
						type="button"
						animate={{ opacity: 1 }}
					/>
					<motion.div
						animate={{ opacity: 1, scale: 1, y: 0 }}
						aria-modal="true"
						className="relative grid max-h-[min(760px,calc(100vh-48px))] w-full max-w-xl overflow-hidden rounded-xl border border-border/80 bg-background shadow-[0_32px_90px_-48px_rgba(15,23,42,0.8)]"
						exit={{ opacity: 0, scale: 0.98, y: 8 }}
						initial={{ opacity: 0, scale: 0.98, y: 10 }}
						role="dialog"
						transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
					>
						<div className="grid gap-1 border-b border-border/70 px-5 py-4">
							<div className="flex items-center justify-between gap-3">
								<h3 className="text-base font-medium tracking-tight text-foreground">{title}</h3>
								<Button aria-label="Close" onClick={onClose} size="icon-sm" type="button" variant="ghost">
									<X className="size-4" />
								</Button>
							</div>
							<p className="text-[13px] leading-5 text-muted-foreground">
								{activeTab === "mcp" ? "使用 stdio transport。" : "默认保存到项目范围。"}
							</p>
						</div>
						<div className="grid gap-3 overflow-y-auto px-5 py-4">
							{activeTab === "mcp" ? (
								<>
									<Input
										aria-label="MCP server name"
										onChange={(event) => setMcp((current) => ({ ...current, name: event.target.value }))}
										placeholder="Server 名称"
										value={mcp.name}
									/>
									<Input
										aria-label="MCP command"
										onChange={(event) => setMcp((current) => ({ ...current, command: event.target.value }))}
										placeholder="命令"
										value={mcp.command}
									/>
									<Input
										aria-label="MCP args"
										onChange={(event) => setMcp((current) => ({ ...current, args: event.target.value }))}
										placeholder="参数"
										value={mcp.args}
									/>
									<Input
										aria-label="MCP cwd"
										onChange={(event) => setMcp((current) => ({ ...current, cwd: event.target.value }))}
										placeholder="可选工作目录"
										value={mcp.cwd}
									/>
									<Textarea
										aria-label="MCP env"
										className="min-h-20"
										onChange={(event) => setMcp((current) => ({ ...current, env: event.target.value }))}
										placeholder="KEY=value"
										value={mcp.env}
									/>
									<label className="flex items-center gap-2 text-[13px] text-foreground">
										<input
											checked={mcp.connectNow}
											className="size-4 accent-primary"
											onChange={(event) =>
												setMcp((current) => ({ ...current, connectNow: event.target.checked }))
											}
											type="checkbox"
										/>
										<span>保存后连接</span>
									</label>
								</>
							) : null}

							{activeTab === "skills" ? (
								<>
									<ScopeToggle scope={scope} setScope={setScope} />
									<Input
										aria-label="Skill name"
										onChange={(event) => setSkill((current) => ({ ...current, name: event.target.value }))}
										placeholder="skill-name"
										value={skill.name}
									/>
									<Input
										aria-label="Skill description"
										onChange={(event) =>
											setSkill((current) => ({ ...current, description: event.target.value }))
										}
										placeholder="Agent 何时应该使用它？"
										value={skill.description}
									/>
									<Textarea
										aria-label="Skill body"
										className="min-h-32"
										onChange={(event) => setSkill((current) => ({ ...current, content: event.target.value }))}
										placeholder="Skill 指令"
										value={skill.content}
									/>
								</>
							) : null}

							{activeTab === "prompts" ? (
								<>
									<ScopeToggle scope={scope} setScope={setScope} />
									<Input
										aria-label="Prompt template name"
										onChange={(event) => setPrompt((current) => ({ ...current, name: event.target.value }))}
										placeholder="template-name"
										value={prompt.name}
									/>
									<Input
										aria-label="Prompt template description"
										onChange={(event) =>
											setPrompt((current) => ({ ...current, description: event.target.value }))
										}
										placeholder="模板说明"
										value={prompt.description}
									/>
									<Input
										aria-label="Prompt template argument hint"
										onChange={(event) =>
											setPrompt((current) => ({ ...current, argumentHint: event.target.value }))
										}
										placeholder="可选参数提示"
										value={prompt.argumentHint}
									/>
									<Textarea
										aria-label="Prompt template body"
										className="min-h-32"
										onChange={(event) =>
											setPrompt((current) => ({ ...current, content: event.target.value }))
										}
										placeholder="模板内容，支持 $ARGUMENTS、$1、$@。"
										value={prompt.content}
									/>
								</>
							) : null}
						</div>
						<div className="flex justify-end gap-2 border-t border-border/70 px-5 py-4">
							<Button disabled={isSaving} onClick={onClose} type="button" variant="ghost">
								取消
							</Button>
							<Button disabled={isSaving || !canSave} onClick={() => void handleSave()} type="button">
								<Save className="size-4" />
								<span>保存</span>
							</Button>
						</div>
					</motion.div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

function ScopeToggle({
	scope,
	setScope,
}: {
	scope: DesktopCapabilityScope;
	setScope: (scope: DesktopCapabilityScope) => void;
}) {
	return (
		<div className="grid grid-cols-2 rounded-lg bg-muted p-1">
			{(["project", "global"] as const).map((value) => (
				<button
					className={cn(
						"h-8 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
						scope === value && "bg-background text-foreground shadow-xs",
					)}
					key={value}
					onClick={() => setScope(value)}
					type="button"
				>
					{value === "project" ? "项目" : "全局"}
				</button>
			))}
		</div>
	);
}
