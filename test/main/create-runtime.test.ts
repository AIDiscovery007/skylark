import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context, FauxProviderRegistration, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall, getModels } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDesktopAgentRuntime,
	createDesktopRuntimeCatalog,
	DESKTOP_SUBAGENT_TOOL_NAME,
	pickPreferredDesktopModelForProvider,
} from "../../src/main/runtime/create-runtime.ts";
import {
	DEFAULT_DESKTOP_TOOL_NAMES,
	DESKTOP_BASELINE_TOOL_NAMES,
	DESKTOP_CREATE_EVENTS_TOOL_NAME,
	validatePlanModeBashCommand,
} from "../../src/main/runtime/mode-aware-runtime-policy.ts";
import {
	DESKTOP_TASK_PROGRESS_TOOL_NAME,
	type DesktopPromptSubmission,
	type DesktopSubagentRuntimeEvent,
} from "../../src/shared/types.ts";
import { registerFauxProvider } from "../support/pi-provider-test-registry.ts";

const desktopTestModel = {
	id: "desktop-test-model",
	name: "Desktop Test Model",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
} satisfies Model<"openai-completions">;

const registrations: FauxProviderRegistration[] = [];
const tempDirectories: string[] = [];

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-runtime-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

function createFauxRegistration(): FauxProviderRegistration {
	const registration = registerFauxProvider({
		provider: "desktop-runtime-faux",
		api: "faux",
		models: [{ id: "desktop-runtime-model", name: "Desktop Runtime Model", reasoning: false }],
	});
	registrations.push(registration);
	return registration;
}

async function observePromptToolNames(prompt: DesktopPromptSubmission | string): Promise<string[]> {
	const faux = createFauxRegistration();
	let observedToolNames: string[] | undefined;
	faux.setResponses([
		(context) => {
			observedToolNames = context.tools?.map((tool) => tool.name) ?? [];
			return fauxAssistantMessage("ok");
		},
	]);
	const runtime = await createDesktopAgentRuntime({
		cwd: "/workspace/project",
		getApiKey: () => "secret",
		model: faux.getModel(),
	});

	await runtime.prompt(prompt);
	await runtime.waitForIdle();

	return observedToolNames ?? [];
}

function expectDirectDesktopTools(toolNames: string[]): void {
	expect(toolNames).toEqual(expect.arrayContaining([...DEFAULT_DESKTOP_TOOL_NAMES]));
	expect(toolNames).not.toEqual(expect.arrayContaining(["activate_toolset", "search_capabilities", "load_skill"]));
}

function getLastUserText(context: Context): string {
	const message = [...context.messages].reverse().find((item) => item.role === "user");
	if (!message) {
		return "";
	}
	return typeof message.content === "string"
		? message.content
		: message.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n");
}

function getToolText(result: { content: Array<{ type: string; text?: string }> }): string {
	const [content] = result.content;
	if (!content || content.type !== "text" || typeof content.text !== "string") {
		throw new Error("Expected text tool result.");
	}
	return content.text;
}

afterEach(() => {
	while (registrations.length > 0) {
		registrations.pop()?.unregister();
	}
	for (const directoryPath of tempDirectories.splice(0)) {
		rmSync(directoryPath, { recursive: true, force: true });
	}
});

