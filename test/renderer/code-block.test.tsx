import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "../../src/renderer/components/ai-elements/code-block.tsx";

const shikiMock = vi.hoisted(() => ({
	createJavaScriptRegexEngine: vi.fn(() => ({ engine: "javascript-regex" })),
	getSingletonHighlighter: vi.fn(),
}));

vi.mock("shiki/bundle/full", () => ({
	getSingletonHighlighter: shikiMock.getSingletonHighlighter,
}));

vi.mock("shiki/engine/javascript", () => ({
	createJavaScriptRegexEngine: shikiMock.createJavaScriptRegexEngine,
}));

function createHighlighter(tokens: Array<Array<{ color?: string; content: string }>>) {
	return {
		codeToTokens: vi.fn(() => ({
			bg: "transparent",
			fg: "inherit",
			tokens,
		})),
		getLoadedLanguages: vi.fn(() => ["javascript", "typescript"]),
	};
}

beforeEach(() => {
	shikiMock.getSingletonHighlighter.mockReset();
});

afterEach(() => {
	cleanup();
});

describe("CodeBlock", () => {
	it("shows raw code immediately by default while highlighting loads", () => {
		shikiMock.getSingletonHighlighter.mockReturnValue(new Promise(() => undefined));

		render(<CodeBlock code="console.log('ready');" language="javascript" />);

		expect(screen.getByText("console.log('ready');")).toBeTruthy();
		expect(document.querySelector('[data-slot="code-block-highlight-loading"]')).toBeNull();
	});

	it("waits for highlighted tokens before showing code when requested", async () => {
		let resolveHighlighter: (value: ReturnType<typeof createHighlighter>) => void = () => undefined;
		shikiMock.getSingletonHighlighter.mockReturnValue(
			new Promise((resolve) => {
				resolveHighlighter = resolve;
			}),
		);

		render(<CodeBlock code="const value = 1;" language="typescript" waitForHighlight />);

		expect(document.querySelector('[data-slot="code-block-highlight-loading"]')).toBeTruthy();
		expect(screen.queryByText("const value = 1;")).toBeNull();
		expect(shikiMock.getSingletonHighlighter).toHaveBeenCalledWith(
			expect.objectContaining({
				engine: { engine: "javascript-regex" },
				langs: ["typescript"],
				themes: ["github-light", "github-dark"],
			}),
		);

		await act(async () => {
			resolveHighlighter(
				createHighlighter([
					[
						{ color: "#cf222e", content: "const" },
						{ color: "#24292f", content: " value = 1;" },
					],
				]),
			);
		});

		await waitFor(() => {
			expect(document.querySelector('[data-slot="code-block-highlight-loading"]')).toBeNull();
			expect(screen.getByText("const")).toBeTruthy();
			expect(document.querySelector("code")?.textContent).toBe("const value = 1;");
		});
	});

	it("falls back to plain text when requested highlighting fails", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			shikiMock.getSingletonHighlighter.mockRejectedValue(new Error("highlight failed"));

			render(<CodeBlock code="let failed = true;" language="go" waitForHighlight />);

			expect(document.querySelector('[data-slot="code-block-highlight-loading"]')).toBeTruthy();

			await waitFor(() => {
				expect(document.querySelector('[data-slot="code-block-highlight-error"]')).toBeTruthy();
				expect(screen.getByText("let failed = true;")).toBeTruthy();
			});
		} finally {
			consoleErrorSpy.mockRestore();
		}
	});
});
