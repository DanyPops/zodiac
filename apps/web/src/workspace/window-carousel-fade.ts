/**
 * Pure layout math for the Window Carousel: centers the active Window,
 * fades neighbors with circular distance, and wraps like a ring rather
 * than a flat strip. WindowCarousel.tsx only wires these up.
 */

/** One Window button's horizontal footprint, including its trailing gap -- must match the Tailwind classes WindowCarousel.tsx actually renders (size-7 = 28px, gap-1 = 4px). */
export const WINDOW_ITEM_STEP_PX = 32;

/** How many Windows away from the active one still show any color at all. Past this distance a Window is fully transparent (opacity 0) -- "fade until unseen", not a curve that only ever approaches zero. */
export const WINDOW_FADE_DISTANCE = 3;

/**
 * Shortest signed distance from `activeIndex` to `index`, wrapping around
 * `windowCount` -- e.g. with 7 Windows, index 6 is delta -1 from index 0
 * (one step before it via the wrap), not +6. Returns 0 for a non-positive
 * windowCount.
 */
export function circularWindowDelta(index: number, activeIndex: number, windowCount: number): number {
	if (windowCount <= 0) return 0;
	const raw = index - activeIndex;
	const wrapped = ((raw % windowCount) + windowCount) % windowCount; // normalized into [0, windowCount)
	return wrapped > windowCount / 2 ? wrapped - windowCount : wrapped;
}

/** Pixel offset (signed) to place a Window `delta` steps from the active one. Feed it a circular delta, not a raw index difference, so the loop wraps visually too. */
export function computeWindowOffsetPx(delta: number): number {
	return delta * WINDOW_ITEM_STEP_PX;
}

/**
 * Linear falloff from full opacity at the active Window (distance 0) to
 * fully invisible at WINDOW_FADE_DISTANCE Windows away or further --
 * clamped, never negative. `distance` is expected to already be a
 * (possibly circular) delta; the sign doesn't matter, only how far.
 */
export function computeWindowFadeOpacity(distance: number): number {
	return Math.max(0, 1 - Math.abs(distance) / WINDOW_FADE_DISTANCE);
}
