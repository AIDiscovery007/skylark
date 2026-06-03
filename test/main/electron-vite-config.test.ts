import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config, { bundledRuntimeDependencies } from "../../electron.vite.config.ts";

describe("electron.vite.config", () => {
	it("uses the default renderer entry discovery", () => {
		expect("build" in (config.renderer ?? {})).toBe(false);
		expect("root" in (config.renderer ?? {})).toBe(false);

		const rendererEntryPath = fileURLToPath(new URL("../../src/renderer/index.html", import.meta.url));
		const mainEntryPath = fileURLToPath(new URL("../../src/main/index.ts", import.meta.url));

		expect(existsSync(rendererEntryPath)).toBe(true);
		expect(existsSync(mainEntryPath)).toBe(true);
	});

	it("bundles the preload entry as CommonJS for sandboxed BrowserWindow usage", () => {
		expect(config.preload?.build?.rollupOptions?.output).toMatchObject({ format: "cjs" });
	});

	it("keeps the extension loader transform runtime external", () => {
		expect(config.main?.build?.rollupOptions?.external).toContain("jiti");
		expect(config.main?.build?.rollupOptions?.external).toContain("undici");
		expect(config.preload?.build?.rollupOptions?.external).toContain("jiti");
		expect(config.preload?.build?.rollupOptions?.external).toContain("undici");
	});

	it("bundles JavaScript runtime dependencies needed by the packaged app", () => {
		expect(bundledRuntimeDependencies).toEqual(
			expect.arrayContaining(["@modelcontextprotocol/sdk", "diff", "mammoth"]),
		);
	});
});
