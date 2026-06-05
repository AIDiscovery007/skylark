import { describe, expect, it } from "vitest";
import {
	validateApprovalDecision,
	validateConsumeProposedPlanRequest,
	validateCreateSkillRequest,
	validateEventCommentCreateRequest,
	validateEventCreateRequest,
	validateEventManagementApplyRequest,
	validateEventManagementCriteriaUpdateRequest,
	validateEventManagementProposalRequest,
	validateEventRunRequest,
	validateEventStatusUpdateRequest,
	validateEventUpdateRequest,
	validateExecutePlanRequest,
	validateExternalUrl,
	validateMcpServerUpsertRequest,
	validateOpenEventAttachmentsRequest,
	validatePrepareEventAttachmentsRequest,
	validatePreparePromptAttachmentsRequest,
	validatePreviewFileRequest,
	validatePromptRequest,
	validatePromptTemplateDeleteRequest,
	validatePromptTemplateUpsertRequest,
	validateProviderId,
	validateProviderKey,
	validateReviewSnapshotRequest,
	validateSessionModeUpdateRequest,
	validateSessionProfileUpdateRequest,
	validateSettingInput,
	validateTerminalCreateRequest,
	validateTerminalDisposeRequest,
	validateTerminalResizeRequest,
	validateTerminalWriteRequest,
	validateWorkspacePreviewFileRequest,
	validateWorkspaceRuntimeCaptureRequest,
	validateWorkspaceRuntimeCreateDebugRequest,
	validateWorkspaceRuntimeId,
} from "../../src/main/ipc/validate-ipc.ts";
import { DEFAULT_DESKTOP_APPEARANCE_SETTINGS } from "../../src/shared/types.ts";

