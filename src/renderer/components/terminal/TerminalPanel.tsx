import { ChevronDown, Plus, RotateCcw, TerminalSquare, X } from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import { type CSSProperties, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { Spinner } from "@/components/ui/spinner";
import type { DesktopTerminalSource } from "../../../shared/types.ts";
import { activityDrawerTransition, noMotionTransition } from "../../lib/motion.ts";
import { cn } from "../../lib/utils.ts";

const DEFAULT_TERMINAL_HEIGHT = 260;
const MIN_TERMINAL_HEIGHT = 160;
const MAX_TERMINAL_HEIGHT = 560;
const COLLAPSED_TERMINAL_HEIGHT = 0;

const TerminalSession = lazy(async () => {
	const module = await import("./TerminalSession.tsx");
	return { default: module.TerminalSession };
});

export interface TerminalPanelProps {
	cwd?: string;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	openEnvironmentResourceRequest?: {
		requestId: number;
		resourceId: string;
		title: string;
	};
	sessionId?: string;
}

interface TerminalTab {
	id: string;
	source: DesktopTerminalSource;
	title: string;
	restartToken: number;
	errorMessage?: string;
	exitMessage?: string;
}

function clampHeight(value: number): number {
	return Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, value));
}

function getTerminalTitle(index: number): string {
	return `Terminal ${index}`;
}

