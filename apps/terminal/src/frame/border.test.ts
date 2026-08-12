import { layoutWorldRegions, type Region } from "@alignment/protocol";
import { describe, expect, it } from "vitest";
import { deriveBorderTopology, labelSegment, paintBorders } from "./border.js";
import { createGridFrame, createRect, gridId, type GridFrame } from "./index.js";

const EMPTY_WORLD = { state: "empty" as const, workspaces: [] as const, activeWorkspaceId: null };

function regionsAt(width: number, height: number): readonly Region[] {
  const layout = layoutWorldRegions(EMPTY_WORLD, width, height);
  if (!layout.ok) throw new Error(layout.issues.join("; "));
  return layout.value;
}

function cellAt(frame: GridFrame, x: number, y: number): string {
  return frame.cells[y * frame.width + x]!.grapheme;
}

describe("deriveBorderTopology", () => {
  it.each([[60, 16], [80, 24], [120, 40], [52, 8]])("derives contiguous shared-line coordinates at %ix%i", (width, height) => {
    const topology = deriveBorderTopology(regionsAt(width, height), width, height);
    expect(topology.ok).toBe(true);
    if (!topology.ok) return;
    const t = topology.value;
    expect(t.verticalOuterLeft).toBe(0);
    expect(t.verticalOuterRight).toBe(width - 1);
    expect(t.horizontalTop).toBe(0);
    expect(t.horizontalBottom).toBe(height - 1);
    expect(t.verticalLeftSplit).toBeLessThan(t.verticalRightSplit);
    expect(t.contentTop).toBe(1);
    expect(t.contentBottom).toBe(t.horizontalFooterSeparator - 1);
  });

  it("fails closed when a required region is missing", () => {
    const withoutFooter = regionsAt(60, 16).filter(region => region.kind !== "footer");
    expect(deriveBorderTopology(withoutFooter, 60, 16)).toMatchObject({ ok: false, error: { code: "invalid-rect" } });
  });

  it("fails closed when regions no longer tile the viewport contiguously", () => {
    const perturbed = regionsAt(60, 16).map(region =>
      region.kind === "body" ? { ...region, rect: { ...region.rect, x: region.rect.x + 1 } } : region,
    );
    expect(deriveBorderTopology(perturbed, 60, 16)).toMatchObject({ ok: false, error: { code: "invalid-rect" } });
  });
});

describe("paintBorders junction topology", () => {
  it.each([[60, 16], [80, 24], [120, 40]])("paints correct corner and junction glyphs at %ix%i", (width, height) => {
    const regions = regionsAt(width, height);
    const topology = deriveBorderTopology(regions, width, height);
    expect(topology.ok).toBe(true);
    if (!topology.ok) return;
    const t = topology.value;
    const frame = createGridFrame(gridId("border-test"), width, height);
    expect(frame.ok).toBe(true);
    if (!frame.ok) return;
    const painted = paintBorders(frame.value, t, width, height, "body", { base: {}, active: { bold: true } });
    expect(painted.ok).toBe(true);

    expect(cellAt(frame.value, t.verticalOuterLeft, t.horizontalTop)).toBe("┌");
    expect(cellAt(frame.value, t.verticalOuterRight, t.horizontalTop)).toBe("┐");
    expect(cellAt(frame.value, t.verticalOuterLeft, t.horizontalBottom)).toBe("└");
    expect(cellAt(frame.value, t.verticalOuterRight, t.horizontalBottom)).toBe("┘");
    expect(cellAt(frame.value, t.verticalLeftSplit, t.horizontalTop)).toBe("┬");
    expect(cellAt(frame.value, t.verticalRightSplit, t.horizontalTop)).toBe("┬");
    expect(cellAt(frame.value, t.verticalLeftSplit, t.horizontalFooterSeparator)).toBe("┴");
    expect(cellAt(frame.value, t.verticalRightSplit, t.horizontalFooterSeparator)).toBe("┴");
    expect(cellAt(frame.value, t.verticalOuterLeft, t.horizontalFooterSeparator)).toBe("├");
    expect(cellAt(frame.value, t.verticalOuterRight, t.horizontalFooterSeparator)).toBe("┤");
    // Split columns never continue past the footer separator -- a plain line, not a junction.
    expect(cellAt(frame.value, t.verticalLeftSplit, t.horizontalBottom)).toBe("─");
    expect(cellAt(frame.value, t.verticalRightSplit, t.horizontalBottom)).toBe("─");
    // A plain interior stretch of each line is a straight glyph, never doubled.
    expect(cellAt(frame.value, Math.floor(width / 2), t.horizontalTop)).toBe("─");
    expect(cellAt(frame.value, t.verticalOuterLeft, t.contentTop + 1)).toBe("│");
  });

  it("re-styles only the focused region's own perimeter without changing any glyph", () => {
    const width = 80;
    const height = 24;
    const regions = regionsAt(width, height);
    const topology = deriveBorderTopology(regions, width, height);
    expect(topology.ok).toBe(true);
    if (!topology.ok) return;
    const t = topology.value;
    const base = { foreground: 1 };
    const active = { foreground: 1, bold: true };

    const bodyFocused = createGridFrame(gridId("focus-body"), width, height);
    const headerFocused = createGridFrame(gridId("focus-header"), width, height);
    if (!bodyFocused.ok || !headerFocused.ok) throw new Error("frame creation failed");
    expect(paintBorders(bodyFocused.value, t, width, height, "body", { base, active }).ok).toBe(true);
    expect(paintBorders(headerFocused.value, t, width, height, "header", { base, active }).ok).toBe(true);

    const topRowGlyphsMatch = Array.from({ length: width }, (_unused, x) => cellAt(bodyFocused.value, x, t.horizontalTop) === cellAt(headerFocused.value, x, t.horizontalTop));
    expect(topRowGlyphsMatch.every(Boolean)).toBe(true);

    // x=5 sits in the left pillar's own segment of the top row, outside body's highlight box.
    const headerCellIndex = t.horizontalTop * width + 5;
    expect(headerFocused.value.cells[headerCellIndex]!.style.bold).toBe(true);
    expect(bodyFocused.value.cells[headerCellIndex]!.style.bold).toBeFalsy();

    const bodySplitIndex = t.contentTop * width + t.verticalLeftSplit;
    expect(bodyFocused.value.cells[bodySplitIndex]!.style.bold).toBe(true);
    expect(headerFocused.value.cells[bodySplitIndex]!.style.bold).toBeFalsy();
  });
});

describe("labelSegment", () => {
  it("centers a label inside a bounded segment and leaves a too-narrow segment untouched", () => {
    const frame = createGridFrame(gridId("label-test"), 40, 4);
    expect(frame.ok).toBe(true);
    if (!frame.ok) return;
    const area = createRect(0, 0, 40, 4);
    expect(area.ok).toBe(true);
    if (!area.ok) return;
    expect(labelSegment(frame.value, area.value, 2, 20, 0, "Alignment", {}).ok).toBe(true);
    const rendered = frame.value.cells.slice(0, 40).map(cell => cell.grapheme).join("");
    expect(rendered).toContain("Alignment");

    expect(labelSegment(frame.value, area.value, 2, 3, 1, "Alignment", {}).ok).toBe(true);
    const untouchedRow = frame.value.cells.slice(40, 80).map(cell => cell.grapheme).join("");
    expect(untouchedRow.trim()).toBe("");
  });
});
