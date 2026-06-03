import { randomUUID } from "node:crypto";
import { basename, normalize, resolve } from "node:path";
import type { DesktopProjectSummary, DesktopSessionSummary } from "../../shared/types.ts";
import { JsonFileStore } from "./json-file-store.ts";

type ProjectIndex = Record<string, DesktopProjectSummary>;

export function normalizeProjectCwd(cwd: string): string {
	return normalize(resolve(cwd));
}

function deriveProjectName(cwd: string): string {
	return basename(normalizeProjectCwd(cwd)) || normalizeProjectCwd(cwd);
}

function sortProjectsByRecency(projects: DesktopProjectSummary[]): DesktopProjectSummary[] {
	return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function countSessionsForProject(project: DesktopProjectSummary, sessions: readonly DesktopSessionSummary[]): number {
	const projectCwd = normalizeProjectCwd(project.cwd);
	return sessions.filter((session) => normalizeProjectCwd(session.cwd) === projectCwd).length;
}

export class DesktopProjectStore {
	private readonly indexStore: JsonFileStore<ProjectIndex>;

	constructor(indexFilePath: string) {
		this.indexStore = new JsonFileStore(indexFilePath, {});
	}

	async list(): Promise<DesktopProjectSummary[]> {
		const projectIndex = await this.indexStore.read();
		return sortProjectsByRecency(Object.values(projectIndex));
	}

	async listWithSessionStats(sessions: readonly DesktopSessionSummary[]): Promise<DesktopProjectSummary[]> {
		const projects = await this.list();
		return sortProjectsByRecency(
			projects.map((project) => ({
				...project,
				sessionCount: countSessionsForProject(project, sessions),
			})),
		);
	}

	async get(projectId: string): Promise<DesktopProjectSummary | null> {
		const projectIndex = await this.indexStore.read();
		return projectIndex[projectId] ?? null;
	}

	async createOrGet(cwd: string): Promise<DesktopProjectSummary> {
		const normalizedCwd = normalizeProjectCwd(cwd);
		const projectIndex = await this.indexStore.read();
		const existingProject = Object.values(projectIndex).find(
			(project) => normalizeProjectCwd(project.cwd) === normalizedCwd,
		);
		if (existingProject) {
			return existingProject;
		}

		const timestamp = new Date().toISOString();
		const project: DesktopProjectSummary = {
			id: randomUUID(),
			name: deriveProjectName(normalizedCwd),
			cwd: normalizedCwd,
			createdAt: timestamp,
			updatedAt: timestamp,
			sessionCount: 0,
		};

		await this.indexStore.write({
			...projectIndex,
			[project.id]: project,
		});
		return project;
	}

	async updateLastOpenedSession(
		projectId: string,
		sessionId: string | undefined,
	): Promise<DesktopProjectSummary | null> {
		let updatedProject: DesktopProjectSummary | null = null;
		await this.indexStore.update((current) => {
			const project = current[projectId];
			if (!project) {
				return current;
			}

			updatedProject = {
				...project,
				lastOpenedSessionId: sessionId,
			};
			return {
				...current,
				[projectId]: updatedProject,
			};
		});

		return updatedProject;
	}
}
