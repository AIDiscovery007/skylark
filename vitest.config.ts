import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const piAiIndex = resolve(__dirname, "node_modules/@earendil-works/pi-ai/dist/index.js");
const piAiOAuth = resolve(__dirname, "node_modules/@earendil-works/pi-ai/dist/oauth.js");
const piAgentCoreIndex = resolve(__dirname, "node_modules/@earendil-works/pi-agent-core/dist/index.js");
const piCodingAgentIndex = resolve(__dirname, "node_modules/@earendil-works/pi-coding-agent/dist/index.js");
const piTuiIndex = resolve(__dirname, "node_modules/@earendil-works/pi-tui/dist/index.js");

export default defineConfig({
	resolve: {
		dedupe: [
			"@earendil-works/pi-ai",
			"@earendil-works/pi-ai/oauth",
			"@earendil-works/pi-agent-core",
			"@earendil-works/pi-coding-agent",
			"@earendil-works/pi-tui",
		],
		alias: [
			{ find: /^@earendil-works\/pi-ai$/, replacement: piAiIndex },
			{ find: /^@earendil-works\/pi-ai\/oauth$/, replacement: piAiOAuth },
			{ find: /^@earendil-works\/pi-agent-core$/, replacement: piAgentCoreIndex },
			{ find: /^@earendil-works\/pi-coding-agent$/, replacement: piCodingAgentIndex },
			{ find: /^@earendil-works\/pi-tui$/, replacement: piTuiIndex },
			{ find: "@", replacement: resolve(__dirname, "src/renderer") },
			{ find: "@renderer", replacement: resolve(__dirname, "src/renderer") },
			{ find: "@shared", replacement: resolve(__dirname, "src/shared") },
		],
	},
	ssr: {
		noExternal: [/^@earendil-works\/pi-/],
	},
	test: {
		environment: "node",
		environmentMatchGlobs: [
			["test/renderer/**/*.test.ts", "jsdom"],
			["test/renderer/**/*.test.tsx", "jsdom"],
		],
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		server: {
			deps: {
				inline: [/^@earendil-works\/pi-/],
			},
		},
		setupFiles: ["./test/setup.ts"],
	},
});
