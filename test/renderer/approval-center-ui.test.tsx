import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalCenter } from "../../src/renderer/components/security/ApprovalCenter.tsx";
import { approvalStore } from "../../src/renderer/stores/approval-store.ts";
import type { DesktopAgentBridge } from "../../src/shared/ipc-contract.ts";
import type { DesktopApprovalEvent } from "../../src/shared/types.ts";

afterEach(() => {
	cleanup();
	approvalStore.getState().resetApprovals();
	Reflect.deleteProperty(window, "desktopAgent");
});

function installApprovalBridge() {
	let approvalListener: ((event: DesktopApprovalEvent) => void) | undefined;
	const resolveApproval = vi.fn(async () => undefined);
	const bridge = {
		resolveApproval,
		subscribeToApprovalEvents: vi.fn((listener: (event: DesktopApprovalEvent) => void) => {
			approvalListener = listener;
			return () => {
				approvalListener = undefined;
			};
		}),
	} satisfies Pick<DesktopAgentBridge, "resolveApproval" | "subscribeToApprovalEvents">;

	Object.defineProperty(window, "desktopAgent", {
		configurable: true,
		value: bridge,
	});

	return {
		emitApprovalEvent(event: DesktopApprovalEvent) {
			approvalListener?.(event);
		},
		resolveApproval,
	};
}

describe("ApprovalCenter", () => {
	it("keeps long command approval content constrained inside the dialog", async () => {
		const user = userEvent.setup();
		const { emitApprovalEvent, resolveApproval } = installApprovalBridge();
		const longCommand =
			"pwd && git status --short && echo '--- TODO/FIXME/HACK scan ---' && rg -n --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/.turbo/**' --glob '!**/.next/**' 'TODO|FIXME|HACK'";

		render(<ApprovalCenter />);

		act(() => {
			emitApprovalEvent({
				type: "approval_requested",
				request: {
					id: "approval-1",
					category: "bash",
					action: "bash",
					title: "Run shell command",
					description: "Execute a shell command from an agent tool call.",
					subject: longCommand,
					cwd: "/Users/qiaochao/projects/skylark",
					details: { command: longCommand },
					createdAt: "2026-05-01T00:00:00.000Z",
				},
			});
		});

		const target = await screen.findByTestId("approval-target");
		const details = screen.getByTestId("approval-details");

		expect(screen.getByText("Run shell command")).not.toBeNull();
		expect(target.className).toContain("max-w-full");
		expect(target.className).toContain("overflow-x-auto");
		expect(target.className).toContain("break-words");
		expect(target.className).toContain("[overflow-wrap:anywhere]");
		expect(details.className).toContain("max-w-full");
		expect(details.className).toContain("overflow-auto");
		expect(details.className).toContain("break-words");
		expect(details.className).toContain("[overflow-wrap:anywhere]");

		await user.click(screen.getByRole("button", { name: /allow/i }));

		await waitFor(() => {
			expect(resolveApproval).toHaveBeenCalledWith({ requestId: "approval-1", approved: true });
		});
	});
});
