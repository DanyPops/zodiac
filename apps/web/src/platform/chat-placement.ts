import { EdgeLocationSchema, formFactorForLocation, type EdgeLocation, type FormFactor } from "@zodiac/protocol";

/** Which edge of the center canvas Chat is docked to -- a real, user-chosen split (see WindowDockview's mountAnchor). Literally @zodiac/protocol's own EdgeLocation, the same type the TUI's Panel/Location system and panel.move CommandIntent use -- single source of truth, not two copies. */
export type ChatPlacement = EdgeLocation;

/** top/bottom is a short, wide strip; left/right is tall and narrow -- drives ConversationSurface's own transcript/composer arrangement. Literally @zodiac/protocol's own FormFactor. */
export type ChatOrientation = FormFactor;

export const DEFAULT_CHAT_PLACEMENT: ChatPlacement = "right";

/**
 * The fraction of the reference group's size Chat's own split occupies --
 * fixed, not user-adjustable (only the edge is): comfortably within the
 * requested 1/5-1/4 range.
 */
export const CHAT_SIZE_RATIO = 0.22;

export function isChatPlacement(value: unknown): value is ChatPlacement {
	return EdgeLocationSchema.safeParse(value).success;
}

export function chatOrientation(placement: ChatPlacement): ChatOrientation {
	return formFactorForLocation(placement);
}
