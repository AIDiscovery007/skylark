import { vi } from "vitest";
import type { DesktopAgentBridge } from "../../src/shared/ipc-contract.ts";

export function installRendererDesktopAgentBridge<TBridge extends Partial<DesktopAgentBridge>>(
	bridge: TBridge,
): TBridge {
	Object.defineProperty(window, "desktopAgent", {
		configurable: true,
		value: bridge,
	});
	return bridge;
}

export function removeRendererDesktopAgentBridge(): void {
	Reflect.deleteProperty(window, "desktopAgent");
}

export function createRendererBridgeEventChannel<TEvent>() {
	const listeners = new Set<(event: TEvent) => void>();

	return {
		emit(event: TEvent): void {
			for (const listener of listeners) {
				listener(event);
			}
		},
		subscribe: vi.fn((listener: (event: TEvent) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}),
	};
}
