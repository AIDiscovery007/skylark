import { isDesktopStaticWebPreviewUrl } from "../../shared/preview-url.ts";
import type { DesktopPreviewFile, DesktopSubagentOpenRequest } from "../../shared/types.ts";
import type { CodeBlockLanguage } from "../components/ai-elements/code-block.tsx";

export interface PathTreeNode<TFile extends { path: string }> {
	name: string;
	path: string;
	children: PathTreeNode<TFile>[];
	file?: TFile;
}

export type PathTreeFlatRow<TFile extends { path: string }> =
	| {
			depth: number;
			expanded: boolean;
			id: string;
			name: string;
			path: string;
			type: "folder";
	  }
	| {
			depth: number;
			file: TFile;
			id: string;
			name: string;
			path: string;
			type: "file";
	  };

export type PathTreeFileRow<TFile extends { path: string }> = Extract<PathTreeFlatRow<TFile>, { type: "file" }>;

export type WorkspacePanelItem =
	| {
			id: "review";
			type: "review";
			title: "审查";
	  }
	| {
			id: string;
			type: "file";
			file: DesktopPreviewFile;
	  }
	| {
			id: string;
			sourceFile?: Pick<DesktopPreviewFile, "kind" | "mimeType" | "name" | "path">;
			type: "browser";
			title: string;
			url: string;
	  }
	| {
			id: string;
			type: "subagent";
			request: DesktopSubagentOpenRequest;
	  };

export type WorkspacePreviewFileItem =
	| Extract<WorkspacePanelItem, { type: "file" }>
	| (Extract<WorkspacePanelItem, { type: "browser" }> & {
			sourceFile: Pick<DesktopPreviewFile, "kind" | "mimeType" | "name" | "path">;
	  });

export const REVIEW_WORKSPACE_ITEM: WorkspacePanelItem = { id: "review", type: "review", title: "审查" };
export const MAX_WORKSPACE_PREVIEW_FILE_ITEMS = 8;
export const PREVIEW_ERROR_TIMESTAMP = new Date(0).toISOString();

const PREVIEW_SOURCE_LANGUAGE_BY_EXTENSION: Record<string, CodeBlockLanguage> = {
	bash: "bash",
	c: "c",
	cc: "cpp",
	cjs: "javascript",
	cpp: "cpp",
	cs: "csharp",
	css: "css",
	go: "go",
	h: "c",
	hpp: "cpp",
	java: "java",
	js: "javascript",
	json: "json",
	jsx: "jsx",
	kotlin: "kotlin",
	kt: "kotlin",
	kts: "kotlin",
	less: "less",
	log: "log",
	md: "markdown",
	mjs: "javascript",
	php: "php",
	py: "python",
	rb: "ruby",
	rs: "rust",
	sass: "sass",
	scss: "scss",
	sh: "bash",
	sql: "sql",
	svelte: "svelte",
	swift: "swift",
	toml: "toml",
	ts: "typescript",
	tsx: "tsx",
	txt: "text",
	vue: "vue",
	xml: "xml",
	yaml: "yaml",
	yml: "yaml",
	zsh: "zsh",
};

const PREVIEW_SOURCE_LANGUAGE_BY_FILE_NAME: Record<string, CodeBlockLanguage> = {
	dockerfile: "dockerfile",
	makefile: "makefile",
};

const PREVIEW_SOURCE_LANGUAGE_BY_MIME_TYPE: Record<string, CodeBlockLanguage> = {
	"application/json": "json",
	"application/xml": "xml",
	"text/css": "css",
	"text/javascript": "javascript",
	"text/markdown": "markdown",
	"text/plain": "text",
	"text/typescript": "typescript",
	"text/x-dockerfile": "dockerfile",
	"text/x-go": "go",
	"text/x-makefile": "makefile",
	"text/x-python": "python",
	"text/yaml": "yaml",
};

export function getComparableWebPreviewHost(url: string): string | undefined {
	try {
		return new URL(url).host.toLowerCase().replace(/^www\./, "");
	} catch {
		return undefined;
	}
}

export function isRelatedWebPreviewUrl(firstUrl: string, secondUrl: string): boolean {
	if (firstUrl === secondUrl) {
		return true;
	}
	const firstHost = getComparableWebPreviewHost(firstUrl);
	const secondHost = getComparableWebPreviewHost(secondUrl);
	return Boolean(firstHost && secondHost && firstHost === secondHost);
}

export function createPathTree<TFile extends { path: string }>(files: TFile[]): PathTreeNode<TFile>[] {
	const root: PathTreeNode<TFile> = { name: "", path: "", children: [] };
	for (const file of files) {
		const parts = file.path.split("/").filter(Boolean);
		let current = root;
		for (const [index, part] of parts.entries()) {
			const path = parts.slice(0, index + 1).join("/");
			let child = current.children.find((node) => node.name === part);
			if (!child) {
				child = { name: part, path, children: [] };
				current.children.push(child);
			}
			if (index === parts.length - 1) {
				child.file = file;
			}
			current = child;
		}
	}
	return sortTree(root.children);
}

function sortTree<TFile extends { path: string }>(nodes: PathTreeNode<TFile>[]): PathTreeNode<TFile>[] {
	return nodes
		.map((node) => ({ ...node, children: sortTree(node.children) }))
		.sort((left, right) => {
			if (Boolean(left.file) !== Boolean(right.file)) {
				return left.file ? 1 : -1;
			}
			return left.name.localeCompare(right.name);
		});
}

