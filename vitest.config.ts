import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{ find: "@", replacement: resolve(__dirname, "src/renderer") },
			{ find: "@renderer", replacement: resolve(__dirname, "src/renderer") },
			{ find: "@shared", replacement: resolve(__dirname, "src/shared") },
		],
	},
	test: {
		environment: "node",
		environmentMatchGlobs: [
			["test/renderer/**/*.test.ts", "jsdom"],
			["test/renderer/**/*.test.tsx", "jsdom"],
		],
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		setupFiles: ["./test/setup.ts"],
	},
});
