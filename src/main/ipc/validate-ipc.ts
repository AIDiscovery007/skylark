import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { isRecord } from "../../shared/guards.ts";
import { normalizeDesktopWebPreviewUrl } from "../../shared/preview-url.ts";
import type { DesktopSessionMessagesRequest } from "../../shared/serialized-agent-event.ts";
import type {
	DesktopAgentMode,
	DesktopAppearanceSettings,
	DesktopApprovalDecision,
	DesktopCapabilityDetailRequest,
	DesktopCompactRequest,
	DesktopConsumeProposedPlanRequest,
	DesktopCreateSkillRequest,
	DesktopEnvironmentResourceDetachRequest,
	DesktopEnvironmentResourceListRequest,
	DesktopEventAttachmentCandidate,
	DesktopEventAttachmentDraft,
	DesktopEventCommentAuthor,
	DesktopEventCommentCreateRequest,
	DesktopEventCreateRequest,
	DesktopEventDeleteRequest,
	DesktopEventListRequest,
	DesktopEventManagementApplyRequest,
	DesktopEventManagementCriteriaUpdateRequest,
	DesktopEventManagementProposalItem,
	DesktopEventManagementProposalRequest,
	DesktopEventPriority,
	DesktopEventRunRequest,
	DesktopEventStatus,
	DesktopEventStatusUpdateRequest,
	DesktopEventUpdateRequest,
	DesktopExecutePlanRequest,
	DesktopMcpServerUpsertRequest,
	DesktopOpenEventAttachmentsRequest,
	DesktopOpenPromptAttachmentsRequest,
	DesktopPermissionApprovalSettings,
	DesktopPreparedPromptAttachment,
	DesktopPrepareEventAttachmentsRequest,
	DesktopPreparePromptAttachmentsRequest,
	DesktopPreviewFileRequest,
	DesktopPromptAttachmentCandidate,
	DesktopPromptCapabilityInvocation,
	DesktopPromptRequest,
	DesktopPromptTemplateDeleteRequest,
	DesktopPromptTemplateUpsertRequest,
	DesktopReviewFilePatchRequest,
	DesktopReviewSnapshotRequest,
	DesktopSessionModeUpdateRequest,
	DesktopSessionProfileUpdateRequest,
	DesktopSettingKey,
	DesktopSettingsData,
	DesktopSettingsOpenRequest,
	DesktopSettingsSectionId,
	DesktopSubagentSnapshotRequest,
	DesktopTerminalCreateRequest,
	DesktopTerminalDisposeRequest,
	DesktopTerminalResizeRequest,
	DesktopTerminalSource,
	DesktopTerminalWriteRequest,
	DesktopThemeMode,
	DesktopThemePalette,
	DesktopWebPreviewBounds,
	DesktopWebPreviewBoundsRequest,
	DesktopWebPreviewCloseRequest,
	DesktopWebPreviewControlAction,
	DesktopWebPreviewControlRequest,
	DesktopWebPreviewSelectionModeRequest,
	DesktopWebPreviewShowRequest,
	DesktopWebPreviewStorageKind,
	DesktopWebPreviewStorageRequest,
	DesktopWindowKind,
	DesktopWindowState,
	DesktopWorkspaceFileListRequest,
	DesktopWorkspacePreviewFileRequest,
	DesktopWorkspaceRuntimeCaptureRequest,
	DesktopWorkspaceRuntimeCreateDebugRequest,
	DesktopWorkspaceRuntimePaneControlRequest,
	DesktopWorkspaceRuntimePaneTextRequest,
} from "../../shared/types.ts";

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_FONT_FAMILY_LENGTH = 512;
const MAX_PROVIDER_KEY_LENGTH = 128_000;
const MAX_PROMPT_LENGTH = 512_000;
const MAX_EVENT_TITLE_LENGTH = 160;
const MIN_APPEARANCE_FONT_SIZE = 10;
const MAX_APPEARANCE_FONT_SIZE = 20;
const MAX_EVENT_ATTACHMENTS = 10;
const MAX_EVENT_MANAGEMENT_ITEMS = 200;
const MAX_RESOURCE_BODY_LENGTH = 512_000;
const MAX_CAPABILITY_INVOCATIONS = 24;
const MAX_PROMPT_ATTACHMENTS = 10;
const MAX_ATTACHMENT_SIZE = 128 * 1024 * 1024;
const MAX_WORKSPACE_FILE_LIST_LIMIT = 5000;
const MAX_SESSION_MESSAGES_PAGE_LIMIT = 500;
const MAX_INLINE_IMAGE_DATA_LENGTH = Math.ceil(MAX_ATTACHMENT_SIZE / 3) * 4;
const MAX_TERMINAL_WRITE_LENGTH = 1_048_576;
const MAX_CWD_LENGTH = 4096;
const MAX_URL_LENGTH = 4096;
const MAX_TERMINAL_DIMENSION = 1000;
const MAX_WINDOW_COORDINATE = 100_000;
const MAX_WINDOW_DIMENSION = 20_000;
const MIN_RESTORABLE_WINDOW_HEIGHT = 520;
const MIN_RESTORABLE_WINDOW_WIDTH = 720;
const PERMISSION_APPROVAL_SETTING_KEYS = [
	"bash",
	"fileMutation",
	"capabilityMutation",
	"mcpTool",
	"mcpServerLifecycle",
	"terminal",
] as const;
const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);
const DESKTOP_THEME_MODES = new Set<DesktopThemeMode>(["light", "dark", "system"]);
const DESKTOP_AGENT_MODES = new Set<DesktopAgentMode>(["plan", "execute"]);
const DESKTOP_EVENT_STATUSES = new Set<DesktopEventStatus>(["inbox", "ready", "running", "completed", "discarded"]);
const DESKTOP_EVENT_MANAGEMENT_STATUSES = new Set<Exclude<DesktopEventStatus, "running">>([
	"inbox",
	"ready",
	"completed",
	"discarded",
]);
const DESKTOP_EVENT_PRIORITIES = new Set<DesktopEventPriority>(["P0", "P1", "P2", "P3"]);
const DESKTOP_EVENT_COMMENT_AUTHORS = new Set<DesktopEventCommentAuthor>(["user", "agent"]);
const DESKTOP_WORKSPACE_PANE_ROLES = new Set(["agent", "shell", "dev-server", "test", "logs"]);
const DESKTOP_WINDOW_KINDS = new Set<DesktopWindowKind>(["main", "settings"]);
const DESKTOP_SETTINGS_SECTIONS = new Set<DesktopSettingsSectionId>([
	"general",
	"appearance",
	"permissions",
	"credentials",
]);
const DESKTOP_WEB_PREVIEW_CONTROL_ACTIONS = new Set<DesktopWebPreviewControlAction>([
	"back",
	"forward",
	"reload",
	"stop",
]);
const DESKTOP_WEB_PREVIEW_STORAGE_KINDS = new Set<DesktopWebPreviewStorageKind>(["cache", "cookies"]);

export type ValidatedDesktopSetting = {
	[TKey in DesktopSettingKey]: {
		key: TKey;
		value: DesktopSettingsData[TKey];
	};
}[DesktopSettingKey];

function reject(label: string, reason: string): never {
	throw new TypeError(`Invalid ${label}: ${reason}`);
}

function validateString(value: unknown, label: string, maxLength: number): string {
	if (typeof value !== "string") {
		reject(label, "expected a string");
	}
	if (value.length > maxLength) {
		reject(label, `must be ${maxLength} characters or fewer`);
	}
	return value;
}

