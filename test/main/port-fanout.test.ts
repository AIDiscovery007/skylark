import { describe, expect, it, vi } from "vitest";
import { Listeners, PortFanout, type PortLike, pipeSubscriptionToPort } from "../../src/main/util/port-fanout.ts";

class FakePort implements PortLike<unknown> {
	readonly messages: unknown[] = [];
	readonly start = vi.fn();
	private closeListener?: () => void;

	on(_event: "close", listener: () => void): void {
		this.closeListener = listener;
	}

	postMessage(value: unknown): void {
		this.messages.push(value);
	}

	close(): void {
		this.closeListener?.();
	}
}

describe("Listeners", () => {
	it("emits values to subscribed listeners until they unsubscribe", () => {
		const listeners = new Listeners<string>();
		const first = vi.fn();
		const second = vi.fn();

		const unsubscribeFirst = listeners.subscribe(first);
		listeners.subscribe(second);
		listeners.emit("one");
		unsubscribeFirst();
		listeners.emit("two");

		expect(first).toHaveBeenCalledTimes(1);
		expect(first).toHaveBeenCalledWith("one");
		expect(second).toHaveBeenCalledTimes(2);
		expect(second).toHaveBeenLastCalledWith("two");
	});
});

describe("PortFanout", () => {
	it("publishes values to open ports and removes closed ports", () => {
		const fanout = new PortFanout<string>();
		const first = new FakePort();
		const second = new FakePort();

		fanout.add(first);
		fanout.add(second);
		fanout.publish("one");
		first.close();
		fanout.publish("two");

		expect(first.start).toHaveBeenCalledTimes(1);
		expect(second.start).toHaveBeenCalledTimes(1);
		expect(first.messages).toEqual(["one"]);
		expect(second.messages).toEqual(["one", "two"]);
		expect(fanout.size).toBe(1);
	});

	it("pipes a subscription to one port and unsubscribes when the port closes", () => {
		const listeners = new Listeners<number>();
		const port = new FakePort();

		pipeSubscriptionToPort((listener) => listeners.subscribe(listener), port);
		listeners.emit(1);
		port.close();
		listeners.emit(2);

		expect(port.start).toHaveBeenCalledTimes(1);
		expect(port.messages).toEqual([1]);
	});

	it("unsubscribes async subscriptions that resolve after the port closes", async () => {
		const port = new FakePort();
		const unsubscribe = vi.fn();
		let resolveSubscription: ((unsubscribe: () => void) => void) | undefined;

		const result = pipeSubscriptionToPort(
			() =>
				new Promise<() => void>((resolve) => {
					resolveSubscription = resolve;
				}),
			port,
		);
		port.close();
		resolveSubscription?.(unsubscribe);
		await result;

		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});
});
