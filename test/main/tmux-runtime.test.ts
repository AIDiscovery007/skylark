import { mkdtempSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DefaultTmuxRuntime,
	parseTmuxPaneList,
	type TmuxCommandRunner,
	TmuxRuntimeError,
} from "../../src/main/tmux/tmux-runtime.ts";

const tempDirectories: string[] = [];
const TEST_TMUX_FIELD_DELIMITER = "__PI_TMUX_FIELD_DELIMITER__";

function createTempDirectory(): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "desktop-tmux-runtime-"));
	tempDirectories.push(directoryPath);
	return directoryPath;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

function createExitError(code: number): Error & { code: number } {
	const error = new Error(`tmux exited with ${code}`) as Error & { code: number };
	error.code = code;
	return error;
}

function createTimeoutError(): Error & { killed: boolean; signal: string } {
	const error = new Error("tmux command timed out") as Error & { killed: boolean; signal: string };
	error.killed = true;
	error.signal = "SIGTERM";
	return error;
}

function isolatedTmuxArgs(args: string[]): string[] {
	return ["-f", "/dev/null", ...args];
}

describe("DefaultTmuxRuntime", () => {
	it("ensures sessions idempotently through app-owned socket commands", async () => {
		const cwd = createTempDirectory();
		const socketPath = join(cwd, "runtime", "tmux.sock");
		const sessions = new Set<string>();
		const calls: string[][] = [];
		const runTmux = vi.fn<TmuxCommandRunner>(async (args) => {
			calls.push(args);
			const command = args.find((arg) => arg === "has-session" || arg === "new-session" || arg === "set-option");
			const target = args.at(-1);
			if (command === "has-session" && target) {
				if (!sessions.has(target)) {
					throw createExitError(1);
				}
				return { stdout: "", stderr: "" };
			}
			if (command === "new-session") {
				const sessionName = args[args.indexOf("-s") + 1];
				if (sessionName) {
					sessions.add(sessionName);
				}
				return { stdout: "", stderr: "" };
			}
			return { stdout: "", stderr: "" };
		});
		const runtime = new DefaultTmuxRuntime(runTmux);

		await expect(
			runtime.ensureSession({
				socketPath,
				sessionName: "ws_fix_login_500",
				cwd,
				historyLimit: 1234,
			}),
		).resolves.toEqual({ created: true, sessionName: "ws_fix_login_500" });
		await expect(
			runtime.ensureSession({
				socketPath,
				sessionName: "ws_fix_login_500",
				cwd,
				historyLimit: 1234,
			}),
		).resolves.toEqual({ created: false, sessionName: "ws_fix_login_500" });

		expect(calls).toEqual([
			isolatedTmuxArgs(["-S", socketPath, "has-session", "-t", "ws_fix_login_500"]),
			isolatedTmuxArgs(["-S", socketPath, "new-session", "-d", "-s", "ws_fix_login_500", "-c", cwd]),
			isolatedTmuxArgs(["-S", socketPath, "set-option", "-t", "ws_fix_login_500", "history-limit", "1234"]),
			isolatedTmuxArgs(["-S", socketPath, "has-session", "-t", "ws_fix_login_500"]),
		]);
	});

	it("does not load user tmux configuration for app-owned runtime commands", async () => {
		const calls: string[][] = [];
		const runtime = new DefaultTmuxRuntime(async (args) => {
			calls.push(args);
			return { stdout: "", stderr: "" };
		});

		await expect(runtime.isTmuxAvailable()).resolves.toBe(true);
		await expect(runtime.hasSession({ socketPath: "/tmp/app.sock", sessionName: "ws_demo" })).resolves.toBe(true);

		expect(calls).toEqual([
			isolatedTmuxArgs(["-V"]),
			isolatedTmuxArgs(["-S", "/tmp/app.sock", "has-session", "-t", "ws_demo"]),
		]);
	});

	it("reports tmux missing without crashing availability checks", async () => {
		const missingTmuxError = new Error("spawn tmux ENOENT") as NodeJS.ErrnoException;
		missingTmuxError.code = "ENOENT";
		const runtime = new DefaultTmuxRuntime(async () => {
			throw missingTmuxError;
		});

		await expect(runtime.isTmuxAvailable()).resolves.toBe(false);
		await expect(runtime.hasSession({ socketPath: "/tmp/app.sock", sessionName: "ws_demo" })).rejects.toMatchObject({
			code: "tmux_unavailable",
		});
		await expect(runtime.hasSession({ socketPath: "/tmp/app.sock", sessionName: "ws_demo" })).rejects.toBeInstanceOf(
			TmuxRuntimeError,
		);
	});

	it("reports tmux command timeouts with a dedicated error code", async () => {
		const runtime = new DefaultTmuxRuntime(async () => {
			throw createTimeoutError();
		}, 50);

		await expect(runtime.listPanes({ socketPath: "/tmp/app.sock", sessionName: "ws_demo" })).rejects.toMatchObject({
			code: "tmux_command_timeout",
			message: "tmux command timed out after 50ms.",
		});
	});

	it("parses tmux pane list output with a stable delimiter", () => {
		const panes = parseTmuxPaneList(
			[
				["ws_demo", "@1", "dev", "%1", "0", "node", "/Users/qiaochao/pi mono", "0"].join(TEST_TMUX_FIELD_DELIMITER),
				["ws_demo", "@2", "test", "%2", "1", "vitest", "/Users/qiaochao/pi mono", "1"].join(
					TEST_TMUX_FIELD_DELIMITER,
				),
			].join("\n"),
		);

		expect(panes).toEqual([
			{
				sessionName: "ws_demo",
				windowId: "@1",
				windowName: "dev",
				paneId: "%1",
				paneIndex: 0,
				currentCommand: "node",
				currentPath: "/Users/qiaochao/pi mono",
				dead: false,
			},
			{
				sessionName: "ws_demo",
				windowId: "@2",
				windowName: "test",
				paneId: "%2",
				paneIndex: 1,
				currentCommand: "vitest",
				currentPath: "/Users/qiaochao/pi mono",
				dead: true,
			},
		]);
	});

	it("runs pane, capture, send, and kill operations through bounded socket-scoped commands", async () => {
		const cwd = createTempDirectory();
		const socketPath = join(cwd, "runtime", "tmux.sock");
		await mkdir(join(cwd, "runtime"), { recursive: true });
		const calls: string[][] = [];
		const runtime = new DefaultTmuxRuntime(async (args) => {
			calls.push(args);
			if (args.includes("list-panes")) {
				return {
					stdout:
						["ws_demo", "@1", "test", "%3", "0", "vitest", "/tmp/repo", "0"].join(TEST_TMUX_FIELD_DELIMITER) +
						"\n",
					stderr: "",
				};
			}
			if (args.includes("capture-pane")) {
				return { stdout: "last output\n", stderr: "" };
			}
			return { stdout: "", stderr: "" };
		});

		await runtime.newWindow({
			socketPath,
			sessionName: "ws_demo",
			windowName: "test",
			cwd,
			command: "npm run check",
		});
		await expect(runtime.listPanes({ socketPath, sessionName: "ws_demo" })).resolves.toEqual([
			expect.objectContaining({ paneId: "%3", windowName: "test", currentCommand: "vitest" }),
		]);
		await expect(runtime.capturePane({ socketPath, paneId: "%3", lines: 25 })).resolves.toBe("last output\n");
		await runtime.sendText({ socketPath, paneId: "%3", text: "npm run check", pressEnter: true });
		await runtime.killWindow({ socketPath, sessionName: "ws_demo", windowName: "test" });
		await runtime.killSession({ socketPath, sessionName: "ws_demo" });

		expect(calls).toEqual([
			isolatedTmuxArgs(["-S", socketPath, "new-window", "-t", "ws_demo", "-n", "test", "-c", cwd, "npm run check"]),
			isolatedTmuxArgs(["-S", socketPath, "list-panes", "-a", "-F", expect.any(String), "-t", "ws_demo"]),
			isolatedTmuxArgs(["-S", socketPath, "capture-pane", "-p", "-J", "-S", "-25", "-E", "-1", "-t", "%3"]),
			isolatedTmuxArgs(["-S", socketPath, "send-keys", "-t", "%3", "-l", "npm run check"]),
			isolatedTmuxArgs(["-S", socketPath, "send-keys", "-t", "%3", "Enter"]),
			isolatedTmuxArgs(["-S", socketPath, "kill-window", "-t", "ws_demo:test"]),
			isolatedTmuxArgs(["-S", socketPath, "kill-session", "-t", "ws_demo"]),
		]);
	});

	it("rejects unsafe names, relative sockets, missing cwd, and unsupported pane ids", async () => {
		const cwd = createTempDirectory();
		const runtime = new DefaultTmuxRuntime(async () => ({ stdout: "", stderr: "" }));

		await expect(runtime.hasSession({ socketPath: "relative.sock", sessionName: "ws_demo" })).rejects.toMatchObject({
			code: "tmux_invalid_input",
		});
		await expect(runtime.hasSession({ socketPath: "/tmp/app.sock", sessionName: "bad;name" })).rejects.toMatchObject({
			code: "tmux_invalid_input",
		});
		await expect(
			runtime.ensureSession({
				socketPath: "/tmp/app.sock",
				sessionName: "ws_demo",
				cwd: join(cwd, "missing"),
			}),
		).rejects.toMatchObject({ code: "tmux_invalid_input" });
		await expect(runtime.capturePane({ socketPath: "/tmp/app.sock", paneId: "shell" })).rejects.toMatchObject({
			code: "tmux_invalid_input",
		});
	});
});
