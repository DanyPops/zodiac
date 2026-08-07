import type { Region } from "@alignment/surface-protocol";
import type { ShellFocus } from "../shell/semantic-shell.js";
import { createRect, paintText, type CellStyle, type GridFrame, type Outcome, type Rect } from "./index.js";

/**
 * The five semantic regions always tile the viewport edge-to-edge (no gap rows/columns),
 * so every shared boundary between two regions collapses onto a single line of cells.
 * This topology names those lines once so the border pass never re-derives layout math
 * (and never doubles a line the way two independently bordered panels would).
 */
export interface BorderTopology {
  readonly verticalOuterLeft: number;
  readonly verticalOuterRight: number;
  readonly verticalLeftSplit: number;
  readonly verticalRightSplit: number;
  readonly horizontalTop: number;
  readonly horizontalFooterSeparator: number;
  readonly horizontalBottom: number;
  readonly contentTop: number;
  readonly contentBottom: number;
}

function byKind<K extends Region["kind"]>(regions: readonly Region[], kind: K): Extract<Region, { kind: K }> | undefined {
  return regions.find((region): region is Extract<Region, { kind: K }> => region.kind === kind);
}

/**
 * Derives the shared-line coordinates directly from the already-computed Region rects
 * instead of re-running layoutWorldRegions' own pillar-width formula -- if a future layout
 * ever stops tiling contiguously, this fails closed instead of drawing a garbled frame.
 */
export function deriveBorderTopology(regions: readonly Region[], width: number, height: number): Outcome<BorderTopology> {
  const header = byKind(regions, "header");
  const footer = byKind(regions, "footer");
  const body = byKind(regions, "body");
  const leftPillar = regions.find((region): region is Extract<Region, { kind: "pillar" }> => region.kind === "pillar" && region.side === "left");
  const rightPillar = regions.find((region): region is Extract<Region, { kind: "pillar" }> => region.kind === "pillar" && region.side === "right");
  if (!header || !footer || !body || !leftPillar || !rightPillar) {
    return { ok: false, error: { code: "invalid-rect", message: "border topology requires header, footer, body and both pillars" } };
  }
  const contiguous =
    header.rect.x === 0 &&
    header.rect.width === width &&
    footer.rect.x === 0 &&
    footer.rect.width === width &&
    leftPillar.rect.x === 0 &&
    leftPillar.rect.x + leftPillar.rect.width === body.rect.x &&
    body.rect.x + body.rect.width === rightPillar.rect.x &&
    rightPillar.rect.x + rightPillar.rect.width === width &&
    leftPillar.rect.y === body.rect.y &&
    body.rect.y === rightPillar.rect.y &&
    leftPillar.rect.height === body.rect.height &&
    body.rect.height === rightPillar.rect.height &&
    header.rect.y + header.rect.height === leftPillar.rect.y &&
    leftPillar.rect.y + leftPillar.rect.height === footer.rect.y &&
    footer.rect.y + footer.rect.height === height;
  if (!contiguous) {
    return { ok: false, error: { code: "invalid-rect", message: "regions must tile the viewport edge-to-edge for a border to be drawn" } };
  }
  return {
    ok: true,
    value: {
      verticalOuterLeft: leftPillar.rect.x,
      verticalOuterRight: rightPillar.rect.x + rightPillar.rect.width - 1,
      verticalLeftSplit: leftPillar.rect.x + leftPillar.rect.width - 1,
      verticalRightSplit: body.rect.x + body.rect.width - 1,
      horizontalTop: header.rect.y,
      horizontalFooterSeparator: footer.rect.y,
      horizontalBottom: footer.rect.y + footer.rect.height - 1,
      contentTop: leftPillar.rect.y,
      contentBottom: leftPillar.rect.y + leftPillar.rect.height - 1,
    },
  };
}

function isHorizontalMember(x: number, y: number, t: BorderTopology): boolean {
  return (y === t.horizontalTop || y === t.horizontalFooterSeparator || y === t.horizontalBottom) && x >= t.verticalOuterLeft && x <= t.verticalOuterRight;
}

function isVerticalMember(x: number, y: number, t: BorderTopology): boolean {
  if (x === t.verticalOuterLeft || x === t.verticalOuterRight) return y >= t.horizontalTop && y <= t.horizontalBottom;
  if (x === t.verticalLeftSplit || x === t.verticalRightSplit) return y >= t.contentTop && y <= t.contentBottom;
  return false;
}

