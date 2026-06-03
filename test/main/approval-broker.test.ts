import { describe, expect, it, vi } from "vitest";
import { DesktopApprovalBroker } from "../../src/main/security/approval-broker.ts";
import { DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS } from "../../src/shared/types.ts";

async function waitForBrokerEmit(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("DesktopApprovalBroker", () => {
	it("emits approval requests and resolves approved decisions", async () => {
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);

		const approvalPromise = broker.requestApproval({
			category: "bash",
			action: "bash",
			title: "Run shell command",
			subject: "pwd",
		});
		await waitForBrokerEmit();

		const request = listener.mock.calls[0]?.[0].request;
		expect(request.title).toBe("Run shell command");
		expect(request.category).toBe("bash");

		broker.resolveApproval({ requestId: request.id, approved: true });

		await expect(approvalPromise).resolves.toBeUndefined();
		expect(listener.mock.calls.at(-1)?.[0]).toEqual({
			type: "approval_resolved",
			decision: { requestId: request.id, approved: true },
		});
	});

	it("skips disabled approval categories", async () => {
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: {
				...DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
				bash: false,
			},
		}));
		const listener = vi.fn();
		broker.subscribe(listener);

		await broker.requestApproval({
			category: "bash",
			action: "bash",
			title: "Run shell command",
		});

		expect(listener).not.toHaveBeenCalled();
	});

	it("rejects denied approvals", async () => {
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);

		const approvalPromise = broker.requestApproval({
			category: "terminal",
			action: "create_terminal",
			title: "Start terminal",
		});
		await waitForBrokerEmit();
		const request = listener.mock.calls[0]?.[0].request;

		broker.resolveApproval({ requestId: request.id, approved: false, reason: "No shell." });

		await expect(approvalPromise).rejects.toThrow("No shell.");
	});

	it("fails closed when approval is required but no listener is registered", async () => {
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));

		await expect(
			broker.requestApproval({
				category: "mcp_tool",
				action: "call_mcp_tool",
				title: "Call MCP tool",
			}),
		).rejects.toThrow("no approval surface");
	});

	it("rejects pending approvals on dispose", async () => {
		const broker = new DesktopApprovalBroker(async () => ({
			permissionApprovals: DEFAULT_DESKTOP_PERMISSION_APPROVAL_SETTINGS,
		}));
		const listener = vi.fn();
		broker.subscribe(listener);

		const approvalPromise = broker.requestApproval({
			category: "terminal",
			action: "create_terminal",
			title: "Start terminal",
		});
		await waitForBrokerEmit();
		const request = listener.mock.calls[0]?.[0].request;

		broker.dispose("Application is quitting.");

		await expect(approvalPromise).rejects.toThrow("Application is quitting.");
		expect(listener.mock.calls.at(-1)?.[0]).toEqual({
			type: "approval_resolved",
			decision: {
				requestId: request.id,
				approved: false,
				reason: "Application is quitting.",
			},
		});
	});
});
