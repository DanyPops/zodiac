import { cn } from "../platform/cn.js";
import { glyphBadgeClassName, type GlyphBadgeStateOptions } from "./glyph-badge-style.js";

/**
 * "Glyph Badge": Alignment's one recurring icon-in-a-box element, styled
 * per Gradient to Contrast (see platform/surface-style.ts) -- idle content
 * sits flush and muted against its surface; the active one gets its own
 * bordered, filled chip with darker content, exactly the Window Carousel's
 * own numbered-pill treatment (its reference implementation). Every other
 * Workspace/Window glyph recycles this instead of restating the same
 * border/bg/text triad per call site.
 *
 * Exported here as this thin wrapper (for a badge sitting beside other
 * content, e.g. a catalog row's icon), and as `glyphBadgeClassName` in
 * glyph-badge-style.ts (for merging onto an element that already owns the
 * hit target, e.g. a collapsed tile's own button).
 */
export function GlyphBadge({ active, ring, size, children, className }: GlyphBadgeStateOptions & { readonly children: React.ReactNode; readonly className?: string }): React.JSX.Element {
	return <span className={cn(glyphBadgeClassName({ active, ring, size }), className)}>{children}</span>;
}
