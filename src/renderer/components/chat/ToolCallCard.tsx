import { AlertTriangle, CheckCircle2, TerminalSquare } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ToolCallActivity } from "../../lib/conversation-timeline-projection.ts";
import { CodeBlock } from "../ai-elements/code-block.tsx";
import { MessageResponse } from "../ai-elements/message.tsx";
import { Tool, ToolContent, ToolInput, ToolOutput } from "../ai-elements/tool.tsx";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function formatUnknown(value: unknown): string {
	if (value === undefined) {
		return "";
	}

	if (typeof value === "string") {
		return value;
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function isImageMimeType(value: unknown): value is string {
	return typeof value === "string" && value.toLowerCase().startsWith("image/");
}

function hasImageMarker(record: Record<string, unknown>): boolean {
	return (
		isImageMimeType(record.mimeType) ||
		isImageMimeType(record.mime_type) ||
		isImageMimeType(record.mediaType) ||
		isImageMimeType(record.media_type) ||
		record.type === "image" ||
		record.kind === "image"
	);
}

function sanitizeImageRecord(record: Record<string, unknown>): Record<string, unknown> {
	const sanitized: Record<string, unknown> = { ...record };
	if (typeof sanitized.data === "string" && hasImageMarker(sanitized)) {
		sanitized.data = "[base64 image omitted]";
	}
	if (typeof sanitized.image === "string" && sanitized.image.length > 96) {
		sanitized.image = sanitized.image.startsWith("data:image/") ? "[data URL image omitted]" : "[image data omitted]";
	}
	if (typeof sanitized.base64 === "string" && sanitized.base64.length > 96) {
		sanitized.base64 = "[base64 image omitted]";
	}
	if (Array.isArray(sanitized.images)) {
		sanitized.images = sanitized.images.map((item) => (isRecord(item) ? sanitizeImageRecord(item) : item));
	}
	if (Array.isArray(sanitized.attachments)) {
		sanitized.attachments = sanitized.attachments.map((item) => (isRecord(item) ? sanitizeImageRecord(item) : item));
	}
	if (Array.isArray(sanitized.content)) {
		sanitized.content = sanitized.content.map((item) => (isRecord(item) ? sanitizeImageRecord(item) : item));
	}
	if (isRecord(sanitized.details)) {
		sanitized.details = sanitizeImageRecord(sanitized.details);
	}
	return sanitized;
}

function formatToolResultUnknown(value: unknown): string {
	return formatUnknown(isRecord(value) ? sanitizeImageRecord(value) : value);
}

function getToolArgsPath(args: unknown): string | undefined {
	if (!isRecord(args)) {
		return undefined;
	}

	const path = args.path;
	if (typeof path === "string" && path.trim().length > 0) {
		return path;
	}

	const filePath = args.file_path;
	if (typeof filePath === "string" && filePath.trim().length > 0) {
		return filePath;
	}

	return undefined;
}

function getToolArgsCommand(args: unknown): string | undefined {
	if (!isRecord(args)) {
		return undefined;
	}

	const command = args.command;
	return typeof command === "string" && command.trim().length > 0 ? command : undefined;
}

function getToolArgsEditCount(args: unknown): number | undefined {
	if (!isRecord(args)) {
		return undefined;
	}

	const edits = args.edits;
	return Array.isArray(edits) ? edits.length : undefined;
}

function getTextOutput(value: unknown): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const content = value.content;
	if (!Array.isArray(content)) {
		return undefined;
	}

	const text = content
		.filter(
			(part): part is { type: string; text: string } =>
				isRecord(part) && part.type === "text" && typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("\n");

	return text.length > 0 ? text : undefined;
}

function getDetails(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const details = value.details;
	return isRecord(details) ? details : undefined;
}

interface McpToolSource {
	serverId: string;
	toolName: string;
}

function getMcpToolSource(toolCall: ToolCallActivity): McpToolSource | undefined {
	const resultDetails = getDetails(toolCall.result) ?? getDetails(toolCall.partialResult);
	if (resultDetails) {
		const serverId = resultDetails.serverId;
		const toolName = resultDetails.toolName;
		if (typeof serverId === "string" && typeof toolName === "string") {
			return { serverId, toolName };
		}
	}

	if (!toolCall.toolName.startsWith("mcp__")) {
		return undefined;
	}

	const [serverId, ...toolNameParts] = toolCall.toolName.slice("mcp__".length).split("__");
	const toolName = toolNameParts.join("__");
	if (!serverId || !toolName) {
		return undefined;
	}

	return { serverId, toolName };
}

export interface ToolActivitySection {
	label: string;
	value: string;
	tone?: "muted" | "code" | "error" | "markdown";
}

function createSection(
	label: string,
	value: string | undefined,
	tone?: ToolActivitySection["tone"],
): ToolActivitySection | undefined {
	if (!value) {
		return undefined;
	}

	return { label, value, tone };
}

export function getToolActivitySections(toolCall: ToolCallActivity): ToolActivitySection[] {
	const path = getToolArgsPath(toolCall.args);
	const command = getToolArgsCommand(toolCall.args);
	const editCount = getToolArgsEditCount(toolCall.args);
	const partialText = getTextOutput(toolCall.partialResult);
	const resultText = getTextOutput(toolCall.result);
	const resultDetails = getDetails(toolCall.result);
	const mcpSource = getMcpToolSource(toolCall);
	const errorText = getToolActivityErrorText(toolCall);
	const sections: ToolActivitySection[] = [];
	const partialTextUnlessError = partialText && partialText !== errorText ? partialText : undefined;
	const resultTextUnlessError = resultText && resultText !== errorText ? resultText : undefined;

	switch (toolCall.toolName) {
		case "read":
			sections.push(
				...[
					createSection("Path", path),
					createSection("Error", errorText, "error"),
					createSection("Update", partialTextUnlessError, "code"),
					createSection("Preview", resultTextUnlessError, "code"),
				].filter((section): section is ToolActivitySection => section !== undefined),
			);
			return sections;

		case "bash":
			sections.push(
				...[
					createSection("Error", errorText, "error"),
					createSection("Command", command, "code"),
					createSection("Live Output", partialTextUnlessError, "code"),
					createSection("Result", resultTextUnlessError, "code"),
					createSection("Metadata", resultDetails ? formatUnknown(resultDetails) : undefined, "code"),
				].filter((section): section is ToolActivitySection => section !== undefined),
			);
			return sections;

		case "edit":
			sections.push(
				...[
					createSection("Path", path),
					createSection("Error", errorText, "error"),
					createSection(
						"Change Set",
						editCount !== undefined ? `${editCount} replacement${editCount === 1 ? "" : "s"}` : undefined,
					),
					createSection("Summary", resultTextUnlessError, "code"),
					createSection("Diff", typeof resultDetails?.diff === "string" ? resultDetails.diff : undefined, "code"),
				].filter((section): section is ToolActivitySection => section !== undefined),
			);
			return sections;

		case "write":
			sections.push(
				...[
					createSection("Path", path),
					createSection("Error", errorText, "error"),
					createSection("Summary", resultTextUnlessError, "code"),
				].filter((section): section is ToolActivitySection => section !== undefined),
			);
			return sections;

		case "subagent": {
			const subagentDetails = resultDetails ?? getDetails(toolCall.partialResult);
			const task = getStringFromRecord(toolCall.args, "task");
			const contextSummary = getStringFromRecord(toolCall.args, "contextSummary");
			const scope = getStringFromRecord(toolCall.args, "scope");
			const successCriteria = getStringFromRecord(toolCall.args, "successCriteria");
			const expectedOutput = getStringFromRecord(toolCall.args, "expectedOutput");
			const knownFacts = getStringFromRecord(toolCall.args, "knownFacts");
			const suggestedApproach = getStringFromRecord(toolCall.args, "suggestedApproach");
			const status = getStringFromRecord(subagentDetails, "status");
			const transcriptPath = getStringFromRecord(subagentDetails, "transcriptPath");
			const budget = formatSubagentBudget(toolCall.args, subagentDetails);
			const metadata = subagentDetails ? formatUnknown(subagentDetails) : undefined;
			sections.push(
				...[
					createSection("Task", task),
					createSection("Context Summary", contextSummary),
					createSection("Scope", scope),
					createSection("Success Criteria", successCriteria),
					createSection("Known Facts", knownFacts),
					createSection("Suggested Approach", suggestedApproach),
					createSection("Expected Output", expectedOutput),
					createSection("Budget", budget),
					createSection("Status", status),
					createSection("Error", errorText, "error"),
					createSection("Update", partialTextUnlessError, "markdown"),
					createSection("Summary", resultTextUnlessError, "markdown"),
					createSection("Transcript", transcriptPath),
					createSection("Metadata", metadata, "code"),
				].filter((section): section is ToolActivitySection => section !== undefined),
			);
			return sections;
		}

		default: {
			const updateText =
				toolCall.partialResult !== undefined && formatToolResultUnknown(toolCall.partialResult) !== errorText
					? formatToolResultUnknown(toolCall.partialResult)
					: undefined;
			const genericResultText =
				toolCall.result !== undefined && formatToolResultUnknown(toolCall.result) !== errorText
					? formatToolResultUnknown(toolCall.result)
					: undefined;

			sections.push(
				...[
					createSection("MCP Source", mcpSource ? `${mcpSource.serverId} / ${mcpSource.toolName}` : undefined),
				].filter((section): section is ToolActivitySection => section !== undefined),
			);
			sections.push({
				label: "Args",
				value: formatUnknown(toolCall.args) || "{}",
				tone: "code",
			});
			sections.push(
				...[
					createSection("Error", errorText, "error"),
					createSection("Update", updateText, "code"),
					createSection("Result", genericResultText, "code"),
				].filter((section): section is ToolActivitySection => section !== undefined),
			);
			return sections;
		}
	}
}

function getNumberFromRecord(value: unknown, key: string): number | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const property = value[key];
	return typeof property === "number" && Number.isFinite(property) ? property : undefined;
}

function getBooleanFromRecord(value: unknown, key: string): boolean | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const property = value[key];
	return typeof property === "boolean" ? property : undefined;
}

