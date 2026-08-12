import type { World } from "@alignment/protocol";

/**
 * The driven port a persistence adapter (SQLite today, per the IWE
 * architecture's `alignmentd`) implements to load/save a World. No adapter
 * lives in this package -- `@alignment/server` stays framework/storage
 * neutral; a concrete implementation belongs in the daemon that owns real
 * disk/network access.
 */
export interface WorldSnapshotPort {
	load: () => Promise<unknown>;
	save: (world: World) => Promise<void>;
}
