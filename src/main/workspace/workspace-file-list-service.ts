import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
	DesktopWorkspaceFileEntry,
	DesktopWorkspaceFileListResult,
	DesktopWorkspaceFileType,
} from "../../shared/types.ts";
import { containRealPath } from "../util/path-scope.ts";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_FILE_LIMIT = 1000;
const FALLBACK_SCAN_LIMIT = 5000;
const NOISE_DIRECTORIES = new Set([
	".cache",
	".git",
	".next",
	".parcel-cache",
	".svelte-kit",
	".turbo",
	".vite",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"temp",
	"tmp",
]);
const NOISE_FILES = new Set([".DS_Store"]);
const CODE_EXTENSIONS = new Set([
	".bash",
	".c",
	".cc",
	".cjs",
	".cpp",
	".cs",
	".css",
	".fish",
	".go",
	".h",
	".hpp",
	".htm",
	".html",
	".java",
	".js",
	".jsx",
	".kt",
	".kts",
	".less",
	".mjs",
	".php",
	".py",
	".rb",
	".rs",
	".sass",
	".scss",
	".sh",
	".sql",
	".swift",
	".toml",
	".ts",
	".tsx",
	".vue",
	".xml",
	".yaml",
	".yml",
	".zsh",
]);
const DOC_EXTENSIONS = new Set([".docx", ".md", ".markdown", ".pdf", ".txt"]);
const IMAGE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const DATA_EXTENSIONS = new Set([".csv", ".json", ".jsonl", ".tsv", ".xls", ".xlsx"]);
const CODE_FILENAMES = new Set(["dockerfile", "makefile"]);

export type WorkspaceFileListGitRunner = (cwd: string, args: string[]) => Promise<string>;

export interface WorkspaceFileListOptions {
	limit?: number;
	runGit?: WorkspaceFileListGitRunner;
}

async function defaultRunGit(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
		maxBuffer: MAX_GIT_OUTPUT_BYTES,
		windowsHide: true,
	});
	return stdout;
}

function normalizeRelativePath(path: string): string {
	return path.split(sep).join("/");
}

function isSafeRelativePath(path: string): boolean {
	const trimmed = path.trim();
	return trimmed.length > 0 && !isAbsolute(trimmed) && !trimmed.split(/[\\/]+/).includes("..");
}

function classifyFileType(name: string): DesktopWorkspaceFileType {
	const extension = extname(name).toLowerCase();
	const lowerName = name.toLowerCase();
	if (CODE_FILENAMES.has(lowerName) || CODE_EXTENSIONS.has(extension)) {
		return "code";
	}
	if (DOC_EXTENSIONS.has(extension)) {
		return "docs";
	}
	if (IMAGE_EXTENSIONS.has(extension)) {
		return "images";
	}
	if (DATA_EXTENSIONS.has(extension)) {
		return "data";
	}
	return "other";
}

async function createFileEntry(rootPath: string, relativePath: string): Promise<DesktopWorkspaceFileEntry | undefined> {
	if (!isSafeRelativePath(relativePath)) {
		return undefined;
	}
	const absolutePath = resolve(rootPath, relativePath);
	let realTargetPath: string | null;
	try {
		realTargetPath = await containRealPath(rootPath, absolutePath);
	} catch {
		return undefined;
	}
	if (!realTargetPath) {
		return undefined;
	}
	const metadata = await stat(realTargetPath);
	if (!metadata.isFile()) {
		return undefined;
	}
	const normalizedPath = normalizeRelativePath(relativePath);
	const name = basename(normalizedPath);
	return {
		path: normalizedPath,
		name,
		type: classifyFileType(name),
		size: metadata.size,
		updatedAt: metadata.mtime.toISOString(),
	};
}

function sortFilesByRecent(files: DesktopWorkspaceFileEntry[]): DesktopWorkspaceFileEntry[] {
	return [...files].sort((left, right) => {
		const updatedComparison = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
		return updatedComparison === 0 ? left.path.localeCompare(right.path) : updatedComparison;
	});
}

async function listGitFiles(
	rootPath: string,
	runGit: WorkspaceFileListGitRunner,
): Promise<DesktopWorkspaceFileEntry[]> {
	const output = await runGit(rootPath, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
	const paths = output.split("\0").filter(isSafeRelativePath);
	const entries = await Promise.all(paths.map((filePath) => createFileEntry(rootPath, filePath)));
	return entries.filter((entry): entry is DesktopWorkspaceFileEntry => Boolean(entry));
}

async function scanWorkspaceDirectory(
	rootPath: string,
	currentPath: string,
	files: DesktopWorkspaceFileEntry[],
): Promise<boolean> {
	if (files.length >= FALLBACK_SCAN_LIMIT) {
		return true;
	}
	let entries: Dirent[];
	try {
		entries = await readdir(currentPath, { withFileTypes: true });
	} catch {
		return false;
	}

	for (const entry of entries) {
		if (NOISE_FILES.has(entry.name)) {
			continue;
		}
		const absolutePath = resolve(currentPath, entry.name);
		if (entry.isDirectory()) {
			if (NOISE_DIRECTORIES.has(entry.name)) {
				continue;
			}
			if (await scanWorkspaceDirectory(rootPath, absolutePath, files)) {
				return true;
			}
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const relativePath = normalizeRelativePath(relative(rootPath, absolutePath));
		const file = await createFileEntry(rootPath, relativePath);
		if (file) {
			files.push(file);
			if (files.length >= FALLBACK_SCAN_LIMIT) {
				return true;
			}
		}
	}
	return false;
}

export async function listWorkspaceFiles(
	cwd: string | undefined,
	options: WorkspaceFileListOptions = {},
): Promise<DesktopWorkspaceFileListResult> {
	if (!cwd) {
		return {
			files: [],
			truncated: false,
			errorMessage: "当前 workspace 不可用，无法列出文件。",
		};
	}

	let rootPath: string;
	try {
		rootPath = await realpath(cwd);
	} catch {
		return {
			files: [],
			truncated: false,
			errorMessage: "当前 workspace 不可用，无法列出文件。",
		};
	}

	const limit = Math.max(1, options.limit ?? DEFAULT_FILE_LIMIT);
	const runGit = options.runGit ?? defaultRunGit;
	let files: DesktopWorkspaceFileEntry[];
	let scannedTooMany = false;
	try {
		files = await listGitFiles(rootPath, runGit);
	} catch {
		files = [];
		scannedTooMany = await scanWorkspaceDirectory(rootPath, rootPath, files);
	}

	const sortedFiles = sortFilesByRecent(files);
	const truncated = scannedTooMany || sortedFiles.length > limit;
	return {
		rootPath,
		files: sortedFiles.slice(0, limit),
		truncated,
	};
}
