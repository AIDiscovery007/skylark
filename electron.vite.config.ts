import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { externalizeDepsPlugin } from "electron-vite";

export const bundledRuntimeDependencies = [
	"@earendil-works/pi-ai",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"@modelcontextprotocol/sdk",
	"diff",
	"mammoth",
];
export const runtimeExternalDeps = ["jiti", "undici"];
const externalizeOptions = {
	exclude: bundledRuntimeDependencies,
};
const runtimeExternalBuildOptions = {
	rollupOptions: {
		external: runtimeExternalDeps,
		input: {
			index: resolve(__dirname, "src/main/index.ts"),
			"workspace-runtime-cli": resolve(__dirname, "src/main/workspace-runtime-cli.ts"),
		},
	},
};

export default {
	main: {
		plugins: [externalizeDepsPlugin(externalizeOptions)],
		build: runtimeExternalBuildOptions,
	},
	preload: {
		plugins: [externalizeDepsPlugin(externalizeOptions)],
		build: {
			rollupOptions: {
				external: runtimeExternalDeps,
				output: {
					format: "cjs",
				},
			},
		},
	},
	renderer: {
		plugins: [react(), tailwindcss()],
		resolve: {
			alias: {
				"@": resolve(__dirname, "src/renderer"),
				"@renderer": resolve(__dirname, "src/renderer"),
				"@shared": resolve(__dirname, "src/shared"),
			},
		},
	},
};