function validateNonEmptyString(value: unknown, label: string, maxLength: number): string {
	const text = validateString(value, label, maxLength);
	if (text.trim().length === 0) {
		reject(label, "must not be empty");
	}
	return text;
}

function validateOptionalNonEmptyString(value: unknown, label: string, maxLength: number): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	return validateNonEmptyString(value, label, maxLength);
}

function validateOptionalBoolean(value: unknown, label: string): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "boolean") {
		reject(label, "expected a boolean");
	}
	return value;
}

function validateBoolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") {
		reject(label, "expected a boolean");
	}
	return value;
}

function validateNonNegativeInteger(value: unknown, label: string, maxValue: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > maxValue) {
		reject(label, `expected an integer between 0 and ${maxValue}`);
	}
	return value;
}

function validatePositiveInteger(value: unknown, label: string, maxValue: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maxValue) {
		reject(label, `expected an integer between 1 and ${maxValue}`);
	}
	return value;
}

function validateOptionalFiniteNumber(value: unknown, label: string, maxAbsValue: number): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maxAbsValue) {
		reject(label, `expected a finite number within +/-${maxAbsValue}`);
	}
	return Math.round(value);
}

function validateIdentifier(value: unknown, label: string): string {
	return validateNonEmptyString(value, label, MAX_IDENTIFIER_LENGTH);
}

function validateOptionalIdentifier(value: unknown, label: string): string | undefined {
	return validateOptionalNonEmptyString(value, label, MAX_IDENTIFIER_LENGTH);
}

function validateThinkingLevel(value: unknown, label: string): ThinkingLevel {
	if (typeof value !== "string" || !THINKING_LEVELS.has(value as ThinkingLevel)) {
		reject(label, "expected a supported thinking level");
	}
	return value as ThinkingLevel;
}

function validateOptionalThinkingLevel(value: unknown, label: string): ThinkingLevel | undefined {
	if (value === undefined) {
		return undefined;
	}
	return validateThinkingLevel(value, label);
}

function rejectUnsupportedKeys(value: Record<string, unknown>, allowedKeys: readonly string[], label: string): void {
	for (const key of Object.keys(value)) {
		if (!allowedKeys.includes(key)) {
			reject(label, `unsupported key '${key}'`);
		}
	}
}

function validateThemeMode(value: unknown, label: string): DesktopThemeMode {
	if (typeof value !== "string" || !DESKTOP_THEME_MODES.has(value as DesktopThemeMode)) {
		reject(label, "expected light, dark, or system");
	}
	return value as DesktopThemeMode;
}

function validateHexColor(value: unknown, label: string): string {
	const color = validateString(value, label, 7);
	if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
		reject(label, "expected a #RRGGBB color");
	}
	return color.toLowerCase();
}

function validateFontFamily(value: unknown, label: string): string {
	const fontFamily = validateNonEmptyString(value, label, MAX_FONT_FAMILY_LENGTH).trim();
	if (/[\u0000-\u001f\u007f;{}]/u.test(fontFamily)) {
		reject(label, "contains unsupported characters");
	}
	return fontFamily;
}

function validateThemeContrast(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		reject(label, "expected a finite number");
	}
	return Math.min(100, Math.max(0, Math.round(value)));
}

function validateAppearanceFontSize(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		reject(label, "expected a finite number");
	}
	return Math.min(MAX_APPEARANCE_FONT_SIZE, Math.max(MIN_APPEARANCE_FONT_SIZE, Math.round(value)));
}

function validateThemePalette(value: unknown, label: string): DesktopThemePalette {
	if (!isRecord(value)) {
		reject(label, "expected an object");
	}
	rejectUnsupportedKeys(
		value,
		[
			"accentColor",
			"backgroundColor",
			"foregroundColor",
			"uiFontFamily",
			"codeFontFamily",
			"translucentSidebar",
			"contrast",
		],
		label,
	);
	return {
		accentColor: validateHexColor(value.accentColor, `${label} accent color`),
		backgroundColor: validateHexColor(value.backgroundColor, `${label} background color`),
		foregroundColor: validateHexColor(value.foregroundColor, `${label} foreground color`),
		uiFontFamily: validateFontFamily(value.uiFontFamily, `${label} UI font family`),
		codeFontFamily: validateFontFamily(value.codeFontFamily, `${label} code font family`),
		translucentSidebar: validateBoolean(value.translucentSidebar, `${label} translucent sidebar`),
		contrast: validateThemeContrast(value.contrast, `${label} contrast`),
	};
}

function validateAppearanceSettings(value: unknown): DesktopAppearanceSettings {
	if (!isRecord(value)) {
		reject("appearance settings", "expected an object");
	}
	rejectUnsupportedKeys(
		value,
		["themeMode", "uiFontSize", "codeFontSize", "lightTheme", "darkTheme"],
		"appearance settings",
	);
	return {
		themeMode: validateThemeMode(value.themeMode, "appearance theme mode"),
		uiFontSize: validateAppearanceFontSize(value.uiFontSize, "appearance UI font size"),
		codeFontSize: validateAppearanceFontSize(value.codeFontSize, "appearance code font size"),
		lightTheme: validateThemePalette(value.lightTheme, "light theme"),
		darkTheme: validateThemePalette(value.darkTheme, "dark theme"),
	};
}

function validateAgentMode(value: unknown, label: string): DesktopAgentMode {
	if (typeof value !== "string" || !DESKTOP_AGENT_MODES.has(value as DesktopAgentMode)) {
		reject(label, "expected plan or execute");
	}
	return value as DesktopAgentMode;
}

function validatePermissionApprovalSettings(value: unknown): DesktopPermissionApprovalSettings {
	if (!isRecord(value)) {
		reject("permission approval settings", "expected an object");
	}

	for (const key of Object.keys(value)) {
		if (!(PERMISSION_APPROVAL_SETTING_KEYS as readonly string[]).includes(key)) {
			reject("permission approval settings", `unsupported key '${key}'`);
		}
	}

	return {
		bash: validateBoolean(value.bash, "permission approval settings bash"),
		fileMutation: validateBoolean(value.fileMutation, "permission approval settings fileMutation"),
		capabilityMutation: validateBoolean(value.capabilityMutation, "permission approval settings capabilityMutation"),
		mcpTool: validateBoolean(value.mcpTool, "permission approval settings mcpTool"),
		mcpServerLifecycle: validateBoolean(value.mcpServerLifecycle, "permission approval settings mcpServerLifecycle"),
		terminal: validateBoolean(value.terminal, "permission approval settings terminal"),
	};
}

function validateDesktopWindowState(value: unknown, label: string): DesktopWindowState {
	if (!isRecord(value)) {
		reject(label, "expected an object");
	}
	const width = validatePositiveInteger(value.width, `${label} width`, MAX_WINDOW_DIMENSION);
	const height = validatePositiveInteger(value.height, `${label} height`, MAX_WINDOW_DIMENSION);
	if (width < MIN_RESTORABLE_WINDOW_WIDTH || height < MIN_RESTORABLE_WINDOW_HEIGHT) {
		reject(label, "restored size is smaller than supported desktop window minimums");
	}
	return {
		height,
		...(validateOptionalBoolean(value.isFullScreen, `${label} fullscreen`) !== undefined
			? { isFullScreen: validateOptionalBoolean(value.isFullScreen, `${label} fullscreen`) }
			: {}),
		...(validateOptionalBoolean(value.isMaximized, `${label} maximized`) !== undefined
			? { isMaximized: validateOptionalBoolean(value.isMaximized, `${label} maximized`) }
			: {}),
		width,
		...(validateOptionalFiniteNumber(value.x, `${label} x`, MAX_WINDOW_COORDINATE) !== undefined
			? { x: validateOptionalFiniteNumber(value.x, `${label} x`, MAX_WINDOW_COORDINATE) }
			: {}),
		...(validateOptionalFiniteNumber(value.y, `${label} y`, MAX_WINDOW_COORDINATE) !== undefined
			? { y: validateOptionalFiniteNumber(value.y, `${label} y`, MAX_WINDOW_COORDINATE) }
			: {}),
	};
}