function getStringFromRecord(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const property = value[key];
	return typeof property === "string" && property.trim().length > 0 ? property.trim() : undefined;
}

function formatSubagentBudget(args: unknown, details: unknown): string | undefined {
	const maxTurns = getNumberFromRecord(details, "maxTurns") ?? getNumberFromRecord(args, "maxTurns");
	const turnCount = getNumberFromRecord(details, "turnCount");
	const limitReached = getBooleanFromRecord(details, "limitReached") === true;
	const limitReason = getStringFromRecord(details, "limitReason");
	if (maxTurns === undefined && turnCount === undefined && !limitReached) {
		return undefined;
	}
	const budgetText =
		maxTurns !== undefined || turnCount !== undefined
			? `${turnCount ?? 0}/${maxTurns ?? "?"} turns`
			: "Limit reached";
	if (!limitReached) {
		return budgetText;
	}
	return `${budgetText} (${limitReason === "max_turns" ? "budget reached" : "limit reached"})`;
}

function getToolActivityErrorText(toolCall: ToolCallActivity): string | undefined {
	if (toolCall.status !== "error") {
		return undefined;
	}

	return (
		getTextOutput(toolCall.result) ??
		getTextOutput(toolCall.partialResult) ??
		(toolCall.result !== undefined ? formatUnknown(toolCall.result) : undefined)
	);
}