export function flattenTreeRows<TFile extends { path: string }>(
	nodes: PathTreeNode<TFile>[],
	collapsedPaths: ReadonlySet<string>,
	forceExpanded: boolean,
	depth = 0,
): PathTreeFlatRow<TFile>[] {
	const rows: PathTreeFlatRow<TFile>[] = [];
	for (const node of nodes) {
		if (node.file) {
			rows.push({
				depth,
				file: node.file,
				id: `file:${node.file.path}`,
				name: node.name,
				path: node.path,
				type: "file",
			});
			continue;
		}

		const expanded = forceExpanded || !collapsedPaths.has(node.path);
		rows.push({
			depth,
			expanded,
			id: `folder:${node.path}`,
			name: node.name,
			path: node.path,
			type: "folder",
		});
		if (expanded) {
			rows.push(...flattenTreeRows(node.children, collapsedPaths, forceExpanded, depth + 1));
		}
	}
	return rows;
}

export function filterTreeFiles<TFile extends { path: string }>(files: TFile[], query: string): TFile[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return files;
	}
	return files.filter((file) => file.path.toLowerCase().includes(normalizedQuery));
}

export function getPreviewFileName(file: Pick<DesktopPreviewFile, "name" | "path">): string {
	return file.name || file.path.split(/[\\/]/).pop() || file.path;
}

function getPreviewFileExtension(file: Pick<DesktopPreviewFile, "name" | "path">): string {
	const fileName = getPreviewFileName(file);
	const extensionStart = fileName.lastIndexOf(".");
	return extensionStart > 0 ? fileName.slice(extensionStart + 1).toLowerCase() : "";
}

export function resolvePreviewSourceLanguage(file: DesktopPreviewFile): CodeBlockLanguage {
	const normalizedFileName = getPreviewFileName(file).toLowerCase();
	const namedLanguage = PREVIEW_SOURCE_LANGUAGE_BY_FILE_NAME[normalizedFileName];
	if (namedLanguage) {
		return namedLanguage;
	}

	const extensionLanguage = PREVIEW_SOURCE_LANGUAGE_BY_EXTENSION[getPreviewFileExtension(file)];
	if (extensionLanguage) {
		return extensionLanguage;
	}

	const mimeLanguage = PREVIEW_SOURCE_LANGUAGE_BY_MIME_TYPE[file.mimeType.toLowerCase()];
	if (mimeLanguage) {
		return mimeLanguage;
	}

	return "text";
}

export function createPreviewErrorFile(path: string, errorMessage: string): DesktopPreviewFile {
	return {
		path,
		name: path.split(/[\\/]/).pop() || path,
		mimeType: "application/octet-stream",
		size: 0,
		kind: "unsupported",
		updatedAt: PREVIEW_ERROR_TIMESTAMP,
		errorMessage,
	};
}

export function getWebPreviewTitle(url: string): string {
	try {
		const parsedUrl = new URL(url);
		if (isDesktopStaticWebPreviewUrl(url)) {
			return "本地预览";
		}
		return parsedUrl.port ? `${parsedUrl.hostname}:${parsedUrl.port}` : parsedUrl.hostname;
	} catch {
		return "网页预览";
	}
}

function hashWorkspaceItemId(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function isPreviewFileWebPreview(file: DesktopPreviewFile): boolean {
	return (file.kind === "html" || file.kind === "svg") && Boolean(file.previewUrl);
}

export function createWorkspacePreviewItem(file: DesktopPreviewFile): WorkspacePanelItem {
	if (isPreviewFileWebPreview(file) && file.previewUrl) {
		return {
			id: `browser:file:${hashWorkspaceItemId(file.path)}`,
			sourceFile: {
				kind: file.kind,
				mimeType: file.mimeType,
				name: file.name,
				path: file.path,
			},
			title: getPreviewFileName(file),
			type: "browser",
			url: file.previewUrl,
		};
	}
	return {
		file,
		id: `file:${file.path}`,
		type: "file",
	};
}

export function isWorkspacePreviewFileItem(item: WorkspacePanelItem): item is WorkspacePreviewFileItem {
	return item.type === "file" || (item.type === "browser" && Boolean(item.sourceFile));
}

export function retainRecentWorkspacePreviewFiles(
	items: WorkspacePanelItem[],
	activeItemId: string,
): WorkspacePanelItem[] {
	const fileItems = items.filter(isWorkspacePreviewFileItem);
	if (fileItems.length <= MAX_WORKSPACE_PREVIEW_FILE_ITEMS) {
		return items;
	}

	const removableCount = fileItems.length - MAX_WORKSPACE_PREVIEW_FILE_ITEMS;
	const removableFileIds = new Set(
		fileItems
			.filter((item) => item.id !== activeItemId)
			.slice(0, removableCount)
			.map((item) => item.id),
	);
	return items.filter((item) => !isWorkspacePreviewFileItem(item) || !removableFileIds.has(item.id));
}

export function getWorkspaceItemTitle(item: WorkspacePanelItem): string {
	if (item.type === "review") {
		return item.title;
	}
	if (item.type === "browser") {
		return item.title;
	}
	if (item.type === "subagent") {
		return item.request.title ?? item.request.subagentId;
	}
	return item.file.name;
}

export interface DiffChunkLike {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	content: string;
}

export function getDiffChunkKey(chunk: DiffChunkLike): string {
	return `${chunk.oldStart}:${chunk.oldLines}:${chunk.newStart}:${chunk.newLines}:${chunk.content}`;
}

export function formatDiffChunkRange(start: number, lines: number): string {
	if (lines <= 0) {
		return "-";
	}

	const end = start + lines - 1;
	return end === start ? `${start}` : `${start}-${end}`;
}

export function getDiffChunkContext(content: string): string {
	return content.replace(/^@@.*?@@\s*/, "").trim();
}
