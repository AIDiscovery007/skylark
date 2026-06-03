import { describe, expect, it, vi } from "vitest";
import {
	DefaultTmuxEnvironmentInspector,
	type TmuxCommandRunner,
} from "../../src/main/environment/tmux-environment-watcher.ts";

const paneFormat =
	"#{window_name}__SKYLARK_ENV_FIELD_DELIMITER__#{pane_id}__SKYLARK_ENV_FIELD_DELIMITER__#{pane_current_command}__SKYLARK_ENV_FIELD_DELIMITER__#{pane_current_path}";

describe("DefaultTmuxEnvironmentInspector", () => {
	it("discovers only tmux sessions claimed with Skylark metadata", async () => {
		const runTmux: TmuxCommandRunner = vi.fn(async (args) => {
			const key = args.join("\u0000");
			if (key === ["list-sessions", "-F", "#{session_name}"].join("\u0000")) {
				return { stdout: "skylark_abc123_dev\nuser_session\n", stderr: "" };
			}
			if (key === ["show-options", "-qv", "-t", "skylark_abc123_dev", "@skylark-session-id"].join("\u0000")) {
				return { stdout: "session-1\n", stderr: "" };
			}
			if (key === ["show-options", "-qv", "-t", "skylark_abc123_dev", "@skylark-cwd"].join("\u0000")) {
				return { stdout: "/workspace/project\n", stderr: "" };
			}
			if (key === ["show-options", "-qv", "-t", "skylark_abc123_dev", "@skylark-title"].join("\u0000")) {
				return { stdout: "Dev runtime\n", stderr: "" };
			}
			if (key === ["show-options", "-qv", "-t", "skylark_abc123_dev", "@skylark-resource-kind"].join("\u0000")) {
				return { stdout: "tmux_session\n", stderr: "" };
			}
			if (key.startsWith(["show-options", "-qv", "-t", "user_session"].join("\u0000"))) {
				return { stdout: "", stderr: "" };
			}
			if (key === ["list-panes", "-t", "skylark_abc123_dev", "-F", paneFormat].join("\u0000")) {
				return {
					stdout: [
						"test__SKYLARK_ENV_FIELD_DELIMITER__%1__SKYLARK_ENV_FIELD_DELIMITER__vitest__SKYLARK_ENV_FIELD_DELIMITER__/workspace/project",
						"test__SKYLARK_ENV_FIELD_DELIMITER__%2__SKYLARK_ENV_FIELD_DELIMITER__node__SKYLARK_ENV_FIELD_DELIMITER__/workspace/project",
						"server__SKYLARK_ENV_FIELD_DELIMITER__%3__SKYLARK_ENV_FIELD_DELIMITER__npm__SKYLARK_ENV_FIELD_DELIMITER__/workspace/project",
					].join("\n"),
					stderr: "",
				};
			}
			if (key === ["show-options", "-w", "-qv", "-t", "skylark_abc123_dev:test", "@skylark-title"].join("\u0000")) {
				return { stdout: "Tests\n", stderr: "" };
			}
			if (
				key === ["show-options", "-w", "-qv", "-t", "skylark_abc123_dev:server", "@skylark-title"].join("\u0000")
			) {
				return { stdout: "Server\n", stderr: "" };
			}
			return { stdout: "", stderr: "" };
		});

		const inspector = new DefaultTmuxEnvironmentInspector(runTmux);

		await expect(inspector.discover()).resolves.toEqual([
			{
				sessionName: "skylark_abc123_dev",
				options: {
					"@pi-cwd": undefined,
					"@pi-resource-kind": undefined,
					"@pi-session-id": undefined,
					"@pi-title": undefined,
					"@skylark-cwd": "/workspace/project",
					"@skylark-resource-kind": "tmux_session",
					"@skylark-session-id": "session-1",
					"@skylark-title": "Dev runtime",
				},
				windows: [
					{
						currentCommand: "vitest",
						currentPath: "/workspace/project",
						options: {
							"@pi-cwd": undefined,
							"@pi-resource-kind": undefined,
							"@pi-session-id": undefined,
							"@pi-title": undefined,
							"@skylark-cwd": undefined,
							"@skylark-resource-kind": undefined,
							"@skylark-session-id": undefined,
							"@skylark-title": "Tests",
						},
						paneId: "%1",
						windowName: "test",
					},
					{
						currentCommand: "npm",
						currentPath: "/workspace/project",
						options: {
							"@pi-cwd": undefined,
							"@pi-resource-kind": undefined,
							"@pi-session-id": undefined,
							"@pi-title": undefined,
							"@skylark-cwd": undefined,
							"@skylark-resource-kind": undefined,
							"@skylark-session-id": undefined,
							"@skylark-title": "Server",
						},
						paneId: "%3",
						windowName: "server",
					},
				],
			},
		]);
	});

	it("continues to discover tmux sessions with legacy pi metadata", async () => {
		const runTmux: TmuxCommandRunner = vi.fn(async (args) => {
			const key = args.join("\u0000");
			if (key === ["list-sessions", "-F", "#{session_name}"].join("\u0000")) {
				return { stdout: "pi_abc123_legacy\n", stderr: "" };
			}
			if (key === ["show-options", "-qv", "-t", "pi_abc123_legacy", "@pi-session-id"].join("\u0000")) {
				return { stdout: "session-legacy\n", stderr: "" };
			}
			if (key === ["show-options", "-qv", "-t", "pi_abc123_legacy", "@pi-cwd"].join("\u0000")) {
				return { stdout: "/workspace/project\n", stderr: "" };
			}
			if (key === ["show-options", "-qv", "-t", "pi_abc123_legacy", "@pi-title"].join("\u0000")) {
				return { stdout: "Legacy runtime\n", stderr: "" };
			}
			if (key === ["list-panes", "-t", "pi_abc123_legacy", "-F", paneFormat].join("\u0000")) {
				return { stdout: "", stderr: "" };
			}
			return { stdout: "", stderr: "" };
		});

		await expect(new DefaultTmuxEnvironmentInspector(runTmux).discover()).resolves.toEqual([
			expect.objectContaining({
				options: expect.objectContaining({
					"@pi-session-id": "session-legacy",
				}),
				sessionName: "pi_abc123_legacy",
			}),
		]);
	});
});