function validateDesktopWindowStates(
	value: unknown,
): Partial<Record<DesktopWindowKind, DesktopWindowState>> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		reject("window states", "expected an object");
	}
	const nextStates: Partial<Record<DesktopWindowKind, DesktopWindowState>> = {};
	for (const [kind, state] of Object.entries(value)) {
		if (!DESKTOP_WINDOW_KINDS.has(kind as DesktopWindowKind)) {
			reject("window states", `unsupported window kind '${kind}'`);
		}
		nextStates[kind as DesktopWindowKind] = validateDesktopWindowState(state, `window state ${kind}`);
	}
	return nextStates;
}

function validateTerminalDimension(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_TERMINAL_DIMENSION) {
		reject(label, `expected an integer between 1 and ${MAX_TERMINAL_DIMENSION}`);
	}
	return value;
}

export function validateSessionId(value: unknown): string {
	return validateIdentifier(value, "session id");
}

export function validateSessionMessagesRequest(value: unknown): DesktopSessionMessagesRequest {
	if (!isRecord(value)) {
		reject("session messages request", "expected an object");
	}
	return {
		sessionId: validateSessionId(value.sessionId),
		before: validateNonNegativeInteger(value.before, "session messages before", Number.MAX_SAFE_INTEGER),
		...(value.limit !== undefined
			? {
					limit: validatePositiveInteger(value.limit, "session messages limit", MAX_SESSION_MESSAGES_PAGE_LIMIT),
				}
			: {}),
	};
}

export function validateTerminalId(value: unknown): string {
	return validateIdentifier(value, "terminal id");
}

export function validateOptionalProjectId(value: unknown): string | undefined {
	return validateOptionalIdentifier(value, "project id");
}

export function validateProjectId(value: unknown): string {
	return validateIdentifier(value, "project id");
}

export function validateProviderId(value: unknown): string {
	return validateNonEmptyString(value, "provider", MAX_IDENTIFIER_LENGTH);
}

export function validateProviderKey(value: unknown): string {
	return validateNonEmptyString(value, "provider key", MAX_PROVIDER_KEY_LENGTH);
}

export function validateOAuthCode(value: unknown): string {
	return validateString(value, "oauth code", MAX_PROVIDER_KEY_LENGTH);
}

export function validateSettingsOpenRequest(value: unknown): DesktopSettingsOpenRequest | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		reject("settings open request", "expected an object");
	}
	const section =
		value.section === undefined
			? undefined
			: DESKTOP_SETTINGS_SECTIONS.has(value.section as DesktopSettingsSectionId)
				? (value.section as DesktopSettingsSectionId)
				: reject("settings open request section", "expected a valid settings section");
	const providerId = value.providerId === undefined ? undefined : validateProviderId(value.providerId);
	return {
		...(section ? { section } : {}),
		...(providerId ? { providerId } : {}),
	};
}

export function validatePromptRequest(value: unknown): DesktopPromptRequest {
	if (!isRecord(value)) {
		reject("prompt request", "expected an object");
	}
	const capabilityInvocations = validatePromptCapabilityInvocations(value.capabilityInvocations);
	const attachments = validatePreparedPromptAttachments(value.attachments);
	const text = validateString(value.text, "prompt text", MAX_PROMPT_LENGTH);
	const attachmentPromptLength = attachments.reduce((total, attachment) => total + attachment.promptText.length, 0);
	if (text.length + attachmentPromptLength > MAX_PROMPT_LENGTH) {
		reject("prompt text", `combined text and attachments must be ${MAX_PROMPT_LENGTH} characters or fewer`);
	}
	if (text.trim().length === 0 && capabilityInvocations.length === 0 && attachments.length === 0) {
		reject("prompt text", "must not be empty");
	}
	return {
		sessionId: validateSessionId(value.sessionId),
		text,
		...(capabilityInvocations.length > 0 ? { capabilityInvocations } : {}),
		...(attachments.length > 0 ? { attachments } : {}),
	};
}

export function validatePreparePromptAttachmentsRequest(value: unknown): DesktopPreparePromptAttachmentsRequest {
	if (!isRecord(value)) {
		reject("prepare prompt attachments request", "expected an object");
	}
	const candidates = validatePromptAttachmentCandidates(value.candidates);
	if (candidates.length === 0) {
		reject("prompt attachment candidates", "must not be empty");
	}
	return { candidates };
}

export function validateOpenPromptAttachmentsRequest(value: unknown): DesktopOpenPromptAttachmentsRequest {
	if (!isRecord(value)) {
		reject("open prompt attachments request", "expected an object");
	}
	return { sessionId: validateSessionId(value.sessionId) };
}

export function validateCompactRequest(value: unknown): DesktopCompactRequest {
	if (!isRecord(value)) {
		reject("compact request", "expected an object");
	}
	const customInstructions = validateOptionalNonEmptyString(
		value.customInstructions,
		"compact custom instructions",
		MAX_PROMPT_LENGTH,
	);
	return {
		sessionId: validateSessionId(value.sessionId),
		...(customInstructions ? { customInstructions } : {}),
	};
}

export function validateSessionModeUpdateRequest(value: unknown): DesktopSessionModeUpdateRequest {
	if (!isRecord(value)) {
		reject("session mode update", "expected an object");
	}
	return {
		sessionId: validateSessionId(value.sessionId),
		agentMode: validateAgentMode(value.agentMode, "agent mode"),
	};
}

export function validateExecutePlanRequest(value: unknown): DesktopExecutePlanRequest {
	if (!isRecord(value)) {
		reject("execute plan request", "expected an object");
	}
	return {
		sessionId: validateSessionId(value.sessionId),
	};
}

export function validateConsumeProposedPlanRequest(value: unknown): DesktopConsumeProposedPlanRequest {
	if (!isRecord(value)) {
		reject("consume proposed plan request", "expected an object");
	}
	return {
		sessionId: validateSessionId(value.sessionId),
		planMessageId: validateIdentifier(value.planMessageId, "plan message id"),
	};
}

function validatePromptCapabilityInvocations(value: unknown): DesktopPromptCapabilityInvocation[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		reject("prompt capability invocations", "expected an array");
	}
	if (value.length > MAX_CAPABILITY_INVOCATIONS) {
		reject("prompt capability invocations", `must include ${MAX_CAPABILITY_INVOCATIONS} entries or fewer`);
	}

	const invocations: DesktopPromptCapabilityInvocation[] = [];
	let promptTemplateCount = 0;
	const seen = new Set<string>();
	for (const [index, item] of value.entries()) {
		if (!isRecord(item)) {
			reject(`prompt capability invocation[${index}]`, "expected an object");
		}
		const type = item.type;
		if (type !== "skill" && type !== "prompt_template") {
			reject(`prompt capability invocation[${index}].type`, "expected skill or prompt_template");
		}
		if (type === "prompt_template") {
			promptTemplateCount += 1;
			if (promptTemplateCount > 1) {
				reject("prompt capability invocations", "must include at most one prompt template");
			}
		}
		const name = validateIdentifier(item.name, `prompt capability invocation[${index}].name`);
		const key = `${type}:${name}`;
		if (seen.has(key)) {
			reject("prompt capability invocations", `duplicate ${type} '${name}'`);
		}
		seen.add(key);
		const description = validateOptionalNonEmptyString(
			item.description,
			`prompt capability invocation[${index}].description`,
			MAX_PROMPT_LENGTH,
		);
		const sourcePath = validateOptionalNonEmptyString(
			item.sourcePath,
			`prompt capability invocation[${index}].sourcePath`,
			MAX_CWD_LENGTH,
		);
		invocations.push({
			type,
			name,
			...(description ? { description } : {}),
			...(sourcePath ? { sourcePath } : {}),
		});
	}
	return invocations;
}

