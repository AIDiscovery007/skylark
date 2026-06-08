import { useCallback, useEffect } from "react";
import type { DesktopProjectSummary, DesktopSessionSummary } from "../../shared/types.ts";
import { resolveDesktopAgentBridge } from "../lib/desktop-agent-bridge.ts";
import { markRendererPerformance, measureRendererPerformance } from "../lib/performance-marks.ts";
import type { ProjectStoreBridge } from "../stores/project-store.ts";
import { useProjectStore } from "../stores/project-store.ts";
import { useSessionStore } from "../stores/session-store.ts";
import { useSettingsStore } from "../stores/settings-store.ts";

export interface UseProjectsOptions {
	bridge?: ProjectStoreBridge;
}

export interface UseProjectsResult {
	projects: DesktopProjectSummary[];
	sessionsByProjectId: Record<string, DesktopSessionSummary[]>;
	activeProjectId?: string;
	activeProject?: DesktopProjectSummary;
	isLoading: boolean;
	isCreating: boolean;
	isSwitching: boolean;
	errorMessage?: string;
	createProjectFromFolder: () => Promise<void>;
	ensureProjectSessions: (projectId: string) => Promise<void>;
	refreshProjects: () => Promise<void>;
	switchProject: (projectId: string) => Promise<void>;
	upsertProjectSession: (projectId: string, session: DesktopSessionSummary) => void;
}

export function useProjects(options: UseProjectsOptions = {}): UseProjectsResult {
	const bridge = resolveDesktopAgentBridge(options.bridge);
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const createProjectFromFolder = useProjectStore((state) => state.createProjectFromFolder);
	const errorMessage = useProjectStore((state) => state.errorMessage);
	const isCreating = useProjectStore((state) => state.isCreating);
	const isLoading = useProjectStore((state) => state.isLoading);
	const isSwitching = useProjectStore((state) => state.isSwitching);
	const ensureProjectSessions = useProjectStore((state) => state.ensureProjectSessions);
	const loadProjects = useProjectStore((state) => state.loadProjects);
	const projects = useProjectStore((state) => state.projects);
	const sessionsByProjectId = useProjectStore((state) => state.sessionsByProjectId);
	const switchProject = useProjectStore((state) => state.switchProject);
	const upsertProjectSession = useProjectStore((state) => state.upsertProjectSession);
	const applySessionWorkspaceOverview = useSessionStore((state) => state.applyWorkspaceOverview);
	const applySettingsWorkspaceOverview = useSettingsStore((state) => state.applyWorkspaceOverview);
	const activeProject = projects.find((project) => project.id === activeProjectId);

	const applyWorkspaceOverview = useCallback(async () => {
		const overview = await loadProjects(bridge);
		if (!overview) {
			return;
		}
		applySettingsWorkspaceOverview(overview);
		applySessionWorkspaceOverview(overview);
	}, [applySessionWorkspaceOverview, applySettingsWorkspaceOverview, bridge, loadProjects]);

	useEffect(() => {
		markRendererPerformance("renderer:workspace-overview:load:start");
		void applyWorkspaceOverview().finally(() => {
			markRendererPerformance("renderer:workspace-overview:load:end");
			measureRendererPerformance(
				"renderer workspace overview load",
				"renderer:workspace-overview:load:start",
				"renderer:workspace-overview:load:end",
			);
		});
	}, [applyWorkspaceOverview]);

	const handleCreateProjectFromFolder = useCallback(async () => {
		await createProjectFromFolder(bridge);
	}, [bridge, createProjectFromFolder]);

	const refreshProjects = useCallback(async () => {
		await applyWorkspaceOverview();
	}, [applyWorkspaceOverview]);

	const handleSwitchProject = useCallback(
		async (projectId: string) => {
			await switchProject(bridge, projectId);
		},
		[bridge, switchProject],
	);

	const handleEnsureProjectSessions = useCallback(
		async (projectId: string) => {
			await ensureProjectSessions(bridge, projectId);
		},
		[bridge, ensureProjectSessions],
	);

	return {
		projects,
		sessionsByProjectId,
		activeProjectId,
		activeProject,
		isLoading,
		isCreating,
		isSwitching,
		errorMessage,
		createProjectFromFolder: handleCreateProjectFromFolder,
		ensureProjectSessions: handleEnsureProjectSessions,
		refreshProjects,
		switchProject: handleSwitchProject,
		upsertProjectSession,
	};
}
