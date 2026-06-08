import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopPreviewFile } from "../../shared/types.ts";
import { containRealPath, isPathInside } from "../util/path-scope.ts";
import { type DesktopPreviewFileReadOptions, readDesktopPreviewFile } from "./preview-file-service.ts";

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

export async function readWorkspacePreviewFile(
	cwd: string | undefined,
	path: string,
	options: DesktopPreviewFileReadOptions = {},
): Promise<DesktopPreviewFile> {
	const parsedPath = parsePreviewPath(path);
	if (!cwd) {
		return createPreviewErrorFile(parsedPath, "当前 workspace 不可用，无法预览文件。");
	}

	const workspaceRoot = resolve(cwd);
	const absolutePath = resolve(workspaceRoot, parsedPath);
	let realWorkspaceRoot: string;
	try {
		const containedWorkspaceRoot = await containRealPath(workspaceRoot, workspaceRoot);
		if (!containedWorkspaceRoot) {
			return createPreviewErrorFile(parsedPath, "当前 workspace 不可用，无法预览文件。");
		}
		realWorkspaceRoot = containedWorkspaceRoot;
	} catch {
		return createPreviewErrorFile(parsedPath, "当前 workspace 不可用，无法预览文件。");
	}

	let realTargetPath: string | null;
	try {
		realTargetPath = await containRealPath(realWorkspaceRoot, absolutePath);
	} catch {
		if (!isPathInside(workspaceRoot, absolutePath)) {
			return createPreviewErrorFile(absolutePath, "只能预览当前 workspace 内的文件。");
		}
		return createPreviewErrorFile(absolutePath, "文件不存在或无法读取。");
	}

	if (!realTargetPath) {
		return createPreviewErrorFile(absolutePath, "只能预览当前 workspace 内的文件。");
	}

	try {
		return await readDesktopPreviewFile(realTargetPath, options);
	} catch {
		return createPreviewErrorFile(realTargetPath, "文件不存在或无法读取。");
	}
}
