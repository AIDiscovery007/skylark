import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { DesktopApprovalEvent, DesktopApprovalRequest } from "../../shared/types.ts";

interface ApprovalStoreState {
	errorMessage?: string;
	requests: DesktopApprovalRequest[];
	applyApprovalEvent: (event: DesktopApprovalEvent) => void;
	clearApprovalError: () => void;
	removeApprovalRequest: (requestId: string) => void;
	resetApprovals: () => void;
	setApprovalError: (message: string) => void;
}

export function createApprovalStore() {
	return createStore<ApprovalStoreState>()((set) => ({
		errorMessage: undefined,
		requests: [],
		applyApprovalEvent: (event) => {
			set((state) => {
				if (event.type === "approval_requested") {
					return {
						errorMessage: undefined,
						requests: state.requests.some((request) => request.id === event.request.id)
							? state.requests
							: [...state.requests, event.request],
					};
				}

				return {
					...state,
					requests: state.requests.filter((request) => request.id !== event.decision.requestId),
				};
			});
		},
		clearApprovalError: () => set((state) => ({ ...state, errorMessage: undefined })),
		removeApprovalRequest: (requestId) =>
			set((state) => ({
				...state,
				errorMessage: undefined,
				requests: state.requests.filter((request) => request.id !== requestId),
			})),
		resetApprovals: () => set((state) => ({ ...state, errorMessage: undefined, requests: [] })),
		setApprovalError: (message) => set((state) => ({ ...state, errorMessage: message })),
	}));
}

export const approvalStore = createApprovalStore();

export function useApprovalStore<T>(selector: (state: ApprovalStoreState) => T): T {
	return useStore(approvalStore, selector);
}
