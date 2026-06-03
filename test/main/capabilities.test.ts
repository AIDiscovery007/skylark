import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type Context,
	type FauxProviderRegistration,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopMcpManager } from "../../src/main/mcp/mcp-manager.ts";
import { DesktopMcpStore } from "../../src/main/mcp/mcp-store.ts";
import { createDesktopAgentRuntime } from "../../src/main/runtime/create-runtime.ts";
import { registerFauxProvider } from "../support/pi-provider-test-registry.ts";

const require = createRequire(import.meta.url);
const registrations: FauxProviderRegistration[] = [];

function createFauxRegistration(): FauxProviderRegistration {
	const registration = registerFauxProvider({
		provider: "desktop-capabilities-faux",
		api: "faux",
		models: [{ id: "desktop-capabilities-model", name: "Desktop Capabilities Model", reasoning: false }],
	});
	registrations.push(registration);
	return registration;
}

function createMcpManager(workspaceDir: string): DesktopMcpManager {
	return new DesktopMcpManager(new DesktopMcpStore(join(workspaceDir, "mcp-servers.json")));
}

function contentToText(content: Extract<Context["messages"][number], { role: "user" }>["content"]): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.map((block) => {
			if (block.type === "text") {
				return block.text;
			}
			return `[image:${block.mimeType}:${block.data.length}]`;
		})
		.join("\n");
}

function getLastUserText(context: Context): string {
	const lastUserMessage = [...context.messages].reverse().find((message) => message.role === "user");
	return lastUserMessage ? contentToText(lastUserMessage.content) : "";
}

function getToolText(result: { content: Array<{ type: string; text?: string }> }): string {
	const [content] = result.content;
	if (!content || content.type !== "text" || typeof content.text !== "string") {
		throw new Error("Expected text tool result.");
	}
	return content.text;
}

function resolveSdkImport(subpath: string): string {
	return pathToFileURL(require.resolve(subpath)).href;
}

function createFakeMcpServerScript(): string {
	const serverImport = resolveSdkImport("@modelcontextprotocol/sdk/server/index.js");
	const stdioImport = resolveSdkImport("@modelcontextprotocol/sdk/server/stdio.js");
	const typesImport = resolveSdkImport("@modelcontextprotocol/sdk/types.js");
	return [
		`import { Server } from ${JSON.stringify(serverImport)};`,
		`import { StdioServerTransport } from ${JSON.stringify(stdioImport)};`,
		`import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(typesImport)};`,
		'const server = new Server({ name: "fake-desktop-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });',
		"server.setRequestHandler(ListToolsRequestSchema, async () => ({",
		"  tools: [{",
		'    name: "echo",',
		'    description: "Echo text through a fake MCP server.",',
		'    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },',
		"  }],",
		"}));",
		"server.setRequestHandler(CallToolRequestSchema, async (request) => {",
		'  const text = String(request.params.arguments?.text ?? "");',
		'  return { content: [{ type: "text", text: "pong: " + text }] };',
		"});",
		"await server.connect(new StdioServerTransport());",
	].join("\n");
}

afterEach(() => {
	while (registrations.length > 0) {
		registrations.pop()?.unregister();
	}
});

