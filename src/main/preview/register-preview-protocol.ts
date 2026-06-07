import { protocol } from "electron";
import { DESKTOP_PREVIEW_PROTOCOL_SCHEME, type DesktopPreviewProtocolService } from "./preview-protocol-service.ts";

interface DesktopPreviewProtocolRegistry {
	handle(scheme: string, handler: (request: Request) => Promise<Response>): void;
}

export function registerDesktopPreviewProtocolSchemePrivileges(): void {
	protocol.registerSchemesAsPrivileged([
		{
			privileges: {
				secure: true,
				standard: true,
				supportFetchAPI: true,
			},
			scheme: DESKTOP_PREVIEW_PROTOCOL_SCHEME,
		},
	]);
}

export function registerDesktopPreviewProtocolHandler(
	service: DesktopPreviewProtocolService,
	registry: DesktopPreviewProtocolRegistry = protocol,
): void {
	registry.handle(DESKTOP_PREVIEW_PROTOCOL_SCHEME, (request) => service.handleRequest(request));
}
