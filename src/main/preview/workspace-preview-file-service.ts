import { realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopPreviewFile } from "../../shared/types.ts";
import { readDesktopPreviewFile } from "./preview-file-service.ts";

const PREVIEW_ERROR_TIMESTAMP = new Date(0).toISOString();

function createPreviewErrorFile(path: string, errorMessage: string): DesktopPreviewFile {
	return {
		path,
		name: basename(path) || path,
		mimeType: "application/octet-stream",
		size: 0,
		kind: "unsupported",
		updatedAt: PREVIEW_ERROR_TIMESTAMP,
		errorMessage,
	};
}

function decodePath(value: string): string {
	try {
		return decodeURI(value);
	} catch {
		return value;
	}
}

function stripLineSuffix(path: string): string {
	return path.replace(/:\d+(?::\d+)?$/, "");
}

function parsePreviewPath(path: string): string {
	const withoutLineSuffix = stripLineSuffix(path.trim());
	if (withoutLineSuffix.toLowerCase().startsWith("file:")) {
		try {
			return fileURLToPath(new URL(withoutLineSuffix));
		} catch {
			return decodePath(withoutLineSuffix);
		}
	}
	return decodePath(withoutLineSuffix);
}

function isInsideDirectory(parentPath: string, childPath: string): boolean {
	const relativePath = relative(parentPath, childPath);
	return (
		relativePath === "" || (relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

export async function readWorkspacePreviewFile(cwd: string | undefined, path: string): Promise<DesktopPreviewFile> {
	const parsedPath = parsePreviewPath(path);
	if (!cwd) {
		return createPreviewErrorFile(parsedPath, "当前 workspace 不可用，无法预览文件。");
	}

	const workspaceRoot = resolve(cwd);
	const absolutePath = resolve(workspaceRoot, parsedPath);
	let realWorkspaceRoot: string;
	try {
		realWorkspaceRoot = await realpath(workspaceRoot);
	} catch {
		return createPreviewErrorFile(parsedPath, "当前 workspace 不可用，无法预览文件。");
	}

	let realTargetPath: string;
	try {
		realTargetPath = await realpath(absolutePath);
	} catch {
		if (!isInsideDirectory(workspaceRoot, absolutePath)) {
			return createPreviewErrorFile(absolutePath, "只能预览当前 workspace 内的文件。");
		}
		return createPreviewErrorFile(absolutePath, "文件不存在或无法读取。");
	}

	if (!isInsideDirectory(realWorkspaceRoot, realTargetPath)) {
		return createPreviewErrorFile(realTargetPath, "只能预览当前 workspace 内的文件。");
	}

	try {
		return await readDesktopPreviewFile(realTargetPath);
	} catch {
		return createPreviewErrorFile(realTargetPath, "文件不存在或无法读取。");
	}
}
