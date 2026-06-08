import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readSubagentSnapshot } from "../../src/main/runtime/subagent-snapshot.ts";
import type { DesktopEnvironmentResource } from "../../src/shared/types.ts";
import { createTrackedTempDir } from "../support/temp-dir.ts";

function createSubagentResource(overrides: Partial<DesktopEnvironmentResource> = {}): DesktopEnvironmentResource {
	return {
		createdAt: "2026-06-08T04:46:23.455Z",
		cwd: "/workspace/project",
		id: "env_subagent_1",
		kind: "subagent",
		lastSeenAt: "2026-06-08T04:46:23.455Z",
		metadata: {
			subagentId: "subagent-1",
			transcriptPath: "/missing/transcript.jsonl",
		},
		provider: "subagent",
		sessionId: "session-1",
		status: "running",
		title: "Inspect auth flow",
		updatedAt: "2026-06-08T04:46:23.455Z",
		...overrides,
	};
}

describe("readSubagentSnapshot", () => {
	it("returns an empty snapshot when a registered transcript file has not been created yet", async () => {
		const subagentSessionsDir = createTrackedTempDir("skylark-subagent-snapshot-");
		const transcriptPath = join(subagentSessionsDir, "session-1", "subagent-1.jsonl");
		const resource = createSubagentResource({
			metadata: {
				subagentId: "subagent-1",
				transcriptPath,
			},
		});

		await expect(
			readSubagentSnapshot({
				environmentResourceStore: {
					listResources: vi.fn(async () => [resource]),
				},
				request: {
					parentSessionId: "session-1",
					subagentId: "subagent-1",
				},
				subagentSessionsDir,
			}),
		).resolves.toMatchObject({
			availableTools: ["read", "find", "grep", "ls", "bash"],
			diagnostics: [
				{
					message: "Subagent transcript file is not available yet.",
					type: "warning",
				},
			],
			isStreaming: true,
			messages: [],
			parentSessionId: "session-1",
			resource: {
				metadata: {
					subagentId: "subagent-1",
					transcriptPath,
				},
			},
			sessionId: "subagent-1",
			subagentId: "subagent-1",
			thinkingLevel: "off",
		});
	});
});
