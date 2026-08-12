import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";

/**
 * The nearest ancestor of `startDirectory` (inclusive) containing a `.git` entry, or undefined
 * if none exists -- a bare file opened outside any repository is a real, expected case, not an
 * error. The bare filesystem root is never treated as a discovered root even if it happens to
 * contain a stray `.git` marker.
 */
export function nearestGitRoot(startDirectory: string, exists: (path: string) => boolean = existsSync): string | undefined {
	let dir = startDirectory;
	const fsRoot = parse(dir).root;
	while (dir !== fsRoot) {
		if (exists(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break; // defensive: dirname must be strictly ascending
		dir = parent;
	}
	return undefined;
}
