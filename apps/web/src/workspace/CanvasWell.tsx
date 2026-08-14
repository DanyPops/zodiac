import type { ReactNode } from "react";
import { cn } from "../platform/cn.js";
import { WELL_BG } from "../platform/surface-style.js";
import { NotificationsPill } from "./NotificationsPill.js";
import { WatchPill } from "./WatchPill.js";

interface CanvasWellProps {
	/** The Window Carousel pager -- undefined before any Workspace/Window exists, in which case the header strip just shows Notifications and the clock. */
	readonly center?: ReactNode;
	readonly children: ReactNode;
}

/**
 * The shell's one canvas surface, flush to the column's own top edge in
 * every state -- not just the empty landing. Notifications, the Window
 * Carousel, and the clock live inside this same box as one header strip
 * instead of floating separately above/over it: a real reported
 * inconsistency where the dockview canvas started visibly lower than the
 * landing's own WELL_BG box, with the Carousel occupying its own row above
 * it and Notifications/WatchPill absolutely-positioned corner overlays
 * independent of either.
 *
 * `data-canvas-well` -- a plain marker attribute, not a role/label: this
 * box has no semantic meaning of its own (its content does), it just needs
 * to be findable as "the one shared ancestor" in tests.
 */
export function CanvasWell({ center, children }: CanvasWellProps): React.JSX.Element {
	return (
		<div data-canvas-well data-testid="canvas-well" className={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--app-corner-radius,16px)]", WELL_BG)}>
			{/* items-start, not items-center: the Carousel's own pill sits above its "Window N" caption, making that slot taller than a bare Notifications/clock pill -- centering would misalign the pills themselves against each other. */}
			<div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-start gap-2 p-2">
				<div className="justify-self-start">
					<NotificationsPill />
				</div>
				{center && (
					<div data-testid="canvas-well-center" className="justify-self-center">
						{center}
					</div>
				)}
				<div className="col-start-3 justify-self-end">
					<WatchPill />
				</div>
			</div>
			{children}
		</div>
	);
}