function validatePreparedPromptAttachments(value: unknown): DesktopPreparedPromptAttachment[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		reject("prompt attachments", "expected an array");
	}
	if (value.length > MAX_PROMPT_ATTACHMENTS) {
		reject("prompt attachments", `must include ${MAX_PROMPT_ATTACHMENTS} entries or fewer`);
	}

	return value.map((item, index): DesktopPreparedPromptAttachment => {
		if (!isRecord(item)) {
			reject(`prompt attachment[${index}]`, "expected an object");
		}
		const kind = item.kind;
		if (kind !== "text" && kind !== "image") {
			reject(`prompt attachment[${index}].kind`, "expected text or image");
		}
		const path = validateOptionalNonEmptyString(item.path, `prompt attachment[${index}].path`, MAX_CWD_LENGTH);
		return {
			id: validateIdentifier(item.id, `prompt attachment[${index}].id`),
			kind,
			name: validateNonEmptyString(item.name, `prompt attachment[${index}].name`, MAX_CWD_LENGTH),
			...(path ? { path } : {}),
			mimeType: validateNonEmptyString(item.mimeType, `prompt attachment[${index}].mimeType`, MAX_IDENTIFIER_LENGTH),
			size: validateNonNegativeInteger(item.size, `prompt attachment[${index}].size`, MAX_ATTACHMENT_SIZE),
			promptText: validateString(item.promptText, `prompt attachment[${index}].promptText`, MAX_PROMPT_LENGTH),
			images: validatePromptAttachmentImages(item.images, `prompt attachment[${index}].images`),
		};
	});
}

function validatePromptAttachmentImages(value: unknown, label: string): DesktopPreparedPromptAttachment["images"] {
	if (!Array.isArray(value)) {
		reject(label, "expected an array");
	}
	return value.map((item, index) => {
		if (!isRecord(item)) {
			reject(`${label}[${index}]`, "expected an object");
		}
		if (item.type !== "image") {
			reject(`${label}[${index}].type`, "expected image");
		}
		return {
			type: "image",
			mimeType: validateNonEmptyString(item.mimeType, `${label}[${index}].mimeType`, MAX_IDENTIFIER_LENGTH),
			data: validateString(item.data, `${label}[${index}].data`, MAX_INLINE_IMAGE_DATA_LENGTH),
		};
	});
}

function validatePromptAttachmentCandidates(value: unknown): DesktopPromptAttachmentCandidate[] {
	if (!Array.isArray(value)) {
		reject("prompt attachment candidates", "expected an array");
	}
	if (value.length > MAX_PROMPT_ATTACHMENTS) {
		reject("prompt attachment candidates", `must include ${MAX_PROMPT_ATTACHMENTS} entries or fewer`);
	}
	return value.map((item, index): DesktopPromptAttachmentCandidate => {
		if (!isRecord(item)) {
			reject(`prompt attachment candidate[${index}]`, "expected an object");
		}
		if (item.type === "path") {
			return {
				type: "path",
				path: validateNonEmptyString(item.path, `prompt attachment candidate[${index}].path`, MAX_CWD_LENGTH),
			};
		}
		if (item.type === "inline_image") {
			return {
				type: "inline_image",
				name: validateNonEmptyString(item.name, `prompt attachment candidate[${index}].name`, MAX_CWD_LENGTH),
				mimeType: validateNonEmptyString(
					item.mimeType,
					`prompt attachment candidate[${index}].mimeType`,
					MAX_IDENTIFIER_LENGTH,
				),
				data: validateString(item.data, `prompt attachment candidate[${index}].data`, MAX_INLINE_IMAGE_DATA_LENGTH),
				...(item.size === undefined
					? {}
					: {
							size: validateNonNegativeInteger(
								item.size,
								`prompt attachment candidate[${index}].size`,
								MAX_ATTACHMENT_SIZE,
							),
						}),
			};
		}
		return reject(`prompt attachment candidate[${index}].type`, "expected path or inline_image");
	});
}

function validateEventStatus(value: unknown, label: string): DesktopEventStatus {
	if (typeof value !== "string" || !DESKTOP_EVENT_STATUSES.has(value as DesktopEventStatus)) {
		reject(label, "expected a supported event status");
	}
	return value as DesktopEventStatus;
}

function validateEventManagementStatus(value: unknown, label: string): Exclude<DesktopEventStatus, "running"> {
	if (
		typeof value !== "string" ||
		!DESKTOP_EVENT_MANAGEMENT_STATUSES.has(value as Exclude<DesktopEventStatus, "running">)
	) {
		reject(label, "expected inbox, ready, completed, or discarded");
	}
	return value as Exclude<DesktopEventStatus, "running">;
}

function validateOptionalEventManagementStatus(
	value: unknown,
	label: string,
): Exclude<DesktopEventStatus, "running"> | undefined {
	if (value === undefined) {
		return undefined;
	}
	return validateEventManagementStatus(value, label);
}

function validateEventPriority(value: unknown, label: string): DesktopEventPriority {
	if (typeof value !== "string" || !DESKTOP_EVENT_PRIORITIES.has(value as DesktopEventPriority)) {
		reject(label, "expected P0, P1, P2, or P3");
	}
	return value as DesktopEventPriority;
}

function validateOptionalEventPriority(value: unknown, label: string): DesktopEventPriority | undefined {
	if (value === undefined) {
		return undefined;
	}
	return validateEventPriority(value, label);
}

function validateOptionalEventPriorityOrNull(value: unknown, label: string): DesktopEventPriority | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === null) {
		return null;
	}
	return validateEventPriority(value, label);
}

function validateEventCommentAuthor(value: unknown, label: string): DesktopEventCommentAuthor {
	if (typeof value !== "string" || !DESKTOP_EVENT_COMMENT_AUTHORS.has(value as DesktopEventCommentAuthor)) {
		reject(label, "expected user or agent");
	}
	return value as DesktopEventCommentAuthor;
}

function validateEventAttachmentCandidates(value: unknown): DesktopEventAttachmentCandidate[] {
	if (!Array.isArray(value)) {
		reject("event attachment candidates", "expected an array");
	}
	if (value.length > MAX_EVENT_ATTACHMENTS) {
		reject("event attachment candidates", `must include ${MAX_EVENT_ATTACHMENTS} entries or fewer`);
	}
	return value.map((item, index): DesktopEventAttachmentCandidate => {
		if (!isRecord(item)) {
			reject(`event attachment candidate[${index}]`, "expected an object");
		}
		if (item.type !== "path") {
			reject(`event attachment candidate[${index}].type`, "expected path");
		}
		return {
			type: "path",
			path: validateNonEmptyString(item.path, `event attachment candidate[${index}].path`, MAX_CWD_LENGTH),
		};
	});
}

