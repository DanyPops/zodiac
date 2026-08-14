import type { CSSProperties } from "react";
import { dockRulerHintRect, type DockRulerHint } from "./dock-ruler.js";
import { ACTIVE_ZONE_CEILING_OPACITY, ACTIVE_ZONE_FLOOR_OPACITY } from "./proximity-zones.js";

interface DockRulerProps {
	readonly width: number;
	readonly height: number;
	readonly hint: DockRulerHint;
}

/**
 * The live split preview shown over an existing docked Surface's own
 * content while dragging -- exactly how much of the pane the new split
 * will take. The ruler's own ticks/labels live outside the content
 * entirely now, in DockRulerFrame's outer bars; this is deliberately just
 * the in-content preview, `pointer-events-none` so it never competes with
 * the native HTML5 drag events dockview itself listens for underneath it.
 *
 * A thicker, brighter-breathing instance of the ambient proximity zones'
 * own border-box language, not a separate "blocky overlay" motif -- same
 * neutral grey, same animate-zone-breathe rhythm, same shared corner-radius
 * token, just a brighter range since this is a confirmed target, not a
 * proximity guess. WindowDockview suppresses the matching ambient zone
 * while this is showing, so the two can never disagree about where a drop
 * would land -- this is the only rectangle shown for that position.
 *
 * Position via `transform`, not `left`/`top`: `hint` is recomputed on every
 * live drag sample, and `transform` is compositor-only (no layout/paint).
 * `width`/`height` stay real properties -- they change per hint too, and
 * this box's border + corner-radius can't be faithfully reproduced by
 * scaling.
 */
export function DockRuler({ width, height, hint }: DockRulerProps): React.JSX.Element {
	const rect = dockRulerHintRect(hint, width, height);
	// left/top pinned at the container's own origin -- the actual offset moves
	// entirely through transform, so an absolutely-positioned element's static
	// fallback position never has to be relied on.
	const style: CSSProperties & Record<string, string | number> = { left: 0, top: 0, transform: `translate(${rect.left}px, ${rect.top}px)`, width: rect.width, height: rect.height, "--zone-min-opacity": ACTIVE_ZONE_FLOOR_OPACITY, "--zone-max-opacity": ACTIVE_ZONE_CEILING_OPACITY };

	return <div data-testid="dock-ruler-shade" className="pointer-events-none absolute z-40 animate-zone-breathe rounded-[var(--app-corner-radius,16px)] border-2 border-gray-500 motion-reduce:animate-none dark:border-gray-400" style={style} />;
}
