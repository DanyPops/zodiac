import type { CSSProperties, ReactNode } from "react";
import type { EdgeLocation, Panel } from "@zodiac/protocol";

export interface WorldShellProps {
	/** Real World-level chrome Panels (see GET /api/world/panels) -- looked up by location, never assumed to exist. */
	readonly panels: readonly Panel[];
	readonly top?: ReactNode;
	readonly bottom?: ReactNode;
	readonly left?: ReactNode;
	readonly right?: ReactNode;
	/** The canvas -- WindowDockview's own chat/Surface docking, untouched by this shell; always occupies the center cell. */
	readonly children: ReactNode;
}

function panelAt(panels: readonly Panel[], location: EdgeLocation): Panel | undefined {
	return panels.find((panel) => panel.location === location);
}

/**
 * A Panel's own thickness overrides its slot's track size, but only when
 * declared in this renderer's own unit ("px") -- a Panel seeded/moved by
 * the TUI ("terminal-cells") is treated exactly like a Panel with no
 * thickness override at all, never fed into a CSS track size. See
 * PanelThicknessUnit's own doc comment (packages/protocol/src/panel.ts)
 * for why this guard exists. With no usable thickness, the slot's own
 * content still renders and sizes itself (matches today's
 * WorkspaceSelection/SurfaceTemplatesPillar, which already manage their
 * own width/height independently of any container).
 */
function trackSize(panel: Panel | undefined): string {
	return panel && panel.thicknessUnit === "px" ? `${panel.thickness}px` : "auto";
}

/**
 * A CSS Grid shell for World-level chrome (pillars, and any future
 * notifications/time-jobs/profile Applet) -- the browser-CSS equivalent of
 * packages/protocol/src/regions.ts's layoutWorldRegions: Panel.location
 * picks the grid area, Panel.thickness (once a real Panel occupies that
 * Location) becomes that area's reserved track size, the same
 * reserved-space idea the TUI's own contentHeight/bodyWidth already
 * compute. WindowDockview's own canvas-relative chat/Surface docking is
 * completely untouched by this -- it only ever renders inside `children`
 * (the center cell), the same way Hyprland's own window tiling is
 * untouched by a wlr-layer-shell bar beyond the one reserved-space number
 * it contributes (see the "WorldShell" task's own architecture writeup).
 *
 * Does not yet resolve an AppletId to a rendered component -- top/bottom/
 * left/right are plain ReactNode slots a caller fills directly, same as
 * App.tsx's own current flex row does today. Real per-Applet dispatch (the
 * TUI's own panelBorderLabel/AppletContent equivalent for Web) is separate,
 * later work once Web actually seeds Panels naming real AppletIds.
 */
export function WorldShell({ panels, top, bottom, left, right, children }: WorldShellProps): React.JSX.Element {
	const topPanel = panelAt(panels, "top");
	const bottomPanel = panelAt(panels, "bottom");
	const leftPanel = panelAt(panels, "left");
	const rightPanel = panelAt(panels, "right");

	const style: CSSProperties = {
		display: "grid",
		height: "100%",
		width: "100%",
		gridTemplateAreas: '"top top top" "left center right" "bottom bottom bottom"',
		gridTemplateRows: `${trackSize(topPanel)} 1fr ${trackSize(bottomPanel)}`,
		gridTemplateColumns: `${trackSize(leftPanel)} 1fr ${trackSize(rightPanel)}`,
	};

	return (
		<div data-testid="world-shell" style={style}>
			{top !== undefined && <div style={{ gridArea: "top" }}>{top}</div>}
			{left !== undefined && <div style={{ gridArea: "left" }}>{left}</div>}
			<div style={{ gridArea: "center", minWidth: 0, minHeight: 0 }}>{children}</div>
			{right !== undefined && <div style={{ gridArea: "right" }}>{right}</div>}
			{bottom !== undefined && <div style={{ gridArea: "bottom" }}>{bottom}</div>}
		</div>
	);
}
