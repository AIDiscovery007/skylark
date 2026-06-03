import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	type AgentSession,
	loadSkillsFromDir,
	type PromptTemplate,
	parseFrontmatter,
	type ResourceDiagnostic,
	type Skill,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
	DesktopCapabilityCatalog,
	DesktopCapabilityDetail,
	DesktopCapabilityDetailRequest,
	DesktopCapabilityScope,
	DesktopCapabilitySource,
	DesktopCreateSkillRequest,
	DesktopPromptTemplateDeleteRequest,
	DesktopPromptTemplateSummary,
	DesktopPromptTemplateUpsertRequest,
	DesktopResourceDiagnosticSummary,
	DesktopSkillSummary,
	DesktopSlashCommandSummary,
} from "../../shared/types.ts";
import type { DesktopMcpManager } from "../mcp/mcp-manager.ts";

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;
const PROMPT_TEMPLATE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const DESKTOP_BUNDLED_SKILLS_DIR_NAME = "bundled-skills";
const BUNDLED_TMUX_SKILL_CONTENT = `---
name: tmux
description: Use tmux from bash for long-running work, parallel terminals, logs, and resumable terminal state in Skylark Environment Space.
---

# Skylark tmux Environment

Use this skill when work needs a terminal to keep running while the agent continues elsewhere:

- long-running tests, builds, migrations, downloads, or dev servers
- parallel shells for server, watcher, test, and log streams
- terminal state that should survive prompt turns or agent restarts
- inspecting existing Environment resources that the desktop app discovered

Do not use tmux for one-shot commands that finish quickly. Use plain bash for those.

## Environment

The desktop bash tool provides these variables when available:

- \`SKYLARK_DESKTOP_SESSION_ID\`: current Skylark session id
- \`SKYLARK_DESKTOP_CWD\`: current Skylark workspace cwd

Use them when naming tmux sessions and setting metadata. If \`SKYLARK_DESKTOP_SESSION_ID\` is missing, do not invent a Skylark session id.

## Naming

Create sessions with:

\`\`\`bash
session_hash="$(printf '%s' "$SKYLARK_DESKTOP_SESSION_ID" | shasum -a 256 | cut -c1-10)"
purpose_slug="dev-server"
tmux_name="skylark_\${session_hash}_\${purpose_slug}"
tmux new-session -d -s "$tmux_name" -c "\${SKYLARK_DESKTOP_CWD:-$PWD}"
\`\`\`

Keep \`purpose_slug\` short, lowercase, and specific, such as \`dev-server\`, \`tests\`, \`logs\`, or \`migration\`.

## Metadata

After creating a tmux session or window, set user options so the Skylark Environment registry can claim it:

\`\`\`bash
tmux set-option -t "$tmux_name" -q @skylark-session-id "$SKYLARK_DESKTOP_SESSION_ID"
tmux set-option -t "$tmux_name" -q @skylark-cwd "\${SKYLARK_DESKTOP_CWD:-$PWD}"
tmux set-option -t "$tmux_name" -q @skylark-title "Dev server"
tmux set-option -t "$tmux_name" -q @skylark-resource-kind "tmux_session"
\`\`\`

For windows, set the same options on the window target when useful:

\`\`\`bash
tmux new-window -t "$tmux_name" -n tests -c "\${SKYLARK_DESKTOP_CWD:-$PWD}"
tmux set-option -t "$tmux_name:tests" -wq @skylark-session-id "$SKYLARK_DESKTOP_SESSION_ID"
tmux set-option -t "$tmux_name:tests" -wq @skylark-cwd "\${SKYLARK_DESKTOP_CWD:-$PWD}"
tmux set-option -t "$tmux_name:tests" -wq @skylark-title "Tests"
tmux set-option -t "$tmux_name:tests" -wq @skylark-resource-kind "tmux_window"
\`\`\`

## Reading Context

When you need terminal output, capture it yourself from bash:

\`\`\`bash
tmux capture-pane -t "$tmux_name:tests" -p -S -200
\`\`\`

Capture only the lines needed for the decision. Do not rely on the app to inject Environment context into the prompt.

## Cleanup

At task completion, close only tmux resources you created and no longer need:

\`\`\`bash
tmux kill-session -t "$tmux_name"
\`\`\`

Never kill user-created sessions or sessions whose purpose you did not establish.
`;

function normalizeSkillName(name: string): string {
	const normalized = name.trim();
	if (!SKILL_NAME_PATTERN.test(normalized) || normalized.includes("--")) {
		throw new Error("Skill name must be lowercase letters, numbers, and hyphens without leading/trailing hyphens.");
	}
	return normalized;
}

