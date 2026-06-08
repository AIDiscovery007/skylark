import { describe, expect, it, vi } from "vitest";
import { runBridgeCommand } from "../../src/renderer/lib/bridge-command.ts";

describe("runBridgeCommand", () => {
	it("returns command results", async () => {
		await expect(runBridgeCommand({ command: async () => "ok", onError: vi.fn() })).resolves.toBe("ok");
	});

	it("reports normalized errors and rethrows by default", async () => {
		const onError = vi.fn();

		await expect(
			runBridgeCommand({
				command: async () => {
					throw new Error("bridge failed");
				},
				onError,
			}),
		).rejects.toThrow("bridge failed");
		expect(onError).toHaveBeenCalledWith("bridge failed", expect.any(Error));
	});

	it("can report errors without rethrowing", async () => {
		const onError = vi.fn();

		const result = await runBridgeCommand({
			command: async () => {
				throw "bridge failed";
			},
			onError,
			rethrow: false,
		});

		expect(result).toBeUndefined();
		expect(onError).toHaveBeenCalledWith("bridge failed", "bridge failed");
	});
});
