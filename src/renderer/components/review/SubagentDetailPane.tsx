import { Bot, ChevronDown, ChevronRight, FileText, Gauge, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getErrorMessage } from "../../../shared/errors.ts";
import type {
	DesktopEnvironmentEvent,
	DesktopEnvironmentResource,
	DesktopEnvironmentResourceStatus,
	DesktopSubagentOpenRequest,
	DesktopSubagentRuntimeEvent,
	DesktopSubagentSnapshot,
} from "../../../shared/types.ts";
import { useSubscribedResource } from "../../hooks/use-subscribed-resource.ts";
import {
	createAgentRendererState,
	INITIAL_AGENT_RENDERER_STATE,
	reduceAgentEvent,
} from "../../lib/conversation-timeline-projection.ts";
import { cn } from "../../lib/utils.ts";
import { MessageResponse } from "../ai-elements/message.tsx";
import { MessageList } from "../chat/MessageList.tsx";
import { Badge } from "../ui/badge.tsx";

interface SubagentRuntimeView {
	errorMessage?: string;
	isLoading: boolean;
	rendererState: ReturnType<typeof createAgentRendererState>;
	snapshot?: DesktopSubagentSnapshot;
}

interface SubagentDetailPaneProps {
	request: DesktopSubagentOpenRequest;
	showThinkingBlocks?: boolean;
}

function createInitialSubagentView(): SubagentRuntimeView {
	return {
		isLoading: true,
		rendererState: {
			...INITIAL_AGENT_RENDERER_STATE,
			hasHydrated: false,
		},
	};
}

function isMatchingSubagentEvent(
	event: DesktopSubagentRuntimeEvent,
	parentSessionId: string,
	subagentId: string,
): boolean {
	return event.parentSessionId === parentSessionId && event.subagentId === subagentId;
}

function reduceSubagentRuntimeEvent(
	state: SubagentRuntimeView["rendererState"],
	event: DesktopSubagentRuntimeEvent,
): SubagentRuntimeView["rendererState"] {
	return reduceAgentEvent(state, {
		...event.event,
		sessionId: event.subagentId,
	});
}

function getSubagentResourceFromEnvironmentEvent(
	event: DesktopEnvironmentEvent,
	parentSessionId: string,
	subagentId: string,
): DesktopEnvironmentResource | undefined {
	if (event.type === "environment_resource_detached") {
		const resource = event.resource;
		return resource.provider === "subagent" &&
			resource.sessionId === parentSessionId &&
			resource.metadata.subagentId === subagentId
			? resource
			: undefined;
	}

	return event.resources.find(
		(resource) =>
			resource.provider === "subagent" &&
			resource.sessionId === parentSessionId &&
			resource.metadata.subagentId === subagentId,
	);
}

function useSubagentRuntime(request: DesktopSubagentOpenRequest): SubagentRuntimeView {
	const [view, setView] = useState<SubagentRuntimeView>(() => createInitialSubagentView());
	const { parentSessionId, subagentId } = request;
	const hasHydratedRef = useRef(false);
	const queuedEventsRef = useRef<DesktopSubagentRuntimeEvent[]>([]);

	useSubscribedResource<DesktopSubagentRuntimeEvent>(
		(onEvent) => window.desktopAgent.subscribeToSubagentEvents(onEvent),
		(event) => {
			if (!isMatchingSubagentEvent(event, parentSessionId, subagentId)) {
				return;
			}
			if (!hasHydratedRef.current) {
				queuedEventsRef.current.push(event);
				return;
			}
			setView((current) => ({
				...current,
				rendererState: reduceSubagentRuntimeEvent(current.rendererState, event),
			}));
		},
		[parentSessionId, subagentId],
	);

	useSubscribedResource<DesktopEnvironmentEvent>(
		(onEvent) => window.desktopAgent.subscribeToEnvironmentEvents(onEvent),
		(event) => {
			const resource = getSubagentResourceFromEnvironmentEvent(event, parentSessionId, subagentId);
			if (!resource) {
				return;
			}
			setView((current) => ({
				...current,
				snapshot: current.snapshot ? { ...current.snapshot, resource } : current.snapshot,
			}));
		},
		[parentSessionId, subagentId],
	);

	useEffect(() => {
		let cancelled = false;
		hasHydratedRef.current = false;
		queuedEventsRef.current = [];
		setView(createInitialSubagentView());

		void window.desktopAgent
			.getSubagentSnapshot({
				parentSessionId,
				subagentId,
			})
			.then((snapshot) => {
				if (cancelled) {
					return;
				}
				let rendererState = createAgentRendererState(snapshot);
				for (const event of queuedEventsRef.current) {
					rendererState = reduceSubagentRuntimeEvent(rendererState, event);
				}
				hasHydratedRef.current = true;
				queuedEventsRef.current = [];
				setView({
					isLoading: false,
					rendererState,
					snapshot,
				});
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				hasHydratedRef.current = true;
				queuedEventsRef.current = [];
				setView({
					errorMessage: getErrorMessage(error),
					isLoading: false,
					rendererState: {
						...INITIAL_AGENT_RENDERER_STATE,
						hasHydrated: true,
					},
				});
			});

		return () => {
			cancelled = true;
			hasHydratedRef.current = false;
			queuedEventsRef.current = [];
		};
	}, [parentSessionId, subagentId]);

	return view;
}

