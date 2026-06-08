import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceFiles } from "../../src/renderer/hooks/use-workspace-files.ts";
import type { DesktopWorkspaceFileEntry } from "../../src/shared/types.ts";
import {
	installRendererDesktopAgentBridge,
	removeRendererDesktopAgentBridge,
} from "../support/renderer-desktop-agent-bridge.ts";

const workspaceFile: DesktopWorkspaceFileEntry = {
	name: "App.tsx",
	path: "src/App.tsx",
	size: 128,
	type: "code",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

function WorkspaceFilesHarness({
	enabled = true,
	includeSessionIdWithProject = false,
	projectId,
	sessionId,
}: {
	enabled?: boolean;
	includeSessionIdWithProject?: boolean;
	projectId?: string;
	sessionId?: string;
}) {
	const workspaceFiles = useWorkspaceFiles({
		enabled,
		includeSessionIdWithProject,
		limit: 1000,
		projectId,
		sessionId,
		unavailableMessage: "Workspace unavailable.",
	});
	return (
		<div>
			<div data-testid="status">{workspaceFiles.status}</div>
			<div data-testid="files">{workspaceFiles.files.map((file) => file.path).join(",")}</div>
			<div data-testid="error">{workspaceFiles.errorMessage}</div>
		</div>
	);
}

afterEach(() => {
	cleanup();
	removeRendererDesktopAgentBridge();
	vi.restoreAllMocks();
});

describe("useWorkspaceFiles", () => {
	it("stays idle while disabled", () => {
		const bridge = installRendererDesktopAgentBridge({
			listWorkspaceFiles: vi.fn(async () => ({ files: [workspaceFile], truncated: false })),
		});

		render(<WorkspaceFilesHarness enabled={false} projectId="project-1" />);

		expect(screen.getByTestId("status").textContent).toBe("idle");
		expect(bridge.listWorkspaceFiles).not.toHaveBeenCalled();
	});

	it("loads workspace files for the active scope", async () => {
		const bridge = installRendererDesktopAgentBridge({
			listWorkspaceFiles: vi.fn(async () => ({ files: [workspaceFile], truncated: false })),
		});

		render(<WorkspaceFilesHarness includeSessionIdWithProject projectId="project-1" sessionId="session-1" />);

		await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loaded"));
		expect(screen.getByTestId("files").textContent).toBe("src/App.tsx");
		expect(bridge.listWorkspaceFiles).toHaveBeenCalledWith({
			limit: 1000,
			projectId: "project-1",
			sessionId: "session-1",
		});
	});

	it("reports unavailable workspace scopes", async () => {
		const bridge = installRendererDesktopAgentBridge({
			listWorkspaceFiles: vi.fn(async () => ({ files: [workspaceFile], truncated: false })),
		});

		render(<WorkspaceFilesHarness />);

		await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
		expect(screen.getByTestId("error").textContent).toBe("Workspace unavailable.");
		expect(bridge.listWorkspaceFiles).not.toHaveBeenCalled();
	});

	it("resets and reloads when the scope changes", async () => {
		const bridge = installRendererDesktopAgentBridge({
			listWorkspaceFiles: vi.fn(async ({ projectId }) => ({
				files: [{ ...workspaceFile, path: `${projectId}/App.tsx` }],
				truncated: false,
			})),
		});

		const { rerender } = render(<WorkspaceFilesHarness projectId="project-1" />);
		await waitFor(() => expect(screen.getByTestId("files").textContent).toBe("project-1/App.tsx"));

		rerender(<WorkspaceFilesHarness projectId="project-2" />);

		await waitFor(() => expect(screen.getByTestId("files").textContent).toBe("project-2/App.tsx"));
		expect(bridge.listWorkspaceFiles).toHaveBeenCalledTimes(2);
	});
});
