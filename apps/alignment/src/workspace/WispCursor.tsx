import { Sparkle } from "lucide-react";
import { computeWispCursorStyle, type WispCursorPosition } from "./wisp-cursor.js";

interface WispCursorProps {
	readonly visible: boolean;
	/** Undefined while idle. */
	readonly target?: WispCursorPosition;
}

/** Bottom-center, next to where Chat is summoned from. */
const ANCHOR: WispCursorPosition = { x: 0, y: 0 };

/** Cosmetic indicator of where the agent is "going" during global (undocked) chat. `inert` while hidden so it's never tab-reachable. */
export function WispCursor({ visible, target }: WispCursorProps): React.JSX.Element {
	const style = computeWispCursorStyle({ visible, target }, ANCHOR);

	return (
		<>
			{/* Static, never transformed -- the fixed reference point useWispCursorTarget measures offsets from. Same base position as the visible dot below, zero size so it doesn't affect layout. */}
			<div data-wisp-cursor-anchor aria-hidden="true" className="pointer-events-none absolute bottom-2 left-1/2 size-6 -translate-x-1/2" />
			<div
				aria-hidden="true"
				inert={!visible}
				className="pointer-events-none absolute bottom-2 left-1/2 z-50 grid size-6 -translate-x-1/2 place-items-center rounded-full bg-accent text-white shadow-lg transition-transform duration-500 ease-out motion-reduce:transition-none"
				style={{ opacity: style.opacity, transform: `translateX(-50%) ${style.transform}` }}
			>
				<Sparkle aria-hidden="true" size={12} className={style.idle ? "animate-wisp-breathe motion-reduce:animate-none" : undefined} />
			</div>
		</>
	);
}
