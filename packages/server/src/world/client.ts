/**
 * The browser-safe half of @zodiac/server/world -- exactly what a
 * client-side consumer (apps/web today) can import without pulling
 * `json-file-snapshot-port.ts`'s real `node:fs/promises`/`node:crypto`
 * usage into a Vite/Rollup browser bundle (confirmed directly: importing
 * the full `@zodiac/server/world` barrel from apps/web broke `vite build`
 * outright -- "readFile is not exported by __vite-browser-external" --
 * since that barrel also re-exports `createJsonFileSnapshotPort`, a
 * daemon-only adapter). `WorldStore`/`createWorldStore` stay importable
 * from this subpath too (both are pure logic, no I/O) since a browser test
 * may want the real embedded implementation as a `WorldClientPort` fake
 * (see world-client-port.ts's own doc comment) -- only the disk-backed
 * snapshot adapter is deliberately excluded.
 */
export type { WorldStore } from "./store.js";
export { createWorldStore, createWorldStoreFromWorld, hydrateWorldStore } from "./store.js";

export type { WorldClientPort } from "./world-client-port.js";

export type { RemoteWorldStoreOptions, PostCommandOutcome } from "./remote-world-store.js";
export { connectRemoteWorldStore, postCommandIntent } from "./remote-world-store.js";
