import { execFile } from "node:child_process";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitReviewFilePatch, createGitReviewSnapshot } from "../../src/main/review/git-review-service.ts";

const execFileAsync = promisify(execFile);
const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
	const directoryPath = await mkdtemp(join(tmpdir(), "desktop-git-review-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { maxBuffer: 8 * 1024 * 1024 });
	return stdout;
}

async function createRepository(): Promise<string> {
	const repo = await createTempDirectory();
	await git(repo, ["init", "-b", "main"]);
	await git(repo, ["config", "user.email", "desktop@example.com"]);
	await git(repo, ["config", "user.name", "Desktop Agent"]);
	await writeFile(join(repo, "tracked.ts"), "const value = 1;\n", "utf8");
	await writeFile(join(repo, "remove.ts"), "export const remove = true;\n", "utf8");
	await writeFile(join(repo, "rename.ts"), "export const before = true;\n", "utf8");
	await git(repo, ["add", "tracked.ts", "remove.ts", "rename.ts"]);
	await git(repo, ["commit", "-m", "initial"]);
	return repo;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

describe("createGitReviewSnapshot", () => {
	it("handles repositories before the first commit", async () => {
		const repo = await createTempDirectory();
		await git(repo, ["init", "-b", "main"]);
		await writeFile(join(repo, "first.ts"), "export const first = true;\n", "utf8");

		const snapshot = await createGitReviewSnapshot(repo);

		expect(snapshot.status).toBe("changed");
		expect(snapshot.branch).toBe("main");
		expect(snapshot.files).toEqual([
			expect.objectContaining({
				path: "first.ts",
				status: "untracked",
				additions: 1,
			}),
		]);
	});

	it("returns a clean snapshot for repositories without changes", async () => {
		const repo = await createRepository();
		const repositoryRoot = await realpath(repo);

		const snapshot = await createGitReviewSnapshot(repo, { now: () => new Date("2026-05-01T00:00:00.000Z") });

		expect(snapshot).toMatchObject({
			status: "clean",
			cwd: repo,
			repositoryRoot,
			branch: "main",
			files: [],
			totals: { files: 0, additions: 0, deletions: 0 },
			generatedAt: "2026-05-01T00:00:00.000Z",
		});
		expect(snapshot.actions.commit).toBe(false);
	});

	it("summarizes tracked, deleted, renamed, and untracked file changes", async () => {
		const repo = await createRepository();
		await writeFile(join(repo, "tracked.ts"), "const value = 2;\nconst next = true;\n", "utf8");
		await rm(join(repo, "remove.ts"));
		await git(repo, ["mv", "rename.ts", "renamed.ts"]);
		await writeFile(join(repo, "new-file.ts"), "export const added = true;\n", "utf8");

		const snapshot = await createGitReviewSnapshot(repo);

		expect(snapshot.status).toBe("changed");
		expect(snapshot.files.map((file) => [file.status, file.path])).toEqual([
			["untracked", "new-file.ts"],
			["deleted", "remove.ts"],
			["renamed", "renamed.ts"],
			["modified", "tracked.ts"],
		]);
		expect(snapshot.files.find((file) => file.path === "renamed.ts")?.previousPath).toBe("rename.ts");
		expect(snapshot.files.find((file) => file.path === "tracked.ts")?.patch).toContain("const next = true;");
		expect(snapshot.files.find((file) => file.path === "new-file.ts")?.patch).toContain("new file mode");
		expect(snapshot.totals.files).toBe(4);
		expect(snapshot.totals.additions).toBeGreaterThan(0);
		expect(snapshot.totals.deletions).toBeGreaterThan(0);
	});

	it("can omit review patch strings from snapshots and load a selected file patch later", async () => {
		const repo = await createRepository();
		await writeFile(join(repo, "tracked.ts"), "const value = 2;\nconst next = true;\n", "utf8");
		await writeFile(join(repo, "new-file.ts"), "export const added = true;\n", "utf8");
		const runGit = vi.fn((cwd: string, args: string[]) => git(cwd, args));

		const snapshot = await createGitReviewSnapshot(repo, { includePatches: false, runGit });
		const trackedPatch = await createGitReviewFilePatch(repo, "tracked.ts");
		const untrackedPatch = await createGitReviewFilePatch(repo, "new-file.ts");
		const gitCommands = runGit.mock.calls.map(([, args]) => args.join(" "));

		expect(snapshot.patch).toBeUndefined();
		expect(snapshot.files.find((file) => file.path === "tracked.ts")?.patch).toBeUndefined();
		expect(snapshot.files.find((file) => file.path === "new-file.ts")?.patch).toBeUndefined();
		expect(gitCommands.some((command) => command.includes("--numstat"))).toBe(true);
		expect(gitCommands.some((command) => command.includes("--src-prefix=a/"))).toBe(false);
		expect(trackedPatch.patch).toContain("const next = true;");
		expect(untrackedPatch.patch).toContain("new file mode");
	});

	it("marks non-git workspaces without throwing", async () => {
		const directoryPath = await createTempDirectory();

		const snapshot = await createGitReviewSnapshot(directoryPath);

		expect(snapshot.status).toBe("not_git");
		expect(snapshot.errorMessage).toContain("Git");
	});

	it("keeps untracked binary and large files as safe placeholders", async () => {
		const repo = await createRepository();
		await writeFile(join(repo, "image.bin"), Buffer.from([0, 1, 2, 3]));
		await writeFile(join(repo, "large.txt"), "x".repeat(300_000), "utf8");
		await chmod(join(repo, "large.txt"), 0o644);

		const snapshot = await createGitReviewSnapshot(repo);

		expect(snapshot.files.find((file) => file.path === "image.bin")).toMatchObject({
			isBinary: true,
			patch: undefined,
		});
		expect(snapshot.files.find((file) => file.path === "large.txt")).toMatchObject({
			isTooLarge: true,
			patch: undefined,
		});
	});

	it("returns an error snapshot when a later git command fails", async () => {
		const repo = await createRepository();

		const snapshot = await createGitReviewSnapshot(repo, {
			runGit: async (_cwd, args) => {
				if (args.join(" ") === "rev-parse --show-toplevel") {
					return repo;
				}
				if (args[0] === "branch") {
					return "main\n";
				}
				throw new Error("git status failed");
			},
		});

		expect(snapshot.status).toBe("error");
		expect(snapshot.errorMessage).toContain("git status failed");
	});

	it("returns unavailable when no workspace can be resolved", async () => {
		const snapshot = await createGitReviewSnapshot(undefined);

		expect(snapshot.status).toBe("unavailable");
		expect(snapshot.files).toEqual([]);
	});
});
