#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SESSION_REF_KEYS = ["activeRunStatus", "activeSessionId", "latestRunStatus", "latestRunAt", "latestSessionId"];

function parseArgs(argv) {
	const options = {
		agentHomePath: undefined,
		dryRun: false,
		force: false,
		userDataPath: undefined,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--dry-run") {
			options.dryRun = true;
			continue;
		}
		if (arg === "--force") {
			options.force = true;
			continue;
		}
		if (arg === "--agent-home") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Expected a path after --agent-home.");
			}
			options.agentHomePath = value;
			index += 1;
			continue;
		}
		if (arg === "--user-data") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Expected a path after --user-data.");
			}
			options.userDataPath = value;
			index += 1;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

function printHelp() {
	console.log(`Clear Pi Desktop Agent session history.

Usage:
  npm run clear:sessions
  npm run clear:sessions -- --dry-run
  npm run clear:sessions -- --force
  npm run clear:sessions -- --agent-home "$HOME/.skylark"
  npm run clear:sessions -- --user-data "/path/to/Electron/userData"

The script removes session index entries, session transcript files, archived
session transcript files, and stale session references from projects, settings,
and event run history. Events and event attachments are preserved.`);
}

function getDefaultUserDataPath() {
	const home = homedir();
	if (process.platform === "darwin") {
		return join(home, "Library", "Application Support", "@mariozechner", "pi-desktop-ai-agent");
	}
	if (process.platform === "win32") {
		return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "@mariozechner", "pi-desktop-ai-agent");
	}
	return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "@mariozechner", "pi-desktop-ai-agent");
}

async function readJson(filePath, fallback) {
	try {
		return JSON.parse(await readFile(filePath, "utf8"));
	} catch (error) {
		if (isMissingPathError(error)) {
			return fallback;
		}
		throw error;
	}
}

async function readText(filePath, fallback) {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if (isMissingPathError(error)) {
			return fallback;
		}
		throw error;
	}
}

