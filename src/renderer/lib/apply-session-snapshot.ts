import type { DesktopAgentSnapshot } from "../../shared/serialized-agent-event.ts";

export interface SessionSnapshotAppliers {
	hydrateSnapshot: (snapshot: DesktopAgentSnapshot) => void;
	applyProfileSnapshot: (snapshot: DesktopAgentSnapshot) => void;
	applyProjectProfileSnapshot: (snapshot: DesktopAgentSnapshot) => void;
}

export function applySessionSnapshot(snapshot: DesktopAgentSnapshot, appliers: SessionSnapshotAppliers): void {
	appliers.hydrateSnapshot(snapshot);
	appliers.applyProfileSnapshot(snapshot);
	appliers.applyProjectProfileSnapshot(snapshot);
}
