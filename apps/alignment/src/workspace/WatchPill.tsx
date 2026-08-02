import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "../platform/surface-style.js";
import { formatClock } from "./clock.js";
import { UTILITY_PILL_CLASSES } from "./utility-pill-style.js";

/** How often the displayed minute is re-checked -- a menu-bar clock reads minutes, not seconds, so this doesn't need to be 1000ms. */
const TICK_MS = 15_000;

/**
 * A live clock flanking the Window Carousel -- reuses the shared pill shape
 * (utility-pill-style.ts) and Gradient to Contrast (SURFACE_BG), the same
 * elements every other pill in the shell already uses. Passive display, not
 * a button -- there's no action to take on the current time.
 */
export function WatchPill(): React.JSX.Element {
	const [now, setNow] = useState(() => new Date());

	useEffect(() => {
		const intervalId = setInterval(() => setNow(new Date()), TICK_MS);
		return () => clearInterval(intervalId);
	}, []);

	return (
		<div role="status" aria-label="Current time" className={cn(UTILITY_PILL_CLASSES, SURFACE_BG)}>
			<Clock aria-hidden="true" size={14} className="text-gray-500 dark:text-gray-400" />
			<span className="px-1 text-xs font-medium tabular-nums text-gray-700 dark:text-gray-200">{formatClock(now)}</span>
		</div>
	);
}
