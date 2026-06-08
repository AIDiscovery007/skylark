import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNowTicker } from "../../src/renderer/hooks/use-now-ticker.ts";

const getNowMs = () => Date.now();

function NowTickerHarness({ enabled = true, resetKey }: { enabled?: boolean; resetKey?: string }) {
	const now = useNowTicker({ enabled, getNow: getNowMs, intervalMs: 1000, resetKey });
	return <output>{now}</output>;
}

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("useNowTicker", () => {
	it("ticks while enabled", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
		render(<NowTickerHarness />);

		expect(screen.getByRole("status").textContent).toBe("1000");

		act(() => {
			vi.advanceTimersByTime(1000);
		});

		expect(screen.getByRole("status").textContent).toBe("2000");
	});

	it("refreshes immediately when resetKey changes", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
		const { rerender } = render(<NowTickerHarness resetKey="one" />);

		vi.setSystemTime(5000);
		rerender(<NowTickerHarness resetKey="two" />);

		expect(screen.getByRole("status").textContent).toBe("5000");
	});

	it("does not create an interval while disabled", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
		render(<NowTickerHarness enabled={false} />);

		act(() => {
			vi.setSystemTime(2000);
			vi.advanceTimersByTime(1000);
		});

		expect(screen.getByRole("status").textContent).toBe("1000");
	});
});
