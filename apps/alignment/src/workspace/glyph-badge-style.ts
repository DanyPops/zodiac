import { cn } from "../platform/cn.js";

export type GlyphBadgeSize = "sm" | "md" | "lg";

export interface GlyphBadgeStateOptions {
	readonly active?: boolean;
	/** A real tool-call target, or any other reason to ring-highlight regardless of active state. */
	readonly ring?: boolean;
	readonly size?: GlyphBadgeSize;
}

const SIZE_CLASSES: Record<GlyphBadgeSize, string> = {
	sm: "size-6",
	md: "size-7",
	lg: "size-9",
};

/**
 * "Glyph Badge" 's own visual rule, kept separate from the GlyphBadge.tsx
 * component file so a file exporting a plain function (react-refresh
 * requires component-only files) doesn't collide with one exporting JSX --
 * see GlyphBadge.tsx for the full domain-concept writeup.
 */
export function glyphBadgeClassName({ active, ring, size = "md" }: GlyphBadgeStateOptions): string {
	return cn(
		"grid place-items-center rounded-md transition-colors motion-reduce:animate-none",
		SIZE_CLASSES[size],
		active ? "border border-gray-300 bg-gray-100 text-gray-950 dark:border-gray-600 dark:bg-gray-700 dark:text-white" : "text-gray-500 dark:text-gray-400",
		ring && "ring-2 ring-accent",
	);
}
