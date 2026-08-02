/** Every ruler offers guides at these fraction denominators -- halves through sixths, per the literal ask. */
export const DOCK_RULER_DENOMINATORS: readonly number[] = [2, 3, 4, 5, 6];

/** How close to the exact center (as a fraction of each axis, independently) the pointer must be on BOTH axes to read as "dock as a tab" instead of a sized split. Small and deliberate: dragging to a tab is still reachable, but the granular ruler owns nearly the whole pane -- click-to-dock and the keyboard TemplatesDialog flow remain the primary way to dock as a tab regardless. */
const CENTER_DEADZONE_RATIO = 0.06;

export interface DockRulerGuide {
	/** 0..1, position along the relevant axis. */
	readonly ratio: number;
	/** The reduced fraction's own label, e.g. "1/3". */
	readonly label: string;
}

function reduceFraction(numerator: number, denominator: number): readonly [number, number] {
	const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
	const divisor = gcd(numerator, denominator);
	return [numerator / divisor, denominator / divisor];
}

/** Every reduced fraction n/d for d in `denominators` and 0 < n < d, deduped by value (e.g. 2/4 collapses into 1/2), sorted ascending. */
export function dockRulerGuides(denominators: readonly number[] = DOCK_RULER_DENOMINATORS): readonly DockRulerGuide[] {
	const byKey = new Map<number, DockRulerGuide>();
	for (const denominator of denominators) {
		for (let numerator = 1; numerator < denominator; numerator++) {
			const [n, d] = reduceFraction(numerator, denominator);
			const ratio = n / d;
			const key = Math.round(ratio * 1_000_000);
			if (!byKey.has(key)) byKey.set(key, { ratio, label: `${n}/${d}` });
		}
	}
	return Array.from(byKey.values()).sort((a, b) => a.ratio - b.ratio);
}

/** The guide closest to `ratio`, clamped into [0, 1] first rather than extrapolating past the real guide set. */
export function nearestDockRulerGuide(ratio: number, guides: readonly DockRulerGuide[]): DockRulerGuide {
	const clamped = Math.min(1, Math.max(0, ratio));
	return guides.reduce((closest, guide) => (Math.abs(guide.ratio - clamped) < Math.abs(closest.ratio - clamped) ? guide : closest));
}

export type DockRulerAxis = "horizontal" | "vertical";
export type DockRulerEdge = "left" | "right" | "top" | "bottom";

export interface DockRulerHint {
	/** "horizontal" guides a left/right split (the ruler's ticks run left-to-right); "vertical" guides a top/bottom split. */
	readonly axis: DockRulerAxis;
	readonly edge: DockRulerEdge;
	readonly guide: DockRulerGuide;
}

/**
 * Which split (axis + side) the pointer currently favors within a target
 * box, plus the nearest fraction guide along that axis -- or `undefined`
 * when the pointer sits in the small dead-zone at the exact center (reads
 * as "dock as a tab", matching dockview's own center-drop zone).
 *
 * Axis selection: whichever of X/Y the pointer is more off-center on wins,
 * as a ratio of that axis's own size -- symmetric and aspect-ratio
 * independent, unlike comparing raw pixel distances across two differently
 * sized axes.
 */
export function computeDockRulerHint(offsetX: number, offsetY: number, width: number, height: number, guides: readonly DockRulerGuide[] = dockRulerGuides()): DockRulerHint | undefined {
	if (width <= 0 || height <= 0) return undefined;

	const xRatio = offsetX / width;
	const yRatio = offsetY / height;
	const xOffCenter = Math.abs(xRatio - 0.5);
	const yOffCenter = Math.abs(yRatio - 0.5);

	if (xOffCenter < CENTER_DEADZONE_RATIO && yOffCenter < CENTER_DEADZONE_RATIO) return undefined;

	if (xOffCenter >= yOffCenter) {
		return { axis: "horizontal", edge: xRatio < 0.5 ? "left" : "right", guide: nearestDockRulerGuide(xRatio, guides) };
	}
	return { axis: "vertical", edge: yRatio < 0.5 ? "top" : "bottom", guide: nearestDockRulerGuide(yRatio, guides) };
}
