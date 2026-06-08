import { afterEach, describe, expect, it } from "vitest";
import { resolveDesktopAgentBridge } from "../../src/renderer/lib/desktop-agent-bridge.ts";
import {
	installRendererDesktopAgentBridge,
	removeRendererDesktopAgentBridge,
} from "../support/renderer-desktop-agent-bridge.ts";

describe("resolveDesktopAgentBridge", () => {
	afterEach(() => {
		removeRendererDesktopAgentBridge();
	});

	it("prefers an explicit bridge", () => {
		const bridge = { getSettings: async () => ({}) };

		expect(resolveDesktopAgentBridge(bridge)).toBe(bridge);
	});

	it("falls back to the window bridge", () => {
		const bridge = installRendererDesktopAgentBridge({ getSettings: async () => ({}) });

		expect(resolveDesktopAgentBridge<typeof bridge>(undefined)).toBe(bridge);
	});
});
