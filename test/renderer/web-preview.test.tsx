import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	WebPreview,
	WebPreviewBody,
	WebPreviewConsole,
	WebPreviewNavigation,
	WebPreviewUrl,
} from "../../src/renderer/components/ai-elements/web-preview.tsx";

afterEach(() => {
	cleanup();
});

describe("WebPreview", () => {
	it("updates the preview url from the address input", async () => {
		const user = userEvent.setup();
		const onUrlChange = vi.fn();

		render(
			<WebPreview defaultUrl="http://localhost:3000/" onUrlChange={onUrlChange}>
				<WebPreviewNavigation>
					<WebPreviewUrl aria-label="Preview URL" />
				</WebPreviewNavigation>
				<WebPreviewBody title="Preview frame" />
			</WebPreview>,
		);

		const frame = screen.getByTitle("Preview frame");
		expect(frame.getAttribute("sandbox")).toContain("allow-popups");
		expect(frame.getAttribute("sandbox")).toContain("allow-presentation");
		expect(frame.getAttribute("src")).toBe("http://localhost:3000/");

		await user.clear(screen.getByLabelText("Preview URL"));
		await user.type(screen.getByLabelText("Preview URL"), "http://localhost:3001/{Enter}");

		expect(onUrlChange).toHaveBeenCalledWith("http://localhost:3001/");
		await waitFor(() => {
			expect(screen.getByTitle("Preview frame").getAttribute("src")).toBe("http://localhost:3001/");
		});
	});

	it("replaces the address after clicking the current URL", async () => {
		const user = userEvent.setup();

		render(
			<WebPreview defaultUrl="https://youtube.com/">
				<WebPreviewNavigation>
					<WebPreviewUrl aria-label="Preview URL" />
				</WebPreviewNavigation>
			</WebPreview>,
		);

		const urlInput = screen.getByLabelText("Preview URL") as HTMLInputElement;
		await user.click(urlInput);
		expect(urlInput.selectionStart).toBe(0);
		expect(urlInput.selectionEnd).toBe("https://youtube.com/".length);
		await user.keyboard("google");

		expect(urlInput.value).toBe("google");
	});

	it("renders collapsible console logs", async () => {
		const user = userEvent.setup();

		render(
			<WebPreview>
				<WebPreviewConsole
					logs={[
						{
							level: "warn",
							message: "Deprecated API usage detected",
							timestamp: new Date("2026-06-01T08:00:00.000Z"),
						},
						{
							level: "error",
							message: "Failed to load resource",
							timestamp: new Date("2026-06-01T08:00:01.000Z"),
						},
					]}
				/>
			</WebPreview>,
		);

		const consoleButton = screen.getByRole("button", { name: "Console" });
		expect(consoleButton.getAttribute("aria-expanded")).toBe("false");

		await user.click(consoleButton);

		expect(consoleButton.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("Deprecated API usage detected")).toBeTruthy();
		expect(screen.getByText("Failed to load resource")).toBeTruthy();
	});
});
