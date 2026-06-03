import { join } from "node:path";
import skylarkRelease from "../../Skylark-release.json";

export interface SkylarkReleaseMetadata {
	productName: string;
	appId: string;
	version: string;
	buildVersion: string;
}

export const SKYLARK_RELEASE = skylarkRelease as SkylarkReleaseMetadata;

export const DESKTOP_PRODUCT_NAME = SKYLARK_RELEASE.productName;
export const DESKTOP_DEVELOPMENT_USER_DATA_NAME = `${DESKTOP_PRODUCT_NAME} Development`;

export const DESKTOP_ABOUT_CREDITS = [
	`${DESKTOP_PRODUCT_NAME} is based on badlogic/pi-mono.`,
	"pi-mono is Copyright (c) 2025 Mario Zechner and licensed under the MIT License.",
	"https://github.com/badlogic/pi-mono",
].join("\n");

export const DESKTOP_ABOUT_COPYRIGHT = "Based on pi-mono (MIT).";

export interface DesktopIdentityApp {
	getPath(name: "appData"): string;
	isPackaged?: boolean;
	setName(name: string): void;
	setPath(name: "userData", path: string): void;
}

export interface DesktopVersionProvider {
	getVersion(): string;
}

function resolveAppDataPath(app: DesktopIdentityApp): string {
	return process.env.SKYLARK_APP_DATA_DIR?.trim() || app.getPath("appData");
}

export function buildDesktopAboutPanelOptions(app: DesktopVersionProvider): {
	applicationName: string;
	applicationVersion: string;
	copyright: string;
	credits: string;
	version: string;
} {
	const version = app.getVersion();
	return {
		applicationName: DESKTOP_PRODUCT_NAME,
		applicationVersion: version,
		copyright: DESKTOP_ABOUT_COPYRIGHT,
		credits: DESKTOP_ABOUT_CREDITS,
		version,
	};
}

export function installDesktopApplicationIdentity(app: DesktopIdentityApp): void {
	app.setName(DESKTOP_PRODUCT_NAME);
	const userDataName = app.isPackaged === true ? DESKTOP_PRODUCT_NAME : DESKTOP_DEVELOPMENT_USER_DATA_NAME;
	app.setPath("userData", join(resolveAppDataPath(app), userDataName));
}