function validateEventAttachmentDrafts(value: unknown): DesktopEventAttachmentDraft[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		reject("event attachments", "expected an array");
	}
	if (value.length > MAX_EVENT_ATTACHMENTS) {
		reject("event attachments", `must include ${MAX_EVENT_ATTACHMENTS} entries or fewer`);
	}
	return value.map((item, index): DesktopEventAttachmentDraft => {
		if (!isRecord(item)) {
			reject(`event attachment[${index}]`, "expected an object");
		}
		const textSnapshot = validateOptionalNonEmptyString(
			item.textSnapshot,
			`event attachment[${index}].textSnapshot`,
			MAX_PROMPT_LENGTH,
		);
		const extractionError = validateOptionalNonEmptyString(
			item.extractionError,
			`event attachment[${index}].extractionError`,
			MAX_PROMPT_LENGTH,
		);
		return {
			id: validateIdentifier(item.id, `event attachment[${index}].id`),
			name: validateNonEmptyString(item.name, `event attachment[${index}].name`, MAX_CWD_LENGTH),
			sourcePath: validateNonEmptyString(item.sourcePath, `event attachment[${index}].sourcePath`, MAX_CWD_LENGTH),
			mimeType: validateNonEmptyString(item.mimeType, `event attachment[${index}].mimeType`, MAX_IDENTIFIER_LENGTH),
			size: validateNonNegativeInteger(item.size, `event attachment[${index}].size`, MAX_ATTACHMENT_SIZE),
			...(textSnapshot ? { textSnapshot } : {}),
			...(extractionError ? { extractionError } : {}),
		};
	});
}

function validateEventAttachmentIds(value: unknown): string[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		reject("event attachment ids", "expected an array");
	}
	if (value.length > MAX_EVENT_ATTACHMENTS) {
		reject("event attachment ids", `must include ${MAX_EVENT_ATTACHMENTS} entries or fewer`);
	}
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const [index, item] of value.entries()) {
		const id = validateIdentifier(item, `event attachment id[${index}]`);
		if (seen.has(id)) {
			reject("event attachment ids", `duplicate attachment id '${id}'`);
		}
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

export function validateEventListRequest(value: unknown): DesktopEventListRequest {
	if (value === undefined) {
		return {};
	}
	if (!isRecord(value)) {
		reject("event list request", "expected an object");
	}
	return {
		...(value.includeDiscarded === undefined
			? {}
			: { includeDiscarded: validateBoolean(value.includeDiscarded, "event list include discarded") }),
	};
}

export function validatePrepareEventAttachmentsRequest(value: unknown): DesktopPrepareEventAttachmentsRequest {
	if (!isRecord(value)) {
		reject("prepare event attachments request", "expected an object");
	}
	const candidates = validateEventAttachmentCandidates(value.candidates);
	if (candidates.length === 0) {
		reject("event attachment candidates", "must not be empty");
	}
	return { candidates };
}

export function validateOpenEventAttachmentsRequest(value: unknown): DesktopOpenEventAttachmentsRequest {
	if (value === undefined) {
		return {};
	}
	if (!isRecord(value)) {
		reject("open event attachments request", "expected an object");
	}
	const defaultPath = validateOptionalNonEmptyString(
		value.defaultPath,
		"open event attachments defaultPath",
		MAX_CWD_LENGTH,
	);
	return {
		...(defaultPath ? { defaultPath } : {}),
	};
}

export function validateEventCreateRequest(value: unknown): DesktopEventCreateRequest {
	if (!isRecord(value)) {
		reject("event create request", "expected an object");
	}
	const title = validateOptionalNonEmptyString(value.title, "event title", MAX_EVENT_TITLE_LENGTH);
	const body = validateOptionalNonEmptyString(value.body, "event body", MAX_PROMPT_LENGTH);
	const priority = validateOptionalEventPriority(value.priority, "event priority");
	const attachments = validateEventAttachmentDrafts(value.attachments);
	if (!title && !body && attachments.length === 0) {
		reject("event create request", "expected title, body, or attachments");
	}
	return {
		...(title ? { title } : {}),
		...(body ? { body } : {}),
		...(priority ? { priority } : {}),
		...(attachments.length > 0 ? { attachments } : {}),
	};
}

export function validateEventUpdateRequest(value: unknown): DesktopEventUpdateRequest {
	if (!isRecord(value)) {
		reject("event update request", "expected an object");
	}
	const title = validateOptionalNonEmptyString(value.title, "event title", MAX_EVENT_TITLE_LENGTH);
	const body = value.body === undefined ? undefined : validateString(value.body, "event body", MAX_PROMPT_LENGTH);
	const priority = validateOptionalEventPriorityOrNull(value.priority, "event priority");
	if (title === undefined && body === undefined && priority === undefined) {
		reject("event update request", "expected title, body, or priority");
	}
	return {
		eventId: validateIdentifier(value.eventId, "event id"),
		...(title ? { title } : {}),
		...(body === undefined ? {} : { body }),
		...(priority === undefined ? {} : { priority }),
	};
}

export function validateEventCommentCreateRequest(value: unknown): DesktopEventCommentCreateRequest {
	if (!isRecord(value)) {
		reject("event comment create request", "expected an object");
	}
	return {
		eventId: validateIdentifier(value.eventId, "event id"),
		author: validateEventCommentAuthor(value.author, "event comment author"),
		body: validateNonEmptyString(value.body, "event comment body", MAX_PROMPT_LENGTH),
	};
}

export function validateEventManagementCriteriaUpdateRequest(
	value: unknown,
): DesktopEventManagementCriteriaUpdateRequest {
	if (!isRecord(value)) {
		reject("event management criteria update request", "expected an object");
	}
	return {
		content: validateNonEmptyString(value.content, "event management criteria", MAX_PROMPT_LENGTH),
	};
}

export function validateEventManagementProposalRequest(value: unknown): DesktopEventManagementProposalRequest {
	if (value === undefined) {
		return {};
	}
	if (!isRecord(value)) {
		reject("event management proposal request", "expected an object");
	}
	const includeCompleted = validateOptionalBoolean(value.includeCompleted, "event management include completed");
	return {
		...(includeCompleted === undefined ? {} : { includeCompleted }),
	};
}

function validateEventManagementProposalItem(value: unknown, index: number): DesktopEventManagementProposalItem {
	if (!isRecord(value)) {
		reject(`event management proposal item[${index}]`, "expected an object");
	}
	const priority = validateOptionalEventPriority(value.priority, `event management proposal item[${index}].priority`);
	const status = validateOptionalEventManagementStatus(
		value.status,
		`event management proposal item[${index}].status`,
	);
	return {
		id: validateIdentifier(value.id, `event management proposal item[${index}].id`),
		eventId: validateIdentifier(value.eventId, `event management proposal item[${index}].eventId`),
		...(priority ? { priority } : {}),
		...(status ? { status } : {}),
		reason: validateNonEmptyString(
			value.reason,
			`event management proposal item[${index}].reason`,
			MAX_PROMPT_LENGTH,
		),
		commentBody: validateNonEmptyString(
			value.commentBody,
			`event management proposal item[${index}].commentBody`,
			MAX_PROMPT_LENGTH,
		),
	};
}

function validateEventManagementProposalItems(value: unknown): DesktopEventManagementProposalItem[] {
	if (!Array.isArray(value)) {
		reject("event management proposal items", "expected an array");
	}
	if (value.length === 0) {
		reject("event management proposal items", "must not be empty");
	}
	if (value.length > MAX_EVENT_MANAGEMENT_ITEMS) {
		reject("event management proposal items", `must include ${MAX_EVENT_MANAGEMENT_ITEMS} entries or fewer`);
	}
	const seen = new Set<string>();
	return value.map((item, index) => {
		const proposalItem = validateEventManagementProposalItem(item, index);
		if (seen.has(proposalItem.id)) {
			reject("event management proposal items", `duplicate item id '${proposalItem.id}'`);
		}
		seen.add(proposalItem.id);
		return proposalItem;
	});
}

function validateSelectedEventManagementItemIds(value: unknown, validItemIds: ReadonlySet<string>): string[] {
	if (!Array.isArray(value)) {
		reject("selected event management proposal item ids", "expected an array");
	}
	if (value.length === 0) {
		reject("selected event management proposal item ids", "must not be empty");
	}
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const [index, item] of value.entries()) {
		const id = validateIdentifier(item, `selected event management proposal item id[${index}]`);
		if (seen.has(id)) {
			reject("selected event management proposal item ids", `duplicate item id '${id}'`);
		}
		if (!validItemIds.has(id)) {
			reject("selected event management proposal item ids", `unknown item id '${id}'`);
		}
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

export function validateEventManagementApplyRequest(value: unknown): DesktopEventManagementApplyRequest {
	if (!isRecord(value)) {
		reject("event management apply request", "expected an object");
	}
	const items = validateEventManagementProposalItems(value.items);
	return {
		proposalId: validateIdentifier(value.proposalId, "event management proposal id"),
		selectedItemIds: validateSelectedEventManagementItemIds(
			value.selectedItemIds,
			new Set(items.map((item) => item.id)),
		),
		items,
	};
}

export function validateEventStatusUpdateRequest(value: unknown): DesktopEventStatusUpdateRequest {
	if (!isRecord(value)) {
		reject("event status update request", "expected an object");
	}
	return {
		eventId: validateIdentifier(value.eventId, "event id"),
		status: validateEventStatus(value.status, "event status"),
	};
}

export function validateEventDeleteRequest(value: unknown): DesktopEventDeleteRequest {
	if (!isRecord(value)) {
		reject("event delete request", "expected an object");
	}
	return {
		eventId: validateIdentifier(value.eventId, "event id"),
	};
}

export function validateEventRunRequest(value: unknown): DesktopEventRunRequest {
	if (!isRecord(value)) {
		reject("event run request", "expected an object");
	}
	const promptText = validateString(value.promptText, "event run prompt", MAX_PROMPT_LENGTH);
	const attachmentIds = validateEventAttachmentIds(value.attachmentIds);
	if (promptText.trim().length === 0 && attachmentIds.length === 0) {
		reject("event run request", "expected prompt text or attachments");
	}
	return {
		eventId: validateIdentifier(value.eventId, "event id"),
		projectId: validateProjectId(value.projectId),
		promptText,
		...(attachmentIds.length > 0 ? { attachmentIds } : {}),
	};
}

function validateCapabilityScope(value: unknown): "project" | "global" | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value !== "project" && value !== "global") {
		reject("capability scope", "expected project or global");
	}
	return value;
}

