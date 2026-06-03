import { randomUUID } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import type { DesktopWorkspace, DesktopWorkspacePaneRole } from "../../shared/types.ts";
import { JsonFileStore } from "../storage/json-file-store.ts";
import type { TmuxPaneInfo, TmuxRuntime } from "../tmux/tmux-runtime.ts";
import type { DesktopWorkspaceStore } from "../workspace/workspace-store.ts";

type SnapshotIndex = Record<string, PaneSnapshot>;
type WorkspaceWithTmuxRuntime = DesktopWorkspace & {
	tmuxSocketPath: string;
	tmuxSessionName: string;
};

export interface RedactionCount {
	kind: string;
	count: number;
}

export interface RedactionResult {
	text: string;
	redactions: RedactionCount[];
}

export interface ExtractedBlock {
	kind: "error" | "test-failure" | "warning" | string;
	text: string;
}

export interface PaneSnapshot {
	id: string;
	workspaceId: string;
	paneId: string;
	paneRole?: DesktopWorkspacePaneRole;
	capturedAt: string;
	lineCount: number;
	text: string;
	rawTextStored: false;
	redactions: RedactionCount[];
	extractedBlocks: ExtractedBlock[];
	reason?: string;
}

export interface PaneSnapshotSummary {
	id: string;
	workspaceId: string;
	paneId: string;
	paneRole?: DesktopWorkspacePaneRole;
	capturedAt: string;
	lineCount: number;
	redactions: RedactionCount[];
	extractedBlocks: ExtractedBlock[];
	reason?: string;
}

export interface WorkspaceContextSnapshot {
	workspaceId: string;
	capturedAt: string;
	snapshots: PaneSnapshot[];
	combinedText: string;
	failures: Array<{ role?: DesktopWorkspacePaneRole; message: string }>;
}

export interface PaneSnapshotStore {
	save(snapshot: PaneSnapshot): Promise<PaneSnapshot>;
	list(workspaceId: string): Promise<PaneSnapshotSummary[]>;
	get(snapshotId: string): Promise<PaneSnapshot | null>;
	pruneWorkspaceSnapshots(workspaceId: string, before: string): Promise<number>;
}

export interface ContextHarvesterOptions {
	workspaceStore: DesktopWorkspaceStore;
	tmuxRuntime: TmuxRuntime;
	snapshotStore: PaneSnapshotStore;
	runtimeRootDir?: string;
	tmuxSocketRootDir?: string;
	now?: () => Date;
}

const DEFAULT_CONTEXT_CAPTURE_LINES: Record<DesktopWorkspacePaneRole, number> = {
	agent: 300,
	"dev-server": 500,
	logs: 500,
	shell: 500,
	test: 1000,
};
const MAX_CONTEXT_CAPTURE_LINES = 1000;
const MAX_SNAPSHOT_CHARS = 200_000;

function toTimestamp(now: () => Date): string {
	return now().toISOString();
}

function isPathInside(parentPath: string, childPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath));
	return relativePath.length === 0 || (!relativePath.startsWith("..") && !relativePath.startsWith(`..${sep}`));
}

function isInsideAllowedRuntimeSocketRoot(options: ContextHarvesterOptions, socketPath: string): boolean {
	return (
		(options.runtimeRootDir ? isPathInside(options.runtimeRootDir, socketPath) : false) ||
		(options.tmuxSocketRootDir ? isPathInside(options.tmuxSocketRootDir, socketPath) : false)
	);
}

function summarizeSnapshot(snapshot: PaneSnapshot): PaneSnapshotSummary {
	return {
		id: snapshot.id,
		workspaceId: snapshot.workspaceId,
		paneId: snapshot.paneId,
		...(snapshot.paneRole ? { paneRole: snapshot.paneRole } : {}),
		capturedAt: snapshot.capturedAt,
		lineCount: snapshot.lineCount,
		redactions: snapshot.redactions,
		extractedBlocks: snapshot.extractedBlocks,
		...(snapshot.reason ? { reason: snapshot.reason } : {}),
	};
}

function countLines(text: string): number {
	if (!text) {
		return 0;
	}
	return text.split(/\r?\n/).length;
}

function normalizeTerminalText(text: string): string {
	return text
		.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.slice(-MAX_SNAPSHOT_CHARS);
}

function clampCaptureLines(role: DesktopWorkspacePaneRole | undefined, lines: number | undefined): number {
	const defaultLines = role ? DEFAULT_CONTEXT_CAPTURE_LINES[role] : 500;
	if (lines === undefined || !Number.isFinite(lines)) {
		return defaultLines;
	}
	return Math.min(MAX_CONTEXT_CAPTURE_LINES, Math.max(1, Math.floor(lines)));
}

