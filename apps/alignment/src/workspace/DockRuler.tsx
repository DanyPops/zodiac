import { cn } from "../platform/cn.js";
import { dockRulerGuides, type DockRulerGuide, type DockRulerHint } from "./dock-ruler.js";

interface DockRulerProps {
	readonly width: number;
	readonly height: number;
	readonly hint: DockRulerHint;
	readonly guides?: readonly DockRulerGuide[];
}

/**
 * The granular fraction ruler shown while dragging a Surface Template over
 * an existing docked Surface -- ticks at every halves-through-sixths guide
 * (dock-ruler.ts), the nearest one highlighted and labeled, and a shaded
 * region previewing exactly how much of the pane the new split will take.
 * Pure overlay: `pointer-events-none` throughout, so it never competes with
 * the native HTML5 drag events dockview itself listens for underneath it.
 */
export function DockRuler({ width, height, hint, guides = dockRulerGuides() }: DockRulerProps): React.JSX.Element {
	const horizontal = hint.axis === "horizontal";
	const activeAxisPx = horizontal ? width * hint.guide.ratio : height * hint.guide.ratio;
	const fromStart = hint.edge === "left" || hint.edge === "top";
	const shadeStyle = horizontal
		? { top: 0, height, left: fromStart ? 0 : activeAxisPx, width: fromStart ? activeAxisPx : width - activeAxisPx }
		: { left: 0, width, top: fromStart ? 0 : activeAxisPx, height: fromStart ? activeAxisPx : height - activeAxisPx };

	return (
		<div data-testid="dock-ruler" className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
			<div data-testid="dock-ruler-shade" className="absolute bg-accent/15" style={shadeStyle} />
			{guides.map((guide) => {
				const isActive = guide.label === hint.guide.label;
				const axisPx = horizontal ? width * guide.ratio : height * guide.ratio;
				const lineStyle = horizontal ? { left: axisPx, top: 0, height } : { top: axisPx, left: 0, width };
				return (
					<div key={guide.label} data-testid="dock-ruler-tick" className={cn("absolute", horizontal ? "w-px" : "h-px", isActive ? "bg-accent" : "bg-accent/30")} style={lineStyle}>
						{isActive && (
							// horizontal (a vertical line): label sits just right of it, near the top.
							// vertical (a horizontal line): label sits just right of the edge, vertically centered on the line itself.
							<span className={cn("absolute rounded-[var(--app-corner-radius,16px)] bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white", horizontal ? "left-1 top-1" : "left-1 top-0 -translate-y-1/2")}>{guide.label}</span>
						)}
					</div>
				);
			})}
		</div>
	);
}
