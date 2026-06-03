import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IDisposable, IPty } from "node-pty";
import { describe, expect, it, vi } from "vitest";
import { DesktopPtyManager, ensurePtySpawnHelperExecutable } from "../../src/main/terminal/pty-manager.ts";
import type { SerializedTerminalEvent } from "../../src/shared/serialized-terminal-event.ts";

class FakeDisposable implements IDisposable {
	readonly dispose = vi.fn();
}

class FakePty implements IPty {
	readonly pid = 1;
	cols: number;
	rows: number;
	process = "bash";
	handleFlowControl = false;
	readonly write = vi.fn<(data: string | Buffer) => void>();
	readonly resize = vi.fn<(columns: number, rows: number) => void>((columns, rows) => {
		this.cols = columns;
		this.rows = rows;
	});
	readonly clear = vi.fn();
	readonly kill = vi.fn<(signal?: string) => void>();
	readonly pause = vi.fn();
	readonly resume = vi.fn();
	private readonly dataListeners = new Set<(data: string) => void>();
	private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();

	constructor(cols: number, rows: number) {
		this.cols = cols;
		this.rows = rows;
	}

	readonly onData = (listener: (data: string) => void): IDisposable => {
		this.dataListeners.add(listener);
		const disposable = new FakeDisposable();
		disposable.dispose.mockImplementation(() => {
			this.dataListeners.delete(listener);
		});
		return disposable;
	};

	readonly onExit = (listener: (event: { exitCode: number; signal?: number }) => void): IDisposable => {
		this.exitListeners.add(listener);
		const disposable = new FakeDisposable();
		disposable.dispose.mockImplementation(() => {
			this.exitListeners.delete(listener);
		});
		return disposable;
	};

	emitData(data: string): void {
		for (const listener of this.dataListeners) {
			listener(data);
		}
	}

	emitExit(event: { exitCode: number; signal?: number }): void {
		for (const listener of this.exitListeners) {
			listener(event);
		}
	}
}

