import { describe, expect, it } from "vitest";
import {
	isDesktopLoopbackWebPreviewUrl,
	isDesktopStaticWebPreviewUrl,
	normalizeDesktopWebPreviewUrl,
} from "../../src/shared/preview-url.ts";

describe("preview-url", () => {
	it("normalizes loopback web preview urls", () => {
		expect(normalizeDesktopWebPreviewUrl("localhost:3000")).toBe("http://localhost:3000/");
		expect(normalizeDesktopWebPreviewUrl("http://127.0.0.1:5173/app?x=1#top")).toBe(
			"http://127.0.0.1:5173/app?x=1#top",
		);
		expect(normalizeDesktopWebPreviewUrl("https://[::1]:4173")).toBe("https://[::1]:4173/");
		expect(isDesktopLoopbackWebPreviewUrl("http://localhost:3000/")).toBe(true);
	});

	it("normalizes public web preview urls", () => {
		expect(normalizeDesktopWebPreviewUrl("https://example.com")).toBe("https://example.com/");
		expect(normalizeDesktopWebPreviewUrl("google.com")).toBe("https://google.com/");
		expect(normalizeDesktopWebPreviewUrl("google")).toBe("https://google.com/");
		expect(normalizeDesktopWebPreviewUrl("youtube/watch?v=abc123")).toBe("https://youtube.com/watch?v=abc123");
		expect(normalizeDesktopWebPreviewUrl("https://youtube")).toBe("https://youtube.com/");
		expect(normalizeDesktopWebPreviewUrl("http://youtube/")).toBe("http://youtube.com/");
		expect(normalizeDesktopWebPreviewUrl("http://localhost")).toBe("http://localhost/");
		expect(normalizeDesktopWebPreviewUrl("http://192.168.0.2:3000")).toBe("http://192.168.0.2:3000/");
		expect(isDesktopLoopbackWebPreviewUrl("https://example.com/")).toBe(false);
	});

	it("accepts static local preview urls", () => {
		expect(normalizeDesktopWebPreviewUrl("skylark-preview://session/index.html")).toBe(
			"skylark-preview://session/index.html",
		);
		expect(isDesktopStaticWebPreviewUrl("skylark-preview://session/index.html")).toBe(true);
	});

	it("rejects credentialed and unsupported urls", () => {
		expect(normalizeDesktopWebPreviewUrl("http://user:pass@localhost:3000")).toBeUndefined();
		expect(normalizeDesktopWebPreviewUrl("skylark-preview://user:pass@session/index.html")).toBeUndefined();
		expect(normalizeDesktopWebPreviewUrl("file:///tmp/index.html")).toBeUndefined();
	});
});