function addRedactionCount(counts: Map<string, number>, kind: string, count: number): void {
	if (count <= 0) {
		return;
	}
	counts.set(kind, (counts.get(kind) ?? 0) + count);
}

function replaceWithCount(
	input: string,
	pattern: RegExp,
	kind: string,
	replacer: (match: string, ...groups: string[]) => string,
	counts: Map<string, number>,
): string {
	let count = 0;
	const text = input.replace(pattern, (match, ...groups: string[]) => {
		count += 1;
		return replacer(match, ...groups);
	});
	addRedactionCount(counts, kind, count);
	return text;
}

export function redactTerminalText(input: string): RedactionResult {
	const counts = new Map<string, number>();
	let text = input;

	text = replaceWithCount(
		text,
		/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
		"ssh-private-key",
		() => "[REDACTED:ssh-private-key]",
		counts,
	);
	text = replaceWithCount(
		text,
		/\b(postgres(?:ql)?|mysql|mongodb):\/\/([^:\s/@]+):([^@\s]+)@/g,
		"database-url",
		(_match, scheme, user) => `${scheme}://${user}:[REDACTED:database-url]@`,
		counts,
	);
	text = replaceWithCount(
		text,
		/\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|KEY)[A-Z0-9_]*)=([^\s]+)/g,
		"env-secret",
		(_match, name) => `${name}=[REDACTED:env-secret]`,
		counts,
	);
	text = replaceWithCount(
		text,
		/\bBearer\s+([A-Za-z0-9._~+/=-]{20,})/g,
		"bearer-token",
		() => "Bearer [REDACTED:bearer-token]",
		counts,
	);
	text = replaceWithCount(
		text,
		/\b(?:sk-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
		"api-token",
		() => "[REDACTED:api-token]",
		counts,
	);

	return {
		text,
		redactions: [...counts.entries()].map(([kind, count]) => ({ kind, count })),
	};
}

export function extractErrors(text: string): ExtractedBlock[] {
	const lines = text.split(/\r?\n/);
	const blocks: ExtractedBlock[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (/\b(warn|warning)\b/i.test(line)) {
			blocks.push({ kind: "warning", text: line });
			continue;
		}
		if (/\b(error|exception|failed|failure)\b/i.test(line)) {
			const nextLine = lines[index + 1];
			const blockText = nextLine ? `${line}\n${nextLine}` : line;
			const kind = /\b(expected|received|assert|test|suite)\b/i.test(blockText) ? "test-failure" : "error";
			blocks.push({ kind, text: blockText });
		}
	}
	return blocks;
}

export class JsonPaneSnapshotStore implements PaneSnapshotStore {
	private readonly store: JsonFileStore<SnapshotIndex>;

	constructor(indexFilePath: string) {
		this.store = new JsonFileStore(indexFilePath, {});
	}

	async save(snapshot: PaneSnapshot): Promise<PaneSnapshot> {
		await this.store.update((current) => ({
			...current,
			[snapshot.id]: snapshot,
		}));
		return snapshot;
	}

	async list(workspaceId: string): Promise<PaneSnapshotSummary[]> {
		const index = await this.store.read();
		return Object.values(index)
			.filter((snapshot) => snapshot.workspaceId === workspaceId)
			.sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))
			.map(summarizeSnapshot);
	}

	async get(snapshotId: string): Promise<PaneSnapshot | null> {
		const index = await this.store.read();
		return index[snapshotId] ?? null;
	}

	async pruneWorkspaceSnapshots(workspaceId: string, before: string): Promise<number> {
		let deletedSnapshots = 0;
		await this.store.update((current) => {
			const next = { ...current };
			for (const snapshot of Object.values(current)) {
				if (snapshot.workspaceId === workspaceId && snapshot.capturedAt < before) {
					delete next[snapshot.id];
					deletedSnapshots += 1;
				}
			}
			return next;
		});
		return deletedSnapshots;
	}
}

export class ContextHarvester {
	private readonly now: () => Date;

	constructor(private readonly options: ContextHarvesterOptions) {
		this.now = options.now ?? (() => new Date());
	}

	private async getWorkspace(workspaceId: string): Promise<WorkspaceWithTmuxRuntime> {
		const workspace = await this.options.workspaceStore.getWorkspace(workspaceId);
		if (!workspace) {
			throw new Error(`Workspace '${workspaceId}' does not exist.`);
		}
		const { tmuxSocketPath, tmuxSessionName } = workspace;
		if (!tmuxSocketPath || !tmuxSessionName) {
			throw new Error(`Workspace '${workspaceId}' has no tmux runtime metadata.`);
		}
		if (
			(this.options.runtimeRootDir || this.options.tmuxSocketRootDir) &&
			!isInsideAllowedRuntimeSocketRoot(this.options, tmuxSocketPath)
		) {
			throw new Error(`Workspace '${workspaceId}' runtime socket is outside app-owned runtime storage.`);
		}
		return { ...workspace, tmuxSocketPath, tmuxSessionName };
	}

