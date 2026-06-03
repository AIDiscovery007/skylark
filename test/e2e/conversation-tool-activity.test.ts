import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type FauxProviderRegistration,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
	registerFauxProvider,
} from "@earendil-works/pi-ai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonEnvironmentResourceStore } from "../../src/main/environment/environment-resource-store.ts";
import { createDesktopAgentRuntime, DESKTOP_SUBAGENT_TOOL_NAME } from "../../src/main/runtime/create-runtime.ts";
import { DesktopRuntimeHost } from "../../src/main/runtime/desktop-runtime-host.ts";
import { DESKTOP_BASELINE_TOOL_NAMES } from "../../src/main/runtime/mode-aware-runtime-policy.ts";
import { MessageList } from "../../src/renderer/components/chat/MessageList.tsx";
import { INITIAL_AGENT_RENDERER_STATE } from "../../src/renderer/lib/conversation-timeline-projection.ts";
import { agentStore } from "../../src/renderer/stores/agent-store.ts";

const registrations: FauxProviderRegistration[] = [];

function resetAgentStore() {
	const { applyEvent, hydrateSnapshot, setActiveSession, setBridgeError } = agentStore.getState();
	agentStore.setState({
		...INITIAL_AGENT_RENDERER_STATE,
		activeSessionId: undefined,
		sessionStateAccessedAt: {},
		sessionStates: {},
		applyEvent,
		hydrateSnapshot,
		setActiveSession,
		setBridgeError,
	});
}

function createFauxRegistration(): FauxProviderRegistration {
	const registration = registerFauxProvider({
		provider: "desktop-e2e-faux",
		api: "faux",
		models: [{ id: "desktop-e2e-model", name: "Desktop E2E Model", reasoning: false }],
	});
	registrations.push(registration);
	return registration;
}

afterEach(() => {
	while (registrations.length > 0) {
		registrations.pop()?.unregister();
	}
});

