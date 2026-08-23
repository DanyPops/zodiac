import type { WorkspaceViewModel } from "@zodiac/protocol";

/**
 * WindowDockview's own remount key. Must be the daemon's real active
 * WindowId, not a local fallback that never changes -- previously this fell
 * back to `workspace.activeWindow.id` unconditionally, which stayed fixed
 * once local window.next/select dispatch was removed. WindowDockview never
 * remounted on a real window switch, so its own mount/unmount effect read
 * the new window's different Surface list as "everything got removed" and
 * dispatched real `surface.undock` calls -- confirmed live, destroyed two
 * real docked Surfaces just by switching windows in the Carousel.
 */
export function resolveActiveWindowId(daemonWorkspace: WorkspaceViewModel | undefined, activeWindowIndex: number, localFallbackWindowId: string | undefined): string | undefined {
	if (!daemonWorkspace) return localFallbackWindowId;
	return daemonWorkspace.windows[activeWindowIndex]?.id ?? localFallbackWindowId;
}
