import type { EdgeLocation, Panel } from "@zodiac/protocol";

/**
 * Web's own client-side default per edge Location, mirroring
 * packages/protocol/src/regions.ts's own DEFAULT_EDGE_APPLET_IDS -- so
 * Web's chrome looks identical before any Panel exists (a fresh daemon
 * boot with the seed removed, a disconnected/no-daemon dev session) or
 * before useWorldClient's own initial GET /api/world/panels resolves.
 */
const DEFAULT_EDGE_APPLET_IDS: Partial<Record<EdgeLocation, string>> = {
	left: "workspace-nav",
	right: "surface-templates",
};

/**
 * Which AppletId (if any) should render at a given edge Location right now.
 * A real Panel's own body wins outright once one exists there -- including
 * rendering nothing at all for an explicitly-emptied body (an Applet moved
 * away), never silently falling back to this edge's own default the way a
 * genuinely Panel-less Location does. Matches packages/protocol/src/regions.ts's
 * panelBodyFor's own explicit-placement precedent for the TUI.
 */
export function appletIdForLocation(location: EdgeLocation, panels: readonly Panel[]): string | undefined {
	const panel = panels.find((candidate) => candidate.location === location);
	if (panel) return panel.body[0];
	return DEFAULT_EDGE_APPLET_IDS[location];
}