const TOOL_ACTIVITY_DETAIL_VIEWPORT_CLASS = "runtime-tool-section-scrollport rounded-md border";

function ToolActivityDetailViewport({ section }: { section: ToolActivitySection }) {
	const isError = section.tone === "error";

	return (
		<div
			className={cn(
				TOOL_ACTIVITY_DETAIL_VIEWPORT_CLASS,
				"select-text",
				isError ? "border-destructive/15 bg-destructive/5 text-destructive" : "border-border/70 bg-muted/35",
			)}
			data-selectable-text="true"
			data-slot="tool-activity-detail-viewport"
		>
			{isError ? (
				<pre className="m-0 whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">{section.value}</pre>
			) : section.tone === "code" ? (
				<CodeBlock
					className="max-w-full overflow-hidden border-0 bg-transparent shadow-none"
					code={section.value}
					data-slot="tool-activity-code-block"
					language="log"
				/>
			) : section.tone === "markdown" ? (
				<MessageResponse className="min-w-0 px-3 py-2 text-foreground text-sm leading-6">
					{section.value}
				</MessageResponse>
			) : (
				<div
					className="min-w-0 whitespace-pre-wrap break-words px-3 py-2 text-foreground text-sm leading-6"
					data-slot="tool-activity-value"
				>
					{section.value}
				</div>
			)}
		</div>
	);
}

