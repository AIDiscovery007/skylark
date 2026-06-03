import { describe, expect, it, vi } from "vitest";
import { submitComposerPrompt } from "../../src/renderer/components/chat/Composer.tsx";

function createDeferredPromise<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return { promise, resolve, reject };
}

describe("submitComposerPrompt", () => {
	it("clears the local draft before awaiting the submitted prompt", async () => {
		const deferred = createDeferredPromise<void>();
		const events: string[] = [];

		const submission = submitComposerPrompt({
			text: " 能找到我本地的obsidian ",
			onSubmitPrompt: async (text) => {
				events.push(`submit:${text}`);
				await deferred.promise;
			},
			clearDraft: () => events.push("clear"),
			restoreDraft: (text) => events.push(`restore:${text}`),
			setSubmitting: (isSubmitting) => events.push(`submitting:${isSubmitting}`),
		});

		expect(events).toEqual(["submitting:true", "clear", "submit:能找到我本地的obsidian"]);

		deferred.resolve();
		await submission;

		expect(events).toEqual(["submitting:true", "clear", "submit:能找到我本地的obsidian", "submitting:false"]);
	});

	it("restores the previous draft when prompt submission fails", async () => {
		await expect(
			submitComposerPrompt({
				text: "能渲染出来么",
				onSubmitPrompt: async () => {
					throw new Error("prompt failed");
				},
				clearDraft: vi.fn(),
				restoreDraft: vi.fn(),
				setSubmitting: vi.fn(),
			}),
		).rejects.toThrow("prompt failed");
	});

	it("preserves the original draft when prompt submission fails", async () => {
		const restoreDraft = vi.fn();

		await expect(
			submitComposerPrompt({
				text: "  能渲染出来么  ",
				onSubmitPrompt: async () => {
					throw new Error("prompt failed");
				},
				clearDraft: vi.fn(),
				restoreDraft,
				setSubmitting: vi.fn(),
			}),
		).rejects.toThrow("prompt failed");

		expect(restoreDraft).toHaveBeenCalledWith("  能渲染出来么  ");
	});
});
