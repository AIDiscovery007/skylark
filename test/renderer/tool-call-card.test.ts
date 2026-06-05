import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolOutput } from "../../src/renderer/components/ai-elements/tool.tsx";
import { InlineToolRail } from "../../src/renderer/components/chat/InlineToolRail.tsx";
import { ToolActivityDetails } from "../../src/renderer/components/chat/ToolCallCard.tsx";

describe("tool activity rendering", () => {
	it("renders edit tool details with a structured diff section", () => {
		const html = renderToStaticMarkup(
			createElement(ToolActivityDetails, {
				toolCall: {
					toolCallId: "edit-1",
					toolName: "edit",
					args: {
						path: "src/app.ts",
						edits: [{ oldText: "hello", newText: "world" }],
					},
					status: "completed",
					startedAt: 1,
					updatedAt: 2,
					completedAt: 2,
					result: {
						content: [{ type: "text", text: "Successfully edited src/app.ts" }],
						details: {
							diff: "@@ -1,1 +1,1 @@\n-hello\n+world",
						},
					},
				},
			}),
		);

		expect(html).toContain("src/app.ts");
		expect(html).toContain("1 replacement");
		expect(html).toContain("Successfully edited src/app.ts");
		expect(html).toContain("@@ -1,1 +1,1 @@");
	});

	it("keeps image content out of expanded tool result previews", () => {
		const html = renderToStaticMarkup(
			createElement(ToolActivityDetails, {
				toolCall: {
					toolCallId: "mcp-image-1",
					toolName: "mcp__browser__screenshot",
					args: { selector: "#preview" },
					status: "completed",
					startedAt: 1,
					updatedAt: 2,
					completedAt: 2,
					result: {
						content: [
							{ type: "text", text: "Screenshot captured." },
							{
								type: "image",
								name: "preview.png",
								mimeType: "image/png",
								data: "iVBORw0KGgo=",
							},
						],
					},
				},
			}),
		);

		expect(html).not.toContain('data-slot="tool-activity-image"');
		expect(html).not.toContain('src="data:image/png;base64,iVBORw0KGgo="');
		expect(html).not.toContain('alt="preview.png"');
		expect(html).toContain("preview.png");
		expect(html).toContain("Screenshot captured.");
	});

	it("omits image previews and raw base64 from generic tool output", () => {
		const largeBase64 = "a".repeat(128);
		const html = renderToStaticMarkup(
			createElement(ToolActivityDetails, {
				toolCall: {
					toolCallId: "mcp-image-attachment-1",
					toolName: "mcp__browser__inspect",
					args: { target: "preview" },
					status: "completed",
					startedAt: 1,
					updatedAt: 2,
					completedAt: 2,
					result: {
						content: [{ type: "text", text: "Attached image metadata." }],
						details: {
							attachments: [
								{
									kind: "image",
									name: "activity-preview.png",
									mimeType: "image/png",
									images: [{ data: largeBase64, mimeType: "image/png" }],
								},
							],
						},
					},
				},
			}),
		);

		expect(html).not.toContain('data-slot="tool-activity-image"');
		expect(html).not.toContain('src="data:image/png;base64,');
		expect(html).toContain("activity-preview.png");
		expect(html).toContain("[base64 image omitted]");
		expect(html).not.toContain(largeBase64);
	});

	it("renders a compact inline rail summary with visible activity rows", () => {
		const html = renderToStaticMarkup(
			createElement(InlineToolRail, {
				toolCalls: [
					{
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "README.md" },
						status: "completed",
						startedAt: 1,
						updatedAt: 2,
						completedAt: 2,
						result: { content: [{ type: "text", text: "done" }] },
					},
				],
			}),
		);

		expect(html).toContain("已处理 0s");
		expect(html).toContain("Read README.md");
		expect(html).toContain("README.md");
	});

	it("renders expanded rail rows with status summaries and inline details", () => {
		const timestamp = Date.parse("2025-05-05T10:31:00Z");

		const html = renderToStaticMarkup(
			createElement(InlineToolRail, {
				defaultExpanded: true,
				defaultExpandedToolCallId: "bash-1",
				toolCalls: [
					{
						toolCallId: "bash-1",
						toolName: "bash",
						args: { command: "printf 'desktop-ai-agent\\n'" },
						status: "running",
						startedAt: timestamp,
						updatedAt: timestamp,
						partialResult: { content: [{ type: "text", text: "desktop-ai-agent" }] },
					},
				],
			}),
		);

		expect(html).toContain("正在运行 0s");
		expect(html).toContain("Ran command");
		expect(html).toContain("运行中");
		expect(html).toContain("printf &#x27;desktop-ai-agent\\n&#x27;");
		expect(html).toContain("desktop-ai-agent");
	});

	it("renders expanded details directly under the selected tool row", () => {
		const html = renderToStaticMarkup(
			createElement(InlineToolRail, {
				defaultExpanded: true,
				defaultExpandedToolCallId: "read-1",
				toolCalls: [
					{
						toolCallId: "read-1",
						toolName: "read",
						args: { path: "README.md" },
						status: "completed",
						startedAt: 1,
						updatedAt: 2,
						completedAt: 2,
						result: { content: [{ type: "text", text: "README.md contents" }] },
					},
					{
						toolCallId: "bash-1",
						toolName: "bash",
						args: { command: "printf 'desktop-ai-agent\\n'" },
						status: "completed",
						startedAt: 3,
						updatedAt: 4,
						completedAt: 4,
						result: { content: [{ type: "text", text: "desktop-ai-agent" }] },
					},
				],
			}),
		);
		const readRowIndex = html.indexOf("Read README.md");
		const readDetailIndex = html.indexOf("Preview");
		const bashRowIndex = html.indexOf("Ran command");

		expect(readRowIndex).toBeGreaterThan(-1);
		expect(readDetailIndex).toBeGreaterThan(readRowIndex);
		expect(bashRowIndex).toBeGreaterThan(readDetailIndex);
	});

	it("renders an error summary for failed tool activity", () => {
		const html = renderToStaticMarkup(
			createElement(InlineToolRail, {
				toolCalls: [
					{
						toolCallId: "bash-1",
						toolName: "bash",
						args: { command: "exit 1" },
						status: "error",
						startedAt: 1_000,
						updatedAt: 2_000,
						completedAt: 2_000,
						result: { content: [{ type: "text", text: "failed" }] },
					},
				],
			}),
		);

		expect(html).toContain("处理失败 1s");
		expect(html).toContain("错误");
	});

	it("keeps failed command details in bounded local viewports", () => {
		const longOutput = Array.from({ length: 18 }, (_, index) => `line ${index + 1}: failure detail`).join("\n");
		const html = renderToStaticMarkup(
			createElement(ToolActivityDetails, {
				toolCall: {
					toolCallId: "bash-compact-1",
					toolName: "bash",
					args: { command: "pwd && git status --short && rg -n TODO" },
					status: "error",
					startedAt: 1,
					updatedAt: 2,
					completedAt: 2,
					result: { content: [{ type: "text", text: longOutput }] },
				},
			}),
		);

		expect(html).toContain('data-slot="tool-activity-detail-viewport"');
		expect(html).toContain("runtime-tool-section-scrollport");
		expect(html).toContain("overflow-auto");
		expect(html).toContain("line 18: failure detail");
	});

	it("keeps fallback tool output in bounded local viewports", () => {
		const longError = Array.from({ length: 16 }, (_, index) => `error line ${index + 1}`).join("\n");
		const longResult = Array.from({ length: 16 }, (_, index) => `result line ${index + 1}`).join("\n");
		const html = renderToStaticMarkup(
			createElement(ToolOutput, {
				errorText: longError,
				output: longResult,
			}),
		);

		expect(html).toContain('data-slot="tool-output-error-viewport"');
		expect(html).toContain('data-slot="tool-output-result-viewport"');
		expect(html).toContain("runtime-tool-section-scrollport");
		expect(html).toContain("overflow-auto");
		expect(html).toContain("error line 16");
		expect(html).toContain("result line 16");
	});

	it("renders MCP source metadata for adapted tools", () => {
		const html = renderToStaticMarkup(
			createElement(ToolActivityDetails, {
				toolCall: {
					toolCallId: "mcp-1",
					toolName: "mcp__filesystem__search",
					args: { query: "desktop" },
					status: "completed",
					startedAt: 1,
					updatedAt: 2,
					completedAt: 2,
					result: {
						content: [{ type: "text", text: "README.md" }],
						details: { serverId: "filesystem", toolName: "search" },
					},
				},
			}),
		);

		expect(html).toContain("MCP Source");
		expect(html).toContain("filesystem / search");
		expect(html).toContain("README.md");
	});

	it("renders subagent activity with markdown summary and transcript metadata", () => {
		const html = renderToStaticMarkup(
			createElement(ToolActivityDetails, {
				toolCall: {
					toolCallId: "subagent-1",
					toolName: "subagent",
					args: {
						title: "Inspect auth flow",
						task: "Find the files that define auth.",
						contextSummary: "Parent is investigating login failures.",
						scope: "Read-only auth inspection.",
						successCriteria: "Identify the auth entrypoint.",
						expectedOutput: "Concise Markdown summary.",
						knownFacts: "Login is failing.",
						suggestedApproach: "Locate auth files and read the strongest match.",
						maxTurns: 1,
					},
					status: "completed",
					startedAt: 1,
					updatedAt: 2,
					completedAt: 2,
					result: {
						content: [{ type: "text", text: "## Conclusion\nAuth lives in `src/auth.ts`." }],
						details: {
							status: "completed",
							subagentId: "subagent-session-1",
							transcriptPath: "/Users/qiaochao/.skylark/subagents/parent/subagent-session-1.jsonl",
							turnCount: 1,
							limitReached: true,
							limitReason: "max_turns",
						},
					},
				},
			}),
		);

		expect(html).toContain("Find the files that define auth.");
		expect(html).toContain("Parent is investigating login failures.");
		expect(html).toContain("Read-only auth inspection.");
		expect(html).toContain("Identify the auth entrypoint.");
		expect(html).toContain("budget reached");
		expect(html).toContain("Conclusion");
		expect(html).toContain("src/auth.ts");
		expect(html).toContain("Transcript");
		expect(html).toContain("subagent-session-1.jsonl");
	});
});
