import { renderToTerminal } from "@danypops/pi-tui-harness";
import { describe, expect, it } from "vitest";
import { createGridFrame, createRect, diffFrames, gridId, paintText, setCursor, type FrameLimits } from "../frame/index.js";
import { describeTerminalMismatch, encodeGridUpdate, GridTerminal } from "./grid-terminal.js";

const tinyLimits: FrameLimits = {
  maxRows: 4,
  maxColumns: 10,
  maxCells: 40,
  maxLayers: 2,
  maxPatches: 10,
  maxGraphemesPerWrite: 20,
  maxEncodedBytes: 2_000,
};

function frame(width = 6, height = 2, limits = tinyLimits) {
  const result = createGridFrame(gridId("terminal"), width, height, limits);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("GridTerminal", () => {
  it("applies full and incremental updates only through Pi's public Terminal.write boundary", () => {
    const writes: string[] = [];
    const terminal = new GridTerminal({ write: (data) => writes.push(data) });
    const first = frame();
    const area = createRect(0, 0, 6, 2);
    if (!area.ok) throw new Error(area.error.message);
    paintText(first, area.value, 0, 0, "first", {}, 0);
    expect(terminal.render(first)).toMatchObject({ ok: true, value: { full: true } });

    const second = frame();
    paintText(second, area.value, 0, 0, "first", {}, 0);
    paintText(second, area.value, 5, 1, "!", { bold: true, foreground: 2 }, 0);
    expect(terminal.render(second)).toMatchObject({ ok: true, value: { full: false, runs: [{ row: 1, startColumn: 5 }] } });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toContain("\x1b[2;6H");
  });

  it("is interpreted by a real headless VT as semantic Unicode cells and styles", async () => {
    const next = frame();
    const area = createRect(0, 0, 6, 2);
    if (!area.ok) throw new Error(area.error.message);
    paintText(next, area.value, 0, 0, "A界", { bold: true, foreground: 2 }, 0);
    paintText(next, area.value, 0, 1, "clear", {}, 0);
    setCursor(next, { row: 1, column: 5, visible: true });
    const update = diffFrames(undefined, next);
    if (!update.ok) throw new Error(update.error.message);
    const encoded = encodeGridUpdate(update.value);
    if (!encoded.ok) throw new Error(encoded.error.message);

    expect(encoded.value).toContain("\x1b[2;6H\x1b[?25h");
    const rendered = await renderToTerminal([encoded.value], { cols: 6, rows: 2 });
    try {
      expect(rendered.plainLines()).toEqual(["A界   ", "clear "]);
      expect(rendered.cellAt(0, 0)).toMatchObject({ char: "A", bold: true, fgPaletteIndex: 2 });
      expect(rendered.cellAt(0, 1)?.char).toBe("界");
    } finally {
      rendered.dispose();
    }
  });

  it("clears stale terminal cells on resize before repainting the full grid", async () => {
    const writes: string[] = [];
    const terminal = new GridTerminal({ write: (data) => writes.push(data) });
    const large = frame(6, 2);
    const largeArea = createRect(0, 0, 6, 2);
    if (!largeArea.ok) throw new Error(largeArea.error.message);
    paintText(large, largeArea.value, 0, 0, "abcdef", {}, 0);
    paintText(large, largeArea.value, 0, 1, "stale!", {}, 0);
    terminal.render(large);

    const small = frame(3, 1);
    const smallArea = createRect(0, 0, 3, 1);
    if (!smallArea.ok) throw new Error(smallArea.error.message);
    paintText(small, smallArea.value, 0, 0, "new", {}, 0);
    terminal.render(small);

    expect(writes[1]).toContain("\x1b[2J\x1b[H");
    const rendered = await renderToTerminal([writes.join("")], { cols: 6, rows: 2 });
    try {
      expect(rendered.plainLines()).toEqual(["new", ""]);
    } finally {
      rendered.dispose();
    }
  });

  it("fully invalidates after an explicit backend invalidation", () => {
    const terminal = new GridTerminal({ write: () => undefined });
    expect(terminal.render(frame())).toMatchObject({ ok: true, value: { full: true } });
    expect(terminal.render(frame())).toMatchObject({ ok: true, value: { full: false, runs: [] } });
    terminal.invalidate();
    expect(terminal.render(frame())).toMatchObject({ ok: true, value: { full: true } });
  });

  it("fails with patch and encoded-byte diagnostics at one past each cap", () => {
    const onePatchLimits = { ...tinyLimits, maxPatches: 1 };
    const previous = frame(6, 1, onePatchLimits);
    const atPatchCap = frame(6, 1, onePatchLimits);
    const next = frame(6, 1, onePatchLimits);
    const area = createRect(0, 0, 6, 1);
    if (!area.ok) throw new Error(area.error.message);
    paintText(atPatchCap, area.value, 0, 0, "x", {}, 0);
    expect(diffFrames(previous, atPatchCap)).toMatchObject({ ok: true, value: { runs: [{ startColumn: 0 }] } });
    paintText(next, area.value, 0, 0, "x", {}, 0);
    paintText(next, area.value, 5, 0, "y", {}, 0);
    expect(diffFrames(previous, next)).toMatchObject({ ok: false, error: { code: "patch-cap-exceeded", context: { patches: 2, maxPatches: 1 } } });

    const byteSource = frame(6, 1);
    paintText(byteSource, area.value, 0, 0, "abcdef", { bold: true }, 0);
    const update = diffFrames(undefined, byteSource);
    if (!update.ok) throw new Error(update.error.message);
    const unbounded = encodeGridUpdate(update.value);
    if (!unbounded.ok) throw new Error(unbounded.error.message);
    const bytes = Buffer.byteLength(unbounded.value, "utf8");
    expect(encodeGridUpdate({ ...update.value, limits: { ...tinyLimits, maxEncodedBytes: bytes } }).ok).toBe(true);
    const encoded = encodeGridUpdate({ ...update.value, limits: { ...tinyLimits, maxEncodedBytes: bytes - 1 } });
    expect(encoded).toMatchObject({ ok: false, error: { code: "encoded-output-cap-exceeded" } });
    if (!encoded.ok) expect(encoded.error.message).toMatch(/encodedBytes=.*cap=/);
  });

  it("reports the first escape token and bounded context for terminal mismatches", () => {
    const message = describeTerminalMismatch("abc\x1b[31mred", "abc\x1b[32mred", 20);
    expect(message).toMatch(/byteOrCodeUnit=6/);
    expect(message).toMatch(/expectedToken="1"/);
    expect(message).toMatch(/actualToken="2"/);
    expect(message.length).toBeLessThan(500);
  });
});
