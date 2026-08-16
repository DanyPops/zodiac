import type { SurfaceId, Constraint, TileChild, SurfaceTile } from "@zodiac/protocol";
import { MAX_TILE_DEPTH, MAX_CHILDREN_PER_TILE, MAX_SURFACES_PER_TILE } from "@zodiac/protocol";

/**
 * Mutates a Window's docked-Surface tile tree -- kept separate from
 * WorldStore's own aggregate bookkeeping and from geometry projection
 * (./geometry.ts's computeTileRects, which turns a tile plus an area into
 * concrete rectangles). This module never imports a renderer.
 *
 * Every mutation returns a fresh tree (or null for an emptied Window);
 * every expected failure is a typed value, never a thrown exception.
 *
 * The tile/constraint types themselves live in @zodiac/protocol (see
 * tile.ts there) so a WindowViewModel can carry a live tile as
 * schema-validated data -- re-exported here for this module's existing
 * callers.
 */
export type { Constraint, TileChild, SurfaceTile };
export { MAX_TILE_DEPTH, MAX_CHILDREN_PER_TILE, MAX_SURFACES_PER_TILE };

const EVEN_FILL: Constraint = { kind: "fill", weight: 1 };

export type TileFailureReason = "duplicate-surface" | "surface-not-found" | "too-many-children" | "too-many-surfaces" | "too-deep";

export interface TileDuplicateSurface { readonly ok: false; readonly reason: "duplicate-surface"; readonly surfaceId: SurfaceId }
export interface TileSurfaceNotFound { readonly ok: false; readonly reason: "surface-not-found"; readonly surfaceId: SurfaceId }
export interface TileTooManyChildren { readonly ok: false; readonly reason: "too-many-children"; readonly limit: number }
export interface TileTooManySurfaces { readonly ok: false; readonly reason: "too-many-surfaces"; readonly limit: number }
export interface TileTooDeep { readonly ok: false; readonly reason: "too-deep"; readonly limit: number }

export type TileFailure = TileDuplicateSurface | TileSurfaceNotFound | TileTooManyChildren | TileTooManySurfaces | TileTooDeep;

export type TileResult<T> = { readonly ok: true; readonly value: T } | TileFailure;

function countSurfaces(tile: SurfaceTile | null): number {
	if (tile === null) return 0;
	if (tile.kind === "leaf") return 1;
	return tile.children.reduce((total, child) => total + countSurfaces(child.tile), 0);
}

function depthOf(tile: SurfaceTile | null): number {
	if (tile === null || tile.kind === "leaf") return 1;
	return 1 + Math.max(...tile.children.map((child) => depthOf(child.tile)));
}

function containsSurface(tile: SurfaceTile | null, target: SurfaceId): boolean {
	if (tile === null) return false;
	if (tile.kind === "leaf") return tile.surfaceId === target;
	return tile.children.some((child) => containsSurface(child.tile, target));
}

/**
 * Docks a new Surface into a Window's tile tree. An empty Window (`null`)
 * becomes a single leaf. A non-empty Window's root is wrapped (or, if the
 * root is already a row, extended) with one more evenly-weighted `fill`
 * child -- a simple, deterministic auto-tiling policy; the CommandIntent
 * that drives this (`surface.dock`) does not yet carry a split
 * direction/target, so there is nothing more specific to honor.
 */
export function insertTile(tile: SurfaceTile | null, newSurfaceId: SurfaceId): TileResult<SurfaceTile> {
	if (containsSurface(tile, newSurfaceId)) return { ok: false, reason: "duplicate-surface", surfaceId: newSurfaceId };
	if (countSurfaces(tile) >= MAX_SURFACES_PER_TILE) return { ok: false, reason: "too-many-surfaces", limit: MAX_SURFACES_PER_TILE };

	if (tile === null) return { ok: true, value: { kind: "leaf", surfaceId: newSurfaceId } };

	const newLeaf: TileChild = { tile: { kind: "leaf", surfaceId: newSurfaceId }, constraint: EVEN_FILL };

	if (tile.kind === "row") {
		if (tile.children.length >= MAX_CHILDREN_PER_TILE) return { ok: false, reason: "too-many-children", limit: MAX_CHILDREN_PER_TILE };
		return { ok: true, value: { kind: "row", children: [...tile.children, newLeaf] } };
	}

	// A leaf or a col root gets wrapped into a new 2-child row.
	return { ok: true, value: { kind: "row", children: [{ tile, constraint: EVEN_FILL }, newLeaf] } };
}

/**
 * Undocks a Surface from a Window's tile tree. Recursively collapses any
 * row/col left with a single remaining child into that child directly, so
 * the tree never accumulates degenerate single-child wrapper nodes.
 */
export function removeTile(tile: SurfaceTile | null, targetSurfaceId: SurfaceId): TileResult<SurfaceTile | null> {
	if (!containsSurface(tile, targetSurfaceId)) return { ok: false, reason: "surface-not-found", surfaceId: targetSurfaceId };

	function remove(node: SurfaceTile): SurfaceTile | null {
		if (node.kind === "leaf") return node.surfaceId === targetSurfaceId ? null : node;

		const children: TileChild[] = [];
		for (const child of node.children) {
			const removed = remove(child.tile);
			if (removed !== null) children.push({ tile: removed, constraint: child.constraint });
		}

		if (children.length === 0) return null;
		if (children.length === 1) return children[0]!.tile; // collapse a degenerate single-child parent
		return { kind: node.kind, children };
	}

	// tile is guaranteed non-null here: containsSurface(null, ...) is always false, so a true above implies tile !== null.
	return { ok: true, value: remove(tile as SurfaceTile) };
}

/** Exposed for callers (e.g. WorldStore) that need to reject a tree exceeding this workspace's own tiling bounds before projecting geometry. */
export function tileDepth(tile: SurfaceTile | null): number {
	return depthOf(tile);
}
