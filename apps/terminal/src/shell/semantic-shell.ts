import { layoutWorldRegions, MIN_FOOTER_HEIGHT, type AppletContent, type Panel, type Region, type SurfaceId, type WorldViewModel } from "@zodiac/protocol";
import { computeTileRects } from "@zodiac/server/window";
import { deriveBorderTopology, labelSegment, paintBorders } from "../frame/border.js";
import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createGridFrame, createRect, gridId, paintText, type CellStyle, type GridFrame, type Outcome, type Rect } from "@zodiac/tui";
import { paintSurfaceTiles } from "../frame/surface-tiles.js";
import type { FooterChatStatus } from "../pi/footer-chat-controller.js";
import { mountComponent } from "@zodiac/tui";
import { wrapFooterHistory } from "./footer-history-wrap.js";

/** How many rows one Ctrl+Up/Ctrl+Down expandFooter()/collapseFooter() step changes -- see SemanticShellApplication's own footer-focused keybinding. */
const FOOTER_RESIZE_STEP = 3;
/** A generous cap on the *requested* footer height, independent of the current viewport -- project() always clamps the effective value to what the real viewport can hold, so this only bounds how far a request can run ahead of a terminal that later shrinks. */
const MAX_REQUESTED_FOOTER_HEIGHT = 200;

/**
 * "external" means a mounted extension Component (ExtensionUIContext.custom())
 * now owns all keyboard input -- never part of the normal Tab/Shift+Tab
 * five-region cycle (see FOCUS_ORDER, which deliberately excludes it), only
 * ever entered via enterExternal() and left via exitExternal() (the
 * facade's own done() callback).
 */
export type ShellFocus = "header" | "left-pillar" | "body" | "right-pillar" | "footer" | "external";
type CyclableShellFocus = Exclude<ShellFocus, "external">;
const FOCUS_ORDER: readonly CyclableShellFocus[] = ["header", "left-pillar", "body", "right-pillar", "footer"];
const BASE: CellStyle = { foreground: 7 };
const MUTED: CellStyle = { foreground: 6, dim: true };
const BORDER_ACTIVE: CellStyle = { ...BASE, bold: true };
const ERROR_STYLE: CellStyle = { foreground: 1 };
const WORKFLOW_HINT = "^O Explorer  ^E Editor  ^T Shell";

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

const LOCATION_FOCUS: Record<Extract<Region, { kind: "panel" }>["location"], CyclableShellFocus> = { top: "header", left: "left-pillar", right: "right-pillar", bottom: "footer" };

function regionFocus(region: Region): ShellFocus {
  return region.kind === "body" ? "body" : LOCATION_FOCUS[region.location];
}

/** Whichever ShellFocus currently corresponds to the Panel hosting the chat Applet, wherever panel.move has actually put it -- null only if chat is somehow absent from every Panel body, which the 5-region invariant means shouldn't happen in practice. */
function findChatHostFocus(regions: readonly Region[]): CyclableShellFocus | null {
  for (const region of regions) {
    if (region.kind === "panel" && findApplet(region.body, "chat")) return LOCATION_FOCUS[region.location];
  }
  return null;
}

type AppletContentOf<T extends AppletContent["appletId"]> = Extract<AppletContent, { appletId: T }>;

function findApplet<T extends AppletContent["appletId"]>(body: readonly AppletContent[], appletId: T): AppletContentOf<T> | undefined {
  return body.find((applet): applet is AppletContentOf<T> => applet.appletId === appletId);
}

