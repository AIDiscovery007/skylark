export interface PortLike<T> {
	start(): void;
	on(event: "close", listener: () => void): void;
	postMessage(value: T): void;
}

export class Listeners<T> {
	private readonly listeners = new Set<(value: T) => void>();

	subscribe(listener: (value: T) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(value: T): void {
		for (const listener of this.listeners) {
			listener(value);
		}
	}

	clear(): void {
		this.listeners.clear();
	}

	get size(): number {
		return this.listeners.size;
	}
}

export class PortFanout<T> {
	private readonly ports = new Set<PortLike<T>>();

	add(port: PortLike<T>): void {
		this.ports.add(port);
		port.start();
		port.on("close", () => {
			this.ports.delete(port);
		});
	}

	publish(value: T): void {
		for (const port of this.ports) {
			port.postMessage(value);
		}
	}

	get size(): number {
		return this.ports.size;
	}
}

export function pipeSubscriptionToPort<T>(
	subscribe: (listener: (value: T) => void) => (() => void) | Promise<() => void>,
	port: PortLike<T>,
): Promise<void> | void {
	port.start();
	let closed = false;
	let unsubscribe: (() => void) | undefined;
	port.on("close", () => {
		closed = true;
		unsubscribe?.();
	});

	const subscription = subscribe((value) => {
		port.postMessage(value);
	});
	if (subscription instanceof Promise) {
		return subscription.then((resolvedUnsubscribe) => {
			if (closed) {
				resolvedUnsubscribe();
				return;
			}
			unsubscribe = resolvedUnsubscribe;
		});
	}
	unsubscribe = subscription;
	if (closed) {
		unsubscribe();
	}
}
