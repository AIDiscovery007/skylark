export function resolveDesktopAgentBridge<TBridge>(bridge: TBridge | undefined): TBridge {
	return bridge ?? (window.desktopAgent as TBridge);
}