function normalizePromptTemplateName(name: string): string {
	const normalized = name.trim();
	if (!normalized) {
		throw new Error("Prompt template name is required.");
	}
	if (!PROMPT_TEMPLATE_NAME_PATTERN.test(normalized)) {
		throw new Error(
			"Prompt template name must start with a letter or number and use only letters, numbers, '.', '_', or '-'.",
		);
	}
	return normalized;
}

function quoteYaml(value: string): string {
	return JSON.stringify(value);
}

function serializeDesktopPromptTemplate(options: {
	description: string;
	content: string;
	argumentHint?: string;
}): string {
	const description = options.description.trim();
	const argumentHint = options.argumentHint?.trim();
	const normalizedBody = options.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\s+$/, "");
	const frontmatterLines = ["---", `description: ${quoteYaml(description)}`];
	if (argumentHint) {
		frontmatterLines.push(`argument-hint: ${quoteYaml(argumentHint)}`);
	}
	frontmatterLines.push("---", normalizedBody);
	return `${frontmatterLines.join("\n")}\n`;
}

function getScopeDir(
	cwd: string,
	agentDir: string,
	scope: DesktopCapabilityScope,
	resourceType: "skills" | "prompts",
): string {
	return scope === "global" ? join(agentDir, resourceType) : resolve(cwd, ".pi", resourceType);
}

function toSourceSummary(sourceInfo: {
	path: string;
	source: string;
	scope: string;
	origin: string;
}): DesktopCapabilitySource {
	const readOnly = sourceInfo.source === "codex" || sourceInfo.origin === "package";
	const scope =
		sourceInfo.source === "codex"
			? "external"
			: sourceInfo.origin === "package"
				? "package"
				: sourceInfo.scope === "user"
					? "global"
					: sourceInfo.scope === "project"
						? "project"
						: "external";
	return {
		label: sourceInfo.source,
		path: sourceInfo.path,
		scope,
		readOnly,
	};
}

function toDiagnosticSummary(diagnostic: ResourceDiagnostic): DesktopResourceDiagnosticSummary {
	return {
		type: diagnostic.type,
		message: diagnostic.message,
		path: "path" in diagnostic ? diagnostic.path : undefined,
	};
}

function loadDesktopBundledSkills(agentDir: string | undefined): {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
} {
	if (!agentDir) {
		return { skills: [], diagnostics: [] };
	}
	const bundledSkillDir = join(agentDir, DESKTOP_BUNDLED_SKILLS_DIR_NAME, "tmux");
	const bundledSkillPath = join(bundledSkillDir, "SKILL.md");
	mkdirSync(bundledSkillDir, { recursive: true });
	writeFileSync(bundledSkillPath, BUNDLED_TMUX_SKILL_CONTENT, "utf8");
	return loadSkillsFromDir({ dir: join(agentDir, DESKTOP_BUNDLED_SKILLS_DIR_NAME), source: "desktop-bundled" });
}

export function mergeCodexSkills(
	base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] },
	options: { agentDir?: string } = {},
): {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
} {
	const explicitBaseSkills = base.skills.map((skill) => ({
		...skill,
		disableModelInvocation: true,
	}));
	const bundledSkills = loadDesktopBundledSkills(options.agentDir);
	const codexSkillsDir = join(homedir(), ".codex", "skills");
	if (!existsSync(codexSkillsDir)) {
		return {
			skills: [...explicitBaseSkills, ...bundledSkills.skills],
			diagnostics: [...base.diagnostics, ...bundledSkills.diagnostics],
		};
	}

	const codexSkills = loadSkillsFromDir({ dir: codexSkillsDir, source: "codex" });
	const seen = new Set([...explicitBaseSkills, ...bundledSkills.skills].map((skill) => skill.name));
	const explicitCodexSkills = codexSkills.skills.map((skill) => ({
		...skill,
		disableModelInvocation: true,
	}));
	return {
		skills: [
			...explicitBaseSkills,
			...bundledSkills.skills,
			...explicitCodexSkills.filter((skill) => !seen.has(skill.name)),
		],
		diagnostics: [...base.diagnostics, ...bundledSkills.diagnostics, ...codexSkills.diagnostics],
	};
}

