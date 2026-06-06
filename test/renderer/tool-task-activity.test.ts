import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolOutput } from "../../src/renderer/components/ai-elements/tool.tsx";
import { InlineToolRail } from "../../src/renderer/components/chat/InlineToolRail.tsx";

describe("tool activity rendering", () => {
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

	it("renders expanded rail rows as lightweight task items without inline details", () => {
		const timestamp = Date.parse("2025-05-05T10:31:00Z");

		const html = renderToStaticMarkup(
			createElement(InlineToolRail, {
				defaultExpanded: true,
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
		expect(html).not.toContain("printf &#x27;desktop-ai-agent\\n&#x27;");
		expect(html).not.toContain("desktop-ai-agent");
		expect(html).not.toContain("Command");
		expect(html).not.toContain("tool-activity-details");
	});

	it("renders expanded rail rows as task items in call order", () => {
		const html = renderToStaticMarkup(
			createElement(InlineToolRail, {
				defaultExpanded: true,
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
		const readRowIndex = html.indexOf("Read");
		const readFileIndex = html.indexOf("README.md");
		const bashRowIndex = html.indexOf("Ran command");

		expect(readRowIndex).toBeGreaterThan(-1);
		expect(readFileIndex).toBeGreaterThan(readRowIndex);
		expect(bashRowIndex).toBeGreaterThan(readFileIndex);
		expect(html).not.toContain("Preview");
		expect(html).not.toContain("Command");
		expect(html).not.toContain("tool-activity-details");
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
});
