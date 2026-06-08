import { AlertTriangle, Check, X } from "lucide-react";
import { useMemo } from "react";
import {
	Confirmation,
	ConfirmationAction,
	ConfirmationActions,
	ConfirmationRequest,
	ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import { Button } from "@/components/ui/button";
import { useSubscribedResource } from "@/hooks/use-subscribed-resource";
import { cn } from "@/lib/utils";
import { useApprovalStore } from "@/stores/approval-store";
import { getErrorMessage } from "../../../shared/errors.ts";
import type { DesktopApprovalRequest } from "../../../shared/types.ts";

const MAX_DETAILS_LENGTH = 4000;

function getCategoryLabel(category: DesktopApprovalRequest["category"]): string {
	switch (category) {
		case "bash":
			return "Shell command";
		case "file_mutation":
			return "File mutation";
		case "capability_mutation":
			return "Capability change";
		case "mcp_tool":
			return "MCP tool";
		case "mcp_server_lifecycle":
			return "MCP server";
		case "terminal":
			return "Terminal";
	}
}

function formatDetails(details: Record<string, unknown> | undefined): string | undefined {
	if (!details || Object.keys(details).length === 0) {
		return undefined;
	}

	const formatted = JSON.stringify(details, null, 2);
	if (formatted.length <= MAX_DETAILS_LENGTH) {
		return formatted;
	}
	return `${formatted.slice(0, MAX_DETAILS_LENGTH)}\n...`;
}

interface ApprovalFieldProps {
	label: string;
	value: string;
	className?: string;
}

function ApprovalField({ label, value, className }: ApprovalFieldProps) {
	const testId = `approval-${label.toLowerCase().replace(/\s+/g, "-")}`;
	return (
		<div className="min-w-0 max-w-full overflow-hidden rounded-lg border bg-background/65 px-3 py-2">
			<p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
			<div
				className={cn(
					"mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground",
					"[overflow-wrap:anywhere]",
					className,
				)}
				data-testid={testId}
			>
				{value}
			</div>
		</div>
	);
}

export function ApprovalCenter() {
	const applyApprovalEvent = useApprovalStore((state) => state.applyApprovalEvent);
	const errorMessage = useApprovalStore((state) => state.errorMessage);
	const removeApprovalRequest = useApprovalStore((state) => state.removeApprovalRequest);
	const requests = useApprovalStore((state) => state.requests);
	const setApprovalError = useApprovalStore((state) => state.setApprovalError);
	const activeRequest = requests[0];
	const detailsText = useMemo(() => formatDetails(activeRequest?.details), [activeRequest]);

	useSubscribedResource((onEvent) => window.desktopAgent.subscribeToApprovalEvents(onEvent), applyApprovalEvent, [
		applyApprovalEvent,
	]);

	async function resolveActiveRequest(approved: boolean): Promise<void> {
		if (!activeRequest) {
			return;
		}

		try {
			await window.desktopAgent.resolveApproval({
				requestId: activeRequest.id,
				approved,
				...(approved ? {} : { reason: "Rejected by user." }),
			});
			removeApprovalRequest(activeRequest.id);
		} catch (error: unknown) {
			setApprovalError(getErrorMessage(error));
		}
	}

	if (!activeRequest) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-background/70 px-4 py-6 backdrop-blur-sm">
			<div className="min-w-0 w-full max-w-[min(92vw,42rem)]">
				<Confirmation
					approval={{ id: activeRequest.id }}
					className="max-h-[min(84vh,44rem)] min-w-0 overflow-hidden border-border/80 bg-card p-0 shadow-2xl"
					state="approval-requested"
				>
					<div className="min-w-0 border-b px-5 py-4">
						<div className="flex min-w-0 items-center gap-2 text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
							<AlertTriangle className="size-3.5" />
							<span className="truncate">{getCategoryLabel(activeRequest.category)}</span>
						</div>
						<h2 className="mt-2 min-w-0 text-base font-medium tracking-tight text-foreground">
							{activeRequest.title}
						</h2>
					</div>

					<div className="min-w-0 space-y-4 overflow-y-auto px-5 py-5">
						<ConfirmationTitle className="text-sm leading-6 text-muted-foreground">
							{activeRequest.description ?? "This action needs approval before it can continue."}
						</ConfirmationTitle>

						{activeRequest.subject ? <ApprovalField label="Target" value={activeRequest.subject} /> : null}

						{activeRequest.cwd ? <ApprovalField label="Working directory" value={activeRequest.cwd} /> : null}

						{detailsText ? (
							<pre
								className="max-h-56 min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background/80 p-3 font-mono text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]"
								data-testid="approval-details"
							>
								{detailsText}
							</pre>
						) : null}

						{errorMessage ? (
							<p className="min-w-0 break-words rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive [overflow-wrap:anywhere]">
								{errorMessage}
							</p>
						) : null}
					</div>

					<ConfirmationRequest>
						<ConfirmationActions className="min-w-0 border-t px-5 py-4">
							<Button onClick={() => void resolveActiveRequest(false)} type="button" variant="outline">
								<X className="size-4" />
								Reject
							</Button>
							<ConfirmationAction onClick={() => void resolveActiveRequest(true)}>
								<Check className="size-4" />
								Allow
							</ConfirmationAction>
						</ConfirmationActions>
					</ConfirmationRequest>
				</Confirmation>
			</div>
		</div>
	);
}
