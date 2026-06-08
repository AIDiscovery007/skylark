import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { getErrorMessage } from "../../shared/errors.ts";
import type {
	DesktopCapabilityEvent,
	DesktopMcpServerStatus,
	DesktopMcpServerSummary,
	DesktopMcpToolSummary,
} from "../../shared/types.ts";
import { SKYLARK_RELEASE } from "../app-identity.ts";
import type { DesktopApprovalRequester } from "../security/approval-broker.ts";
import { Listeners } from "../util/port-fanout.ts";
import type { DesktopMcpServerConfig, DesktopMcpStore } from "./mcp-store.ts";

const DEFAULT_MCP_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS = 60_000;
const DEFAULT_MCP_RETRY_DELAYS_MS = [250, 750] as const;

interface DesktopMcpConnection {
	client?: Client;
	transport?: StdioClientTransport;
	status: DesktopMcpServerStatus;
	tools: McpTool[];
	lastError?: string;
}

export interface DesktopMcpToolDefinitionOptions {
	approvalRequester?: DesktopApprovalRequester;
}

export interface DesktopMcpManagerOptions {
	approvalRequester?: DesktopApprovalRequester;
	connectionTimeoutMs?: number;
	toolCallTimeoutMs?: number;
	retryDelaysMs?: readonly number[];
}

function createConnection(status: DesktopMcpServerStatus): DesktopMcpConnection {
	return { status, tools: [] };
}

function sanitizeToolSegment(value: string): string {
	const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
	return sanitized || "tool";
}

function getAdapterToolName(serverId: string, toolName: string): string {
	return `mcp__${sanitizeToolSegment(serverId)}__${sanitizeToolSegment(toolName)}`;
}

function normalizeInputSchema(tool: McpTool): Record<string, unknown> {
	return tool.inputSchema as Record<string, unknown>;
}

