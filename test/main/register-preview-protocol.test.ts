import { describe, expect, it, vi } from "vitest";
import type { DesktopPreviewProtocolService } from "../../src/main/preview/preview-protocol-service.ts";
import { registerDesktopPreviewProtocolHandler } from "../../src/main/preview/register-preview-protocol.ts";

vi.mock("electron", () => ({
	protocol: {
		handle: vi.fn(),
		registerSchemesAsPrivileged: vi.fn(),
	},
}));

describe("registerDesktopPreviewProtocolHandler", () => {
	it("registers skylark-preview on an injected protocol registry", async () => {
		const response = new Response("ok");
		const service = {
			handleRequest: vi.fn(async () => response),
		};
		const registry = {
			handle: vi.fn(),
		};

		registerDesktopPreviewProtocolHandler(service as unknown as DesktopPreviewProtocolService, registry);

		expect(registry.handle).toHaveBeenCalledWith("skylark-preview", expect.any(Function));
		const handler = registry.handle.mock.calls[0]?.[1];
		const request = new Request("skylark-preview://session/index.html");
		await expect(handler?.(request)).resolves.toBe(response);
		expect(service.handleRequest).toHaveBeenCalledWith(request);
	});
});
