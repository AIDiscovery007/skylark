import { GitCompareArrows, PencilLine } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { DesktopAgentBridge } from "../shared/ipc-contract.ts";
import type {
	DesktopEnvironmentResource,
	DesktopNativeAppearance,
	DesktopPromptSubmission,
	DesktopSessionSummary,
	DesktopSettingsOpenRequest,
	DesktopSettingsSectionId,
	DesktopSubagentOpenRequest,
} from "../shared/types.ts";
import { ChatWorkbench } from "./components/chat/ChatWorkbench.tsx";
import { AppLayout } from "./components/layout/AppLayout.tsx";
import { WorkbenchHeader } from "./components/layout/WorkbenchHeader.tsx";
import type { ReviewWorkspaceChromeSummary } from "./components/review/ReviewWorkspacePanel.tsx";
import { ApprovalCenter } from "./components/security/ApprovalCenter.tsx";
import { Sidebar } from "./components/sidebar/Sidebar.tsx";
import { TerminalPanel } from "./components/terminal/TerminalPanel.tsx";
import { ErrorNotice } from "./components/ui/error-notice.tsx";
import { IconButton } from "./components/ui/icon-button.tsx";
import { Spinner } from "./components/ui/spinner.tsx";
import { useAgentStream } from "./hooks/use-agent-stream.ts";
import { useCapabilities } from "./hooks/use-capabilities.ts";
import { useEvents } from "./hooks/use-events.ts";
import { useMinimumVisibleFlag } from "./hooks/use-minimum-visible-flag.ts";
import { useProjects } from "./hooks/use-projects.ts";
import { useSessions } from "./hooks/use-sessions.ts";
import { useSettings } from "./hooks/use-settings.ts";
import { useWorkspaceStatus } from "./hooks/use-workspace-status.ts";
import { getAgentRuntimeState } from "./lib/agent-runtime-state.ts";
import { applyDesktopAppearanceTheme } from "./lib/appearance-theme.ts";
import {
	deriveMainWorkbenchCoordination,
	getWorkbenchViewClass,
	type MainWorkbenchView,
	resolveInitialMainWorkbenchView,
	resolveSidebarSessionsByProjectId,
} from "./lib/main-workbench-coordination.ts";
import { markRendererPerformance, measureRendererPerformance } from "./lib/performance-marks.ts";
import { useAgentStore } from "./stores/agent-store.ts";
import { useApprovalStore } from "./stores/approval-store.ts";

interface ComposerFocusRequest {
	nonce: number;
	sessionId: string;
}

interface WorkspacePreviewRequest {
	nonce: number;
	path: string;
}

interface EnvironmentTerminalRequest {
	requestId: number;
	resourceId: string;
	title: string;
}

function getWorkbenchViewSwitchMark(view: MainWorkbenchView, phase: "start" | "paint"): string {
	return `renderer:workbench:${view}:switch:${phase}`;
}

const DESKTOP_SETTINGS_SECTIONS = new Set<DesktopSettingsSectionId>([
	"general",
	"appearance",
	"permissions",
	"credentials",
]);

function resolveSettingsSection(value: string | null): DesktopSettingsSectionId | undefined {
	return value && DESKTOP_SETTINGS_SECTIONS.has(value as DesktopSettingsSectionId)
		? (value as DesktopSettingsSectionId)
		: undefined;
}

function resolveInitialSettingsOpenRequest(search: string | undefined): DesktopSettingsOpenRequest | undefined {
	if (!search) {
		return undefined;
	}
	const params = new URLSearchParams(search);
	const section = resolveSettingsSection(params.get("settingsSection"));
	const providerId = params.get("providerId")?.trim() || undefined;
	if (!section && !providerId) {
		return undefined;
	}
	return {
		...(section ? { section } : {}),
		...(providerId ? { providerId } : {}),
	};
}

const loadCapabilitiesPageModule = () => import("./components/capabilities/CapabilitiesPage.tsx");
let capabilitiesPagePreload: ReturnType<typeof loadCapabilitiesPageModule> | undefined;
function preloadCapabilitiesPage() {
	capabilitiesPagePreload ??= loadCapabilitiesPageModule();
	return capabilitiesPagePreload;
}
const CapabilitiesPage = lazy(async () => {
	const module = await preloadCapabilitiesPage();
	return { default: module.CapabilitiesPage };
});
const loadEventsPageModule = () => import("./components/events/EventsPage.tsx");
let eventsPagePreload: ReturnType<typeof loadEventsPageModule> | undefined;
function preloadEventsPage() {
	eventsPagePreload ??= loadEventsPageModule();
	return eventsPagePreload;
}
const EventsPage = lazy(async () => {
	const module = await preloadEventsPage();
	return { default: module.EventsPage };
});
const loadReviewWorkspacePanelModule = () => import("./components/review/ReviewWorkspacePanel.tsx");
let reviewWorkspacePanelPreload: ReturnType<typeof loadReviewWorkspacePanelModule> | undefined;
function preloadReviewWorkspacePanel() {
	reviewWorkspacePanelPreload ??= loadReviewWorkspacePanelModule();
	return reviewWorkspacePanelPreload;
}
const ReviewWorkspacePanel = lazy(async () => {
	const module = await preloadReviewWorkspacePanel();
	return { default: module.ReviewWorkspacePanel };
});
const SettingsPage = lazy(async () => {
	const module = await import("./components/settings/SettingsPage.tsx");
	return { default: module.SettingsPage };
});

