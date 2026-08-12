/**
 * Whether a docked Surface should render at full opacity (true) or dim as
 * the Window's inactive/background one (false) -- the "via defocus" half of
 * the shared spawn/close/defocus animation language. Only meaningful when
 * more than one Surface is actually docked (nothing to compare against
 * alone) and once dockview has reported a real active panel (never dims
 * speculatively before that first signal arrives).
 */
export function isSurfaceFocused(instanceId: string, activePanelId: string | undefined, dockedSurfaceCount: number): boolean {
	if (dockedSurfaceCount <= 1) return true;
	if (activePanelId === undefined) return true;
	return instanceId === activePanelId;
}
