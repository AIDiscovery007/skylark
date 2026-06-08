import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isMissingFileError } from "./fs-errors.ts";

export class JsonFileStore<TData> {
	constructor(
		private readonly filePath: string,
		private readonly defaultValue: TData,
	) {}

	private async ensureParentDirectory(): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
	}

	async read(): Promise<TData> {
		try {
			const content = await readFile(this.filePath, "utf8");
			return JSON.parse(content) as TData;
		} catch (error) {
			if (isMissingFileError(error)) {
				return structuredClone(this.defaultValue);
			}

			throw error;
		}
	}

	async write(data: TData): Promise<void> {
		await this.ensureParentDirectory();
		const tempFilePath = `${this.filePath}.${randomUUID()}.tmp`;
		await writeFile(tempFilePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
		await rename(tempFilePath, this.filePath);
	}

	async update(updater: (current: TData) => TData): Promise<TData> {
		const current = await this.read();
		const next = updater(current);
		await this.write(next);
		return next;
	}
}
