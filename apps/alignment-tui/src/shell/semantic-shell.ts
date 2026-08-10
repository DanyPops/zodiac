import { layoutWorldRegions, MIN_FOOTER_HEIGHT, type Region, type WorldViewModel } from "@alignment/surface-protocol";
import { deriveBorderTopology, labelSegment, paintBorders } from "../frame/border.js";
import { createGridFrame, createRect, gridId, paintText, type CellStyle, type GridFrame, type Outcome, type Rect } from "../frame/index.js";
import type { FooterChatStatus } from "../pi/footer-chat-controller.js";
import { wrapFooterHistory } from "./footer-history-wrap.js";

/** How many rows one Ctrl+Up/Ctrl+Down expandFooter()/collapseFooter() step changes -- see SemanticShellApplication's own footer-focused keybinding. */
const FOOTER_RESIZE_STEP = 3;
/** A generous cap on the *requested* footer height, independent of the current viewport -- project() always clamps the effective value to what the real viewport can hold, so this only bounds how far a request can run ahead of a terminal that later shrinks. */
const MAX_REQUESTED_FOOTER_HEIGHT = 200;

export type ShellFocus = "header" | "left-pillar" | "body" | "right-pillar" | "footer";
const FOCUS_ORDER: readonly ShellFocus[] = ["header", "left-pillar", "body", "right-pillar", "footer"];
const BASE: CellStyle = { foreground: 7 };
const MUTED: CellStyle = { foreground: 6, dim: true };
const BORDER_ACTIVE: CellStyle = { ...BASE, bold: true };
const ERROR_STYLE: CellStyle = { foreground: 1 };

// Pi TUI's own AssistantMessageComponent/UserMessageComponent/ToolExecutionComponent
// (packages/coding-agent/src/modes/interactive/components/*.ts) render role via a
// full-row highlighted background for user messages, no background for assistant
// messages, and a background-color state machine (pending/success/error) plus a
// bolded title for tool calls -- never an inline "You:"/"Pi:" text prefix.
// GridTerminal only encodes the 8 basic ANSI colors (see its own SGR mapping), so
// exact hex parity with Pi's real theme is impossible -- these reproduce the same
// role/status-driven color-coding *convention* with that smaller palette.
/** Shows the tail of `text` when it doesn't fit `maxWidth` -- the Footer is a single row (see paintRegion's own footer comment), so a draft's cursor position and a response's most recent tokens matter more than its start. */
function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (text.length <= maxWidth) return text;
  if (maxWidth === 1) return "\u2026";
  return `\u2026${text.slice(-(maxWidth - 1))}`;
}

/** Renders one FooterChatStatus into the Footer's single content row -- the collapsed (default MIN_FOOTER_HEIGHT) case, and the live override of the protocol layer's own hardcoded "unavailable" chat state, presentation-only (not fed back through World/CommandIntent -- see the driven-session-port task's own notes on why). */
function footerChatLine(status: FooterChatStatus, maxWidth: number): { text: string; style: CellStyle } {
  switch (status.kind) {
    case "unavailable":
      return { text: truncateToWidth("Agent unavailable", maxWidth), style: MUTED };
    case "composing":
      return { text: truncateToWidth(`> ${status.draft}\u2588`, maxWidth), style: BASE };
    case "busy":
      return { text: truncateToWidth(`\u23f3 ${status.items.at(-1)?.text ?? ""}`, maxWidth), style: BASE };
    case "idle":
      return { text: truncateToWidth(`\u2713 ${status.items.at(-1)?.text ?? ""}`, maxWidth), style: BASE };
    case "error":
      return { text: truncateToWidth(`\u2717 ${status.message}`, maxWidth), style: ERROR_STYLE };
  }
}

