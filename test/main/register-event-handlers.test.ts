import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dialog } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { DesktopAuthService } from "../../src/main/auth/desktop-auth-service.ts";
import { DesktopEventStore } from "../../src/main/events/event-store.ts";
import { registerDesktopAgentHandlers } from "../../src/main/ipc/register-handlers.ts";
import type { DesktopMcpManager } from "../../src/main/mcp/mcp-manager.ts";
import type { DesktopRuntimeHost } from "../../src/main/runtime/desktop-runtime-host.ts";
import type { DesktopApprovalBroker } from "../../src/main/security/approval-broker.ts";
import type { DesktopProjectStore } from "../../src/main/storage/project-store.ts";
import type { DesktopProviderKeysStore } from "../../src/main/storage/provider-keys-store.ts";
import type { DesktopSessionStore } from "../../src/main/storage/session-store.ts";
import type { DesktopSettingsStore } from "../../src/main/storage/settings-store.ts";
import type { DesktopPtyManager } from "../../src/main/terminal/pty-manager.ts";
import { IPC_CHANNELS } from "../../src/shared/ipc-contract.ts";
import type { DesktopEventManagementProposal } from "../../src/shared/types.ts";

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
type IpcListener = (event: { ports: FakeMessagePort[] }) => void;

class FakeMessagePort {
	readonly messages: unknown[] = [];
	readonly start = vi.fn();
	private closeListener: (() => void) | undefined;

	postMessage(message: unknown): void {
		this.messages.push(message);
	}

	on(event: "close", listener: () => void): void {
		if (event === "close") {
			this.closeListener = listener;
		}
	}

	close(): void {
		this.closeListener?.();
	}
}

const electronMocks = vi.hoisted(() => {
	const handlers = new Map<string, IpcHandler>();
	const listeners = new Map<string, IpcListener>();
	return {
		handlers,
		listeners,
		ipcMain: {
			handle: vi.fn((channel: string, handler: IpcHandler) => {
				handlers.set(channel, handler);
			}),
			on: vi.fn((channel: string, listener: IpcListener) => {
				listeners.set(channel, listener);
			}),
			removeAllListeners: vi.fn((channel: string) => {
				listeners.delete(channel);
			}),
			removeHandler: vi.fn((channel: string) => {
				handlers.delete(channel);
			}),
		},
	};
});

vi.mock("electron", () => ({
	BrowserWindow: { fromWebContents: vi.fn() },
	dialog: { showOpenDialog: vi.fn() },
	ipcMain: electronMocks.ipcMain,
	shell: { openExternal: vi.fn() },
}));

function getHandler(channel: string): IpcHandler {
	const handler = electronMocks.handlers.get(channel);
	if (!handler) {
		throw new Error(`Expected handler for ${channel}`);
	}
	return handler;
}

function getListener(channel: string): IpcListener {
	const listener = electronMocks.listeners.get(channel);
	if (!listener) {
		throw new Error(`Expected listener for ${channel}`);
	}
	return listener;
}

async function createEventStore(rootDir: string): Promise<DesktopEventStore> {
	return new DesktopEventStore(
		join(rootDir, "events", "index.json"),
		join(rootDir, "events", "data"),
		join(rootDir, "events", "attachments"),
	);
}

