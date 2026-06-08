import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSubscribedResource } from "../../src/renderer/hooks/use-subscribed-resource.ts";

type Listener = (event: string) => void;

function TestSubscription({
	enabled = true,
	onEvent,
	subscribe,
	token,
}: {
	enabled?: boolean;
	onEvent: Listener;
	subscribe: (listener: Listener) => () => void;
	token: string;
}): null {
	useSubscribedResource(enabled ? subscribe : undefined, onEvent, [enabled, subscribe, onEvent, token]);
	return null;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("useSubscribedResource", () => {
	it("subscribes, forwards events, and cleans up when dependencies change", () => {
		let listener: Listener | undefined;
		const unsubscribe = vi.fn();
		const subscribe = vi.fn((nextListener: Listener) => {
			listener = nextListener;
			return unsubscribe;
		});
		const onEvent = vi.fn();

		const { rerender } = render(<TestSubscription onEvent={onEvent} subscribe={subscribe} token="one" />);
		listener?.("first");

		expect(subscribe).toHaveBeenCalledTimes(1);
		expect(onEvent).toHaveBeenCalledWith("first");

		rerender(<TestSubscription onEvent={onEvent} subscribe={subscribe} token="two" />);

		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(subscribe).toHaveBeenCalledTimes(2);

		cleanup();

		expect(unsubscribe).toHaveBeenCalledTimes(2);
	});

	it("skips the subscription when disabled", () => {
		const subscribe = vi.fn(() => vi.fn());

		render(<TestSubscription enabled={false} onEvent={vi.fn()} subscribe={subscribe} token="one" />);

		expect(subscribe).not.toHaveBeenCalled();
	});
});
