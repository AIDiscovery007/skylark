import { useEffect, useMemo, useState } from "react";
import type { DesktopAgentBridge } from "../../shared/ipc-contract.ts";
import type {
	DesktopEnvironmentEvent,
	DesktopEnvironmentResource,
	DesktopEnvironmentResourceStatus,
	DesktopTaskProgress,
} from "../../shared/types.ts";

const ENVIRONMENT_VISIBLE_STATUSES = new Set<DesktopEnvironmentResourceStatus>([
	"completed",
	"failed",
	"running",
	"stale",
	"unknown",
]);

export interface WorkspaceStatusState {
	environmentResources: DesktopEnvironmentResource[];
	errorMessage?: string;
	isAvailable: boolean;
	progress?: DesktopTaskProgress;
	resources: DesktopEnvironmentResource[];
}

interface UseWorkspaceStatusOptions {
	activeSessionId?: string;
	cwd?: string;
	enabled?: boolean;
	progress?: DesktopTaskProgress;
}

function getDesktopAgentBridge(): DesktopAgentBridge | undefined {
	return (window as Partial<Window>).desktopAgent;
}

function getRelevantEnvironmentResources(
	resources: DesktopEnvironmentResource[],
	input: { cwd?: string; sessionId?: string },
): DesktopEnvironmentResource[] {
	const visible = resources.filter((resource) => ENVIRONMENT_VISIBLE_STATUSES.has(resource.status));
	const scoped = input.sessionId ? visible.filter((resource) => resource.sessionId === input.sessionId) : visible;
	const collapsed = collapseDuplicateTmuxResources(scoped);
	if (input.sessionId) {
		return collapsed;
	}
	if (!input.cwd) {
		return [];
	}
	return collapsed.filter((resource) => resource.cwd === input.cwd);
}

function collapseDuplicateTmuxResources(resources: DesktopEnvironmentResource[]): DesktopEnvironmentResource[] {
	const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
	const windowCountByParentId = new Map<string, number>();
	for (const resource of resources) {
		if (resource.kind !== "tmux_window" || !resource.parentId) {
			continue;
		}
		windowCountByParentId.set(resource.parentId, (windowCountByParentId.get(resource.parentId) ?? 0) + 1);
	}
	return resources.filter((resource) => {
		if (resource.kind === "tmux_window" && resource.parentId) {
			const siblingCount = windowCountByParentId.get(resource.parentId) ?? 0;
			return siblingCount !== 1 || !resourcesById.has(resource.parentId);
		}
		if (resource.kind === "tmux_session") {
			return (windowCountByParentId.get(resource.id) ?? 0) <= 1;
		}
		return true;
	});
}

function applyEnvironmentEvent(
	resources: DesktopEnvironmentResource[],
	event: DesktopEnvironmentEvent,
): DesktopEnvironmentResource[] {
	switch (event.type) {
		case "environment_resources_updated":
			return event.resources;
		case "environment_resource_detached":
			return resources.filter((resource) => resource.id !== event.resource.id);
	}
}

export function useWorkspaceStatus({
	activeSessionId,
	cwd,
	enabled = true,
	progress,
}: UseWorkspaceStatusOptions): WorkspaceStatusState {
	const [resources, setResources] = useState<DesktopEnvironmentResource[]>([]);
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		if (!enabled) {
			setResources([]);
			setErrorMessage(undefined);
			return;
		}

		const bridge = getDesktopAgentBridge();
		if (!bridge || typeof bridge.listEnvironmentResources !== "function") {
			setResources([]);
			setErrorMessage(undefined);
			return;
		}
		const listEnvironmentResources = bridge.listEnvironmentResources.bind(bridge);
		let isDisposed = false;

		async function refresh(): Promise<void> {
			try {
				const nextResources = await listEnvironmentResources(
					activeSessionId ? { sessionId: activeSessionId } : undefined,
				);
				if (isDisposed) {
					return;
				}
				setResources(nextResources);
				setErrorMessage(undefined);
			} catch (error) {
				if (isDisposed) {
					return;
				}
				setErrorMessage(error instanceof Error ? error.message : String(error));
			}
		}

		void refresh();
		const unsubscribe =
			typeof bridge.subscribeToEnvironmentEvents === "function"
				? bridge.subscribeToEnvironmentEvents((event) => {
						if (!isDisposed) {
							setResources((currentResources) => applyEnvironmentEvent(currentResources, event));
						}
					})
				: undefined;
		return () => {
			isDisposed = true;
			unsubscribe?.();
		};
	}, [activeSessionId, enabled]);

	const environmentResources = useMemo(
		() => getRelevantEnvironmentResources(resources, { cwd, sessionId: activeSessionId }),
		[activeSessionId, cwd, resources],
	);

	return {
		environmentResources,
		errorMessage,
		isAvailable: Boolean(progress || environmentResources.length > 0 || errorMessage),
		progress,
		resources,
	};
}
