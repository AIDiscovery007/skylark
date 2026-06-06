import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildDesktopAboutPanelOptions,
	DESKTOP_PRODUCT_NAME,
	installDesktopApplicationIdentity,
	SKYLARK_RELEASE,
} from "../../src/main/app-identity.ts";

describe("desktop application identity", () => {
	const originalSkylarkAppDataDir = process.env.SKYLARK_APP_DATA_DIR;

	afterEach(() => {
		if (originalSkylarkAppDataDir === undefined) {
			delete process.env.SKYLARK_APP_DATA_DIR;
		} else {
			process.env.SKYLARK_APP_DATA_DIR = originalSkylarkAppDataDir;
		}
	});

	it("uses Skylark release metadata as the packaged desktop app version source", () => {
		expect(SKYLARK_RELEASE).toEqual({
			appId: "com.qiaochao.skylark",
			buildVersion: "0.3.2",
			productName: "Skylark",
			version: "0.3.2",
		});
		expect(DESKTOP_PRODUCT_NAME).toBe("Skylark");
	});

	it("builds About panel options from the active Electron app version", () => {
		const app = { getVersion: vi.fn(() => "0.3.0") };

		expect(buildDesktopAboutPanelOptions(app)).toMatchObject({
			applicationName: "Skylark",
			applicationVersion: "0.3.0",
			copyright: "Based on pi-mono (MIT).",
			credits: expect.stringContaining("badlogic/pi-mono"),
			version: "0.3.0",
		});
		expect(app.getVersion).toHaveBeenCalled();
	});

	it("sets the packaged app name and user data directory", () => {
		const app = {
			getPath: vi.fn((name: "appData") => {
				expect(name).toBe("appData");
				return "/Users/test/Library/Application Support";
			}),
			isPackaged: true,
			setName: vi.fn(),
			setPath: vi.fn(),
		};

		installDesktopApplicationIdentity(app);

		expect(app.setName).toHaveBeenCalledWith(DESKTOP_PRODUCT_NAME);
		expect(app.setPath).toHaveBeenCalledWith("userData", "/Users/test/Library/Application Support/Skylark");
	});

	it("keeps local development user data separate from packaged releases", () => {
		const app = {
			getPath: vi.fn(() => "/Users/test/Library/Application Support"),
			isPackaged: false,
			setName: vi.fn(),
			setPath: vi.fn(),
		};

		installDesktopApplicationIdentity(app);

		expect(app.setPath).toHaveBeenCalledWith(
			"userData",
			"/Users/test/Library/Application Support/Skylark Development",
		);
	});

	it("allows isolated app data roots for desktop smoke tests", () => {
		process.env.SKYLARK_APP_DATA_DIR = "/tmp/skylark-app-data";
		const app = {
			getPath: vi.fn(() => "/Users/test/Library/Application Support"),
			isPackaged: false,
			setName: vi.fn(),
			setPath: vi.fn(),
		};

		installDesktopApplicationIdentity(app);

		expect(app.getPath).not.toHaveBeenCalled();
		expect(app.setPath).toHaveBeenCalledWith("userData", "/tmp/skylark-app-data/Skylark Development");
	});
});