async function writeJson(filePath, value, dryRun) {
	if (dryRun) {
		return;
	}
	await mkdirForFile(filePath);
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function mkdirForFile(filePath) {
	await mkdir(dirname(filePath), { recursive: true });
}

async function listDirectory(dirPath) {
	try {
		return await readdir(dirPath);
	} catch (error) {
		if (isMissingPathError(error)) {
			return [];
		}
		throw error;
	}
}

async function removeChildren(dirPath, dryRun) {
	const entries = await listDirectory(dirPath);
	if (dryRun) {
		return entries.length;
	}
	await Promise.all(entries.map((entry) => rm(join(dirPath, entry), { recursive: true, force: true })));
	return entries.length;
}

async function countFilesRecursively(dirPath) {
	let count = 0;
	for (const entry of await listDirectory(dirPath)) {
		const entryPath = join(dirPath, entry);
		const entryStat = await stat(entryPath);
		if (entryStat.isDirectory()) {
			count += await countFilesRecursively(entryPath);
		} else {
			count += 1;
		}
	}
	return count;
}

function isMissingPathError(error) {
	return error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function normalizeBodyPreview(body) {
	return String(body ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function toEventSummary(event) {
	const summary = {
		id: event.id,
		title: event.title,
		bodyPreview: normalizeBodyPreview(event.body),
		status: event.status,
		attachmentCount: Array.isArray(event.attachments) ? event.attachments.length : 0,
		createdAt: event.createdAt,
		updatedAt: event.updatedAt,
		statusChangedAt: event.statusChangedAt,
	};
	if (event.completedAt) {
		summary.completedAt = event.completedAt;
	}
	if (event.discardedAt) {
		summary.discardedAt = event.discardedAt;
	}
	return summary;
}

function clearEventSessionRefs(event, timestamp) {
	let removedRuns = 0;
	let changed = false;
	const nextEvent = { ...event };

	for (const key of SESSION_REF_KEYS) {
		if (Object.hasOwn(nextEvent, key)) {
			delete nextEvent[key];
			changed = true;
		}
	}

	if (Array.isArray(nextEvent.runs) && nextEvent.runs.length > 0) {
		removedRuns = nextEvent.runs.length;
		nextEvent.runs = [];
		changed = true;
	}

	if (nextEvent.status === "running") {
		nextEvent.status = "ready";
		nextEvent.statusChangedAt = timestamp;
		changed = true;
	}

	if (changed) {
		nextEvent.updatedAt = timestamp;
	}

	return { changed, event: nextEvent, removedRuns };
}

async function clearEvents(rootDir, dryRun) {
	const eventsDir = join(rootDir, "events", "data");
	const eventIndexPath = join(rootDir, "events", "index.json");
	const timestamp = new Date().toISOString();
	const files = (await listDirectory(eventsDir)).filter((file) => file.endsWith(".json"));
	const eventIndex = {};
	let touchedEvents = 0;
	let removedRuns = 0;

	for (const file of files) {
		const filePath = join(eventsDir, file);
		const event = await readJson(filePath, undefined);
		if (!event || typeof event !== "object" || Array.isArray(event)) {
			continue;
		}

		const cleared = clearEventSessionRefs(event, timestamp);
		if (cleared.changed) {
			touchedEvents += 1;
			removedRuns += cleared.removedRuns;
			await writeJson(filePath, cleared.event, dryRun);
		}
		eventIndex[cleared.event.id] = toEventSummary(cleared.event);
	}

	if (files.length > 0) {
		await writeJson(eventIndexPath, eventIndex, dryRun);
	}

	return { removedRuns, touchedEvents };
}

async function clearProjects(rootDir, dryRun) {
	const projectsPath = join(rootDir, "projects", "index.json");
	const projects = await readJson(projectsPath, {});
	let updatedProjects = 0;

	if (!projects || typeof projects !== "object" || Array.isArray(projects)) {
		return { updatedProjects };
	}

	for (const [projectId, project] of Object.entries(projects)) {
		if (!project || typeof project !== "object" || Array.isArray(project)) {
			continue;
		}

		const nextProject = { ...project };
		let changed = false;
		if (nextProject.sessionCount !== 0) {
			nextProject.sessionCount = 0;
			changed = true;
		}
		if (Object.hasOwn(nextProject, "lastOpenedSessionId")) {
			delete nextProject.lastOpenedSessionId;
			changed = true;
		}
		if (changed) {
			projects[projectId] = nextProject;
			updatedProjects += 1;
		}
	}

	if (updatedProjects > 0) {
		await writeJson(projectsPath, projects, dryRun);
	}

	return { updatedProjects };
}

async function clearSettings(rootDir, dryRun) {
	const settingsPath = join(rootDir, "settings.json");
	const settings = await readJson(settingsPath, {});
	const clearedSettingsSession =
		settings && typeof settings === "object" && !Array.isArray(settings) && Object.hasOwn(settings, "lastOpenedSessionId");

	if (clearedSettingsSession) {
		delete settings.lastOpenedSessionId;
		await writeJson(settingsPath, settings, dryRun);
	}

	return { clearedSettingsSession };
}

async function clearSessions(rootDir, dryRun) {
	const sessionIndexPath = join(rootDir, "session_index.jsonl");
	const sessionsDir = join(rootDir, "sessions");
	const archivedSessionsDir = join(rootDir, "archived_sessions");
	const sessionIndexContent = await readText(sessionIndexPath, "");
	const removedSummaries = sessionIndexContent
		.split("\n")
		.filter((line) => line.includes('"type":"session_upsert"')).length;
	const removedDetailFiles = await countFilesRecursively(sessionsDir);
	const removedArchivedTranscripts = await countFilesRecursively(archivedSessionsDir);
	if (!dryRun) {
		await rm(sessionIndexPath, { force: true });
	}
	await removeChildren(sessionsDir, dryRun);
	await removeChildren(archivedSessionsDir, dryRun);

	return { removedArchivedTranscripts, removedDetailFiles, removedSummaries };
}

async function isDesktopAppRunning(userDataPath) {
	if (process.platform === "win32") {
		return false;
	}

	try {
		const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], { maxBuffer: 1024 * 1024 });
		const currentPid = String(process.pid);
		return stdout
			.split("\n")
			.filter((line) => line.trim().length > 0 && !line.trim().startsWith(currentPid))
			.some((line) => {
				return (
					line.includes("skylark") ||
					line.includes("pi-desktop-ai-agent") ||
					line.includes(userDataPath)
				);
			});
	} catch {
		return false;
	}
}

async function pathExists(targetPath) {
	try {
		await stat(targetPath);
		return true;
	} catch (error) {
		if (isMissingPathError(error)) {
			return false;
		}
		throw error;
	}
}

function printSummary(summary, options) {
	const prefix = options.dryRun ? "Would clear" : "Cleared";
	console.log(`${prefix} Pi Desktop Agent session history at ${summary.agentHomePath}`);
	console.log(`- session index entries: ${summary.removedSummaries}`);
	console.log(`- session transcript files: ${summary.removedDetailFiles}`);
	console.log(`- archived session transcript files: ${summary.removedArchivedTranscripts}`);
	console.log(`- projects updated: ${summary.updatedProjects}`);
	console.log(`- settings session pointer cleared: ${summary.clearedSettingsSession ? "yes" : "no"}`);
	console.log(`- event run records removed: ${summary.removedRuns}`);
	console.log(`- events updated: ${summary.touchedEvents}`);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const userDataPath = options.userDataPath ?? getDefaultUserDataPath();
	const rootDir = options.agentHomePath ?? join(homedir(), ".skylark");

	if (!(await pathExists(rootDir))) {
		console.log(`No Pi Desktop Agent data found at ${rootDir}`);
		return;
	}

	if (!options.force && (await isDesktopAppRunning(userDataPath))) {
		throw new Error(
			"Pi Desktop Agent appears to be running. Close the app first, or rerun with --force if you accept possible stale state rewrites.",
		);
	}

	const sessionSummary = await clearSessions(rootDir, options.dryRun);
	const projectSummary = await clearProjects(rootDir, options.dryRun);
	const settingsSummary = await clearSettings(rootDir, options.dryRun);
	const eventSummary = await clearEvents(rootDir, options.dryRun);

	printSummary(
		{
			agentHomePath: rootDir,
			userDataPath,
			...sessionSummary,
			...projectSummary,
			...settingsSummary,
			...eventSummary,
		},
		options,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