/**
 * The expanded Footer's own last row: always the live composer, not the
 * collapsed view's joined "last item + composer" line -- history above
 * already shows the latest item as a real entry. Never carries a busy-spinner
 * prefix -- see footerStatusLine's own doc comment for why that lives on a
 * separate row instead, mirroring Pi TUI's own statusContainer/editorContainer
 * split (interactive-mode.ts's dock: statusContainer, then editorContainer,
 * as distinct sibling components, never one string spliced into the other).
 */
function footerComposerLine(status: FooterChatStatus, maxWidth: number): { text: string; style: CellStyle } {
  if (status.kind === "unavailable") return { text: truncateToWidth("Agent unavailable", maxWidth), style: MUTED };
  if (status.kind === "error") return { text: truncateToWidth(`\u2717 ${status.message}`, maxWidth), style: ERROR_STYLE };
  return { text: truncateToWidth(`> ${status.draft}\u2588`, maxWidth), style: BASE };
}

/**
 * The dedicated row directly above the composer -- Pi TUI's own
 * WorkingStatusIndicator (a Loader Component mounted in statusContainer,
 * itself a sibling *above* editorContainer, never inside it) shows an
 * animated spinner while `session.isStreaming`; its own IdleStatus renders
 * blank lines otherwise, reserving the row's height rather than collapsing
 * it away. Reproduced here as a plain conditional line instead of a real
 * per-frame animation (GridTerminal has no frame-tick driver to animate
 * against), but structurally the same: a row that exists whether or not
 * it currently has anything to say, separate from the composer's own line.
 */
