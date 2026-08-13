/** Every ruler offers guides at these fraction denominators -- halves through sixths, per the literal ask. */
export const DOCK_RULER_DENOMINATORS: readonly number[] = [2, 3, 4, 5, 6];

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
 * box, plus the nearest fraction guide along that axis. Always resolves to
 * a real split, even at the exact center (a deterministic tie-break, not a
 * "dock as a tab" dead-zone) -- tab-insertion via drag is reached by
 * dropping onto a group's own header/tab-strip instead, a structurally
 * different dockview drop target (`onWillShowOverlay`'s own `kind` is
 * `'tab'`/`'header_space'` there, never `'content'`) this function never
 * sees. `undefined` only for a degenerate (zero-sized) target.
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

	if (xOffCenter >= yOffCenter) {
		return { axis: "horizontal", edge: xRatio < 0.5 ? "left" : "right", guide: nearestDockRulerGuide(xRatio, guides) };
	}
	return { axis: "vertical", edge: yRatio < 0.5 ? "top" : "bottom", guide: nearestDockRulerGuide(yRatio, guides) };
}

interface DockRulerTargetBox {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export interface DockRulerRect {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/** The exact rectangle a hint's own split preview covers within a `width` x `height` target -- e.g. docking left at 1/4 covers the left quarter, full height. Shared by the in-content DockRuler shade and anything else that needs the same live-fraction geometry, so they can never disagree with each other. */
export function dockRulerHintRect(hint: DockRulerHint, width: number, height: number): DockRulerRect {
	const horizontal = hint.axis === "horizontal";
	const activeAxisPx = horizontal ? width * hint.guide.ratio : height * hint.guide.ratio;
	const fromStart = hint.edge === "left" || hint.edge === "top";
	return horizontal
		? { top: 0, height, left: fromStart ? 0 : activeAxisPx, width: fromStart ? activeAxisPx : width - activeAxisPx }
		: { left: 0, width, top: fromStart ? 0 : activeAxisPx, height: fromStart ? activeAxisPx : height - activeAxisPx };
}

export interface DockRulerFrameMark {
	readonly axis: DockRulerAxis;
	/** Absolute page-space coordinate (an X for "horizontal", a Y for "vertical") of the live split point. */
	readonly position: number;
	readonly label: string;
}

/**
 * Converts a hint computed relative to one drop target's own box (a nested
 * split's sub-group, most of the time the same box as the whole dock
 * canvas) into an absolute page-space mark. The DockRulerFrame renders
 * around the *whole* canvas, not any one group inside it, so it needs a
 * real page coordinate to place the live marker correctly -- one that can
 * legitimately fall between the frame's own generic canvas-wide reference
 * ticks when the target is a nested sub-group rather than the whole canvas.
 */
export function dockRulerFrameMark(hint: DockRulerHint, targetBox: DockRulerTargetBox): DockRulerFrameMark {
	if (hint.axis === "horizontal") return { axis: "horizontal", position: targetBox.left + hint.guide.ratio * targetBox.width, label: hint.guide.label };
	return { axis: "vertical", position: targetBox.top + hint.guide.ratio * targetBox.height, label: hint.guide.label };
}
