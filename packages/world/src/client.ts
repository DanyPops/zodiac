import type { CommandIntent, Panel, WorkspaceId, WorkspaceViewModel, WorldViewModel } from "@zodiac/protocol";

/**
 * The wire-safe subset of zodiacd's real `WorldStore` (`@zodiac/server/world`)
 * any client-side consumer can depend on -- exactly the five members a real
 * zodiacd HTTP API actually exposes (apps/service's own world-routes.ts: GET
 * /api/world, GET .../panels, POST .../commands, GET .../events -- nothing
 * else). `WorldStore` itself carries six further members (`snapshot`,
 * `createWorkspace`, `getWorkspace`, `dockSurface`, `undockSurface`,
 * `dockSurfaceInto`, `windowTile`) that exist only for the daemon's own
 * in-process seeding/admin use and were never meant to cross a wire
 * boundary.
 *
 * Lives here, in `@zodiac/world` (the client package), not in `@zodiac/server`
 * (the domain/daemon package) -- a consumer interface, defined by and living
 * with its actual consumers (apps/web, apps/terminal), per Martin Fowler's
 * "Required Interface" ("required interfaces are specified, and often
 * defined, by the client") and Robert C. Martin's own observation that
 * "interfaces are very often included in the package that uses them, rather
 * than in the package that implements them"). `@zodiac/server`'s own
 * `WorldStore` doesn't need to know this interface exists at all; it's
 * already a structural superset of it.
 *
 * Depending on this narrower interface instead of the full `WorldStore` is
 * what lets a client-side test substitute a trivial in-memory fake, or the
 * real embedded `createWorldStore()` (still zero network, but real domain
 * logic rather than a hand-rolled stub), in place of a live daemon --
 * without ever forcing an adapter to write dead "not supported" methods
 * just to satisfy a wider type it can't (and shouldn't) actually implement.
 * `connectRemoteWorldStore` (./remote-world-store.ts) returns exactly this
 * shape; `WorldStore` is structurally a superset of it, so any real
 * `WorldStore` (e.g. `createWorldStore()`) is already a valid `WorldClient`
 * with no adapter code required.
 */
export interface WorldClient {
	readonly worldViewModel: () => WorldViewModel;
	readonly workspaceViewModel: (workspaceId: WorkspaceId) => WorkspaceViewModel | undefined;
	/** Global World chrome -- see WorldStore.panels' own doc comment. On a remote connection, reflects the last GET /api/world/panels response; a panel.move triggers a real onChange broadcast the same as any other mutation, so a caller re-reading panels() from inside its own onChange listener sees it (onChange may fire a second time for the same WorldViewModel once the background refresh lands -- not a live per-command reconciliation, see this port's own limitations noted on the WorldShell task). */
	readonly panels: () => readonly Panel[];
	/** Applies one typed CommandIntent -- the same path a keybinding, a palette entry, a script/RPC call, or an agent action all go through. */
	readonly apply: (intent: CommandIntent) => void;
	/** Subscribes to every state change; called with the fresh worldViewModel. Returns an unsubscribe function. */
	readonly onChange: (listener: (viewModel: WorldViewModel) => void) => () => void;
}
