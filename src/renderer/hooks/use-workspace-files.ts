import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getErrorMessage } from "../../shared/errors.ts";
import type { DesktopAgentBridge } from "../../shared/ipc-contract.ts";
import type {
	DesktopWorkspaceFileEntry,
	DesktopWorkspaceFileListRequest,
	DesktopWorkspaceFileListResult,
} from "../../shared/types.ts";

export type WorkspaceFileListStatus = "idle" | "loading" | "loaded" | "error";

export interface UseWorkspaceFilesOptions {
	enabled: boolean;
	includeSessionIdWithProject?: boolean;
	limit: number;
	missingBridgeMessage?: string;
	projectId?: string;
	sessionId?: string;
	unavailableMessage?: string;
}

export interface UseWorkspaceFilesResult {
	errorMessage?: string;
	files: DesktopWorkspaceFileEntry[];
	refresh: () => Promise<void>;
	result?: DesktopWorkspaceFileListResult;
	status: WorkspaceFileListStatus;
}

function createWorkspaceFileListRequest({
	includeSessionIdWithProject = false,
	limit,
	projectId,
	sessionId,
}: Pick<UseWorkspaceFilesOptions, "includeSessionIdWithProject" | "limit" | "projectId" | "sessionId">):
	| DesktopWorkspaceFileListRequest
	| undefined {
	if (!projectId && !sessionId) {
		return undefined;
	}
	return {
		...(projectId ? { projectId } : {}),
		...(sessionId && (!projectId || includeSessionIdWithProject) ? { sessionId } : {}),
		limit,
	};
}

function getWorkspaceFileListRequestKey(request: DesktopWorkspaceFileListRequest | undefined): string {
	if (!request) {
		return "none";
	}
	return `project:${request.projectId ?? ""}\u0000session:${request.sessionId ?? ""}\u0000limit:${request.limit}`;
}

export function useWorkspaceFiles({
	enabled,
	includeSessionIdWithProject,
	limit,
	missingBridgeMessage = "Restart Skylark to enable workspace file listing.",
	projectId,
	sessionId,
	unavailableMessage = "Workspace is unavailable.",
}: UseWorkspaceFilesOptions): UseWorkspaceFilesResult {
	const [result, setResult] = useState<DesktopWorkspaceFileListResult | undefined>();
	const [status, setStatus] = useState<WorkspaceFileListStatus>("idle");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();
	const requestIdRef = useRef(0);
	const previousRequestKeyRef = useRef<string | undefined>(undefined);
	const request = useMemo(
		() => createWorkspaceFileListRequest({ includeSessionIdWithProject, limit, projectId, sessionId }),
		[includeSessionIdWithProject, limit, projectId, sessionId],
	);
	const requestKey = getWorkspaceFileListRequestKey(request);

	const refresh = useCallback(async (): Promise<void> => {
		if (!enabled) {
			return;
		}

		const desktopBridge = (window as Partial<Window>).desktopAgent as Partial<DesktopAgentBridge> | undefined;
		if (typeof desktopBridge?.listWorkspaceFiles !== "function") {
			requestIdRef.current += 1;
			setStatus("error");
			setErrorMessage(missingBridgeMessage);
			return;
		}
		if (!request) {
			requestIdRef.current += 1;
			setResult(undefined);
			setStatus("error");
			setErrorMessage(unavailableMessage);
			return;
		}

		const requestId = ++requestIdRef.current;
		setStatus("loading");
		setErrorMessage(undefined);
		try {
			const nextResult = await desktopBridge.listWorkspaceFiles(request);
			if (requestId !== requestIdRef.current) {
				return;
			}
			setResult(nextResult);
			setStatus(nextResult.errorMessage ? "error" : "loaded");
			setErrorMessage(nextResult.errorMessage);
		} catch (error: unknown) {
			if (requestId !== requestIdRef.current) {
				return;
			}
			setStatus("error");
			setErrorMessage(getErrorMessage(error));
		}
	}, [enabled, missingBridgeMessage, request, unavailableMessage]);

	useEffect(() => {
		if (previousRequestKeyRef.current === requestKey) {
			return;
		}
		previousRequestKeyRef.current = requestKey;
		requestIdRef.current += 1;
		setResult(undefined);
		setStatus("idle");
		setErrorMessage(undefined);
	}, [requestKey]);

	useEffect(() => {
		if (!enabled || status !== "idle") {
			return;
		}
		void refresh();
	}, [enabled, refresh, status]);

	return {
		errorMessage,
		files: result?.files ?? [],
		refresh,
		result,
		status,
	};
}
