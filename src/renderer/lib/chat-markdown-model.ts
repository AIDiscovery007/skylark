import type { ThreadImagePreviewGridItem } from "../components/chat/ThreadImagePreviewGrid.tsx";

const WORKSPACE_PREVIEW_LINK_PREFIX = "https://workspace-preview.invalid/";
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;

export interface MarkdownAstNode {
	children?: MarkdownAstNode[];
	type?: string;
	url?: unknown;
}

export type AssistantMarkdownSegment =
	| {
			key: string;
			text: string;
			type: "markdown";
	  }
	| {
			items: ThreadImagePreviewGridItem[];
			key: string;
			type: "images";
	  };

export function workspacePreviewLinkRemarkPlugin() {
	return (tree: MarkdownAstNode): void => {
		rewriteWorkspacePreviewLinkUrls(tree);
	};
}

function rewriteWorkspacePreviewLinkUrls(node: MarkdownAstNode): void {
	if (node.type === "link" && typeof node.url === "string") {
		const workspacePreviewHref = encodeWorkspacePreviewLinkHref(node.url);
		if (workspacePreviewHref) {
			node.url = workspacePreviewHref;
		}
	}

	for (const child of node.children ?? []) {
		rewriteWorkspacePreviewLinkUrls(child);
	}
}

export function encodeWorkspacePreviewLinkHref(href: string): string | undefined {
	const trimmedHref = href.trim();
	if (!shouldRewriteWorkspacePreviewLinkHref(trimmedHref)) {
		return undefined;
	}
	return `${WORKSPACE_PREVIEW_LINK_PREFIX}${encodeURIComponent(trimmedHref)}`;
}

export function decodeWorkspacePreviewLinkHref(href: string | undefined): string | undefined {
	if (!href?.startsWith(WORKSPACE_PREVIEW_LINK_PREFIX)) {
		return undefined;
	}

	try {
		return decodeURIComponent(href.slice(WORKSPACE_PREVIEW_LINK_PREFIX.length));
	} catch {
		return undefined;
	}
}

function shouldRewriteWorkspacePreviewLinkHref(href: string): boolean {
	if (!href || href.startsWith("#") || href.startsWith("?") || href.startsWith("//")) {
		return false;
	}
	if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
		return false;
	}

	const schemeMatch = /^[a-z][a-z0-9+.-]*:/i.exec(href);
	if (!schemeMatch) {
		return href.startsWith("./") || href.startsWith("../") || href.includes("/") || href.includes("\\");
	}
	return schemeMatch[0].toLowerCase() === "file:";
}

export function isExternalBrowserHref(href: string): boolean {
	const trimmedHref = href.trim();
	return /^https?:\/\//i.test(trimmedHref) || /^mailto:/i.test(trimmedHref);
}

export function isWorkspacePreviewHref(href: string): boolean {
	const trimmedHref = href.trim();
	if (!trimmedHref || trimmedHref.startsWith("#") || trimmedHref.startsWith("?")) {
		return false;
	}

	const schemeMatch = /^[a-z][a-z0-9+.-]*:/i.exec(trimmedHref);
	if (!schemeMatch) {
		return true;
	}
	return schemeMatch[0].toLowerCase() === "file:";
}

function normalizeMarkdownImageAlt(alt: string | undefined, src: string): string {
	const trimmedAlt = alt?.trim();
	if (trimmedAlt) {
		return trimmedAlt;
	}
	return (
		src
			.split(/[\\/]+/)
			.filter(Boolean)
			.at(-1) ?? "Image"
	);
}

export function createMarkdownImagePreviewItem(
	src: string | undefined,
	alt: string | undefined,
	indexKey: string,
): ThreadImagePreviewGridItem | undefined {
	const trimmedSrc = src?.trim();
	if (!trimmedSrc) {
		return undefined;
	}

	const label = normalizeMarkdownImageAlt(alt, trimmedSrc);
	if (/^data:image\//i.test(trimmedSrc) || /^blob:/i.test(trimmedSrc)) {
		return {
			alt: label,
			id: `markdown-image:${indexKey}:${trimmedSrc.slice(0, 96)}`,
			kind: "direct",
			src: trimmedSrc,
			title: label,
		};
	}

	if (/^https?:\/\//i.test(trimmedSrc)) {
		return {
			alt: label,
			href: trimmedSrc,
			id: `markdown-image:${indexKey}:${trimmedSrc}`,
			kind: "external",
			title: label,
		};
	}

	if (isWorkspacePreviewHref(trimmedSrc)) {
		return {
			alt: label,
			id: `markdown-image:${indexKey}:${trimmedSrc}`,
			kind: "workspace",
			path: trimmedSrc,
			title: label,
		};
	}

	return {
		alt: label,
		href: trimmedSrc,
		id: `markdown-image:${indexKey}:${trimmedSrc}`,
		kind: "external",
		title: label,
	};
}

function parseImageOnlyMarkdownBlock(block: string, blockIndex: number): ThreadImagePreviewGridItem[] | undefined {
	const trimmedBlock = block.trim();
	if (!trimmedBlock.includes("![")) {
		return undefined;
	}

	MARKDOWN_IMAGE_PATTERN.lastIndex = 0;
	const items: ThreadImagePreviewGridItem[] = [];
	let cursor = 0;
	for (const match of trimmedBlock.matchAll(MARKDOWN_IMAGE_PATTERN)) {
		const matchIndex = match.index ?? 0;
		if (trimmedBlock.slice(cursor, matchIndex).trim().length > 0) {
			return undefined;
		}

		const item = createMarkdownImagePreviewItem(match[2], match[1], `${blockIndex}:${items.length}`);
		if (!item) {
			return undefined;
		}
		items.push(item);
		cursor = matchIndex + match[0].length;
	}

	if (items.length === 0 || trimmedBlock.slice(cursor).trim().length > 0) {
		return undefined;
	}
	return items;
}

export function splitAssistantMarkdownImageBlocks(text: string): AssistantMarkdownSegment[] {
	const blocks = text.split(/\r?\n\s*\r?\n/);
	const segments: AssistantMarkdownSegment[] = [];
	let pendingMarkdown: string[] = [];
	let pendingImages: ThreadImagePreviewGridItem[] = [];

	function flushMarkdown(): void {
		if (pendingMarkdown.length === 0) {
			return;
		}
		const segmentText = pendingMarkdown.join("\n\n");
		segments.push({
			key: `markdown:${segments.length}:${segmentText.slice(0, 80)}`,
			text: segmentText,
			type: "markdown",
		});
		pendingMarkdown = [];
	}

	function flushImages(): void {
		if (pendingImages.length === 0) {
			return;
		}
		segments.push({
			items: pendingImages,
			key: `images:${segments.length}:${pendingImages.map((item) => item.id).join("|")}`,
			type: "images",
		});
		pendingImages = [];
	}

	for (const [blockIndex, block] of blocks.entries()) {
		const imageItems = parseImageOnlyMarkdownBlock(block, blockIndex);
		if (imageItems) {
			flushMarkdown();
			pendingImages.push(...imageItems);
			continue;
		}

		flushImages();
		pendingMarkdown.push(block);
	}

	flushMarkdown();
	flushImages();
	return segments;
}
