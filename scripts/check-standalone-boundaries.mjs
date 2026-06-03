import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ignoredDirectories = new Set([".git", ".husky", "dist", "node_modules", "out"]);
const checkedExtensions = new Set([".cjs", ".css", ".html", ".json", ".js", ".jsx", ".md", ".mjs", ".ts", ".tsx"]);
const allowedPiMonoReferenceFilenames = new Set(["AGENTS.md", "HANDOFF.md", "NOTICE"]);
const forbiddenPatterns = [
	{ label: "local pi-mono path", pattern: /(?:^|[/"'`])(?:\.\.\/)+pi-mono(?:[/"'`]|$)/ },
	{ label: "absolute local pi-mono path", pattern: /\/Users\/qiaochao\/pi-mono(?:\/|$)/ },
	{ label: "monorepo ai source import", pattern: /(?:^|[/"'`])\.\.\/ai\/src(?:[/"'`]|$)/ },
	{ label: "monorepo agent source import", pattern: /(?:^|[/"'`])\.\.\/agent\/src(?:[/"'`]|$)/ },
	{ label: "monorepo coding-agent source import", pattern: /(?:^|[/"'`])\.\.\/coding-agent\/src(?:[/"'`]|$)/ },
	{ label: "monorepo tui source import", pattern: /(?:^|[/"'`])\.\.\/tui\/src(?:[/"'`]|$)/ },
];
const files = [];

function extensionOf(file) {
	const index = file.lastIndexOf(".");
	return index === -1 ? "" : file.slice(index);
}

function collectFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!ignoredDirectories.has(entry.name)) {
				collectFiles(path);
			}
			continue;
		}

		if (entry.isFile() && checkedExtensions.has(extensionOf(entry.name))) {
			files.push(path);
		}
	}
}

const failures = [];

collectFiles(".");

for (const file of files.sort()) {
	const normalizedFile = file.replace(/^\.\//, "");
	const filename = normalizedFile.split("/").at(-1);
	if (filename && allowedPiMonoReferenceFilenames.has(filename)) {
		continue;
	}
	const text = readFileSync(file, "utf8");
	const lines = text.split(/\r?\n/);
	for (const [index, line] of lines.entries()) {
		for (const { label, pattern } of forbiddenPatterns) {
			if (pattern.test(line)) {
				failures.push(`${normalizedFile}:${index + 1}: ${label}: ${line.trim()}`);
			}
		}
	}
}

if (failures.length > 0) {
	console.error("Skylark must remain a standalone repository with npm package dependencies:");
	for (const failure of failures) {
		console.error(`  ${failure}`);
	}
	process.exit(1);
}