describe("desktop capabilities", () => {
	it("stores global capabilities in the configured Skylark agent home", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-capabilities-workspace-"));
		const agentDir = await mkdtemp(join(tmpdir(), "desktop-capabilities-agent-"));
		const faux = createFauxRegistration();
		const runtime = await createDesktopAgentRuntime({
			agentDir,
			cwd: workspaceDir,
			getApiKey: async () => "faux-key",
			model: faux.getModel(),
			mcpManager: createMcpManager(workspaceDir),
		});
		const createSkill = runtime.createSkill?.bind(runtime);
		if (!createSkill) {
			throw new Error("Expected desktop runtime to expose capability mutations.");
		}

		const catalog = await createSkill({
			name: "global-desktop-review",
			description: "Review global desktop capability changes.",
			content: "Use this global skill.",
			scope: "global",
		});

		const createdSkill = catalog.skills.find((skill) => skill.name === "global-desktop-review");
		expect(createdSkill?.source.scope).toBe("global");
		await expect(readFile(join(agentDir, "skills", "global-desktop-review", "SKILL.md"), "utf8")).resolves.toContain(
			"Use this global skill.",
		);
		await expect(
			readFile(join(workspaceDir, ".pi", "skills", "global-desktop-review", "SKILL.md"), "utf8"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("creates project skills and prompt templates, then expands their slash invocations through AgentSession", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-capabilities-"));
		const faux = createFauxRegistration();
		const observedPrompts: string[] = [];
		const runtime = await createDesktopAgentRuntime({
			cwd: workspaceDir,
			getApiKey: async () => "faux-key",
			model: faux.getModel(),
			mcpManager: createMcpManager(workspaceDir),
		});
		const createSkill = runtime.createSkill?.bind(runtime);
		const upsertPromptTemplate = runtime.upsertPromptTemplate?.bind(runtime);
		const getCapabilityDetail = runtime.getCapabilityDetail?.bind(runtime);
		if (!createSkill || !upsertPromptTemplate || !getCapabilityDetail) {
			throw new Error("Expected desktop runtime to expose capability mutations.");
		}

		const skillCatalog = await createSkill({
			name: "desktop-review",
			description: "Review desktop capability changes.",
			content: "Use this skill to review capability work.",
		});
		expect(skillCatalog.slashCommands.find((command) => command.name === "compact")?.source).toBe("builtin");
		const createdSkill = skillCatalog.skills.find((skill) => skill.name === "desktop-review");
		expect(createdSkill?.source.scope).toBe("project");
		expect(createdSkill?.source.readOnly).toBe(false);
		expect(skillCatalog.slashCommands.find((command) => command.name === "skill:desktop-review")?.source).toBe(
			"skill",
		);
		if (!createdSkill) {
			throw new Error("Expected created skill in catalog.");
		}
		await expect(
			readFile(join(workspaceDir, ".pi", "skills", "desktop-review", "SKILL.md"), "utf8"),
		).resolves.toContain("Use this skill to review capability work.");

		const skillDetail = await getCapabilityDetail({
			type: "skill",
			filePath: createdSkill.filePath,
		});
		expect(skillDetail).toMatchObject({
			type: "skill",
			name: "desktop-review",
			description: "Review desktop capability changes.",
			body: "Use this skill to review capability work.",
			filePath: createdSkill.filePath,
			disableModelInvocation: true,
			source: { scope: "project", readOnly: false },
		});
		expect(runtime.getState().tools.map((tool) => tool.name)).not.toContain("load_skill");
		const readTool = runtime.getState().tools.find((tool) => tool.name === "read");
		if (!readTool) {
			throw new Error("Expected read tool.");
		}
		const readSkillResult = await readTool.execute("read-skill-1", { path: createdSkill.filePath });
		const loadedSkillText = getToolText(readSkillResult);
		expect(loadedSkillText).toContain('name: "desktop-review"');
		expect(loadedSkillText).toContain("Use this skill to review capability work.");
		expect(loadedSkillText).toContain("---");

		const promptCatalog = await upsertPromptTemplate({
			name: "desktop-brief",
			description: "Create a desktop brief.",
			content: "Brief: $ARGUMENTS",
		});
		const createdPrompt = promptCatalog.prompts.find((prompt) => prompt.name === "desktop-brief");
		expect(createdPrompt?.source.scope).toBe("project");
		expect(promptCatalog.slashCommands.find((command) => command.name === "desktop-brief")?.source).toBe("prompt");
		if (!createdPrompt) {
			throw new Error("Expected created prompt template in catalog.");
		}
		await expect(readFile(join(workspaceDir, ".pi", "prompts", "desktop-brief.md"), "utf8")).resolves.toContain(
			"Brief: $ARGUMENTS",
		);

		const promptDetail = await getCapabilityDetail({
			type: "prompt_template",
			filePath: createdPrompt.filePath,
		});
		expect(promptDetail).toMatchObject({
			type: "prompt_template",
			name: "desktop-brief",
			description: "Create a desktop brief.",
			body: "Brief: $ARGUMENTS",
			filePath: createdPrompt.filePath,
			source: { scope: "project", readOnly: false },
		});

		const promptFaux = createFauxRegistration();
		const observedSystemPrompts: string[] = [];
		promptFaux.setResponses([
			(context) => {
				observedPrompts.push(getLastUserText(context));
				observedSystemPrompts.push(context.systemPrompt ?? "");
				return fauxAssistantMessage("prompt expanded");
			},
			(context) => {
				observedPrompts.push(getLastUserText(context));
				observedSystemPrompts.push(context.systemPrompt ?? "");
				return fauxAssistantMessage("skill expanded");
			},
		]);

		await runtime.prompt("/desktop-brief summarize MCP setup");
		await runtime.waitForIdle();
		await runtime.prompt("/skill:desktop-review check the capability surface");
		await runtime.waitForIdle();

		expect(observedPrompts[0]).toBe("Brief: summarize MCP setup");
		expect(observedSystemPrompts[0]).not.toContain("Brief: summarize MCP setup");
		expect(observedPrompts[1]).toContain('<skill name="desktop-review"');
		expect(observedPrompts[1]).toContain("Use this skill to review capability work.");
		expect(observedPrompts[1]).toContain("check the capability surface");
		expect(observedSystemPrompts[1]).not.toContain("<selected_skills>");
		expect(observedSystemPrompts[1]).not.toContain("Use load_skill to load a selected skill body");
	});

	it("keeps imported Codex skills explicit instead of adding them to every system prompt", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-codex-skill-workspace-"));
		const agentDir = await mkdtemp(join(tmpdir(), "desktop-codex-skill-agent-"));
		const homeDir = await mkdtemp(join(tmpdir(), "desktop-codex-skill-home-"));
		const codexSkillDir = join(homeDir, ".codex", "skills", "codex-review");
		await mkdir(codexSkillDir, { recursive: true });
		await writeFile(
			join(codexSkillDir, "SKILL.md"),
			[
				"---",
				'name: "codex-review"',
				'description: "Review code with imported Codex behavior."',
				"---",
				"",
				"Imported Codex skill body.",
				"",
			].join("\n"),
			"utf8",
		);
		const previousHome = process.env.HOME;
		process.env.HOME = homeDir;
		try {
			const faux = createFauxRegistration();
			const observedSystemPrompts: string[] = [];
			faux.setResponses([
				(context) => {
					observedSystemPrompts.push(context.systemPrompt ?? "");
					return fauxAssistantMessage("ok");
				},
			]);
			const runtime = await createDesktopAgentRuntime({
				agentDir,
				cwd: workspaceDir,
				getApiKey: async () => "faux-key",
				model: faux.getModel(),
				mcpManager: createMcpManager(workspaceDir),
			});

			const catalog = runtime.listCapabilities ? await runtime.listCapabilities() : undefined;
			const importedSkill = catalog?.skills.find((skill) => skill.name === "codex-review");
			expect(importedSkill?.source.scope).toBe("external");
			expect(importedSkill?.source.readOnly).toBe(true);
			expect(importedSkill?.disableModelInvocation).toBe(true);
			expect(catalog?.slashCommands.find((command) => command.name === "skill:codex-review")?.source).toBe("skill");

			await runtime.prompt("hello");
			await runtime.waitForIdle();

			expect(observedSystemPrompts[0]).not.toContain("codex-review");
			expect(observedSystemPrompts[0]).not.toContain("Review code with imported Codex behavior.");
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	it("lists capabilities as lightweight indexes without exposing a model search tool", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-capability-search-"));
		const faux = createFauxRegistration();
		const runtime = await createDesktopAgentRuntime({
			cwd: workspaceDir,
			getApiKey: async () => "faux-key",
			model: faux.getModel(),
			mcpManager: createMcpManager(workspaceDir),
		});
		const createSkill = runtime.createSkill?.bind(runtime);
		if (!createSkill) {
			throw new Error("Expected desktop runtime to expose capability mutations.");
		}
		await createSkill({
			name: "tdd",
			description: "Test-driven development with red-green-refactor loop.",
			content: "Write one failing test before implementation.",
		});

		const catalog = runtime.listCapabilities ? await runtime.listCapabilities() : undefined;
		if (!catalog) {
			throw new Error("Expected desktop runtime to expose capability catalog.");
		}
		const tddMatch = catalog.skills.find((skill) => skill.name === "tdd");

		expect(tddMatch).toMatchObject({
			name: "tdd",
			description: "Test-driven development with red-green-refactor loop.",
			source: expect.objectContaining({ scope: "project" }),
		});
		expect(JSON.stringify(tddMatch)).not.toContain("Write one failing test before implementation.");
		expect(runtime.getState().tools.map((tool) => tool.name)).not.toContain("search_capabilities");
	});

	it("connects a stdio MCP server and exposes its tools through the desktop adapter", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-mcp-"));
		const fakeServerPath = join(workspaceDir, "fake-mcp-server.mjs");
		await writeFile(fakeServerPath, createFakeMcpServerScript(), "utf8");
		const faux = createFauxRegistration();
		const mcpManager = createMcpManager(workspaceDir);
		const runtime = await createDesktopAgentRuntime({
			cwd: workspaceDir,
			getApiKey: async () => "faux-key",
			model: faux.getModel(),
			mcpManager,
		});
		const upsertMcpServer = runtime.upsertMcpServer?.bind(runtime);
		const setMcpServerEnabled = runtime.setMcpServerEnabled?.bind(runtime);
		if (!upsertMcpServer || !setMcpServerEnabled) {
			throw new Error("Expected desktop runtime to expose MCP mutations.");
		}

		let serverId: string | undefined;
		try {
			const catalog = await upsertMcpServer({
				name: "Fake MCP",
				command: process.execPath,
				args: [fakeServerPath],
				connectNow: true,
			});
			const server = catalog.mcpServers.find((entry) => entry.name === "Fake MCP");
			serverId = server?.id;
			expect(server?.enabled).toBe(true);
			expect(server?.status).toBe("connected");
			expect(server?.tools[0]?.name).toBe("echo");
			const adapterName = server?.tools[0]?.adapterName;
			if (!adapterName) {
				throw new Error("Expected MCP tool adapter name.");
			}
			expect(adapterName).toMatch(/^mcp__.+__echo$/);
			expect(runtime.availableTools).toContain(adapterName);

			faux.setResponses([
				fauxAssistantMessage(
					[fauxText("Calling MCP."), fauxToolCall(adapterName, { text: "desktop" }, { id: "mcp-1" })],
					{
						stopReason: "toolUse",
					},
				),
				fauxAssistantMessage("MCP finished."),
			]);

			await runtime.prompt("Use the fake MCP echo tool.");
			await runtime.waitForIdle();

			const toolResult = runtime
				.getState()
				.messages.find((message) => message.role === "toolResult" && message.toolName === adapterName);
			if (!toolResult || toolResult.role !== "toolResult") {
				throw new Error("Expected MCP tool result message.");
			}
			expect(toolResult.content).toEqual([{ type: "text", text: "pong: desktop" }]);
			expect(toolResult.isError).toBe(false);
		} finally {
			if (serverId) {
				await setMcpServerEnabled(serverId, false);
			}
		}
	});

	it("rejects capability detail requests for paths outside the loaded catalog", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-capability-detail-"));
		const faux = createFauxRegistration();
		const runtime = await createDesktopAgentRuntime({
			cwd: workspaceDir,
			getApiKey: async () => "faux-key",
			model: faux.getModel(),
			mcpManager: createMcpManager(workspaceDir),
		});
		const getCapabilityDetail = runtime.getCapabilityDetail?.bind(runtime);
		if (!getCapabilityDetail) {
			throw new Error("Expected desktop runtime to expose capability details.");
		}

		await expect(
			getCapabilityDetail({
				type: "skill",
				filePath: join(workspaceDir, "outside", "SKILL.md"),
			}),
		).rejects.toThrow("Capability detail is not available for this skill path.");
		await expect(
			getCapabilityDetail({
				type: "prompt_template",
				filePath: join(workspaceDir, "outside", "brief.md"),
			}),
		).rejects.toThrow("Capability detail is not available for this prompt template path.");
	});

	it("lets the agent create skills, prompts, and MCP server configs through management tools", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-agent-capabilities-"));
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage(
				[
					fauxText("I will save the requested capabilities."),
					fauxToolCall(
						"create_skill",
						{
							name: "agent-review",
							description: "Review changes requested by the user.",
							content: "Review implementation changes and call out risks.",
						},
						{ id: "create-skill-1" },
					),
					fauxToolCall(
						"create_prompt_template",
						{
							name: "agent-brief",
							description: "Create a short implementation brief.",
							content: "Brief: $ARGUMENTS",
						},
						{ id: "create-prompt-1" },
					),
					fauxToolCall(
						"configure_mcp_server",
						{
							name: "Agent MCP",
							command: "node",
							args: ["server.js"],
						},
						{ id: "configure-mcp-1" },
					),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Capabilities saved."),
		]);
		const runtime = await createDesktopAgentRuntime({
			cwd: workspaceDir,
			getApiKey: async () => "faux-key",
			model: faux.getModel(),
			mcpManager: createMcpManager(workspaceDir),
		});

		await runtime.prompt("Create a review skill, a brief prompt, and a disabled MCP server.");
		await runtime.waitForIdle();

		const catalog = runtime.listCapabilities ? await runtime.listCapabilities() : undefined;
		expect(catalog?.skills.find((skill) => skill.name === "agent-review")?.source.scope).toBe("project");
		expect(catalog?.prompts.find((prompt) => prompt.name === "agent-brief")?.source.scope).toBe("project");
		expect(catalog?.mcpServers.find((server) => server.name === "Agent MCP")?.enabled).toBe(false);
		expect(runtime.getState().messages.filter((message) => message.role === "toolResult")).toHaveLength(3);
	});

	it("normalizes MCP store records and keeps connectNow servers enabled", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-mcp-store-"));
		const store = new DesktopMcpStore(join(workspaceDir, "servers.json"));

		const saved = await store.upsert({
			name: "  Fake MCP  ",
			command: "  node  ",
			args: ["server.js"],
			env: { " ROOT ": workspaceDir, " ": "ignored" },
			connectNow: true,
		});
		expect(saved.name).toBe("Fake MCP");
		expect(saved.command).toBe("node");
		expect(saved.enabled).toBe(true);
		expect(saved.env).toEqual({ ROOT: workspaceDir });

		await expect(store.upsert({ name: "", command: "node" })).rejects.toThrow("MCP server name is required");
		await expect(store.setEnabled("missing", true)).rejects.toThrow("MCP server not found");
	});
});
