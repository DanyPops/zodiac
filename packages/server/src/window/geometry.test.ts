import { describe, expect, it } from "vitest";
import { surfaceId } from "@zodiac/protocol";
import { computeTileRects, MAX_PLACEMENTS } from "./geometry.js";
import type { SurfaceTile } from "./tile.js";

/**
 * Walking-skeleton story 6, geometry half: computeTileRects walks a tile
 * tree exactly once and returns a bounded, deterministic list of
 * SurfacePlacements. It never calls a renderer -- Web and the TUI both
 * consume the same placement list without recalculating tiling themselves.
 */
describe("computeTileRects", () => {
	it("places a single leaf across the whole area", () => {
		const tile: SurfaceTile = { kind: "leaf", surfaceId: surfaceId("s1") };

		const result = computeTileRects(tile, { x: 0, y: 0, width: 100, height: 40 });

		expect(result).toEqual({ ok: true, value: [{ surfaceId: surfaceId("s1"), rect: { x: 0, y: 0, width: 100, height: 40 } }] });
	});

	it("null (empty Window) projects to an empty, still-bounded placement list", () => {
		expect(computeTileRects(null, { x: 0, y: 0, width: 100, height: 40 })).toEqual({ ok: true, value: [] });
	});

	it("splits a row of two equal fill children evenly along width, full height", () => {
		const tile: SurfaceTile = {
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("s1") }, constraint: { kind: "fill", weight: 1 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("s2") }, constraint: { kind: "fill", weight: 1 } },
			],
		};

		const result = computeTileRects(tile, { x: 0, y: 0, width: 100, height: 40 });

		expect(result).toEqual({
			ok: true,
			value: [
				{ surfaceId: surfaceId("s1"), rect: { x: 0, y: 0, width: 50, height: 40 } },
				{ surfaceId: surfaceId("s2"), rect: { x: 50, y: 0, width: 50, height: 40 } },
			],
		});
	});

	it("splits a col of two equal fill children evenly along height, full width", () => {
		const tile: SurfaceTile = {
			kind: "col",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("top") }, constraint: { kind: "fill", weight: 1 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("bottom") }, constraint: { kind: "fill", weight: 1 } },
			],
		};

		const result = computeTileRects(tile, { x: 0, y: 0, width: 80, height: 20 });

		expect(result).toEqual({
			ok: true,
			value: [
				{ surfaceId: surfaceId("top"), rect: { x: 0, y: 0, width: 80, height: 10 } },
				{ surfaceId: surfaceId("bottom"), rect: { x: 0, y: 10, width: 80, height: 10 } },
			],
		});
	});

	it("weights fill children proportionally", () => {
		const tile: SurfaceTile = {
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("s1") }, constraint: { kind: "fill", weight: 1 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("s2") }, constraint: { kind: "fill", weight: 2 } },
			],
		};

		const result = computeTileRects(tile, { x: 0, y: 0, width: 90, height: 10 });

		expect(result).toEqual({
			ok: true,
			value: [
				{ surfaceId: surfaceId("s1"), rect: { x: 0, y: 0, width: 30, height: 10 } },
				{ surfaceId: surfaceId("s2"), rect: { x: 30, y: 0, width: 60, height: 10 } },
			],
		});
	});

	it("resolves length, percentage, and ratio constraints against the parent's own axis size", () => {
		const tile: SurfaceTile = {
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("fixed") }, constraint: { kind: "length", value: 20 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("pct") }, constraint: { kind: "percentage", value: 50 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("ratio") }, constraint: { kind: "ratio", numerator: 3, denominator: 10 } },
			],
		};

		const result = computeTileRects(tile, { x: 0, y: 0, width: 100, height: 10 });

		expect(result).toEqual({
			ok: true,
			value: [
				{ surfaceId: surfaceId("fixed"), rect: { x: 0, y: 0, width: 20, height: 10 } },
				{ surfaceId: surfaceId("pct"), rect: { x: 20, y: 0, width: 50, height: 10 } },
				{ surfaceId: surfaceId("ratio"), rect: { x: 70, y: 0, width: 30, height: 10 } },
			],
		});
	});

	it("leaves remaining space uncovered when there is no fill constraint to claim it", () => {
		const tile: SurfaceTile = {
			kind: "row",
			children: [{ tile: { kind: "leaf", surfaceId: surfaceId("s1") }, constraint: { kind: "length", value: 30 } }],
		};

		const result = computeTileRects(tile, { x: 0, y: 0, width: 100, height: 10 });

		expect(result).toEqual({ ok: true, value: [{ surfaceId: surfaceId("s1"), rect: { x: 0, y: 0, width: 30, height: 10 } }] });
	});

	it("clamps a fill's proportional share up to its own min floor, and borrows the shortfall from the other flexible siblings so the row still sums exactly to the parent's width", () => {
		const tile: SurfaceTile = {
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("floor") }, constraint: { kind: "min", value: 70 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("rest") }, constraint: { kind: "fill", weight: 1 } },
			],
		};

		const result = computeTileRects(tile, { x: 0, y: 0, width: 100, height: 10 });

		expect(result).toEqual({
			ok: true,
			value: [
				{ surfaceId: surfaceId("floor"), rect: { x: 0, y: 0, width: 70, height: 10 } },
				{ surfaceId: surfaceId("rest"), rect: { x: 70, y: 0, width: 30, height: 10 } },
			],
		});
	});

	it("clamps a fill's proportional share down to its own max ceiling, and hands the freed-up space to the other flexible siblings", () => {
		const tile: SurfaceTile = {
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("capped") }, constraint: { kind: "max", value: 10 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("rest") }, constraint: { kind: "fill", weight: 1 } },
			],
		};

		const result = computeTileRects(tile, { x: 0, y: 0, width: 100, height: 10 });

		expect(result).toEqual({
			ok: true,
			value: [
				{ surfaceId: surfaceId("capped"), rect: { x: 0, y: 0, width: 10, height: 10 } },
				{ surfaceId: surfaceId("rest"), rect: { x: 10, y: 0, width: 90, height: 10 } },
			],
		});
	});

	it("recurses through nested row-in-col placements deterministically", () => {
		const tile: SurfaceTile = {
			kind: "col",
			children: [
				{
					tile: { kind: "row", children: [
						{ tile: { kind: "leaf", surfaceId: surfaceId("a") }, constraint: { kind: "fill", weight: 1 } },
						{ tile: { kind: "leaf", surfaceId: surfaceId("b") }, constraint: { kind: "fill", weight: 1 } },
					] },
					constraint: { kind: "fill", weight: 1 },
				},
				{ tile: { kind: "leaf", surfaceId: surfaceId("c") }, constraint: { kind: "fill", weight: 1 } },
			],
		};

		const result = computeTileRects(tile, { x: 0, y: 0, width: 40, height: 20 });

		expect(result).toEqual({
			ok: true,
			value: [
				{ surfaceId: surfaceId("a"), rect: { x: 0, y: 0, width: 20, height: 10 } },
				{ surfaceId: surfaceId("b"), rect: { x: 20, y: 0, width: 20, height: 10 } },
				{ surfaceId: surfaceId("c"), rect: { x: 0, y: 10, width: 40, height: 10 } },
			],
		});
	});

	it("offsets correctly for a non-origin area", () => {
		const tile: SurfaceTile = {
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("s1") }, constraint: { kind: "fill", weight: 1 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("s2") }, constraint: { kind: "fill", weight: 1 } },
			],
		};

		const result = computeTileRects(tile, { x: 10, y: 5, width: 20, height: 6 });

		expect(result).toEqual({
			ok: true,
			value: [
				{ surfaceId: surfaceId("s1"), rect: { x: 10, y: 5, width: 10, height: 6 } },
				{ surfaceId: surfaceId("s2"), rect: { x: 20, y: 5, width: 10, height: 6 } },
			],
		});
	});

	it("recomputes deterministically and independently across a resize -- no stale caching between calls", () => {
		const tile: SurfaceTile = {
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("s1") }, constraint: { kind: "fill", weight: 1 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("s2") }, constraint: { kind: "fill", weight: 1 } },
			],
		};

		const before = computeTileRects(tile, { x: 0, y: 0, width: 100, height: 10 });
		const after = computeTileRects(tile, { x: 0, y: 0, width: 40, height: 10 });

		expect(before).toEqual({ ok: true, value: [
			{ surfaceId: surfaceId("s1"), rect: { x: 0, y: 0, width: 50, height: 10 } },
			{ surfaceId: surfaceId("s2"), rect: { x: 50, y: 0, width: 50, height: 10 } },
		] });
		expect(after).toEqual({ ok: true, value: [
			{ surfaceId: surfaceId("s1"), rect: { x: 0, y: 0, width: 20, height: 10 } },
			{ surfaceId: surfaceId("s2"), rect: { x: 20, y: 0, width: 20, height: 10 } },
		] });
	});

	it("never produces overlapping sibling rects", () => {
		const tile: SurfaceTile = {
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("s1") }, constraint: { kind: "length", value: 15 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("s2") }, constraint: { kind: "fill", weight: 1 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("s3") }, constraint: { kind: "fill", weight: 2 } },
			],
		};

		const result = computeTileRects(tile, { x: 0, y: 0, width: 90, height: 5 });
		if (!result.ok) throw new Error("expected computeTileRects to succeed");

		const rects = result.value.map((placement) => placement.rect);
		for (let i = 0; i < rects.length; i += 1) {
			for (let j = i + 1; j < rects.length; j += 1) {
				const a = rects[i]!;
				const b = rects[j]!;
				const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
				expect(overlaps).toBe(false);
			}
		}
	});

	it("returns a typed failure when fixed constraints alone (length/percentage/ratio) overflow the available area", () => {
		const tile: SurfaceTile = {
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: surfaceId("s1") }, constraint: { kind: "length", value: 60 } },
				{ tile: { kind: "leaf", surfaceId: surfaceId("s2") }, constraint: { kind: "length", value: 60 } },
			],
		};

		const result = computeTileRects(tile, { x: 0, y: 0, width: 100, height: 10 });

		expect(result).toEqual({ ok: false, reason: "insufficient-area", required: 120, available: 100 });
	});

	it("returns a typed failure for an invalid (non-positive) area", () => {
		const tile: SurfaceTile = { kind: "leaf", surfaceId: surfaceId("s1") };

		expect(computeTileRects(tile, { x: 0, y: 0, width: 0, height: 10 })).toEqual({ ok: false, reason: "invalid-area", width: 0, height: 10 });
		expect(computeTileRects(tile, { x: 0, y: 0, width: 10, height: -1 })).toEqual({ ok: false, reason: "invalid-area", width: 10, height: -1 });
	});

	it("returns a typed failure instead of walking an arbitrarily large tree past the placement bound", () => {
		const tile = buildBalancedBinaryTile(MAX_PLACEMENTS + 1);

		const result = computeTileRects(tile, { x: 0, y: 0, width: 1000, height: 100 });

		expect(result).toEqual({ ok: false, reason: "too-many-placements", limit: MAX_PLACEMENTS });
	});
});

/** Builds a balanced binary SurfaceTile (exactly 2 children per row) with `leafCount` leaves -- used to exercise the placement-count bound independent of any single node's own child count. */
function buildBalancedBinaryTile(leafCount: number): SurfaceTile {
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
