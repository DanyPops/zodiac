import { z } from "zod";
import { SurfaceIdSchema, type SurfaceId } from "./ids.js";

/**
 * A Window's docked Surfaces as a recursive tile tree: a single Surface, or
 * a row/col split of weighted children. Lives here (not in
 * packages/server/src/window/tile.ts, which owns the mutation logic) so a
 * WindowViewModel can carry a live tile as plain, schema-validated data.
 * packages/server/src/window/tile.ts re-exports these exact types instead
 * of redefining them.
 */

/** How one child sizes itself along its parent's tiling axis. */
export type Constraint =
	| { readonly kind: "length"; readonly value: number }
	| { readonly kind: "percentage"; readonly value: number }
	| { readonly kind: "ratio"; readonly numerator: number; readonly denominator: number }
	| { readonly kind: "min"; readonly value: number }
	| { readonly kind: "max"; readonly value: number }
	| { readonly kind: "fill"; readonly weight: number };

export const ConstraintSchema: z.ZodType<Constraint> = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("length"), value: z.number().finite() }),
	z.object({ kind: z.literal("percentage"), value: z.number().finite() }),
	z.object({ kind: z.literal("ratio"), numerator: z.number().finite(), denominator: z.number().finite() }),
	z.object({ kind: z.literal("min"), value: z.number().finite() }),
	z.object({ kind: z.literal("max"), value: z.number().finite() }),
	z.object({ kind: z.literal("fill"), weight: z.number().finite() }),
]);

/** How deep a tile tree may nest. */
export const MAX_TILE_DEPTH = 12;
/** How many direct children a single row/col node may hold. */
export const MAX_CHILDREN_PER_TILE = 16;
/** How many Surfaces one Window's whole tile tree may track in total. */
export const MAX_SURFACES_PER_TILE = 64;

/** One child slot of a row/col tile: the nested tile plus how much of the parent's axis it claims. */
export interface TileChild {
	readonly tile: SurfaceTile;
	readonly constraint: Constraint;
}

/** A Window's tiling tree: a single docked Surface, or a row/col split of one or more weighted children. */
export type SurfaceTile = { readonly kind: "leaf"; readonly surfaceId: SurfaceId } | { readonly kind: "row" | "col"; readonly children: readonly TileChild[] };

function splitSchema(kind: "row" | "col") {
	return z.object({
		kind: z.literal(kind),
		children: z
			.array(z.object({ tile: z.lazy(() => SurfaceTileSchema), constraint: ConstraintSchema }))
			.min(1)
			.max(MAX_CHILDREN_PER_TILE),
	});
}

// "row" and "col" are two separate discriminated-union members here (z.discriminatedUnion needs one literal per member), even though SurfaceTile's own TS type combines them into one arm.
export const SurfaceTileSchema: z.ZodType<SurfaceTile> = z.lazy(() =>
	z.discriminatedUnion("kind", [z.object({ kind: z.literal("leaf"), surfaceId: SurfaceIdSchema }), splitSchema("row"), splitSchema("col")]),
);
