import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { DesktopMcpManager } from "../../src/main/mcp/mcp-manager.ts";
import { DesktopMcpStore } from "../../src/main/mcp/mcp-store.ts";

const require = createRequire(import.meta.url);

function resolveSdkImport(subpath: string): string {
	return pathToFileURL(require.resolve(subpath)).href;
}

function createSlowToolServerScript(): string {
	const serverImport = resolveSdkImport("@modelcontextprotocol/sdk/server/index.js");
	const stdioImport = resolveSdkImport("@modelcontextprotocol/sdk/server/stdio.js");
	const typesImport = resolveSdkImport("@modelcontextprotocol/sdk/types.js");
	return [
		`import { Server } from ${JSON.stringify(serverImport)};`,
		`import { StdioServerTransport } from ${JSON.stringify(stdioImport)};`,
		`import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(typesImport)};`,
		'const server = new Server({ name: "slow-tool", version: "1.0.0" }, { capabilities: { tools: {} } });',
		"server.setRequestHandler(ListToolsRequestSchema, async () => ({",
		"  tools: [{",
		'    name: "wait",',
		'    description: "Wait forever.",',
		'    inputSchema: { type: "object", properties: {} },',
		"  }],",
		"}));",
		"server.setRequestHandler(CallToolRequestSchema, async () => {",
		"  await new Promise(() => {});",
		"});",
		"await server.connect(new StdioServerTransport());",
	].join("\n");
}

describe("DesktopMcpManager reliability", () => {
	it("times out and retries stuck MCP connections", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-mcp-timeout-"));
		const manager = new DesktopMcpManager(new DesktopMcpStore(join(workspaceDir, "servers.json")), {
			connectionTimeoutMs: 25,
			retryDelaysMs: [1],
		});

		const summary = await manager.upsertServer({
			name: "Hung MCP",
			command: process.execPath,
			args: ["-e", "setInterval(() => {}, 1000);"],
			connectNow: true,
		});

		expect(summary.status).toBe("error");
		expect(summary.lastError).toContain("timed out");

		await manager.disposeAll();
	});

	it("times out MCP tool calls without retrying the call", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-mcp-tool-timeout-"));
		const serverPath = join(workspaceDir, "slow-tool-server.mjs");
		await writeFile(serverPath, createSlowToolServerScript(), "utf8");
		const manager = new DesktopMcpManager(new DesktopMcpStore(join(workspaceDir, "servers.json")), {
			toolCallTimeoutMs: 25,
		});

		const summary = await manager.upsertServer({
			name: "Slow Tool",
			command: process.execPath,
			args: [serverPath],
			connectNow: true,
		});
		const [tool] = manager.getToolDefinitions();
		if (!tool) {
			throw new Error("Expected connected MCP tool definition.");
		}

		expect(summary.status).toBe("connected");
		await expect(tool.execute("tool-1", {}, undefined, undefined, {} as never)).rejects.toThrow("timed out");

		await manager.disposeAll();
	});
});