function validateStringArray(value: unknown, label: string): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		reject(label, "expected an array");
	}
	return value.map((item, index) => validateString(item, `${label}[${index}]`, MAX_PROMPT_LENGTH));
}

function validateStringRecord(value: unknown, label: string): Record<string, string> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		reject(label, "expected an object");
	}
	const next: Record<string, string> = {};
	for (const [key, recordValue] of Object.entries(value)) {
		next[validateNonEmptyString(key, `${label} key`, MAX_IDENTIFIER_LENGTH)] = validateString(
			recordValue,
			`${label}.${key}`,
			MAX_PROMPT_LENGTH,
		);
	}
	return next;
}

export function validateCreateSkillRequest(value: unknown): DesktopCreateSkillRequest {
	if (!isRecord(value)) {
		reject("skill request", "expected an object");
	}
	return {
		name: validateIdentifier(value.name, "skill name"),
		description: validateNonEmptyString(value.description, "skill description", MAX_PROMPT_LENGTH),
		content: validateString(value.content, "skill content", MAX_RESOURCE_BODY_LENGTH),
		scope: validateCapabilityScope(value.scope),
		overwrite: validateOptionalBoolean(value.overwrite, "skill overwrite"),
	};
}

export function validateCapabilityDetailRequest(value: unknown): DesktopCapabilityDetailRequest {
	if (!isRecord(value)) {
		reject("capability detail request", "expected an object");
	}
	if (value.type !== "skill" && value.type !== "prompt_template") {
		reject("capability detail type", "expected skill or prompt_template");
	}
	return {
		type: value.type,
		filePath: validateNonEmptyString(value.filePath, "capability detail path", MAX_CWD_LENGTH),
	};
}

export function validatePromptTemplateUpsertRequest(value: unknown): DesktopPromptTemplateUpsertRequest {
	if (!isRecord(value)) {
		reject("prompt template request", "expected an object");
	}
	return {
		name: validateIdentifier(value.name, "prompt template name"),
		description: validateNonEmptyString(value.description, "prompt template description", MAX_PROMPT_LENGTH),
		content: validateString(value.content, "prompt template content", MAX_RESOURCE_BODY_LENGTH),
		argumentHint: validateOptionalNonEmptyString(
			value.argumentHint,
			"prompt template argument hint",
			MAX_PROMPT_LENGTH,
		),
		scope: validateCapabilityScope(value.scope),
		overwrite: validateOptionalBoolean(value.overwrite, "prompt template overwrite"),
	};
}

export function validatePromptTemplateDeleteRequest(value: unknown): DesktopPromptTemplateDeleteRequest {
	if (!isRecord(value)) {
		reject("prompt template delete request", "expected an object");
	}
	return {
		filePath: validateNonEmptyString(value.filePath, "prompt template path", MAX_CWD_LENGTH),
	};
}

export function validateMcpServerUpsertRequest(value: unknown): DesktopMcpServerUpsertRequest {
	if (!isRecord(value)) {
		reject("MCP server request", "expected an object");
	}
	return {
		id: validateOptionalIdentifier(value.id, "MCP server id"),
		name: validateNonEmptyString(value.name, "MCP server name", MAX_IDENTIFIER_LENGTH),
		command: validateNonEmptyString(value.command, "MCP server command", MAX_CWD_LENGTH),
		args: validateStringArray(value.args, "MCP server args"),
		env: validateStringRecord(value.env, "MCP server env"),
		cwd: validateOptionalNonEmptyString(value.cwd, "MCP server cwd", MAX_CWD_LENGTH),
		enabled: validateOptionalBoolean(value.enabled, "MCP server enabled"),
		connectNow: validateOptionalBoolean(value.connectNow, "MCP server connectNow"),
	};
}

export function validateSessionProfileUpdateRequest(value: unknown): DesktopSessionProfileUpdateRequest {
	if (!isRecord(value)) {
		reject("session profile update", "expected an object");
	}
	return {
		modelId: validateOptionalIdentifier(value.modelId, "model id"),
		provider: validateOptionalIdentifier(value.provider, "provider"),
		sessionId: validateSessionId(value.sessionId),
		thinkingLevel: validateOptionalThinkingLevel(value.thinkingLevel, "thinking level"),
	};
}