export async function createDesktopSkill(
	cwd: string,
	agentDir: string,
	request: DesktopCreateSkillRequest,
): Promise<string> {
	const scope = request.scope ?? "project";
	const name = normalizeSkillName(request.name);
	const description = request.description.trim();
	if (!description) {
		throw new Error("Skill description is required.");
	}
	const skillDir = join(getScopeDir(cwd, agentDir, scope, "skills"), name);
	const skillPath = join(skillDir, "SKILL.md");
	if (!request.overwrite && existsSync(skillPath)) {
		throw new Error(`Skill already exists: ${skillPath}`);
	}
	const body = request.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
	const content = [
		"---",
		`name: ${quoteYaml(name)}`,
		`description: ${quoteYaml(description)}`,
		"---",
		"",
		body,
		"",
	].join("\n");
	await mkdir(skillDir, { recursive: true });
	await writeFile(skillPath, content, "utf8");
	return skillPath;
}

export function upsertDesktopPromptTemplate(
	cwd: string,
	agentDir: string,
	request: DesktopPromptTemplateUpsertRequest,
): { path: string; content: string } {
	const scope = request.scope ?? "project";
	const name = normalizePromptTemplateName(request.name);
	const description = request.description.trim() || name;
	const dir = getScopeDir(cwd, agentDir, scope, "prompts");
	const filePath = join(dir, `${name}.md`);
	if (!(request.overwrite ?? true) && existsSync(filePath)) {
		throw new Error(`Prompt template already exists: ${filePath}`);
	}
	mkdirSync(dir, { recursive: true });
	const content = serializeDesktopPromptTemplate({
		description,
		content: request.content,
		...(request.argumentHint?.trim() ? { argumentHint: request.argumentHint.trim() } : {}),
	});
	writeFileSync(filePath, content, "utf-8");
	return { path: filePath, content };
}

export function deleteDesktopPromptTemplate(request: DesktopPromptTemplateDeleteRequest): { path: string } {
	const resolvedPath = resolve(request.filePath);
	if (!existsSync(resolvedPath)) {
		throw new Error(`Prompt template not found: ${resolvedPath}`);
	}
	if (!statSync(resolvedPath).isFile()) {
		throw new Error(`Prompt template is not a file: ${resolvedPath}`);
	}
	unlinkSync(resolvedPath);
	return { path: resolvedPath };
}

export function createCapabilityTools(actions: {
	createSkill: (request: DesktopCreateSkillRequest) => Promise<DesktopCapabilityCatalog>;
	upsertPromptTemplate: (request: DesktopPromptTemplateUpsertRequest) => Promise<DesktopCapabilityCatalog>;
	upsertMcpServer: (request: {
		name: string;
		command: string;
		args?: string[];
		env?: Record<string, string>;
		cwd?: string;
		enabled?: boolean;
		connectNow?: boolean;
	}) => Promise<DesktopCapabilityCatalog>;
	reloadCapabilities: () => Promise<DesktopCapabilityCatalog>;
}): ToolDefinition[] {
	return [
		{
			name: "create_skill",
			label: "Create skill",
			description: "Create or update a local Skylark skill in the current project by default.",
			parameters: {
				type: "object",
				properties: {
					name: { type: "string" },
					description: { type: "string" },
					content: { type: "string" },
					scope: { type: "string", enum: ["project", "global"] },
					overwrite: { type: "boolean" },
				},
				required: ["name", "description", "content"],
			},
			executionMode: "sequential",
			execute: async (_toolCallId, params) => {
				const catalog = await actions.createSkill(params as DesktopCreateSkillRequest);
				return {
					content: [{ type: "text", text: `Skill saved. ${catalog.skills.length} skills are now available.` }],
					details: { skills: catalog.skills.length },
				};
			},
		},
		{
			name: "create_prompt_template",
			label: "Create prompt template",
			description: "Create or update a local prompt template in the current project by default.",
			parameters: {
				type: "object",
				properties: {
					name: { type: "string" },
					description: { type: "string" },
					content: { type: "string" },
					argumentHint: { type: "string" },
					scope: { type: "string", enum: ["project", "global"] },
					overwrite: { type: "boolean" },
				},
				required: ["name", "description", "content"],
			},
			executionMode: "sequential",
			execute: async (_toolCallId, params) => {
				const catalog = await actions.upsertPromptTemplate(params as DesktopPromptTemplateUpsertRequest);
				return {
					content: [
						{ type: "text", text: `Prompt template saved. ${catalog.prompts.length} prompts are available.` },
					],
					details: { prompts: catalog.prompts.length },
				};
			},
		},
		{
			name: "configure_mcp_server",
			label: "Configure MCP server",
			description: "Add or update a stdio MCP server. Servers are disabled by default unless connectNow is true.",
			parameters: {
				type: "object",
				properties: {
					name: { type: "string" },
					command: { type: "string" },
					args: { type: "array", items: { type: "string" } },
					env: { type: "object", additionalProperties: { type: "string" } },
					cwd: { type: "string" },
					enabled: { type: "boolean" },
					connectNow: { type: "boolean" },
				},
				required: ["name", "command"],
			},
			executionMode: "sequential",
			execute: async (_toolCallId, params) => {
				const request = params as {
					name: string;
					command: string;
					args?: string[];
					env?: Record<string, string>;
					cwd?: string;
					enabled?: boolean;
					connectNow?: boolean;
				};
				const catalog = await actions.upsertMcpServer({
					...request,
					enabled: request.enabled ?? request.connectNow === true,
				});
				return {
					content: [{ type: "text", text: `MCP server saved. ${catalog.mcpServers.length} servers configured.` }],
					details: { mcpServers: catalog.mcpServers.length },
				};
			},
		},
		{
			name: "reload_capabilities",
			label: "Reload capabilities",
			description: "Reload skills, prompt templates, MCP tools, and slash commands for this desktop session.",
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
			executionMode: "sequential",
			execute: async () => {
				const catalog = await actions.reloadCapabilities();
				return {
					content: [
						{
							type: "text",
							text: `Capabilities reloaded: ${catalog.skills.length} skills, ${catalog.prompts.length} prompts, ${catalog.mcpServers.length} MCP servers.`,
						},
					],
					details: {
						skills: catalog.skills.length,
						prompts: catalog.prompts.length,
						mcpServers: catalog.mcpServers.length,
					},
				};
			},
		},
	];
}

