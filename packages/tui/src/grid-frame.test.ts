import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRAME_LIMITS,
  applyGridUpdate,
  createGridFrame,
  createRect,
  describeFrameMismatch,
  diffFrames,
  gridId,
  paintText,
  setCursor,
  type CellStyle,
} from "./grid-frame.js";

function frame(width = 8, height = 3) {
  const result = createGridFrame(gridId("main"), width, height);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const accent: CellStyle = { foreground: 2, background: 0, bold: true, italic: false, underline: false, dim: false, inverse: false };

describe("bounded cell-grid frame", () => {
  it("starts red: paints clipped Unicode cells and preserves display columns", () => {
    const target = frame(5, 2);
    const area = createRect(1, 0, 3, 2);
    expect(area.ok).toBe(true);
    if (!area.ok) return;

    expect(paintText(target, area.value, 0, 0, "A界e\u0301Z", accent, 0).ok).toBe(true);
    expect(target.cells[1]?.grapheme).toBe("A");
    expect(target.cells[2]?.grapheme).toBe("界");
    expect(target.cells[3]?.continuation).toBe(true);
    expect(target.cells[4]?.grapheme).toBe(" ");
  });

  it("composes overlays by z-order and a fresh frame reveals the lower layer", () => {
    const withOverlay = frame(4, 1);
    const area = createRect(0, 0, 4, 1);
    if (!area.ok) throw new Error(area.error.message);
    paintText(withOverlay, area.value, 0, 0, "base", {}, 0);
    paintText(withOverlay, area.value, 1, 0, "X", accent, 1);
    expect(withOverlay.cells.map((cell) => cell.grapheme).join("")).toBe("bXse");

    const revealed = frame(4, 1);
    paintText(revealed, area.value, 0, 0, "base", {}, 0);
    expect(revealed.cells.map((cell) => cell.grapheme).join("")).toBe("base");
  });

  it("emits ordered minimal contiguous runs, explicit clears, styles, and cursor changes", () => {
    const previous = frame();
    const next = frame();
    const area = createRect(0, 0, 8, 3);
    if (!area.ok) throw new Error(area.error.message);
    paintText(previous, area.value, 1, 0, "old", {}, 0);
    paintText(next, area.value, 1, 0, "n", accent, 0);
    paintText(next, area.value, 6, 0, "!", {}, 0);
    setCursor(next, { row: 2, column: 3, visible: true });

    const result = diffFrames(previous, next);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.full).toBe(false);
    expect(result.value.runs.map((run) => [run.row, run.startColumn, run.cells.map((cell) => cell.grapheme).join("")])).toEqual([
      [0, 1, "n  "],
      [0, 6, "!"],
    ]);
    expect(result.value.cursor).toEqual({ row: 2, column: 3, visible: true });

    const cursorOnly = frame();
    setCursor(cursorOnly, { row: 1, column: 1, visible: true });
    const cursorUpdate = diffFrames(frame(), cursorOnly);
    expect(cursorUpdate.ok && cursorUpdate.value.runs).toEqual([]);
    expect(cursorUpdate.ok && cursorUpdate.value.cursorChanged).toBe(true);
  });

  it("detects a single-cell style-only change", () => {
    const previous = frame(2, 1);
    const next = frame(2, 1);
    const area = createRect(0, 0, 2, 1);
    if (!area.ok) throw new Error(area.error.message);
    paintText(previous, area.value, 0, 0, "x", {}, 0);
    paintText(next, area.value, 0, 0, "x", accent, 0);
    const update = diffFrames(previous, next);
    expect(update.ok && update.value.runs).toMatchObject([{ row: 0, startColumn: 0, cells: [{ grapheme: "x", style: { bold: true } }] }]);
  });

  it("returns no runs for unchanged frames and fully invalidates incompatible dimensions", () => {
    const same = frame();
    const unchanged = diffFrames(same, frame());
    expect(unchanged.ok && unchanged.value.runs).toEqual([]);

    const resized = diffFrames(same, frame(3, 2));
    expect(resized.ok).toBe(true);
    if (!resized.ok) return;
    expect(resized.value.full).toBe(true);
    expect(resized.value.runs).toHaveLength(2);
    expect(resized.value.runs.every((run) => run.cells.length === 3)).toBe(true);
  });

  it("round-trips representative and bounded generated frame pairs", () => {
    for (let width = 1; width <= 9; width++) {
      for (let height = 1; height <= 4; height++) {
        const previous = frame(width, height);
        const next = frame(width, height);
        const area = createRect(0, 0, width, height);
        if (!area.ok) throw new Error(area.error.message);
        for (let row = 0; row < height; row++) {
          paintText(next, area.value, row % width, row, `${row}界`, row % 2 ? accent : {}, row % 3);
        }
        const update = diffFrames(previous, next);
        if (!update.ok) throw new Error(update.error.message);
        const applied = applyGridUpdate(previous, update.value);
        if (!applied.ok) throw new Error(applied.error.message);
        expect(applied.value).toEqual(next);
      }
    }
  });

  it("fails closed at every allocation/output cap", () => {
    expect(createGridFrame(gridId("max"), DEFAULT_FRAME_LIMITS.maxColumns, DEFAULT_FRAME_LIMITS.maxRows).ok).toBe(true);
    expect(createGridFrame(gridId("main"), DEFAULT_FRAME_LIMITS.maxColumns + 1, 1)).toMatchObject({ ok: false, error: { code: "invalid-dimensions" } });
    expect(createGridFrame(gridId("main"), 1, DEFAULT_FRAME_LIMITS.maxRows + 1)).toMatchObject({ ok: false, error: { code: "invalid-dimensions" } });

    const target = frame(4, 1);
    const area = createRect(0, 0, 4, 1);
    if (!area.ok) throw new Error(area.error.message);
    expect(paintText(target, area.value, 0, 0, "x", {}, DEFAULT_FRAME_LIMITS.maxLayers).ok).toBe(true);
    expect(paintText(target, area.value, 1, 0, "y", {}, DEFAULT_FRAME_LIMITS.maxLayers + 1)).toMatchObject({ ok: false, error: { code: "layer-cap-exceeded" } });
    expect(paintText(target, area.value, 0, 0, "x".repeat(DEFAULT_FRAME_LIMITS.maxGraphemesPerWrite), {}, 0).ok).toBe(true);
    expect(paintText(target, area.value, 0, 0, "x".repeat(DEFAULT_FRAME_LIMITS.maxGraphemesPerWrite + 1), {}, 0)).toMatchObject({ ok: false, error: { code: "grapheme-cap-exceeded" } });
  });

  it("produces actionable bounded mismatch diagnostics", () => {
    const expected = frame(3, 1);
    const actual = frame(3, 1);
    const area = createRect(0, 0, 3, 1);
    if (!area.ok) throw new Error(area.error.message);
    paintText(expected, area.value, 1, 0, "界", accent, 0);
    paintText(actual, area.value, 1, 0, "x", {}, 0);
    const message = describeFrameMismatch(expected, actual);
    expect(message).toMatch(/row=0 column=1/);
    expect(message).toMatch(/U\+754C/);
    expect(message).toMatch(/width=2/);
    expect(message).toMatch(/bold/);
    expect(message.length).toBeLessThan(2_000);
  });
});
