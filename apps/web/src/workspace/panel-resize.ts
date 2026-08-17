/**
 * Collapsed/expanded, in CSS pixels -- matches WorkspaceSelection's own
 * existing two widths (`w-14`/`w-64`) exactly, so drag-resize snaps to the
 * same two states the collapse toggle already offers, not a third
 * in-between one nothing else in the UI knows how to render.
 */
export const PANEL_RESIZE_SNAP_POINTS: readonly number[] = [56, 256];

/** The nearest of `snapPoints` to a live drag's own candidate thickness -- "snapping" per its own name: a small set of allowed values, never a free/continuous size. */
export function nearestPanelThickness(candidate: number, snapPoints: readonly number[] = PANEL_RESIZE_SNAP_POINTS): number {
	return snapPoints.reduce((closest, point) => (Math.abs(point - candidate) < Math.abs(closest - candidate) ? point : closest));
}
