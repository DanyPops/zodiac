import { visibleWidth } from "@earendil-works/pi-tui";

export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type GridId = Brand<string, "GridId">;
export type Row = Brand<number, "Row">;
export type Column = Brand<number, "Column">;

export function gridId(value: string): GridId {
  if (value.trim().length === 0) throw new Error("GridId must be non-empty");
  return value as GridId;
}

export function row(value: number): Row {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Row must be a non-negative safe integer");
  return value as Row;
}

export function column(value: number): Column {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Column must be a non-negative safe integer");
  return value as Column;
}

export interface FrameLimits {
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxCells: number;
  /** Highest accepted z-index; zero is the base layer. */
  readonly maxLayers: number;
  readonly maxPatches: number;
  readonly maxGraphemesPerWrite: number;
  readonly maxEncodedBytes: number;
}

export const DEFAULT_FRAME_LIMITS: FrameLimits = Object.freeze({
  maxRows: 300,
  maxColumns: 500,
  maxCells: 150_000,
  maxLayers: 31,
  maxPatches: 10_000,
  maxGraphemesPerWrite: 16_384,
  maxEncodedBytes: 4 * 1024 * 1024,
});

export type FrameErrorCode =
  | "invalid-dimensions"
  | "invalid-rect"
  | "layer-cap-exceeded"
  | "grapheme-cap-exceeded"
  | "patch-cap-exceeded"
  | "encoded-output-cap-exceeded"
  | "incompatible-grid"
  | "invalid-patch";

export interface FrameError {
  readonly code: FrameErrorCode;
  readonly message: string;
  readonly context?: Readonly<Record<string, number | string | boolean>>;
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: FrameError };

function failure(code: FrameErrorCode, message: string, context?: FrameError["context"]): Outcome<never> {
  return { ok: false, error: { code, message, ...(context ? { context } : {}) } };
}

export interface Rect {
  readonly x: Column;
  readonly y: Row;
  readonly width: number;
  readonly height: number;
}

export function createRect(x: number, y: number, width: number, height: number): Outcome<Rect> {
  if (![x, y, width, height].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return failure("invalid-rect", "Rect coordinates and dimensions must be non-negative safe integers", { x, y, width, height });
  }
  return { ok: true, value: { x: column(x), y: row(y), width, height } };
}

export interface CellStyle {
  readonly foreground?: number;
  readonly background?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly dim?: boolean;
  readonly inverse?: boolean;
}

export interface Cell {
  readonly grapheme: string;
  readonly width: 0 | 1 | 2;
  readonly continuation: boolean;
  readonly style: CellStyle;
  readonly layer: number;
}

export interface CursorState {
  readonly row: number;
  readonly column: number;
  readonly visible: boolean;
}

export interface GridFrame {
  readonly gridId: GridId;
  readonly width: number;
  readonly height: number;
  readonly cells: Cell[];
  cursor: CursorState | null;
  readonly limits: FrameLimits;
}

const EMPTY_STYLE: CellStyle = Object.freeze({});

function blankCell(): Cell {
  return { grapheme: " ", width: 1, continuation: false, style: EMPTY_STYLE, layer: -1 };
}

function safeCellCount(width: number, height: number): number | undefined {
  const count = width * height;
  return Number.isSafeInteger(count) ? count : undefined;
}

export function createGridFrame(id: GridId, width: number, height: number, limits: FrameLimits = DEFAULT_FRAME_LIMITS): Outcome<GridFrame> {
  const count = safeCellCount(width, height);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > limits.maxColumns ||
    height > limits.maxRows ||
    count === undefined ||
    count > limits.maxCells
  ) {
    return failure("invalid-dimensions", "Grid dimensions exceed configured bounds", {
      width,
      height,
      maxColumns: limits.maxColumns,
      maxRows: limits.maxRows,
      maxCells: limits.maxCells,
    });
  }
  return { ok: true, value: { gridId: id, width, height, cells: Array.from({ length: count }, blankCell), cursor: null, limits } };
}

function frameIndex(frame: GridFrame, rowValue: number, columnValue: number): number {
  return rowValue * frame.width + columnValue;
}

function withinFrame(frame: GridFrame, rowValue: number, columnValue: number): boolean {
  return rowValue >= 0 && rowValue < frame.height && columnValue >= 0 && columnValue < frame.width;
}

function withinRect(area: Rect, rowValue: number, columnValue: number): boolean {
  return rowValue >= area.y && rowValue < area.y + area.height && columnValue >= area.x && columnValue < area.x + area.width;
}

function segmentText(text: string, limit: number): Outcome<string[]> {
  // Pi exposes display width but not its segmenter; use the same native primitive without adding a competing polyfill.
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments: string[] = [];
  for (const { segment } of segmenter.segment(text)) {
    segments.push(segment);
    if (segments.length > limit) {
      return failure("grapheme-cap-exceeded", "Paint write exceeds configured grapheme bound", {
        graphemes: segments.length,
        maxGraphemesPerWrite: limit,
      });
    }
  }
  return { ok: true, value: segments };
}