export function validateReviewSnapshotRequest(value: unknown): DesktopReviewSnapshotRequest {
	if (!isRecord(value)) {
		reject("review snapshot request", "expected an object");
	}
	const projectId = validateOptionalIdentifier(value.projectId, "review project id");
	const sessionId = validateOptionalIdentifier(value.sessionId, "review session id");
	if (!projectId && !sessionId) {
		reject("review snapshot request", "expected a project id or session id");
	}
	return {
		projectId,
		sessionId,
	};
}

export function validateReviewFilePatchRequest(value: unknown): DesktopReviewFilePatchRequest {
	if (!isRecord(value)) {
		reject("review file patch request", "expected an object");
	}
	const reviewRequest = validateReviewSnapshotRequest(value);
	return {
		...reviewRequest,
		path: validateNonEmptyString(value.path, "review file patch path", MAX_CWD_LENGTH),
	};
}

export function validatePreviewFileRequest(value: unknown): DesktopPreviewFileRequest {
	if (!isRecord(value)) {
		reject("preview file request", "expected an object");
	}
	return {
		path: validateNonEmptyString(value.path, "preview file path", MAX_CWD_LENGTH),
	};
}

export function validateExternalUrl(value: unknown): string {
	const text = validateNonEmptyString(value, "external URL", MAX_CWD_LENGTH);
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		reject("external URL", "expected an absolute URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "mailto:") {
		reject("external URL", "expected http, https, or mailto");
	}
	return url.toString();
}

export function validateWorkspacePreviewFileRequest(value: unknown): DesktopWorkspacePreviewFileRequest {
	if (!isRecord(value)) {
		reject("workspace preview file request", "expected an object");
	}
	const projectId = validateOptionalIdentifier(value.projectId, "workspace preview project id");
	const sessionId = validateOptionalIdentifier(value.sessionId, "workspace preview session id");
	if (!projectId && !sessionId) {
		reject("workspace preview file request", "expected a project id or session id");
	}
	return {
		path: validateNonEmptyString(value.path, "workspace preview file path", MAX_CWD_LENGTH),
		projectId,
		sessionId,
	};
}

export function validateWorkspaceFileListRequest(value: unknown): DesktopWorkspaceFileListRequest {
	if (!isRecord(value)) {
		reject("workspace file list request", "expected an object");
	}
	const projectId = validateOptionalIdentifier(value.projectId, "workspace file list project id");
	const sessionId = validateOptionalIdentifier(value.sessionId, "workspace file list session id");
	if (!projectId && !sessionId) {
		reject("workspace file list request", "expected a project id or session id");
	}
	return {
		projectId,
		sessionId,
		limit:
			value.limit === undefined
				? undefined
				: validatePositiveInteger(value.limit, "workspace file list limit", MAX_WORKSPACE_FILE_LIST_LIMIT),
	};
}

export function validateSettingInput(key: unknown, value: unknown): ValidatedDesktopSetting {
	switch (key) {
		case "appearance":
			return { key, value: validateAppearanceSettings(value) };
		case "defaultProvider":
			return { key, value: validateOptionalIdentifier(value, key) };
		case "defaultModel":
			return { key, value: validateOptionalIdentifier(value, key) };
		case "defaultThinkingLevel":
			return {
				key,
				value: value === undefined ? undefined : validateThinkingLevel(value, key),
			};
		case "showThinkingBlocks":
			if (value !== undefined && typeof value !== "boolean") {
				reject(key, "expected a boolean");
			}
			return { key, value };
		case "compactInstruction":
			return { key, value: validateOptionalNonEmptyString(value, "compact instruction", MAX_PROMPT_LENGTH) };
		case "globalAgentsInstruction": {
			const instruction = validateOptionalNonEmptyString(value, "global AGENTS.md instruction", MAX_PROMPT_LENGTH);
			return { key, value: instruction?.trim() };
		}
		case "permissionApprovals":
			return { key, value: validatePermissionApprovalSettings(value) };
		case "lastOpenedProjectId":
			return { key, value: validateOptionalIdentifier(value, key) };
		case "lastOpenedSessionId":
			return { key, value: validateOptionalIdentifier(value, key) };
		case "windowStates":
			return { key, value: validateDesktopWindowStates(value) };
		default:
			reject("setting key", "not supported");
	}
}

export function validateApprovalDecision(value: unknown): DesktopApprovalDecision {
	if (!isRecord(value)) {
		reject("approval decision", "expected an object");
	}
	return {
		requestId: validateIdentifier(value.requestId, "approval request id"),
		approved: validateBoolean(value.approved, "approval approved"),
		reason: validateOptionalNonEmptyString(value.reason, "approval reason", MAX_PROMPT_LENGTH),
	};
}

export function validateWorkspaceRuntimeId(value: unknown): string {
	return validateIdentifier(value, "workspace runtime id");
}

export function validateWorkspaceRuntimeCreateDebugRequest(value: unknown): DesktopWorkspaceRuntimeCreateDebugRequest {
	if (!isRecord(value)) {
		reject("debug workspace request", "expected an object");
	}
	const projectId = validateOptionalIdentifier(value.projectId, "debug workspace project id");
	const repoPath = validateOptionalNonEmptyString(value.repoPath, "debug workspace repo path", MAX_CWD_LENGTH);
	if (!projectId && !repoPath) {
		reject("debug workspace request", "expected a project id or repo path");
	}
	const taskTitle = validateOptionalNonEmptyString(
		value.taskTitle,
		"debug workspace task title",
		MAX_IDENTIFIER_LENGTH,
	);
	const issue = validateOptionalNonEmptyString(value.issue, "debug workspace issue", MAX_PROMPT_LENGTH);
	return {
		...(projectId ? { projectId } : {}),
		...(repoPath ? { repoPath } : {}),
		...(taskTitle ? { taskTitle } : {}),
		...(issue ? { issue } : {}),
	};
}

function validateWorkspacePaneRole(
	value: unknown,
	label: string,
): NonNullable<DesktopWorkspaceRuntimeCaptureRequest["roles"]>[number] {
	const role = validateNonEmptyString(value, label, MAX_IDENTIFIER_LENGTH);
	if (!DESKTOP_WORKSPACE_PANE_ROLES.has(role)) {
		reject(label, "expected a supported workspace pane role");
	}
	return role as NonNullable<DesktopWorkspaceRuntimeCaptureRequest["roles"]>[number];
}

export function validateWorkspaceRuntimeCaptureRequest(value: unknown): DesktopWorkspaceRuntimeCaptureRequest {
	if (!isRecord(value)) {
		reject("workspace runtime capture request", "expected an object");
	}
	const roles = Array.isArray(value.roles)
		? value.roles.map((role, index) => validateWorkspacePaneRole(role, `workspace runtime role ${index + 1}`))
		: undefined;
	return {
		workspaceId: validateWorkspaceRuntimeId(value.workspaceId),
		...(roles ? { roles } : {}),
		...(value.linesPerPane === undefined
			? {}
			: { linesPerPane: validatePositiveInteger(value.linesPerPane, "workspace runtime lines per pane", 5000) }),
		reason: validateOptionalNonEmptyString(value.reason, "workspace runtime capture reason", MAX_PROMPT_LENGTH),
	};
}

export function validateWorkspaceRuntimePaneControlRequest(value: unknown): DesktopWorkspaceRuntimePaneControlRequest {
	if (!isRecord(value)) {
		reject("workspace runtime pane control request", "expected an object");
	}
	return {
		workspaceId: validateWorkspaceRuntimeId(value.workspaceId),
		role: validateWorkspacePaneRole(value.role, "workspace runtime pane role"),
	};
}

