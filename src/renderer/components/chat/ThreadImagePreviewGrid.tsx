import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { VirtualStack } from "@/components/ui/virtual-stack";
import { useStreamingPresentationFrame } from "@/hooks/use-streaming-presentation-frame";
import type { ToolCallActivity } from "../../lib/conversation-timeline-projection.ts";
import { cn } from "../../lib/utils.ts";

const IMAGE_GRID_GAP_PX = 12;
const IMAGE_GRID_MIN_TILE_WIDTH_PX = 260;
const IMAGE_PREVIEW_TILE_HEIGHT_PX = 220;
const IMAGE_PREVIEW_VIRTUALIZATION_THRESHOLD = 12;

export interface ThreadImagePreview {
	alt: string;
	src: string;
	title?: string;
}

export type ThreadImagePreviewGridItem =
	| {
			alt: string;
			id: string;
			kind: "direct";
			src: string;
			title?: string;
	  }
	| {
			alt: string;
			id: string;
			kind: "workspace";
			path: string;
			title?: string;
	  }
	| {
			alt: string;
			href: string;
			id: string;
			kind: "external";
			title?: string;
	  };

export interface ResolvedThreadImagePreview {
	src: string;
	title?: string;
}

export type WorkspaceImagePreviewResolver = (path: string) => Promise<ResolvedThreadImagePreview>;

interface ThreadImagePreviewGridProps {
	className?: string;
	isRunActive?: boolean;
	items: readonly ThreadImagePreviewGridItem[];
	onPreviewImage?: (image: ThreadImagePreview) => void;
	resolveWorkspaceImage?: WorkspaceImagePreviewResolver;
}

interface ThreadImagePreviewTileProps {
	item: ThreadImagePreviewGridItem;
	onPreviewImage?: (image: ThreadImagePreview) => void;
	resolveWorkspaceImage?: WorkspaceImagePreviewResolver;
}

interface ThreadImagePreviewVirtualRow {
	id: string;
	items: ThreadImagePreviewGridItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringProperty(value: unknown, ...keys: string[]): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	for (const key of keys) {
		const property = value[key];
		if (typeof property === "string" && property.trim().length > 0) {
			return property;
		}
	}
	return undefined;
}

function getArrayContent(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	if (!isRecord(value)) {
		return [];
	}
	const content = value.content;
	return Array.isArray(content) ? content : [];
}

function getToolCallDisplayName(toolCall: ToolCallActivity): string | undefined {
	const fromArgs = getStringProperty(toolCall.args, "path", "file", "filename", "fileName", "name");
	const source = fromArgs ?? getStringProperty(toolCall.result, "path", "name", "filename", "fileName");
	if (!source) {
		return undefined;
	}
	return (
		source
			.split(/[\\/]+/)
			.filter(Boolean)
			.at(-1) ?? source
	);
}

function getImageGridColumnCount(width: number): number {
	if (!Number.isFinite(width) || width <= 0) {
		return 2;
	}
	return Math.max(1, Math.floor((width + IMAGE_GRID_GAP_PX) / (IMAGE_GRID_MIN_TILE_WIDTH_PX + IMAGE_GRID_GAP_PX)));
}

function getImagePreviewRows(
	items: readonly ThreadImagePreviewGridItem[],
	columnCount: number,
): ThreadImagePreviewVirtualRow[] {
	const rows: ThreadImagePreviewVirtualRow[] = [];
	for (let index = 0; index < items.length; index += columnCount) {
		const rowItems = items.slice(index, index + columnCount);
		rows.push({
			id: rowItems.map((item) => item.id).join("|"),
			items: rowItems,
		});
	}
	return rows;
}

function getImagePartName(part: unknown, fallbackName?: string): string {
	const partName = getStringProperty(part, "name", "filename", "fileName", "caption", "title");
	return partName ?? fallbackName ?? "Image";
}

function getImagePartDataUrl(part: unknown): string | undefined {
	if (!isRecord(part)) {
		return undefined;
	}
	const url = getStringProperty(part, "url", "image", "src", "dataUrl");
	if (url?.startsWith("data:image/")) {
		return url;
	}
	const mimeType = getStringProperty(part, "mimeType", "mime_type", "mediaType", "media_type");
	const data = getStringProperty(part, "data", "base64");
	if (mimeType?.startsWith("image/") && data) {
		return `data:${mimeType};base64,${data}`;
	}
	return undefined;
}

function extractToolCallImageItems(toolCall: ToolCallActivity, result: unknown, source: "partial" | "result") {
	const items: ThreadImagePreviewGridItem[] = [];
	const fallbackName = getToolCallDisplayName(toolCall);
	for (const [index, part] of getArrayContent(result).entries()) {
		const src = getImagePartDataUrl(part);
		if (!src) {
			continue;
		}
		const title = getImagePartName(part, fallbackName);
		items.push({
			alt: title,
			id: `${toolCall.toolCallId}:${source}:${index}:${title}`,
			kind: "direct",
			src,
			title,
		});
	}
	return items;
}

export function getToolCallImagePreviewItems(toolCalls: readonly ToolCallActivity[]): ThreadImagePreviewGridItem[] {
	const items: ThreadImagePreviewGridItem[] = [];
	const seen = new Set<string>();
	for (const toolCall of toolCalls) {
		const resultItems = [
			...extractToolCallImageItems(toolCall, toolCall.partialResult, "partial"),
			...extractToolCallImageItems(toolCall, toolCall.result, "result"),
		];
		for (const item of resultItems) {
			if (item.kind !== "direct" || seen.has(item.src)) {
				continue;
			}
			seen.add(item.src);
			items.push(item);
		}
	}
	return items;
}