function normalizedWidth(grapheme: string): 0 | 1 | 2 {
  const width = visibleWidth(grapheme);
  if (width <= 0) return 0;
  return width >= 2 ? 2 : 1;
}

export function paintText(
  frame: GridFrame,
  area: Rect,
  offsetX: number,
  offsetY: number,
  text: string,
  style: CellStyle = EMPTY_STYLE,
  layer = 0,
): Outcome<void> {
  if (!Number.isSafeInteger(layer) || layer < 0 || layer > frame.limits.maxLayers) {
    return failure("layer-cap-exceeded", "Paint layer exceeds configured z-index bound", { layer, maxLayers: frame.limits.maxLayers });
  }
  const segmented = segmentText(text, frame.limits.maxGraphemesPerWrite);
  if (!segmented.ok) return segmented;
  const segments = segmented.value;
  if (![offsetX, offsetY].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return failure("invalid-rect", "Paint offsets must be non-negative safe integers", { offsetX, offsetY });
  }

  let targetColumn = Number(area.x) + offsetX;
  const targetRow = Number(area.y) + offsetY;
  for (const segment of segments) {
    const displayWidth = normalizedWidth(segment);
    if (displayWidth === 0) continue;
    const fits =
      withinFrame(frame, targetRow, targetColumn) &&
      withinRect(area, targetRow, targetColumn) &&
      (displayWidth === 1 || (withinFrame(frame, targetRow, targetColumn + 1) && withinRect(area, targetRow, targetColumn + 1)));
    if (fits) {
      const index = frameIndex(frame, targetRow, targetColumn);
      const current = frame.cells[index];
      if (current && layer >= current.layer) {
        frame.cells[index] = { grapheme: segment, width: displayWidth, continuation: false, style: { ...style }, layer };
        if (displayWidth === 2) {
          frame.cells[index + 1] = { grapheme: "", width: 0, continuation: true, style: { ...style }, layer };
        }
      }
    }
    targetColumn += displayWidth;
  }
  return { ok: true, value: undefined };
}

export function setCursor(frame: GridFrame, cursor: CursorState | null): Outcome<void> {
  if (cursor && (!withinFrame(frame, cursor.row, cursor.column) || !Number.isSafeInteger(cursor.row) || !Number.isSafeInteger(cursor.column))) {
    return failure("invalid-rect", "Cursor must be inside the frame", { row: cursor.row, column: cursor.column, width: frame.width, height: frame.height });
  }
  frame.cursor = cursor ? { ...cursor } : null;
  return { ok: true, value: undefined };
}

function cellsEqual(left: Cell, right: Cell): boolean {
  return (
    left.grapheme === right.grapheme &&
    left.width === right.width &&
    left.continuation === right.continuation &&
    left.layer === right.layer &&
    left.style.foreground === right.style.foreground &&
    left.style.background === right.style.background &&
    left.style.bold === right.style.bold &&
    left.style.italic === right.style.italic &&
    left.style.underline === right.style.underline &&
    left.style.dim === right.style.dim &&
    left.style.inverse === right.style.inverse
  );
}

function cursorsEqual(left: CursorState | null, right: CursorState | null): boolean {
  return left?.row === right?.row && left?.column === right?.column && left?.visible === right?.visible;
}

export interface GridLineRun {
  readonly row: number;
  readonly startColumn: number;
  readonly cells: readonly Cell[];
}

export interface GridUpdate {
  readonly gridId: GridId;
  readonly width: number;
  readonly height: number;
  readonly full: boolean;
  readonly runs: readonly GridLineRun[];
  readonly cursor: CursorState | null;
  readonly cursorChanged: boolean;
  readonly limits: FrameLimits;
}

export function diffFrames(previous: GridFrame | undefined, next: GridFrame): Outcome<GridUpdate> {
  if (previous && previous.gridId !== next.gridId) {
    return failure("incompatible-grid", "Cannot diff frames with different GridIds");
  }
  const full = !previous || previous.width !== next.width || previous.height !== next.height;
  const runs: GridLineRun[] = [];

  for (let rowValue = 0; rowValue < next.height; rowValue++) {
    if (full) {
      const start = rowValue * next.width;
      runs.push({ row: rowValue, startColumn: 0, cells: next.cells.slice(start, start + next.width).map((cell) => ({ ...cell, style: { ...cell.style } })) });
      continue;
    }
    let columnValue = 0;
    while (columnValue < next.width) {
      const index = frameIndex(next, rowValue, columnValue);
      const nextCell = next.cells[index];
      const previousCell = previous?.cells[index];
      if (!nextCell || !previousCell || cellsEqual(previousCell, nextCell)) {
        columnValue++;
        continue;
      }
      const startColumn = columnValue;
      const cells: Cell[] = [];
      while (columnValue < next.width) {
        const runIndex = frameIndex(next, rowValue, columnValue);
        const candidate = next.cells[runIndex];
        const oldCandidate = previous?.cells[runIndex];
        if (!candidate || !oldCandidate || cellsEqual(oldCandidate, candidate)) break;
        cells.push({ ...candidate, style: { ...candidate.style } });
        columnValue++;
      }
      runs.push({ row: rowValue, startColumn, cells });
    }
  }

  if (runs.length > next.limits.maxPatches) {
    return failure("patch-cap-exceeded", "Frame diff exceeds configured patch bound", { patches: runs.length, maxPatches: next.limits.maxPatches });
  }

  return {
    ok: true,
    value: {
      gridId: next.gridId,
      width: next.width,
      height: next.height,
      full,
      runs,
      cursor: next.cursor ? { ...next.cursor } : null,
      cursorChanged: !previous || !cursorsEqual(previous.cursor, next.cursor),
      limits: next.limits,
    },
  };
}

