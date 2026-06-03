import type { Model } from "@earendil-works/pi-ai";
import type { AgentSessionServices } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	createModeAwareRuntimePolicy,
	validatePlanModeBashCommand,
} from "../../src/main/runtime/mode-aware-runtime-policy.ts";
import { DESKTOP_SUBAGENT_TOOL_NAME, DESKTOP_TASK_PROGRESS_TOOL_NAME } from "../../src/shared/types.ts";

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

const runtimePolicySupport = {
	agentDir: "/tmp/skylark",
	getModel: () => desktopTestModel,
	getThinkingLevel: () => "off" as const,
	services: {} as AgentSessionServices,
};

describe("mode-aware runtime policy", () => {
	it("exposes only read and exploration tools in plan mode", () => {
		const policy = createModeAwareRuntimePolicy({
			...runtimePolicySupport,
			agentMode: "plan",
			cwd: "/workspace/project",
			desktopSessionId: "session-1",
		});

		expect(policy.builtInTools.map((tool) => tool.name)).toEqual([
			"read",
			"find",
			"grep",
			"ls",
			"bash",
			DESKTOP_SUBAGENT_TOOL_NAME,
		]);
	});

	it("includes direct mutation, task progress, and event tools in execute mode", () => {
		const policy = createModeAwareRuntimePolicy({
			...runtimePolicySupport,
			agentMode: "execute",
			cwd: "/workspace/project",
			desktopSessionId: "session-1",
		});

		expect(policy.builtInTools.map((tool) => tool.name)).toEqual([
			"read",
			"find",
			"grep",
			"ls",
			"bash",
			"edit",
			"write",
			DESKTOP_TASK_PROGRESS_TOOL_NAME,
			"create_events",
			DESKTOP_SUBAGENT_TOOL_NAME,
		]);
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

	it("returns plan mode block reasons for mutating tools and unsafe bash", () => {
		const policy = createModeAwareRuntimePolicy({
			agentMode: "plan",
			cwd: "/workspace/project",
			desktopSessionId: "session-1",
		});

		expect(policy.getToolBlockReason("edit", {})).toContain("Plan mode blocks mutating tool");
		expect(policy.getToolBlockReason("write", {})).toContain("Plan mode blocks mutating tool");
		expect(policy.getToolBlockReason(DESKTOP_TASK_PROGRESS_TOOL_NAME, {})).toContain(
			"Plan mode blocks mutating tool",
		);
		expect(policy.getToolBlockReason("create_events", {})).toContain("Plan mode blocks mutating tool");
		expect(policy.getToolBlockReason("create_skill", {})).toContain("Plan mode blocks mutating tool");
		expect(policy.getToolBlockReason("bash", { command: "npm run check" })).toContain(
			"Plan mode blocked bash command",
		);
		expect(policy.getToolBlockReason("read", {})).toBeUndefined();
		expect(policy.getToolBlockReason("bash", { command: "git status --short" })).toBeUndefined();
	});

	it("resolves active tools for initial creation and runtime refresh", () => {
		const planPolicy = createModeAwareRuntimePolicy({
			agentMode: "plan",
			cwd: "/workspace/project",
			desktopSessionId: "session-1",
		});
		const executePolicy = createModeAwareRuntimePolicy({
			agentMode: "execute",
			cwd: "/workspace/project",
			desktopSessionId: "session-1",
		});

		expect(planPolicy.resolveInitialActiveToolNames(["read", "edit", "write"])).toEqual([
			"read",
			"find",
			"grep",
			"ls",
			"bash",
			DESKTOP_SUBAGENT_TOOL_NAME,
		]);
		expect(
			planPolicy.resolveRefreshedActiveToolNames({
				builtInToolNames: ["read", "edit"],
				capabilityToolNames: ["create_skill"],
				mcpToolNames: ["external"],
			}),
		).toEqual(["read", "find", "grep", "ls", "bash", DESKTOP_SUBAGENT_TOOL_NAME]);
		expect(executePolicy.resolveInitialActiveToolNames(["external", "read"])).toEqual([
			"read",
			"find",
			"grep",
			"ls",
			"bash",
			"edit",
			"write",
			"create_events",
			DESKTOP_SUBAGENT_TOOL_NAME,
			DESKTOP_TASK_PROGRESS_TOOL_NAME,
			"external",
		]);
		expect(
			executePolicy.resolveRefreshedActiveToolNames({
				builtInToolNames: ["read", "bash"],
				capabilityToolNames: ["create_skill"],
				mcpToolNames: ["external"],
			}),
		).toEqual(["read", "bash", "create_skill", "external"]);
	});
});
