import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { World } from "@zodiac/protocol";
import type { WorldSnapshotPort } from "./snapshot-port.js";

export interface JsonFileSnapshotPortOptions {
	/** Where the World snapshot is persisted -- typically under the daemon's own XDG state dir. */
	readonly filePath: string;
}

function isMissingFile(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * The first real WorldSnapshotPort adapter: a single JSON file on disk.
 * `save()` writes atomically (temp file in the same directory, then
 * rename -- the same pattern Alef's own daemon-credential.ts uses) so a
 * process killed mid-write never leaves a half-written, corrupt snapshot
 * in place of the last good one. `load()` resolves undefined when no
 * snapshot exists yet (a fresh daemon, not an error) but rejects on a
 * snapshot that exists and fails to parse -- silently discarding a
 * corrupted snapshot would be a real data-loss bug, not a graceful
 * fallback. SQLite is the documented future upgrade (see
 * world/snapshot-port.ts's own doc comment); this is deliberately the
 * smallest thing that actually survives a daemon restart.
 */
export function createJsonFileSnapshotPort(options: JsonFileSnapshotPortOptions): WorldSnapshotPort {
	const { filePath } = options;

	return {
		async load(): Promise<unknown> {
			let raw: string;
			try {
				raw = await readFile(filePath, "utf8");
			} catch (error) {
				if (isMissingFile(error)) return undefined;
				throw error;
			}
			return JSON.parse(raw);
		},

		async save(world: World): Promise<void> {
			const directory = dirname(filePath);
			await mkdir(directory, { recursive: true });
			const temporary = `${filePath}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, JSON.stringify(world, null, 2), "utf8");
				await rename(temporary, filePath);
			} finally {
				await rm(temporary, { force: true });
			}
		},
	};
}
