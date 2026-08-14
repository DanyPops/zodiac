/** Which edge of the center canvas Chat is docked to -- a real, user-chosen split (see WindowDockview's mountAnchor). */
export type ChatPlacement = "top" | "bottom" | "left" | "right";

/** top/bottom is a short, wide strip; left/right is tall and narrow -- drives ConversationSurface's own transcript/composer arrangement. */
export type ChatOrientation = "horizontal" | "vertical";

export const DEFAULT_CHAT_PLACEMENT: ChatPlacement = "right";

/**
 * The fraction of the reference group's size Chat's own split occupies --
 * fixed, not user-adjustable (only the edge is): comfortably within the
 * requested 1/5-1/4 range.
 */
export const CHAT_SIZE_RATIO = 0.22;

const PLACEMENTS: readonly ChatPlacement[] = ["top", "bottom", "left", "right"];

export function isChatPlacement(value: unknown): value is ChatPlacement {
	return typeof value === "string" && (PLACEMENTS as readonly string[]).includes(value);
}

export function chatOrientation(placement: ChatPlacement): ChatOrientation {
	return placement === "top" || placement === "bottom" ? "horizontal" : "vertical";
}