function getStatusVariant(
	status: DesktopEnvironmentResourceStatus,
): "success" | "error" | "info" | "warning" | "neutral" {
	switch (status) {
		case "completed":
			return "success";
		case "failed":
			return "error";
		case "running":
			return "info";
		case "stale":
			return "warning";
		default:
			return "neutral";
	}
}

function metadataValue(resource: DesktopEnvironmentResource | undefined, key: string): string | undefined {
	const value = resource?.metadata[key];
	return value && value.trim().length > 0 ? value : undefined;
}

function HandoffField({ label, value }: { label: string; value?: string }) {
	if (!value) {
		return null;
	}

	return (
		<div className="grid min-w-0 gap-1.5" data-slot="subagent-handoff-field">
			<p className="ui-detail-label">{label}</p>
			<MessageResponse className="min-w-0 text-[13px] leading-6 text-foreground">{value}</MessageResponse>
		</div>
	);
}

function SubagentDetailHeader({
	errorMessage,
	request,
	resource,
}: {
	errorMessage?: string;
	request: DesktopSubagentOpenRequest;
	resource?: DesktopEnvironmentResource;
}) {
	const title = resource?.title ?? request.title ?? request.subagentId;
	const status = resource?.status ?? (errorMessage ? "failed" : "unknown");
	const limitReached = resource?.metadata.limitReached === "true";
	const budgetText =
		resource?.metadata.turnCount || resource?.metadata.maxTurns
			? `${resource.metadata.turnCount ?? "0"}/${resource.metadata.maxTurns ?? "?"} turns`
			: undefined;

	return (
		<header className="shrink-0 border-b border-border/70 px-4 py-3" data-slot="subagent-detail-header">
			<div className="flex min-w-0 items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-2">
						<Bot className="size-4 shrink-0 text-muted-foreground" />
						<h2 className="truncate text-[13px] font-medium text-foreground">{title}</h2>
					</div>
					<p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
						{request.parentSessionId} / {request.subagentId}
					</p>
				</div>
				<div className="flex shrink-0 flex-wrap justify-end gap-1.5">
					<Badge variant={getStatusVariant(status)}>{status}</Badge>
					{limitReached ? <Badge variant="warning">budget reached</Badge> : null}
				</div>
			</div>
			<div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
				{budgetText ? (
					<span className="inline-flex min-w-0 items-center gap-1.5">
						<Gauge className="size-3.5" />
						<span>{budgetText}</span>
					</span>
				) : null}
				{resource?.metadata.transcriptPath ? (
					<span className="inline-flex min-w-0 items-center gap-1.5">
						<FileText className="size-3.5 shrink-0" />
						<span className="truncate font-mono">{resource.metadata.transcriptPath}</span>
					</span>
				) : null}
			</div>
		</header>
	);
}