/** A Panel's own border-embedded title -- generalizes what used to be a fixed per-"kind" label (the header's "Windows"/"Windows: none", each pillar's "Workspaces"/"Integrations", the footer's "Chat") to whichever Applet is actually first in that Location's body. `fallback` only covers `region` itself being absent (the 5-region invariant means this shouldn't happen in practice, purely defensive) -- a real, empty body (e.g. a Location an Applet has just moved away from) renders a genuinely blank label, never the fallback text, or the border would lie about content that isn't there. */
function panelBorderLabel(region: Extract<Region, { kind: "panel" }> | undefined, fallback: string): string {
  if (!region) return fallback;
  const first = region.body[0];
  if (!first) return "";
  switch (first.appletId) {
    case "window-carousel": return first.carousel.state === "empty" ? "Windows: none" : "Windows";
    case "workspace-nav": return "Workspaces";
    case "integrations-nav": return "Integrations";
    case "chat": return "Chat";
  }
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
  /** Non-null means that Surface fills the entire viewport, hiding every other region -- see enterFullscreen's own doc comment. Only ever "body" or wherever chat is currently docked (chatHostFocus): header/pillars are chrome, not a Surface, unless chat itself has been relocated there. */
  private fullscreenTarget: CyclableShellFocus | null = null;
  /** Recomputed every project() call from the real, current Panel layout -- defaults to "footer" (chat's own default placement) so a command issued before the first render still behaves exactly as it always has. See findChatHostFocus's own doc comment. */
  private chatHostFocus: CyclableShellFocus | null = "footer";
  /** Non-null means an extension-mounted Component (ExtensionUIContext.custom()) owns the entire viewport and all keyboard input -- see enterExternal's own doc comment. */
  private externalComponent: Component | null = null;

  /** "external" overrides whatever the underlying Tab-cycle position is -- restored automatically once exitExternal() runs, since focusIndex itself is never touched while external. */
  focusedRegion(): ShellFocus { return this.externalComponent ? "external" : FOCUS_ORDER[this.focusIndex]!; }
  /** Fullscreen (and external focus) hide every region but the focused one, so there is nothing else to move focus to -- mirrors tmux disabling pane navigation while a pane is zoomed. */
  focusNext(): ShellFocus { if (this.fullscreenTarget === null && this.externalComponent === null) this.focusIndex = (this.focusIndex + 1) % FOCUS_ORDER.length; return this.focusedRegion(); }
  focusPrevious(): ShellFocus { if (this.fullscreenTarget === null && this.externalComponent === null) this.focusIndex = (this.focusIndex - 1 + FOCUS_ORDER.length) % FOCUS_ORDER.length; return this.focusedRegion(); }

  /**
   * Gives an extension-mounted Component (ExtensionUIContext.custom()'s own
   * return value) full ownership of the viewport and every keystroke --
   * SemanticShellApplication.handleInput() checks hasExternalComponent()
   * before ever reaching resolveShellCommand(), routing raw bytes straight
   * to externalComponentHandle()!.handleInput(data) instead. Mirrors a real
   * `pi` TUI session showing a `ctx.ui.custom()` overlay: while it's up,
   * pi's own chrome (footer, pillars, ...) receives no input at all.
   */
  enterExternal(component: Component): void { this.externalComponent = component; }
  /** Hands focus back to whatever region held it before enterExternal() -- focusIndex was never touched, so this is exact, not a guess. Called by the facade's own done() callback. */
  exitExternal(): void { this.externalComponent = null; }
  hasExternalComponent(): boolean { return this.externalComponent !== null; }
  externalComponentHandle(): Component | null { return this.externalComponent; }

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
    if (focus === "external") return;
    if (focus === "body" || focus === this.chatHostFocus) this.fullscreenTarget = focus;
  }

  /** Restores the normal tiled layout -- a no-op if not currently fullscreen. */
  exitFullscreen(): void { this.fullscreenTarget = null; }

  /** Grows the Footer by one step (Neovim/tmux-style incremental resize) -- clamped against the real viewport lazily, in project(), not here. A no-op once chat has moved away from bottom (chatHostFocus !== "footer"): layoutWorldRegions's own footerHeight parameter always resizes the bottom Location specifically (see its own doc comment), so growing it once nothing chat-relevant is there anymore would just inflate an unrelated, likely-empty Panel. */
  expandFooter(): void { if (this.chatHostFocus === "footer") this.requestedFooterHeight = Math.min(this.requestedFooterHeight + FOOTER_RESIZE_STEP, MAX_REQUESTED_FOOTER_HEIGHT); }
  /** Shrinks the Footer by one step, down to its default single-row size -- never smaller, since MIN_FOOTER_HEIGHT is the smallest a footer can render at all. Same chatHostFocus guard as expandFooter(). */
  collapseFooter(): void { if (this.chatHostFocus === "footer") this.requestedFooterHeight = Math.max(this.requestedFooterHeight - FOOTER_RESIZE_STEP, MIN_FOOTER_HEIGHT); }

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
    if (this.chatHostFocus !== "footer") return;
    this.footerFollowingEnd = false;
    this.footerScrollTop = Math.max(0, this.footerScrollTop - Math.max(0, lines));
  }
  /** Scrolls back toward the live bottom -- Page Down. Same chatHostFocus guard as scrollFooterUp(). */
  scrollFooterDown(lines: number): void { if (this.chatHostFocus === "footer") this.footerScrollTop += Math.max(0, lines); }

  project(world: WorldViewModel, width: number, height: number, footerChat?: FooterChatStatus, panels: readonly Panel[] = []): Outcome<GridFrame> {
    // A footer taller than what layoutWorldRegions accepts for this exact
    // viewport (its own footerHeight <= height - 2 bound) would otherwise
    // reject the whole render -- e.g. a footer expanded at a tall terminal,
    // then the terminal shrinks. Clamping here means a later expandFooter()
    // (or the terminal growing back) can still recover the originally
    // requested size without the caller having to track viewport history.
    const effectiveFooterHeight = Math.min(this.requestedFooterHeight, Math.max(MIN_FOOTER_HEIGHT, height - 2));
    const layout = layoutWorldRegions(world, width, height, effectiveFooterHeight, panels);
    if (!layout.ok) return { ok: false, error: { code: "invalid-dimensions", message: layout.issues.join("; "), context: { width, height } } };
    this.chatHostFocus = findChatHostFocus(layout.value);
    const created = createGridFrame(gridId("zodiac-shell"), width, height);
    if (!created.ok) return created;
    const frame = created.value;
    if (this.externalComponent !== null) {
      // A real 100%/100% overlay -- no borders, no other region, exactly
      // what an extension's ctx.ui.custom() overlay expects: it owns the
      // whole viewport, not a tile within it. mountComponent's own bounds
      // clipping (via paintText) is what keeps this safe even if the
      // component renders more rows/columns than width/height provide.
      const fullArea = createRect(0, 0, width, height);
      if (!fullArea.ok) return fullArea;
      const mounted = mountComponent(frame, fullArea.value, this.externalComponent);
      if (!mounted.ok) return mounted;
      return { ok: true, value: frame };
    }
    if (this.fullscreenTarget !== null) {
      const target = this.fullscreenTarget;
      const region = layout.value.find((candidate) => regionFocus(candidate) === target);
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
  private renderFullscreen(frame: GridFrame, region: Region, target: CyclableShellFocus, width: number, height: number, footerChat?: FooterChatStatus): Outcome<GridFrame> {
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

  private paintFullscreenBox(frame: GridFrame, target: CyclableShellFocus, width: number, height: number): Outcome<void> {
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
    const label = target === "body" ? "Zodiac \u2014 Body (fullscreen)" : "Zodiac \u2014 Chat (fullscreen)";
    return labelSegment(frame, area.value, 1, width - 1, 0, label, BORDER_ACTIVE);
  }

  /** Paints the active Window's live tile as bordered, titled Surface boxes; falls back to a single centered label when the world is empty or the Window has no docked Surfaces yet. */
  private paintBody(frame: GridFrame, area: Rect, region: Extract<Region, { kind: "body" }>, title: CellStyle): Outcome<void> {
    // Persistent command affordance: visible before a user knows which key can open a help sheet.
    const hintX = Math.max(0, Math.floor((area.width - visibleWidth(WORKFLOW_HINT)) / 2));
    const hinted = paint(frame, area, hintX, 0, WORKFLOW_HINT, MUTED);
    if (!hinted.ok) return hinted;
    const content = region.content;
    if (content.state === "empty" || content.tile === null) {
      const label = content.state === "empty" ? content.watermark : content.title;
      return paint(frame, area, Math.max(0, Math.floor((area.width - label.length) / 2)), Math.floor(area.height / 2), label, title);
    }
    const titled = paint(frame, area, 1, 1, content.title, title);
    if (!titled.ok) return titled;
    const inner = createRect(area.x + 1, area.y + 2, Math.max(0, area.width - 2), Math.max(0, area.height - 3));
    if (!inner.ok) return inner;
    const placements = computeTileRects(content.tile, inner.value);
    if (!placements.ok) return { ok: false, error: { code: "invalid-dimensions", message: `tile geometry failed: ${placements.reason}`, context: { width: inner.value.width, height: inner.value.height } } };
    const titleFor = (surfaceId: SurfaceId): string => content.surfaces.find((surface) => surface.id === surfaceId)?.title ?? surfaceId;
    return paintSurfaceTiles(frame, placements.value, titleFor, { border: MUTED, title });
  }

  private paintRegion(frame: GridFrame, area: Rect, region: Region, title: CellStyle, footerChat?: FooterChatStatus): Outcome<void> {
    if (region.kind === "body") return this.paintBody(frame, area, region, title);
    const chatApplet = findApplet(region.body, "chat");
    // A Panel's own body content starts immediately at row 1, not row 3 --
    // its title ("Workspaces"/"Windows"/"Chat"/...) rides the border itself
    // (see paintFrameBorders/panelBorderLabel), never a separate content
    // heading painted here.
    if (!chatApplet) {
      // An items-shaped Applet (workspace-nav/integrations-nav) shows its first item or "(none)".
      const itemsApplet = region.body.find((applet): applet is Extract<AppletContent, { items: unknown }> => "items" in applet);
      if (!itemsApplet) return { ok: true, value: undefined };
      return paint(frame, area, 1, 1, itemsApplet.items.length === 0 ? "(none)" : itemsApplet.items[0]!.label, MUTED);
    }
    // Row 0 is the border separator and row (height-1) is the far border --
    // at the default single content row (MIN_FOOTER_HEIGHT, or any Location's
    // own fixed default thickness) that one row holds the live status line;
    // once genuinely tall enough (expandFooter() at bottom -- the only
    // Location layoutWorldRegions lets live-resize -- or a real Panel giving
    // chat real room somewhere else) the composer gets its own row and
    // everything between shows real history. Driven by the region's actual
    // height, not by "is this literally the Location named bottom": wherever
    // panel.move has put the chat Applet, this is the same check -- see
    // findChatHostFocus's own doc comment for the analogous fullscreen/resize
    // generalization. Presentation-only either way, not fed back through
    // World/CommandIntent (see the driven-session-port task's own notes on why).
    const contentRows = area.height - 2;
    if (footerChat && contentRows > 1) {
      // A dedicated status row sits directly above the composer -- see
      // footerStatusLine's own doc comment for why (Pi TUI's statusContainer
      // vs. editorContainer split). Always reachable here: the contentRows <= 1
      // guard above already excludes the only case (a single content row) too
      // small to hold both a status row and the composer.
      const historyRows = Math.max(0, contentRows - 2);
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
        const y = 1 + startPad + index;
        const line = visible[index]!;
        if (line.background !== undefined) {
          const rowFill = paint(frame, area, 0, y, " ".repeat(area.width), { background: line.background });
          if (!rowFill.ok) return rowFill;
        }
        // Markdown rendering (footer-history-wrap.ts's markdownRows) can split
        // one row into several differently-styled segments -- a bold word next
        // to plain text, a heading's color next to nothing -- so each row is
        // painted run by run, advancing by each run's own display width
        // (never just its character count: wide graphemes exist in real
        // assistant replies) rather than assuming one style per row.
        let x = 1;
        for (const segment of line.segments) {
          const painted = paint(frame, area, x, y, segment.text, segment.style);
          if (!painted.ok) return painted;
          x += visibleWidth(segment.text);
        }
      }
      const statusLine = footerStatusLine(footerChat, Math.max(0, area.width - 2));
      const paintedStatus = paint(frame, area, 1, area.height - 3, statusLine.text, statusLine.style);
      if (!paintedStatus.ok) return paintedStatus;
      const composerLine = footerComposerLine(footerChat, Math.max(0, area.width - 2));
      return paint(frame, area, 1, area.height - 2, composerLine.text, composerLine.style);
    }
    if (footerChat) {
      const line = footerChatLine(footerChat, Math.max(0, area.width - 2));
      return paint(frame, area, 1, 1, line.text, line.style);
    }
    const status = chatApplet.chat.state === "unavailable" ? "Agent unavailable" : "Agent ready";
    return paint(frame, area, 1, 1, status, MUTED);
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
    // Panel titles ride their own top-border segment, the same slot
    // "Zodiac" used to sit in, rather than a separate content heading one
    // row down -- one fewer thing painted per frame, and it reads exactly
    // like tmux/zellij's own pane-title-in-the-border convention. Generic
    // over whichever Applet actually occupies each Location now (see
    // panelBorderLabel), not a fixed per-side label.
    const leftPanel = regions.find((region): region is Extract<Region, { kind: "panel" }> => region.kind === "panel" && region.location === "left");
    const rightPanel = regions.find((region): region is Extract<Region, { kind: "panel" }> => region.kind === "panel" && region.location === "right");
    const topPanel = regions.find((region): region is Extract<Region, { kind: "panel" }> => region.kind === "panel" && region.location === "top");
    // Each segment's own inverse-when-focused styling mirrors exactly which
    // ShellFocus value highlights that segment's own region -- the header
    // region's real focus for the middle ("Windows") segment, but
    // left-pillar/right-pillar focus for the two segments now carrying what
    // used to be each pillar's own focus-aware content heading style.
    const leftStyle: CellStyle = { ...BASE, bold: true, inverse: focus === "left-pillar" };
    const headerStyle: CellStyle = { ...BASE, bold: true, inverse: focus === "header" };
    const rightStyle: CellStyle = { ...BASE, bold: true, inverse: focus === "right-pillar" };
    const leftLabel = labelSegment(frame, fullArea.value, t.verticalOuterLeft + 1, t.verticalLeftSplit, t.horizontalTop, panelBorderLabel(leftPanel, "Workspaces"), leftStyle);
    if (!leftLabel.ok) return leftLabel;
    const windows = labelSegment(frame, fullArea.value, t.verticalLeftSplit + 1, t.verticalRightSplit, t.horizontalTop, panelBorderLabel(topPanel, "Windows: none"), headerStyle);
    if (!windows.ok) return windows;
    const rightLabel = labelSegment(frame, fullArea.value, t.verticalRightSplit + 1, t.verticalOuterRight, t.horizontalTop, panelBorderLabel(rightPanel, "Integrations"), rightStyle);
    if (!rightLabel.ok) return rightLabel;
    // The bottom Panel's own title rides the outer bottom border, centered
    // across its full width (no left/right vertical split there the way the
    // header row has) -- see paintRegion's own "bottom" branch for the
    // corresponding content-row shift.
    const bottomPanel = regions.find((region): region is Extract<Region, { kind: "panel" }> => region.kind === "panel" && region.location === "bottom");
    const footerStyle: CellStyle = { ...BASE, bold: true, inverse: focus === "footer" };
    return labelSegment(frame, fullArea.value, t.verticalOuterLeft + 1, t.verticalOuterRight, t.horizontalBottom, panelBorderLabel(bottomPanel, "Chat"), footerStyle);
  }
}
