import { describe, expect, it } from "vitest";
import { surfaceId } from "@zodiac/protocol";
import { insertTile, removeTile, MAX_TILE_DEPTH, MAX_CHILDREN_PER_TILE, MAX_SURFACES_PER_TILE } from "./tile.js";
import type { SurfaceTile } from "./tile.js";

/**
 * Walking-skeleton story 6, tile-tree half: a Window's docked Surfaces form
 * a Neovim/Pop-Shell-shaped recursive tree, mutated only through
 * insertTile (dock) and removeTile (undock) -- never mutated in place, and
 * never touching a renderer. Geometry projection (computeTileRects) is a
 * separate concern in ./geometry.ts.
 */
describe("insertTile", () => {
	it("docking into an empty Window creates a single leaf", () => {
		const result = insertTile(null, surfaceId("s1"));
		expect(result).toEqual({ ok: true, value: { kind: "leaf", surfaceId: surfaceId("s1") } });
	});

	it("docking a second Surface wraps the existing leaf and the new leaf into a row, evenly weighted", () => {
		const first = insertTile(null, surfaceId("s1"));
		if (!first.ok) throw new Error("expected first insert to succeed");

		const result = insertTile(first.value, surfaceId("s2"));

		expect(result).toEqual({
			ok: true,
			value: {
				kind: "row",
				children: [
					{ tile: { kind: "leaf", surfaceId: surfaceId("s1") }, constraint: { kind: "fill", weight: 1 } },
					{ tile: { kind: "leaf", surfaceId: surfaceId("s2") }, constraint: { kind: "fill", weight: 1 } },
				],
			},
		});
	});

	it("docking a third Surface appends another evenly-weighted child to the existing row instead of nesting again", () => {
		let tile = unwrap(insertTile(null, surfaceId("s1")));
		tile = unwrap(insertTile(tile, surfaceId("s2")));

		const result = insertTile(tile, surfaceId("s3"));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.kind).toBe("row");
		if (result.value.kind === "leaf") return;
		expect(result.value.children.map((child) => child.tile)).toEqual([
			{ kind: "leaf", surfaceId: surfaceId("s1") },
			{ kind: "leaf", surfaceId: surfaceId("s2") },
			{ kind: "leaf", surfaceId: surfaceId("s3") },
		]);
	});

	it("rejects docking a Surface id already present anywhere in the tree", () => {
		const tile = unwrap(insertTile(null, surfaceId("s1")));

		const result = insertTile(tile, surfaceId("s1"));

		expect(result).toEqual({ ok: false, reason: "duplicate-surface", surfaceId: surfaceId("s1") });
	});

	it("rejects a dock that would exceed the maximum children of a single tile node", () => {
		let tile = insertTile(null, surfaceId("s0"));
		let current = unwrap(tile);
		for (let index = 1; index < MAX_CHILDREN_PER_TILE; index += 1) {
			current = unwrap(insertTile(current, surfaceId(`s${index}`)));
		}

		const result = insertTile(current, surfaceId("overflow"));

		expect(result).toEqual({ ok: false, reason: "too-many-children", limit: MAX_CHILDREN_PER_TILE });
	});

	it("rejects a dock that would exceed the maximum Surfaces tracked by one tile", () => {
		// Built as a balanced binary tree (2 children per node) rather than via
		// repeated flat insertTile appends, so this test exercises the total-
		// surfaces bound in isolation from the per-node children bound.
		const tile = buildBalancedBinaryTile(MAX_SURFACES_PER_TILE);

		const result = insertTile(tile, surfaceId("overflow"));

		expect(result).toEqual({ ok: false, reason: "too-many-surfaces", limit: MAX_SURFACES_PER_TILE });
	});
});