describe("validate-ipc", () => {
	it("accepts well-formed prompt requests and rejects malformed payloads", () => {
		const inlineImageData = "a".repeat(600_000);
		expect(validatePromptRequest({ sessionId: "session-1", text: "hello" })).toEqual({
			sessionId: "session-1",
			text: "hello",
		});
		expect(
			validatePromptRequest({
				sessionId: "session-1",
				text: "",
				capabilityInvocations: [{ type: "prompt_template", name: "review" }],
			}),
		).toEqual({
			sessionId: "session-1",
			text: "",
			capabilityInvocations: [{ type: "prompt_template", name: "review" }],
		});
		expect(
			validatePromptRequest({
				sessionId: "session-1",
				text: "",
				attachments: [
					{
						id: "attachment-1",
						kind: "text",
						name: "notes.md",
						mimeType: "text/markdown",
						size: 12,
						promptText: '<file name="notes.md">hello</file>',
						images: [],
					},
				],
			}),
		).toEqual({
			sessionId: "session-1",
			text: "",
			attachments: [
				{
					id: "attachment-1",
					kind: "text",
					name: "notes.md",
					mimeType: "text/markdown",
					size: 12,
					promptText: '<file name="notes.md">hello</file>',
					images: [],
				},
			],
		});
		expect(
			validatePromptRequest({
				sessionId: "session-1",
				text: "",
				attachments: [
					{
						id: "attachment-1",
						kind: "image",
						name: "panel_003.jpg",
						mimeType: "image/jpeg",
						size: 450_000,
						promptText: '<file name="panel_003.jpg"></file>',
						images: [{ type: "image", mimeType: "image/jpeg", data: inlineImageData }],
					},
				],
			}),
		).toEqual({
			sessionId: "session-1",
			text: "",
			attachments: [
				{
					id: "attachment-1",
					kind: "image",
					name: "panel_003.jpg",
					mimeType: "image/jpeg",
					size: 450_000,
					promptText: '<file name="panel_003.jpg"></file>',
					images: [{ type: "image", mimeType: "image/jpeg", data: inlineImageData }],
				},
			],
		});
		expect(
			validatePreparePromptAttachmentsRequest({
				candidates: [
					{
						type: "inline_image",
						name: "pasted-image.png",
						mimeType: "image/png",
						data: inlineImageData,
						size: 450_000,
					},
				],
			}),
		).toEqual({
			candidates: [
				{
					type: "inline_image",
					name: "pasted-image.png",
					mimeType: "image/png",
					data: inlineImageData,
					size: 450_000,
				},
			],
		});

		expect(() => validatePromptRequest({ sessionId: "", text: "hello" })).toThrow(TypeError);
		expect(() => validatePromptRequest({ sessionId: "session-1", text: "" })).toThrow(TypeError);
		expect(() =>
			validatePromptRequest({
				sessionId: "session-1",
				text: "",
				attachments: [{ id: "attachment-1", kind: "text", name: "notes.md", mimeType: "text/plain" }],
			}),
		).toThrow(TypeError);
		expect(() =>
			validatePromptRequest({
				sessionId: "session-1",
				text: "hello",
				capabilityInvocations: [
					{ type: "prompt_template", name: "review" },
					{ type: "prompt_template", name: "audit" },
				],
			}),
		).toThrow(TypeError);
		expect(() => validatePromptRequest(null)).toThrow(TypeError);
	});

	it("validates settings by key-specific value type", () => {
		expect(validateSettingInput("showThinkingBlocks", true)).toEqual({
			key: "showThinkingBlocks",
			value: true,
		});
		expect(validateSettingInput("defaultThinkingLevel", "high")).toEqual({
			key: "defaultThinkingLevel",
			value: "high",
		});
		expect(validateSettingInput("compactInstruction", "preserve validation status")).toEqual({
			key: "compactInstruction",
			value: "preserve validation status",
		});
		expect(validateSettingInput("lastOpenedSessionId", undefined)).toEqual({
			key: "lastOpenedSessionId",
			value: undefined,
		});
		expect(
			validateSettingInput("windowStates", {
				main: {
					height: 900,
					isFullScreen: false,
					isMaximized: true,
					width: 1320,
					x: 42,
					y: 51,
				},
				settings: {
					height: 720,
					width: 900,
				},
			}),
		).toEqual({
			key: "windowStates",
			value: {
				main: {
					height: 900,
					isFullScreen: false,
					isMaximized: true,
					width: 1320,
					x: 42,
					y: 51,
				},
				settings: {
					height: 720,
					width: 900,
				},
			},
		});
		expect(
			validateSettingInput("permissionApprovals", {
				bash: true,
				fileMutation: true,
				capabilityMutation: true,
				mcpTool: true,
				mcpServerLifecycle: true,
				terminal: false,
			}),
		).toEqual({
			key: "permissionApprovals",
			value: {
				bash: true,
				fileMutation: true,
				capabilityMutation: true,
				mcpTool: true,
				mcpServerLifecycle: true,
				terminal: false,
			},
		});
		expect(
			validateSettingInput("appearance", {
				...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
				themeMode: "dark",
				uiFontSize: 9.6,
				codeFontSize: 21,
				lightTheme: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme,
					accentColor: "#526FFF",
					uiFontFamily: "  Inter  ",
				},
				darkTheme: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme,
					backgroundColor: "#2D2D2B",
					contrast: 101,
				},
			}),
		).toEqual({
			key: "appearance",
			value: {
				...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
				themeMode: "dark",
				uiFontSize: 10,
				codeFontSize: 20,
				lightTheme: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme,
					accentColor: "#526fff",
					uiFontFamily: "Inter",
				},
				darkTheme: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme,
					backgroundColor: "#2d2d2b",
					contrast: 100,
				},
			},
		});
		expect(validateSettingInput("globalAgentsInstruction", "  Always keep responses concise.  ")).toEqual({
			key: "globalAgentsInstruction",
			value: "Always keep responses concise.",
		});

		expect(() => validateSettingInput("showThinkingBlocks", "yes")).toThrow(TypeError);
		expect(() => validateSettingInput("defaultThinkingLevel", "max")).toThrow(TypeError);
		expect(() => validateSettingInput("compactInstruction", "")).toThrow(TypeError);
		expect(() =>
			validateSettingInput("windowStates", {
				main: { height: 120, width: 400 },
			}),
		).toThrow(TypeError);
		expect(() =>
			validateSettingInput("windowStates", {
				debug: { height: 900, width: 1200 },
			}),
		).toThrow(TypeError);
		expect(() => validateSettingInput("permissionApprovals", { bash: true })).toThrow(TypeError);
		expect(() =>
			validateSettingInput("permissionApprovals", {
				bash: true,
				fileMutation: true,
				capabilityMutation: true,
				mcpTool: true,
				mcpServerLifecycle: true,
				terminal: true,
				extra: true,
			}),
		).toThrow(TypeError);
		expect(() =>
			validateSettingInput("appearance", {
				...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
				themeMode: "blue",
			}),
		).toThrow(TypeError);
		expect(() =>
			validateSettingInput("appearance", {
				...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
				lightTheme: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.lightTheme,
					accentColor: "526fff",
				},
			}),
		).toThrow(TypeError);
		expect(() =>
			validateSettingInput("appearance", {
				...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
				darkTheme: {
					...DEFAULT_DESKTOP_APPEARANCE_SETTINGS.darkTheme,
					codeFontFamily: "JetBrains Mono;",
				},
			}),
		).toThrow(TypeError);
		expect(() =>
			validateSettingInput("appearance", {
				...DEFAULT_DESKTOP_APPEARANCE_SETTINGS,
				uiFontSize: "13",
			}),
		).toThrow(TypeError);
		expect(() => validateSettingInput("globalAgentsInstruction", "")).toThrow(TypeError);
		expect(() => validateSettingInput("unknown", true)).toThrow(TypeError);
	});

	it("validates approval decisions", () => {
		expect(validateApprovalDecision({ requestId: "approval-1", approved: true })).toEqual({
			requestId: "approval-1",
			approved: true,
			reason: undefined,
		});
		expect(validateApprovalDecision({ requestId: "approval-1", approved: false, reason: "No." })).toEqual({
			requestId: "approval-1",
			approved: false,
			reason: "No.",
		});

		expect(() => validateApprovalDecision({ requestId: "", approved: true })).toThrow(TypeError);
		expect(() => validateApprovalDecision({ requestId: "approval-1", approved: "yes" })).toThrow(TypeError);
		expect(() => validateApprovalDecision(null)).toThrow(TypeError);
	});

	it("validates workspace runtime identifiers and capture requests", () => {
		expect(validateWorkspaceRuntimeId("ws-login")).toBe("ws-login");
		expect(
			validateWorkspaceRuntimeCreateDebugRequest({
				issue: "/api/login 一直 500，帮我定位并修掉。",
				projectId: "project-1",
				repoPath: "/workspace/project",
				taskTitle: "fix-login-500",
			}),
		).toEqual({
			issue: "/api/login 一直 500，帮我定位并修掉。",
			projectId: "project-1",
			repoPath: "/workspace/project",
			taskTitle: "fix-login-500",
		});
		expect(
			validateWorkspaceRuntimeCaptureRequest({
				linesPerPane: 200,
				reason: "manual runtime panel capture",
				roles: ["test", "logs"],
				workspaceId: "ws-login",
			}),
		).toEqual({
			linesPerPane: 200,
			reason: "manual runtime panel capture",
			roles: ["test", "logs"],
			workspaceId: "ws-login",
		});

		expect(() => validateWorkspaceRuntimeId("")).toThrow(TypeError);
		expect(() => validateWorkspaceRuntimeCreateDebugRequest({})).toThrow(TypeError);
		expect(() => validateWorkspaceRuntimeCreateDebugRequest({ projectId: "" })).toThrow(TypeError);
		expect(() =>
			validateWorkspaceRuntimeCaptureRequest({
				roles: ["socket"],
				workspaceId: "ws-login",
			}),
		).toThrow(TypeError);
		expect(() =>
			validateWorkspaceRuntimeCaptureRequest({
				linesPerPane: 0,
				workspaceId: "ws-login",
			}),
		).toThrow(TypeError);
	});

	it("validates provider ids and provider keys", () => {
		expect(validateProviderId("kimi")).toBe("kimi");
		expect(validateProviderKey("sk-test")).toBe("sk-test");

		expect(() => validateProviderId("")).toThrow(TypeError);
		expect(() => validateProviderKey("")).toThrow(TypeError);
		expect(() => validateProviderKey(123)).toThrow(TypeError);
	});

	it("validates session profile updates without widening the runtime API", () => {
		expect(
			validateSessionProfileUpdateRequest({
				modelId: "model-1",
				provider: "provider-1",
				sessionId: "session-1",
				thinkingLevel: "low",
			}),
		).toEqual({
			modelId: "model-1",
			provider: "provider-1",
			sessionId: "session-1",
			thinkingLevel: "low",
		});

		expect(() => validateSessionProfileUpdateRequest({ sessionId: "session-1", thinkingLevel: "max" })).toThrow(
			TypeError,
		);
		expect(() => validateSessionProfileUpdateRequest({ provider: "provider-1" })).toThrow(TypeError);
	});

	it("validates session mode and execute plan requests", () => {
		expect(validateSessionModeUpdateRequest({ sessionId: "session-1", agentMode: "plan" })).toEqual({
			sessionId: "session-1",
			agentMode: "plan",
		});
		expect(validateSessionModeUpdateRequest({ sessionId: "session-1", agentMode: "execute" })).toEqual({
			sessionId: "session-1",
			agentMode: "execute",
		});
		expect(validateExecutePlanRequest({ sessionId: "session-1" })).toEqual({
			sessionId: "session-1",
		});
		expect(validateConsumeProposedPlanRequest({ sessionId: "session-1", planMessageId: "assistant-run-0" })).toEqual({
			sessionId: "session-1",
			planMessageId: "assistant-run-0",
		});

		expect(() => validateSessionModeUpdateRequest({ sessionId: "session-1", agentMode: "review" })).toThrow(
			TypeError,
		);
		expect(() => validateSessionModeUpdateRequest({ sessionId: "", agentMode: "plan" })).toThrow(TypeError);
		expect(() => validateExecutePlanRequest({ planText: "Do it" })).toThrow(TypeError);
		expect(() => validateConsumeProposedPlanRequest({ sessionId: "session-1", planMessageId: "" })).toThrow(
			TypeError,
		);
		expect(() => validateConsumeProposedPlanRequest({ planMessageId: "assistant-run-0" })).toThrow(TypeError);
	});

	it("validates desktop event requests", () => {
		expect(
			validateEventCreateRequest({
				body: "Capture this idea",
				priority: "P1",
				attachments: [
					{
						id: "attachment-1",
						name: "idea.md",
						sourcePath: "/workspace/idea.md",
						mimeType: "text/markdown",
						size: 12,
						textSnapshot: "idea",
					},
				],
			}),
		).toEqual({
			body: "Capture this idea",
			priority: "P1",
			attachments: [
				{
					id: "attachment-1",
					name: "idea.md",
					sourcePath: "/workspace/idea.md",
					mimeType: "text/markdown",
					size: 12,
					textSnapshot: "idea",
				},
			],
		});
		expect(validateEventUpdateRequest({ eventId: "event-1", body: "" })).toEqual({
			eventId: "event-1",
			body: "",
		});
		expect(validateEventUpdateRequest({ eventId: "event-1", priority: null })).toEqual({
			eventId: "event-1",
			priority: null,
		});
		expect(
			validateEventCommentCreateRequest({
				eventId: "event-1",
				author: "user",
				body: "This blocks release.",
			}),
		).toEqual({
			eventId: "event-1",
			author: "user",
			body: "This blocks release.",
		});
		expect(validateEventManagementCriteriaUpdateRequest({ content: "P0 means blocker." })).toEqual({
			content: "P0 means blocker.",
		});
		expect(validateEventManagementProposalRequest(undefined)).toEqual({});
		expect(validateEventManagementProposalRequest({ includeCompleted: true })).toEqual({
			includeCompleted: true,
		});
		expect(
			validateEventManagementApplyRequest({
				proposalId: "proposal-1",
				selectedItemIds: ["item-1"],
				items: [
					{
						id: "item-1",
						eventId: "event-1",
						priority: "P0",
						status: "ready",
						reason: "Blocking release.",
						commentBody: "Handle first.",
					},
				],
			}),
		).toEqual({
			proposalId: "proposal-1",
			selectedItemIds: ["item-1"],
			items: [
				{
					id: "item-1",
					eventId: "event-1",
					priority: "P0",
					status: "ready",
					reason: "Blocking release.",
					commentBody: "Handle first.",
				},
			],
		});
		expect(validateEventStatusUpdateRequest({ eventId: "event-1", status: "ready" })).toEqual({
			eventId: "event-1",
			status: "ready",
		});
		expect(
			validatePrepareEventAttachmentsRequest({
				candidates: [{ type: "path", path: "/workspace/idea.docx" }],
			}),
		).toEqual({
			candidates: [{ type: "path", path: "/workspace/idea.docx" }],
		});
		expect(validateOpenEventAttachmentsRequest(undefined)).toEqual({});
		expect(validateOpenEventAttachmentsRequest({ defaultPath: "/workspace" })).toEqual({
			defaultPath: "/workspace",
		});
		expect(
			validateEventRunRequest({
				eventId: "event-1",
				projectId: "project-1",
				promptText: "",
				attachmentIds: ["attachment-1"],
			}),
		).toEqual({
			eventId: "event-1",
			projectId: "project-1",
			promptText: "",
			attachmentIds: ["attachment-1"],
		});

		expect(() => validateEventCreateRequest({ body: "" })).toThrow(TypeError);
		expect(() => validateEventCreateRequest({ body: "x", priority: "P4" })).toThrow(TypeError);
		expect(() => validateEventCommentCreateRequest({ eventId: "event-1", author: "agent", body: "" })).toThrow(
			TypeError,
		);
		expect(() => validateEventManagementCriteriaUpdateRequest({ content: "" })).toThrow(TypeError);
		expect(() =>
			validateEventManagementApplyRequest({
				proposalId: "proposal-1",
				selectedItemIds: ["item-1"],
				items: [
					{
						id: "item-1",
						eventId: "event-1",
						status: "running",
						reason: "Invalid.",
						commentBody: "Invalid.",
					},
				],
			}),
		).toThrow(TypeError);
		expect(() => validateEventStatusUpdateRequest({ eventId: "event-1", status: "blocked" })).toThrow(TypeError);
		expect(() =>
			validatePrepareEventAttachmentsRequest({ candidates: [{ type: "inline_image", path: "/tmp/a.png" }] }),
		).toThrow(TypeError);
		expect(() => validateOpenEventAttachmentsRequest({ defaultPath: "" })).toThrow(TypeError);
		expect(() =>
			validateEventRunRequest({ eventId: "event-1", projectId: "project-1", promptText: "", attachmentIds: [] }),
		).toThrow(TypeError);
		expect(() =>
			validateEventRunRequest({
				eventId: "event-1",
				projectId: "project-1",
				promptText: "Run",
				attachmentIds: ["attachment-1", "attachment-1"],
			}),
		).toThrow(TypeError);
	});

	it("validates capability management requests", () => {
		expect(
			validateCreateSkillRequest({
				name: "review",
				description: "Review code",
				content: "Review the current diff.",
				scope: "project",
				overwrite: true,
			}),
		).toEqual({
			name: "review",
			description: "Review code",
			content: "Review the current diff.",
			scope: "project",
			overwrite: true,
		});
		expect(
			validatePromptTemplateUpsertRequest({
				name: "brief",
				description: "Create a brief",
				content: "Summarize $ARGUMENTS",
				argumentHint: "<topic>",
				scope: "global",
			}),
		).toEqual({
			name: "brief",
			description: "Create a brief",
			content: "Summarize $ARGUMENTS",
			argumentHint: "<topic>",
			scope: "global",
			overwrite: undefined,
		});
		expect(validatePromptTemplateDeleteRequest({ filePath: "/workspace/.pi/prompts/brief.md" })).toEqual({
			filePath: "/workspace/.pi/prompts/brief.md",
		});
		expect(
			validateMcpServerUpsertRequest({
				name: "filesystem",
				command: "node",
				args: ["server.js"],
				env: { ROOT: "/workspace" },
				cwd: "/workspace",
				connectNow: true,
			}),
		).toEqual({
			id: undefined,
			name: "filesystem",
			command: "node",
			args: ["server.js"],
			env: { ROOT: "/workspace" },
			cwd: "/workspace",
			enabled: undefined,
			connectNow: true,
		});

		expect(() => validateCreateSkillRequest({ name: "review", description: "", content: "" })).toThrow(TypeError);
		expect(() =>
			validatePromptTemplateUpsertRequest({ name: "brief", description: "Brief", content: "", scope: "team" }),
		).toThrow(TypeError);
		expect(() => validateMcpServerUpsertRequest({ name: "filesystem", command: "", args: "server.js" })).toThrow(
			TypeError,
		);
	});

	it("validates review snapshot requests without accepting arbitrary paths", () => {
		expect(validateReviewSnapshotRequest({ projectId: "project-1" })).toEqual({
			projectId: "project-1",
			sessionId: undefined,
		});
		expect(validateReviewSnapshotRequest({ sessionId: "session-1" })).toEqual({
			projectId: undefined,
			sessionId: "session-1",
		});

		expect(() => validateReviewSnapshotRequest({ cwd: "/workspace" })).toThrow(TypeError);
		expect(() => validateReviewSnapshotRequest({ projectId: "" })).toThrow(TypeError);
		expect(() => validateReviewSnapshotRequest(null)).toThrow(TypeError);
	});

	it("validates preview file refresh requests", () => {
		expect(validatePreviewFileRequest({ path: "/workspace/project/index.html" })).toEqual({
			path: "/workspace/project/index.html",
		});

		expect(() => validatePreviewFileRequest({ path: "" })).toThrow(TypeError);
		expect(() => validatePreviewFileRequest({ path: 42 })).toThrow(TypeError);
		expect(() => validatePreviewFileRequest(null)).toThrow(TypeError);
	});

	it("validates external URLs without allowing local file escape hatches", () => {
		expect(validateExternalUrl("https://example.com/docs")).toBe("https://example.com/docs");
		expect(validateExternalUrl("mailto:support@example.com")).toBe("mailto:support@example.com");

		expect(() => validateExternalUrl("/workspace/project/README.md")).toThrow(TypeError);
		expect(() => validateExternalUrl("file:///Users/qiaochao/.ssh/id_rsa")).toThrow(TypeError);
		expect(() => validateExternalUrl("javascript:alert(1)")).toThrow(TypeError);
	});

	it("validates workspace preview file requests", () => {
		expect(validateWorkspacePreviewFileRequest({ path: "src/index.html", projectId: "project-1" })).toEqual({
			path: "src/index.html",
			projectId: "project-1",
			sessionId: undefined,
		});
		expect(
			validateWorkspacePreviewFileRequest({ path: "/workspace/project/index.html", sessionId: "session-1" }),
		).toEqual({
			path: "/workspace/project/index.html",
			projectId: undefined,
			sessionId: "session-1",
		});

		expect(() => validateWorkspacePreviewFileRequest({ path: "src/index.html" })).toThrow(TypeError);
		expect(() => validateWorkspacePreviewFileRequest({ path: "", projectId: "project-1" })).toThrow(TypeError);
		expect(() => validateWorkspacePreviewFileRequest(null)).toThrow(TypeError);
	});

	it("validates terminal create, write, and resize requests", () => {
		expect(
			validateTerminalCreateRequest({
				cols: 120,
				rows: 32,
				sessionId: "session-1",
				source: { type: "shell", cwd: "/workspace" },
				terminalId: "terminal-1",
			}),
		).toEqual({
			cols: 120,
			rows: 32,
			sessionId: "session-1",
			source: { type: "shell", cwd: "/workspace" },
			terminalId: "terminal-1",
		});
		expect(
			validateTerminalCreateRequest({
				cols: 120,
				rows: 32,
				sessionId: "session-1",
				source: { type: "environment_resource", resourceId: "env_tmux_1", readOnly: true },
				terminalId: "terminal-1",
			}),
		).toEqual({
			cols: 120,
			rows: 32,
			sessionId: "session-1",
			source: { type: "environment_resource", resourceId: "env_tmux_1", readOnly: true },
			terminalId: "terminal-1",
		});
		expect(validateTerminalWriteRequest({ data: "ls\n", terminalId: "terminal-1" })).toEqual({
			data: "ls\n",
			terminalId: "terminal-1",
		});
		expect(validateTerminalResizeRequest({ cols: 100, rows: 24, terminalId: "terminal-1" })).toEqual({
			cols: 100,
			rows: 24,
			terminalId: "terminal-1",
		});
		expect(validateTerminalDisposeRequest({ terminalId: "terminal-1" })).toEqual({
			terminalId: "terminal-1",
		});

		expect(() =>
			validateTerminalCreateRequest({
				cols: 0,
				rows: 32,
				sessionId: "session-1",
				source: { type: "shell", cwd: "/workspace" },
				terminalId: "terminal-1",
			}),
		).toThrow(TypeError);
		expect(() =>
			validateTerminalCreateRequest({
				cols: 120,
				rows: 32,
				sessionId: "session-1",
				source: { type: "environment_resource", resourceId: "env_tmux_1", readOnly: false },
				terminalId: "terminal-1",
			}),
		).toThrow(TypeError);
		expect(() => validateTerminalWriteRequest({ data: 1, terminalId: "terminal-1" })).toThrow(TypeError);
		expect(() => validateTerminalWriteRequest({ data: "ls\n" })).toThrow(TypeError);
		expect(() => validateTerminalResizeRequest({ cols: 100, rows: 1001, terminalId: "terminal-1" })).toThrow(
			TypeError,
		);
		expect(() => validateTerminalDisposeRequest({})).toThrow(TypeError);
	});
});