describe("DesktopPtyManager", () => {
	it("makes the bundled unix spawn helper executable before spawning terminals", () => {
		const packageRoot = mkdtempSync(join(tmpdir(), "desktop-pty-manager-"));
		const helperDir = join(packageRoot, "prebuilds", "darwin-arm64");
		const helperPath = join(helperDir, "spawn-helper");

		try {
			mkdirSync(helperDir, { recursive: true });
			writeFileSync(helperPath, "#!/bin/sh\n");
			chmodSync(helperPath, 0o644);

			ensurePtySpawnHelperExecutable(packageRoot, "darwin", "arm64");

			expect(statSync(helperPath).mode & 0o111).not.toBe(0);
		} finally {
			rmSync(packageRoot, { force: true, recursive: true });
		}
	});

	it("creates a terminal and streams output and exit events with the session id", async () => {
		const firstPty = new FakePty(120, 40);
		const spawnPty = vi.fn(() => firstPty);
		const manager = new DesktopPtyManager(spawnPty);
		const listener = vi.fn<(event: SerializedTerminalEvent) => void>();
		manager.subscribe(listener);

		await manager.create({
			terminalId: "terminal-1",
			sessionId: "session-1",
			source: { type: "shell", cwd: "/workspace/project" },
			cols: 120,
			rows: 40,
		});
		firstPty.emitData("hello");
		firstPty.emitExit({ exitCode: 0, signal: 15 });

		expect(spawnPty).toHaveBeenCalledWith(
			expect.any(String),
			[],
			expect.objectContaining({
				name: "xterm-256color",
				cwd: "/workspace/project",
				cols: 120,
				rows: 40,
				env: process.env,
			}),
		);
		expect(listener).toHaveBeenNthCalledWith(1, {
			type: "terminal_data",
			terminalId: "terminal-1",
			sessionId: "session-1",
			data: "hello",
		});
		expect(listener).toHaveBeenNthCalledWith(2, {
			type: "terminal_exit",
			terminalId: "terminal-1",
			sessionId: "session-1",
			exitCode: 0,
			signal: 15,
		});
	});

	it("writes, resizes, ignores stale resize requests, and rejects inactive writes", async () => {
		const pty = new FakePty(80, 24);
		const manager = new DesktopPtyManager(vi.fn(() => pty));

		await manager.create({
			terminalId: "terminal-1",
			sessionId: "session-1",
			source: { type: "shell", cwd: "/workspace/project" },
			cols: 80,
			rows: 24,
		});
		manager.write({ terminalId: "terminal-1", data: "ls\r" });
		manager.resize({ terminalId: "terminal-1", cols: 100, rows: 30 });
		manager.dispose("terminal-1");

		expect(pty.write).toHaveBeenCalledWith("ls\r");
		expect(pty.resize).toHaveBeenCalledWith(100, 30);
		expect(pty.kill).toHaveBeenCalledTimes(1);
		expect(() => manager.resize({ terminalId: "terminal-2", cols: 120, rows: 40 })).not.toThrow();
		expect(() => manager.resize({ terminalId: "terminal-1", cols: 120, rows: 40 })).not.toThrow();
		expect(pty.resize).toHaveBeenCalledTimes(1);
		expect(() => manager.write({ terminalId: "terminal-2", data: "pwd\r" })).toThrow(
			"No active terminal 'terminal-2'",
		);
		expect(() => manager.write({ terminalId: "terminal-1", data: "pwd\r" })).toThrow(
			"No active terminal 'terminal-1'",
		);
	});

	it("keeps multiple active terminals and only replaces the matching terminal id", async () => {
		const firstPty = new FakePty(80, 24);
		const secondPty = new FakePty(100, 30);
		const thirdPty = new FakePty(120, 40);
		const spawnPty = vi
			.fn<() => IPty>()
			.mockReturnValueOnce(firstPty)
			.mockReturnValueOnce(secondPty)
			.mockReturnValueOnce(thirdPty);
		const manager = new DesktopPtyManager(spawnPty);
		const listener = vi.fn<(event: SerializedTerminalEvent) => void>();
		manager.subscribe(listener);

		await manager.create({
			terminalId: "terminal-1",
			sessionId: "session-1",
			source: { type: "shell", cwd: "/workspace/project" },
			cols: 80,
			rows: 24,
		});
		await manager.create({
			terminalId: "terminal-2",
			sessionId: "session-1",
			source: { type: "shell", cwd: "/workspace/project" },
			cols: 100,
			rows: 30,
		});
		manager.write({ terminalId: "terminal-1", data: "pwd\r" });
		manager.write({ terminalId: "terminal-2", data: "ls\r" });

		expect(firstPty.write).toHaveBeenCalledWith("pwd\r");
		expect(secondPty.write).toHaveBeenCalledWith("ls\r");
		expect(firstPty.kill).not.toHaveBeenCalled();
		expect(secondPty.kill).not.toHaveBeenCalled();
		expect(spawnPty).toHaveBeenCalledTimes(2);

		await manager.create({
			terminalId: "terminal-1",
			sessionId: "session-1",
			source: { type: "shell", cwd: "/workspace/project" },
			cols: 120,
			rows: 40,
		});

		expect(firstPty.kill).toHaveBeenCalledTimes(1);
		expect(secondPty.kill).not.toHaveBeenCalled();
		manager.write({ terminalId: "terminal-2", data: "echo active\r" });
		manager.write({ terminalId: "terminal-1", data: "echo replaced\r" });
		expect(secondPty.write).toHaveBeenCalledWith("echo active\r");
		expect(thirdPty.write).toHaveBeenCalledWith("echo replaced\r");

		firstPty.emitData("stale");
		firstPty.emitExit({ exitCode: 0 });
		thirdPty.emitData("fresh");
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({
			type: "terminal_data",
			terminalId: "terminal-1",
			sessionId: "session-1",
			data: "fresh",
		});
	});

	it("opens tmux environment resources as read-only attach clients", async () => {
		const pty = new FakePty(80, 24);
		const spawnPty = vi.fn(() => pty);
		const manager = new DesktopPtyManager(spawnPty, {
			environmentResourceStore: {
				getResource: async () => ({
					createdAt: "2026-05-20T00:00:00.000Z",
					cwd: "/workspace/project",
					id: "env_tmux_tests",
					kind: "tmux_window",
					lastSeenAt: "2026-05-20T00:00:00.000Z",
					metadata: {
						tmuxSessionName: "pi_session_tests",
						tmuxSocketPath: "/tmp/pda-tmux/session.sock",
						tmuxWindowName: "tests",
					},
					provider: "tmux",
					sessionId: "session-1",
					status: "running",
					title: "Tests",
					updatedAt: "2026-05-20T00:00:00.000Z",
				}),
			},
		});

		await manager.create({
			terminalId: "terminal-1",
			sessionId: "session-1",
			source: { type: "environment_resource", resourceId: "env_tmux_tests", readOnly: true },
			cols: 80,
			rows: 24,
		});

		expect(spawnPty).toHaveBeenCalledWith(
			"tmux",
			[
				"-f",
				"/dev/null",
				"-S",
				"/tmp/pda-tmux/session.sock",
				"attach-session",
				"-r",
				"-t",
				"pi_session_tests:tests",
			],
			expect.objectContaining({ cwd: "/workspace/project" }),
		);
		expect(() => manager.write({ terminalId: "terminal-1", data: "nope" })).toThrow("read-only");
	});

	it("disposes every terminal owned by a session", async () => {
		const firstPty = new FakePty(80, 24);
		const secondPty = new FakePty(100, 30);
		const thirdPty = new FakePty(120, 40);
		const spawnPty = vi
			.fn<() => IPty>()
			.mockReturnValueOnce(firstPty)
			.mockReturnValueOnce(secondPty)
			.mockReturnValueOnce(thirdPty);
		const manager = new DesktopPtyManager(spawnPty);

		await manager.create({
			terminalId: "terminal-1",
			sessionId: "session-1",
			source: { type: "shell", cwd: "/workspace/project" },
			cols: 80,
			rows: 24,
		});
		await manager.create({
			terminalId: "terminal-2",
			sessionId: "session-1",
			source: { type: "shell", cwd: "/workspace/project" },
			cols: 100,
			rows: 30,
		});
		await manager.create({
			terminalId: "terminal-3",
			sessionId: "session-2",
			source: { type: "shell", cwd: "/workspace/project" },
			cols: 120,
			rows: 40,
		});

		manager.disposeSession("session-1");

		expect(firstPty.kill).toHaveBeenCalledTimes(1);
		expect(secondPty.kill).toHaveBeenCalledTimes(1);
		expect(thirdPty.kill).not.toHaveBeenCalled();
	});
});
