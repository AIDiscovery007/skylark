import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { createTwoFilesPatch } from "diff";
import type {
	DesktopReviewActionAvailability,
	DesktopReviewFile,
	DesktopReviewFileStatus,
	DesktopReviewSnapshot,
	DesktopReviewTotals,
} from "../../shared/types.ts";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_UNTRACKED_FILE_BYTES = 256 * 1024;
const DISABLED_GIT_ACTIONS: DesktopReviewActionAvailability = {
	commit: false,
	push: false,
	createPullRequest: false,
	createBranch: false,
	reason: "只读审查模式暂不执行 Git 写操作。",
};

export type GitReviewCommandRunner = (cwd: string, args: string[]) => Promise<string>;

export interface CreateGitReviewSnapshotOptions {
	includePatches?: boolean;
	runGit?: GitReviewCommandRunner;
	now?: () => Date;
}

interface StatusEntry {
	path: string;
	previousPath?: string;
	status: DesktopReviewFileStatus;
	staged: boolean;
	unstaged: boolean;
}

interface PatchStats {
	additions: number;
	deletions: number;
	isBinary: boolean;
	isTooLarge?: boolean;
	patch?: string;
}

const EMPTY_TOTALS: DesktopReviewTotals = {
	files: 0,
	additions: 0,
	deletions: 0,
};

function createBaseSnapshot(status: DesktopReviewSnapshot["status"], generatedAt: string): DesktopReviewSnapshot {
	return {
		status,
		files: [],
		totals: EMPTY_TOTALS,
		generatedAt,
		actions: DISABLED_GIT_ACTIONS,
	};
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function defaultRunGit(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
		maxBuffer: MAX_GIT_OUTPUT_BYTES,
		windowsHide: true,
	});
	return stdout;
}

function splitStatusLine(line: string): StatusEntry | undefined {
	if (line.length < 4) {
		return undefined;
	}

	const code = line.slice(0, 2);
	const rawPath = line.slice(3);
	if (!rawPath) {
		return undefined;
	}

	if (code === "??") {
		return {
			path: rawPath,
			status: "untracked",
			staged: false,
			unstaged: true,
		};
	}

	const stagedCode = code[0] ?? " ";
	const unstagedCode = code[1] ?? " ";
	const staged = stagedCode !== " ";
	const unstaged = unstagedCode !== " ";
	const renameParts = rawPath.split(" -> ");
	const previousPath = code.includes("R") && renameParts.length > 1 ? renameParts[0] : undefined;
	const path = previousPath ? (renameParts.at(-1) ?? rawPath) : rawPath;

	let status: DesktopReviewFileStatus = "modified";
	if (code.includes("R")) {
		status = "renamed";
	} else if (code.includes("D")) {
		status = "deleted";
	} else if (code.includes("A")) {
		status = "added";
	}

	return {
		path,
		previousPath,
		status,
		staged,
		unstaged,
	};
}

function parseStatus(output: string): StatusEntry[] {
	return output
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.flatMap((line) => {
			const entry = splitStatusLine(line);
			return entry ? [entry] : [];
		});
}

function getPatchPath(chunk: string): string | undefined {
	const header = chunk.match(/^diff --git a\/(.+) b\/(.+)$/m);
	return header?.[2];
}

function collectPatchStats(patch: string): Map<string, PatchStats> {
	const stats = new Map<string, PatchStats>();
	if (!patch.trim()) {
		return stats;
	}

	for (const chunk of patch.split(/\n(?=diff --git )/)) {
		const path = getPatchPath(chunk);
		if (!path) {
			continue;
		}

		let additions = 0;
		let deletions = 0;
		for (const line of chunk.split(/\r?\n/)) {
			if (line.startsWith("+++") || line.startsWith("---")) {
				continue;
			}
			if (line.startsWith("+")) {
				additions += 1;
			} else if (line.startsWith("-")) {
				deletions += 1;
			}
		}

		stats.set(path, {
			additions,
			deletions,
			isBinary: chunk.includes("Binary files ") || chunk.includes("GIT binary patch"),
			patch: chunk,
		});
	}

	return stats;
}