export async function createCapabilityCatalog(
	session: AgentSession,
	mcpManager: DesktopMcpManager,
): Promise<DesktopCapabilityCatalog> {
	const skillsResult = session.resourceLoader.getSkills();
	const promptsResult = session.resourceLoader.getPrompts();
	const slashCommands: DesktopSlashCommandSummary[] = [
		{
			name: "compact",
			description: "Manually compact the session context",
			source: "builtin",
		},
		...skillsResult.skills.map(
			(skill): DesktopSlashCommandSummary => ({
				name: `skill:${skill.name}`,
				description: skill.description,
				source: "skill",
				sourcePath: skill.filePath,
			}),
		),
		...promptsResult.prompts.map(
			(prompt: PromptTemplate): DesktopSlashCommandSummary => ({
				name: prompt.name,
				description: prompt.description,
				source: "prompt",
				sourcePath: prompt.filePath,
			}),
		),
	];

	return {
		skills: skillsResult.skills.map(
			(skill): DesktopSkillSummary => ({
				name: skill.name,
				description: skill.description,
				filePath: skill.filePath,
				baseDir: skill.baseDir,
				disableModelInvocation: skill.disableModelInvocation,
				source: toSourceSummary(skill.sourceInfo),
			}),
		),
		prompts: promptsResult.prompts.map(
			(prompt): DesktopPromptTemplateSummary => ({
				name: prompt.name,
				description: prompt.description,
				argumentHint: prompt.argumentHint,
				filePath: prompt.filePath,
				source: toSourceSummary(prompt.sourceInfo),
			}),
		),
		slashCommands,
		mcpServers: await mcpManager.listServers(),
		diagnostics: [...skillsResult.diagnostics, ...promptsResult.diagnostics].map(toDiagnosticSummary),
	};
}

export async function readCapabilityDetail(
	session: AgentSession,
	request: DesktopCapabilityDetailRequest,
): Promise<DesktopCapabilityDetail> {
	if (request.type === "skill") {
		const skill = session.resourceLoader
			.getSkills()
			.skills.find((candidate) => candidate.filePath === request.filePath);
		if (!skill) {
			throw new Error("Capability detail is not available for this skill path.");
		}
		const rawContent = await readFile(skill.filePath, "utf8");
		const { body } = parseFrontmatter(rawContent);
		return {
			type: "skill",
			name: skill.name,
			description: skill.description,
			body,
			filePath: skill.filePath,
			source: toSourceSummary(skill.sourceInfo),
			disableModelInvocation: skill.disableModelInvocation,
		};
	}

	const prompt = session.resourceLoader
		.getPrompts()
		.prompts.find((candidate) => candidate.filePath === request.filePath);
	if (!prompt) {
		throw new Error("Capability detail is not available for this prompt template path.");
	}
	return {
		type: "prompt_template",
		name: prompt.name,
		description: prompt.description,
		body: prompt.content,
		filePath: prompt.filePath,
		source: toSourceSummary(prompt.sourceInfo),
		...(prompt.argumentHint ? { argumentHint: prompt.argumentHint } : {}),
	};
}
