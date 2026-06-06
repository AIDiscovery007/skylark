import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const upstreamUrl = process.env.UPSTREAM_REPO_URL ?? "https://github.com/earendil-works/pi.git";
const upstreamBranch = process.env.UPSTREAM_BRANCH ?? "main";
const lookbackHours = Number(process.env.UPSTREAM_LOOKBACK_HOURS ?? "24");
const maxCommits = Number(process.env.UPSTREAM_MAX_COMMITS ?? "20");
const importantPaths = (process.env.UPSTREAM_IMPORTANT_PATHS ??
	"src/,test/,scripts/,package.json,package-lock.json,Skylark-release.json,electron-builder.config.cjs,electron.vite.config.ts,tsconfig.base.json,tsconfig.json,tsconfig.node.json,tsconfig.web.json,README.md,CHANGELOG.md,NOTICE"
)
	.split(",")
	.map((item) => item.trim())
	.filter(Boolean);

const summaryPath = process.env.GITHUB_STEP_SUMMARY;

if (!Number.isFinite(lookbackHours) || lookbackHours <= 0) {
	throw new Error("UPSTREAM_LOOKBACK_HOURS must be a positive number");
}
if (!Number.isFinite(maxCommits) || maxCommits <= 0) {
	throw new Error("UPSTREAM_MAX_COMMITS must be a positive number");
}

function run(command, cwd) {
	return execSync(command, {
		cwd,
		encoding: "utf8",
		maxBuffer: 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function isImportant(filePath) {
	return importantPaths.some((item) => {
		const pattern = item.trim();
		if (!pattern) {
			return false;
		}

		if (filePath === pattern) {
			return true;
		}

		const normalizedPrefix = pattern.endsWith("/") ? pattern : `${pattern}/`;
		return filePath.startsWith(normalizedPrefix);
	});
}

const now = new Date();
const since = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000).toISOString();

const workspace = mkdtempSync(path.join(os.tmpdir(), "skylark-upstream-"));
const upstreamRepo = path.join(workspace, "upstream-pi");

try {
	run(`git clone --depth 400 --branch ${upstreamBranch} ${upstreamUrl} ${upstreamRepo}`);

	const commitsRaw = run(
		`git log --since "${since}" --max-count ${maxCommits} --pretty=format:%H`,
		upstreamRepo,
	);

	if (!commitsRaw) {
		const none = `No commits from upstream "${upstreamUrl}" (branch ${upstreamBranch}) in the last ${lookbackHours} hours.`;
		console.log(none);
		if (summaryPath) {
			writeFileSync(summaryPath, `# Upstream Monitor\n\n${none}\n`);
		}
		process.exit(0);
	}

	const shas = commitsRaw.split("\n").filter(Boolean);
	const entries = shas.map((sha) => {
		const line = run(
			`git show -s --format=%h%x1f%an%x1f%ad%x1f%s --date=iso ${sha}`,
			upstreamRepo,
		);
		const [shortSha, author, date, subject] = line.split("\x1f");
		const files = run(`git show --name-only --pretty=format: ${sha}`, upstreamRepo)
			.split("\n")
			.map((f) => f.trim())
			.filter(Boolean);
		const importantFiles = files.filter(isImportant);

		return {
			sha,
			shortSha,
			author,
			date,
			subject,
			files,
			importantFiles,
			important: importantFiles.length > 0,
		};
	});

	const importantEntries = entries.filter((entry) => entry.important);

	let report = "# Upstream Monitor (earendil-works/pi)\n\n";
	report += `Generated at: ${now.toISOString()}\n`;
	report += `Window: ${lookbackHours} hours since ${since}\n\n`;
	report += `Repository: ${upstreamUrl}\n`;
	report += `Branch: ${upstreamBranch}\n\n`;

	report += `## New commits (${entries.length})\n`;
	for (const entry of entries) {
		report += `- [${entry.shortSha}] ${entry.subject} (${entry.date}) — ${entry.author}\n`;
		report += `  - Files: ${entry.files.join(", ") || "(no file list)"}\n`;
		report += entry.important
			? `  - Likely merge-worthy for Skylark: **YES** (contains: ${entry.importantFiles.join(", ")})\n\n`
			: "  - Likely merge-worthy for Skylark: no\n\n";
	}

	report += "## Focused watchlist\n";
	report += `These paths are treated as higher priority: ${importantPaths.join(", ")}\n\n`;
	report += `Priority matches in this window: ${importantEntries.length}\n`;
	for (const entry of importantEntries) {
		report += `- ${entry.shortSha}: ${entry.subject}\n`;
	}

	console.log(report);
	if (summaryPath) {
		writeFileSync(summaryPath, report);
	}
} catch (error) {
	console.error("Failed to generate upstream monitor report");
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
