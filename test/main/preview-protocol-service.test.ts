import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopPreviewProtocolService } from "../../src/main/preview/preview-protocol-service.ts";

describe("DesktopPreviewProtocolService", () => {
	it("serves an authorized html entry and relative assets from its directory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "skylark-preview-protocol-"));
		const htmlPath = join(dir, "index.html");
		const assetPath = join(dir, "assets", "app.js");
		mkdirSync(dirname(assetPath), { recursive: true });
		writeFileSync(htmlPath, '<script src="./assets/app.js"></script>');
		writeFileSync(assetPath, "window.ready = true;");
		const service = new DesktopPreviewProtocolService();

		const previewUrl = await service.createPreviewUrl(htmlPath);
		const htmlResponse = await service.handleRequest(new Request(previewUrl));
		const assetResponse = await service.handleRequest(new Request(new URL("./assets/app.js", previewUrl)));

		expect(previewUrl).toMatch(/^skylark-preview:\/\/[-0-9a-f]+\/index\.html$/);
		expect(htmlResponse.status).toBe(200);
		expect(htmlResponse.headers.get("Content-Type")).toBe("text/html");
		expect(await htmlResponse.text()).toContain("app.js");
		expect(assetResponse.status).toBe(200);
		expect(assetResponse.headers.get("Content-Type")).toBe("text/javascript");
		expect(await assetResponse.text()).toBe("window.ready = true;");
	});

	it("serves an authorized svg entry with the svg mime type", async () => {
		const dir = mkdtempSync(join(tmpdir(), "skylark-preview-protocol-"));
		const svgPath = join(dir, "shape.svg");
		writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" /></svg>');
		const service = new DesktopPreviewProtocolService();

		const previewUrl = await service.createPreviewUrl(svgPath);
		const response = await service.handleRequest(new Request(previewUrl));

		expect(previewUrl).toMatch(/^skylark-preview:\/\/[-0-9a-f]+\/shape\.svg$/);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
		expect(await response.text()).toContain("<circle");
	});

	it("rejects traversal and symlink escapes outside the entry directory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "skylark-preview-protocol-"));
		const outsideDir = mkdtempSync(join(tmpdir(), "skylark-preview-outside-"));
		const htmlPath = join(dir, "index.html");
		const outsidePath = join(outsideDir, "secret.txt");
		const linkPath = join(dir, "secret-link.txt");
		writeFileSync(htmlPath, "<!doctype html>");
		writeFileSync(outsidePath, "secret");
		symlinkSync(outsidePath, linkPath);
		const service = new DesktopPreviewProtocolService();
		const previewUrl = await service.createPreviewUrl(htmlPath);

		const traversalResponse = await service.handleRequest(new Request(new URL("../secret.txt", previewUrl)));
		const symlinkResponse = await service.handleRequest(new Request(new URL("./secret-link.txt", previewUrl)));

		expect(realpathSync(linkPath)).toBe(realpathSync(outsidePath));
		expect(traversalResponse.status).toBe(404);
		expect(symlinkResponse.status).toBe(403);
	});

	it("rejects unknown preview sessions", async () => {
		const service = new DesktopPreviewProtocolService();

		const response = await service.handleRequest(new Request("skylark-preview://missing/index.html"));

		expect(response.status).toBe(403);
	});
});