export function TerminalPanel({
	cwd,
	isOpen,
	onOpenChange,
	openEnvironmentResourceRequest,
	sessionId,
}: TerminalPanelProps) {
	const resizeDragCleanupRef = useRef<(() => void) | undefined>(undefined);
	const terminalIdCounterRef = useRef(0);
	const terminalTitleCounterRef = useRef(0);
	const terminalScopeRef = useRef<string | undefined>(undefined);
	const [isResizing, setIsResizing] = useState(false);
	const [height, setHeight] = useState(DEFAULT_TERMINAL_HEIGHT);
	const [tabs, setTabs] = useState<TerminalTab[]>([]);
	const [activeTerminalId, setActiveTerminalId] = useState<string | undefined>();
	const [hasOpenedInitialTerminal, setHasOpenedInitialTerminal] = useState(false);
	const canStart = Boolean(sessionId && cwd);
	const activeTab = tabs.find((tab) => tab.id === activeTerminalId);
	const resolvedHeight = isOpen ? height : COLLAPSED_TERMINAL_HEIGHT;
	const terminalScope = `${sessionId ?? "no-session"}:${cwd ?? "no-cwd"}`;
	const environmentRequestIdRef = useRef<number | undefined>(undefined);

	const createTerminalTab = useCallback((source: DesktopTerminalSource): TerminalTab => {
		const idIndex = terminalIdCounterRef.current + 1;
		const titleIndex = terminalTitleCounterRef.current + 1;
		terminalIdCounterRef.current = idIndex;
		terminalTitleCounterRef.current = titleIndex;
		return {
			id: `terminal-${idIndex}`,
			source,
			title: getTerminalTitle(titleIndex),
			restartToken: 0,
		};
	}, []);

	useEffect(() => {
		return () => {
			resizeDragCleanupRef.current?.();
		};
	}, []);

	useEffect(() => {
		if (terminalScopeRef.current === terminalScope) {
			return;
		}

		terminalScopeRef.current = terminalScope;
		terminalTitleCounterRef.current = 0;
		setTabs([]);
		setActiveTerminalId(undefined);
		setHasOpenedInitialTerminal(false);
	}, [terminalScope]);

	useEffect(() => {
		if (!isOpen || !sessionId || !cwd || hasOpenedInitialTerminal || tabs.length > 0) {
			return;
		}

		const nextTab = createTerminalTab({ type: "shell", cwd });
		setTabs([nextTab]);
		setActiveTerminalId(nextTab.id);
		setHasOpenedInitialTerminal(true);
	}, [createTerminalTab, cwd, hasOpenedInitialTerminal, isOpen, sessionId, tabs.length]);

	useEffect(() => {
		if (tabs.length === 0) {
			if (activeTerminalId) {
				setActiveTerminalId(undefined);
			}
			return;
		}

		if (!activeTab) {
			setActiveTerminalId(tabs[0]?.id);
		}
	}, [activeTab, activeTerminalId, tabs]);

	useEffect(() => {
		if (!sessionId || !openEnvironmentResourceRequest) {
			return;
		}
		if (environmentRequestIdRef.current === openEnvironmentResourceRequest.requestId) {
			return;
		}
		environmentRequestIdRef.current = openEnvironmentResourceRequest.requestId;
		onOpenChange(true);
		setHasOpenedInitialTerminal(true);
		const existingTab = tabs.find(
			(tab) =>
				tab.source.type === "environment_resource" &&
				tab.source.resourceId === openEnvironmentResourceRequest.resourceId,
		);
		if (existingTab) {
			setActiveTerminalId(existingTab.id);
			return;
		}
		const nextTab = createTerminalTab({
			type: "environment_resource",
			resourceId: openEnvironmentResourceRequest.resourceId,
			readOnly: true,
		});
		const titledTab = { ...nextTab, title: openEnvironmentResourceRequest.title };
		setTabs((current) => [...current, titledTab]);
		setActiveTerminalId(titledTab.id);
	}, [createTerminalTab, onOpenChange, openEnvironmentResourceRequest, sessionId, tabs]);

	function addTerminalTab(): void {
		onOpenChange(true);
		if (!sessionId || !cwd) {
			return;
		}

		const nextTab = createTerminalTab({ type: "shell", cwd });
		setTabs((current) => [...current, nextTab]);
		setActiveTerminalId(nextTab.id);
		setHasOpenedInitialTerminal(true);
	}

	function updateTerminalTab(
		tabId: string,
		changes: Partial<Pick<TerminalTab, "errorMessage" | "exitMessage">>,
	): void {
		setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...changes } : tab)));
	}

	function restartActiveTerminal(): void {
		if (!activeTerminalId) {
			return;
		}
		setTabs((current) =>
			current.map((tab) =>
				tab.id === activeTerminalId
					? { ...tab, restartToken: tab.restartToken + 1, errorMessage: undefined, exitMessage: undefined }
					: tab,
			),
		);
	}

	function closeTerminalTab(tabId: string): void {
		setTabs((current) => {
			const closingIndex = current.findIndex((tab) => tab.id === tabId);
			if (closingIndex === -1) {
				return current;
			}

			const nextTabs = current.filter((tab) => tab.id !== tabId);
			if (activeTerminalId === tabId) {
				setActiveTerminalId(nextTabs[closingIndex]?.id ?? nextTabs[closingIndex - 1]?.id);
			}
			return nextTabs;
		});
	}

	function startResize(): void {
		resizeDragCleanupRef.current?.();
		document.body.style.cursor = "ns-resize";
		setIsResizing(true);
		const handlePointerMove = (event: PointerEvent) => {
			const nextHeight = window.innerHeight - event.clientY;
			setHeight(clampHeight(nextHeight));
		};
		const handlePointerUp = () => {
			document.body.style.cursor = "";
			setIsResizing(false);
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			resizeDragCleanupRef.current = undefined;
		};
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		resizeDragCleanupRef.current = handlePointerUp;
	}

	return (
		<MotionConfig reducedMotion="never">
			<motion.section
				animate={{ height: resolvedHeight }}
				className="relative shrink-0 overflow-hidden bg-[color:var(--surface-1)] shadow-none"
				data-motion="structural-drawer"
				data-motion-engine="motion"
				data-motion-mode="drawer"
				data-motion-origin="bottom"
				data-motion-owner="spacer"
				data-motion-scope="structural"
				data-slot="terminal-panel"
				data-state={isOpen ? "open" : "closed"}
				data-structural-layout-driver="height"
				initial={false}
				style={
					{
						"--structural-drawer-size": `${resolvedHeight}px`,
					} as CSSProperties
				}
				transition={isResizing ? noMotionTransition : activityDrawerTransition}
			>
				<div
					className="absolute inset-x-0 top-0 flex min-h-0 flex-col overflow-hidden"
					data-motion="structural-drawer"
					data-motion-engine="motion"
					data-motion-mode="drawer"
					data-motion-origin="bottom"
					data-motion-owner="fixed-content"
					data-motion-scope="structural"
					data-slot="terminal-panel-content"
					style={{ height }}
				>
					{isOpen ? (
						<button
							aria-label="Resize terminal"
							className="group block h-2 w-full shrink-0 cursor-ns-resize bg-transparent"
							onPointerDown={startResize}
							type="button"
						>
							<span className="mx-auto mt-1 block h-px w-12 rounded-full bg-transparent transition-colors group-hover:bg-[color:color-mix(in_oklch,var(--foreground)_10%,transparent)]" />
						</button>
					) : null}
					{isOpen ? (
						<div
							className="flex h-10 shrink-0 items-center justify-between gap-3 px-4"
							data-slot="terminal-toolbar"
						>
							<div className="flex min-w-0 flex-1 items-center gap-2">
								<button
									className="flex min-w-0 shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-[13px] font-medium text-[color:var(--text-secondary)] transition-colors hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--control-focus-shadow)]"
									onClick={() => onOpenChange(false)}
									type="button"
								>
									<TerminalSquare className="size-3.5 shrink-0" />
									<span>Terminal</span>
								</button>
								<div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" role="tablist">
									{tabs.map((tab) => {
										const isActive = tab.id === activeTerminalId;
										return (
											<div
												className={cn(
													"group flex h-7 min-w-0 max-w-48 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-xs transition-colors",
													isActive
														? "bg-[color:var(--surface-2)] text-[color:var(--text-primary)]"
														: "text-[color:var(--text-tertiary)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-secondary)]",
												)}
												data-slot="terminal-tab"
												key={tab.id}
											>
												<button
													aria-selected={isActive}
													className="min-w-0 flex-1 truncate text-left focus-visible:outline-none focus-visible:shadow-[var(--control-focus-shadow)]"
													onClick={() => {
														setActiveTerminalId(tab.id);
														onOpenChange(true);
													}}
													role="tab"
													type="button"
												>
													{tab.title}
												</button>
												<button
													aria-label={`Close ${tab.title}`}
													className="shrink-0 rounded-[var(--radius-xs)] p-0.5 text-[color:var(--text-tertiary)] opacity-60 transition hover:bg-[color:var(--surface-3)] hover:text-[color:var(--text-primary)] group-hover:opacity-100 focus-visible:outline-none focus-visible:shadow-[var(--control-focus-shadow)]"
													onClick={() => closeTerminalTab(tab.id)}
													type="button"
												>
													<X className="size-3" />
												</button>
											</div>
										);
									})}
									<IconButton
										aria-label="New terminal"
										className="shadow-none hover:shadow-none focus-visible:shadow-[var(--control-focus-shadow)] focus-visible:ring-0"
										disabled={!canStart}
										onClick={addTerminalTab}
										size="sm"
										type="button"
									>
										<Plus className="size-3.5" />
									</IconButton>
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-1">
								{activeTab?.exitMessage ? (
									<span className="max-w-80 truncate text-xs text-[color:var(--text-tertiary)]">
										{activeTab.exitMessage}
									</span>
								) : null}
								{activeTab?.errorMessage ? (
									<span className="max-w-80 truncate text-xs text-[color:var(--destructive)]">
										{activeTab.errorMessage}
									</span>
								) : null}
								<IconButton
									aria-label="Restart terminal"
									className="shadow-none hover:shadow-none focus-visible:shadow-[var(--control-focus-shadow)] focus-visible:ring-0"
									disabled={!isOpen || !canStart || !activeTerminalId}
									onClick={restartActiveTerminal}
									size="sm"
									type="button"
								>
									<RotateCcw className="size-3.5" />
								</IconButton>
								<IconButton
									aria-label="Collapse terminal"
									className="shadow-none hover:shadow-none focus-visible:shadow-[var(--control-focus-shadow)] focus-visible:ring-0"
									onClick={() => onOpenChange(false)}
									size="sm"
									type="button"
								>
									<ChevronDown className="size-4" />
								</IconButton>
							</div>
						</div>
					) : null}
					<div
						aria-hidden={!isOpen}
						className="relative min-h-0 flex-1 overflow-hidden bg-[color:var(--terminal-background)]"
						data-slot="terminal-body"
						inert={!isOpen}
						style={{ pointerEvents: isOpen ? "auto" : "none" }}
					>
						{canStart && sessionId && cwd && tabs.length > 0 ? (
							<Suspense
								fallback={
									<output
										aria-live="polite"
										className="flex h-full items-center gap-2 px-4 text-sm text-[color:var(--terminal-foreground)]"
										data-slot="terminal-loading"
									>
										<Spinner className="size-3.5" />
										<span>Loading terminal...</span>
									</output>
								}
							>
								{tabs.map((tab) => {
									const isActive = tab.id === activeTerminalId;
									return (
										<div
											aria-hidden={!isActive}
											className={cn(
												"absolute inset-0 min-h-0",
												isActive ? "opacity-100" : "pointer-events-none opacity-0",
											)}
											data-slot="terminal-tab-panel"
											key={tab.id}
										>
											<TerminalSession
												isActive={isActive}
												isPanelOpen={isOpen}
												onErrorMessageChange={(message) =>
													updateTerminalTab(tab.id, { errorMessage: message })
												}
												onExitMessageChange={(message) =>
													updateTerminalTab(tab.id, { exitMessage: message })
												}
												restartToken={tab.restartToken}
												sessionId={sessionId}
												source={tab.source}
												terminalId={tab.id}
											/>
										</div>
									);
								})}
							</Suspense>
						) : isOpen && canStart ? (
							<div className="flex h-full items-center justify-center px-4 text-sm text-[color:var(--terminal-foreground)]">
								<button
									className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[color:var(--surface-2)] px-3 py-1.5 text-[color:var(--text-secondary)] shadow-none transition hover:bg-[color:var(--surface-3)] hover:text-[color:var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--control-focus-shadow)]"
									onClick={addTerminalTab}
									type="button"
								>
									<Plus className="size-4" />
									<span>New terminal</span>
								</button>
							</div>
						) : isOpen ? (
							<div className="flex h-full items-center px-4 text-sm text-[color:var(--terminal-foreground)]">
								Open a workspace session to start a terminal.
							</div>
						) : null}
					</div>
				</div>
			</motion.section>
		</MotionConfig>
	);
}