function resolveNumstatPath(path: string): string {
	const braceRename = path.match(/^(.*)\{(.+) => (.+)\}(.*)$/);
	if (braceRename) {
		return `${braceRename[1]}${braceRename[3]}${braceRename[4]}`;
	}

	if (path.includes(" => ")) {
		return path.split(" => ").at(-1) ?? path;
	}

	return path;
}

function collectNumstatStats(output: string): Map<string, PatchStats> {
	const stats = new Map<string, PatchStats>();
	for (const line of output.split(/\r?\n/)) {
		if (!line.trim()) {
			continue;
		}
		const [rawAdditions, rawDeletions, ...pathParts] = line.split("\t");
		const path = resolveNumstatPath(pathParts.join("\t"));
		if (!rawAdditions || !rawDeletions || !path) {
			continue;
		}
		const isBinary = rawAdditions === "-" || rawDeletions === "-";
		const additions = Number.parseInt(rawAdditions, 10);
		const deletions = Number.parseInt(rawDeletions, 10);
		if (!isBinary && (!Number.isFinite(additions) || !Number.isFinite(deletions))) {
			continue;
		}
		stats.set(path, {
			additions: isBinary ? 0 : additions,
			deletions: isBinary ? 0 : deletions,
			isBinary,
		});
	}
	return stats;
}

function isSafeRelativePath(repositoryRoot: string, filePath: string): boolean {
	const absolutePath = resolve(repositoryRoot, filePath);
	const relativePath = relative(repositoryRoot, absolutePath);
	return relativePath.length > 0 && relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
}

function isBinaryBuffer(buffer: Buffer): boolean {
	return buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
}

function buildUntrackedPatch(path: string, content: string): string {
	const patch = createTwoFilesPatch("/dev/null", `b/${path}`, "", content, "", "", { context: 3 })
		.split(/\r?\n/)
		.filter((line, index) => index !== 0 || !line.startsWith("="))
		.join("\n");
	return `diff --git a/${path} b/${path}\nnew file mode 100644\n${patch}`;
}

async function createUntrackedPatch(repositoryRoot: string, path: string): Promise<PatchStats> {
	if (!isSafeRelativePath(repositoryRoot, path)) {
		return { additions: 0, deletions: 0, isBinary: false };
	}

	const absolutePath = resolve(repositoryRoot, path);
	const fileStat = await stat(absolutePath);
	if (!fileStat.isFile() || fileStat.size > MAX_UNTRACKED_FILE_BYTES) {
		return { additions: 0, deletions: 0, isBinary: false, isTooLarge: true };
	}

	const buffer = await readFile(absolutePath);
	if (isBinaryBuffer(buffer)) {
		return { additions: 0, deletions: 0, isBinary: true };
	}

	const content = buffer.toString("utf8");
	const patch = buildUntrackedPatch(path, content);
	return {
		additions:
			content.length === 0
				? 0
				: content.split(/\r?\n/).filter((line, index, lines) => line || index < lines.length - 1).length,
		deletions: 0,
		isBinary: false,
		patch,
	};
}

async function createUntrackedMetadata(repositoryRoot: string, path: string): Promise<PatchStats> {
	if (!isSafeRelativePath(repositoryRoot, path)) {
		return { additions: 0, deletions: 0, isBinary: false };
	}

	const absolutePath = resolve(repositoryRoot, path);
	const fileStat = await stat(absolutePath);
	if (!fileStat.isFile() || fileStat.size > MAX_UNTRACKED_FILE_BYTES) {
		return { additions: 0, deletions: 0, isBinary: false, isTooLarge: true };
	}

	const buffer = await readFile(absolutePath);
	if (isBinaryBuffer(buffer)) {
		return { additions: 0, deletions: 0, isBinary: true };
	}

	const content = buffer.toString("utf8");
	return {
		additions:
			content.length === 0
				? 0
				: content.split(/\r?\n/).filter((line, index, lines) => line || index < lines.length - 1).length,
		deletions: 0,
		isBinary: false,
	};
}