describe("createDesktopAgentRuntime", () => {
	it("creates a local desktop runtime around pi-agent-core", async () => {
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			model: desktopTestModel,
			systemPrompt: "Desktop system prompt",
		});

		const state = runtime.getState();

		expect(runtime.cwd).toBe("/workspace/project");
		expect(runtime.agentMode).toBe("execute");
		expect(runtime.diagnostics).toEqual([]);
		expect(state.systemPrompt).toContain("Desktop system prompt");
		expect(state.systemPrompt).toContain("Current working directory: /workspace/project");
		expect(state.systemPrompt).toContain("Never reveal internal reasoning");
		expect(state.model.id).toBe("desktop-test-model");
		expectDirectDesktopTools([...runtime.availableTools]);
		expectDirectDesktopTools(state.tools.map((tool) => tool.name));
		expect(state.messages).toEqual([]);
	});

	it("uses bounded provider defaults that leave room for auto transport fallback", async () => {
		const faux = createFauxRegistration();
		let observedOptions: SimpleStreamOptions | undefined;
		faux.setResponses([
			(_context, options) => {
				observedOptions = options;
				return fauxAssistantMessage("ok");
			},
		]);

		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			getApiKey: () => "secret",
			model: faux.getModel(),
		});

		await runtime.prompt("Who are you?");
		await runtime.waitForIdle();

		expect(observedOptions?.transport).toBe("auto");
		expect(observedOptions?.timeoutMs).toBe(45_000);
	});

	it("loads global and project agent context files without changing Skylark storage boundaries", async () => {
		const directoryPath = createTempDirectory();
		const projectRoot = join(directoryPath, "workspace");
		const cwd = join(projectRoot, "packages", "app");
		const agentDir = join(directoryPath, ".skylark");
		const sessionsDir = join(agentDir, "sessions");
		const sessionFilePath = join(sessionsDir, "2026", "05", "24", "session.jsonl");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "AGENTS.md"), "SKYLARK GLOBAL CONTEXT SHOULD LOAD");
		writeFileSync(join(projectRoot, "AGENTS.md"), "PROJECT CONTEXT SHOULD LOAD");
		writeFileSync(join(cwd, "AGENTS.md"), "PACKAGE CONTEXT SHOULD LOAD");

		const runtime = await createDesktopAgentRuntime({
			cwd,
			agentDir,
			agentSessionsDir: sessionsDir,
			sessionFilePath,
			model: desktopTestModel,
		});
		const systemPrompt = runtime.getState().systemPrompt;
		const globalContextIndex = systemPrompt.indexOf("SKYLARK GLOBAL CONTEXT SHOULD LOAD");
		const projectContextIndex = systemPrompt.indexOf("PROJECT CONTEXT SHOULD LOAD");
		const packageContextIndex = systemPrompt.indexOf("PACKAGE CONTEXT SHOULD LOAD");

		expect(globalContextIndex).toBeGreaterThanOrEqual(0);
		expect(projectContextIndex).toBeGreaterThan(globalContextIndex);
		expect(packageContextIndex).toBeGreaterThan(projectContextIndex);
		expect(systemPrompt).toContain(`Agent home: ${agentDir}`);
		expect(systemPrompt).toContain(`Current session transcript: ${sessionFilePath}`);
		expect(systemPrompt).toContain("Treat the current working directory as the user's workspace");
		expect(systemPrompt).toContain("not as Skylark's agent home or session store");
	});

	it("uses the Agent Home AGENTS.md resource ahead of project context", async () => {
		const directoryPath = createTempDirectory();
		const projectRoot = join(directoryPath, "workspace");
		const cwd = join(projectRoot, "packages", "app");
		const agentDir = join(directoryPath, ".skylark");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "AGENTS.md"), "AGENT HOME GLOBAL CONTEXT SHOULD LOAD");
		writeFileSync(join(projectRoot, "AGENTS.md"), "PROJECT CONTEXT SHOULD LOAD");

		const runtime = await createDesktopAgentRuntime({
			cwd,
			agentDir,
			model: desktopTestModel,
		});
		const systemPrompt = runtime.getState().systemPrompt;
		const globalContextIndex = systemPrompt.indexOf("AGENT HOME GLOBAL CONTEXT SHOULD LOAD");
		const projectContextIndex = systemPrompt.indexOf("PROJECT CONTEXT SHOULD LOAD");

		expect(globalContextIndex).toBeGreaterThanOrEqual(0);
		expect(projectContextIndex).toBeGreaterThan(globalContextIndex);
	});

	it("starts new sessions with direct desktop tools and only the bundled tmux skill in prompt", async () => {
		const directoryPath = createTempDirectory();
		const cwd = join(directoryPath, "Downloads");
		const agentDir = join(directoryPath, ".skylark");
		mkdirSync(join(agentDir, "skills", "tdd"), { recursive: true });
		writeFileSync(
			join(agentDir, "skills", "tdd", "SKILL.md"),
			[
				"---",
				'name: "tdd"',
				'description: "Test-driven development with red-green-refactor loop."',
				"---",
				"",
				"Use tests first.",
				"",
			].join("\n"),
		);

		const runtime = await createDesktopAgentRuntime({
			cwd,
			agentDir,
			model: desktopTestModel,
		});
		const systemPrompt = runtime.getState().systemPrompt;

		expectDirectDesktopTools([...runtime.availableTools]);
		expectDirectDesktopTools(runtime.getState().tools.map((tool) => tool.name));
		expect(systemPrompt).toContain("<available_skills>");
		expect(systemPrompt).toContain("<name>tmux</name>");
		expect(systemPrompt).toContain(join(agentDir, "bundled-skills", "tmux", "SKILL.md"));
		const tmuxSkill = readFileSync(join(agentDir, "bundled-skills", "tmux", "SKILL.md"), "utf8");
		const expectedTmuxName = 'tmux_name="skylark_$' + "{session_hash}_$" + '{purpose_slug}"';
		expect(tmuxSkill).toContain(expectedTmuxName);
		expect(tmuxSkill).toContain('tmux set-option -t "$tmux_name" -q @skylark-session-id');
		expect(tmuxSkill).not.toContain("@pi-session-id");
		expect(tmuxSkill).not.toContain("-gq @pi-session-id");
		expect(systemPrompt).not.toContain(join(agentDir, "skills", "tdd", "SKILL.md"));
		expect(systemPrompt).not.toContain(".codex/skills");
	});

	it("does not register legacy workspace runtime tools with the desktop agent runtime", async () => {
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			model: desktopTestModel,
		});

		expect(runtime.availableTools.join(" ")).not.toContain("workspace_runtime_");
		expect(
			runtime
				.getState()
				.tools.map((tool) => tool.name)
				.join(" "),
		).not.toContain("workspace_runtime_");
		expect(runtime.getState().systemPrompt).toContain("load the bundled tmux skill");
	});

	it("starts plan mode with direct read and exploration tools only", async () => {
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			model: desktopTestModel,
			agentMode: "plan",
		});
		const state = runtime.getState();

		expect(runtime.agentMode).toBe("plan");
		expect(runtime.availableTools).toEqual(["read", "find", "grep", "ls", "bash", DESKTOP_SUBAGENT_TOOL_NAME]);
		expect(state.systemPrompt).toContain(
			"Plan mode is a safe conversation, exploration, and planning mode; it does not require every reply to be a plan.",
		);
		expect(state.systemPrompt).toContain(
			"Reply normally to greetings, casual conversation, conceptual questions, status checks, and discussion that does not ask for a concrete work plan.",
		);
		expect(state.systemPrompt).toContain("Do not wrap normal conversational replies in <proposed_plan> tags.");
		expect(state.systemPrompt).toContain("Before writing a proposed plan, understand the user's intent.");
		expect(state.systemPrompt).toContain(
			"Investigate relevant files and project context before writing a proposed plan for code or workspace changes.",
		);
		expect(state.systemPrompt).toContain(
			"If important product or implementation intent is unclear, ask clarifying questions before proposing a plan.",
		);
		expect(state.systemPrompt).toContain("event creation requires Execute mode");
		expect(state.systemPrompt).toContain(
			"When producing a proposed plan, the final response must contain exactly one <proposed_plan>...</proposed_plan> block.",
		);
		expect(state.systemPrompt).not.toContain("The final response must contain exactly one <proposed_plan>");

		expect(runtime.availableTools).not.toEqual(expect.arrayContaining(["edit", "write"]));
		expect(runtime.getState().tools.map((tool) => tool.name)).not.toContain(DESKTOP_TASK_PROGRESS_TOOL_NAME);
		expect(runtime.availableTools).not.toEqual(
			expect.arrayContaining(["create_skill", "create_prompt_template", "configure_mcp_server"]),
		);
	});

	it("keeps the direct tool surface stable across prompt intent", async () => {
		const promptTools = [
			await observePromptToolNames("你是谁"),
			await observePromptToolNames("read package.json"),
			await observePromptToolNames("run npm run check"),
			await observePromptToolNames("fix this bug"),
			await observePromptToolNames("Append a second line beta to REAL_TEST_A.md."),
			await observePromptToolNames("Create a workspace overview document from the current project."),
			await observePromptToolNames("start the dev server and monitor it"),
			await observePromptToolNames("create a skill for release notes"),
		];

		for (const tools of promptTools) {
			expectDirectDesktopTools(tools);
			expect(tools).toEqual(expect.arrayContaining([DESKTOP_TASK_PROGRESS_TOOL_NAME]));
			expect(tools.join(" ")).not.toContain("workspace_runtime_");
			expect(tools).toEqual(
				expect.arrayContaining([
					"create_skill",
					"create_prompt_template",
					"configure_mcp_server",
					"reload_capabilities",
				]),
			);
		}
	});

	it("injects desktop environment metadata into bash executions", async () => {
		const cwd = createTempDirectory();
		const runtime = await createDesktopAgentRuntime({
			cwd,
			model: desktopTestModel,
			sessionId: "session-env-1",
		});
		const bashTool = runtime.getState().tools.find((tool) => tool.name === "bash");
		if (!bashTool) {
			throw new Error("Expected bash tool.");
		}

		const result = await bashTool.execute("bash-env-1", {
			command:
				'node -e \'console.log(process.env.SKYLARK_DESKTOP_SESSION_ID + "|" + process.env.SKYLARK_DESKTOP_CWD + "|" + process.env.PI_DESKTOP_SESSION_ID + "|" + process.env.PI_DESKTOP_CWD)\'',
		});

		expect(getToolText(result)).toContain(`session-env-1|${cwd}|session-env-1|${cwd}`);
	});

	it("guides read-only exact output requests to return local file contents without refusal", async () => {
		const faux = createFauxRegistration();
		let observedSystemPrompt = "";
		faux.setResponses([
			(context) => {
				observedSystemPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("ok");
			},
		]);
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			getApiKey: () => "secret",
			model: faux.getModel(),
		});

		await runtime.prompt("Read REAL_TEST_A.md and reply with its content only.");
		await runtime.waitForIdle();

		expect(observedSystemPrompt).toContain("return exactly the local file text");
		expect(observedSystemPrompt).toContain("Do not refuse to quote local workspace file content");
	});

	it("keeps direct tools stable when attachment text mentions work", async () => {
		const tools = await observePromptToolNames({
			text: "阅读并理解这个markdown文档内容",
			attachments: [
				{
					id: "attachment-1",
					kind: "text",
					name: "interview.md",
					path: "/workspace/project/interview.md",
					mimeType: "text/markdown",
					size: 128,
					promptText: "这篇资料多次提到 run npm test, fix this bug, write code, edit files, 修改代码, 运行检查。",
					images: [],
				},
			],
		});

		expectDirectDesktopTools(tools);
	});

	it("does not record capability routing decisions for direct tool prompts", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([fauxAssistantMessage("ok")]);
		const sessionDir = createTempDirectory();
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			agentSessionsDir: sessionDir,
			sessionId: "capability-trace",
			getApiKey: () => "secret",
			model: faux.getModel(),
		});

		await runtime.prompt("Create a workspace overview document from the current project.");
		await runtime.waitForIdle();

		const sessionEntries = readFileSync(join(sessionDir, "capability-trace.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { type?: string; customType?: string; data?: unknown });
		const capabilityTrace = sessionEntries.find(
			(entry) => entry.type === "custom" && entry.customType === "desktop_capability_decision",
		);

		expect(capabilityTrace).toBeUndefined();
	});

	it("keeps direct tools available across automatic retry", async () => {
		const faux = createFauxRegistration();
		const agentDir = createTempDirectory();
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } }),
			"utf8",
		);
		const observedToolNames: string[][] = [];
		faux.setResponses([
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage([fauxToolCall("ls", { path: "." }, { id: "retry-ls-1" })], {
					stopReason: "toolUse",
				});
			},
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "fetch failed" }),
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage("retry complete");
			},
		]);
		const runtime = await createDesktopAgentRuntime({
			cwd: createTempDirectory(),
			agentDir,
			getApiKey: () => "secret",
			model: faux.getModel(),
		});
		const unsubscribe = runtime.subscribe(() => {});

		try {
			await runtime.prompt("Create a workspace overview document from the current project.");
			await runtime.waitForIdle();
		} finally {
			unsubscribe();
		}

		expect(observedToolNames[0]).toEqual(expect.arrayContaining(["ls", "write"]));
		expectDirectDesktopTools(observedToolNames[0] ?? []);
		expect(observedToolNames[1]).toEqual(expect.arrayContaining(["ls", "write"]));
		expectDirectDesktopTools(observedToolNames[1] ?? []);
	});

	it("does not expose activate toolset during generic turns", async () => {
		const faux = createFauxRegistration();
		const observedToolNames: string[][] = [];
		faux.setResponses([
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage("direct tools active");
			},
		]);
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			getApiKey: () => "secret",
			model: faux.getModel(),
		});

		await runtime.prompt("Can you help with this repository?");
		await runtime.waitForIdle();

		expectDirectDesktopTools(observedToolNames[0] ?? []);
	});

	it("keeps direct tools stable across turns and continuations", async () => {
		const faux = createFauxRegistration();
		const observedToolNames: string[][] = [];
		faux.setResponses([
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage("read done");
			},
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage("identity done");
			},
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage("fix done");
			},
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage("continued");
			},
		]);
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			getApiKey: () => "secret",
			model: faux.getModel(),
		});

		await runtime.prompt("read package.json");
		await runtime.waitForIdle();
		await runtime.prompt("你是谁");
		await runtime.waitForIdle();
		await runtime.prompt("fix this bug");
		await runtime.waitForIdle();
		await runtime.prompt("继续");
		await runtime.waitForIdle();

		for (const tools of observedToolNames) {
			expectDirectDesktopTools(tools);
			expect(tools).toEqual(expect.arrayContaining([DESKTOP_TASK_PROGRESS_TOOL_NAME]));
		}
		expect(observedToolNames[1]).toEqual(observedToolNames[0]);
		expect(observedToolNames[2]).toEqual(observedToolNames[0]);
		expect(observedToolNames[3]).toEqual(observedToolNames[0]);
	});

	it("allows only conservative read-only bash commands in plan mode", () => {
		for (const command of [
			"pwd",
			"ls src",
			"find src -maxdepth 2 -type f",
			'rg "Desktop" src',
			"grep -R Desktop src",
			"cat README.md",
			"sed -n '1,20p' README.md",
			"git status --short",
			"git diff -- src/main.ts",
			"git log --oneline -5",
			"git show HEAD",
			"git branch --show-current",
			"git remote -v",
		]) {
			expect(validatePlanModeBashCommand(command), command).toBeUndefined();
		}

		for (const command of [
			"npm run check",
			"node script.js",
			"python scripts/audit.py",
			"rg Desktop && rm -rf tmp",
			"cat README.md > out.txt",
			"sed -i '' 's/a/b/' README.md",
			"find . -delete",
			"git checkout main",
			"git branch new-work",
			"git remote add origin https://example.com/repo.git",
		]) {
			expect(validatePlanModeBashCommand(command), command).toBeDefined();
		}
	});

	it("bypasses agent tool approvals in execute mode", async () => {
		const approvalRequester = { requestApproval: vi.fn(async () => undefined) };
		const runtime = await createDesktopAgentRuntime({
			cwd: process.cwd(),
			model: desktopTestModel,
			approvalRequester,
		});
		expect(runtime.getState().systemPrompt).toContain("treat the latest matching tool result as authoritative");
		const bashTool = runtime.getState().tools.find((tool) => tool.name === "bash");
		if (!bashTool) {
			throw new Error("Expected bash tool.");
		}

		await bashTool.execute("call-1", { command: "pwd" });

		expect(approvalRequester.requestApproval).not.toHaveBeenCalled();
	});

	it("runs a subagent as an isolated read-only investigation and returns only its summary", async () => {
		const faux = createFauxRegistration();
		const cwd = createTempDirectory();
		const agentDir = createTempDirectory();
		const subagentSessionsDir = join(agentDir, "subagents");
		const environmentResourceStore = {
			upsertResource: vi.fn(async (input) => ({
				...input,
				createdAt: input.createdAt ?? "2026-05-27T01:00:00.000Z",
				updatedAt: input.updatedAt ?? "2026-05-27T01:00:00.000Z",
				lastSeenAt: input.lastSeenAt ?? "2026-05-27T01:00:00.000Z",
				metadata: input.metadata ?? {},
			})),
		};
		const observedToolNames: string[][] = [];
		const subagentEvents: DesktopSubagentRuntimeEvent[] = [];
		faux.setResponses([
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage(
					[
						fauxToolCall(
							DESKTOP_SUBAGENT_TOOL_NAME,
							{
								title: "Inspect auth flow",
								task: "Find the files that define the auth flow.",
								contextSummary: "The parent is investigating login failures.",
								scope: "Read-only inspection of auth-related files in the current workspace.",
								successCriteria: "Identify the file that defines the auth flow.",
								expectedOutput: "Concise Markdown summary with conclusion, evidence paths, and blockers.",
								knownFacts: "The parent is investigating login failures.",
								suggestedApproach: "Use find or grep to locate auth files, then read only the strongest match.",
								maxTurns: 1,
								timeoutSeconds: 30,
								summaryMaxChars: 2_000,
							},
							{ id: "subagent-1" },
						),
					],
					{ stopReason: "toolUse" },
				);
			},
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage("## Conclusion\nAuth lives in `src/auth.ts`.");
			},
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage("Subagent finished.");
			},
		]);

		const runtime = await createDesktopAgentRuntime({
			cwd,
			agentDir,
			subagentSessionsDir,
			environmentResourceStore,
			getApiKey: () => "secret",
			model: faux.getModel(),
			publishSubagentEvent: (event) => subagentEvents.push(event),
			sessionId: "parent-session-1",
		});
		await runtime.prompt("Use a subagent to inspect auth.");
		await runtime.waitForIdle();

		const toolResult = runtime
			.getState()
			.messages.find((message) => message.role === "toolResult" && message.toolName === DESKTOP_SUBAGENT_TOOL_NAME);
		if (!toolResult || toolResult.role !== "toolResult") {
			throw new Error("Expected subagent tool result.");
		}
		expect(getToolText(toolResult)).toBe("## Conclusion\nAuth lives in `src/auth.ts`.");
		expect(getToolText(toolResult)).not.toContain("The parent is investigating login failures");
		expect(toolResult.details).toMatchObject({
			title: "Inspect auth flow",
			status: "completed",
			task: "Find the files that define the auth flow.",
			contextSummary: "The parent is investigating login failures.",
			scope: "Read-only inspection of auth-related files in the current workspace.",
			successCriteria: "Identify the file that defines the auth flow.",
			expectedOutput: "Concise Markdown summary with conclusion, evidence paths, and blockers.",
			knownFacts: "The parent is investigating login failures.",
			suggestedApproach: "Use find or grep to locate auth files, then read only the strongest match.",
			maxTurns: 1,
			timeoutSeconds: 30,
			summaryMaxChars: 2_000,
			turnCount: 1,
		});
		const transcriptPath = (toolResult.details as { transcriptPath?: string }).transcriptPath;
		expect(transcriptPath).toBeDefined();
		expect(readFileSync(transcriptPath!, "utf8")).toContain("Auth lives in `src/auth.ts`.");
		expect(observedToolNames[0]).toEqual(expect.arrayContaining([DESKTOP_SUBAGENT_TOOL_NAME]));
		expect(observedToolNames[1]).toEqual(["read", "find", "grep", "ls", "bash"]);
		expect(observedToolNames[1]).not.toEqual(expect.arrayContaining([DESKTOP_SUBAGENT_TOOL_NAME, "edit", "write"]));
		expect(subagentEvents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					parentSessionId: "parent-session-1",
					subagentId: expect.any(String),
					event: expect.objectContaining({ type: "agent_start" }),
				}),
				expect.objectContaining({
					parentSessionId: "parent-session-1",
					subagentId: expect.any(String),
					event: expect.objectContaining({ type: "message_end" }),
				}),
				expect.objectContaining({
					parentSessionId: "parent-session-1",
					subagentId: expect.any(String),
					event: expect.objectContaining({ type: "agent_end" }),
				}),
			]),
		);
		expect(environmentResourceStore.upsertResource).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "subagent",
				provider: "subagent",
				sessionId: "parent-session-1",
				status: "running",
				title: "Inspect auth flow",
			}),
		);
		expect(environmentResourceStore.upsertResource).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "subagent",
				provider: "subagent",
				sessionId: "parent-session-1",
				status: "completed",
				title: "Inspect auth flow",
			}),
		);
	});

	it("soft-finalizes a subagent when the exploration turn budget is reached", async () => {
		const faux = createFauxRegistration();
		const cwd = createTempDirectory();
		const agentDir = createTempDirectory();
		writeFileSync(join(cwd, "README.md"), "# Auth\n\nLogin starts in src/auth.ts.\n");

		const observedToolNames: string[][] = [];
		const observedChildPrompts: string[] = [];
		const observedFinalizationPrompts: string[] = [];
		faux.setResponses([
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage(
					[
						fauxToolCall(
							DESKTOP_SUBAGENT_TOOL_NAME,
							{
								title: "Inspect auth flow",
								task: "Find the files that define the auth flow.",
								contextSummary: "The parent is investigating login failures.",
								scope: "Read-only inspection of auth-related files in the current workspace.",
								successCriteria: "Identify the most likely auth entrypoint and cite the file path.",
								expectedOutput: "Concise Markdown summary with conclusion, evidence paths, and blockers.",
								knownFacts: "The user asked about login behavior.",
								suggestedApproach: "Use find or grep to locate auth files, then read only the strongest match.",
								maxTurns: 1,
								timeoutSeconds: 30,
								summaryMaxChars: 2_000,
							},
							{ id: "subagent-1" },
						),
					],
					{ stopReason: "toolUse" },
				);
			},
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				observedChildPrompts.push(getLastUserText(context));
				return fauxAssistantMessage([fauxToolCall("read", { path: "README.md" }, { id: "subagent-read-1" })], {
					stopReason: "toolUse",
				});
			},
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				observedFinalizationPrompts.push(getLastUserText(context));
				return fauxAssistantMessage("## Conclusion\nAuth starts in `src/auth.ts`.\n\nBudget reached; no blockers.");
			},
			fauxAssistantMessage("Subagent finished with a bounded summary."),
		]);

		const runtime = await createDesktopAgentRuntime({
			cwd,
			agentDir,
			getApiKey: () => "secret",
			model: faux.getModel(),
			sessionId: "parent-session-1",
		});
		await runtime.prompt("Use a subagent to inspect auth.");
		await runtime.waitForIdle();

		const toolResult = runtime
			.getState()
			.messages.find((message) => message.role === "toolResult" && message.toolName === DESKTOP_SUBAGENT_TOOL_NAME);
		if (!toolResult || toolResult.role !== "toolResult") {
			throw new Error("Expected subagent tool result.");
		}

		expect(getToolText(toolResult)).toContain("Auth starts in `src/auth.ts`.");
		expect(toolResult.isError).not.toBe(true);
		expect(toolResult.details).toMatchObject({
			status: "completed",
			limitReached: true,
			limitReason: "max_turns",
			turnCount: 1,
		});
		expect(observedToolNames[1]).toEqual(["read", "find", "grep", "ls", "bash"]);
		expect(observedToolNames[2]).toEqual([]);
		expect(observedChildPrompts[0]).toContain("<scope>");
		expect(observedChildPrompts[0]).toContain("Read-only inspection of auth-related files");
		expect(observedChildPrompts[0]).toContain("<success_criteria>");
		expect(observedChildPrompts[0]).toContain("<known_facts>");
		expect(observedChildPrompts[0]).toContain("<suggested_approach>");
		expect(observedChildPrompts[0]).toContain("<expected_output>");
		expect(observedFinalizationPrompts[0]).toContain("Turn budget reached");
		expect(readFileSync((toolResult.details as { transcriptPath: string }).transcriptPath, "utf8")).not.toContain(
			"Operation aborted",
		);
	});

	it("updates structured task progress through an execute-only internal tool", async () => {
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			model: desktopTestModel,
		});
		const progressTool = runtime.getState().tools.find((tool) => tool.name === DESKTOP_TASK_PROGRESS_TOOL_NAME);
		if (!progressTool) {
			throw new Error("Expected task progress tool.");
		}

		const result = await progressTool.execute("progress-1", {
			title: "Implement progress panel",
			tasks: [
				{ id: "inspect", label: "Inspect runtime", status: "completed" },
				{ id: "render", label: "Render panel", status: "active" },
			],
		});

		expect(runtime.availableTools).not.toContain(DESKTOP_TASK_PROGRESS_TOOL_NAME);
		expect(result.details).toEqual({ taskProgress: runtime.taskProgress });
		expect(runtime.taskProgress).toEqual(
			expect.objectContaining({
				title: "Implement progress panel",
				items: [
					{ id: "inspect", label: "Inspect runtime", status: "completed" },
					{ id: "render", label: "Render panel", status: "active" },
				],
				updatedAt: expect.any(String),
			}),
		);
		expect(runtime.taskProgress?.completedAt).toBeUndefined();
	});

	it("creates one or more events through an execute-only tool", async () => {
		const createdRequests: Array<{ title?: string; body?: string }> = [];
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			model: desktopTestModel,
			createEvents: async (events) => {
				createdRequests.push(...events);
				return events.map((event, index) => ({
					id: `event-${index + 1}`,
					title: event.title ?? event.body?.slice(0, 80) ?? "Untitled event",
					bodyPreview: event.body?.slice(0, 160) ?? "",
					status: "inbox" as const,
					attachmentCount: 0,
					commentCount: 0,
					createdAt: "2026-05-30T00:00:00.000Z",
					updatedAt: "2026-05-30T00:00:00.000Z",
					statusChangedAt: "2026-05-30T00:00:00.000Z",
					body: event.body ?? "",
					attachments: [],
					runs: [],
					comments: [],
				}));
			},
		});
		const createEventsTool = runtime.getState().tools.find((tool) => tool.name === "create_events");
		if (!createEventsTool) {
			throw new Error("Expected create_events tool.");
		}

		const result = await createEventsTool.execute("create-events-1", {
			events: [{ title: "Follow up with design", body: "Ask for final copy." }, { body: "Prepare release notes." }],
		});

		expect(runtime.availableTools).toContain("create_events");
		expect(createdRequests).toEqual([
			{ title: "Follow up with design", body: "Ask for final copy." },
			{ body: "Prepare release notes." },
		]);
		expect(getToolText(result)).toContain("Created 2 events");
		expect(result.details).toEqual({
			events: [
				expect.objectContaining({ id: "event-1", title: "Follow up with design" }),
				expect.objectContaining({ id: "event-2", title: "Prepare release notes." }),
			],
		});
	});

	it("lets execute turns create events through model tool calls", async () => {
		const faux = createFauxRegistration();
		const createdRequests: Array<{ title?: string; body?: string }> = [];
		faux.setResponses([
			(context) => {
				expect(context.tools?.map((tool) => tool.name)).toContain(DESKTOP_CREATE_EVENTS_TOOL_NAME);
				return fauxAssistantMessage(
					[
						fauxToolCall(
							DESKTOP_CREATE_EVENTS_TOOL_NAME,
							{
								events: [
									{ title: "Follow up with design", body: "Ask for final copy." },
									{ title: "Prepare release notes" },
								],
							},
							{ id: "create-events-1" },
						),
					],
					{ stopReason: "toolUse" },
				);
			},
			fauxAssistantMessage("Created the events."),
		]);
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			getApiKey: () => "secret",
			model: faux.getModel(),
			createEvents: async (events) => {
				createdRequests.push(...events);
				return events.map((event, index) => ({
					id: `event-${index + 1}`,
					title: event.title ?? event.body?.slice(0, 80) ?? "Untitled event",
					bodyPreview: event.body?.slice(0, 160) ?? "",
					status: "inbox" as const,
					attachmentCount: 0,
					commentCount: 0,
					createdAt: "2026-05-30T00:00:00.000Z",
					updatedAt: "2026-05-30T00:00:00.000Z",
					statusChangedAt: "2026-05-30T00:00:00.000Z",
					body: event.body ?? "",
					attachments: [],
					runs: [],
					comments: [],
				}));
			},
		});

		await runtime.prompt("请创建两个事件：跟进设计终稿；准备 release notes。");
		await runtime.waitForIdle();

		expect(createdRequests).toEqual([
			{ title: "Follow up with design", body: "Ask for final copy." },
			{ title: "Prepare release notes" },
		]);
		const toolResult = runtime
			.getState()
			.messages.find(
				(message) => message.role === "toolResult" && message.toolName === DESKTOP_CREATE_EVENTS_TOOL_NAME,
			);
		expect(toolResult).toEqual(
			expect.objectContaining({
				details: {
					events: [
						expect.objectContaining({ id: "event-1", title: "Follow up with design" }),
						expect.objectContaining({ id: "event-2", title: "Prepare release notes" }),
					],
				},
			}),
		);
	});

	it("keeps event creation out of plan mode", async () => {
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			model: desktopTestModel,
			agentMode: "plan",
			createEvents: async () => {
				throw new Error("unused");
			},
		});

		expect(runtime.availableTools).not.toContain("create_events");
		expect(runtime.getState().tools.map((tool) => tool.name)).not.toContain("create_events");
	});

	it("rejects invalid event creation tool payloads", async () => {
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			model: desktopTestModel,
			createEvents: async () => {
				throw new Error("unused");
			},
		});
		const createEventsTool = runtime.getState().tools.find((tool) => tool.name === "create_events");
		if (!createEventsTool) {
			throw new Error("Expected create_events tool.");
		}

		await expect(createEventsTool.execute("create-events-1", { events: [] })).rejects.toThrow(
			"requires at least one event",
		);
		await expect(
			createEventsTool.execute("create-events-2", {
				events: Array.from({ length: 21 }, (_, index) => ({ title: `Event ${index}` })),
			}),
		).rejects.toThrow("20 events or fewer");
		await expect(
			createEventsTool.execute("create-events-3", {
				events: [{ title: " ", body: "" }],
			}),
		).rejects.toThrow("title or body");
	});

	it("rejects invalid task progress payloads", async () => {
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			model: desktopTestModel,
		});
		const progressTool = runtime.getState().tools.find((tool) => tool.name === DESKTOP_TASK_PROGRESS_TOOL_NAME);
		if (!progressTool) {
			throw new Error("Expected task progress tool.");
		}

		await expect(
			progressTool.execute("progress-1", {
				tasks: [{ id: "", label: "Missing id", status: "pending" }],
			}),
		).rejects.toThrow("id must not be empty");
		await expect(
			progressTool.execute("progress-2", {
				tasks: [{ id: "one", label: "Unknown status", status: "skipped" }],
			}),
		).rejects.toThrow("status must be one of");
	});

	it("injects prompt attachments while preserving visible user text metadata", async () => {
		const faux = createFauxRegistration();
		let observedPrompt = "";
		faux.setResponses([
			(context) => {
				observedPrompt = getLastUserText(context);
				return fauxAssistantMessage("ok");
			},
		]);
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			getApiKey: () => "secret",
			model: {
				id: "desktop-runtime-model",
				name: "Desktop Runtime Model",
				api: "faux",
				provider: "desktop-runtime-faux",
				baseUrl: "https://faux.local",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			} satisfies Model<"faux">,
		});

		await runtime.prompt({
			text: "Summarize this",
			attachments: [
				{
					id: "attachment-1",
					kind: "text",
					name: "notes.md",
					mimeType: "text/markdown",
					size: 42,
					promptText: '<file name="notes.md">attached context</file>',
					images: [],
				},
			],
		});
		await runtime.waitForIdle();

		expect(observedPrompt).toContain("Summarize this");
		expect(observedPrompt).toContain("attached context");
		const userMessage = runtime.getState().messages.find((message) => message.role === "user") as
			| { metadata?: { custom?: Record<string, unknown> } }
			| undefined;
		expect(userMessage?.metadata?.custom).toMatchObject({
			desktopPromptVisibleText: "Summarize this",
			desktopPromptAttachments: [
				{
					id: "attachment-1",
					kind: "text",
					name: "notes.md",
					mimeType: "text/markdown",
					size: 42,
				},
			],
		});
	});

	it("runs manual compaction through the desktop runtime and retains the latest turn", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage("first response"),
			fauxAssistantMessage("second response"),
			fauxAssistantMessage("VERIFIED COMPACTION SUMMARY: preserve verification marker"),
		]);
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			getApiKey: () => "secret",
			model: {
				id: "desktop-runtime-model",
				name: "Desktop Runtime Model",
				api: "faux",
				provider: "desktop-runtime-faux",
				baseUrl: "https://faux.local",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			} satisfies Model<"faux">,
		});

		await runtime.prompt("first verification turn");
		await runtime.waitForIdle();
		await runtime.prompt("second verification turn");
		await runtime.waitForIdle();
		expect(runtime.getState().messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
		]);

		const result = await runtime.compact("preserve verification marker");
		const [firstMessage] = runtime.getState().messages;
		const repeatedResult = await runtime.compact("preserve verification marker again");

		expect(result.summary).toContain("VERIFIED COMPACTION SUMMARY");
		expect(result.summary).toContain("preserve verification marker");
		expect(repeatedResult).toEqual(result);
		if (!firstMessage || firstMessage.role !== "compactionSummary") {
			throw new Error("Expected compaction summary to be hydrated into runtime messages.");
		}
		expect(firstMessage.summary).toContain("VERIFIED COMPACTION SUMMARY");
		const compactedMessages = runtime.getState().messages;
		expect(compactedMessages[0]?.role).toBe("compactionSummary");
		expect(compactedMessages.at(-2)).toEqual(expect.objectContaining({ role: "user" }));
		expect(getLastUserText({ messages: compactedMessages } as Context)).toBe("second verification turn");
		expect(compactedMessages.at(-1)).toEqual(expect.objectContaining({ role: "assistant" }));
		expect(faux.getPendingResponseCount()).toBe(0);
	});

	it("builds a runtime catalog with configured providers and default tools", async () => {
		const catalog = await createDesktopRuntimeCatalog({
			getApiKey: async (provider) => {
				if (provider === "openai") {
					return "openai-secret";
				}
				return undefined;
			},
		});

		expect(catalog.defaultTools).toEqual([...DESKTOP_BASELINE_TOOL_NAMES]);
		expect(catalog.providers.length).toBeGreaterThan(0);
		expect(catalog.providers.find((provider) => provider.id === "openai")?.configured).toBe(true);
		expect(catalog.providers.find((provider) => provider.id === "openai")?.name).toBe("OpenAI");
		expect(catalog.providers.find((provider) => provider.id === "openai")?.authMethods).toEqual(["api_key"]);
		expect(catalog.providers.find((provider) => provider.id === "kimi-coding")?.models).toEqual([
			{
				id: "kimi-for-coding",
				name: "kimi-for-coding",
				reasoning: true,
				contextWindow: 256000,
			},
		]);
	});

	it("uses CLI-aligned auth methods for subscription providers", async () => {
		const catalog = await createDesktopRuntimeCatalog({
			getApiKey: async () => undefined,
			hasAuth: async (provider) => provider === "openai-codex" || provider === "anthropic",
		});

		const anthropicProvider = catalog.providers.find((provider) => provider.id === "anthropic");
		const copilotProvider = catalog.providers.find((provider) => provider.id === "github-copilot");
		const codexProvider = catalog.providers.find((provider) => provider.id === "openai-codex");

		expect(anthropicProvider?.configured).toBe(true);
		expect(anthropicProvider?.authMethods).toEqual(["oauth", "api_key"]);
		expect(anthropicProvider?.name).toBe("Anthropic");
		expect(copilotProvider?.authMethods).toEqual(["oauth"]);
		expect(copilotProvider?.name).toBe("GitHub Copilot");
		expect(codexProvider?.configured).toBe(true);
		expect(codexProvider?.authMethods).toEqual(["oauth"]);
		expect(codexProvider?.name).toBe("OpenAI Codex");
		expect(codexProvider?.models.length).toBeGreaterThan(0);
	});

	it("does not repeat auth checks while building the runtime catalog", async () => {
		const getApiKey = vi.fn(async () => undefined);
		const hasAuth = vi.fn(async (provider: string) => provider === "openai");

		await createDesktopRuntimeCatalog({ getApiKey, hasAuth });

		const authCallCounts = new Map<string, number>();
		for (const [provider] of hasAuth.mock.calls) {
			authCallCounts.set(provider, (authCallCounts.get(provider) ?? 0) + 1);
		}
		expect(Math.max(...authCallCounts.values())).toBe(1);
		expect(getApiKey).not.toHaveBeenCalled();
	});

	it("prefers a supported Groq production model over the first generated entry", () => {
		const model = pickPreferredDesktopModelForProvider("groq", getModels("groq"));

		expect(model?.id).toBe("llama-3.3-70b-versatile");
	});

	it("prefers configured desktop Kimi settings over Groq fallback when a desktop key exists", async () => {
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			getApiKey: async (provider) => {
				if (provider === "kimi-coding") {
					return "kimi-secret";
				}
				if (provider === "groq") {
					return "groq-secret";
				}
				return undefined;
			},
			getSettings: async () => ({
				defaultProvider: "https://api.kimi.com/coding",
				defaultModel: "kimi-for-coding",
				defaultThinkingLevel: "off",
			}),
		});

		const state = runtime.getState();
		expect(state.model.provider).toBe("kimi-coding");
		expect(state.model.id).toBe("kimi-for-coding");
		expect(state.model.api).toBe("anthropic-messages");
		expect(state.model.baseUrl).toBe("https://api.kimi.com/coding");
	});

	it("reuses provider auth lookups while creating a runtime", async () => {
		const getApiKey = vi.fn(async (provider: string) => (provider === "kimi-coding" ? "kimi-secret" : undefined));
		const hasAuth = vi.fn(async (provider: string) => provider === "kimi-coding");

		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			getApiKey,
			hasAuth,
			getSettings: async () => ({
				defaultProvider: "https://api.kimi.com/coding",
				defaultModel: "kimi-for-coding",
				defaultThinkingLevel: "off",
			}),
			tools: [],
		});
		await runtime.dispose?.();

		const apiKeyCallCounts = new Map<string, number>();
		for (const [provider] of getApiKey.mock.calls) {
			apiKeyCallCounts.set(provider, (apiKeyCallCounts.get(provider) ?? 0) + 1);
		}
		expect(Math.max(...apiKeyCallCounts.values())).toBe(1);
		expect(hasAuth.mock.calls.filter(([provider]) => provider === "kimi-coding")).toHaveLength(1);
		expect(getApiKey.mock.calls.filter(([provider]) => provider === "kimi-coding")).toHaveLength(1);
	});

	it("keeps the configured default provider instead of falling back to Kimi when Kimi is configured", async () => {
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			getApiKey: async (provider) => {
				if (provider === "kimi-coding") {
					return "kimi-secret";
				}
				return undefined;
			},
			getSettings: async () => ({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.5",
				defaultThinkingLevel: "off",
			}),
		});

		const state = runtime.getState();
		expect(state.model.provider).toBe("openai-codex");
		expect(state.model.id).toBe("gpt-5.5");
		expect(runtime.diagnostics.some((diagnostic) => diagnostic.message.includes("openai-codex"))).toBe(true);
	});

	it("hydrates missing context window metadata from legacy persisted Kimi sessions", async () => {
		const legacyKimiModel = {
			id: "kimi-for-coding",
			name: "kimi-for-coding",
			api: "anthropic-messages",
			provider: "kimi-coding",
			baseUrl: "https://api.kimi.com/coding",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		} as unknown as Model<"anthropic-messages">;

		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			model: legacyKimiModel,
		});

		const state = runtime.getState();
		expect(state.model.contextWindow).toBe(256000);
		expect(state.model.maxTokens).toBe(16384);
	});

	it("emits diagnostics when configured provider is unavailable and no credentials are configured", async () => {
		const runtime = await createDesktopAgentRuntime({
			cwd: "/workspace/project",
			getApiKey: async () => undefined,
			getSettings: async () => ({
				defaultProvider: "missing-provider",
				defaultModel: "missing-model",
				defaultThinkingLevel: "off",
			}),
		});

		expect(runtime.diagnostics.some((diagnostic) => diagnostic.message.includes("missing-provider"))).toBe(true);
		expect(
			runtime.diagnostics.some((diagnostic) =>
				diagnostic.message.includes("No configured provider credentials detected"),
			),
		).toBe(true);
	});
});
