import { statSync } from "node:fs";
import { resolve } from "node:path";

export type ClassifiedPath =
	| { readonly kind: "none" }
	| { readonly kind: "directory"; readonly path: string }
	| { readonly kind: "file"; readonly path: string }
	| { readonly kind: "missing"; readonly path: string }
	| { readonly kind: "denied"; readonly path: string }
	| { readonly kind: "unsupported"; readonly path: string };

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

/**
 * Classifies a single CLI path argument before any Lector I/O -- the boundary this slice's own
 * unit matrix targets. `undefined` (no argument given) is its own real outcome, not an error:
 * Alignment still boots its empty shell exactly as Slice 0 did. Every other outcome is resolved
 * to an absolute path so a workspace/file identity never depends on the process's own cwd later.
 */
export function classifyPath(rawArgument: string | undefined, cwd: string = process.cwd()): ClassifiedPath {
	if (rawArgument === undefined) return { kind: "none" };
	const path = resolve(cwd, rawArgument);
	try {
		const stats = statSync(path);
		if (stats.isDirectory()) return { kind: "directory", path };
		if (stats.isFile()) return { kind: "file", path };
		return { kind: "unsupported", path };
	} catch (error) {
		if (isErrnoException(error) && error.code === "ENOENT") return { kind: "missing", path };
		if (isErrnoException(error) && (error.code === "EACCES" || error.code === "EPERM")) return { kind: "denied", path };
		throw error;
	}
}
