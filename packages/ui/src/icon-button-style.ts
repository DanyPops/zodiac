import { cn } from "./cn.js";
import { GLYPH_SIZE_CLASSES, type GlyphSize } from "./glyph-size.js";

export interface IconButtonStateOptions {
	readonly size?: GlyphSize;
	/** The "add a new one" affordance (Create a new Workspace): an empty dashed slot, not a solid button. */
	readonly dashed?: boolean;
}

/**
 * "Icon Button": the shell's other recurring icon-in-a-box element,
 * alongside Glyph Badge -- a plain, stateless action (Previous/Next/New
 * Window, dock/collapse Chat, dock a Surface Template, create a new
 * Workspace), never an identity with an active/idle distinction. Where
 * Glyph Badge's idle state sits flush and muted, an Icon Button is always
 * legibly visible with its own hover highlight -- it's a control to press,
 * not a thing to recognize as selected. Uses the shared --app-corner-radius
 * token like every other shape in the shell.
 */
export function iconButtonClassName({ size = "md", dashed }: IconButtonStateOptions): string {
	return cn(
		"grid shrink-0 place-items-center rounded-[var(--app-corner-radius,16px)] transition-colors focus-visible:outline-2 focus-visible:outline-accent",
		GLYPH_SIZE_CLASSES[size],
		dashed
			? "border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600 dark:border-gray-600 dark:hover:border-gray-500 dark:hover:text-gray-300"
			: "text-gray-600 hover:bg-gray-200 hover:text-gray-950 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white",
	);
}
