import { type DependencyList, useEffect } from "react";

export type ResourceUnsubscribe = () => void;
export type ResourceSubscribe<TEvent> = (onEvent: (event: TEvent) => void) => ResourceUnsubscribe | undefined;

export function useSubscribedResource<TEvent>(
	subscribe: ResourceSubscribe<TEvent> | undefined,
	onEvent: (event: TEvent) => void,
	deps: DependencyList,
): void {
	useEffect(() => {
		if (!subscribe) {
			return undefined;
		}

		return subscribe(onEvent);
		// biome-ignore lint/correctness/useExhaustiveDependencies: callers provide the subscription dependency list.
	}, deps);
}
