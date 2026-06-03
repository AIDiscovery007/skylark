import { randomUUID } from "node:crypto";
import type { DesktopMcpServerUpsertRequest } from "../../shared/types.ts";
import { JsonFileStore } from "../storage/json-file-store.ts";

export interface DesktopMcpServerConfig {
	id: string;
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
	cwd?: string;
	enabled: boolean;
	updatedAt: string;
}

type DesktopMcpServerIndex = Record<string, DesktopMcpServerConfig>;

function normalizeString(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`${label} is required.`);
	}
	return normalized;
}

function normalizeEnv(env: Record<string, string> | undefined): Record<string, string> {
	if (!env) {
		return {};
	}

	const next: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		const normalizedKey = key.trim();
		if (!normalizedKey) {
			continue;
		}
		next[normalizedKey] = value;
	}
	return next;
}

function normalizeArgs(args: string[] | undefined): string[] {
	return (args ?? []).map((arg) => String(arg));
}

function normalizeServerInput(
	request: DesktopMcpServerUpsertRequest,
	existing?: DesktopMcpServerConfig,
): DesktopMcpServerConfig {
	const now = new Date().toISOString();
	return {
		id: request.id?.trim() || existing?.id || randomUUID(),
		name: normalizeString(request.name, "MCP server name"),
		command: normalizeString(request.command, "MCP command"),
		args: normalizeArgs(request.args),
		env: normalizeEnv(request.env),
		cwd: request.cwd?.trim() || undefined,
		enabled: request.enabled ?? (request.connectNow === true ? true : (existing?.enabled ?? false)),
		updatedAt: now,
	};
}

export class DesktopMcpStore {
	private readonly store: JsonFileStore<DesktopMcpServerIndex>;

	constructor(filePath: string) {
		this.store = new JsonFileStore(filePath, {});
	}

	async list(): Promise<DesktopMcpServerConfig[]> {
		const index = await this.store.read();
		return Object.values(index).sort((left, right) => left.name.localeCompare(right.name));
	}

	async get(serverId: string): Promise<DesktopMcpServerConfig | undefined> {
		const index = await this.store.read();
		return index[serverId];
	}

	async upsert(request: DesktopMcpServerUpsertRequest): Promise<DesktopMcpServerConfig> {
		const index = await this.store.read();
		const existing = request.id ? index[request.id] : undefined;
		const next = normalizeServerInput(request, existing);
		await this.store.write({
			...index,
			[next.id]: next,
		});
		return next;
	}

	async setEnabled(serverId: string, enabled: boolean): Promise<DesktopMcpServerConfig> {
		const index = await this.store.read();
		const existing = index[serverId];
		if (!existing) {
			throw new Error(`MCP server not found: ${serverId}`);
		}
		const next: DesktopMcpServerConfig = {
			...existing,
			enabled,
			updatedAt: new Date().toISOString(),
		};
		await this.store.write({
			...index,
			[serverId]: next,
		});
		return next;
	}
}
