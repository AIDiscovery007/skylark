"use client";

import { ChevronDownIcon, RefreshCcw } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const WEB_PREVIEW_DEFAULT_SANDBOX =
	"allow-scripts allow-same-origin allow-forms allow-popups allow-presentation";
export const WEB_PREVIEW_LOCAL_SANDBOX = "allow-scripts allow-same-origin allow-forms";

export interface WebPreviewConsoleLog {
	level: "error" | "log" | "warn";
	message: string;
	timestamp: Date;
}

export interface WebPreviewContextValue {
	consoleOpen: boolean;
	setConsoleOpen: (open: boolean) => void;
	setUrl: (url: string) => void;
	url: string;
}

const WebPreviewContext = createContext<WebPreviewContextValue | undefined>(undefined);

function useWebPreview(): WebPreviewContextValue {
	const context = useContext(WebPreviewContext);
	if (!context) {
		throw new Error("WebPreview components must be used within WebPreview");
	}
	return context;
}

export type WebPreviewProps = ComponentProps<"div"> & {
	defaultUrl?: string;
	onUrlChange?: (url: string) => void;
};

export function WebPreview({ children, className, defaultUrl = "", onUrlChange, ...props }: WebPreviewProps) {
	const [url, setUrlState] = useState(defaultUrl);
	const [consoleOpen, setConsoleOpen] = useState(false);

	useEffect(() => {
		setUrlState(defaultUrl);
	}, [defaultUrl]);

	const setUrl = useCallback(
		(nextUrl: string) => {
			setUrlState(nextUrl);
			onUrlChange?.(nextUrl);
		},
		[onUrlChange],
	);
	const contextValue = useMemo(() => ({ consoleOpen, setConsoleOpen, setUrl, url }), [consoleOpen, setUrl, url]);

	return (
		<WebPreviewContext.Provider value={contextValue}>
			<div
				className={cn("flex size-full min-h-0 min-w-0 flex-col bg-[color:var(--background)]", className)}
				{...props}
			>
				{children}
			</div>
		</WebPreviewContext.Provider>
	);
}

export type WebPreviewNavigationProps = ComponentProps<"div">;

export function WebPreviewNavigation({ children, className, ...props }: WebPreviewNavigationProps) {
	return (
		<div
			className={cn("flex h-10 shrink-0 items-center gap-2 bg-[color:var(--surface-1)] px-3", className)}
			{...props}
		>
			{children}
		</div>
	);
}

export type WebPreviewNavigationButtonProps = ComponentProps<typeof Button> & {
	tooltip?: string;
};

export function WebPreviewNavigationButton({
	children,
	className,
	tooltip,
	...props
}: WebPreviewNavigationButtonProps) {
	const button = (
		<Button aria-label={tooltip} className={className} size="icon-xs" type="button" variant="ghost" {...props}>
			{children ?? <RefreshCcw className="size-3.5" />}
		</Button>
	);

	if (!tooltip) {
		return button;
	}

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent>{tooltip}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

export type WebPreviewUrlProps = ComponentProps<typeof Input>;

function selectInputValue(input: HTMLInputElement): void {
	input.setSelectionRange(0, input.value.length);
}

export function WebPreviewUrl({ onChange, onFocus, onKeyDown, onMouseUp, value, ...props }: WebPreviewUrlProps) {
	const { setUrl, url } = useWebPreview();
	const [inputValue, setInputValue] = useState(url);
	const preserveFocusSelectionRef = useRef(false);

	useEffect(() => {
		setInputValue(url);
	}, [url]);

	return (
		<Input
			className="h-8 min-w-0 flex-1 border-transparent bg-[color:var(--surface-2)] font-mono text-[12px] shadow-none"
			onChange={(event) => {
				setInputValue(event.target.value);
				onChange?.(event);
			}}
			onFocus={(event) => {
				preserveFocusSelectionRef.current = true;
				selectInputValue(event.currentTarget);
				onFocus?.(event);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					setUrl((event.target as HTMLInputElement).value);
				}
				onKeyDown?.(event);
			}}
			onMouseUp={(event) => {
				if (preserveFocusSelectionRef.current) {
					preserveFocusSelectionRef.current = false;
					event.preventDefault();
				}
				onMouseUp?.(event);
			}}
			placeholder="http://localhost:3000"
			value={value ?? inputValue}
			{...props}
		/>
	);
}

export type WebPreviewBodyProps = ComponentProps<"iframe"> & {
	loading?: ReactNode;
};

export function WebPreviewBody({ className, loading, sandbox, src, title = "Preview", ...props }: WebPreviewBodyProps) {
	const { url } = useWebPreview();
	return (
		<div
			className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[color:var(--background)]"
			data-slot="workspace-preview-viewport"
		>
			<iframe
				className={cn("absolute inset-0 block h-full w-full border-0 bg-white", className)}
				data-slot="workspace-preview-frame"
				sandbox={sandbox ?? WEB_PREVIEW_DEFAULT_SANDBOX}
				src={(src ?? url) || undefined}
				title={title}
				{...props}
			/>
			{loading}
		</div>
	);
}

export type WebPreviewConsoleProps = ComponentProps<"div"> & {
	logs?: WebPreviewConsoleLog[];
};

function getConsoleLogClassName(level: WebPreviewConsoleLog["level"]): string {
	switch (level) {
		case "error":
			return "text-[color:var(--destructive)]";
		case "warn":
			return "text-[color:var(--warning)]";
		case "log":
			return "text-[color:var(--text-primary)]";
	}
}

export function WebPreviewConsole({ children, className, logs = [], ...props }: WebPreviewConsoleProps) {
	const { consoleOpen, setConsoleOpen } = useWebPreview();

	return (
		<Collapsible
			className={cn(
				"shrink-0 bg-[color:var(--surface-1)] font-mono text-[12px] shadow-[inset_0_1px_0_var(--border-subtle)]",
				className,
			)}
			onOpenChange={setConsoleOpen}
			open={consoleOpen}
			{...props}
		>
			<CollapsibleTrigger asChild>
				<Button
					aria-expanded={consoleOpen}
					className="h-9 w-full justify-between rounded-none px-3 text-left font-medium shadow-none hover:bg-[color:var(--surface-2)]"
					type="button"
					variant="ghost"
				>
					<span>Console</span>
					<ChevronDownIcon
						className={cn(
							"size-3.5 transition-transform duration-[var(--duration-fast)]",
							consoleOpen && "rotate-180",
						)}
					/>
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
				<div className="native-scrollbar max-h-48 space-y-1 overflow-y-auto px-3 pb-3">
					{logs.length === 0 && !children ? (
						<p className="text-[color:var(--text-tertiary)]">No console output</p>
					) : (
						logs.map((log) => (
							<div
								className={cn(
									"grid grid-cols-[5.25rem_minmax(0,1fr)] gap-2",
									getConsoleLogClassName(log.level),
								)}
								key={`${log.timestamp.getTime()}-${log.level}-${log.message}`}
							>
								<span className="text-[color:var(--text-tertiary)]">{log.timestamp.toLocaleTimeString()}</span>
								<span className="min-w-0 break-words">{log.message}</span>
							</div>
						))
					)}
					{children}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
