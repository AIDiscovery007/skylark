import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getErrorMessage } from "../../shared/errors.ts";
import type { SerializedAgentEvent } from "../../shared/serialized-agent-event.ts";
import type { DesktopReviewFile, DesktopReviewSnapshot, DesktopReviewSnapshotRequest } from "../../shared/types.ts";
import { useSubscribedResource } from "./use-subscribed-resource.ts";

export interface UseReviewWorkspaceOptions {
	open: boolean;
	projectId?: string;
	sessionId?: string;
}

export interface UseReviewWorkspaceResult {
	errorMessage?: string;
	isLoading: boolean;
	loadFilePatch: (path: string) => Promise<DesktopReviewFile | undefined>;
	refresh: () => Promise<void>;
	request?: DesktopReviewSnapshotRequest;
	snapshot?: DesktopReviewSnapshot;
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

	const loadFilePatch = useCallback(
		async (path: string): Promise<DesktopReviewFile | undefined> => {
			if (!open || !request) {
				return undefined;
			}
			const refreshRequestId = refreshRequestIdRef.current;
			try {
				const file = await window.desktopAgent.getReviewFilePatch({ ...request, path });
				if (refreshRequestId !== refreshRequestIdRef.current) {
					return undefined;
				}
				setSnapshot((currentSnapshot) => {
					if (!currentSnapshot?.files.some((entry) => entry.path === file.path)) {
						return currentSnapshot;
					}
					return {
						...currentSnapshot,
						files: currentSnapshot.files.map((entry) =>
							entry.path === file.path ? { ...entry, ...file } : entry,
						),
					};
				});
				return file;
			} catch {
				return undefined;
			}
		},
		[open, request],
	);

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

	useSubscribedResource<SerializedAgentEvent>(
		(onEvent) => (open ? window.desktopAgent.subscribeToAgentEvents(onEvent) : undefined),
		(event) => {
			if (event.type === "agent_end" && (!sessionId || event.sessionId === sessionId)) {
				void refresh();
			}
		},
		[open, refresh, sessionId],
	);

	return {
		errorMessage,
		isLoading: isLoading || (open && Boolean(request) && !snapshot && !errorMessage),
		loadFilePatch,
		refresh,
		request,
		snapshot,
	};
}
