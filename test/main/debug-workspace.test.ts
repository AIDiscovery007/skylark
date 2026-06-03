import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDebugWorkspaceInputFromProject } from "../../src/main/workspace/debug-workspace.ts";

describe("debug workspace creation", () => {
	it("derives pane commands from detected package scripts and package manager", async () => {
		const projectDir = await mkdtemp(join(tmpdir(), "debug-workspace-"));
		await writeFile(
			join(projectDir, "package.json"),
			JSON.stringify({
				scripts: {
					dev: "vite --host 127.0.0.1",
					logs: "tail -f logs/app.log",
					test: "vitest --run",
				},
			}),
		);
		await writeFile(join(projectDir, "pnpm-lock.yaml"), "");

		const input = await createDebugWorkspaceInputFromProject({
			issue: "/api/login 一直 500，帮我定位并修掉。",
			projectId: "project-1",
			repoPath: projectDir,
			taskTitle: "fix-login-500",
		});

		expect(input).toMatchObject({
			projectId: "project-1",
			repoPath: projectDir,
			taskTitle: "fix-login-500",
		});
		expect(input.paneDefinitions).toEqual([
			{ id: "agent", role: "agent", title: "Agent" },
			{ id: "shell", role: "shell", title: "Shell" },
			{ command: "pnpm run dev", cwd: projectDir, id: "dev-server", role: "dev-server", title: "Dev Server" },
			{ command: "pnpm run test", cwd: projectDir, id: "test", role: "test", title: "Test" },
			{ command: "pnpm run logs", cwd: projectDir, id: "logs", role: "logs", title: "Logs" },
		]);
	});

	it("keeps runtime panes as placeholders when commands cannot be detected", async () => {
		const projectDir = await mkdtemp(join(tmpdir(), "debug-workspace-empty-"));

		const input = await createDebugWorkspaceInputFromProject({
			repoPath: projectDir,
		});

		expect(input.taskTitle).toBe("Workspace");
		expect(input.paneDefinitions).toEqual([
			{ id: "agent", role: "agent", title: "Agent" },
			{ id: "shell", role: "shell", title: "Shell" },
			{ id: "dev-server", role: "dev-server", title: "Dev Server" },
			{ id: "test", role: "test", title: "Test" },
			{ id: "logs", role: "logs", title: "Logs" },
		]);
	});
});
