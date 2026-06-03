import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { DesktopPreviewFile, DesktopPreviewFileKind } from "../../shared/types.ts";

const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024;
const TEXT_MIME_TYPES = new Map<string, string>([
	[".txt", "text/plain"],
	[".log", "text/plain"],
	[".md", "text/markdown"],
	[".json", "application/json"],
	[".ts", "text/typescript"],
	[".tsx", "text/typescript"],
	[".js", "text/javascript"],
	[".mjs", "text/javascript"],
	[".cjs", "text/javascript"],
	[".jsx", "text/javascript"],
	[".css", "text/css"],
	[".py", "text/x-python"],
	[".go", "text/x-go"],
	[".rs", "text/rust"],
	[".java", "text/x-java-source"],
	[".c", "text/x-c"],
	[".h", "text/x-c"],
	[".cc", "text/x-c++"],
	[".cpp", "text/x-c++"],
	[".cxx", "text/x-c++"],
	[".hpp", "text/x-c++"],
	[".cs", "text/x-csharp"],
	[".php", "application/x-httpd-php"],
	[".rb", "text/x-ruby"],
	[".swift", "text/x-swift"],
	[".kt", "text/x-kotlin"],
	[".kts", "text/x-kotlin"],
	[".yml", "text/yaml"],
	[".yaml", "text/yaml"],
	[".xml", "application/xml"],
	[".toml", "application/toml"],
	[".sh", "text/x-shellscript"],
	[".bash", "text/x-shellscript"],
	[".zsh", "text/x-shellscript"],
	[".sql", "application/sql"],
	[".vue", "text/x-vue"],
	[".svelte", "text/x-svelte"],
	[".scss", "text/x-scss"],
	[".sass", "text/x-sass"],
	[".less", "text/x-less"],
]);
const TEXT_MIME_TYPES_BY_FILE_NAME = new Map<string, string>([
	["dockerfile", "text/x-dockerfile"],
	["makefile", "text/x-makefile"],
]);
const MARKUP_PREVIEW_TYPES = new Map<string, { kind: DesktopPreviewFileKind; mimeType: string }>([
	[".html", { kind: "html", mimeType: "text/html" }],
	[".htm", { kind: "html", mimeType: "text/html" }],
	[".svg", { kind: "svg", mimeType: "image/svg+xml" }],
]);
const IMAGE_MIME_TYPES = new Map<string, string>([
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".gif", "image/gif"],
	[".webp", "image/webp"],
]);

interface PreviewFileStat {
	size: number;
	mtime: Date;
}

function createBasePreviewFile(
	path: string,
	fileStat: PreviewFileStat,
	mimeType: string,
	kind: DesktopPreviewFileKind,
): DesktopPreviewFile {
	return {
		path,
		name: basename(path),
		mimeType,
		size: fileStat.size,
		kind,
		updatedAt: fileStat.mtime.toISOString(),
	};
}

function getMimeType(path: string): string {
	const extension = extname(path).toLowerCase();
	const normalizedFileName = basename(path).toLowerCase();
	return (
		MARKUP_PREVIEW_TYPES.get(extension)?.mimeType ??
		IMAGE_MIME_TYPES.get(extension) ??
		TEXT_MIME_TYPES_BY_FILE_NAME.get(normalizedFileName) ??
		TEXT_MIME_TYPES.get(extension) ??
		"application/octet-stream"
	);
}

function getPreviewKind(path: string): DesktopPreviewFileKind {
	const extension = extname(path).toLowerCase();
	const normalizedFileName = basename(path).toLowerCase();
	return (
		MARKUP_PREVIEW_TYPES.get(extension)?.kind ??
		(IMAGE_MIME_TYPES.has(extension)
			? "image"
			: TEXT_MIME_TYPES_BY_FILE_NAME.has(normalizedFileName) || TEXT_MIME_TYPES.has(extension)
				? "text"
				: "unsupported")
	);
}

export async function readDesktopPreviewFile(path: string): Promise<DesktopPreviewFile> {
	const fileStat = await stat(path);
	const kind = getPreviewKind(path);
	const mimeType = getMimeType(path);
	if (kind === "unsupported") {
		return {
			...createBasePreviewFile(path, fileStat, mimeType, kind),
			errorMessage: "此文件类型暂不支持预览。",
		};
	}
	if ((kind === "image" && fileStat.size > MAX_IMAGE_PREVIEW_BYTES) || fileStat.size > MAX_TEXT_PREVIEW_BYTES) {
		return {
			...createBasePreviewFile(path, fileStat, mimeType, "too_large"),
			errorMessage:
				kind === "image" ? "文件超过 10 MB，无法在综合面板中预览。" : "文件超过 2 MB，无法在综合面板中预览。",
		};
	}
	if (kind === "image") {
		const buffer = await readFile(path);
		return {
			...createBasePreviewFile(path, fileStat, mimeType, kind),
			dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
		};
	}

	const content = await readFile(path, "utf8");

	return {
		...createBasePreviewFile(path, fileStat, mimeType, kind),
		content,
	};
}