export function applyGridUpdate(previous: GridFrame | undefined, update: GridUpdate): Outcome<GridFrame> {
  if (previous && previous.gridId !== update.gridId) return failure("incompatible-grid", "Update GridId does not match previous frame");
  let targetResult: Outcome<GridFrame>;
  if (!previous || update.full || previous.width !== update.width || previous.height !== update.height) {
    targetResult = createGridFrame(update.gridId, update.width, update.height, update.limits);
  } else {
    targetResult = {
      ok: true,
      value: {
        gridId: previous.gridId,
        width: previous.width,
        height: previous.height,
        cells: previous.cells.map((cell) => ({ ...cell, style: { ...cell.style } })),
        cursor: previous.cursor ? { ...previous.cursor } : null,
        limits: update.limits,
      },
    };
  }
  if (!targetResult.ok) return targetResult;
  const target = targetResult.value;
  for (const [patchIndex, run] of update.runs.entries()) {
    if (run.row < 0 || run.row >= target.height || run.startColumn < 0 || run.startColumn + run.cells.length > target.width) {
      return failure("invalid-patch", "Grid run is outside update dimensions", { patchIndex, row: run.row, startColumn: run.startColumn, cells: run.cells.length });
    }
    for (let offset = 0; offset < run.cells.length; offset++) {
      const cell = run.cells[offset];
      if (!cell) continue;
      target.cells[frameIndex(target, run.row, run.startColumn + offset)] = { ...cell, style: { ...cell.style } };
    }
  }
  if (update.cursorChanged || update.full) target.cursor = update.cursor ? { ...update.cursor } : null;
  return { ok: true, value: target };
}

function codePoints(value: string): string {
  if (value === "") return "<none>";
  return [...value].map((character) => `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
}

function styleDifference(expected: CellStyle, actual: CellStyle): string {
  const keys: Array<keyof CellStyle> = ["foreground", "background", "bold", "italic", "underline", "dim", "inverse"];
  const changes = keys.filter((key) => expected[key] !== actual[key]).map((key) => `${key}:${String(expected[key])}->${String(actual[key])}`);
  return changes.length > 0 ? changes.join(",") : "none";
}

export function describeFrameMismatch(expected: GridFrame, actual: GridFrame): string {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return `grid dimensions expected=${expected.width}x${expected.height} actual=${actual.width}x${actual.height}`;
  }
  for (let index = 0; index < expected.cells.length; index++) {
    const expectedCell = expected.cells[index];
    const actualCell = actual.cells[index];
    if (!expectedCell || !actualCell || cellsEqual(expectedCell, actualCell)) continue;
    const rowValue = Math.floor(index / expected.width);
    const columnValue = index % expected.width;
    const from = Math.max(0, index - 2);
    const to = Math.min(expected.cells.length, index + 3);
    const neighborhood = expected.cells.slice(from, to).map((cell) => JSON.stringify(cell.grapheme)).join(" ");
    return [
      `cell mismatch row=${rowValue} column=${columnValue}`,
      `expected=${JSON.stringify(expectedCell.grapheme)} codePoints=${codePoints(expectedCell.grapheme)} width=${expectedCell.width} continuation=${expectedCell.continuation}`,
      `actual=${JSON.stringify(actualCell.grapheme)} codePoints=${codePoints(actualCell.grapheme)} width=${actualCell.width} continuation=${actualCell.continuation}`,
      `style=${styleDifference(expectedCell.style, actualCell.style)}`,
      `cursor expected=${JSON.stringify(expected.cursor)} actual=${JSON.stringify(actual.cursor)}`,
      `neighborhood[${from},${to})=${neighborhood}`,
    ].join("; ");
  }
  if (!cursorsEqual(expected.cursor, actual.cursor)) return `cursor mismatch expected=${JSON.stringify(expected.cursor)} actual=${JSON.stringify(actual.cursor)}`;
  return "frames match";
}
