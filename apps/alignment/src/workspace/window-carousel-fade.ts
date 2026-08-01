/**
 * The Window Carousel keeps the active Window horizontally centered and
 * fades its neighbors out with distance -- a coverflow-style effect, not a
 * plain scrollable list. Both halves (the centering offset, the opacity
 * falloff) are pure functions of index/distance so WindowCarousel.tsx only
 * wires them up, and both are unit-tested without a DOM.
 */

/** One Window button's horizontal footprint, including its trailing gap -- must match the Tailwind classes WindowCarousel.tsx actually renders (size-7 = 28px, gap-1 = 4px). */
export const WINDOW_ITEM_STEP_PX = 32;

/** Half of one Window button's own width (size-7 = 28px) -- centers on the button itself, not the gap after it. */
export const WINDOW_ITEM_HALF_WIDTH_PX = 14;

/** How many Windows away from the active one still show any color at all. Past this distance a Window is fully transparent (opacity 0) -- "fade until unseen", not a curve that only ever approaches zero. */
export const WINDOW_FADE_DISTANCE = 3;

/**
 * The pixel offset to translate the Window track left by so that
 * `activeIndex`'s own button sits centered in the carousel's viewport,
 * regardless of how many Windows exist on either side of it. The track's
 * own left edge is anchored at the viewport's horizontal center (see
 * WindowCarousel.tsx's `left-1/2`); shifting it left by this offset moves
 * the active button's center, not its left edge, onto that anchor point.
 */
export function computeWindowTrackOffsetPx(activeIndex: number): number {
	return activeIndex * WINDOW_ITEM_STEP_PX + WINDOW_ITEM_HALF_WIDTH_PX;
}

/**
 * Linear falloff from full opacity at the active Window (distance 0) to
 * fully invisible at WINDOW_FADE_DISTANCE Windows away or further --
 * clamped, never negative. `distance` is `index - activeIndex`; the sign
 * doesn't matter, only how far.
 */
export function computeWindowFadeOpacity(distance: number): number {
	return Math.max(0, 1 - Math.abs(distance) / WINDOW_FADE_DISTANCE);
}