// Indexed by (north<<3 | south<<2 | east<<1 | west); a Neovim-style single shared
// line is fully described by which of its four neighbors are themselves border cells.
const JUNCTIONS: readonly string[] = [
  " ", "─", "─", "─", // 0000..0011 (no vertical neighbor)
  "│", "┐", "┌", "┬", // 0100..0111 (south only .. south+east+west)
  "│", "┘", "└", "┴", // 1000..1011 (north only .. north+east+west)
  "│", "┤", "├", "┼", // 1100..1111 (north+south .. all four)
];

function glyphAt(x: number, y: number, t: BorderTopology): string {
  const north = isVerticalMember(x, y - 1, t) ? 8 : 0;
  const south = isVerticalMember(x, y + 1, t) ? 4 : 0;
  const east = isHorizontalMember(x + 1, y, t) ? 2 : 0;
  const west = isHorizontalMember(x - 1, y, t) ? 1 : 0;
  return JUNCTIONS[north | south | east | west]!;
}

interface HighlightBox { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

function highlightBoxFor(focus: ShellFocus, t: BorderTopology): HighlightBox {
  switch (focus) {
    case "header": return { x0: t.verticalOuterLeft, y0: t.horizontalTop, x1: t.verticalOuterRight, y1: t.horizontalTop };
    case "left-pillar": return { x0: t.verticalOuterLeft, y0: t.horizontalTop, x1: t.verticalLeftSplit, y1: t.horizontalFooterSeparator };
    case "body": return { x0: t.verticalLeftSplit, y0: t.horizontalTop, x1: t.verticalRightSplit, y1: t.horizontalFooterSeparator };
    case "right-pillar": return { x0: t.verticalRightSplit, y0: t.horizontalTop, x1: t.verticalOuterRight, y1: t.horizontalFooterSeparator };
    case "footer": return { x0: t.verticalOuterLeft, y0: t.horizontalFooterSeparator, x1: t.verticalOuterRight, y1: t.horizontalBottom };
  }
}

function inBox(x: number, y: number, box: HighlightBox): boolean {
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
}

export interface BorderStyles {
  readonly base: CellStyle;
  readonly active: CellStyle;
}

/**
 * Paints every shared boundary line once, using the correct junction glyph at each
 * intersection, then re-styles (never re-characters) the focused region's own perimeter --
 * geometry stays exactly what layoutWorldRegions produced; only paint changes.
 */
export function paintBorders(frame: GridFrame, topology: BorderTopology, width: number, height: number, focus: ShellFocus, styles: BorderStyles): Outcome<void> {
  const fullAreaResult = createRect(0, 0, width, height);
  if (!fullAreaResult.ok) return fullAreaResult;
  const fullArea = fullAreaResult.value;
  const box = highlightBoxFor(focus, topology);
  const cells = collectBorderCells(topology, width, height);
  for (const [x, y] of cells) {
    const glyph = glyphAt(x, y, topology);
    if (glyph === " ") continue;
    const style = inBox(x, y, box) ? styles.active : styles.base;
    const painted = paintText(frame, fullArea, x, y, glyph, style, 1);
    if (!painted.ok) return painted;
  }
  return { ok: true, value: undefined };
}

function collectBorderCells(t: BorderTopology, width: number, height: number): Array<readonly [number, number]> {
  const cells: Array<readonly [number, number]> = [];
  for (const y of [t.horizontalTop, t.horizontalFooterSeparator, t.horizontalBottom]) {
    for (let x = 0; x < width; x++) cells.push([x, y] as const);
  }
  for (const x of [t.verticalOuterLeft, t.verticalOuterRight, t.verticalLeftSplit, t.verticalRightSplit]) {
    for (let y = 0; y < height; y++) cells.push([x, y] as const);
  }
  return cells;
}

export function labelSegment(frame: GridFrame, area: Rect, startX: number, endXExclusive: number, y: number, label: string, style: CellStyle): Outcome<void> {
  const available = endXExclusive - startX;
  if (available <= 2) return { ok: true, value: undefined };
  const text = ` ${label} `.slice(0, available);
  const offset = Math.max(1, Math.floor((available - text.length) / 2));
  return paintText(frame, area, startX + offset, y, text, style, 1);
}