describe("event IPC handlers", () => {
	it("opens native event attachments and prepares selected document snapshots", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "desktop-event-handlers-"));
		const eventStore = await createEventStore(rootDir);
		const attachmentPath = join(rootDir, "idea.md");
		await writeFile(attachmentPath, "# Idea\n\nShip event attachments.");
		vi.mocked(dialog.showOpenDialog).mockResolvedValue({
			canceled: false,
			filePaths: [attachmentPath],
		});
		registerDesktopAgentHandlers({
			host: {} as DesktopRuntimeHost,
			authService: {} as DesktopAuthService,
			ptyManager: {} as DesktopPtyManager,
			mcpManager: {} as DesktopMcpManager,
			approvalBroker: {} as DesktopApprovalBroker,
			getRuntimeCatalog: async () => ({ defaultTools: [], providers: [] }),
			stores: {
				eventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore: {} as DesktopSettingsStore,
			},
		});

		const result = await getHandler(IPC_CHANNELS.openEventAttachments)({ sender: {} }, { defaultPath: rootDir });

		expect(dialog.showOpenDialog).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultPath: rootDir,
				filters: [{ name: "Event documents", extensions: ["txt", "md", "docx"] }],
				properties: ["openFile", "multiSelections"],
			}),
		);
		expect(result).toEqual({
			attachments: [
				expect.objectContaining({
					mimeType: "text/markdown",
					name: "idea.md",
					sourcePath: attachmentPath,
					textSnapshot: "# Idea\n\nShip event attachments.",
				}),
			],
			errors: [],
		});
	});

	it("handles criteria, comments, proposals, and publishes event updates", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "desktop-event-handlers-"));
		const eventStore = await createEventStore(rootDir);
		let createdEventId = "";
		const generateText = vi.fn(async () =>
			JSON.stringify({
				items: [
					{
						id: "proposal-item-1",
						eventId: createdEventId,
						priority: "P0",
						status: "ready",
						reason: "Blocks the active plan.",
						commentBody: "Move this event to the front.",
					},
				],
			}),
		);

		registerDesktopAgentHandlers({
			host: {} as DesktopRuntimeHost,
			authService: {} as DesktopAuthService,
			ptyManager: {} as DesktopPtyManager,
			mcpManager: {} as DesktopMcpManager,
			approvalBroker: {} as DesktopApprovalBroker,
			getRuntimeCatalog: async () => ({ defaultTools: [], providers: [] }),
			stores: {
				eventStore,
				projectStore: {} as DesktopProjectStore,
				providerKeysStore: {} as DesktopProviderKeysStore,
				sessionStore: {} as DesktopSessionStore,
				settingsStore: {} as DesktopSettingsStore,
			},
			eventServices: {
				criteriaFilePath: join(rootDir, "events", "EVENTS.md"),
				generateText,
			},
		});
		const port = new FakeMessagePort();
		getListener(IPC_CHANNELS.openEventStream)({ ports: [port] });

		await expect(
			getHandler(IPC_CHANNELS.saveEventManagementCriteria)(undefined, {
				content: "P0 means release blocker.",
			}),
		).resolves.toEqual({
			path: join(rootDir, "events", "EVENTS.md"),
			content: "P0 means release blocker.",
		});
		await expect(getHandler(IPC_CHANNELS.getEventManagementCriteria)(undefined)).resolves.toEqual({
			path: join(rootDir, "events", "EVENTS.md"),
			content: "P0 means release blocker.",
		});

		const createdEvent = (await getHandler(IPC_CHANNELS.createEvent)(undefined, {
			body: "Fix the release blocker.",
			priority: "P1",
		})) as Awaited<ReturnType<DesktopEventStore["createEvent"]>>;
		createdEventId = createdEvent.id;
		const commented = (await getHandler(IPC_CHANNELS.addEventComment)(undefined, {
			eventId: createdEvent.id,
			author: "user",
			body: "Customer escalation.",
		})) as Awaited<ReturnType<DesktopEventStore["addEventComment"]>>;
		expect(commented.commentCount).toBe(1);

		const proposal = (await getHandler(IPC_CHANNELS.createEventManagementProposal)(
			undefined,
		)) as DesktopEventManagementProposal;
		expect(proposal).toEqual(
			expect.objectContaining({
				criteriaPath: join(rootDir, "events", "EVENTS.md"),
				items: [
					expect.objectContaining({
						eventId: createdEvent.id,
						priority: "P0",
						status: "ready",
					}),
				],
			}),
		);
		expect(generateText).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: expect.stringContaining("P0 means release blocker."),
			}),
		);

		const applied = (await getHandler(IPC_CHANNELS.applyEventManagementProposal)(undefined, {
			proposalId: "proposal-1",
			selectedItemIds: ["proposal-item-1"],
			items: proposal.items,
		})) as Awaited<ReturnType<DesktopEventStore["applyEventManagementProposal"]>>;
		expect(applied[0]).toEqual(
			expect.objectContaining({
				priority: "P0",
				status: "ready",
				commentCount: 2,
			}),
		);
		expect(port.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "event_updated", event: expect.objectContaining({ id: createdEvent.id }) }),
				expect.objectContaining({
					type: "event_updated",
					event: expect.objectContaining({ id: createdEvent.id, priority: "P0", status: "ready" }),
				}),
			]),
		);
	});
});
