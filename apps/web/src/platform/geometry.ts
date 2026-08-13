/**
 * Pure 2-D pixel-space geometry -- no DOM/window access, so it's shared
 * freely by both `platform/` adapters and `workspace/` feature code. The
 * canonical `Rect`/`Point` shape for the whole web app; every feature-local
 * type that used to restate `{left,top,width,height}` or `{x,y}` on its own
 * (proximity-zones.ts's own Rect/Point, dock-ruler.ts's DockRulerTargetBox
 * and DockRulerRect, DockRulerFrame.tsx's DockRulerFrameBox) now aliases
 * this one instead.
 *
 * Deliberately scoped to the web app's own continuous, float pixel-space
 * geometry -- apps/terminal's own Rect (frame/index.ts) is a discrete,
 * branded-integer character-grid concept with no overlapping math, not a
 * candidate for this module.
 */

export interface Rect {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export interface Point {
	readonly x: number;
	readonly y: number;
}

export function centroidOf(rect: Rect): Point {
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function distanceBetween(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

/** `pageRect` (e.g. a real `getBoundingClientRect()`) expressed relative to `containerRect`'s own top-left corner, instead of the page's. */
export function toLocalRect(pageRect: Rect, containerRect: Rect): Rect {
	return { left: pageRect.left - containerRect.left, top: pageRect.top - containerRect.top, width: pageRect.width, height: pageRect.height };
}

export type SplitAxis = "horizontal" | "vertical";

/**
 * Divides `rect` along `axis` at `ratio` (0..1 of that axis's own
 * width/height), returning whichever side `fromStart` selects -- the start
 * (left/top) or the remainder (right/bottom). The one operation
 * dock-ruler.ts's `dockRulerHintRect` (an arbitrary ratio, per the Dock
 * Ruler's own guide fractions) and proximity-zones.ts's `groupPositionRect`
 * (a fixed 0.5) both reduce to -- kept as one function specifically because
 * those two drifted apart once already (a real, shipped misalignment bug)
 * when they were independent.
 */
export function splitRect(rect: Rect, axis: SplitAxis, fromStart: boolean, ratio: number): Rect {
	const horizontal = axis === "horizontal";
	const activeAxisPx = horizontal ? rect.width * ratio : rect.height * ratio;
	return horizontal
		? { left: fromStart ? rect.left : rect.left + activeAxisPx, top: rect.top, width: fromStart ? activeAxisPx : rect.width - activeAxisPx, height: rect.height }
		: { left: rect.left, top: fromStart ? rect.top : rect.top + activeAxisPx, width: rect.width, height: fromStart ? activeAxisPx : rect.height - activeAxisPx };
}
