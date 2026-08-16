import type { SurfaceId } from "@zodiac/protocol";
import type { Rect as PlacementRect, SurfacePlacement } from "@zodiac/server/window";
import { createRect, paintText, type CellStyle, type GridFrame, type Outcome } from "@zodiac/tui";
import { labelSegment } from "./border.js";

/**
 * Paints @zodiac/server's own computeTileRects output -- one bordered,
 * titled box per docked Surface -- into the application-owned cell frame
 * (./index.ts). Mutation (dock/undock, packages/server/src/window/tile.ts)
 * and geometry (computeTileRects, packages/server/src/window/geometry.ts)
 * are computed elsewhere; this module only paints the result. Each
 * Surface's box is clipped to exactly its own placement rect (paintText's
 * own bounds-checking against that rect), so a caller comparing two
 * successive frames via diffFrames() always gets minimal, bounded patch
 * runs confined to the Surfaces that actually changed or resized --
 * never a whole-frame or whole-row invalidation.
 *
 * Deliberately simple: no shared-junction glyphs across adjacent Surface
 * boxes the way border.ts's paintBorders does for the 5 outer regions --
 * two neighboring Surfaces' shared edge is painted twice (once by each),
 * which is harmless (idempotent, same glyph) and out of scope for this
 * story per its own "do not add a layout-strategy hierarchy" instruction.
 */
export interface SurfaceTileStyles {
	readonly border: CellStyle;
	readonly title: CellStyle;
}

function paintSurfaceBox(frame: GridFrame, rect: PlacementRect, title: string, styles: SurfaceTileStyles): Outcome<void> {
	if (rect.width <= 0 || rect.height <= 0) return { ok: true, value: undefined };
	const areaResult = createRect(rect.x, rect.y, rect.width, rect.height);
	if (!areaResult.ok) return areaResult;
	const area = areaResult.value;
	const rightColumn = rect.width - 1;
	const bottomRow = rect.height - 1;

	const topLine = "┌" + "─".repeat(Math.max(0, rect.width - 2)) + (rect.width > 1 ? "┐" : "");
	const top = paintText(frame, area, 0, 0, topLine, styles.border, 1);
	if (!top.ok) return top;

	if (rect.height > 1) {
		const bottomLine = "└" + "─".repeat(Math.max(0, rect.width - 2)) + (rect.width > 1 ? "┘" : "");
		const bottom = paintText(frame, area, 0, bottomRow, bottomLine, styles.border, 1);
		if (!bottom.ok) return bottom;
	}

	for (let y = 1; y < bottomRow; y++) {
		const left = paintText(frame, area, 0, y, "│", styles.border, 1);
		if (!left.ok) return left;
		if (rect.width > 1) {
			const right = paintText(frame, area, rightColumn, y, "│", styles.border, 1);
			if (!right.ok) return right;
		}
	}

	return labelSegment(frame, area, 1, Math.max(1, rect.width - 1), 0, title, styles.title);
}

/** Paints every current SurfacePlacement as a bordered, titled box. titleFor supplies the label for one Surface (a caller-owned lookup -- this module has no opinion on where a title comes from). */
export function paintSurfaceTiles(frame: GridFrame, placements: readonly SurfacePlacement[], titleFor: (surfaceId: SurfaceId) => string, styles: SurfaceTileStyles): Outcome<void> {
	for (const placement of placements) {
		const painted = paintSurfaceBox(frame, placement.rect, titleFor(placement.surfaceId), styles);
		if (!painted.ok) return painted;
	}
	return { ok: true, value: undefined };
}