function EmptyProjectWorkspace({ projectName }: { projectName: string }) {
	return (
		<div className="grid h-full min-h-0 place-items-center px-6 py-10">
			<motion.div
				animate={{ opacity: 1, y: 0 }}
				className="grid max-w-sm gap-2 text-center"
				initial={{ opacity: 0, y: 6 }}
				transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
			>
				<p className="text-[13px] font-medium leading-5 text-[color:var(--color-sidebar-muted)]">{projectName}</p>
				<p className="sidebar-empty-hint text-sm leading-6">暂无对话，点击左上角新对话开始。</p>
			</motion.div>
		</div>
	);
}

function ReviewFullscreenTitlebarSummary({ summary }: { summary: ReviewWorkspaceChromeSummary }) {
	return (
		<output
			aria-label={`${summary.title} ${summary.additions} additions ${summary.deletions} deletions ${summary.branchLabel} ${summary.workspaceLabel} ${summary.activeItemLabel}`}
			className="flex h-7 min-w-0 max-w-[min(54rem,calc(100vw_-_var(--desktop-titlebar-content-inset)_-_12rem))] select-none items-center gap-1.5 overflow-hidden text-xs text-[color:var(--text-secondary)]"
			data-chrome-content="review-fullscreen-summary"
			data-slot="review-fullscreen-titlebar-summary"
		>
			<GitCompareArrows className="size-4 shrink-0 text-[color:var(--text-tertiary)]" />
			<span className="shrink-0 text-[13px] font-medium text-[color:var(--text-primary)]">{summary.title}</span>
			<span className="shrink-0 text-emerald-600">+{summary.additions}</span>
			<span className="shrink-0 text-red-500">-{summary.deletions}</span>
			<span className="max-w-36 shrink-0 truncate">{summary.branchLabel}</span>
			<span className="min-w-0 truncate text-[color:var(--text-tertiary)]">{summary.workspaceLabel}</span>
			<span className="shrink-0 text-[color:var(--text-tertiary)]">/</span>
			<span className="max-w-32 shrink-0 truncate text-[color:var(--text-secondary)]">
				{summary.activeItemLabel}
			</span>
		</output>
	);
}

function LazyWorkbenchFallback({ label = "Loading" }: { label?: string }) {
	return (
		<output
			aria-live="polite"
			className="grid h-full min-h-0 place-items-center px-6 py-10 text-[color:var(--text-secondary)]"
			data-slot="lazy-boundary-fallback"
		>
			<div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[color:var(--surface-1)] px-3 py-2 text-sm shadow-[var(--shadow-minimal)]">
				<Spinner className="size-3.5" />
				<span>{label}</span>
			</div>
		</output>
	);
}

export function App() {
	const desktopAgent = (window as Partial<Window>).desktopAgent;
	if (!desktopAgent) {
		return <DesktopBridgeUnavailable />;
	}

	return <DesktopApp desktopAgent={desktopAgent} />;
}

function DesktopBridgeUnavailable() {
	return (
		<main className="grid min-h-screen place-items-center bg-[color:var(--background)] px-6 text-sm">
			<ErrorNotice
				className="max-w-md"
				description="Renderer preload bridge is unavailable. Restart the Electron window from the desktop app, not the browser URL."
				title="Desktop bridge unavailable"
			/>
		</main>
	);
}

