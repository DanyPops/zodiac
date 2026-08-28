import { renderToTerminal, type RenderedTerminal } from "@danypops/pi-tui-harness";
import { describe, expect, it } from "vitest";
import { createGridFrame, createRect, diffFrames, gridId, paintText, setCursor, type FrameLimits } from "./grid-frame.js";
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

function terminalCells(terminal: RenderedTerminal) {
  return Array.from({ length: terminal.rows }, (_, row) =>
    Array.from({ length: terminal.cols }, (_, column) => {
      const cell = terminal.cellAt(row, column);
      return cell ? { ...cell, char: cell.char === " " ? "" : cell.char } : undefined;
    }),
  );
}

function visibleRows(terminal: RenderedTerminal): string[] {
  return terminal.plainLines().map((line) => line.trimEnd());
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function renderedMismatch(expected: RenderedTerminal, actual: RenderedTerminal, seed: number, action: number, ansi: string): string {
  for (let row = 0; row < expected.rows; row++) {
    for (let column = 0; column < expected.cols; column++) {
      const rawExpectedCell = expected.cellAt(row, column);
      const rawActualCell = actual.cellAt(row, column);
      const expectedCell = rawExpectedCell ? { ...rawExpectedCell, char: rawExpectedCell.char === " " ? "" : rawExpectedCell.char } : undefined;
      const actualCell = rawActualCell ? { ...rawActualCell, char: rawActualCell.char === " " ? "" : rawActualCell.char } : undefined;
      if (JSON.stringify(expectedCell) === JSON.stringify(actualCell)) continue;
      const codePoints = (value: string | undefined) => [...(value ?? "")].map((character) => `U+${character.codePointAt(0)?.toString(16).toUpperCase()}`).join(" ") || "<none>";
      return `seed=${seed} action=${action} row=${row} column=${column} expected=${JSON.stringify(expectedCell)} expectedCodePoints=${codePoints(expectedCell?.char)} actual=${JSON.stringify(actualCell)} actualCodePoints=${codePoints(actualCell?.char)} ansiTail=${JSON.stringify(ansi.slice(-160))}`;
    }
  }
  return `seed=${seed} action=${action} terminal dimensions or plain rows differ; ansiTail=${JSON.stringify(ansi.slice(-160))}`;
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

  it("keeps incremental repaint state equal to a fresh full repaint", async () => {
    const writes: string[] = [];
    const terminal = new GridTerminal({ write: (data) => writes.push(data) });
    const frames = [frame(8, 3), frame(8, 3), frame(8, 3), frame(5, 2)];

    const firstArea = createRect(0, 0, 8, 3);
    if (!firstArea.ok) throw new Error(firstArea.error.message);
    paintText(frames[0]!, firstArea.value, 0, 0, "A界cd", { bold: true, foreground: 2 }, 0);
    paintText(frames[0]!, firstArea.value, 0, 1, "second", {}, 0);
    setCursor(frames[0]!, { row: 0, column: 1, visible: true });

    paintText(frames[1]!, firstArea.value, 0, 0, "AB-cd", { foreground: 3 }, 0);
    paintText(frames[1]!, firstArea.value, 7, 1, "!", { inverse: true }, 0);
    setCursor(frames[1]!, { row: 1, column: 7, visible: true });

    paintText(frames[2]!, firstArea.value, 0, 0, "short", {}, 0);
    paintText(frames[2]!, firstArea.value, 7, 2, "Z", { underline: true }, 0);
    setCursor(frames[2]!, null);

    const smallArea = createRect(0, 0, 5, 2);
    if (!smallArea.ok) throw new Error(smallArea.error.message);
    paintText(frames[3]!, smallArea.value, 0, 0, "new", { italic: true }, 0);
    setCursor(frames[3]!, { row: 1, column: 4, visible: true });

    for (const [step, next] of frames.entries()) {
      const rendered = terminal.render(next);
      if (!rendered.ok) throw new Error(rendered.error.message);
      expect(rendered.value.cursor, `cursor at step ${step}`).toEqual(next.cursor);
      const full = diffFrames(undefined, next);
      if (!full.ok) throw new Error(full.error.message);
      const encodedFull = encodeGridUpdate(full.value);
      if (!encodedFull.ok) throw new Error(encodedFull.error.message);

      const incrementalTerminal = await renderToTerminal([writes.join("")], { cols: 8, rows: 3 });
      const fullTerminal = await renderToTerminal([encodedFull.value], { cols: 8, rows: 3 });
      try {
        expect(visibleRows(incrementalTerminal), `plain rows at step ${step}`).toEqual(visibleRows(fullTerminal));
        expect(terminalCells(incrementalTerminal), `cells and styles at step ${step}`).toEqual(terminalCells(fullTerminal));
      } finally {
        incrementalTerminal.dispose();
        fullTerminal.dispose();
      }
    }
  });

  it("keeps bounded seeded repaint traces reproducible", async () => {
    const seed = 0x5a0d_1ac;
    const random = seededRandom(seed);
    const writes: string[] = [];
    const terminal = new GridTerminal({ write: (data) => writes.push(data) });
    const glyphs = ["a", "b", "界", "🙂", "-"] as const;
    const actionCount = 16;

    for (let action = 0; action < actionCount; action++) {
      const width = action % 5 === 4 ? 9 : 12;
      const height = action % 5 === 4 ? 3 : 4;
      const next = frame(width, height, { ...tinyLimits, maxRows: 4, maxColumns: 12, maxCells: 48, maxPatches: 48, maxGraphemesPerWrite: 64, maxEncodedBytes: 8_000 });
      const area = createRect(0, 0, width, height);
      if (!area.ok) throw new Error(area.error.message);
      for (let row = 0; row < height; row++) {
        const count = 1 + Math.floor(random() * Math.max(1, width - 2));
        const text = Array.from({ length: count }, () => glyphs[Math.floor(random() * glyphs.length)]!).join("");
        const painted = paintText(next, area.value, 0, row, text, { bold: random() > 0.7, inverse: random() > 0.85, foreground: Math.floor(random() * 8) }, 0);
        if (!painted.ok) throw new Error(painted.error.message);
      }
      setCursor(next, random() > 0.25 ? { row: Math.floor(random() * height), column: Math.floor(random() * width), visible: true } : null);
      const update = terminal.render(next);
      if (!update.ok) throw new Error(update.error.message);
      expect(update.value.cursor, `seed=${seed} action=${action} cursor`).toEqual(next.cursor);
      const full = diffFrames(undefined, next);
      if (!full.ok) throw new Error(full.error.message);
      const encodedFull = encodeGridUpdate(full.value);
      if (!encodedFull.ok) throw new Error(encodedFull.error.message);

      const incrementalTerminal = await renderToTerminal([writes.join("")], { cols: 12, rows: 4 });
      const fullTerminal = await renderToTerminal([encodedFull.value], { cols: 12, rows: 4 });
      try {
        const mismatch = renderedMismatch(fullTerminal, incrementalTerminal, seed, action, writes.join(""));
        expect(visibleRows(incrementalTerminal), mismatch).toEqual(visibleRows(fullTerminal));
        expect(terminalCells(incrementalTerminal), mismatch).toEqual(terminalCells(fullTerminal));
      } finally {
        incrementalTerminal.dispose();
        fullTerminal.dispose();
      }
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
