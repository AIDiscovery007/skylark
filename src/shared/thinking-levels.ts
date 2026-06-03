import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export const DESKTOP_THINKING_LEVEL_OPTIONS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const satisfies readonly ThinkingLevel[];

const DESKTOP_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const satisfies readonly ThinkingLevel[];

interface DesktopReasoningModel {
	id: string;
	reasoning: boolean;
}

function supportsXhighThinking(modelId: string): boolean {
	return (
		modelId.includes("gpt-5.2") ||
		modelId.includes("gpt-5.3") ||
		modelId.includes("gpt-5.4") ||
		modelId.includes("gpt-5.5") ||
		modelId.includes("opus-4-6") ||
		modelId.includes("opus-4.6") ||
		modelId.includes("opus-4-7") ||
		modelId.includes("opus-4.7")
	);
}

export function getDesktopThinkingLevelsForModel(model: DesktopReasoningModel | undefined): ThinkingLevel[] {
	if (!model?.reasoning) {
		return ["off"];
	}

	return supportsXhighThinking(model.id) ? [...DESKTOP_THINKING_LEVEL_OPTIONS] : [...DESKTOP_THINKING_LEVELS];
}

export function clampDesktopThinkingLevelForModel(
	level: ThinkingLevel,
	model: DesktopReasoningModel | undefined,
): ThinkingLevel {
	const availableLevels = getDesktopThinkingLevelsForModel(model);
	if (availableLevels.includes(level)) {
		return level;
	}

	const requestedIndex = DESKTOP_THINKING_LEVEL_OPTIONS.indexOf(level);
	if (requestedIndex === -1) {
		return availableLevels[0] ?? "off";
	}

	for (let index = requestedIndex; index < DESKTOP_THINKING_LEVEL_OPTIONS.length; index += 1) {
		const candidate = DESKTOP_THINKING_LEVEL_OPTIONS[index];
		if (availableLevels.includes(candidate)) {
			return candidate;
		}
	}

	for (let index = requestedIndex - 1; index >= 0; index -= 1) {
		const candidate = DESKTOP_THINKING_LEVEL_OPTIONS[index];
		if (availableLevels.includes(candidate)) {
			return candidate;
		}
	}

	return availableLevels[0] ?? "off";
}
