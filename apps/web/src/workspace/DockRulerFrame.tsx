import type { CSSProperties } from "react";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "../platform/surface-style.js";
import { dockRulerGuides, type DockRulerFrameMark, type DockRulerGuide } from "./dock-ruler.js";
import { PROXIMITY_CEILING_OPACITY, PROXIMITY_FLOOR_OPACITY } from "./proximity-zones.js";

// Reference ticks share the proximity zones' own floor/ceiling and
// animate-zone-breathe rhythm -- one ambient/passive visual family, not a
// second one. Only the live mark + label pill stays accent-colored (see
// RulerBar below): the one precise, confirmed "drop now" signal against an
// otherwise neutral field.
const AMBIENT_TICK_STYLE: CSSProperties & Record<string, string | number> = { "--zone-min-opacity": PROXIMITY_FLOOR_OPACITY, "--zone-max-opacity": PROXIMITY_CEILING_OPACITY };

// Thick enough to read tick labels comfortably; thin enough to still sit in
// the existing gutter between the dock canvas and its neighboring chrome
// (Pillars/Carousel/Chat) without feeling like its own extra layout region --
// this is an overlay, appearing only for a drag's duration, not reserved space.
const RULER_THICKNESS_PX = 28;

export interface DockRulerFrameBox {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

interface DockRulerFrameProps {
	readonly visible: boolean;
	readonly box: DockRulerFrameBox | undefined;
	readonly mark: DockRulerFrameMark | undefined;
	readonly guides?: readonly DockRulerGuide[];
}

interface RulerBarProps {
	readonly orientation: "horizontal" | "vertical";
	readonly length: number;
	readonly guides: readonly DockRulerGuide[];
	readonly markOffset: number | undefined;
	readonly markLabel: string | undefined;
	readonly style: React.CSSProperties;
}

/** One ruler bar: a strip of every guide's reference tick, plus (only on whichever axis is currently favored) one live highlighted mark at the real split position -- which may fall between the generic reference ticks for a nested sub-group's own fraction (see dockRulerFrameMark). */
function RulerBar({ orientation, length, guides, markOffset, markLabel, style }: RulerBarProps): React.JSX.Element {
	const horizontal = orientation === "horizontal";
	return (
		<div data-testid="dock-ruler-bar" className={cn("pointer-events-none fixed", SURFACE_BG, horizontal ? "border-y" : "border-x", "border-gray-500/40 dark:border-gray-400/40")} style={style}>
			{guides.map((guide) => {
				const offset = guide.ratio * length;
				return (
					<span
						key={guide.label}
						className={cn("absolute animate-zone-breathe bg-gray-500 motion-reduce:animate-none dark:bg-gray-400", horizontal ? "top-1/2 h-2 w-px -translate-y-1/2" : "left-1/2 h-px w-2 -translate-x-1/2")}
						style={{ ...(horizontal ? { left: offset } : { top: offset }), ...AMBIENT_TICK_STYLE, opacity: PROXIMITY_CEILING_OPACITY }}
					/>
				);
			})}
			{markOffset !== undefined && (
				<>
					<span data-testid="dock-ruler-mark" className={cn("absolute bg-accent", horizontal ? "top-0 h-full w-0.5" : "left-0 h-0.5 w-full")} style={horizontal ? { left: markOffset } : { top: markOffset }} />
					<span
						className={cn("absolute whitespace-nowrap rounded-[var(--app-corner-radius,16px)] bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white", horizontal ? "top-full mt-0.5 -translate-x-1/2" : "left-full ml-0.5 -translate-y-1/2")}
						style={horizontal ? { left: markOffset } : { top: markOffset }}
					>
						{markLabel}
					</span>
				</>
			)}
		</div>
	);
}

/**
 * The Dock Ruler's own frame: two horizontal bars (above and below the dock
 * canvas) and two vertical bars (left and right of it), wrapping the whole
 * canvas in the gutter toward its surrounding chrome (Workspace Selection /
 * Surface Templates pillars, the Window Carousel, Chat) -- not drawn over
 * the docked content itself, unlike the in-content DockRuler shade.
 *
 * Visible for a template drag's entire duration (dragstart to
 * drop/dragend), independent of pointer position -- only the axis the
 * pointer currently favors gets a highlighted live mark; the other pair of
 * bars still shows its plain reference ticks.
 */
export function DockRulerFrame({ visible, box, mark, guides = dockRulerGuides() }: DockRulerFrameProps): React.JSX.Element | null {
	if (!visible || !box) return null;

	const horizontalMarkOffset = mark?.axis === "horizontal" ? mark.position - box.left : undefined;
	const verticalMarkOffset = mark?.axis === "vertical" ? mark.position - box.top : undefined;

	return (
		// pointer-events-none on the WRAPPER itself, not just its bar children --
		// this spans the whole viewport (fixed inset-0) to host four small bars
		// positioned around the canvas's own edges, but even with no visible
		// content of its own over the canvas interior, an element's own box still
		// participates in hit-testing unless it opts out. Without this, the
		// wrapper -- not the dockview content beneath it -- was the real target
		// document.elementFromPoint (and, in a real browser, every dragover/drop)
		// resolved to for the whole drag's duration, silently swallowing every
		// drop onto the canvas underneath it.
		<div data-testid="dock-ruler" className="pointer-events-none fixed inset-0 z-40">
			<RulerBar orientation="horizontal" length={box.width} guides={guides} markOffset={horizontalMarkOffset} markLabel={mark?.label} style={{ left: box.left, top: box.top - RULER_THICKNESS_PX, width: box.width, height: RULER_THICKNESS_PX }} />
			<RulerBar orientation="horizontal" length={box.width} guides={guides} markOffset={horizontalMarkOffset} markLabel={mark?.label} style={{ left: box.left, top: box.top + box.height, width: box.width, height: RULER_THICKNESS_PX }} />
			<RulerBar orientation="vertical" length={box.height} guides={guides} markOffset={verticalMarkOffset} markLabel={mark?.label} style={{ top: box.top, left: box.left - RULER_THICKNESS_PX, width: RULER_THICKNESS_PX, height: box.height }} />
			<RulerBar orientation="vertical" length={box.height} guides={guides} markOffset={verticalMarkOffset} markLabel={mark?.label} style={{ top: box.top, left: box.left + box.width, width: RULER_THICKNESS_PX, height: box.height }} />
		</div>
	);
}