function footerStatusLine(status: FooterChatStatus, maxWidth: number): { text: string; style: CellStyle } {
  if (status.kind === "busy") return { text: truncateToWidth("\u23f3 Working\u2026", maxWidth), style: MUTED };
  return { text: "", style: BASE };
}

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
  /** The *requested* footer height -- see MAX_REQUESTED_FOOTER_HEIGHT's own doc comment for why this is independent of any particular viewport. */
  private requestedFooterHeight = MIN_FOOTER_HEIGHT;
  /** Non-null means that Surface fills the entire viewport, hiding every other region -- see enterFullscreen's own doc comment. Only ever "body" or "footer": header/pillars are chrome, not a Surface. */
  private fullscreenTarget: "body" | "footer" | null = null;

  focusedRegion(): ShellFocus { return FOCUS_ORDER[this.focusIndex]!; }
  /** Fullscreen hides every region but the focused one, so there is nothing else to move focus to -- mirrors tmux disabling pane navigation while a pane is zoomed. */
  focusNext(): ShellFocus { if (this.fullscreenTarget === null) this.focusIndex = (this.focusIndex + 1) % FOCUS_ORDER.length; return this.focusedRegion(); }
  focusPrevious(): ShellFocus { if (this.fullscreenTarget === null) this.focusIndex = (this.focusIndex - 1 + FOCUS_ORDER.length) % FOCUS_ORDER.length; return this.focusedRegion(); }

  /**
   * Pushes the currently focused Surface (body or footer -- header/pillars
   * are navigation chrome, not a Surface a user would want to fill the
   * screen with) to fill the entire viewport, hiding every other region --
   * tmux's `resize-pane -Z` / zellij's `ToggleFocusFullscreen`. A no-op for
   * header/pillar focus, and a no-op if already fullscreen (there is
   * nothing "more" fullscreen to become). See keymap.ts's own doc comment
   * for why this is bound to Ctrl+Right rather than a mnemonic
   * Ctrl+<letter>.
   */
  enterFullscreen(): void {
    if (this.fullscreenTarget !== null) return;
    const focus = this.focusedRegion();
    if (focus === "body" || focus === "footer") this.fullscreenTarget = focus;
  }

  /** Restores the normal tiled layout -- a no-op if not currently fullscreen. */
  exitFullscreen(): void { this.fullscreenTarget = null; }

  /** Grows the Footer by one step (Neovim/tmux-style incremental resize) -- clamped against the real viewport lazily, in project(), not here. */
  expandFooter(): void { this.requestedFooterHeight = Math.min(this.requestedFooterHeight + FOOTER_RESIZE_STEP, MAX_REQUESTED_FOOTER_HEIGHT); }
  /** Shrinks the Footer by one step, down to its default single-row size -- never smaller, since MIN_FOOTER_HEIGHT is the smallest a footer can render at all. */
  collapseFooter(): void { this.requestedFooterHeight = Math.max(this.requestedFooterHeight - FOOTER_RESIZE_STEP, MIN_FOOTER_HEIGHT); }

  /**
   * Absolute row offset into the Footer's wrapped history buffer (0 = the
   * very first row ever wrapped) -- deliberately *not* "distance from the
   * live bottom": that alternative was tried and rejected here, because it
   * silently drifts forward whenever new rows are appended while scrolled
   * up (the "bottom" it's measured from keeps moving), which is exactly the
   * scrolled-away-content-changes-under-you bug this feature exists to fix.
   * An absolute offset is stable under append-only growth: rows already on
   * screen keep the same index forever, so appending below them never
   * moves them. Paired with footerFollowingEnd exactly as pi-tui's own
   * ScrollView pairs currentScrollTop with followingEnd -- both re-synced
   * against the real content/viewport size on every render (paintRegion),
   * not just clamped reactively when a scroll method happens to run.
   */
  private footerScrollTop = 0;
  /** True by default -- tmux/pi-tui/opentui's own convention for chat/logs: always show the newest rows as they arrive, until the user deliberately scrolls away. */
  private footerFollowingEnd = true;

  /** Reveals older rows -- Page Up while the footer is focused, tmux copy-mode/opentui ScrollBox's own line-scroll convention. Pauses following; re-arms automatically (see paintRegion) once scrolled back down to the live bottom. */
  scrollFooterUp(lines: number): void {
    this.footerFollowingEnd = false;
    this.footerScrollTop = Math.max(0, this.footerScrollTop - Math.max(0, lines));
  }
  /** Scrolls back toward the live bottom -- Page Down. */
  scrollFooterDown(lines: number): void { this.footerScrollTop += Math.max(0, lines); }

  project(world: WorldViewModel, width: number, height: number, footerChat?: FooterChatStatus): Outcome<GridFrame> {
    // A footer taller than what layoutWorldRegions accepts for this exact
    // viewport (its own footerHeight <= height - 2 bound) would otherwise
    // reject the whole render -- e.g. a footer expanded at a tall terminal,
    // then the terminal shrinks. Clamping here means a later expandFooter()
    // (or the terminal growing back) can still recover the originally
    // requested size without the caller having to track viewport history.
    const effectiveFooterHeight = Math.min(this.requestedFooterHeight, Math.max(MIN_FOOTER_HEIGHT, height - 2));
    const layout = layoutWorldRegions(world, width, height, effectiveFooterHeight);
    if (!layout.ok) return { ok: false, error: { code: "invalid-dimensions", message: layout.issues.join("; "), context: { width, height } } };
    const created = createGridFrame(gridId("alignment-shell"), width, height);
    if (!created.ok) return created;
    const frame = created.value;
    if (this.fullscreenTarget !== null) {
      const target = this.fullscreenTarget;
      const region = layout.value.find((candidate) => candidate.kind === target);
      if (!region) return { ok: false, error: { code: "invalid-dimensions", message: `fullscreen target region "${target}" missing from layout`, context: { width, height } } };
      return this.renderFullscreen(frame, region, target, width, height, footerChat);
    }
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
      const rendered = this.paintRegion(frame, area, region, titleStyle, footerChat);
      if (!rendered.ok) return rendered;
    }
    const bordered = this.paintFrameBorders(frame, layout.value, width, height);
    if (!bordered.ok) return bordered;
    return { ok: true, value: frame };
  }

  /**
   * Renders a single Surface stretched across the entire viewport, inside
   * its own simple box (no internal splits -- unlike paintFrameBorders,
   * which derives a shared topology across all five tiled regions). Reuses
   * paintRegion unchanged: it only ever reads the `area` Rect it's given,
   * never the region's own natural rect, so the same body/footer rendering
   * logic just stretches to fill whatever area it's handed.
   */
  private renderFullscreen(frame: GridFrame, region: Region, target: "body" | "footer", width: number, height: number, footerChat?: FooterChatStatus): Outcome<GridFrame> {
    const inner = createRect(1, 1, width - 2, height - 2);
    if (!inner.ok) return inner;
    for (let row = 0; row < inner.value.height; row++) {
      const fill = paint(frame, inner.value, 0, row, " ".repeat(inner.value.width), BASE);
      if (!fill.ok) return fill;
    }
    const titleStyle: CellStyle = { ...BASE, bold: true, inverse: true }; // the sole visible region is always the focused one
    const rendered = this.paintRegion(frame, inner.value, region, titleStyle, footerChat);
    if (!rendered.ok) return rendered;
    const boxed = this.paintFullscreenBox(frame, target, width, height);
    if (!boxed.ok) return boxed;
    return { ok: true, value: frame };
  }

  private paintFullscreenBox(frame: GridFrame, target: "body" | "footer", width: number, height: number): Outcome<void> {
    const area = createRect(0, 0, width, height);
    if (!area.ok) return area;
    const horizontal = "\u2500".repeat(Math.max(0, width - 2));
    const top = paintText(frame, area.value, 0, 0, `\u250c${horizontal}\u2510`, BORDER_ACTIVE, 1);
    if (!top.ok) return top;
    const bottom = paintText(frame, area.value, 0, height - 1, `\u2514${horizontal}\u2518`, BORDER_ACTIVE, 1);
    if (!bottom.ok) return bottom;
    for (let row = 1; row < height - 1; row++) {
      const left = paintText(frame, area.value, 0, row, "\u2502", BORDER_ACTIVE, 1);
      if (!left.ok) return left;
      const right = paintText(frame, area.value, width - 1, row, "\u2502", BORDER_ACTIVE, 1);
      if (!right.ok) return right;
    }
    const label = target === "body" ? "Alignment \u2014 Body (fullscreen)" : "Alignment \u2014 Chat (fullscreen)";
    return labelSegment(frame, area.value, 1, width - 1, 0, label, BORDER_ACTIVE);
  }

  private paintRegion(frame: GridFrame, area: Rect, region: Region, title: CellStyle, footerChat?: FooterChatStatus): Outcome<void> {
    if (region.kind === "header") return { ok: true, value: undefined }; // embedded into the top border row by paintFrameBorders
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
    // Footer row 0 is the border separator and row (height-1) is the bottom
    // border. At the default MIN_FOOTER_HEIGHT there's exactly one content
    // row, shared by the "Chat" heading and the live status (unchanged from
    // before expand/collapse existed). Once expanded past that (see
    // expandFooter()), row 1 becomes a heading of its own, the composer moves
    // to the last content row, and everything between shows real history --
    // presentation-only in both cases, not fed back through World/CommandIntent
    // (see the driven-session-port task's own notes on why).
    const contentRows = area.height - 2;
    const heading = paint(frame, area, 1, 1, "Chat", title);
    if (!heading.ok) return heading;
    if (footerChat) {
      if (contentRows <= 1) {
        const contentX = 7;
        const line = footerChatLine(footerChat, Math.max(0, area.width - contentX - 1));
        return paint(frame, area, contentX, 1, line.text, line.style);
      }
      // A dedicated status row sits directly above the composer -- see
      // footerStatusLine's own doc comment for why (Pi TUI's statusContainer
      // vs. editorContainer split). Reserved whenever there's room for one
      // (contentRows >= 3: heading + status + composer); a footer expanded
      // only barely past its minimum degrades to the old heading+composer
      // layout with no history and no separate status row, same as before.
      const hasStatusRow = contentRows >= 3;
      const historyRows = Math.max(0, contentRows - (hasStatusRow ? 3 : 2));
      const items = "items" in footerChat ? footerChat.items : [];
      // Wrap-then-window (tmux's own scrollback, pi-tui's ScrollView, opentui's
      // ScrollBox all converge on this split): every item is wrapped into as
      // many real rows as it needs -- never truncated to fit one row -- and
      // *that* flat row buffer is what a scroll offset windows into, not the
      // item list itself.
      const allRows = wrapFooterHistory(items, Math.max(0, area.width - 2));
      // Re-synced every render, exactly like pi-tui's own ScrollView.updateLayout():
      // following pins to the true bottom as content grows; not-following clamps
      // whatever scrollTop is already held against the current max (never past
      // it, e.g. after the terminal shrinks or history is trimmed by MAX_ITEMS),
      // and re-arms following the moment that clamp lands exactly on the bottom.
      const maxScrollTop = Math.max(0, allRows.length - historyRows);
      this.footerScrollTop = this.footerFollowingEnd ? maxScrollTop : Math.min(this.footerScrollTop, maxScrollTop);
      if (this.footerScrollTop >= maxScrollTop) this.footerFollowingEnd = true;
      const visible = allRows.slice(this.footerScrollTop, this.footerScrollTop + historyRows);
      const startPad = historyRows - visible.length;
      for (let index = 0; index < visible.length; index++) {
        const y = 2 + startPad + index;
        const line = visible[index]!;
        if (line.background !== undefined) {
          const rowFill = paint(frame, area, 0, y, " ".repeat(area.width), { background: line.background });
          if (!rowFill.ok) return rowFill;
        }
        const painted = paint(frame, area, 1, y, line.text, line.style);
        if (!painted.ok) return painted;
      }
      if (hasStatusRow) {
        const statusLine = footerStatusLine(footerChat, Math.max(0, area.width - 2));
        const paintedStatus = paint(frame, area, 1, area.height - 3, statusLine.text, statusLine.style);
        if (!paintedStatus.ok) return paintedStatus;
      }
      const composerLine = footerComposerLine(footerChat, Math.max(0, area.width - 2));
      return paint(frame, area, 1, area.height - 2, composerLine.text, composerLine.style);
    }
    const status = region.chat.state === "unavailable" ? "Agent unavailable" : "Agent ready";
    return paint(frame, area, 6, 1, ` \u00b7 ${status}`, MUTED);
  }

  private paintFrameBorders(frame: GridFrame, regions: readonly Region[], width: number, height: number): Outcome<void> {
    const topology = deriveBorderTopology(regions, width, height);
    if (!topology.ok) return topology;
    const t = topology.value;
    const fullArea = createRect(0, 0, width, height);
    if (!fullArea.ok) return fullArea;
    const focus = this.focusedRegion();
    const bordered = paintBorders(frame, t, width, height, focus, { base: MUTED, active: BORDER_ACTIVE });
    if (!bordered.ok) return bordered;
    const header = regions.find((region): region is Extract<Region, { kind: "header" }> => region.kind === "header");
    if (!header) return { ok: true, value: undefined };
    const headerStyle: CellStyle = { ...BASE, bold: true, inverse: focus === "header" };
    const brand = labelSegment(frame, fullArea.value, t.verticalOuterLeft + 1, t.verticalLeftSplit, t.horizontalTop, "Alignment", headerStyle);
    if (!brand.ok) return brand;
    const carouselText = header.carousel.state === "empty" ? "Windows: none" : "Windows";
    return labelSegment(frame, fullArea.value, t.verticalLeftSplit + 1, t.verticalRightSplit, t.horizontalTop, carouselText, headerStyle);
  }
}
