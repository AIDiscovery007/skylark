import { describe, expect, it } from "vitest";
import {
	createPathTree,
	createPreviewErrorFile,
	createWorkspacePreviewItem,
	filterTreeFiles,
	flattenTreeRows,
	formatDiffChunkRange,
	getDiffChunkContext,
	getDiffChunkKey,
	getPreviewFileName,
	isRelatedWebPreviewUrl,
	MAX_WORKSPACE_PREVIEW_FILE_ITEMS,
	REVIEW_WORKSPACE_ITEM,
	resolvePreviewSourceLanguage,
	retainRecentWorkspacePreviewFiles,
} from "../../src/renderer/lib/review-workspace-model.ts";
import type { DesktopPreviewFile } from "../../src/shared/types.ts";

function createPreviewFile(path: string, options: Partial<DesktopPreviewFile> = {}): DesktopPreviewFile {
	return {
		path,
		name: path.split("/").pop() ?? path,
		mimeType: "text/plain",
		size: 10,
		kind: "text",
		updatedAt: "2026-05-27T01:00:00.000Z",
		...options,
	};
}

describe("review workspace model", () => {
	it("builds sorted tree rows and respects collapsed folders", () => {
		const files = [
			{ path: "src/zeta.ts" },
			{ path: "README.md" },
			{ path: "src/components/Button.tsx" },
			{ path: "src/app.ts" },
		];

		const tree = createPathTree(files);
		const rows = flattenTreeRows(tree, new Set(["src"]), false);

		expect(rows.map((row) => `${row.type}:${row.path}:${row.depth}`)).toEqual(["folder:src:0", "file:README.md:0"]);
		expect(flattenTreeRows(tree, new Set(["src"]), true).map((row) => row.path)).toEqual([
			"src",
			"src/components",
			"src/components/Button.tsx",
			"src/app.ts",
			"src/zeta.ts",
			"README.md",
		]);
	});

	it("filters tree files case-insensitively", () => {
		const files = [{ path: "src/Auth.ts" }, { path: "src/index.ts" }];

		expect(filterTreeFiles(files, "auth")).toEqual([{ path: "src/Auth.ts" }]);
		expect(filterTreeFiles(files, " ")).toBe(files);
	});

	it("relates web preview URLs by normalized host", () => {
		expect(isRelatedWebPreviewUrl("https://www.example.com/a", "https://example.com/b")).toBe(true);
		expect(isRelatedWebPreviewUrl("https://example.com/a", "https://other.test/a")).toBe(false);
		expect(isRelatedWebPreviewUrl("notaurl", "https://example.com/a")).toBe(false);
	});

	it("creates preview items and retains only recent file previews", () => {
		const htmlFile = createPreviewFile("public/index.html", {
			kind: "html",
			mimeType: "text/html",
			previewUrl: "http://localhost:3000",
		});
		const browserItem = createWorkspacePreviewItem(htmlFile);
		expect(browserItem).toMatchObject({
			type: "browser",
			title: "index.html",
			url: "http://localhost:3000",
		});

		const fileItems = Array.from({ length: MAX_WORKSPACE_PREVIEW_FILE_ITEMS + 2 }, (_, index) =>
			createWorkspacePreviewItem(createPreviewFile(`src/file-${index}.ts`)),
		);
		const activeItem = fileItems[0];
		const retained = retainRecentWorkspacePreviewFiles([REVIEW_WORKSPACE_ITEM, ...fileItems], activeItem.id);

		expect(retained).toContain(activeItem);
		expect(retained).toContain(REVIEW_WORKSPACE_ITEM);
		expect(retained.filter((item) => item.type === "file")).toHaveLength(MAX_WORKSPACE_PREVIEW_FILE_ITEMS);
	});

	it("formats preview and diff metadata", () => {
		expect(getPreviewFileName({ name: "", path: "src/app.ts" })).toBe("app.ts");
		expect(createPreviewErrorFile("src/app.bin", "Unsupported")).toMatchObject({
			kind: "unsupported",
			name: "app.bin",
			errorMessage: "Unsupported",
		});
		expect(getDiffChunkKey({ oldStart: 1, oldLines: 2, newStart: 3, newLines: 4, content: "@@ body" })).toBe(
			"1:2:3:4:@@ body",
		);
		expect(formatDiffChunkRange(7, 1)).toBe("7");
		expect(formatDiffChunkRange(7, 3)).toBe("7-9");
		expect(formatDiffChunkRange(7, 0)).toBe("-");
		expect(getDiffChunkContext("@@ -1,2 +1,2 @@ function test()")).toBe("function test()");
	});

	it("resolves source preview language from name, extension, mime type, and fallback", () => {
		expect(resolvePreviewSourceLanguage(createPreviewFile("Dockerfile"))).toBe("dockerfile");
		expect(resolvePreviewSourceLanguage(createPreviewFile("src/App.TSX"))).toBe("tsx");
		expect(resolvePreviewSourceLanguage(createPreviewFile("script", { mimeType: "text/x-python" }))).toBe("python");
		expect(
			resolvePreviewSourceLanguage(createPreviewFile("asset.unknown", { mimeType: "application/octet-stream" })),
		).toBe("text");
	});
});