function createTimeoutError(label: string, timeoutMs: number): Error {
	return new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`);
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeClientQuietly(client: Client): Promise<void> {
	try {
		await Promise.race([client.close(), sleep(100)]);
	} catch {}
}

async function runWithTimeout<T>(
	label: string,
	timeoutMs: number,
	operation: (signal: AbortSignal) => Promise<T>,
	parentSignal?: AbortSignal,
): Promise<T> {
	if (parentSignal?.aborted) {
		throw new Error(`${label} was aborted before execution.`);
	}

	const controller = new AbortController();
	let timeoutReached = false;
	let abortFromParent: (() => void) | undefined;
	let timeout: NodeJS.Timeout | undefined;
	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => {
			timeoutReached = true;
			const error = createTimeoutError(label, timeoutMs);
			controller.abort(error);
			reject(error);
		}, timeoutMs);
		timeout.unref();
	});
	const promises: Array<Promise<T> | Promise<never>> = [operation(controller.signal), timeoutPromise];
	if (parentSignal) {
		const parentAbortPromise = new Promise<never>((_resolve, reject) => {
			abortFromParent = () => {
				controller.abort(parentSignal.reason);
				reject(new Error(`${label} was aborted.`));
			};
			parentSignal.addEventListener("abort", abortFromParent, { once: true });
		});
		promises.push(parentAbortPromise);
	}

	try {
		return await Promise.race(promises);
	} catch (error: unknown) {
		if (timeoutReached) {
			throw createTimeoutError(label, timeoutMs);
		}
		throw error;
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
		if (abortFromParent) {
			parentSignal?.removeEventListener("abort", abortFromParent);
		}
	}
}

function toTextContent(value: unknown): { type: "text"; text: string } {
	return {
		type: "text",
		text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
	};
}

function mapMcpContent(
	content: unknown,
): Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> {
	if (!Array.isArray(content)) {
		return [toTextContent(content)];
	}

	const mapped = content.map((item) => {
		if (typeof item !== "object" || item === null || !("type" in item)) {
			return toTextContent(item);
		}
		const typed = item as Record<string, unknown>;
		if (typed.type === "text" && typeof typed.text === "string") {
			return { type: "text" as const, text: typed.text };
		}
		if (typed.type === "image" && typeof typed.data === "string" && typeof typed.mimeType === "string") {
			return { type: "image" as const, data: typed.data, mimeType: typed.mimeType };
		}
		return toTextContent(item);
	});

	return mapped.length > 0 ? mapped : [toTextContent("")];
}

function createToolSummary(serverId: string, tool: McpTool): DesktopMcpToolSummary {
	return {
		name: tool.name,
		adapterName: getAdapterToolName(serverId, tool.name),
		description: tool.description,
		inputSchema: normalizeInputSchema(tool),
	};
}

function createSummary(
	config: DesktopMcpServerConfig,
	connection: DesktopMcpConnection | undefined,
): DesktopMcpServerSummary {
	const status = config.enabled ? (connection?.status ?? "disabled") : "disabled";
	const tools = connection?.tools.map((tool) => createToolSummary(config.id, tool)) ?? [];
	return {
		id: config.id,
		name: config.name,
		command: config.command,
		args: [...config.args],
		env: { ...config.env },
		cwd: config.cwd,
		enabled: config.enabled,
		status,
		tools,
		lastError: connection?.lastError,
		updatedAt: config.updatedAt,
	};
}

export class DesktopMcpManager {
	private readonly connections = new Map<string, DesktopMcpConnection>();
	private readonly listeners = new Listeners<DesktopCapabilityEvent>();
	private configs = new Map<string, DesktopMcpServerConfig>();
	private initialized = false;
	private readonly approvalRequester?: DesktopApprovalRequester;
	private readonly connectionTimeoutMs: number;
	private readonly toolCallTimeoutMs: number;
	private readonly retryDelaysMs: readonly number[];

	constructor(
		private readonly store: DesktopMcpStore,
		options: DesktopMcpManagerOptions = {},
	) {
		this.approvalRequester = options.approvalRequester;
		this.connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULT_MCP_CONNECTION_TIMEOUT_MS;
		this.toolCallTimeoutMs = options.toolCallTimeoutMs ?? DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS;
		this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_MCP_RETRY_DELAYS_MS;
	}

	subscribe(listener: (event: DesktopCapabilityEvent) => void): () => void {
		return this.listeners.subscribe(listener);
	}

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}
		await this.reloadConfigs();
		this.initialized = true;
		await this.connectEnabledServers();
	}

	async listServers(): Promise<DesktopMcpServerSummary[]> {
		await this.initialize();
		return [...this.configs.values()].map((config) => createSummary(config, this.connections.get(config.id)));
	}

	async upsertServer(request: Parameters<DesktopMcpStore["upsert"]>[0]): Promise<DesktopMcpServerSummary> {
		const config = await this.store.upsert(request);
		this.configs.set(config.id, config);
		if (request.connectNow || config.enabled) {
			await this.connectServer(config.id);
		} else {
			await this.disconnectServer(config.id);
			this.connections.set(config.id, createConnection("disabled"));
		}
		const summary = createSummary(config, this.connections.get(config.id));
		this.emit({ type: "mcp_status_changed", server: summary });
		return summary;
	}

	async setServerEnabled(serverId: string, enabled: boolean): Promise<DesktopMcpServerSummary> {
		const config = await this.store.setEnabled(serverId, enabled);
		this.configs.set(serverId, config);
		if (enabled) {
			await this.connectServer(serverId);
		} else {
			await this.disconnectServer(serverId);
			this.connections.set(serverId, createConnection("disabled"));
		}
		const summary = createSummary(config, this.connections.get(serverId));
		this.emit({ type: "mcp_status_changed", server: summary });
		return summary;
	}

	async restartServer(serverId: string): Promise<DesktopMcpServerSummary> {
		await this.disconnectServer(serverId);
		return this.connectServer(serverId);
	}

	async testServer(serverId: string): Promise<DesktopMcpServerSummary> {
		const config = await this.requireConfig(serverId);
		const summary = await this.connectServer(serverId);
		if (!config.enabled) {
			await this.disconnectServer(serverId);
			this.connections.set(serverId, createConnection("disabled"));
		}
		return summary;
	}

	getToolDefinitions(options?: DesktopMcpToolDefinitionOptions): ToolDefinition[] {
		const approvalRequester =
			options && Object.hasOwn(options, "approvalRequester") ? options.approvalRequester : this.approvalRequester;
		const tools: ToolDefinition[] = [];
		for (const config of this.configs.values()) {
			if (!config.enabled) {
				continue;
			}
			const connection = this.connections.get(config.id);
			if (connection?.status !== "connected" || !connection.client) {
				continue;
			}
			for (const tool of connection.tools) {
				tools.push(this.createToolDefinition(config, connection.client, tool, approvalRequester));
			}
		}
		return tools;
	}

	async disposeAll(): Promise<void> {
		await Promise.all([...this.connections.keys()].map((serverId) => this.disconnectServer(serverId)));
		this.connections.clear();
	}

	private async reloadConfigs(): Promise<void> {
		const configs = await this.store.list();
		this.configs = new Map(configs.map((config) => [config.id, config]));
		for (const config of configs) {
			if (!this.connections.has(config.id)) {
				this.connections.set(config.id, createConnection(config.enabled ? "disabled" : "disabled"));
			}
		}
	}

	private async connectEnabledServers(): Promise<void> {
		await Promise.all(
			[...this.configs.values()].filter((config) => config.enabled).map((config) => this.connectServer(config.id)),
		);
	}

	private async requireConfig(serverId: string): Promise<DesktopMcpServerConfig> {
		await this.initialize();
		const config = this.configs.get(serverId);
		if (!config) {
			throw new Error(`MCP server not found: ${serverId}`);
		}
		return config;
	}

	private async connectServer(serverId: string): Promise<DesktopMcpServerSummary> {
		const config = await this.requireConfig(serverId);
		await this.disconnectServer(serverId);
		const connection = createConnection("connecting");
		this.connections.set(serverId, connection);
		this.emit({ type: "mcp_status_changed", server: createSummary(config, connection) });

		let lastError: string | undefined;
		const attemptCount = this.retryDelaysMs.length + 1;
		for (let attemptIndex = 0; attemptIndex < attemptCount; attemptIndex += 1) {
			try {
				const connected = await this.openClient(config);
				connection.client = connected.client;
				connection.transport = connected.transport;
				connection.status = "connected";
				connection.tools = connected.tools;
				connection.lastError = undefined;
				lastError = undefined;
				break;
			} catch (error: unknown) {
				lastError = getErrorMessage(error);
				if (attemptIndex < this.retryDelaysMs.length) {
					await sleep(this.retryDelaysMs[attemptIndex] ?? 0);
				}
			}
		}

		if (lastError) {
			connection.status = "error";
			connection.tools = [];
			connection.lastError = lastError;
		}

		const summary = createSummary(config, connection);
		this.emit({ type: "mcp_status_changed", server: summary });
		return summary;
	}

	private async disconnectServer(serverId: string): Promise<void> {
		const connection = this.connections.get(serverId);
		if (!connection?.client) {
			return;
		}
		try {
			await connection.client.close();
		} catch {}
		this.connections.delete(serverId);
	}

	private async openClient(config: DesktopMcpServerConfig): Promise<{
		client: Client;
		transport: StdioClientTransport;
		tools: McpTool[];
	}> {
		const transport = new StdioClientTransport({
			command: config.command,
			args: config.args,
			env: config.env,
			cwd: config.cwd,
			stderr: "pipe",
		});
		const client = new Client({ name: "skylark", version: SKYLARK_RELEASE.version });
		try {
			await runWithTimeout("MCP connection", this.connectionTimeoutMs, () => client.connect(transport));
			const { tools } = await runWithTimeout("MCP listTools", this.connectionTimeoutMs, () => client.listTools());
			return { client, transport, tools };
		} catch (error: unknown) {
			try {
				await closeClientQuietly(client);
			} catch {}
			throw error;
		}
	}

	private createToolDefinition(
		config: DesktopMcpServerConfig,
		client: Client,
		tool: McpTool,
		approvalRequester?: DesktopApprovalRequester,
	): ToolDefinition<any, any> {
		const adapterName = getAdapterToolName(config.id, tool.name);
		return {
			name: adapterName,
			label: `${config.name}: ${tool.name}`,
			description: tool.description ?? `Call MCP tool ${tool.name} on ${config.name}.`,
			promptSnippet: `- ${adapterName}: ${tool.description ?? `Call ${tool.name} on MCP server ${config.name}.`}`,
			parameters: normalizeInputSchema(tool) as Record<string, unknown>,
			executionMode: "parallel",
			execute: async (_toolCallId, params, signal) => {
				if (signal?.aborted) {
					throw new Error(`MCP tool ${tool.name} was aborted before execution.`);
				}
				await approvalRequester?.requestApproval({
					category: "mcp_tool",
					action: "call_mcp_tool",
					title: "Call MCP tool",
					description: `Call ${tool.name} on MCP server ${config.name}.`,
					subject: `${config.name}: ${tool.name}`,
					cwd: config.cwd,
					details: {
						serverId: config.id,
						serverName: config.name,
						toolName: tool.name,
						arguments: params as Record<string, unknown>,
					},
				});
				const result = await runWithTimeout(
					`MCP tool ${tool.name}`,
					this.toolCallTimeoutMs,
					(timeoutSignal) =>
						client.callTool(
							{
								name: tool.name,
								arguments: params as Record<string, unknown>,
							},
							undefined,
							{ signal: timeoutSignal },
						),
					signal,
				);
				return {
					content: mapMcpContent(result.content),
					details: {
						serverId: config.id,
						toolName: tool.name,
						isError: result.isError === true,
					},
				};
			},
		};
	}

	private emit(event: DesktopCapabilityEvent): void {
		this.listeners.emit(event);
	}
}
