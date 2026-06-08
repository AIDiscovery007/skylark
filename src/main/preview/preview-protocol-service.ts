import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { containRealPath } from "../util/path-scope.ts";

export const DESKTOP_PREVIEW_PROTOCOL_SCHEME = "skylark-preview";

const PREVIEW_ASSET_MIME_TYPES = new Map<string, string>([
	[".css", "text/css"],
	[".gif", "image/gif"],
	[".htm", "text/html"],
	[".html", "text/html"],
	[".ico", "image/x-icon"],
	[".jpeg", "image/jpeg"],
	[".jpg", "image/jpeg"],
	[".js", "text/javascript"],
	[".json", "application/json"],
	[".map", "application/json"],
	[".mjs", "text/javascript"],
	[".png", "image/png"],
	[".svg", "image/svg+xml"],
	[".ttf", "font/ttf"],
	[".txt", "text/plain"],
	[".wasm", "application/wasm"],
	[".webp", "image/webp"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
]);

interface PreviewSession {
	entryFileName: string;
	rootDir: string;
}

function encodePathSegment(value: string): string {
	return encodeURIComponent(value).replace(/%2F/gi, "/");
}

function createTextResponse(status: number, message: string): Response {
	return new Response(message, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
		status,
	});
}

function getPreviewAssetMimeType(path: string): string {
	return PREVIEW_ASSET_MIME_TYPES.get(extname(path).toLowerCase()) ?? "application/octet-stream";
}

function decodePreviewPath(pathname: string): string | undefined {
	try {
		const decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
		return decoded.length > 0 ? decoded : undefined;
	} catch {
		return undefined;
	}
}

export class DesktopPreviewProtocolService {
	private readonly sessions = new Map<string, PreviewSession>();

	async createPreviewUrl(filePath: string): Promise<string> {
		const realEntryPath = await realpath(filePath);
		const rootDir = await realpath(dirname(realEntryPath));
		const sessionId = randomUUID();
		const entryFileName = basename(realEntryPath);
		this.sessions.set(sessionId, { entryFileName, rootDir });
		return `${DESKTOP_PREVIEW_PROTOCOL_SCHEME}://${sessionId}/${encodePathSegment(entryFileName)}`;
	}

	async handleRequest(request: Request): Promise<Response> {
		let url: URL;
		try {
			url = new URL(request.url);
		} catch {
			return createTextResponse(400, "Invalid preview URL.");
		}

		if (url.protocol !== `${DESKTOP_PREVIEW_PROTOCOL_SCHEME}:`) {
			return createTextResponse(400, "Invalid preview protocol.");
		}

		const session = this.sessions.get(url.hostname);
		if (!session) {
			return createTextResponse(403, "Preview session is not authorized.");
		}

		const relativePath = decodePreviewPath(url.pathname) ?? session.entryFileName;
		if (relativePath.includes("\0")) {
			return createTextResponse(403, "Preview path is not allowed.");
		}

		const candidatePath = resolve(session.rootDir, relativePath);
		let realTargetPath: string | null;
		try {
			realTargetPath = await containRealPath(session.rootDir, candidatePath);
		} catch {
			return createTextResponse(404, "Preview asset was not found.");
		}
		if (!realTargetPath) {
			return createTextResponse(403, "Preview asset is outside the authorized directory.");
		}

		const targetStat = await stat(realTargetPath);
		if (!targetStat.isFile()) {
			return createTextResponse(404, "Preview asset was not found.");
		}

		const body = Readable.toWeb(createReadStream(realTargetPath)) as ReadableStream;
		return new Response(body, {
			headers: {
				"Content-Type": getPreviewAssetMimeType(realTargetPath),
			},
		});
	}
}
