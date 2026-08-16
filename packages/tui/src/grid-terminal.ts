import type { Terminal } from "@earendil-works/pi-tui";
import { applyGridUpdate, diffFrames, type CellStyle, type GridFrame, type GridUpdate, type Outcome } from "./grid-frame.js";

function styleSequence(style: CellStyle): string {
  const codes: number[] = [0];
  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.italic) codes.push(3);
  if (style.underline) codes.push(4);
  if (style.inverse) codes.push(7);
  if (style.foreground !== undefined) codes.push(style.foreground >= 0 && style.foreground <= 7 ? 30 + style.foreground : 39);
  if (style.background !== undefined) codes.push(style.background >= 0 && style.background <= 7 ? 40 + style.background : 49);
  return `\x1b[${codes.join(";")}m`;
}

export function encodeGridUpdate(update: GridUpdate): Outcome<string> {
  const chunks: string[] = [];
  let encodedBytes = 0;
  const append = (...parts: string[]) => {
    for (const part of parts) {
      chunks.push(part);
      encodedBytes += Buffer.byteLength(part, "utf8");
    }
  };
  if (update.full) append("\x1b[2J\x1b[H");
  for (const [patchIndex, run] of update.runs.entries()) {
    append(`\x1b[${run.row + 1};${run.startColumn + 1}H`);
    for (const cell of run.cells) {
      if (cell.continuation) continue;
      append(styleSequence(cell.style), cell.grapheme === "" ? " " : cell.grapheme);
    }
    append("\x1b[0m");
    if (encodedBytes > update.limits.maxEncodedBytes) {
      return {
        ok: false,
        error: {
          code: "encoded-output-cap-exceeded",
          message: `Encoded terminal output exceeds cap at patch=${patchIndex} row=${run.row} range=[${run.startColumn},${run.startColumn + run.cells.length}) payloadCells=${run.cells.length} encodedBytes=${encodedBytes} cap=${update.limits.maxEncodedBytes}`,
          context: {
            patchIndex,
            row: run.row,
            startColumn: run.startColumn,
            endColumn: run.startColumn + run.cells.length,
            payloadCells: run.cells.length,
            encodedBytes,
            maxEncodedBytes: update.limits.maxEncodedBytes,
          },
        },
      };
    }
  }
  if (update.cursorChanged || update.full) {
    if (update.cursor?.visible) append(`\x1b[${update.cursor.row + 1};${update.cursor.column + 1}H\x1b[?25h`);
    else append("\x1b[?25l");
  }
  const encoded = chunks.join("");
  if (encodedBytes > update.limits.maxEncodedBytes) {
    return {
      ok: false,
      error: {
        code: "encoded-output-cap-exceeded",
        message: `Encoded terminal output exceeds cap after cursor update: encodedBytes=${encodedBytes} cap=${update.limits.maxEncodedBytes}`,
        context: { encodedBytes, maxEncodedBytes: update.limits.maxEncodedBytes },
      },
    };
  }
  return { ok: true, value: encoded };
}

function visibleToken(value: string): string {
  return value === "\x1b" ? "ESC" : JSON.stringify(value);
}

export function describeTerminalMismatch(expected: string, actual: string, maxContext = 80): string {
  let index = 0;
  const bound = Math.min(expected.length, actual.length);
  while (index < bound && expected[index] === actual[index]) index++;
  if (index === expected.length && index === actual.length) return "terminal output matches";
  const from = Math.max(0, index - Math.floor(maxContext / 2));
  const toExpected = Math.min(expected.length, from + maxContext);
  const toActual = Math.min(actual.length, from + maxContext);
  return [
    `terminal mismatch byteOrCodeUnit=${index}`,
    `expectedToken=${visibleToken(expected[index] ?? "<eof>")}`,
    `actualToken=${visibleToken(actual[index] ?? "<eof>")}`,
    `expectedExcerpt=${JSON.stringify(expected.slice(from, toExpected))}`,
    `actualExcerpt=${JSON.stringify(actual.slice(from, toActual))}`,
  ].join("; ");
}

/** Applies Zodiac's bounded cell patches through Pi's public Terminal boundary. */
export class GridTerminal {
  private previous: GridFrame | undefined;

  constructor(private readonly terminal: Pick<Terminal, "write">) {}

  render(next: GridFrame): Outcome<GridUpdate> {
    const update = diffFrames(this.previous, next);
    if (!update.ok) return update;
    const encoded = encodeGridUpdate(update.value);
    if (!encoded.ok) return encoded;
    if (encoded.value.length > 0) this.terminal.write(encoded.value);
    const applied = applyGridUpdate(this.previous, update.value);
    if (!applied.ok) return applied;
    this.previous = applied.value;
    return update;
  }

  invalidate(): void {
    this.previous = undefined;
  }
}
