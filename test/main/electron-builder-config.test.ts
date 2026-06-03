import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const builderConfig = require("../../electron-builder.config.cjs");
const skylarkRelease = require("../../Skylark-release.json");
const expectedArtifactName = "$" + "{productName}-$" + "{version}-mac-$" + "{arch}.$" + "{ext}";

describe("electron-builder.config", () => {
	it("uses Skylark release metadata as the packaged app version source", () => {
		expect(skylarkRelease).toEqual({
			appId: "com.qiaochao.skylark",
			buildVersion: "0.2.0",
			productName: "Skylark",
			version: "0.2.0",
		});
		expect(builderConfig.extraMetadata).toEqual({ version: skylarkRelease.version });
		expect(builderConfig.buildVersion).toBe(skylarkRelease.buildVersion);
	});

	it("packages Skylark as ad-hoc signed macOS arm64 DMG and ZIP artifacts", () => {
		expect(builderConfig).toMatchObject({
			appId: skylarkRelease.appId,
			productName: skylarkRelease.productName,
			artifactName: expectedArtifactName,
			asar: true,
			electronVersion: "42.2.0",
			mac: {
				identity: "-",
				notarize: false,
				target: [
					{ target: "dmg", arch: ["arm64"] },
					{ target: "zip", arch: ["arm64"] },
				],
			},
		});
	});

	it("keeps node-pty native helpers outside app.asar", () => {
		expect(builderConfig.asarUnpack).toEqual(
			expect.arrayContaining(["node_modules/node-pty/**/*.node", "node_modules/node-pty/**/spawn-helper"]),
		);
		expect(builderConfig.extraResources).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					from: "node_modules/node-pty",
					to: "node_modules/node-pty",
					filter: expect.arrayContaining(["prebuilds/darwin-arm64/**"]),
				}),
			]),
		);
	});

	it("packages runtime modules that stay external to the Electron bundle", () => {
		expect(builderConfig.extraResources).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					from: "node_modules/undici",
					to: "node_modules/undici",
					filter: expect.arrayContaining(["index.js", "lib/**", "package.json"]),
				}),
			]),
		);
	});

	it("uses checked-in macOS release resources and attribution files", () => {
		const iconPath = fileURLToPath(new URL("../../build/icon.icns", import.meta.url));
		const noticePath = fileURLToPath(new URL("../../NOTICE", import.meta.url));
		const licensePath = fileURLToPath(new URL("../../LICENSE", import.meta.url));

		expect(existsSync(iconPath)).toBe(true);
		expect(existsSync(noticePath)).toBe(true);
		expect(existsSync(licensePath)).toBe(true);
		expect(builderConfig.files).toEqual(expect.arrayContaining(["LICENSE", "NOTICE", "Skylark-release.json"]));
	});
});
