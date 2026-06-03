const skylarkRelease = require("./Skylark-release.json");

const { appId, buildVersion, productName, version } = skylarkRelease;
const artifactName = "$" + "{productName}-$" + "{version}-mac-$" + "{arch}.$" + "{ext}";
const dmgTitle = "$" + "{productName} $" + "{version}";

const externalRuntimeResources = [
	{
		from: "node_modules/jiti",
		to: "node_modules/jiti",
		filter: ["dist/**", "lib/**", "package.json", "LICENSE", "README.md"],
	},
	{
		from: "node_modules/std-env",
		to: "node_modules/std-env",
		filter: ["dist/**", "package.json", "LICENCE", "README.md"],
	},
	{
		from: "node_modules/undici",
		to: "node_modules/undici",
		filter: ["index.js", "index-fetch.js", "lib/**", "types/**", "package.json", "LICENSE", "README.md"],
	},
	{
		from: "node_modules/node-pty",
		to: "node_modules/node-pty",
		filter: ["lib/**", "prebuilds/darwin-arm64/**", "package.json", "LICENSE", "typings/**"],
	},
];

module.exports = {
	appId,
	productName,
	artifactName,
	asar: true,
	asarUnpack: ["node_modules/node-pty/**/*.node", "node_modules/node-pty/**/spawn-helper"],
	buildDependenciesFromSource: false,
	compression: "normal",
	copyright:
		"Skylark is based on badlogic/pi-mono. pi-mono is Copyright (c) 2025 Mario Zechner and licensed under MIT.",
	directories: {
		buildResources: "build",
		output: "dist",
	},
	electronVersion: "42.2.0",
	extraMetadata: {
		version,
	},
	buildVersion,
	files: ["out/**/*", "package.json", "LICENSE", "NOTICE", "Skylark-release.json", "!**/*.map"],
	extraResources: externalRuntimeResources,
	mac: {
		category: "public.app-category.developer-tools",
		icon: "build/icon.icns",
		identity: "-",
		notarize: false,
		target: [
			{ target: "dmg", arch: ["arm64"] },
			{ target: "zip", arch: ["arm64"] },
		],
	},
	dmg: {
		contents: [
			{ x: 130, y: 220 },
			{ x: 410, y: 220, type: "link", path: "/Applications" },
		],
		title: dmgTitle,
		window: { width: 540, height: 380 },
	},
};