function ToolActivityOutputSections({ sections, toolCallId }: { sections: ToolActivitySection[]; toolCallId: string }) {
	return (
		<div className="grid min-w-0 max-w-full gap-3 overflow-hidden" data-slot="tool-activity-output-sections">
			{sections.map((section) => (
				<div
					className="grid min-w-0 max-w-full gap-1.5 overflow-hidden"
					data-slot="tool-activity-output-section"
					key={`${toolCallId}-${section.label}`}
				>
					<h5 className="ui-detail-label truncate">{section.label}</h5>
					<ToolActivityDetailViewport section={section} />
				</div>
			))}
		</div>
	);
}

export function ToolActivityDetails({ toolCall }: { toolCall: ToolCallActivity }) {
	const sections = getToolActivitySections(toolCall);
	if (sections.length === 0 && toolCall.args === undefined) {
		return null;
	}

	const output: ReactNode =
		sections.length > 0 ? (
			<ToolActivityOutputSections sections={sections} toolCallId={toolCall.toolCallId} />
		) : undefined;
	const errorText = output ? undefined : getToolActivityErrorText(toolCall);

	return (
		<Tool className="mb-0 border-0 bg-transparent" data-slot="tool-activity-details" open>
			<ToolContent className="space-y-3 p-0" forceMount>
				<ToolInput data-slot="tool-activity-input" input={toolCall.args} />
				<ToolOutput data-slot="tool-activity-output" errorText={errorText} output={output} />
			</ToolContent>
		</Tool>
	);
}

function getStatusTone(status: ToolCallActivity["status"]) {
	switch (status) {
		case "completed":
			return {
				icon: CheckCircle2,
				variant: "success" as const,
			};
		case "error":
			return {
				icon: AlertTriangle,
				variant: "error" as const,
			};
		case "running":
			return {
				icon: undefined,
				variant: "info" as const,
			};
	}
}

export function ToolCallCard({ toolCall }: { toolCall: ToolCallActivity }) {
	const tone = getStatusTone(toolCall.status);
	const Icon = tone.icon;

	return (
		<Card className="overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
			<CardHeader className="gap-4 border-b bg-background/50 px-4 py-4">
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 items-center gap-3">
						<div className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground">
							<TerminalSquare className="size-4" />
						</div>
						<div className="min-w-0 space-y-1">
							<CardTitle className="truncate text-sm font-semibold text-foreground">
								{toolCall.toolName}
							</CardTitle>
							<p className="truncate text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
								{toolCall.toolCallId}
							</p>
						</div>
					</div>
					<Badge
						className="rounded-full border px-2.5 py-1 text-[13px] font-medium capitalize"
						variant={tone.variant}
					>
						{Icon ? (
							<Icon className="size-3.5" />
						) : (
							<Spinner className="size-3.5" label={`${toolCall.toolName} running`} />
						)}
						<span>{toolCall.status}</span>
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-4 px-4 py-4">
				<Separator />
				<ToolActivityDetails toolCall={toolCall} />
			</CardContent>
		</Card>
	);
}
