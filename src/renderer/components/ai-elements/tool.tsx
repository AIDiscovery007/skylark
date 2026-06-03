"use client";

import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { CheckCircleIcon, ChevronDownIcon, CircleIcon, ClockIcon, WrenchIcon, XCircleIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
	<Collapsible className={cn("group not-prose mb-4 w-full rounded-md border", className)} {...props} />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
	title?: string;
	className?: string;
} & (
	| { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
	| {
			type: DynamicToolUIPart["type"];
			state: DynamicToolUIPart["state"];
			toolName: string;
	  }
);

const statusLabels: Record<ToolPart["state"], string> = {
	"approval-requested": "Awaiting Approval",
	"approval-responded": "Responded",
	"input-available": "Running",
	"input-streaming": "Pending",
	"output-available": "Completed",
	"output-denied": "Denied",
	"output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
	"approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
	"approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
	"input-available": <ClockIcon className="size-4 animate-pulse" />,
	"input-streaming": <CircleIcon className="size-4" />,
	"output-available": <CheckCircleIcon className="size-4 text-green-600" />,
	"output-denied": <XCircleIcon className="size-4 text-orange-600" />,
	"output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolPart["state"]) => (
	<Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
		{statusIcons[status]}
		{statusLabels[status]}
	</Badge>
);

export const ToolHeader = ({ className, title, type, state, toolName, ...props }: ToolHeaderProps) => {
	const derivedName = type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

	return (
		<CollapsibleTrigger className={cn("flex w-full items-center justify-between gap-4 p-3", className)} {...props}>
			<div className="flex items-center gap-2">
				<WrenchIcon className="size-4 text-muted-foreground" />
				<span className="font-medium text-sm">{title ?? derivedName}</span>
				{getStatusBadge(state)}
			</div>
			<ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
		</CollapsibleTrigger>
	);
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
	<CollapsibleContent
		className={cn(
			"data-[state=closed]:fade-out-0 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
			className,
		)}
		{...props}
	/>
);

export type ToolInputProps = ComponentProps<"div"> & {
	input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
	<div className={cn("space-y-2 overflow-hidden", className)} {...props}>
		<h4 className="ui-detail-label">Parameters</h4>
		<div
			className="runtime-tool-section-scrollport rounded-md border border-border/70 bg-muted/35"
			data-slot="tool-input-viewport"
		>
			<CodeBlock
				className="border-0 bg-transparent shadow-none"
				code={JSON.stringify(input, null, 2)}
				language="json"
			/>
		</div>
	</div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
	output: ToolPart["output"];
	errorText: ToolPart["errorText"];
};

const TOOL_OUTPUT_VIEWPORT_CLASS = "runtime-tool-section-scrollport rounded-md border text-xs [&_table]:w-full";

function ToolOutputSection({
	children,
	title,
	tone = "neutral",
	viewportSlot,
}: {
	children: ReactNode;
	title: string;
	tone?: "neutral" | "error";
	viewportSlot: string;
}) {
	return (
		<div className="space-y-2">
			<h4 className="ui-detail-label">{title}</h4>
			<div
				className={cn(
					TOOL_OUTPUT_VIEWPORT_CLASS,
					tone === "error"
						? "border-destructive/15 bg-destructive/5 text-destructive"
						: "border-border/70 bg-muted/35 text-foreground",
				)}
				data-slot={viewportSlot}
			>
				{children}
			</div>
		</div>
	);
}

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
	if (!(output || errorText)) {
		return null;
	}

	const hasStructuredOutput = isValidElement(output);
	let Output: ReactNode = <div className="whitespace-pre-wrap break-words px-3 py-2">{output as ReactNode}</div>;

	if (typeof output === "object" && !hasStructuredOutput) {
		Output = (
			<CodeBlock
				className="border-0 bg-transparent shadow-none"
				code={JSON.stringify(output, null, 2)}
				language="json"
			/>
		);
	} else if (typeof output === "string") {
		Output = <CodeBlock className="border-0 bg-transparent shadow-none" code={output} language="log" />;
	}

	return (
		<div className={cn("space-y-2", className)} {...props}>
			{errorText ? (
				<ToolOutputSection title="Error" tone="error" viewportSlot="tool-output-error-viewport">
					<pre className="m-0 whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">{errorText}</pre>
				</ToolOutputSection>
			) : null}
			{hasStructuredOutput ? (
				<div className="min-w-0" data-slot="tool-output-structured">
					{Output}
				</div>
			) : output ? (
				<ToolOutputSection title="Result" viewportSlot="tool-output-result-viewport">
					{Output}
				</ToolOutputSection>
			) : null}
		</div>
	);
};
