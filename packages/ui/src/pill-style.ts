import { cn } from "./cn.js";
import { SURFACE_BG } from "./surface-style.js";

/** The shell's one horizontal pill shape -- shared by the Window Carousel and every utility pill flanking it (Notifications, the clock), so a new one never invents its own shape. */
const UTILITY_PILL_CLASSES = "inline-flex h-10 shrink-0 items-center gap-1 rounded-[var(--app-corner-radius,16px)] px-2";

/**
 * Merges the shell's one pill shape with Gradient to Contrast (SURFACE_BG)
 * in a single call, closing the gap every real pill call site (WatchPill,
 * NotificationsPill, WindowCarousel) had before this: each hand-consumed
 * both `UTILITY_PILL_CLASSES` and `SURFACE_BG` separately via its own
 * `cn(...)` call, rather than through one shared function. No polymorphic
 * `<Pill>` component -- iconButtonClassName already sets this package's own
 * precedent that a pure style function needs no forced wrapper component
 * when call sites render genuinely different elements (a plain `<div>` vs
 * WindowCarousel's own ref-forwarding `<nav>`).
 */
export function pillClassName(className?: string): string {
	return cn(UTILITY_PILL_CLASSES, SURFACE_BG, className);
}
