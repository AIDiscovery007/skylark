import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { getErrorMessage } from "../../shared/errors.ts";
import type { DesktopAgentBridge } from "../../shared/ipc-contract.ts";
import type { DesktopAgentSnapshot, SerializedAgentEvent } from "../../shared/serialized-agent-event.ts";
import type { DesktopProjectSummary, DesktopSessionSummary, DesktopWorkspaceOverview } from "../../shared/types.ts";
import {
	updateProjectSessionSummariesForAgentEvent,
	updateSessionSummariesForProfileSnapshot,
} from "../lib/conversation-timeline-projection.ts";
import { replaceSessionSummary, sortSessionsByRecency } from "./session-store.ts";

export type ProjectStoreBridge = Pick<
	DesktopAgentBridge,
	"createProjectFromFolder" | "getWorkspaceOverview" | "listProjects" | "listSessions" | "switchProject"
>;

function formatTimestamp(value: string): number {
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortProjectsByRecency(projects: DesktopProjectSummary[]): DesktopProjectSummary[] {
	return [...projects].sort((left, right) => {
		const updatedDelta = formatTimestamp(right.updatedAt) - formatTimestamp(left.updatedAt);
		if (updatedDelta !== 0) {
			return updatedDelta;
		}

		return formatTimestamp(right.createdAt) - formatTimestamp(left.createdAt);
	});
}

function replaceProjectSummary(
	projects: DesktopProjectSummary[],
	nextProject: DesktopProjectSummary,
): DesktopProjectSummary[] {
	const projectIndex = projects.findIndex((project) => project.id === nextProject.id);
	if (projectIndex === -1) {
		return [...projects, nextProject];
	}

	const nextProjects = projects.slice();
	nextProjects[projectIndex] = {
		...projects[projectIndex],
		...nextProject,
	};
	return nextProjects;
}

function mergeProjectSummariesPreservingOrder(
	currentProjects: DesktopProjectSummary[],
	latestProjects: DesktopProjectSummary[],
): DesktopProjectSummary[] {
	if (currentProjects.length === 0) {
		return sortProjectsByRecency(latestProjects);
	}

	const latestProjectMap = new Map(latestProjects.map((project) => [project.id, project]));
	const mergedProjects = currentProjects.flatMap((project) => {
		const latestProject = latestProjectMap.get(project.id);
		return latestProject ? [{ ...project, ...latestProject }] : [];
	});
	const currentProjectIds = new Set(currentProjects.map((project) => project.id));
	const newProjects = sortProjectsByRecency(latestProjects.filter((project) => !currentProjectIds.has(project.id)));
	return [...mergedProjects, ...newProjects];
}

function resolveActiveProjectId(projects: DesktopProjectSummary[], preferredProjectId?: string): string | undefined {
	if (preferredProjectId && projects.some((project) => project.id === preferredProjectId)) {
		return preferredProjectId;
	}

	return projects[0]?.id;
}

function updateProjectSessionCount(
	projects: DesktopProjectSummary[],
	projectId: string,
	sessions: DesktopSessionSummary[],
): DesktopProjectSummary[] {
	const projectIndex = projects.findIndex((project) => project.id === projectId);
	if (projectIndex === -1) {
		return projects;
	}

	const project = projects[projectIndex]!;
	const nextProjects = projects.slice();
	nextProjects[projectIndex] = {
		...project,
		lastOpenedSessionId: sessions[0]?.id ?? project.lastOpenedSessionId,
		sessionCount: sessions.length,
		updatedAt: sessions[0]?.updatedAt ?? project.updatedAt,
	};
	return nextProjects;
}

function upsertProjectSessionState(
	state: Pick<ProjectStoreState, "projects" | "sessionsByProjectId">,
	projectId: string,
	session: DesktopSessionSummary,
): Pick<ProjectStoreState, "projects" | "sessionsByProjectId"> {
	const sessions = sortSessionsByRecency(replaceSessionSummary(state.sessionsByProjectId[projectId] ?? [], session));

	return {
		projects: updateProjectSessionCount(state.projects, projectId, sessions),
		sessionsByProjectId: {
			...state.sessionsByProjectId,
			[projectId]: sessions,
		},
	};
}

function findProjectIdForSession(
	sessionsByProjectId: Record<string, DesktopSessionSummary[]>,
	sessionId: string,
): string | undefined {
	for (const [projectId, sessions] of Object.entries(sessionsByProjectId)) {
		if (sessions.some((session) => session.id === sessionId)) {
			return projectId;
		}
	}

	return undefined;
}

async function loadSessionsByProjectId(
	bridge: ProjectStoreBridge,
	projects: DesktopProjectSummary[],
): Promise<Record<string, DesktopSessionSummary[]>> {
	const entries = await Promise.all(
		projects.map(async (project) => [project.id, await bridge.listSessions(project.id)] as const),
	);
	return Object.fromEntries(entries);
}

export interface ProjectStoreState {
	projects: DesktopProjectSummary[];
	sessionsByProjectId: Record<string, DesktopSessionSummary[]>;
	activeProjectId?: string;
	isLoading: boolean;
	isCreating: boolean;
	isSwitching: boolean;
	errorMessage?: string;
	loadProjects: (bridge: ProjectStoreBridge) => Promise<DesktopWorkspaceOverview | undefined>;
	ensureProjectSessions: (bridge: ProjectStoreBridge, projectId: string) => Promise<void>;
	createProjectFromFolder: (bridge: ProjectStoreBridge) => Promise<DesktopProjectSummary | undefined>;
	switchProject: (bridge: ProjectStoreBridge, projectId: string) => Promise<DesktopProjectSummary | undefined>;
	upsertProjectSession: (projectId: string, session: DesktopSessionSummary) => void;
	applyAgentEvent: (event: SerializedAgentEvent) => void;
	applyProfileSnapshot: (snapshot: DesktopAgentSnapshot) => void;
}

export function createProjectStore() {
	return createStore<ProjectStoreState>()((set, get) => ({
		projects: [],
		sessionsByProjectId: {},
		activeProjectId: undefined,
		isLoading: false,
		isCreating: false,
		isSwitching: false,
		errorMessage: undefined,
		loadProjects: async (bridge) => {
			set((state) => ({ ...state, isLoading: true, errorMessage: undefined }));

			try {
				const overview = await bridge.getWorkspaceOverview();
				const projects = mergeProjectSummariesPreservingOrder(get().projects, overview.projects);

				set((state) => ({
					...state,
					projects,
					sessionsByProjectId: overview.sessionsByProjectId,
					activeProjectId:
						overview.activeProjectId ?? resolveActiveProjectId(projects, overview.settings.lastOpenedProjectId),
					isLoading: false,
				}));
				return overview;
			} catch (error: unknown) {
				set((state) => ({
					...state,
					isLoading: false,
					errorMessage: getErrorMessage(error),
				}));
				return undefined;
			}
		},
		ensureProjectSessions: async (bridge, projectId) => {
			const project = get().projects.find((entry) => entry.id === projectId);
			const currentSessions = get().sessionsByProjectId[projectId] ?? [];
			if (project && currentSessions.length >= project.sessionCount) {
				return;
			}

			try {
				const sessions = sortSessionsByRecency(await bridge.listSessions(projectId));
				set((state) => ({
					...state,
					projects: updateProjectSessionCount(state.projects, projectId, sessions),
					sessionsByProjectId: {
						...state.sessionsByProjectId,
						[projectId]: sessions,
					},
					errorMessage: undefined,
				}));
			} catch (error: unknown) {
				set((state) => ({
					...state,
					errorMessage: getErrorMessage(error),
				}));
			}
		},
		createProjectFromFolder: async (bridge) => {
			set((state) => ({ ...state, isCreating: true, errorMessage: undefined }));

			try {
				const createdProject = await bridge.createProjectFromFolder();
				if (!createdProject) {
					set((state) => ({ ...state, isCreating: false }));
					return undefined;
				}

				const projects = sortProjectsByRecency(await bridge.listProjects());
				const sessionsByProjectId = await loadSessionsByProjectId(bridge, projects);
				set((state) => ({
					...state,
					projects,
					sessionsByProjectId,
					activeProjectId: createdProject.id,
					isCreating: false,
				}));
				return createdProject;
			} catch (error: unknown) {
				set((state) => ({
					...state,
					isCreating: false,
					errorMessage: getErrorMessage(error),
				}));
				return undefined;
			}
		},
		switchProject: async (bridge, projectId) => {
			if (projectId === get().activeProjectId) {
				return get().projects.find((project) => project.id === projectId);
			}

			set((state) => ({ ...state, isSwitching: true, errorMessage: undefined }));

			try {
				const switchedProject = await bridge.switchProject(projectId);
				if (!switchedProject) {
					set((state) => ({ ...state, isSwitching: false }));
					return undefined;
				}

				const currentProjects =
					get().projects.length > 0 ? get().projects : sortProjectsByRecency(await bridge.listProjects());
				const projects = replaceProjectSummary(currentProjects, switchedProject);
				const projectSessions = await bridge.listSessions(switchedProject.id);
				set((state) => ({
					...state,
					projects,
					sessionsByProjectId: {
						...state.sessionsByProjectId,
						[switchedProject.id]: projectSessions,
					},
					activeProjectId: switchedProject.id,
					isSwitching: false,
				}));
				return switchedProject;
			} catch (error: unknown) {
				set((state) => ({
					...state,
					isSwitching: false,
					errorMessage: getErrorMessage(error),
				}));
				return undefined;
			}
		},
		upsertProjectSession: (projectId, session) => {
			set((state) => ({
				...state,
				...upsertProjectSessionState(state, projectId, session),
			}));
		},
		applyAgentEvent: (event) => {
			set((state) => {
				const projectId = findProjectIdForSession(state.sessionsByProjectId, event.sessionId);
				if (!projectId) {
					return state;
				}

				const sessions = updateProjectSessionSummariesForAgentEvent(
					state.sessionsByProjectId[projectId] ?? [],
					event,
				);
				return {
					...state,
					projects: updateProjectSessionCount(state.projects, projectId, sessions),
					sessionsByProjectId: {
						...state.sessionsByProjectId,
						[projectId]: sessions,
					},
				};
			});
		},
		applyProfileSnapshot: (snapshot) => {
			set((state) => {
				const projectId = findProjectIdForSession(state.sessionsByProjectId, snapshot.sessionId);
				if (!projectId) {
					return state;
				}

				const sessions = updateSessionSummariesForProfileSnapshot(
					state.sessionsByProjectId[projectId] ?? [],
					snapshot,
				);
				return {
					...state,
					projects: updateProjectSessionCount(state.projects, projectId, sessions),
					sessionsByProjectId: {
						...state.sessionsByProjectId,
						[projectId]: sessions,
					},
				};
			});
		},
	}));
}

export const projectStore = createProjectStore();

export function useProjectStore<T>(selector: (state: ProjectStoreState) => T): T {
	return useStore(projectStore, selector);
}
