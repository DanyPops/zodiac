import { Sparkle } from "lucide-react";
import { computeWispCursorStyle, type WispCursorPosition } from "./wisp-cursor.js";

interface WispCursorProps {
	readonly visible: boolean;
	/** Undefined while idle -- see wisp-cursor.ts for why real targets aren't resolvable yet. */
	readonly target?: WispCursorPosition;
}

/** Anchor while idle: bottom-center, next to where Chat itself is summoned from. */
const ANCHOR: WispCursorPosition = { x: 0, y: 0 };

/**
 * Cosmetic-only indicator of where the agent is "going" during global
 * (undocked) chat -- see Doc "Alignment: Workspace as scope/permission
 * boundary". `inert` while hidden, matching ChatOverlay's own discipline: a
 * purely visual cue must never become a hidden, tab-reachable element.
 */
export function WispCursor({ visible, target }: WispCursorProps): React.JSX.Element {
	const style = computeWispCursorStyle({ visible, target }, ANCHOR);

	return (
		<div
			aria-hidden="true"
			inert={!visible}
			className="pointer-events-none absolute bottom-2 left-1/2 z-50 grid size-6 -translate-x-1/2 place-items-center rounded-full bg-accent text-white shadow-lg transition-transform duration-500 ease-out motion-reduce:transition-none"
			style={{ opacity: style.opacity, transform: `translateX(-50%) ${style.transform}` }}
		>
			<Sparkle aria-hidden="true" size={12} className={style.idle ? "animate-pulse motion-reduce:animate-none" : undefined} />
		</div>
	);
}