async function attachUntrackedPatches(
	repositoryRoot: string,
	statusEntries: StatusEntry[],
	patchStats: Map<string, PatchStats>,
): Promise<void> {
	for (const entry of statusEntries) {
		if (entry.status !== "untracked") {
			continue;
		}

		try {
			patchStats.set(entry.path, await createUntrackedPatch(repositoryRoot, entry.path));
		} catch {
			patchStats.set(entry.path, { additions: 0, deletions: 0, isBinary: false });
		}
	}
}

async function attachUntrackedMetadata(
	repositoryRoot: string,
	statusEntries: StatusEntry[],
	patchStats: Map<string, PatchStats>,
): Promise<void> {
	for (const entry of statusEntries) {
		if (entry.status !== "untracked") {
			continue;
		}

		try {
			patchStats.set(entry.path, await createUntrackedMetadata(repositoryRoot, entry.path));
		} catch {
			patchStats.set(entry.path, { additions: 0, deletions: 0, isBinary: false });
		}
	}
}

function createReviewFiles(statusEntries: StatusEntry[], patchStats: Map<string, PatchStats>): DesktopReviewFile[] {
	return statusEntries
		.map((entry) => {
			const stats = patchStats.get(entry.path);
			return {
				path: entry.path,
				previousPath: entry.previousPath,
				status: entry.status,
				additions: stats?.additions ?? 0,
				deletions: stats?.deletions ?? 0,
				staged: entry.staged,
				unstaged: entry.unstaged,
				isBinary: stats?.isBinary ?? false,
				isTooLarge: stats?.isTooLarge ?? false,
				patch: stats?.patch,
			};
		})
		.sort((left, right) => left.path.localeCompare(right.path));
}

function createTotals(files: DesktopReviewFile[]): DesktopReviewTotals {
	return files.reduce(
		(totals, file) => ({
			files: totals.files + 1,
			additions: totals.additions + file.additions,
			deletions: totals.deletions + file.deletions,
		}),
		{ ...EMPTY_TOTALS },
	);
}

async function resolveBranch(repositoryRoot: string, runGit: GitReviewCommandRunner): Promise<string | undefined> {
	const branch = (await runGit(repositoryRoot, ["branch", "--show-current"])).trim();
	if (branch) {
		return branch;
	}

	const commit = (await runGit(repositoryRoot, ["rev-parse", "--short", "HEAD"])).trim();
	return commit ? `detached ${commit}` : undefined;
}

