import type { SurfaceId } from "@zodiac/protocol";
import type { Constraint, SurfaceTile } from "./tile.js";

/**
 * Projects a Window's tile tree onto a concrete pixel/cell area, once,
 * deterministically -- the mutation/geometry split story 6 asks for. Dock
 * and undock (see ./tile.ts) never call this; a renderer (Web's CSS grid,
 * the TUI's cell frame) calls this and paints the returned rects, never
 * recalculating tiling itself.
 *
 * Constraints are ratatui-shaped: length/percentage/ratio resolve directly
 * against the parent's own axis size; min/max/fill share whatever axis
 * space remains after those are subtracted ("the pool"), proportional to
 * weight (min/max default to weight 1), then min/max are clamped and any
 * resulting shortfall/surplus is redistributed across the remaining
 * unclamped flexible siblings in one further pass -- so a row/col with at
 * least one plain `fill` always sums exactly to its own axis size. A
 * flexible set with *no* plain `fill` member and where every entry ends up
 * clamped is the one case that can leave a small, deliberately unresolved
 * gap; the walking skeleton does not need iterative constraint solving to
 * fix that, and ratatui's own algorithm accepts the same class of
 * near-miss for pathological constraint combinations.
 */

export interface Rect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface SurfacePlacement {
	readonly surfaceId: SurfaceId;
	readonly rect: Rect;
}

export interface GeometryInvalidArea {
	readonly ok: false;
	readonly reason: "invalid-area";
	readonly width: number;
	readonly height: number;
}
export interface GeometryInsufficientArea {
	readonly ok: false;
	readonly reason: "insufficient-area";
	readonly required: number;
	readonly available: number;
}
export interface GeometryTooManyPlacements {
	readonly ok: false;
	readonly reason: "too-many-placements";
	readonly limit: number;
}
export type GeometryFailure = GeometryInvalidArea | GeometryInsufficientArea | GeometryTooManyPlacements;

export type GeometryResult = { readonly ok: true; readonly value: readonly SurfacePlacement[] } | GeometryFailure;

/** Bounds the output placement list regardless of tree shape -- a defense-in-depth check independent of tile.ts's own MAX_SURFACES_PER_TILE, since this function accepts any SurfaceTile, not only ones built through insertTile. */
export const MAX_PLACEMENTS = 64;

export function computeTileRects(tile: SurfaceTile | null, area: Rect): GeometryResult {
	if (!Number.isFinite(area.width) || !Number.isFinite(area.height) || area.width <= 0 || area.height <= 0) {
		return { ok: false, reason: "invalid-area", width: area.width, height: area.height };
	}
	if (tile === null) return { ok: true, value: [] };

	const placements: SurfacePlacement[] = [];
	const failure = walk(tile, area, placements);
	if (failure) return failure;
	return { ok: true, value: placements };
}

function walk(tile: SurfaceTile, area: Rect, out: SurfacePlacement[]): GeometryFailure | undefined {
	if (out.length >= MAX_PLACEMENTS) return { ok: false, reason: "too-many-placements", limit: MAX_PLACEMENTS };

	if (tile.kind === "leaf") {
		out.push({ surfaceId: tile.surfaceId, rect: area });
		return undefined;
	}

	const axisSize = tile.kind === "row" ? area.width : area.height;
	const sized = resolveAxisSizes(
		tile.children.map((child) => child.constraint),
		axisSize,
	);
	if (!sized.ok) return sized;

	let offset = 0;
	for (const [index, child] of tile.children.entries()) {
		const size = sized.value[index]!;
		const childArea: Rect = tile.kind === "row" ? { x: area.x + offset, y: area.y, width: size, height: area.height } : { x: area.x, y: area.y + offset, width: area.width, height: size };
		const failure = walk(child.tile, childArea, out);
		if (failure) return failure;
		offset += size;
	}
	return undefined;
}

function weightOf(constraint: Constraint): number {
	return constraint.kind === "fill" ? constraint.weight : 1;
}

function assertNeverConstraintKind(kind: never): never {
	throw new Error(`Unhandled Constraint kind: ${JSON.stringify(kind)}`);
}

function resolveAxisSizes(constraints: readonly Constraint[], axisSize: number): { ok: true; value: number[] } | GeometryInsufficientArea {
	const sizes = new Array<number>(constraints.length).fill(0);
	const flexibleIndices: number[] = [];
	let fixedSum = 0;

	constraints.forEach((constraint, index) => {
		switch (constraint.kind) {
			case "length":
				sizes[index] = Math.max(0, constraint.value);
				fixedSum += sizes[index]!;
				break;
			case "percentage":
				sizes[index] = Math.round((axisSize * constraint.value) / 100);
				fixedSum += sizes[index]!;
				break;
			case "ratio":
				sizes[index] = Math.round((axisSize * constraint.numerator) / constraint.denominator);
				fixedSum += sizes[index]!;
				break;
			case "min":
			case "max":
			case "fill":
				flexibleIndices.push(index);
				break;
			default:
				assertNeverConstraintKind(constraint);
		}
	});

	if (fixedSum > axisSize) return { ok: false, reason: "insufficient-area", required: fixedSum, available: axisSize };
	if (flexibleIndices.length === 0) return { ok: true, value: sizes };

	const pool = axisSize - fixedSum;
	const totalWeight = flexibleIndices.reduce((sum, index) => sum + weightOf(constraints[index]!), 0);
	const share = new Map<number, number>();
	const clampedIndices = new Set<number>();

	for (const index of flexibleIndices) {
		const constraint = constraints[index]!;
		const raw = totalWeight > 0 ? (pool * weightOf(constraint)) / totalWeight : 0;
		if (constraint.kind === "min" && raw < constraint.value) {
			share.set(index, constraint.value);
			clampedIndices.add(index);
		} else if (constraint.kind === "max" && raw > constraint.value) {
			share.set(index, constraint.value);
			clampedIndices.add(index);
		} else {
			share.set(index, raw);
		}
	}

	const unclamped = flexibleIndices.filter((index) => !clampedIndices.has(index));
	const consumed = flexibleIndices.reduce((sum, index) => sum + share.get(index)!, 0);
	const delta = pool - consumed;

	if (unclamped.length > 0 && delta !== 0) {
		const unclampedWeight = unclamped.reduce((sum, index) => sum + weightOf(constraints[index]!), 0);
		for (const index of unclamped) {
			const portion = unclampedWeight > 0 ? (delta * weightOf(constraints[index]!)) / unclampedWeight : 0;
			share.set(index, share.get(index)! + portion);
		}
	}

	for (const index of flexibleIndices) sizes[index] = Math.round(share.get(index)!);

	// Rounding across several flexible entries can leave a 1-2 cell gap or
	// overhang vs. axisSize; absorb it into the last flexible entry (always
	// the same one, for determinism) so siblings still tile exactly.
	const roundedTotal = sizes.reduce((sum, size) => sum + size, 0);
	const lastFlexible = flexibleIndices[flexibleIndices.length - 1];
	if (lastFlexible !== undefined) sizes[lastFlexible] = sizes[lastFlexible]! + (axisSize - roundedTotal);

	return { ok: true, value: sizes };
}