function SubagentHandoffBrief({ resource }: { resource?: DesktopEnvironmentResource }) {
	const [isExpanded, setIsExpanded] = useState(false);
	const fields = useMemo(
		() => [
			{ label: "Task", value: metadataValue(resource, "task") },
			{ label: "Context", value: metadataValue(resource, "contextSummary") },
			{ label: "Scope", value: metadataValue(resource, "scope") },
			{ label: "Success Criteria", value: metadataValue(resource, "successCriteria") },
			{ label: "Known Facts", value: metadataValue(resource, "knownFacts") },
			{ label: "Suggested Approach", value: metadataValue(resource, "suggestedApproach") },
			{ label: "Expected Output", value: metadataValue(resource, "expectedOutput") },
		],
		[resource],
	);
	const visibleFields = fields.filter((field) => field.value !== undefined);
	if (visibleFields.length === 0) {
		return null;
	}
	const preview = `${visibleFields.length} handoff details hidden`;

	return (
		<section
			aria-label="Subagent handoff brief"
			className="shrink-0 border-b border-border/70"
			data-expanded={isExpanded ? "true" : "false"}
			data-slot="subagent-handoff-brief"
		>
			<button
				aria-expanded={isExpanded}
				aria-label={isExpanded ? "Hide subagent handoff brief" : "Show subagent handoff brief"}
				className="flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-left text-[12px] transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
				data-slot="subagent-handoff-brief-toggle"
				onClick={() => setIsExpanded((current) => !current)}
				type="button"
			>
				{isExpanded ? (
					<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
				) : (
					<ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
				)}
				<div className="min-w-0 flex-1">
					<p className="font-medium text-foreground">Handoff brief</p>
					<p className="truncate text-[11px] text-muted-foreground">{preview}</p>
				</div>
			</button>
			{isExpanded ? (
				<div className="max-h-56 overflow-y-auto px-4 pb-3">
					<div className="grid gap-3">
						{visibleFields.map((field) => (
							<HandoffField key={field.label} label={field.label} value={field.value} />
						))}
					</div>
				</div>
			) : null}
		</section>
	);
}

function SubagentLoadingState() {
	return (
		<div className="grid h-full min-h-0 place-items-center px-6 text-center" data-slot="subagent-loading-state">
			<div className="grid justify-items-center gap-3">
				<Loader2 className="size-5 animate-spin text-muted-foreground" />
				<p className="text-[13px] text-muted-foreground">Loading subagent transcript...</p>
			</div>
		</div>
	);
}

function SubagentErrorState({ message }: { message: string }) {
	return (
		<div className="grid h-full min-h-0 place-items-center px-6 text-center" data-slot="subagent-error-state">
			<div className="max-w-sm text-[13px] leading-6 text-destructive">{message}</div>
		</div>
	);
}

export function SubagentDetailPane({ request, showThinkingBlocks = false }: SubagentDetailPaneProps) {
	const { errorMessage, isLoading, rendererState, snapshot } = useSubagentRuntime(request);
	const resource = snapshot?.resource;

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col bg-background" data-slot="subagent-detail-pane">
			<SubagentDetailHeader errorMessage={errorMessage} request={request} resource={resource} />
			{errorMessage ? (
				<SubagentErrorState message={errorMessage} />
			) : isLoading ? (
				<SubagentLoadingState />
			) : (
				<>
					<SubagentHandoffBrief resource={resource} />
					<div className={cn("min-h-0 min-w-0 flex-1", rendererState.isStreaming && "bg-muted/10")}>
						<MessageList
							bottomInset={18}
							emptyState={{
								label: "Subagent",
								title: "No transcript messages.",
								description: "The subagent has not persisted any runtime messages yet.",
							}}
							isStreaming={rendererState.isStreaming}
							messages={rendererState.messages}
							showThinkingBlocks={showThinkingBlocks}
							streamingMessage={rendererState.streamingMessage}
							toolCalls={rendererState.toolCalls}
						/>
					</div>
				</>
			)}
		</div>
	);
}