describe("desktop-ai-agent conversation flow", () => {
	beforeEach(() => {
		resetAgentStore();
	});

	it("injects the default desktop tools and executes the built-in read tool against package.json", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-agent-read-"));
		await writeFile(
			join(workspaceDir, "package.json"),
			JSON.stringify({ name: "@tests/desktop-ai-agent", private: true }, null, 2),
			"utf-8",
		);

		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage(
				[
					fauxText("I will inspect package.json first."),
					fauxToolCall("read", { path: "package.json" }, { id: "read-1" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("The package name is @tests/desktop-ai-agent."),
		]);

		const host = new DesktopRuntimeHost(() =>
			createDesktopAgentRuntime({
				cwd: workspaceDir,
				getApiKey: async () => "faux-key",
				model: faux.getModel(),
			}),
		);

		const observedEventTypes: string[] = [];
		let resolveAgentEnd!: () => void;
		const agentEnd = new Promise<void>((resolve) => {
			resolveAgentEnd = resolve;
		});
		const unsubscribe = await host.subscribe((event) => {
			observedEventTypes.push(event.type);
			agentStore.getState().applyEvent(event);
			if (event.type === "agent_end") {
				resolveAgentEnd();
			}
		});

		try {
			const snapshot = await host.getSnapshot();
			agentStore.getState().hydrateSnapshot(snapshot);

			await host.prompt(
				snapshot.sessionId,
				"Read package.json in the current workspace and tell me the package name.",
			);
			await agentEnd;

			const state = agentStore.getState();
			const completedSnapshot = await host.getSnapshot(snapshot.sessionId);
			const messageListHtml = renderToStaticMarkup(
				createElement(MessageList, {
					messages: state.messages,
					showThinkingBlocks: false,
					toolCalls: state.toolCalls,
					defaultExpandedToolRailMessageIndex: 1,
					defaultExpandedToolCallId: "read-1",
				}),
			);

			expect(state.availableTools).toEqual([...DESKTOP_BASELINE_TOOL_NAMES]);
			expect(completedSnapshot.availableTools).toEqual([...DESKTOP_BASELINE_TOOL_NAMES]);
			expect(observedEventTypes).toContain("tool_execution_start");
			expect(observedEventTypes).toContain("tool_execution_end");
			expect(state.toolCalls[0]?.toolName).toBe("read");
			expect(messageListHtml).toContain("已处理");
			expect(messageListHtml).toContain("Read package.json");
			expect(messageListHtml).toContain("完成");
			expect(messageListHtml).toContain("package.json");
			expect(messageListHtml).toContain("@tests/desktop-ai-agent");
			expect(messageListHtml).toContain("The package name is @tests/desktop-ai-agent.");
		} finally {
			unsubscribe();
		}
	});

	it("renders built-in bash tool updates in the tool activity stream", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-agent-bash-"));
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage(
				[
					fauxText("I will run a shell command."),
					fauxToolCall("bash", { command: "printf 'desktop-ai-agent\\n'" }, { id: "bash-1" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("The command finished successfully."),
		]);

		const host = new DesktopRuntimeHost(() =>
			createDesktopAgentRuntime({
				cwd: workspaceDir,
				getApiKey: async () => "faux-key",
				model: faux.getModel(),
			}),
		);

		const observedEventTypes: string[] = [];
		let resolveAgentEnd!: () => void;
		const agentEnd = new Promise<void>((resolve) => {
			resolveAgentEnd = resolve;
		});
		const unsubscribe = await host.subscribe((event) => {
			observedEventTypes.push(event.type);
			agentStore.getState().applyEvent(event);
			if (event.type === "agent_end") {
				resolveAgentEnd();
			}
		});

		try {
			const snapshot = await host.getSnapshot();
			agentStore.getState().hydrateSnapshot(snapshot);

			await host.prompt(snapshot.sessionId, "Run a shell command and show me the output.");
			await agentEnd;

			const state = agentStore.getState();
			const messageListHtml = renderToStaticMarkup(
				createElement(MessageList, {
					messages: state.messages,
					showThinkingBlocks: false,
					toolCalls: state.toolCalls,
					defaultExpandedToolRailMessageIndex: 1,
					defaultExpandedToolCallId: "bash-1",
				}),
			);

			expect(observedEventTypes).toContain("tool_execution_start");
			expect(observedEventTypes).toContain("tool_execution_update");
			expect(observedEventTypes).toContain("tool_execution_end");
			expect(state.toolCalls[0]?.toolName).toBe("bash");
			expect(state.toolCalls[0]?.partialResult).toBeDefined();
			expect(messageListHtml).toContain("已处理");
			expect(messageListHtml).toContain("Ran command");
			expect(messageListHtml).toContain("完成");
			expect(messageListHtml).toContain("printf &#x27;desktop-ai-agent\\n&#x27;");
			expect(messageListHtml).toContain("desktop-ai-agent");
			expect(messageListHtml).toContain("The command finished successfully.");
		} finally {
			unsubscribe();
		}
	});

	it("creates a persisted subagent and renders its summary in the activity stream", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-agent-subagent-"));
		await writeFile(join(workspaceDir, "README.md"), "# Auth\n\nLogin starts in src/auth.ts.\n", "utf-8");
		const agentDir = await mkdtemp(join(tmpdir(), "desktop-agent-home-"));
		const environmentResourceStore = new JsonEnvironmentResourceStore(
			join(agentDir, "environment", "resources.json"),
		);
		const subagentSessionsDir = join(agentDir, "subagents");
		const faux = createFauxRegistration();
		const observedToolNames: string[][] = [];
		faux.setResponses([
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage(
					[
						fauxText("I will delegate the auth investigation to a subagent."),
						fauxToolCall(
							DESKTOP_SUBAGENT_TOOL_NAME,
							{
								title: "Inspect auth flow",
								task: "Find where the auth flow is defined.",
								contextSummary: "The parent is checking login behavior.",
								scope: "Read-only inspection of auth-related files in the current workspace.",
								successCriteria: "Identify where the auth flow is defined.",
								expectedOutput: "Concise Markdown summary with conclusion, evidence paths, and blockers.",
								knownFacts: "The parent is checking login behavior.",
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
				return fauxAssistantMessage([fauxToolCall("read", { path: "README.md" }, { id: "subagent-read-1" })], {
					stopReason: "toolUse",
				});
			},
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage(
					"## Subagent conclusion\nAuth lives in `src/auth.ts`.\n\nBudget reached after the targeted read.",
				);
			},
			(context) => {
				observedToolNames.push(context.tools?.map((tool) => tool.name) ?? []);
				return fauxAssistantMessage("The subagent found `src/auth.ts`.");
			},
		]);

		const host = new DesktopRuntimeHost(() =>
			createDesktopAgentRuntime({
				agentDir,
				cwd: workspaceDir,
				environmentResourceStore,
				getApiKey: async () => "faux-key",
				model: faux.getModel(),
				subagentSessionsDir,
			}),
		);

		const observedEventTypes: string[] = [];
		let resolveAgentEnd!: () => void;
		const agentEnd = new Promise<void>((resolve) => {
			resolveAgentEnd = resolve;
		});
		const unsubscribe = await host.subscribe((event) => {
			observedEventTypes.push(event.type);
			agentStore.getState().applyEvent(event);
			if (event.type === "agent_end") {
				resolveAgentEnd();
			}
		});

		try {
			const snapshot = await host.getSnapshot();
			agentStore.getState().hydrateSnapshot(snapshot);

			await host.prompt(snapshot.sessionId, "Use a subagent to inspect the auth flow.");
			await agentEnd;

			const state = agentStore.getState();
			const messageListHtml = renderToStaticMarkup(
				createElement(MessageList, {
					messages: state.messages,
					showThinkingBlocks: false,
					toolCalls: state.toolCalls,
					defaultExpandedToolRailMessageIndex: 1,
					defaultExpandedToolCallId: "subagent-1",
				}),
			);
			const resources = await environmentResourceStore.listResources({ provider: "subagent" });
			const subagentResource = resources[0];
			const transcriptPath = subagentResource?.metadata.transcriptPath;

			expect(observedEventTypes).toContain("tool_execution_update");
			expect(observedEventTypes).toContain("tool_execution_end");
			expect(state.toolCalls[0]?.toolName).toBe(DESKTOP_SUBAGENT_TOOL_NAME);
			expect(state.toolCalls[0]?.status).toBe("completed");
			expect(observedToolNames[0]).toEqual(expect.arrayContaining([DESKTOP_SUBAGENT_TOOL_NAME]));
			expect(observedToolNames[1]).toEqual(["read", "find", "grep", "ls", "bash"]);
			expect(observedToolNames[2]).toEqual([]);
			expect(observedToolNames[1]).not.toEqual(
				expect.arrayContaining([DESKTOP_SUBAGENT_TOOL_NAME, "edit", "write"]),
			);
			expect(resources).toHaveLength(1);
			expect(subagentResource).toMatchObject({
				kind: "subagent",
				provider: "subagent",
				status: "completed",
				title: "Inspect auth flow",
			});
			expect(subagentResource?.metadata.limitReached).toBe("true");
			expect(subagentResource?.metadata.limitReason).toBe("max_turns");
			expect(subagentResource?.metadata.turnCount).toBe("1");
			expect(subagentResource?.sessionId).toBeTruthy();
			expect(transcriptPath).toBeDefined();
			expect(await readFile(transcriptPath!, "utf-8")).toContain("Auth lives in `src/auth.ts`.");
			expect(await readFile(transcriptPath!, "utf-8")).not.toContain("Operation aborted");
			expect(messageListHtml).toContain("subagent");
			expect(messageListHtml).toContain("Inspect auth flow");
			expect(messageListHtml).toContain("Read-only inspection of auth-related files");
			expect(messageListHtml).toContain("budget reached");
			expect(messageListHtml).toContain("Subagent conclusion");
			expect(messageListHtml).toContain("src/auth.ts");
			expect(messageListHtml).toContain("The subagent found `src/auth.ts`.");
		} finally {
			unsubscribe();
		}
	});

	it("creates a bounded workspace artifact without capability-search detours", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-agent-context-"));
		await writeFile(
			join(workspaceDir, "package.json"),
			JSON.stringify({ name: "context-project" }, null, 2),
			"utf-8",
		);
		await writeFile(join(workspaceDir, "README.md"), "# Context Project\n", "utf-8");

		const faux = createFauxRegistration();
		let firstRequestToolNames: string[] = [];
		let secondRequestToolNames: string[] = [];
		faux.setResponses([
			(context) => {
				firstRequestToolNames = context.tools?.map((tool) => tool.name) ?? [];
				return fauxAssistantMessage(
					[
						fauxText("I will inspect the top-level project structure first."),
						fauxToolCall("ls", { path: "." }, { id: "context-ls-1" }),
					],
					{ stopReason: "toolUse" },
				);
			},
			(context) => {
				secondRequestToolNames = context.tools?.map((tool) => tool.name) ?? [];
				return fauxAssistantMessage(
					[
						fauxText("I will write the bounded project context file."),
						fauxToolCall(
							"write",
							{
								path: "PROJECT_CONTEXT.md",
								content:
									"# Project Context\n\n- `package.json`: context-project package manifest.\n- `README.md`: project overview.\n",
							},
							{ id: "context-write-1" },
						),
					],
					{ stopReason: "toolUse" },
				);
			},
			fauxAssistantMessage("Created PROJECT_CONTEXT.md with a bounded project summary."),
		]);

		const host = new DesktopRuntimeHost(() =>
			createDesktopAgentRuntime({
				cwd: workspaceDir,
				getApiKey: async () => "faux-key",
				model: faux.getModel(),
			}),
		);

		const observedEventTypes: string[] = [];
		let resolveAgentEnd!: () => void;
		const agentEnd = new Promise<void>((resolve) => {
			resolveAgentEnd = resolve;
		});
		const unsubscribe = await host.subscribe((event) => {
			observedEventTypes.push(event.type);
			agentStore.getState().applyEvent(event);
			if (event.type === "agent_end") {
				resolveAgentEnd();
			}
		});

		try {
			const snapshot = await host.getSnapshot();
			agentStore.getState().hydrateSnapshot(snapshot);

			await host.prompt(snapshot.sessionId, "Create a workspace overview document from the current project.");
			await agentEnd;

			const state = agentStore.getState();
			const writtenContext = await readFile(join(workspaceDir, "PROJECT_CONTEXT.md"), "utf-8");
			const toolNames = state.toolCalls.map((toolCall) => toolCall.toolName);

			expect(firstRequestToolNames).toEqual(expect.arrayContaining(["ls", "write"]));
			expect(secondRequestToolNames).toEqual(expect.arrayContaining(["ls", "write"]));
			expect(secondRequestToolNames).not.toContain("activate_toolset");
			expect(toolNames).toEqual(["ls", "write"]);
			expect(toolNames).not.toEqual(expect.arrayContaining(["search_capabilities", "load_skill"]));
			expect(observedEventTypes).toContain("tool_execution_end");
			expect(writtenContext).toContain("context-project");
			expect(state.messages.at(-1)?.content).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ text: "Created PROJECT_CONTEXT.md with a bounded project summary." }),
				]),
			);
		} finally {
			unsubscribe();
		}
	});

	it("shows completion feedback when a workspace change finishes with an empty final answer", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-agent-empty-final-"));
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage(
				[
					fauxText("I will create the requested file."),
					fauxToolCall("write", { path: "REAL_TEST_A.md", content: "alpha" }, { id: "write-empty-final-1" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(""),
		]);

		const host = new DesktopRuntimeHost(() =>
			createDesktopAgentRuntime({
				cwd: workspaceDir,
				getApiKey: async () => "faux-key",
				model: faux.getModel(),
			}),
		);

		let resolveAgentEnd!: () => void;
		const agentEnd = new Promise<void>((resolve) => {
			resolveAgentEnd = resolve;
		});
		const unsubscribe = await host.subscribe((event) => {
			agentStore.getState().applyEvent(event);
			if (event.type === "agent_end") {
				resolveAgentEnd();
			}
		});

		try {
			const snapshot = await host.getSnapshot();
			agentStore.getState().hydrateSnapshot(snapshot);

			await host.prompt(snapshot.sessionId, "Create REAL_TEST_A.md with exactly one line: alpha");
			await agentEnd;

			const state = agentStore.getState();
			const writtenFile = await readFile(join(workspaceDir, "REAL_TEST_A.md"), "utf-8");

			expect(writtenFile).toBe("alpha");
			expect(state.messages.at(-1)?.content).toEqual(
				expect.arrayContaining([expect.objectContaining({ type: "text", text: "Done." })]),
			);
		} finally {
			unsubscribe();
		}
	});

	it("answers exact local read requests without a model continuation", async () => {
		const workspaceDir = await mkdtemp(join(tmpdir(), "desktop-agent-exact-read-"));
		await writeFile(join(workspaceDir, "REAL_TEST_SUMMARY.md"), "first line\nsecond line\n", "utf-8");

		const faux = createFauxRegistration();
		faux.setResponses([
			() => {
				throw new Error("provider should not be called for deterministic exact local reads");
			},
		]);

		const host = new DesktopRuntimeHost(() =>
			createDesktopAgentRuntime({
				cwd: workspaceDir,
				getApiKey: async () => "faux-key",
				model: faux.getModel(),
			}),
		);

		let resolveAgentEnd!: () => void;
		const agentEnd = new Promise<void>((resolve) => {
			resolveAgentEnd = resolve;
		});
		const unsubscribe = await host.subscribe((event) => {
			agentStore.getState().applyEvent(event);
			if (event.type === "agent_end") {
				resolveAgentEnd();
			}
		});

		try {
			const snapshot = await host.getSnapshot();
			agentStore.getState().hydrateSnapshot(snapshot);

			await host.prompt(snapshot.sessionId, "Read REAL_TEST_SUMMARY.md and reply with its first line only.");
			await agentEnd;

			const state = agentStore.getState();

			expect(faux.state.callCount).toBe(0);
			expect(state.toolCalls[0]?.toolName).toBe("read");
			expect(state.messages.at(-1)?.content).toEqual(
				expect.arrayContaining([expect.objectContaining({ type: "text", text: "first line" })]),
			);
		} finally {
			unsubscribe();
		}
	});
});
