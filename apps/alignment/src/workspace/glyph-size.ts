/** The shell's one fixed glyph-tile size scale, shared by GlyphBadge and IconButton so a "size-9 icon tile" is never a separately-chosen magic number in more than one place. */
export type GlyphSize = "sm" | "md" | "xl" | "lg";

export const GLYPH_SIZE_CLASSES: Record<GlyphSize, string> = {
	sm: "size-6",
	md: "size-7",
	xl: "size-8",
	lg: "size-9",
};
