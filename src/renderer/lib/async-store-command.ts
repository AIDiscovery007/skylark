import { getErrorMessage } from "../../shared/errors.ts";

export type AsyncStorePendingKey = "isLoading" | "isSaving";

export interface AsyncStoreCommandState {
	errorMessage?: string;
	isLoading: boolean;
	isSaving: boolean;
}

export type AsyncStoreSet<TState extends AsyncStoreCommandState> = (update: (state: TState) => TState) => void;

export interface AsyncStoreCommandOptions<TState extends AsyncStoreCommandState, TResult> {
	applyError?: (state: TState, message: string, error: unknown) => TState;
	applySuccess: (state: TState, result: TResult) => TState;
	command: () => Promise<TResult>;
	pendingKey: AsyncStorePendingKey;
	set: AsyncStoreSet<TState>;
}

function setPending<TState extends AsyncStoreCommandState>(
	state: TState,
	pendingKey: AsyncStorePendingKey,
	pending: boolean,
): TState {
	return {
		...state,
		[pendingKey]: pending,
		errorMessage: pending ? undefined : state.errorMessage,
	};
}

export async function runAsyncStoreCommand<TState extends AsyncStoreCommandState, TResult>({
	applyError,
	applySuccess,
	command,
	pendingKey,
	set,
}: AsyncStoreCommandOptions<TState, TResult>): Promise<TResult | undefined> {
	set((state) => setPending(state, pendingKey, true));

	try {
		const result = await command();
		set((state) => applySuccess(setPending(state, pendingKey, false), result));
		return result;
	} catch (error: unknown) {
		const message = getErrorMessage(error);
		set((state) => {
			const nextState = {
				...setPending(state, pendingKey, false),
				errorMessage: message,
			};
			return applyError ? applyError(nextState, message, error) : nextState;
		});
		return undefined;
	}
}