describe("removeTile", () => {
	it("undocking the only Surface in a Window empties the tile back to null", () => {
		const tile = unwrap(insertTile(null, surfaceId("s1")));

		const result = removeTile(tile, surfaceId("s1"));

		expect(result).toEqual({ ok: true, value: null });
	});

	it("undocking one of two siblings collapses the row back to the remaining leaf", () => {
		let tile = unwrap(insertTile(null, surfaceId("s1")));
		tile = unwrap(insertTile(tile, surfaceId("s2")));

		const result = removeTile(tile, surfaceId("s1"));

		expect(result).toEqual({ ok: true, value: { kind: "leaf", surfaceId: surfaceId("s2") } });
	});

	it("undocking one of three siblings leaves the row intact with the remaining two", () => {
		let tile = unwrap(insertTile(null, surfaceId("s1")));
		tile = unwrap(insertTile(tile, surfaceId("s2")));
		tile = unwrap(insertTile(tile, surfaceId("s3")));

		const result = removeTile(tile, surfaceId("s2"));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toEqual({
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("s1") }, constraint: { kind: "fill", weight: 1 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("s3") }, constraint: { kind: "fill", weight: 1 } },
			],
		});
	});

	it("recursively collapses nested single-child parents left behind by a removal", () => {
		// Build: row[ col[ leaf(a), leaf(b) ], leaf(c) ], then remove "a" and "c" in turn.
		const col = { kind: "col" as const, children: [
			{ tile: { kind: "leaf" as const, surfaceId: surfaceId("a") }, constraint: { kind: "fill" as const, weight: 1 } },
			{ tile: { kind: "leaf" as const, surfaceId: surfaceId("b") }, constraint: { kind: "fill" as const, weight: 1 } },
		] };
		const tile = { kind: "row" as const, children: [
			{ tile: col, constraint: { kind: "fill" as const, weight: 1 } },
			{ tile: { kind: "leaf" as const, surfaceId: surfaceId("c") }, constraint: { kind: "fill" as const, weight: 1 } },
		] };

		const afterRemovingA = unwrap(removeTile(tile, surfaceId("a")));
		// col collapsed to leaf(b); row now has [leaf(b), leaf(c)] -- still a row, not yet collapsible.
		expect(afterRemovingA).toEqual({
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("b") }, constraint: { kind: "fill", weight: 1 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("c") }, constraint: { kind: "fill", weight: 1 } },
			],
		});

		const afterRemovingC = removeTile(afterRemovingA, surfaceId("c"));
		// row now has only leaf(b) as a single child -- collapses all the way to that leaf.
		expect(afterRemovingC).toEqual({ ok: true, value: { kind: "leaf", surfaceId: surfaceId("b") } });
	});

	it("returns a typed failure for a Surface id absent from the tree, including an empty (null) Window", () => {
		expect(removeTile(null, surfaceId("missing"))).toEqual({ ok: false, reason: "surface-not-found", surfaceId: surfaceId("missing") });

		const tile = unwrap(insertTile(null, surfaceId("s1")));
		expect(removeTile(tile, surfaceId("missing"))).toEqual({ ok: false, reason: "surface-not-found", surfaceId: surfaceId("missing") });
	});
});

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
	if (!result.ok) throw new Error("expected an ok tile result in test setup");
	return result.value;
}

/** Builds a balanced binary SurfaceTile (exactly 2 children per row) with `leafCount` leaves, bypassing insertTile's own row-append policy -- used to exercise the total-surfaces bound independent of the per-node children bound. */
function buildBalancedBinaryTile(leafCount: number): SurfaceTile {
	if (leafCount === 1) return { kind: "leaf", surfaceId: surfaceId("bin0") };
	function build(start: number, count: number): SurfaceTile {
		if (count === 1) return { kind: "leaf", surfaceId: surfaceId(`bin${start}`) };
		const half = Math.floor(count / 2);
		return {
			kind: "row",
			children: [
				{ tile: build(start, half), constraint: { kind: "fill", weight: 1 } },
				{ tile: build(start + half, count - half), constraint: { kind: "fill", weight: 1 } },
			],
		};
	}
	return build(0, leafCount);
}
