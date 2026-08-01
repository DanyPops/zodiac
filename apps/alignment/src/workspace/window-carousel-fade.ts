/**
 * The Window Carousel keeps the active Window horizontally centered and
 * fades its neighbors out with distance -- a coverflow-style effect, not a
 * plain scrollable list. It's also an infinite loop: the sequence wraps,
 * so the Window right before index 0 is the *last* Window, not "maximally
 * far away" -- matching nextWindow/previousWindow's own wrap-around ring
 * in workspace/model.ts, which the visual carousel previously didn't
 * reflect at all (a flat, dead-ended strip). All three pieces (circular
 * delta, per-item offset, opacity falloff) are pure functions of
 * index/count so WindowCarousel.tsx only wires them up, and all are
 * unit-tested without a DOM.
 */

/** One Window button's horizontal footprint, including its trailing gap -- must match the Tailwind classes WindowCarousel.tsx actually renders (size-7 = 28px, gap-1 = 4px). */
export const WINDOW_ITEM_STEP_PX = 32;

/** How many Windows away from the active one still show any color at all. Past this distance a Window is fully transparent (opacity 0) -- "fade until unseen", not a curve that only ever approaches zero. */
export const WINDOW_FADE_DISTANCE = 3;

/**
 * The shortest signed distance from `activeIndex` to `index`, wrapping
 * around `windowCount` -- e.g. with 7 Windows, index 6 is delta -1 from
 * active index 0 (one step *before* it, via the wrap), not +6. This is
 * what makes the carousel a loop: going "next" from the last Window and
 * continuing to the first is a single smooth step in one direction, the
 * same as any other adjacent pair, not a jump across the whole track.
 * Returns 0 for a non-positive windowCount (nothing to wrap around).
 */
export function circularWindowDelta(index: number, activeIndex: number, windowCount: number): number {
	if (windowCount <= 0) return 0;
	const raw = index - activeIndex;
	const wrapped = ((raw % windowCount) + windowCount) % windowCount; // normalized into [0, windowCount)
	return wrapped > windowCount / 2 ? wrapped - windowCount : wrapped;
}

/**
 * The pixel offset (signed, left or right of center) to place a Window
 * `delta` steps from the active one -- a plain multiple of the per-item
 * step, fed the *circular* delta above rather than a raw index
 * difference, so the loop wraps visually too.
 */
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
