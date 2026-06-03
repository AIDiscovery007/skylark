import { Cpu, FilePenLine, KeyRound, ServerCog, type ShieldCheck, Terminal, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	type DesktopPermissionApprovalSettings,
	type DesktopSettingsData,
	resolveDesktopPermissionApprovalSettings,
} from "../../../shared/types.ts";
import { SettingsGroup, SettingsRow } from "./SettingsList.tsx";

interface PermissionSettingsProps {
	settings: DesktopSettingsData;
	isLoading: boolean;
	isSaving?: boolean;
	onSave: (settings: DesktopPermissionApprovalSettings) => Promise<void>;
}

interface PermissionToggle {
	key: keyof DesktopPermissionApprovalSettings;
	id: string;
	title: string;
	description: string;
	icon: typeof ShieldCheck;
}

const PERMISSION_TOGGLES: PermissionToggle[] = [
	{
		key: "bash",
		id: "permission-bash",
		title: "Shell 命令",
		description: "Agent 通过 bash 工具执行本地命令前需要确认。",
		icon: Terminal,
	},
	{
		key: "fileMutation",
		id: "permission-file-mutation",
		title: "文件修改",
		description: "Agent 编辑、写入或删除文件前需要确认。",
		icon: FilePenLine,
	},
	{
		key: "capabilityMutation",
		id: "permission-capability-mutation",
		title: "能力配置变更",
		description: "Skill、Prompt 模板或 Agent 创建的 MCP 配置发生变化前需要确认。",
		icon: Wrench,
	},
	{
		key: "mcpTool",
		id: "permission-mcp-tool",
		title: "MCP 工具调用",
		description: "Agent 调用 MCP server 暴露的工具前需要确认。",
		icon: KeyRound,
	},
	{
		key: "mcpServerLifecycle",
		id: "permission-mcp-server-lifecycle",
		title: "MCP 服务生命周期",
		description: "配置、测试、启用、停用或重启 MCP server 前需要确认。",
		icon: ServerCog,
	},
	{
		key: "terminal",
		id: "permission-terminal",
		title: "终端启动",
		description: "启动或替换交互式终端 shell 前需要确认。",
		icon: Cpu,
	},
];

export function PermissionSettings({ settings, isLoading, onSave }: PermissionSettingsProps) {
	const resolvedSettings = useMemo(() => resolveDesktopPermissionApprovalSettings(settings), [settings]);
	const [permissionApprovals, setPermissionApprovals] = useState<DesktopPermissionApprovalSettings>(resolvedSettings);

	useEffect(() => {
		setPermissionApprovals(resolvedSettings);
	}, [resolvedSettings]);

	if (isLoading) {
		return (
			<SettingsGroup>
				<div className="space-y-4 px-5 py-5">
					<Skeleton className="h-6 w-40" />
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-16 w-full rounded-xl" />
					<Skeleton className="h-16 w-full rounded-xl" />
					<Skeleton className="h-16 w-full rounded-xl" />
				</div>
			</SettingsGroup>
		);
	}

	return (
		<div className="grid gap-3">
			<SettingsGroup>
				{PERMISSION_TOGGLES.map((toggle) => (
					<SettingsRow
						contentClassName="flex justify-start sm:justify-end"
						description={toggle.description}
						icon={toggle.icon}
						id={toggle.id}
						key={toggle.key}
						title={toggle.title}
					>
						<Switch
							checked={permissionApprovals[toggle.key]}
							id={toggle.id}
							onCheckedChange={(checked: boolean) => {
								const nextPermissionApprovals = {
									...permissionApprovals,
									[toggle.key]: checked,
								};
								setPermissionApprovals(nextPermissionApprovals);
								if (nextPermissionApprovals[toggle.key] !== resolvedSettings[toggle.key]) {
									void onSave(nextPermissionApprovals);
								}
							}}
						/>
					</SettingsRow>
				))}
			</SettingsGroup>

			<p className="px-1 text-[12px] leading-5 text-muted-foreground">
				CSP、IPC 校验和 MCP 超时/重试保护始终开启，不受这些开关影响。
			</p>
		</div>
	);
}
