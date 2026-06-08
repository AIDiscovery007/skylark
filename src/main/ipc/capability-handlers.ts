import { IPC_CHANNELS } from "../../shared/ipc-contract.ts";
import type { DesktopMcpManager } from "../mcp/mcp-manager.ts";
import type { DesktopRuntimeHost } from "../runtime/desktop-runtime-host.ts";
import type { DesktopApprovalBroker } from "../security/approval-broker.ts";
import { pipeSubscriptionToPort } from "../util/port-fanout.ts";
import type { DesktopBridgeGroupDescriptor } from "./desktop-bridge-registry.ts";
import {
	validateCapabilityDetailRequest,
	validateCreateSkillRequest,
	validateMcpServerUpsertRequest,
	validatePromptTemplateDeleteRequest,
	validatePromptTemplateUpsertRequest,
	validateSessionId,
} from "./validate-ipc.ts";

export interface DesktopCapabilityBridgeGroupOptions {
	approvalBroker: Pick<DesktopApprovalBroker, "requestApproval">;
	host: Pick<
		DesktopRuntimeHost,
		| "createSkill"
		| "deletePromptTemplate"
		| "getCapabilityDetail"
		| "listCapabilities"
		| "reloadCapabilities"
		| "restartMcpServer"
		| "setMcpServerEnabled"
		| "testMcpServer"
		| "upsertMcpServer"
		| "upsertPromptTemplate"
	>;
	mcpManager: DesktopMcpManager;
}

export function createCapabilityBridgeGroup(
	options: DesktopCapabilityBridgeGroupOptions,
): DesktopBridgeGroupDescriptor {
	return {
		commands: [
			{
				channel: IPC_CHANNELS.listCapabilities,
				handle: async () => options.host.listCapabilities(),
			},
			{
				channel: IPC_CHANNELS.getCapabilityDetail,
				handle: async (_event, request: unknown) =>
					options.host.getCapabilityDetail(validateCapabilityDetailRequest(request)),
			},
			{
				channel: IPC_CHANNELS.createSkill,
				handle: async (_event, request: unknown) => {
					const validatedRequest = validateCreateSkillRequest(request);
					await options.approvalBroker.requestApproval({
						category: "capability_mutation",
						action: "create_skill",
						title: "Create skill",
						description: "Create or overwrite a local desktop skill.",
						subject: validatedRequest.name,
						details: {
							name: validatedRequest.name,
							scope: validatedRequest.scope ?? "project",
							overwrite: validatedRequest.overwrite === true,
						},
					});
					return options.host.createSkill(validatedRequest);
				},
			},
			{
				channel: IPC_CHANNELS.upsertPromptTemplate,
				handle: async (_event, request: unknown) => {
					const validatedRequest = validatePromptTemplateUpsertRequest(request);
					await options.approvalBroker.requestApproval({
						category: "capability_mutation",
						action: "create_prompt_template",
						title: "Create prompt template",
						description: "Create or overwrite a local prompt template.",
						subject: validatedRequest.name,
						details: {
							name: validatedRequest.name,
							scope: validatedRequest.scope ?? "project",
							overwrite: validatedRequest.overwrite ?? true,
						},
					});
					return options.host.upsertPromptTemplate(validatedRequest);
				},
			},
			{
				channel: IPC_CHANNELS.deletePromptTemplate,
				handle: async (_event, request: unknown) => {
					const validatedRequest = validatePromptTemplateDeleteRequest(request);
					await options.approvalBroker.requestApproval({
						category: "capability_mutation",
						action: "delete_prompt_template",
						title: "Delete prompt template",
						description: "Delete a local prompt template file.",
						subject: validatedRequest.filePath,
						details: {
							filePath: validatedRequest.filePath,
						},
					});
					return options.host.deletePromptTemplate(validatedRequest);
				},
			},
			{
				channel: IPC_CHANNELS.upsertMcpServer,
				handle: async (_event, request: unknown) => {
					const validatedRequest = validateMcpServerUpsertRequest(request);
					await options.approvalBroker.requestApproval({
						category: "mcp_server_lifecycle",
						action: "upsert_mcp_server",
						title: "Configure MCP server",
						description: "Add or update a stdio MCP server configuration.",
						subject: validatedRequest.name,
						cwd: validatedRequest.cwd,
						details: {
							command: validatedRequest.command,
							args: validatedRequest.args ?? [],
							connectNow: validatedRequest.connectNow === true,
							enabled: validatedRequest.enabled === true,
						},
					});
					return options.host.upsertMcpServer(validatedRequest);
				},
			},
			{
				channel: IPC_CHANNELS.setMcpServerEnabled,
				handle: async (_event, serverId: unknown, enabled: unknown) => {
					if (typeof enabled !== "boolean") {
						throw new TypeError("Invalid MCP enabled value: expected a boolean");
					}
					const validatedServerId = validateSessionId(serverId);
					await options.approvalBroker.requestApproval({
						category: "mcp_server_lifecycle",
						action: enabled ? "enable_mcp_server" : "disable_mcp_server",
						title: enabled ? "Enable MCP server" : "Disable MCP server",
						description: "Change MCP server lifecycle state.",
						subject: validatedServerId,
						details: { enabled },
					});
					return options.host.setMcpServerEnabled(validatedServerId, enabled);
				},
			},
			{
				channel: IPC_CHANNELS.testMcpServer,
				handle: async (_event, serverId: unknown) => {
					const validatedServerId = validateSessionId(serverId);
					await options.approvalBroker.requestApproval({
						category: "mcp_server_lifecycle",
						action: "test_mcp_server",
						title: "Test MCP server",
						description: "Start a stdio MCP server process to validate its tools.",
						subject: validatedServerId,
					});
					return options.host.testMcpServer(validatedServerId);
				},
			},
			{
				channel: IPC_CHANNELS.restartMcpServer,
				handle: async (_event, serverId: unknown) => {
					const validatedServerId = validateSessionId(serverId);
					await options.approvalBroker.requestApproval({
						category: "mcp_server_lifecycle",
						action: "restart_mcp_server",
						title: "Restart MCP server",
						description: "Restart a stdio MCP server process.",
						subject: validatedServerId,
					});
					return options.host.restartMcpServer(validatedServerId);
				},
			},
			{
				channel: IPC_CHANNELS.reloadCapabilities,
				handle: async () => options.host.reloadCapabilities(),
			},
		],
		streams: [
			{
				channel: IPC_CHANNELS.openCapabilityStream,
				open: (port) => pipeSubscriptionToPort((listener) => options.mcpManager.subscribe(listener), port),
			},
		],
	};
}
