import type { SurfaceId, WorldViewModel } from "@zodiac/protocol";
import { computeTileRects, type Rect } from "@zodiac/server/window";

export interface LiveWorldTilesProps {
	readonly viewModel: WorldViewModel;
	readonly connected: boolean;
}

/** A fixed-size box this panel projects the active Window's tile into -- a real dockable Panel (see the movable-chrome walking-skeleton task) is future work; this proves the live wiring itself first. */
const PANEL_AREA: Rect = { x: 0, y: 0, width: 480, height: 270 };

function statusMessage(state: string, text: string): React.JSX.Element {
	return (
		<div data-testid="live-world-tiles" data-state={state} className="rounded-md border border-dashed border-gray-400 p-3 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
			{text}
		</div>
	);
}

/**
 * Renders the real daemon's own current tile geometry for the active
 * Workspace's active Window -- one positioned, titled box per docked
 * Surface, projected through the identical `computeTileRects` function
 * `apps/terminal`'s `paintBody()` already uses. Additive: does not replace
 * or touch `WindowDockview`'s own mock-catalog render path (see the "story
 * 6 Web half" task's own scope-correcting finding for why). Purely
 * presentational -- fed a `WorldViewModel` + `connected` flag (see
 * `useWorldClient`), so it is fully testable with a canned view model and
 * needs no daemon in its own tests.
 */
export function LiveWorldTiles({ viewModel, connected }: LiveWorldTilesProps): React.JSX.Element {
	if (!connected) return statusMessage("disconnected", "Live daemon state unavailable -- no zodiacd reachable.");
	if (viewModel.state === "empty") return statusMessage("empty", "No workspace open.");

	const workspace = viewModel.workspaces.find((candidate) => candidate.id === viewModel.activeWorkspaceId) ?? viewModel.workspaces[0];
	if (!workspace) return statusMessage("empty", "No workspace open.");

	const activeWindow = workspace.windows.find((candidate) => candidate.id === workspace.activeWindowId) ?? workspace.windows[0];
	if (!activeWindow || activeWindow.tile === null) return statusMessage("no-surfaces", `${workspace.title} -- no Surfaces docked.`);

	const placements = computeTileRects(activeWindow.tile, PANEL_AREA);
	if (!placements.ok) return statusMessage("error", `Tile geometry failed: ${placements.reason}.`);

	const titleFor = (id: SurfaceId): string => activeWindow.surfaces.find((surface) => surface.id === id)?.title ?? id;

	return (
		<div data-testid="live-world-tiles" data-state="ready" style={{ position: "relative", width: PANEL_AREA.width, height: PANEL_AREA.height }} className="overflow-hidden rounded-md border border-gray-400 dark:border-gray-600">
			{placements.value.map((placement) => (
				<div
					key={placement.surfaceId}
					data-testid="live-world-tile"
					style={{ position: "absolute", left: placement.rect.x, top: placement.rect.y, width: placement.rect.width, height: placement.rect.height }}
					className="overflow-hidden border border-gray-400 p-1 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-300"
				>
					{titleFor(placement.surfaceId)}
				</div>
			))}
		</div>
	);
}
