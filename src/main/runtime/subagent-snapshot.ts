import { access } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { DesktopAgentModel } from "../../shared/serialized-agent-event.ts";
import type {
	DesktopEnvironmentResource,
	DesktopSubagentSnapshot,
	DesktopSubagentSnapshotRequest,
} from "../../shared/types.ts";
import type { JsonEnvironmentResourceStore } from "../environment/environment-resource-store.ts";

interface ReadSubagentSnapshotOptions {
	environmentResourceStore: Pick<JsonEnvironmentResourceStore, "listResources">;
	request: DesktopSubagentSnapshotRequest;
	subagentSessionsDir: string;
}

function requireSubagentResource(
	resources: readonly DesktopEnvironmentResource[],
	request: DesktopSubagentSnapshotRequest,
): DesktopEnvironmentResource {
	const resource = resources.find(
		(candidate) =>
			candidate.provider === "subagent" &&
			candidate.kind === "subagent" &&
			candidate.sessionId === request.parentSessionId &&
			candidate.metadata.subagentId === request.subagentId,
	);
	if (!resource) {
		throw new Error(`Subagent '${request.subagentId}' is not registered for session '${request.parentSessionId}'.`);
	}
	return resource;
}

function assertTranscriptPathAllowed(
	transcriptPath: string | undefined,
	options: Pick<ReadSubagentSnapshotOptions, "request" | "subagentSessionsDir">,
): string {
	if (!transcriptPath) {
		throw new Error(`Subagent '${options.request.subagentId}' has no persisted transcript path.`);
	}

	const resolvedRoot = resolve(options.subagentSessionsDir, options.request.parentSessionId);
	const resolvedTranscriptPath = resolve(transcriptPath);
	const relativePath = relative(resolvedRoot, resolvedTranscriptPath);
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith("../") ||
		isAbsolute(relativePath) ||
		resolve(resolvedRoot, relativePath) !== resolvedTranscriptPath
	) {
		throw new Error("Subagent transcript path is outside the registered subagent directory.");
	}

	return resolvedTranscriptPath;
}

function createModel(provider: string, modelId: string): DesktopAgentModel {
	return {
		id: modelId,
		name: modelId,
		provider,
		reasoning: false,
	};
}

function resolveThinkingLevel(value: string | undefined): ThinkingLevel {
	switch (value) {
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh":
			return value;
		default:
			return "off";
	}
}

export async function readSubagentSnapshot({
	environmentResourceStore,
	request,
	subagentSessionsDir,
}: ReadSubagentSnapshotOptions): Promise<DesktopSubagentSnapshot> {
	const resources = await environmentResourceStore.listResources({ sessionId: request.parentSessionId });
	const resource = requireSubagentResource(resources, request);
	const transcriptPath = assertTranscriptPathAllowed(resource.metadata.transcriptPath, {
		request,
		subagentSessionsDir,
	});
	await access(transcriptPath);
	const sessionManager = SessionManager.open(transcriptPath, dirname(transcriptPath), resource.cwd);
	const entries = sessionManager.getEntries();
	const messages = entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
	const latestThinkingEntry = entries.findLast((entry) => entry.type === "thinking_level_change");
	const latestModelEntry = entries.findLast((entry) => entry.type === "model_change");
	const model =
		latestModelEntry?.type === "model_change"
			? createModel(latestModelEntry.provider, latestModelEntry.modelId)
			: undefined;

	return {
		parentSessionId: request.parentSessionId,
		subagentId: request.subagentId,
		resource: {
			...resource,
			metadata: {
				...resource.metadata,
				transcriptPath,
			},
		},
		sessionId: request.subagentId,
		cwd: resource.cwd,
		agentMode: "execute",
		diagnostics: [],
		...(model ? { model } : {}),
		thinkingLevel: resolveThinkingLevel(
			latestThinkingEntry?.type === "thinking_level_change" ? latestThinkingEntry.thinkingLevel : undefined,
		),
		availableTools: resource.status === "running" ? ["read", "find", "grep", "ls", "bash"] : [],
		messages,
		pendingToolCalls: [],
		isStreaming: resource.status === "running",
		...(resource.status === "failed" && resource.metadata.errorMessage
			? { errorMessage: resource.metadata.errorMessage }
			: {}),
	};
}