function ThreadImageUnavailable() {
	return (
		<div
			className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-[color:var(--border-subtle)] px-4 py-6 text-[13px] italic text-muted-foreground"
			data-slot="thread-image-preview-placeholder"
		>
			Image not available
		</div>
	);
}

function ThreadImagePreviewTile({ item, onPreviewImage, resolveWorkspaceImage }: ThreadImagePreviewTileProps) {
	const directPreview = item.kind === "direct" ? { src: item.src, title: item.title } : undefined;
	const [resolvedPreview, setResolvedPreview] = useState<ResolvedThreadImagePreview | undefined>(directPreview);
	const [isUnavailable, setIsUnavailable] = useState(item.kind === "external");
	const directSrc = item.kind === "direct" ? item.src : undefined;
	const workspacePath = item.kind === "workspace" ? item.path : undefined;
	const itemKind = item.kind;
	const itemTitle = item.title;

	useEffect(() => {
		if (itemKind === "direct" && directSrc) {
			setResolvedPreview({ src: directSrc, title: itemTitle });
			setIsUnavailable(false);
			return undefined;
		}
		if (itemKind === "external" || !workspacePath || !resolveWorkspaceImage) {
			setResolvedPreview(undefined);
			setIsUnavailable(true);
			return undefined;
		}

		let cancelled = false;
		setResolvedPreview(undefined);
		setIsUnavailable(false);
		void resolveWorkspaceImage(workspacePath)
			.then((preview) => {
				if (cancelled) {
					return;
				}
				setResolvedPreview(preview);
				setIsUnavailable(false);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setResolvedPreview(undefined);
				setIsUnavailable(true);
			});

		return () => {
			cancelled = true;
		};
	}, [directSrc, itemKind, itemTitle, resolveWorkspaceImage, workspacePath]);

	if (isUnavailable || !resolvedPreview) {
		return <ThreadImageUnavailable />;
	}

	const title = item.title ?? resolvedPreview.title;
	const preview = {
		alt: item.alt,
		src: resolvedPreview.src,
		title,
	};

	return (
		<button
			aria-label={`Open image preview for ${item.alt}`}
			className="block max-w-full cursor-zoom-in rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
			data-slot="thread-image-preview-button"
			onClick={() => onPreviewImage?.(preview)}
			type="button"
		>
			<span
				className="flex h-[220px] max-w-full items-center justify-center overflow-hidden rounded-lg border border-[color:var(--border-subtle)] shadow-[var(--shadow-minimal)]"
				data-slot="thread-image-preview-frame"
			>
				<img
					alt={item.alt}
					className="max-h-full max-w-full object-contain"
					data-slot="thread-image-preview-image"
					src={resolvedPreview.src}
					title={title}
				/>
			</span>
		</button>
	);
}

export function ThreadImagePreviewGrid({
	className,
	isRunActive = false,
	items,
	onPreviewImage,
	resolveWorkspaceImage,
}: ThreadImagePreviewGridProps) {
	const visibleItems = useMemo(() => items.filter((item) => item.alt.trim().length > 0), [items]);
	const presentedItems = useStreamingPresentationFrame(visibleItems, isRunActive);
	const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);
	const [columnCount, setColumnCount] = useState(2);
	const previewRows = useMemo(() => getImagePreviewRows(presentedItems, columnCount), [presentedItems, columnCount]);

	useLayoutEffect(() => {
		if (!viewportElement) {
			return;
		}

		const updateColumnCount = () => {
			setColumnCount((current) => {
				const next = getImageGridColumnCount(viewportElement.clientWidth);
				return current === next ? current : next;
			});
		};

		updateColumnCount();
		if (typeof ResizeObserver === "undefined") {
			return;
		}
		const resizeObserver = new ResizeObserver(updateColumnCount);
		resizeObserver.observe(viewportElement);
		return () => resizeObserver.disconnect();
	}, [viewportElement]);

	if (presentedItems.length === 0) {
		return null;
	}

	if (presentedItems.length > IMAGE_PREVIEW_VIRTUALIZATION_THRESHOLD) {
		return (
			<VirtualStack
				ariaLabel="Image previews"
				className={cn("native-scrollbar max-h-[min(64vh,36rem)] overflow-y-auto pr-1", className)}
				dataSlot="thread-image-preview-grid"
				estimateSize={() => IMAGE_PREVIEW_TILE_HEIGHT_PX}
				gap={IMAGE_GRID_GAP_PX}
				getKey={(row) => row.id}
				initialViewportHeight={576}
				items={previewRows}
				overscan={2}
				renderItem={({ item: row }) => (
					<div
						className="grid max-w-full items-start gap-3"
						style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
					>
						{row.items.map((item) => (
							<ThreadImagePreviewTile
								item={item}
								key={item.id}
								onPreviewImage={onPreviewImage}
								resolveWorkspaceImage={resolveWorkspaceImage}
							/>
						))}
					</div>
				)}
				viewportRef={setViewportElement}
			/>
		);
	}

	return (
		<div
			className={cn(
				"grid max-w-full items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]",
				className,
			)}
			data-slot="thread-image-preview-grid"
		>
			{presentedItems.map((item) => (
				<ThreadImagePreviewTile
					item={item}
					key={item.id}
					onPreviewImage={onPreviewImage}
					resolveWorkspaceImage={resolveWorkspaceImage}
				/>
			))}
		</div>
	);
}
