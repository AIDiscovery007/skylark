import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listWorkspaceFiles } from "../../src/main/workspace/workspace-file-list-service.ts";

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
	const directoryPath = await mkdtemp(join(tmpdir(), "desktop-workspace-files-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

describe("listWorkspaceFiles", () => {
	it("uses git ls-files as the source of truth for git workspaces", async () => {
		const cwd = await createTempDirectory();
		await mkdir(join(cwd, "src"), { recursive: true });
		await mkdir(join(cwd, "node_modules", "pkg"), { recursive: true });
		await writeFile(join(cwd, "README.md"), "readme\n", "utf8");
		await writeFile(join(cwd, "src", "App.tsx"), "export function App() {}\n", "utf8");
		await writeFile(join(cwd, "ignored.log"), "ignored\n", "utf8");
		await writeFile(join(cwd, "node_modules", "pkg", "index.js"), "module.exports = {}\n", "utf8");

		const result = await listWorkspaceFiles(cwd, {
			runGit: async (_cwd, args) => {
				expect(args).toEqual(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
				return ["README.md", "src/App.tsx", ""].join("\0");
			},
		});

		expect(result.rootPath).toBe(await realpath(cwd));
		expect(result.truncated).toBe(false);
		expect(result.files.map((file) => file.path).sort()).toEqual(["README.md", "src/App.tsx"]);
		expect(result.files.find((file) => file.path === "src/App.tsx")).toMatchObject({
			name: "App.tsx",
			type: "code",
			size: "export function App() {}\n".length,
		});
		expect(result.files.map((file) => file.path)).not.toContain("ignored.log");
		expect(result.files.map((file) => file.path)).not.toContain("node_modules/pkg/index.js");
	});

	it("recursively scans non-git workspaces while excluding noisy folders", async () => {
		const cwd = await createTempDirectory();
		await mkdir(join(cwd, "src"), { recursive: true });
		await mkdir(join(cwd, "docs"), { recursive: true });
		await mkdir(join(cwd, ".git"), { recursive: true });
		await mkdir(join(cwd, "node_modules", "pkg"), { recursive: true });
		await mkdir(join(cwd, "dist"), { recursive: true });
		await mkdir(join(cwd, ".next"), { recursive: true });
		await writeFile(join(cwd, "src", "App.tsx"), "export function App() {}\n", "utf8");
		await writeFile(join(cwd, "docs", "my file.md"), "# Notes\n", "utf8");
		await writeFile(join(cwd, ".git", "config"), "[core]\n", "utf8");
		await writeFile(join(cwd, "node_modules", "pkg", "index.js"), "module.exports = {}\n", "utf8");
		await writeFile(join(cwd, "dist", "bundle.js"), "console.log('built')\n", "utf8");
		await writeFile(join(cwd, ".next", "trace"), "trace\n", "utf8");
		await writeFile(join(cwd, ".DS_Store"), "noise\n", "utf8");

		const result = await listWorkspaceFiles(cwd, {
			runGit: async () => {
				throw new Error("not git");
			},
		});

		expect(result.rootPath).toBe(await realpath(cwd));
		expect(result.files.map((file) => file.path).sort()).toEqual(["docs/my file.md", "src/App.tsx"]);
		expect(result.files.find((file) => file.path === "docs/my file.md")).toMatchObject({
			name: "my file.md",
			type: "docs",
		});
	});

	it("returns an empty result when no workspace cwd is available", async () => {
		const result = await listWorkspaceFiles(undefined);

		expect(result).toEqual({
			files: [],
			truncated: false,
			errorMessage: "当前 workspace 不可用，无法列出文件。",
		});
	});
});
