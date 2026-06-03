import type { MessagePortMain } from "electron";
import type { DesktopAuthService } from "../auth/desktop-auth-service.ts";

export function openAuthStream(authService: DesktopAuthService, port: MessagePortMain): void {
	port.start();
	const unsubscribe = authService.subscribe((event) => {
		port.postMessage(event);
	});

	port.on("close", () => {
		unsubscribe();
	});
}
