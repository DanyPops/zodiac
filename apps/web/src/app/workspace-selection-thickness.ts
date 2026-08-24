/**
 * Matches WorkspaceSelection.tsx's own collapsed "quick selection" strip
 * width (`w-14`, 3.5rem) -- the real fix for the narrow-viewport bug this
 * pairs with: collapsing via Ctrl+B used to only swap which nav renders,
 * never telling the daemon to shrink the Panel's own reserved grid-column
 * thickness (WorldShell.tsx reads it straight from Panel.thickness), so a
 * narrow viewport was left with the full expanded width still reserved but
 * empty.
 */
export const COLLAPSED_WORKSPACE_SELECTION_THICKNESS = 56;

/** Mirrors apps/service/src/cli.ts's own DEFAULT_WORLD_PANELS seed for the workspace-nav Panel -- the fallback expanded width before any real Panel data has arrived from the daemon yet. */
export const DEFAULT_EXPANDED_WORKSPACE_SELECTION_THICKNESS = 256;

/** The Panel thickness (px) to dispatch for a given collapsed state -- `lastExpandedThickness` (the most recently observed non-collapsed width, e.g. from a manual drag-resize) is what expanding restores to, rather than a fixed default that would discard a user's own resize. */
export function resolveWorkspaceSelectionThickness(collapsed: boolean, lastExpandedThickness: number): number {
	return collapsed ? COLLAPSED_WORKSPACE_SELECTION_THICKNESS : lastExpandedThickness;
}