async function createTrackedPatch(repositoryRoot: string, runGit: GitReviewCommandRunner): Promise<string> {
	const commonArgs = ["--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "--find-renames"];
	try {
		await runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
		return runGit(repositoryRoot, ["diff", "HEAD", ...commonArgs]);
	} catch {
		return runGit(repositoryRoot, ["diff", "--cached", ...commonArgs]);
	}
}

async function createTrackedPatchStats(
	repositoryRoot: string,
	runGit: GitReviewCommandRunner,
): Promise<Map<string, PatchStats>> {
	const commonArgs = ["--numstat", "--no-ext-diff", "--find-renames"];
	try {
		await runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
		return collectNumstatStats(await runGit(repositoryRoot, ["diff", "HEAD", ...commonArgs]));
	} catch {
		return collectNumstatStats(await runGit(repositoryRoot, ["diff", "--cached", ...commonArgs]));
	}
}

async function createTrackedFilePatch(
	repositoryRoot: string,
	path: string,
	runGit: GitReviewCommandRunner,
): Promise<string> {
	const commonArgs = ["--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "--find-renames"];
	try {
		await runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
		return runGit(repositoryRoot, ["diff", "HEAD", ...commonArgs, "--", path]);
	} catch {
		return runGit(repositoryRoot, ["diff", "--cached", ...commonArgs, "--", path]);
	}
}

function stripReviewFilePatch(file: DesktopReviewFile): DesktopReviewFile {
	const { patch: _patch, ...metadata } = file;
	return metadata;
}

export async function createGitReviewSnapshot(
	cwd: string | undefined,
	options: CreateGitReviewSnapshotOptions = {},
): Promise<DesktopReviewSnapshot> {
	const generatedAt = (options.now?.() ?? new Date()).toISOString();
	const runGit = options.runGit ?? defaultRunGit;
	if (!cwd) {
		return {
			...createBaseSnapshot("unavailable", generatedAt),
			errorMessage: "Workspace unavailable.",
		};
	}

	try {
		await access(cwd);
	} catch {
		return {
			...createBaseSnapshot("unavailable", generatedAt),
			cwd,
			errorMessage: "Workspace path is unavailable.",
		};
	}

	let repositoryRoot: string;
	try {
		repositoryRoot = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
	} catch {
		return {
			...createBaseSnapshot("not_git", generatedAt),
			cwd,
			errorMessage: "当前 workspace 不是 Git 仓库。",
		};
	}

	try {
		const includePatches = options.includePatches !== false;
		const [branch, statusOutput, trackedPatchOrStats] = await Promise.all([
			resolveBranch(repositoryRoot, runGit),
			runGit(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
			includePatches ? createTrackedPatch(repositoryRoot, runGit) : createTrackedPatchStats(repositoryRoot, runGit),
		]);
		const statusEntries = parseStatus(statusOutput);
		const patchStats =
			typeof trackedPatchOrStats === "string" ? collectPatchStats(trackedPatchOrStats) : trackedPatchOrStats;
		if (includePatches) {
			await attachUntrackedPatches(repositoryRoot, statusEntries, patchStats);
		} else {
			await attachUntrackedMetadata(repositoryRoot, statusEntries, patchStats);
		}
		const files = createReviewFiles(statusEntries, patchStats);
		const untrackedPatch = includePatches
			? files
					.filter((file) => file.status === "untracked" && file.patch)
					.map((file) => file.patch)
					.join("\n")
			: "";
		const patch =
			includePatches && typeof trackedPatchOrStats === "string"
				? [trackedPatchOrStats.trimEnd(), untrackedPatch.trimEnd()].filter(Boolean).join("\n")
				: "";

		return {
			status: files.length > 0 ? "changed" : "clean",
			cwd,
			repositoryRoot,
			branch,
			files: includePatches ? files : files.map(stripReviewFilePatch),
			totals: createTotals(files),
			patch: includePatches ? patch || undefined : undefined,
			generatedAt,
			actions: DISABLED_GIT_ACTIONS,
		};
	} catch (error: unknown) {
		return {
			...createBaseSnapshot("error", generatedAt),
			cwd,
			repositoryRoot,
			errorMessage: getErrorMessage(error),
		};
	}
}

export async function createGitReviewFilePatch(
	cwd: string | undefined,
	path: string,
	options: Pick<CreateGitReviewSnapshotOptions, "now" | "runGit"> = {},
): Promise<DesktopReviewFile> {
	const snapshot = await createGitReviewSnapshot(cwd, { ...options, includePatches: false });
	const file = snapshot.files.find((entry) => entry.path === path);
	if (!file || !snapshot.repositoryRoot) {
		return {
			path,
			status: "modified",
			additions: 0,
			deletions: 0,
			staged: false,
			unstaged: false,
			isBinary: false,
			isTooLarge: false,
		};
	}

	if (file.isBinary || file.isTooLarge) {
		return file;
	}

	const runGit = options.runGit ?? defaultRunGit;
	if (file.status === "untracked") {
		try {
			return {
				...file,
				...(await createUntrackedPatch(snapshot.repositoryRoot, file.path)),
			};
		} catch {
			return file;
		}
	}

	const patch = await createTrackedFilePatch(snapshot.repositoryRoot, file.path, runGit);
	const stats = collectPatchStats(patch).get(file.path);
	return {
		...file,
		additions: stats?.additions ?? file.additions,
		deletions: stats?.deletions ?? file.deletions,
		isBinary: stats?.isBinary ?? file.isBinary,
		patch: stats?.patch,
	};
}
