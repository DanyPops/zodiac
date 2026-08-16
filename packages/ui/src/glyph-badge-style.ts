import { cn } from "./cn.js";
import { GLYPH_SIZE_CLASSES, type GlyphSize } from "./glyph-size.js";

export interface GlyphBadgeStateOptions {
	readonly active?: boolean;
	/** A real tool-call target, or any other reason to ring-highlight regardless of active state. */
	readonly ring?: boolean;
	readonly size?: GlyphSize;
}

/**
 * "Glyph Badge" 's own visual rule, kept separate from the GlyphBadge.tsx
 * component file so a file exporting a plain function (react-refresh
 * requires component-only files) doesn't collide with one exporting JSX --
 * see GlyphBadge.tsx for the full domain-concept writeup.
 */
export function glyphBadgeClassName({ active, ring, size = "md" }: GlyphBadgeStateOptions): string {
	return cn(
		// The shared --app-corner-radius token, same as the pillars themselves and the "A" logo tile -- a glyph-sized box becomes a true circle once Corner Sharpness's radius exceeds half its own side, same as everywhere else that token is used.
		"grid place-items-center rounded-[var(--app-corner-radius,16px)] transition-colors motion-reduce:animate-none",
		GLYPH_SIZE_CLASSES[size],
		active ? "border border-gray-300 bg-gray-100 text-gray-950 dark:border-gray-600 dark:bg-gray-700 dark:text-white" : "text-gray-500 dark:text-gray-400",
		ring && "ring-2 ring-accent",
	);
}
