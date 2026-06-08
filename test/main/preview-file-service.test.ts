import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { readDesktopPreviewFile } from "../../src/main/preview/preview-file-service.ts";
import { readWorkspacePreviewFile } from "../../src/main/preview/workspace-preview-file-service.ts";

describe("preview-file-service", () => {
	it("reads a selected text file as preview content", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-"));
		const filePath = join(dir, "notes.txt");
		writeFileSync(filePath, "hello preview\n");

		await expect(readDesktopPreviewFile(filePath)).resolves.toMatchObject({
			path: filePath,
			name: basename(filePath),
			mimeType: "text/plain",
			kind: "text",
			content: "hello preview\n",
		});
	});

	it("classifies common source files as text preview content", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-"));
		const cases = [
			["script.py", "text/x-python"],
			["main.go", "text/x-go"],
			["lib.rs", "text/rust"],
			["config.yml", "text/yaml"],
			["Dockerfile", "text/x-dockerfile"],
			["Makefile", "text/x-makefile"],
		] as const;

		for (const [name, mimeType] of cases) {
			const filePath = join(dir, name);
			writeFileSync(filePath, "value = true\n");

			await expect(readDesktopPreviewFile(filePath)).resolves.toMatchObject({
				path: filePath,
				name,
				mimeType,
				kind: "text",
				content: "value = true\n",
			});
		}
	});

	it("classifies self-contained html and svg files for preview", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-"));
		const htmlPath = join(dir, "chart.html");
		const svgPath = join(dir, "shape.svg");
		writeFileSync(htmlPath, "<!doctype html><html><body>Chart</body></html>");
		writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" /></svg>');

		await expect(readDesktopPreviewFile(htmlPath)).resolves.toMatchObject({
			path: htmlPath,
			mimeType: "text/html",
			kind: "html",
			content: "<!doctype html><html><body>Chart</body></html>",
		});
		await expect(readDesktopPreviewFile(svgPath)).resolves.toMatchObject({
			path: svgPath,
			mimeType: "image/svg+xml",
			kind: "svg",
			content: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" /></svg>',
		});
	});

	it("adds static preview urls for html and svg files when a preview url service is provided", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-"));
		const htmlPath = join(dir, "chart.html");
		const svgPath = join(dir, "shape.svg");
		writeFileSync(htmlPath, "<!doctype html><html><body>Chart</body></html>");
		writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" /></svg>');

		const createPreviewUrl = async (path: string) => `skylark-preview://session/${basename(path)}`;

		await expect(readDesktopPreviewFile(htmlPath, { createPreviewUrl })).resolves.toMatchObject({
			path: htmlPath,
			kind: "html",
			previewUrl: "skylark-preview://session/chart.html",
		});
		const svgPreview = await readDesktopPreviewFile(svgPath, { createPreviewUrl });
		expect(svgPreview).toMatchObject({
			path: svgPath,
			kind: "svg",
			previewUrl: "skylark-preview://session/shape.svg",
		});
	});

	it("reads supported image files as data urls", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-"));
		const filePath = join(dir, "pixel.png");
		writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

		await expect(readDesktopPreviewFile(filePath)).resolves.toMatchObject({
			path: filePath,
			mimeType: "image/png",
			kind: "image",
			dataUrl: "data:image/png;base64,iVBORw==",
		});
	});

	it("returns a bounded preview state for large and unsupported files", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-"));
		const largePath = join(dir, "large.txt");
		const unsupportedPath = join(dir, "archive.zip");
		writeFileSync(largePath, Buffer.alloc(2 * 1024 * 1024 + 1, "a"));
		writeFileSync(unsupportedPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));

		await expect(readDesktopPreviewFile(largePath)).resolves.toMatchObject({
			path: largePath,
			mimeType: "text/plain",
			kind: "too_large",
			errorMessage: "文件超过 2 MB，无法在综合面板中预览。",
		});
		await expect(readDesktopPreviewFile(unsupportedPath)).resolves.toMatchObject({
			path: unsupportedPath,
			mimeType: "application/octet-stream",
			kind: "unsupported",
			errorMessage: "此文件类型暂不支持预览。",
		});
	});

	it("reads workspace preview files from relative paths and strips line suffixes", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-workspace-"));
		const filePath = join(dir, "src", "index.ts");
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, "export const ready = true;\n");

		await expect(readWorkspacePreviewFile(dir, "src/index.ts:12:4")).resolves.toMatchObject({
			path: realpathSync(filePath),
			name: "index.ts",
			kind: "text",
			content: "export const ready = true;\n",
		});
	});

	it("adds static preview urls for workspace html and svg files after workspace containment checks", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-workspace-"));
		const htmlPath = join(dir, "src", "index.html");
		const svgPath = join(dir, "src", "shape.svg");
		mkdirSync(dirname(htmlPath), { recursive: true });
		writeFileSync(htmlPath, "<!doctype html><button>Open</button>");
		writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8" /></svg>');

		await expect(
			readWorkspacePreviewFile(dir, "src/index.html", {
				createPreviewUrl: async (path) => `skylark-preview://session/${basename(path)}`,
			}),
		).resolves.toMatchObject({
			path: realpathSync(htmlPath),
			kind: "html",
			previewUrl: "skylark-preview://session/index.html",
		});
		await expect(
			readWorkspacePreviewFile(dir, "src/shape.svg", {
				createPreviewUrl: async (path) => `skylark-preview://session/${basename(path)}`,
			}),
		).resolves.toMatchObject({
			path: realpathSync(svgPath),
			kind: "svg",
			previewUrl: "skylark-preview://session/shape.svg",
		});
	});

	it("reads workspace preview files from file urls", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-workspace-"));
		const filePath = join(dir, "notes.txt");
		writeFileSync(filePath, "hello from url\n");

		await expect(readWorkspacePreviewFile(dir, pathToFileURL(filePath).toString())).resolves.toMatchObject({
			path: realpathSync(filePath),
			name: "notes.txt",
			kind: "text",
			content: "hello from url\n",
		});
	});

	it("rejects workspace preview files outside the workspace", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-workspace-"));
		const outsideDir = mkdtempSync(join(tmpdir(), "desktop-preview-outside-"));
		const outsidePath = join(outsideDir, "secret.txt");
		writeFileSync(outsidePath, "secret\n");

		await expect(readWorkspacePreviewFile(dir, outsidePath)).resolves.toMatchObject({
			path: outsidePath,
			kind: "unsupported",
			errorMessage: "只能预览当前 workspace 内的文件。",
		});
	});

	it("rejects symlinked workspace preview files that escape the workspace", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-workspace-"));
		const outsideDir = mkdtempSync(join(tmpdir(), "desktop-preview-outside-"));
		const outsidePath = join(outsideDir, "secret.txt");
		const linkPath = join(dir, "secret-link.txt");
		writeFileSync(outsidePath, "secret\n");
		symlinkSync(outsidePath, linkPath);

		await expect(readWorkspacePreviewFile(dir, "secret-link.txt")).resolves.toMatchObject({
			path: linkPath,
			kind: "unsupported",
			errorMessage: "只能预览当前 workspace 内的文件。",
		});
	});

	it("returns an error preview when a workspace preview file is missing", async () => {
		const dir = mkdtempSync(join(tmpdir(), "desktop-preview-workspace-"));
		const missingPath = join(dir, "missing.ts");

		await expect(readWorkspacePreviewFile(dir, "missing.ts")).resolves.toMatchObject({
			path: missingPath,
			kind: "unsupported",
			errorMessage: "文件不存在或无法读取。",
		});
	});
});