function DesktopApp({ desktopAgent }: { desktopAgent: DesktopAgentBridge }) {
	const initialAppView = useRef(
		resolveInitialMainWorkbenchView(typeof window === "undefined" ? undefined : window.location.search),
	).current;
	const initialSettingsOpenRequest = useRef(
		resolveInitialSettingsOpenRequest(typeof window === "undefined" ? undefined : window.location.search),
	).current;
	const isDedicatedSettingsWindow = initialAppView === "settings";
	const [activeView, setActiveView] = useState<MainWorkbenchView>(initialAppView);
	const [settingsOpenRequest, setSettingsOpenRequest] = useState<DesktopSettingsOpenRequest | undefined>(
		initialSettingsOpenRequest,
	);
	const [hasRequestedCapabilitiesPage, setHasRequestedCapabilitiesPage] = useState(false);
	const [hasRequestedEventsPage, setHasRequestedEventsPage] = useState(initialAppView === "events");
	const [hasRequestedReviewPanel, setHasRequestedReviewPanel] = useState(false);
	const [pendingPromptSubmissions, setPendingPromptSubmissions] = useState(0);
	const [composerFocusRequest, setComposerFocusRequest] = useState<ComposerFocusRequest | undefined>();
	const [workspacePreviewRequest, setWorkspacePreviewRequest] = useState<WorkspacePreviewRequest | undefined>();
	const [subagentRequest, setSubagentRequest] = useState<DesktopSubagentOpenRequest | undefined>();
	const [environmentTerminalRequest, setEnvironmentTerminalRequest] = useState<
		EnvironmentTerminalRequest | undefined
	>();
	const [isTerminalOpen, setIsTerminalOpen] = useState(false);
	const [showCompletedStatus, setShowCompletedStatus] = useState(false);
	const [hasReportedFirstInteractive, setHasReportedFirstInteractive] = useState(false);
	const [nativeAppearance, setNativeAppearance] = useState<DesktopNativeAppearance | undefined>();
	const [reviewOpenKeys, setReviewOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
	const [reviewFullscreenKeys, setReviewFullscreenKeys] = useState<ReadonlySet<string>>(() => new Set());
	const [hiddenWorkspacePanelKeys, setHiddenWorkspacePanelKeys] = useState<ReadonlySet<string>>(() => new Set());
	const [reviewChromeSummary, setReviewChromeSummary] = useState<ReviewWorkspaceChromeSummary | undefined>();
	const reviewTriggerRef = useRef<HTMLButtonElement | null>(null);
	const workbenchViewRequestIdRef = useRef(0);
	const workspacePreviewRequestNonceRef = useRef(0);
	const subagentRequestNonceRef = useRef(0);
	const environmentTerminalRequestIdRef = useRef(0);
	const wasStreamingRef = useRef(false);
	const projects = useProjects({ bridge: desktopAgent });
	const sessions = useSessions({
		bridge: desktopAgent,
		enabled: Boolean(projects.activeProjectId),
		preferredSessionId: projects.activeProject?.lastOpenedSessionId,
		projectId: projects.activeProjectId,
	});
	const {
		abort,
		compact,
		consumeProposedPlan,
		executePlan,
		prompt,
		refreshSnapshot,
		setSessionMode,
		updateSessionProfile,
	} = useAgentStream(sessions.activeSessionId);
	const cwd = useAgentStore((state) => state.cwd);
	const activeAgentSessionId = useAgentStore((state) => state.activeSessionId);
	const setAgentActiveSession = useAgentStore((state) => state.setActiveSession);
	const taskProgress = useAgentStore((state) => state.taskProgress);
	const settings = useSettings({
		bridge: desktopAgent,
		loadDetails: activeView === "settings",
		loadInitial: false,
		loadProviderCatalog: activeView === "chat",
	});
	const events = useEvents({
		bridge: desktopAgent,
		enabled: hasReportedFirstInteractive || activeView === "events",
	});
	const hasPendingApproval = useApprovalStore((state) => state.requests.length > 0);
	const bridgeError = useAgentStore((state) => state.bridgeError);
	const capabilities = useCapabilities({
		bridge: desktopAgent,
		defer: "immediate",
		enabled: activeView === "capabilities",
	});
	const isSidebarBusy = sessions.isCreating || sessions.isDeleting || projects.isCreating;
	const isStreaming = useAgentStore((state) => state.isStreaming);
	const errorMessage = useAgentStore((state) => state.errorMessage);
	const canDeleteSessions = typeof desktopAgent.deleteSession === "function";
	const activeSession = sessions.sessions.find((session) => session.id === sessions.activeSessionId);
	const [optimisticActiveSession, setOptimisticActiveSession] = useOptimistic<
		DesktopSessionSummary | undefined,
		DesktopSessionSummary | undefined
	>(activeSession, (_currentSession, nextSession) => nextSession);
	const [, startSessionNavigationTransition] = useTransition();
	const showQueuedStatus = useMinimumVisibleFlag(pendingPromptSubmissions > 0, 1800);
	const runtimeState = getAgentRuntimeState({
		bridgeError,
		errorMessage,
		hasPendingApproval,
		isQueued: showQueuedStatus,
		isStreaming,
		showCompleted: showCompletedStatus,
	});
	const sidebarSessionsByProjectId = resolveSidebarSessionsByProjectId(
		projects.sessionsByProjectId,
		projects.activeProjectId,
		sessions.projectId,
		sessions.sessions,
	);
	const workspaceStatus = useWorkspaceStatus({
		activeSessionId: activeAgentSessionId,
		cwd,
		progress: taskProgress,
	});
	const workbenchCoordination = deriveMainWorkbenchCoordination({
		activeAgentSessionId,
		activeProject: projects.activeProject,
		activeProjectId: projects.activeProjectId,
		activeView,
		cwd,
		hiddenWorkspacePanelKeys,
		optimisticActiveSession,
		reviewFullscreenKeys,
		reviewOpenKeys,
		sessions: sessions.sessions,
		sessionsActiveSessionId: sessions.activeSessionId,
		sessionsIsLoading: sessions.isLoading,
		workspaceStatusAvailable: workspaceStatus.isAvailable,
	});
	const {
		displayedActiveSessionId,
		hasEmptyActiveProject,
		isActiveNewConversation,
		isCapabilitiesView,
		isChatView,
		isEventsView,
		isReviewFullscreen,
		isReviewFullscreenActive,
		isReviewOpen,
		isWorkspacePanelAvailable,
		isWorkspacePanelOpen,
		reviewWorkspaceKey,
		selectedPrimaryItem,
		sessionMeta,
		sessionTitle,
		terminalCwd,
		workspaceLabel,
		workspacePanelKey,
	} = workbenchCoordination;
	const terminalAvailable = Boolean(sessions.activeSessionId && terminalCwd);

	const beginWorkbenchViewSwitch = useCallback((view: MainWorkbenchView): number => {
		const requestId = workbenchViewRequestIdRef.current + 1;
		workbenchViewRequestIdRef.current = requestId;
		markRendererPerformance(getWorkbenchViewSwitchMark(view, "start"));
		return requestId;
	}, []);

	const finishWorkbenchViewSwitch = useCallback((requestId: number, view: MainWorkbenchView): void => {
		if (workbenchViewRequestIdRef.current !== requestId) {
			return;
		}
		setActiveView(view);
	}, []);

	const activateWorkbenchView = useCallback(
		(view: MainWorkbenchView): void => {
			const requestId = beginWorkbenchViewSwitch(view);
			finishWorkbenchViewSwitch(requestId, view);
		},
		[beginWorkbenchViewSwitch, finishWorkbenchViewSwitch],
	);

	useEffect(() => {
		markRendererPerformance("renderer:app:first-paint");
		measureRendererPerformance(
			"renderer bootstrap to app first paint",
			"renderer:bootstrap:start",
			"renderer:app:first-paint",
		);
	}, []);

	useEffect(() => {
		const paintMark = getWorkbenchViewSwitchMark(activeView, "paint");
		const complete = () => {
			markRendererPerformance(paintMark);
			measureRendererPerformance(
				`renderer workbench ${activeView} switch to first active frame`,
				getWorkbenchViewSwitchMark(activeView, "start"),
				paintMark,
			);
		};

		if (typeof window.requestAnimationFrame === "function") {
			const frameId = window.requestAnimationFrame(complete);
			return () => window.cancelAnimationFrame(frameId);
		}

		const timeoutId = window.setTimeout(complete, 0);
		return () => window.clearTimeout(timeoutId);
	}, [activeView]);

	useEffect(() => {
		let isDisposed = false;
		const firstInteractiveNotification = desktopAgent.notifyFirstInteractive?.() ?? Promise.resolve();
		void firstInteractiveNotification
			.catch(() => undefined)
			.finally(() => {
				if (!isDisposed) {
					setHasReportedFirstInteractive(true);
				}
			});
		void desktopAgent
			.getNativeAppearance?.()
			.then((appearance) => {
				if (!isDisposed) {
					setNativeAppearance(appearance);
				}
			})
			.catch(() => undefined);
		return () => {
			isDisposed = true;
		};
	}, [desktopAgent]);

	useEffect(() => {
		if (!isDedicatedSettingsWindow) {
			return;
		}
		return desktopAgent.subscribeToSettingsOpenRequests?.((request) => {
			setSettingsOpenRequest(request);
			activateWorkbenchView("settings");
		});
	}, [activateWorkbenchView, desktopAgent, isDedicatedSettingsWindow]);

	useEffect(() => {
		if (!nativeAppearance) {
			return;
		}
		applyDesktopAppearanceTheme(document.documentElement, settings.settings, nativeAppearance);
	}, [nativeAppearance, settings.settings]);

	useEffect(() => {
		if (isReviewOpen) {
			setHasRequestedReviewPanel(true);
		}
	}, [isReviewOpen]);

	const requestComposerFocus = useCallback((sessionId: string): void => {
		setComposerFocusRequest((current) => ({
			sessionId,
			nonce: (current?.nonce ?? 0) + 1,
		}));
	}, []);

	const requestCapabilitiesCatalog = useCallback(async (): Promise<void> => {
		await capabilities.loadCapabilities();
	}, [capabilities.loadCapabilities]);

	async function handleDeleteSession(sessionId: string, projectId?: string): Promise<void> {
		if (!projectId || projectId === projects.activeProjectId) {
			await sessions.deleteSession(sessionId, projectId);
		} else {
			await desktopAgent.deleteSession(sessionId);
		}

		await projects.refreshProjects();
		await sessions.refreshSessions();
	}

	const createSessionForProject = useCallback(
		async (projectId?: string): Promise<DesktopSessionSummary | undefined> => {
			const targetProjectId = projectId ?? projects.activeProjectId;
			if (!targetProjectId) {
				return undefined;
			}

			const createdSession = await sessions.createSession(targetProjectId);
			if (!createdSession) {
				return undefined;
			}

			projects.upsertProjectSession(targetProjectId, createdSession);
			activateWorkbenchView("chat");
			setAgentActiveSession(createdSession.id);
			await refreshSnapshot(createdSession.id);
			requestComposerFocus(createdSession.id);
			return createdSession;
		},
		[
			projects.activeProjectId,
			projects.upsertProjectSession,
			activateWorkbenchView,
			refreshSnapshot,
			requestComposerFocus,
			sessions.createSession,
			setAgentActiveSession,
		],
	);

	const handleCreatePrimarySession = useCallback(async (): Promise<void> => {
		if (activeSession && isActiveNewConversation) {
			activateWorkbenchView("chat");
			requestComposerFocus(activeSession.id);
			return;
		}

		await createSessionForProject(projects.activeProjectId);
	}, [
		activeSession,
		activateWorkbenchView,
		createSessionForProject,
		isActiveNewConversation,
		projects.activeProjectId,
		requestComposerFocus,
	]);

	const handleSelectSession = useCallback(
		(sessionId: string, projectId?: string): Promise<void> => {
			const optimisticSession =
				(projectId ? sidebarSessionsByProjectId[projectId] : sessions.sessions)?.find(
					(session) => session.id === sessionId,
				) ?? sessions.sessions.find((session) => session.id === sessionId);
			activateWorkbenchView("chat");
			startSessionNavigationTransition(async () => {
				if (optimisticSession) {
					setOptimisticActiveSession(optimisticSession);
				}
				if (projectId && projectId !== projects.activeProjectId) {
					await projects.switchProject(projectId);
				}
				await sessions.switchSession(sessionId, projectId);
			});
			return Promise.resolve();
		},
		[
			activateWorkbenchView,
			projects.activeProjectId,
			projects.switchProject,
			setOptimisticActiveSession,
			sidebarSessionsByProjectId,
			sessions.sessions,
			sessions.switchSession,
		],
	);

	const handleSubmitPrompt = useCallback(
		async (request: DesktopPromptSubmission): Promise<void> => {
			setPendingPromptSubmissions((current) => current + 1);
			try {
				await prompt(request);
			} finally {
				setPendingPromptSubmissions((current) => Math.max(0, current - 1));
			}
		},
		[prompt],
	);

	const handleExecutePlan = useCallback(async (): Promise<void> => {
		setPendingPromptSubmissions((current) => current + 1);
		try {
			await executePlan();
		} finally {
			setPendingPromptSubmissions((current) => Math.max(0, current - 1));
		}
	}, [executePlan]);

	const handleCompact = useCallback(
		async (customInstructions?: string): Promise<void> => {
			setPendingPromptSubmissions((current) => current + 1);
			try {
				await compact(customInstructions);
			} finally {
				setPendingPromptSubmissions((current) => Math.max(0, current - 1));
			}
		},
		[compact],
	);

	const handleConsumeProposedPlan = useCallback(
		async (planMessageId: string): Promise<void> => {
			await consumeProposedPlan(planMessageId);
		},
		[consumeProposedPlan],
	);

	useEffect(() => {
		if (isStreaming || showQueuedStatus) {
			setShowCompletedStatus(false);
			return;
		}
	}, [isStreaming, showQueuedStatus]);

	useEffect(() => {
		if (isStreaming) {
			wasStreamingRef.current = true;
			setShowCompletedStatus(false);
			return;
		}

		if (!wasStreamingRef.current) {
			return;
		}

		wasStreamingRef.current = false;
		if (bridgeError || errorMessage) {
			return;
		}

		setShowCompletedStatus(true);
		const timeoutId = window.setTimeout(() => setShowCompletedStatus(false), 1800);
		return () => window.clearTimeout(timeoutId);
	}, [bridgeError, errorMessage, isStreaming]);

	const primeReviewWorkspacePanel = useCallback((): void => {
		setHasRequestedReviewPanel(true);
		void preloadReviewWorkspacePanel();
	}, []);

	useEffect(() => {
		if (activeView !== "chat" || !reviewWorkspaceKey || hasRequestedReviewPanel) {
			return;
		}

		primeReviewWorkspacePanel();
	}, [activeView, hasRequestedReviewPanel, primeReviewWorkspacePanel, reviewWorkspaceKey]);

	function closeReviewWorkspace(): void {
		if (reviewWorkspaceKey) {
			setReviewOpenKeys((currentKeys) => {
				const nextKeys = new Set(currentKeys);
				nextKeys.delete(reviewWorkspaceKey);
				return nextKeys;
			});
		}
		requestAnimationFrame(() => reviewTriggerRef.current?.focus());
	}

	function openReviewWorkspace(): void {
		primeReviewWorkspacePanel();
		if (!reviewWorkspaceKey) {
			return;
		}
		setReviewOpenKeys((currentKeys) => {
			const nextKeys = new Set(currentKeys);
			nextKeys.add(reviewWorkspaceKey);
			return nextKeys;
		});
	}

	const toggleWorkspacePanel = useCallback((): void => {
		if (!workspacePanelKey || !isWorkspacePanelAvailable) {
			return;
		}
		setHiddenWorkspacePanelKeys((currentKeys) => {
			const nextKeys = new Set(currentKeys);
			if (nextKeys.has(workspacePanelKey)) {
				nextKeys.delete(workspacePanelKey);
			} else {
				nextKeys.add(workspacePanelKey);
			}
			return nextKeys;
		});
	}, [isWorkspacePanelAvailable, workspacePanelKey]);

	const toggleTerminalPanel = useCallback((): void => {
		setIsTerminalOpen((currentIsOpen) => !currentIsOpen);
	}, []);

	const handleReviewChromeSummaryChange = useCallback((summary: ReviewWorkspaceChromeSummary | undefined): void => {
		setReviewChromeSummary(summary);
	}, []);

	function openWorkspacePreviewFile(path: string): void {
		primeReviewWorkspacePanel();
		if (!reviewWorkspaceKey) {
			return;
		}
		setReviewOpenKeys((currentKeys) => {
			const nextKeys = new Set(currentKeys);
			nextKeys.add(reviewWorkspaceKey);
			return nextKeys;
		});
		workspacePreviewRequestNonceRef.current += 1;
		setWorkspacePreviewRequest({
			nonce: workspacePreviewRequestNonceRef.current,
			path,
		});
	}

	const openSubagentDetail = useCallback(
		(request: Omit<DesktopSubagentOpenRequest, "nonce">): void => {
			primeReviewWorkspacePanel();
			if (!reviewWorkspaceKey) {
				return;
			}
			setReviewOpenKeys((currentKeys) => {
				const nextKeys = new Set(currentKeys);
				nextKeys.add(reviewWorkspaceKey);
				return nextKeys;
			});
			subagentRequestNonceRef.current += 1;
			setSubagentRequest({
				...request,
				nonce: subagentRequestNonceRef.current,
			});
		},
		[primeReviewWorkspacePanel, reviewWorkspaceKey],
	);

	const handleOpenEnvironmentResource = useCallback(
		(resource: DesktopEnvironmentResource): void => {
			if (resource.provider === "subagent") {
				const subagentId = resource.metadata.subagentId;
				if (!subagentId) {
					return;
				}
				openSubagentDetail({
					parentSessionId: resource.sessionId,
					subagentId,
					title: resource.title,
				});
				return;
			}
			environmentTerminalRequestIdRef.current += 1;
			setIsTerminalOpen(true);
			setEnvironmentTerminalRequest({
				requestId: environmentTerminalRequestIdRef.current,
				resourceId: resource.id,
				title: resource.title,
			});
		},
		[openSubagentDetail],
	);

	const handleReviewFullscreenChange = useCallback(
		(next: boolean): void => {
			if (!reviewWorkspaceKey) {
				return;
			}
			setReviewFullscreenKeys((currentKeys) => {
				const nextKeys = new Set(currentKeys);
				if (next) {
					nextKeys.add(reviewWorkspaceKey);
				} else {
					nextKeys.delete(reviewWorkspaceKey);
				}
				return nextKeys;
			});
		},
		[reviewWorkspaceKey],
	);

	async function openCapabilitiesView(): Promise<void> {
		const requestId = beginWorkbenchViewSwitch("capabilities");
		setHasRequestedCapabilitiesPage(true);
		await Promise.allSettled([
			preloadCapabilitiesPage(),
			capabilities.hasLoaded ? Promise.resolve() : capabilities.loadCapabilities(),
		]);
		finishWorkbenchViewSwitch(requestId, "capabilities");
	}

	async function openEventsView(): Promise<void> {
		const requestId = beginWorkbenchViewSwitch("events");
		setHasRequestedEventsPage(true);
		await Promise.allSettled([preloadEventsPage(), events.hasLoaded ? Promise.resolve() : events.refreshEvents()]);
		finishWorkbenchViewSwitch(requestId, "events");
	}

	const handleRunEvent = useCallback(
		async (request: Parameters<typeof events.runEvent>[0]) => {
			const result = await events.runEvent(request);
			if (result) {
				await projects.refreshProjects();
				await sessions.refreshSessions();
			}
			return result;
		},
		[events.runEvent, projects.refreshProjects, sessions.refreshSessions],
	);

	const handleOpenEventSession = useCallback(
		async (sessionId: string, projectId: string): Promise<void> => {
			activateWorkbenchView("chat");
			if (projectId !== projects.activeProjectId) {
				await projects.switchProject(projectId);
			}
			await sessions.switchSession(sessionId, projectId);
		},
		[activateWorkbenchView, projects.activeProjectId, projects.switchProject, sessions.switchSession],
	);

	function openSettingsWindow(request?: DesktopSettingsOpenRequest): void {
		setSettingsOpenRequest(request);
		if (typeof desktopAgent.openSettingsWindow !== "function") {
			activateWorkbenchView("settings");
			return;
		}
		void desktopAgent.openSettingsWindow(request).catch(() => activateWorkbenchView("settings"));
	}

	function isReviewTitlebarSummaryVisible(isSidebarCollapsed: boolean): boolean {
		return isChatView && isSidebarCollapsed && isReviewFullscreenActive;
	}

	return (
		<>
			{activeView === "settings" ? (
				<Suspense fallback={<LazyWorkbenchFallback label="Loading settings" />}>
					<SettingsPage
						errorMessage={settings.errorMessage}
						eventManagementCriteria={settings.eventManagementCriteria}
						isLoading={settings.isLoading}
						isSaving={settings.isSaving}
						onBack={isDedicatedSettingsWindow ? undefined : () => activateWorkbenchView("chat")}
						onCancelOAuthLogin={settings.cancelOAuthLogin}
						onDeleteProviderKey={settings.deleteProviderKey}
						onLogoutOAuthProvider={settings.logoutOAuthProvider}
						onSaveAppearanceSettings={settings.saveAppearanceSettings}
						onSaveEventManagementCriteria={settings.saveEventManagementCriteria}
						onSaveGeneralSettings={settings.saveGeneralSettings}
						onSavePermissionApprovalSettings={settings.savePermissionApprovalSettings}
						onSaveProviderKey={settings.setProviderKey}
						onStartOAuthLogin={settings.startOAuthLogin}
						onSubmitOAuthLoginCode={settings.submitOAuthLoginCode}
						onTestProviderKey={settings.testProviderKey}
						oauthLogin={settings.oauthLogin}
						oauthProviders={settings.oauthProviders}
						providerKeys={settings.providerKeys}
						runtimeCatalog={settings.runtimeCatalog}
						settingsOpenRequest={settingsOpenRequest}
						settings={settings.settings}
						storageSecurityState={settings.storageSecurityState}
					/>
				</Suspense>
			) : (
				<AppLayout
					sidebar={(sidebarControls) => (
						<Sidebar
							activeProjectId={projects.activeProjectId}
							activeSessionId={isChatView ? displayedActiveSessionId : undefined}
							errorMessage={projects.errorMessage ?? sessions.errorMessage}
							isBusy={isSidebarBusy}
							isPreparingEventAttachments={events.isPreparingAttachments}
							isSavingEvent={events.isSaving}
							isSidebarCollapsed={sidebarControls.isSidebarCollapsed}
							isLoading={projects.isLoading || sessions.isLoading}
							onCreateEvent={events.createEvent}
							onCreateProjectFromFolder={projects.createProjectFromFolder}
							onCreatePrimarySession={handleCreatePrimarySession}
							onCreateSession={createSessionForProject}
							onDeleteSession={canDeleteSessions ? handleDeleteSession : undefined}
							onOpenCapabilities={openCapabilitiesView}
							onOpenEventAttachments={events.openEventAttachments}
							onOpenEvents={openEventsView}
							onOpenSettings={openSettingsWindow}
							onSelectProject={projects.switchProject}
							onSelectSession={handleSelectSession}
							projects={projects.projects}
							selectedPrimaryItem={selectedPrimaryItem}
							eventCount={events.events.filter((event) => event.status !== "discarded").length}
							runningEventCount={events.events.filter((event) => event.status === "running").length}
							sessionsByProjectId={sidebarSessionsByProjectId}
						/>
					)}
					titlebarControls={({ isSidebarCollapsed }) =>
						isSidebarCollapsed ? (
							<>
								<IconButton
									aria-label="新对话"
									className="size-7 rounded-lg text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] disabled:opacity-45"
									disabled={sessions.isCreating || !projects.activeProjectId}
									onClick={() => {
										void handleCreatePrimarySession();
									}}
									size="sm"
									title="新对话"
								>
									<PencilLine className="size-3.5 translate-y-px stroke-[1.75]" />
								</IconButton>
								{isReviewTitlebarSummaryVisible(isSidebarCollapsed) && reviewChromeSummary ? (
									<ReviewFullscreenTitlebarSummary summary={reviewChromeSummary} />
								) : null}
							</>
						) : null
					}
				>
					{({ isSidebarCollapsed }) => (
						<div className="relative h-full min-h-0" data-slot="workbench-view-stack">
							<div
								aria-hidden={!isChatView}
								className={getWorkbenchViewClass(isChatView)}
								data-paint-state="painted"
								data-slot="chat-workbench-view"
								data-view-state={isChatView ? "active" : "inactive"}
								inert={!isChatView}
							>
								<LayoutGroup id="chat-review-workbench">
									<motion.div
										className="relative flex h-full min-h-0 min-w-0 overflow-hidden"
										data-review-open={isReviewOpen}
										data-slot="chat-workbench"
									>
										<motion.div
											aria-hidden={isReviewFullscreenActive ? true : undefined}
											className={`grid h-full min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-xl)] border border-[color:var(--border-subtle)] bg-[color:var(--background)] shadow-[var(--shadow-middle)] ${
												isReviewFullscreenActive ? "pointer-events-none opacity-0" : ""
											}`}
											data-review-fullscreen-obscured={isReviewFullscreenActive ? "true" : undefined}
											data-review-attachment={
												isReviewOpen && !isReviewFullscreenActive ? "attached" : "detached"
											}
											data-sidebar-attachment={isSidebarCollapsed ? "detached" : "attached"}
											data-slot="main-workbench-panel"
											inert={isReviewFullscreenActive}
										>
											<WorkbenchHeader
												isReviewOpen={isReviewOpen}
												isTerminalOpen={isTerminalOpen}
												isWorkspacePanelOpen={isWorkspacePanelOpen}
												onOpenReview={openReviewWorkspace}
												onToggleTerminal={toggleTerminalPanel}
												onToggleWorkspacePanel={toggleWorkspacePanel}
												reviewButtonRef={reviewTriggerRef}
												runtimeState={runtimeState}
												sessionMeta={sessionMeta}
												sessionTitle={sessionTitle}
												terminalAvailable={terminalAvailable}
												workspacePanelAvailable={isWorkspacePanelAvailable}
												workspaceLabel={workspaceLabel}
											/>
											<div className="min-h-0 min-w-0 overflow-hidden" data-slot="main-workbench-content">
												{hasEmptyActiveProject ? (
													<EmptyProjectWorkspace
														projectName={projects.activeProject?.name ?? "当前项目"}
													/>
												) : (
													<ChatWorkbench
														capabilityCatalog={capabilities.hasLoaded ? capabilities.catalog : undefined}
														composerFocusRequest={composerFocusRequest}
														onAbort={abort}
														onCompact={handleCompact}
														onConsumeProposedPlan={handleConsumeProposedPlan}
														onExecutePlan={handleExecutePlan}
														onOpenEnvironmentResource={handleOpenEnvironmentResource}
														onOpenSettings={openSettingsWindow}
														onOpenSubagent={openSubagentDetail}
														onOpenWorkspacePreviewFile={openWorkspacePreviewFile}
														onRequestCapabilities={requestCapabilitiesCatalog}
														onSetSessionMode={setSessionMode}
														onSubmitPrompt={handleSubmitPrompt}
														onUpdateSessionProfile={updateSessionProfile}
														oauthProviders={settings.oauthProviders}
														providerKeys={settings.providerKeys}
														runtimeCatalog={settings.runtimeCatalog}
														showThinkingBlocks={settings.settings.showThinkingBlocks ?? false}
														isWorkspacePanelOpen={isWorkspacePanelOpen}
														workspaceStatus={workspaceStatus}
													/>
												)}
											</div>
											<TerminalPanel
												cwd={terminalCwd}
												isOpen={isTerminalOpen}
												onOpenChange={setIsTerminalOpen}
												openEnvironmentResourceRequest={environmentTerminalRequest}
												sessionId={sessions.activeSessionId}
											/>
										</motion.div>
										{hasRequestedReviewPanel ? (
											<Suspense fallback={null}>
												<ReviewWorkspacePanel
													isFullscreen={isReviewFullscreen}
													isTitlebarSummaryVisible={isReviewTitlebarSummaryVisible(isSidebarCollapsed)}
													onClose={closeReviewWorkspace}
													onChromeSummaryChange={handleReviewChromeSummaryChange}
													onFullscreenChange={handleReviewFullscreenChange}
													open={isReviewOpen}
													previewRequest={workspacePreviewRequest}
													projectId={projects.activeProjectId}
													sessionId={sessions.activeSessionId}
													subagentRequest={subagentRequest}
													workspaceLabel={workspaceLabel}
												/>
											</Suspense>
										) : null}
									</motion.div>
								</LayoutGroup>
							</div>
							<div
								aria-hidden={!isCapabilitiesView}
								className={getWorkbenchViewClass(isCapabilitiesView)}
								data-slot="capabilities-workbench-view"
								data-view-state={isCapabilitiesView ? "active" : "inactive"}
								inert={!isCapabilitiesView}
							>
								{hasRequestedCapabilitiesPage ? (
									<Suspense fallback={null}>
										<CapabilitiesPage
											catalog={capabilities.catalog}
											errorMessage={capabilities.errorMessage}
											isLoading={capabilities.isLoading}
											isSaving={capabilities.isSaving}
											isSidebarCollapsed={isSidebarCollapsed}
											onCreateSkill={capabilities.createSkill}
											onGetCapabilityDetail={capabilities.getCapabilityDetail}
											onReload={capabilities.reloadCapabilities}
											onRestartMcpServer={capabilities.restartMcpServer}
											onSetMcpServerEnabled={capabilities.setMcpServerEnabled}
											onTestMcpServer={capabilities.testMcpServer}
											onUpsertMcpServer={capabilities.upsertMcpServer}
											onUpsertPromptTemplate={capabilities.upsertPromptTemplate}
										/>
									</Suspense>
								) : null}
							</div>
							<div
								aria-hidden={!isEventsView}
								className={getWorkbenchViewClass(isEventsView)}
								data-slot="events-workbench-view"
								data-view-state={isEventsView ? "active" : "inactive"}
								inert={!isEventsView}
							>
								{hasRequestedEventsPage ? (
									<Suspense fallback={null}>
										<EventsPage
											activeEvent={events.activeEvent}
											activeEventId={events.activeEventId}
											activeProjectId={projects.activeProjectId}
											errorMessage={events.errorMessage}
											eventManagementProposal={events.eventManagementProposal}
											events={events.events}
											isLoading={events.isLoading}
											isManagingEvents={events.isManagingEvents}
											isRunning={events.isRunning}
											isSaving={events.isSaving}
											isSidebarCollapsed={isSidebarCollapsed}
											onAddEventComment={events.addEventComment}
											onApplyEventManagementProposal={events.applyEventManagementProposal}
											onClearEventManagementProposal={events.clearEventManagementProposal}
											onCreateProjectFromFolder={projects.createProjectFromFolder}
											onCreateEventManagementProposal={events.createEventManagementProposal}
											onDeleteEvent={events.deleteEvent}
											onOpenSession={handleOpenEventSession}
											onRefreshEvents={events.refreshEvents}
											onRunEvent={handleRunEvent}
											onSelectEvent={events.selectEvent}
											onSetEventStatus={events.setEventStatus}
											onUpdateEvent={events.updateEvent}
											projects={projects.projects}
										/>
									</Suspense>
								) : null}
							</div>
						</div>
					)}
				</AppLayout>
			)}
			<ApprovalCenter />
		</>
	);
}
