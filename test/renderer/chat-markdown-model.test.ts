import { describe, expect, it } from "vitest";
import {
	createMarkdownImagePreviewItem,
	decodeWorkspacePreviewLinkHref,
	encodeWorkspacePreviewLinkHref,
	isExternalBrowserHref,
	isWorkspacePreviewHref,
	splitAssistantMarkdownImageBlocks,
	workspacePreviewLinkRemarkPlugin,
} from "../../src/renderer/lib/chat-markdown-model.ts";

describe("chat markdown model", () => {
	it("encodes only workspace-previewable markdown links", () => {
		expect(encodeWorkspacePreviewLinkHref("./src/App.tsx")).toBe(
			"https://workspace-preview.invalid/.%2Fsrc%2FApp.tsx",
		);
		expect(encodeWorkspacePreviewLinkHref("file:///tmp/a.txt")).toBe(
			"https://workspace-preview.invalid/file%3A%2F%2F%2Ftmp%2Fa.txt",
		);
		expect(encodeWorkspacePreviewLinkHref("https://example.com")).toBeUndefined();
		expect(encodeWorkspacePreviewLinkHref("mailto:test@example.com")).toBeUndefined();
		expect(encodeWorkspacePreviewLinkHref("#section")).toBeUndefined();
		expect(decodeWorkspacePreviewLinkHref("https://workspace-preview.invalid/.%2Fsrc%2FApp.tsx")).toBe(
			"./src/App.tsx",
		);
		expect(decodeWorkspacePreviewLinkHref("https://workspace-preview.invalid/%E0%A4%A")).toBeUndefined();
	});

	it("classifies external and workspace preview hrefs", () => {
		expect(isExternalBrowserHref("https://example.com")).toBe(true);
		expect(isExternalBrowserHref("mailto:test@example.com")).toBe(true);
		expect(isExternalBrowserHref("./src/App.tsx")).toBe(false);
		expect(isWorkspacePreviewHref("./src/App.tsx")).toBe(true);
		expect(isWorkspacePreviewHref("file:///tmp/a.txt")).toBe(true);
		expect(isWorkspacePreviewHref("https://example.com")).toBe(false);
		expect(isWorkspacePreviewHref("#section")).toBe(false);
	});

	it("rewrites markdown AST link URLs through the remark plugin", () => {
		const tree = {
			type: "root",
			children: [
				{ type: "link", url: "./src/App.tsx" },
				{ type: "paragraph", children: [{ type: "link", url: "https://example.com" }] },
			],
		};

		workspacePreviewLinkRemarkPlugin()(tree);

		expect(tree.children[0]?.url).toBe("https://workspace-preview.invalid/.%2Fsrc%2FApp.tsx");
		expect(tree.children[1]?.children?.[0]?.url).toBe("https://example.com");
	});

	it("creates markdown image preview items by URL kind", () => {
		expect(createMarkdownImagePreviewItem("data:image/png;base64,abc", "", "0")).toMatchObject({
			alt: "png;base64,abc",
			kind: "direct",
			src: "data:image/png;base64,abc",
		});
		expect(createMarkdownImagePreviewItem("https://example.com/panel.png", "Panel", "1")).toMatchObject({
			alt: "Panel",
			href: "https://example.com/panel.png",
			kind: "external",
		});
		expect(createMarkdownImagePreviewItem("./images/panel.png", undefined, "2")).toMatchObject({
			alt: "panel.png",
			kind: "workspace",
			path: "./images/panel.png",
		});
		expect(createMarkdownImagePreviewItem("", "Empty", "3")).toBeUndefined();
	});

	it("splits image-only markdown blocks into preview-grid segments", () => {
		const segments = splitAssistantMarkdownImageBlocks(
			[
				"Intro text",
				"![First](./one.png)\n![Second](https://example.com/two.png)",
				"Mixed ![inline](./inline.png) text",
				"![Third](data:image/png;base64,abc)",
			].join("\n\n"),
		);

		expect(segments).toHaveLength(4);
		expect(segments[0]).toMatchObject({ type: "markdown", text: "Intro text" });
		expect(segments[1]).toMatchObject({
			type: "images",
			items: [
				{ alt: "First", kind: "workspace", path: "./one.png" },
				{ alt: "Second", kind: "external", href: "https://example.com/two.png" },
			],
		});
		expect(segments[2]).toMatchObject({ type: "markdown", text: "Mixed ![inline](./inline.png) text" });
		expect(segments[3]).toMatchObject({
			type: "images",
			items: [{ alt: "Third", kind: "direct", src: "data:image/png;base64,abc" }],
		});
	});
});
