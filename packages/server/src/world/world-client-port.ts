import type { CommandIntent, WorkspaceId, WorkspaceViewModel, WorldViewModel } from "@zodiac/protocol";

/**
 * The wire-safe subset of `WorldStore` (./store.ts) any client-side
 * consumer can depend on -- exactly the four members a real zodiacd HTTP
 * API actually exposes (apps/service's own world-routes.ts: GET
 * /api/world, POST .../commands, GET .../events -- nothing else). `WorldStore`
 * itself carries six further members (`snapshot`, `createWorkspace`,
 * `getWorkspace`, `dockSurface`, `undockSurface`, `dockSurfaceInto`,
 * `windowTile`) that exist only for the daemon's own in-process
 * seeding/admin use and were never meant to cross a wire boundary.
 *
 * Depending on this narrower port instead of the full `WorldStore` is what
 * lets a client-side test substitute a trivial in-memory fake, or the real
 * embedded `createWorldStore()` (still zero network, but real domain
 * logic rather than a hand-rolled stub), in place of a live daemon --
 * without ever forcing an adapter to write dead "not supported" methods
 * just to satisfy a wider type it can't (and shouldn't) actually implement.
 * `connectRemoteWorldStore` (./remote-world-store.ts) returns exactly this
 * shape; `WorldStore` is structurally a superset of it, so any real
 * `WorldStore` (e.g. `createWorldStore()`) is already a valid
 * `WorldClientPort` with no adapter code required.
 */
export interface WorldClientPort {
	readonly worldViewModel: () => WorldViewModel;
	readonly workspaceViewModel: (workspaceId: WorkspaceId) => WorkspaceViewModel | undefined;
	/** Applies one typed CommandIntent -- the same path a keybinding, a palette entry, a script/RPC call, or an agent action all go through. */
	readonly apply: (intent: CommandIntent) => void;
	/** Subscribes to every state change; called with the fresh worldViewModel. Returns an unsubscribe function. */
	readonly onChange: (listener: (viewModel: WorldViewModel) => void) => () => void;
}
