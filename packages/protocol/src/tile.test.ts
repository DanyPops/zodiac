import { describe, expect, it } from "vitest";
import { MAX_CHILDREN_PER_TILE, SurfaceTileSchema } from "./tile.js";
import { surfaceId } from "./ids.js";

describe("SurfaceTileSchema", () => {
	it("parses a single leaf tile", () => {
		const parsed = SurfaceTileSchema.safeParse({ kind: "leaf", surfaceId: "surface-1" });
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(parsed.data).toEqual({ kind: "leaf", surfaceId: surfaceId("surface-1") });
	});

	it("parses a nested row of leaves, recursively", () => {
		const tile = {
			kind: "row",
			children: [
				{ tile: { kind: "leaf", surfaceId: "a" }, constraint: { kind: "fill", weight: 1 } },
				{ tile: { kind: "col", children: [{ tile: { kind: "leaf", surfaceId: "b" }, constraint: { kind: "fill", weight: 1 } }] }, constraint: { kind: "length", value: 20 } },
			],
		};
		const parsed = SurfaceTileSchema.safeParse(tile);
		expect(parsed.success).toBe(true);
	});

	it("rejects a kind outside the closed union", () => {
		expect(SurfaceTileSchema.safeParse({ kind: "stack", children: [] }).success).toBe(false);
	});

	it("rejects a leaf missing its surfaceId", () => {
		expect(SurfaceTileSchema.safeParse({ kind: "leaf" }).success).toBe(false);
	});

	it("rejects a row/col exceeding MAX_CHILDREN_PER_TILE", () => {
		const tooMany = Array.from({ length: MAX_CHILDREN_PER_TILE + 1 }, (_, index) => ({
			tile: { kind: "leaf", surfaceId: `s${index}` },
			constraint: { kind: "fill", weight: 1 },
		}));
		expect(SurfaceTileSchema.safeParse({ kind: "row", children: tooMany }).success).toBe(false);
	});

	it("rejects an unrecognized constraint kind on a child", () => {
		const tile = { kind: "row", children: [{ tile: { kind: "leaf", surfaceId: "a" }, constraint: { kind: "stretch", weight: 1 } }] };
		expect(SurfaceTileSchema.safeParse(tile).success).toBe(false);
	});
});
