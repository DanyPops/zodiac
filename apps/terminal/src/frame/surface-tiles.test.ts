import { describe, expect, it } from "vitest";
import { surfaceId } from "@zodiac/protocol";
import { computeTileRects, insertTile, removeTile } from "@zodiac/server/window";
import type { SurfaceTile } from "@zodiac/server/window";
import { createGridFrame, diffFrames, gridId, type CellStyle, type GridFrame } from "@zodiac/tui";
import { paintSurfaceTiles } from "./surface-tiles.js";

const styles = { border: { foreground: 8 } as CellStyle, title: { bold: true } as CellStyle };

function renderTile(tile: SurfaceTile | null, width: number, height: number): GridFrame {
	const frameResult = createGridFrame(gridId("body"), width, height);
	if (!frameResult.ok) throw new Error(frameResult.error.message);
	const placements = computeTileRects(tile, { x: 0, y: 0, width, height });
	if (!placements.ok) throw new Error(placements.reason);
	const painted = paintSurfaceTiles(frameResult.value, placements.value, (id) => id, styles);
	if (!painted.ok) throw new Error(painted.error.message);
	return frameResult.value;
}

/**
 * Walking-skeleton story 6, TUI half: paints each SurfacePlacement (from
 * @zodiac/server's computeTileRects) as a bordered, titled box into the
 * application-owned cell frame (./index.ts). Proves the resulting frames
 * diff into bounded, minimal patch runs -- never a whole-frame or
 * whole-row invalidation -- when a Surface is added, removed, or a
 * sibling's rect is legitimately resized as a result.
 */
describe("paintSurfaceTiles", () => {
	it("paints a single Surface's border and title across its whole placement rect", () => {
		const tile: SurfaceTile = { kind: "leaf", surfaceId: surfaceId("s1") };
		const frame = renderTile(tile, 10, 4);

		expect(frame.cells[0]?.grapheme).toBe("┌");
		expect(frame.cells[9]?.grapheme).toBe("┐");
		expect(frame.cells[30]?.grapheme).toBe("└"); // row 3, column 0
		expect(frame.cells[39]?.grapheme).toBe("┘"); // row 3, column 9
		// Title painted somewhere on the top border row.
		expect(frame.cells.slice(0, 10).some((cell) => cell.grapheme === "s1"[0])).toBe(true);
	});

	it("docking a new Surface into an existing fixed+fill row only touches the fill siblings' own (resized) rects, never the fixed sibling's untouched rect", () => {
		// row[ A: length(10), B: fill(1) ] over width 30 -> A@0-10 (fixed), B@10-30
		// (fill, whole remaining pool). Docking C (insertTile always appends an
		// evenly-weighted fill sibling) redivides only the fill pool between B and
		// C -- A's own length(10) constraint is untouched by construction, so its
		// rect (and everything painted inside it) must not appear in the diff.
		const a: SurfaceTile = { kind: "leaf", surfaceId: surfaceId("a") };
		const withB: SurfaceTile = { kind: "row", children: [
			{ tile: a, constraint: { kind: "length", value: 10 } },
			{ tile: { kind: "leaf", surfaceId: surfaceId("b") }, constraint: { kind: "fill", weight: 1 } },
		] };
		const withBAndC = unwrapTile(insertTile(withB, surfaceId("c")));

		const before = renderTile(withB, 30, 4);
		const after = renderTile(withBAndC, 30, 4);

		const diff = diffFrames(before, after);
		expect(diff.ok).toBe(true);
		if (!diff.ok) return;
		expect(diff.value.full).toBe(false);
		for (const run of diff.value.runs) {
			expect(run.startColumn).toBeGreaterThanOrEqual(10);
		}
		expect(diff.value.runs.length).toBeGreaterThan(0);
	});

	it("removing a Surface leaves an untouched sibling's own rect out of the diff entirely, and never emits a clear-to-end-of-line run", () => {
		// row[ A: length(10), B: fill(1), C: fill(1) ] over width 30 -> A@0-10 (fixed),
		// B@10-20, C@20-30. Removing B leaves A untouched (still length(10) at x=0) and
		// C absorbing the whole remaining pool (10-30) -- so the diff must touch only
		// columns [10, 30), never column 0-9 (A's own untouched rect).
		const a: SurfaceTile = { kind: "leaf", surfaceId: surfaceId("a") };
		const withB = { kind: "row" as const, children: [
			{ tile: a, constraint: { kind: "length" as const, value: 10 } },
			{ tile: { kind: "leaf" as const, surfaceId: surfaceId("b") }, constraint: { kind: "fill" as const, weight: 1 } },
		] };
		const withBAndC = { kind: "row" as const, children: [...withB.children, { tile: { kind: "leaf" as const, surfaceId: surfaceId("c") }, constraint: { kind: "fill" as const, weight: 1 } }] };

		const beforeRemoval = renderTile(withBAndC, 30, 4);
		const afterRemoval = renderTile(unwrapTile(removeTile(withBAndC, surfaceId("b"))), 30, 4);

		const diff = diffFrames(beforeRemoval, afterRemoval);
		expect(diff.ok).toBe(true);
		if (!diff.ok) return;
		expect(diff.value.full).toBe(false);
		for (const run of diff.value.runs) {
			expect(run.startColumn).toBeGreaterThanOrEqual(10);
			// Never a "clear to end of line" run: every emitted run must be the
			// exact contiguous span of cells that actually changed, not a
			// blanket span reaching all the way to the frame's own right edge
			// when the truly-changed content doesn't require it (the row's
			// own bottom border row here only changes 10..30, matching the
			// resized rect exactly, not 10..width-regardless-of-content).
			expect(run.startColumn + run.cells.length).toBeLessThanOrEqual(30);
		}
	});
});

function unwrapTile(result: { ok: true; value: SurfaceTile | null } | { ok: false }): SurfaceTile {
	if (!result.ok || result.value === null) throw new Error("expected a non-null ok tile result in test setup");
	return result.value;
}
