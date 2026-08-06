import { layoutWorldRegions, type Region, type WorldViewModel } from "@alignment/surface-protocol";
import { createGridFrame, createRect, gridId, paintText, type CellStyle, type GridFrame, type Outcome, type Rect } from "../frame/index.js";

export type ShellFocus = "header" | "left-pillar" | "body" | "right-pillar" | "footer";
const FOCUS_ORDER: readonly ShellFocus[] = ["header", "left-pillar", "body", "right-pillar", "footer"];
const BASE: CellStyle = { foreground: 7 };
const MUTED: CellStyle = { foreground: 6, dim: true };

function regionFocus(region: Region): ShellFocus {
  return region.kind === "pillar" ? `${region.side}-pillar` : region.kind;
}

function toRect(region: Region): Outcome<Rect> {
  return createRect(region.rect.x, region.rect.y, region.rect.width, region.rect.height);
}

function paint(frame: GridFrame, area: Rect, x: number, y: number, text: string, style: CellStyle): Outcome<void> {
  return paintText(frame, area, x, y, text, style, 0);
}

export class SemanticShell {
  private focusIndex = 0;

  focusedRegion(): ShellFocus { return FOCUS_ORDER[this.focusIndex]!; }
  focusNext(): ShellFocus { this.focusIndex = (this.focusIndex + 1) % FOCUS_ORDER.length; return this.focusedRegion(); }
  focusPrevious(): ShellFocus { this.focusIndex = (this.focusIndex - 1 + FOCUS_ORDER.length) % FOCUS_ORDER.length; return this.focusedRegion(); }

  project(world: WorldViewModel, width: number, height: number): Outcome<GridFrame> {
    const layout = layoutWorldRegions(world, width, height);
    if (!layout.ok) return { ok: false, error: { code: "invalid-dimensions", message: layout.issues.join("; "), context: { width, height } } };
    const created = createGridFrame(gridId("alignment-shell"), width, height);
    if (!created.ok) return created;
    const frame = created.value;
    for (const region of layout.value) {
      const rect = toRect(region);
      if (!rect.ok) return rect;
      const area = rect.value;
      const focused = regionFocus(region) === this.focusedRegion();
      const titleStyle: CellStyle = { ...BASE, bold: true, inverse: focused };
      for (let row = 0; row < area.height; row++) {
        const fill = paint(frame, area, 0, row, " ".repeat(area.width), BASE);
        if (!fill.ok) return fill;
      }
      const rendered = this.paintRegion(frame, area, region, titleStyle);
      if (!rendered.ok) return rendered;
    }
    return { ok: true, value: frame };
  }

  private paintRegion(frame: GridFrame, area: Rect, region: Region, title: CellStyle): Outcome<void> {
    if (region.kind === "header") return paint(frame, area, 1, 0, region.carousel.state === "empty" ? "Windows: none" : "Windows", title);
    if (region.kind === "pillar") {
      const heading = region.navigation === "workspaces" ? "Workspaces" : "Integrations";
      const result = paint(frame, area, 1, 1, heading, title);
      if (!result.ok) return result;
      return paint(frame, area, 1, 3, region.items.length === 0 ? "(none)" : region.items[0]!.label, MUTED);
    }
    if (region.kind === "body") {
      const label = region.content.state === "empty" ? region.content.watermark : region.content.title;
      return paint(frame, area, Math.max(0, Math.floor((area.width - label.length) / 2)), Math.floor(area.height / 2), label, title);
    }
    const heading = paint(frame, area, 1, 0, "Chat", title);
    if (!heading.ok) return heading;
    return paint(frame, area, 1, 1, region.chat.state === "unavailable" ? "Agent unavailable" : "Agent ready", MUTED);
  }
}