	private async resolvePane(input: {
		workspaceId: string;
		paneRole?: DesktopWorkspacePaneRole;
		paneId?: string;
	}): Promise<{ paneId: string; paneRole?: DesktopWorkspacePaneRole }> {
		const workspace = await this.getWorkspace(input.workspaceId);
		const panes = await this.options.tmuxRuntime.listPanes({
			socketPath: workspace.tmuxSocketPath,
			sessionName: workspace.tmuxSessionName,
		});
		if (input.paneId) {
			const pane = panes.find((candidate: TmuxPaneInfo) => candidate.paneId === input.paneId);
			if (!pane) {
				throw new Error(`Pane '${input.paneId}' does not belong to workspace '${input.workspaceId}'.`);
			}
			if (input.paneRole && pane.windowName !== input.paneRole) {
				throw new Error(`Pane '${input.paneId}' is not the '${input.paneRole}' pane.`);
			}
			const paneDefinition = workspace.paneDefinitions.find((candidate) => candidate.role === pane.windowName);
			const paneRole = input.paneRole ?? paneDefinition?.role;
			return {
				paneId: input.paneId,
				...(paneRole ? { paneRole } : {}),
			};
		}
		if (!input.paneRole) {
			throw new Error("captureWorkspacePane requires paneRole or paneId.");
		}
		const pane = panes.find((candidate: TmuxPaneInfo) => candidate.windowName === input.paneRole);
		if (!pane) {
			throw new Error(`No pane found for role '${input.paneRole}'.`);
		}
		return { paneId: pane.paneId, paneRole: input.paneRole };
	}

	async captureWorkspacePane(input: {
		workspaceId: string;
		paneRole?: DesktopWorkspacePaneRole;
		paneId?: string;
		lines?: number;
		reason?: string;
	}): Promise<PaneSnapshot> {
		const workspace = await this.getWorkspace(input.workspaceId);
		const pane = await this.resolvePane(input);
		const lines = clampCaptureLines(pane.paneRole, input.lines);
		const rawText = await this.options.tmuxRuntime.capturePane({
			socketPath: workspace.tmuxSocketPath,
			paneId: pane.paneId,
			lines,
			joinWrappedLines: true,
		});
		const normalizedText = normalizeTerminalText(rawText);
		const redacted = redactTerminalText(normalizedText);
		const snapshot: PaneSnapshot = {
			id: randomUUID(),
			workspaceId: input.workspaceId,
			paneId: pane.paneId,
			...(pane.paneRole ? { paneRole: pane.paneRole } : {}),
			capturedAt: toTimestamp(this.now),
			lineCount: countLines(redacted.text),
			text: redacted.text,
			rawTextStored: false,
			redactions: redacted.redactions,
			extractedBlocks: extractErrors(redacted.text),
			...(input.reason ? { reason: input.reason } : {}),
		};
		return this.options.snapshotStore.save(snapshot);
	}

	async captureWorkspaceContext(input: {
		workspaceId: string;
		roles?: DesktopWorkspacePaneRole[];
		linesPerPane?: number;
		reason?: string;
	}): Promise<WorkspaceContextSnapshot> {
		const roles = input.roles ?? ["dev-server", "test", "logs"];
		const snapshots: PaneSnapshot[] = [];
		const failures: WorkspaceContextSnapshot["failures"] = [];
		for (const role of roles) {
			try {
				snapshots.push(
					await this.captureWorkspacePane({
						workspaceId: input.workspaceId,
						paneRole: role,
						lines: input.linesPerPane,
						reason: input.reason,
					}),
				);
			} catch (error) {
				failures.push({ role, message: error instanceof Error ? error.message : String(error) });
			}
		}
		return {
			workspaceId: input.workspaceId,
			capturedAt: toTimestamp(this.now),
			snapshots,
			combinedText: snapshots
				.map((snapshot) => `# ${snapshot.paneRole ?? snapshot.paneId}\n${snapshot.text}`)
				.join("\n\n"),
			failures,
		};
	}

	listPaneSnapshots(workspaceId: string): Promise<PaneSnapshotSummary[]> {
		return this.options.snapshotStore.list(workspaceId);
	}

	async getPaneSnapshot(snapshotId: string): Promise<PaneSnapshot> {
		const snapshot = await this.options.snapshotStore.get(snapshotId);
		if (!snapshot) {
			throw new Error(`Pane snapshot '${snapshotId}' does not exist.`);
		}
		return snapshot;
	}
}
