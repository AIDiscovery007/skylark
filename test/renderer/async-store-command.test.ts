import { describe, expect, it } from "vitest";
import { runAsyncStoreCommand } from "../../src/renderer/lib/async-store-command.ts";

interface TestState {
	errorMessage?: string;
	isLoading: boolean;
	isSaving: boolean;
	value?: string;
}

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("runAsyncStoreCommand", () => {
	it("sets pending state and applies the success reducer", async () => {
		let state: TestState = { isLoading: false, isSaving: false };
		const deferred = createDeferred<string>();
		const command = runAsyncStoreCommand({
			applySuccess: (currentState, value) => ({ ...currentState, value }),
			command: () => deferred.promise,
			pendingKey: "isSaving",
			set: (update) => {
				state = update(state);
			},
		});

		expect(state).toEqual({ errorMessage: undefined, isLoading: false, isSaving: true });

		deferred.resolve("saved");
		await command;

		expect(state).toEqual({ errorMessage: undefined, isLoading: false, isSaving: false, value: "saved" });
	});

	it("clears pending state and stores a normalized error message on failure", async () => {
		let state: TestState = { isLoading: false, isSaving: false };

		const result = await runAsyncStoreCommand({
			applySuccess: (currentState, value: string) => ({ ...currentState, value }),
			command: async () => {
				throw new Error("save failed");
			},
			pendingKey: "isLoading",
			set: (update) => {
				state = update(state);
			},
		});

		expect(result).toBeUndefined();
		expect(state).toEqual({ errorMessage: "save failed", isLoading: false, isSaving: false });
	});
});
