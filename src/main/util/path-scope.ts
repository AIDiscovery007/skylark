import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export function isPathInside(parent: string, child: string): boolean {
	const relativePath = relative(resolve(parent), resolve(child));
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export async function containRealPath(rootDir: string, target: string): Promise<string | null> {
	const realRootDir = await realpath(rootDir);
	const realTarget = await realpath(target);
	return isPathInside(realRootDir, realTarget) ? realTarget : null;
}
