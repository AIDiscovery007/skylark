import { getErrorMessage } from "../../shared/errors.ts";

export interface BridgeCommandOptions<TResult> {
	command: () => Promise<TResult>;
	onError: (message: string, error: unknown) => void;
	rethrow?: boolean;
}

export function runBridgeCommand<TResult>(
	options: Omit<BridgeCommandOptions<TResult>, "rethrow"> & { rethrow: false },
): Promise<TResult | undefined>;
export function runBridgeCommand<TResult>(
	options: Omit<BridgeCommandOptions<TResult>, "rethrow"> & { rethrow?: true },
): Promise<TResult>;
export async function runBridgeCommand<TResult>({
	command,
	onError,
	rethrow = true,
}: BridgeCommandOptions<TResult>): Promise<TResult | undefined> {
	try {
		return await command();
	} catch (error: unknown) {
		onError(getErrorMessage(error), error);
		if (rethrow) {
			throw error;
		}
		return undefined;
	}
}
