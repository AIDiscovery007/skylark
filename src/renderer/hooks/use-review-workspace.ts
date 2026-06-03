import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopReviewSnapshot, DesktopReviewSnapshotRequest } from "../../shared/types.ts";

export interface UseReviewWorkspaceOptions {
	open: boolean;
	projectId?: string;
	sessionId?: string;
}

export interface UseReviewWorkspaceResult {
	errorMessage?: string;
	isLoading: boolean;
	refresh: () => Promise<void>;
	request?: DesktopReviewSnapshotRequest;
	snapshot?: DesktopReviewSnapshot;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useReviewWorkspace({
	open,
	projectId,
	sessionId,
}: UseReviewWorkspaceOptions): UseReviewWorkspaceResult {
	const [snapshot, setSnapshot] = useState<DesktopReviewSnapshot | undefined>();
	const [isLoading, setIsLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | undefined>();
	const previousRequestKeyRef = useRef<string | undefined>(undefined);
	const refreshRequestIdRef = useRef(0);
	const request = useMemo<DesktopReviewSnapshotRequest | undefined>(() => {
		if (projectId) {
			return { projectId };
		}
		if (sessionId) {
			return { sessionId };
		}
		return undefined;
	}, [projectId, sessionId]);
	const requestKey = request?.projectId ? `project:${request.projectId}` : `session:${request?.sessionId ?? "none"}`;

	const refresh = useCallback(async () => {
		if (!open || !request) {
			return;
		}

		const refreshRequestId = ++refreshRequestIdRef.current;
		setIsLoading(true);
		setErrorMessage(undefined);
		try {
			const nextSnapshot = await window.desktopAgent.getReviewSnapshot(request);
			if (refreshRequestId === refreshRequestIdRef.current) {
				setSnapshot(nextSnapshot);
			}
		} catch (error: unknown) {
			if (refreshRequestId === refreshRequestIdRef.current) {
				setErrorMessage(getErrorMessage(error));
			}
		} finally {
			if (refreshRequestId === refreshRequestIdRef.current) {
				setIsLoading(false);
			}
		}
	}, [open, request]);

	useEffect(() => {
		if (previousRequestKeyRef.current === requestKey) {
			return;
		}
		previousRequestKeyRef.current = requestKey;
		refreshRequestIdRef.current += 1;
		setSnapshot(undefined);
		setErrorMessage(undefined);
		setIsLoading(false);
	}, [requestKey]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (!open) {
			return undefined;
		}

		const unsubscribe = window.desktopAgent.subscribeToAgentEvents((event) => {
			if (event.type === "agent_end" && (!sessionId || event.sessionId === sessionId)) {
				void refresh();
			}
		});
		return unsubscribe;
	}, [open, refresh, sessionId]);

	return {
		errorMessage,
		isLoading: isLoading || (open && Boolean(request) && !snapshot && !errorMessage),
		refresh,
		request,
		snapshot,
	};
}
