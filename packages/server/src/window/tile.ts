import type { SurfaceId } from "@zodiac/protocol";

/**
 * A Window's docked Surfaces as a Neovim/Pop-Shell-shaped recursive tile
 * tree -- the layout/tiling concern, kept entirely separate from
 * WorldStore's own aggregate bookkeeping (which Integration state exists
 * per Workspace) and from geometry projection (./geometry.ts's
 * computeTileRects, which turns a tile plus a pixel/cell area into
 * concrete rectangles). This module never imports a renderer.
 *
 * Every mutation returns a fresh tree (or null for an emptied Window) --
 * insertTile/removeTile never mutate their input in place -- and every
 * expected failure (a duplicate Surface, a missing Surface, an exceeded
 * bound) is a typed value, never a thrown exception, per this workspace's
 * "model expected failures as typed values" convention.
 *
 * This story deliberately does not add stack/tab nodes or a
 * layout-strategy hierarchy -- both have real prior art, but neither
 * belongs to the confirmed walking skeleton (Papyrus task
 * ab2cab7c-9d68-498b-9e2b-04f42831ee22).
 */

/** A ratatui-shaped sizing constraint for one child along its parent's tiling axis. */
export type Constraint =
	| { readonly kind: "length"; readonly value: number }
	| { readonly kind: "percentage"; readonly value: number }
	| { readonly kind: "ratio"; readonly numerator: number; readonly denominator: number }
	| { readonly kind: "min"; readonly value: number }
	| { readonly kind: "max"; readonly value: number }
	| { readonly kind: "fill"; readonly weight: number };

/** One child slot of a row/col tile: the nested tile plus how much of the parent's axis it claims. */
export interface TileChild {
	readonly tile: SurfaceTile;
	readonly constraint: Constraint;
}

/** A Window's tiling tree: a single docked Surface, or a row/col split of two or more weighted children. */
export type SurfaceTile = { readonly kind: "leaf"; readonly surfaceId: SurfaceId } | { readonly kind: "row" | "col"; readonly children: readonly TileChild[] };

/** How deep a tile tree may nest -- bounds recursive traversal cost (parse, geometry projection, rendering) against a pathological or adversarial dock sequence. */
export const MAX_TILE_DEPTH = 12;
/** How many direct children a single row/col node may hold. */
export const MAX_CHILDREN_PER_TILE = 16;
/** How many Surfaces one Window's whole tile tree may track in total. */
export const MAX_SURFACES_PER_TILE = 64;

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