export function validateWorkspaceRuntimePaneTextRequest(value: unknown): DesktopWorkspaceRuntimePaneTextRequest {
	if (!isRecord(value)) {
		reject("workspace runtime pane text request", "expected an object");
	}
	return {
		workspaceId: validateWorkspaceRuntimeId(value.workspaceId),
		role: validateWorkspacePaneRole(value.role, "workspace runtime pane role"),
		text: validateNonEmptyString(value.text, "workspace runtime pane text", MAX_TERMINAL_WRITE_LENGTH),
		...(value.pressEnter === undefined
			? {}
			: { pressEnter: validateBoolean(value.pressEnter, "workspace runtime pane pressEnter") }),
	};
}

export function validateTerminalCreateRequest(value: unknown): DesktopTerminalCreateRequest {
	if (!isRecord(value)) {
		reject("terminal create request", "expected an object");
	}
	return {
		cols: validateTerminalDimension(value.cols, "terminal cols"),
		rows: validateTerminalDimension(value.rows, "terminal rows"),
		sessionId: validateSessionId(value.sessionId),
		source: validateTerminalSource(value.source),
		terminalId: validateTerminalId(value.terminalId),
	};
}

function validateTerminalSource(value: unknown): DesktopTerminalSource {
	if (!isRecord(value)) {
		reject("terminal source", "expected an object");
	}
	if (value.type === "shell") {
		return {
			type: "shell",
			cwd: validateNonEmptyString(value.cwd, "terminal cwd", MAX_CWD_LENGTH),
		};
	}
	if (value.type === "environment_resource") {
		if (value.readOnly !== true) {
			reject("terminal environment resource source", "readOnly must be true");
		}
		return {
			type: "environment_resource",
			resourceId: validateIdentifier(value.resourceId, "environment resource id"),
			readOnly: true,
		};
	}
	reject("terminal source type", "not supported");
}

export function validateEnvironmentResourceListRequest(value: unknown): DesktopEnvironmentResourceListRequest {
	if (value === undefined) {
		return {};
	}
	if (!isRecord(value)) {
		reject("environment resource list request", "expected an object");
	}
	return {
		sessionId: validateOptionalIdentifier(value.sessionId, "environment resource session id"),
	};
}

export function validateEnvironmentResourceDetachRequest(value: unknown): DesktopEnvironmentResourceDetachRequest {
	if (!isRecord(value)) {
		reject("environment resource detach request", "expected an object");
	}
	return {
		resourceId: validateIdentifier(value.resourceId, "environment resource id"),
	};
}

export function validateSubagentSnapshotRequest(value: unknown): DesktopSubagentSnapshotRequest {
	if (!isRecord(value)) {
		reject("subagent snapshot request", "expected an object");
	}
	return {
		parentSessionId: validateIdentifier(value.parentSessionId, "subagent parent session id"),
		subagentId: validateIdentifier(value.subagentId, "subagent id"),
	};
}

export function validateTerminalWriteRequest(value: unknown): DesktopTerminalWriteRequest {
	if (!isRecord(value)) {
		reject("terminal write request", "expected an object");
	}
	return {
		data: validateString(value.data, "terminal data", MAX_TERMINAL_WRITE_LENGTH),
		terminalId: validateTerminalId(value.terminalId),
	};
}

export function validateTerminalResizeRequest(value: unknown): DesktopTerminalResizeRequest {
	if (!isRecord(value)) {
		reject("terminal resize request", "expected an object");
	}
	return {
		cols: validateTerminalDimension(value.cols, "terminal cols"),
		rows: validateTerminalDimension(value.rows, "terminal rows"),
		terminalId: validateTerminalId(value.terminalId),
	};
}

export function validateTerminalDisposeRequest(value: unknown): DesktopTerminalDisposeRequest {
	if (!isRecord(value)) {
		reject("terminal dispose request", "expected an object");
	}
	return {
		terminalId: validateTerminalId(value.terminalId),
	};
}

function validateWebPreviewBounds(value: unknown): DesktopWebPreviewBounds {
	if (!isRecord(value)) {
		reject("web preview bounds", "expected an object");
	}
	return {
		height: validateNonNegativeInteger(value.height, "web preview height", MAX_WINDOW_DIMENSION),
		width: validateNonNegativeInteger(value.width, "web preview width", MAX_WINDOW_DIMENSION),
		x: validateNonNegativeInteger(value.x, "web preview x", MAX_WINDOW_COORDINATE),
		y: validateNonNegativeInteger(value.y, "web preview y", MAX_WINDOW_COORDINATE),
	};
}

function validateWebPreviewUrl(value: unknown): string {
	const url = normalizeDesktopWebPreviewUrl(validateNonEmptyString(value, "web preview URL", MAX_URL_LENGTH));
	if (!url) {
		reject("web preview URL", "expected an http or https URL");
	}
	return url;
}

function validateWebPreviewControlAction(value: unknown): DesktopWebPreviewControlAction {
	if (typeof value !== "string" || !DESKTOP_WEB_PREVIEW_CONTROL_ACTIONS.has(value as DesktopWebPreviewControlAction)) {
		reject("web preview control action", "expected a supported action");
	}
	return value as DesktopWebPreviewControlAction;
}

export function validateWebPreviewShowRequest(value: unknown): DesktopWebPreviewShowRequest {
	if (!isRecord(value)) {
		reject("web preview show request", "expected an object");
	}
	return {
		bounds: validateWebPreviewBounds(value.bounds),
		id: validateIdentifier(value.id, "web preview id"),
		occluded: validateOptionalBoolean(value.occluded, "web preview occluded"),
		url: validateWebPreviewUrl(value.url),
	};
}

export function validateWebPreviewBoundsRequest(value: unknown): DesktopWebPreviewBoundsRequest {
	if (!isRecord(value)) {
		reject("web preview bounds request", "expected an object");
	}
	return {
		bounds: validateWebPreviewBounds(value.bounds),
		id: validateIdentifier(value.id, "web preview id"),
		occluded: validateOptionalBoolean(value.occluded, "web preview occluded"),
	};
}

export function validateWebPreviewControlRequest(value: unknown): DesktopWebPreviewControlRequest {
	if (!isRecord(value)) {
		reject("web preview control request", "expected an object");
	}
	return {
		action: validateWebPreviewControlAction(value.action),
		id: validateIdentifier(value.id, "web preview id"),
	};
}

export function validateWebPreviewCloseRequest(value: unknown): DesktopWebPreviewCloseRequest {
	if (!isRecord(value)) {
		reject("web preview close request", "expected an object");
	}
	return {
		id: validateIdentifier(value.id, "web preview id"),
	};
}

export function validateWebPreviewStorageRequest(value: unknown): DesktopWebPreviewStorageRequest {
	if (!isRecord(value)) {
		reject("web preview storage request", "expected an object");
	}
	if (
		typeof value.storage !== "string" ||
		!DESKTOP_WEB_PREVIEW_STORAGE_KINDS.has(value.storage as DesktopWebPreviewStorageKind)
	) {
		reject("web preview storage kind", "expected cache or cookies");
	}
	return {
		id: validateIdentifier(value.id, "web preview id"),
		storage: value.storage as DesktopWebPreviewStorageKind,
	};
}

export function validateWebPreviewSelectionModeRequest(value: unknown): DesktopWebPreviewSelectionModeRequest {
	if (!isRecord(value)) {
		reject("web preview selection mode request", "expected an object");
	}
	if (typeof value.enabled !== "boolean") {
		reject("web preview selection mode enabled", "expected a boolean");
	}
	return {
		enabled: value.enabled,
		id: validateIdentifier(value.id, "web preview id"),
	};
}
