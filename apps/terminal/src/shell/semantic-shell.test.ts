import { createWorldStore } from "@zodiac/server/world";
import { integrationId, layoutWorldRegions, workspaceId, worldId } from "@zodiac/protocol";
import { renderToTerminal } from "@danypops/pi-tui-harness";
import { describe, expect, it } from "vitest";
import { diffFrames, type GridFrame } from "../frame/index.js";
import { encodeGridUpdate } from "../terminal/grid-terminal.js";
import { SemanticShell } from "./semantic-shell.js";

/** Absolute cell index for a footer-region-relative (x, y) offset -- mirrors border.test.ts's own `t.horizontalTop * width + x` convention, computed from the real Region layout rather than hand-derived magic numbers. */
function footerCellIndex(width: number, height: number, footerHeight: number, relativeX: number, relativeY: number): number {
  const layout = layoutWorldRegions({ state: "empty", workspaces: [], activeWorkspaceId: null }, width, height, footerHeight);
  if (!layout.ok) throw new Error(layout.issues.join("; "));
  const footer = layout.value.find((region) => region.kind === "footer");
  if (!footer) throw new Error("no footer region");
  return (footer.rect.y + relativeY) * width + (footer.rect.x + relativeX);
}

function cellStyleAt(frame: GridFrame, index: number) {
  return frame.cells[index]!.style;
}

/** Plain text of one row, read starting at `startIndex` for `width` cells -- for asserting a row's content irrespective of style, e.g. "the composer line contains the draft but not a spinner glyph". */
function renderRowText(frame: GridFrame, width: number, startIndex: number): string {
  return frame.cells.slice(startIndex, startIndex + width).map((cell) => cell.grapheme).join("");
}

/** Mirrors paintRegion's own bottom-alignment formula (history rows are padded from the top when there are fewer items than available rows) -- computed here instead of assuming a fixed row, since a single-item test would otherwise land on the wrong row. "Chat" now lives on the outer border (not a content heading), so this reserves only a dedicated status row directly above the composer (see the "spinner lives in its own row" tests below) and the composer's own last row -- 2 rows total, not 3. */
function historyRowFor(footerHeight: number, itemCount: number, itemIndex: number): number {
  const historyRows = footerHeight - 2 - 2;
  const startPad = historyRows - itemCount;
  return 1 + startPad + itemIndex;
}

/** The dedicated status row directly above the composer's own last row -- mirrors Pi TUI's own statusContainer, which sits structurally above (never inside) editorContainer. */
function statusRowFor(footerHeight: number): number {
  return footerHeight - 3;
}

function composerRowFor(footerHeight: number): number {
  return footerHeight - 2;
}

async function render(width: number, height: number, focusSteps = 0) {
  const shell = new SemanticShell();
  for (let index = 0; index < focusSteps; index++) shell.focusNext();
  const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), width, height);
  if (!frame.ok) throw new Error(frame.error.message);
  const update = diffFrames(undefined, frame.value);
  if (!update.ok) throw new Error(update.error.message);
  const encoded = encodeGridUpdate(update.value);
  if (!encoded.ok) throw new Error(encoded.error.message);
  return { shell, frame: frame.value, terminal: await renderToTerminal([encoded.value], { cols: width, rows: height }) };
}

describe("semantic empty Zodiac shell", () => {
  it.each([[60, 12], [80, 24], [120, 40]])("renders all five semantic regions at %ix%i", async (width, height) => {
    const result = await render(width, height);
    try {
      const text = result.terminal.plainLines().join("\n");
      expect(text).toContain("Windows: none");
      expect(text).toContain("Workspaces");
      expect(text).toContain("No workspace open");
      expect(text).toContain("Integrations");
      expect(text).toContain("Chat");
      expect(text).toContain("Agent unavailable");
    } finally { result.terminal.dispose(); }
  });

  it("embeds Workspaces/Integrations/Chat into the border itself, like the header's own brand used to, rather than as separate content headings", async () => {
    const result = await render(80, 24);
    try {
      const lines = result.terminal.plainLines();
      // The top border row carries both pillar names now -- "Zodiac" is gone entirely.
      expect(lines[0]).toContain("Workspaces");
      expect(lines[0]).toContain("Integrations");
      expect(lines[0]).not.toContain("Zodiac");
      // The outer bottom border row carries "Chat", centered.
      expect(lines.at(-1)).toContain("Chat");
      // Each pillar's own content starts immediately at row 1 (no heading row
      // eating the first content line above the item list) -- "(none)" (the
      // empty-items placeholder) is the very first thing painted there.
      expect(lines[2]?.slice(1).trimEnd().startsWith("(none)")).toBe(true);
    } finally { result.terminal.dispose(); }
  });

  it("traverses focus deterministically and changes only semantic focus styling", async () => {
    const initial = await render(60, 16);
    const next = await render(60, 16, 1);
    try {
      expect(initial.shell.focusedRegion()).toBe("header");
      expect(next.shell.focusedRegion()).toBe("left-pillar");
      expect(initial.frame.cells.filter(cell => cell.style.inverse).length).toBeGreaterThan(0);
      expect(next.frame.cells.filter(cell => cell.style.inverse).length).toBeGreaterThan(0);
      expect(initial.terminal.plainLines()).toEqual(next.terminal.plainLines());
    } finally { initial.terminal.dispose(); next.terminal.dispose(); }
  });

  it("returns the typed viewport failure instead of rendering below minimum size", () => {
    expect(new SemanticShell().project({ state: "empty", workspaces: [], activeWorkspaceId: null }, 19, 7)).toMatchObject({ ok: false, error: { code: "invalid-dimensions" } });
  });

  it("expandFooter()/collapseFooter() grow and shrink the footer, leaving the body shorter to compensate", async () => {
    // The body's vertically-centered watermark moves to an earlier row once
    // the footer below it grows and takes more of the viewport -- a
    // black-box way to prove the footer's own height actually changed,
    // without reaching into Region internals this test has no access to.
    async function watermarkRow(shell: SemanticShell): Promise<number> {
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24);
      if (!frame.ok) throw new Error(frame.error.message);
      const update = diffFrames(undefined, frame.value);
      if (!update.ok) throw new Error(update.error.message);
      const encoded = encodeGridUpdate(update.value);
      if (!encoded.ok) throw new Error(encoded.error.message);
      const terminal = await renderToTerminal([encoded.value], { cols: 80, rows: 24 });
      try {
        return terminal.plainLines().findIndex((line) => line.includes("No workspace open"));
      } finally { terminal.dispose(); }
    }

    const shell = new SemanticShell();
    const collapsedRow = await watermarkRow(shell);
    shell.expandFooter();
    const expandedRow = await watermarkRow(shell);
    shell.collapseFooter();
    const recollapsedRow = await watermarkRow(shell);

    expect(expandedRow).toBeLessThan(collapsedRow);
    expect(recollapsedRow).toBe(collapsedRow);
  });

  it("collapseFooter() never shrinks below the default single-row minimum", () => {
    const shell = new SemanticShell();
    shell.collapseFooter();
    shell.collapseFooter();
    const result = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24);
    expect(result.ok).toBe(true); // never rejected -- collapsing past the floor is a no-op, not an error
  });

  it("an expanded footer clamps to whatever a smaller viewport can actually hold, instead of failing the whole render", () => {
    const shell = new SemanticShell();
    for (let i = 0; i < 10; i++) shell.expandFooter(); // request a footer far taller than a small viewport allows
    const result = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 60, 12);
    expect(result.ok).toBe(true);
  });

  it("renders real conversation history once the footer is expanded past its default single row, with the message text itself -- no invented role-label prefix Pi TUI doesn't have", async () => {
    const shell = new SemanticShell();
    shell.expandFooter();
    shell.expandFooter();
    const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, {
      kind: "idle",
      draft: "",
      items: [
        { role: "user", text: "hello" },
        { role: "assistant", text: "hi there" },
      ],
    });
    if (!frame.ok) throw new Error(frame.error.message);
    const update = diffFrames(undefined, frame.value);
    if (!update.ok) throw new Error(update.error.message);
    const encoded = encodeGridUpdate(update.value);
    if (!encoded.ok) throw new Error(encoded.error.message);
    const terminal = await renderToTerminal([encoded.value], { cols: 80, rows: 24 });
    try {
      const text = terminal.plainLines().join("\n");
      expect(text).toContain("hello");
      expect(text).toContain("hi there");
      expect(text).not.toContain("You:");
      expect(text).not.toContain("Pi:");
    } finally { terminal.dispose(); }
  });

  describe("Pi-TUI-authentic visual conventions for expanded Footer history", () => {
    // Pi TUI's own AssistantMessageComponent/UserMessageComponent/ToolExecutionComponent
    // (packages/coding-agent/src/modes/interactive/components/*.ts) render role via a
    // full-row highlighted background for user messages, no background for assistant
    // messages, and a background-color state machine (pending/success/error) plus a
    // bolded title for tool calls -- never an inline "You:"/"Pi:" text prefix. Zodiac's
    // GridTerminal only encodes the 8 basic ANSI colors (see grid-terminal.ts), so exact
    // hex parity with Pi's own theme is impossible, but the same role/status-driven
    // color-coding *convention* is reproduced here with that smaller palette.

    const FOOTER_HEIGHT_ONE_EXPAND = 6; // MIN_FOOTER_HEIGHT (3) + one FOOTER_RESIZE_STEP (3) -- 2 history rows available

    it("highlights a user message with a background spanning the full row, like Pi TUI's userMessageBg bubble", () => {
      const shell = new SemanticShell();
      shell.expandFooter();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, {
        kind: "idle",
        draft: "",
        items: [{ role: "user", text: "hello" }],
      });
      if (!frame.ok) throw new Error(frame.error.message);

      const row = historyRowFor(FOOTER_HEIGHT_ONE_EXPAND, 1, 0);
      // Checked at the text start and near the row's right edge, proving the
      // whole row is filled, not just under the characters.
      const atTextStart = cellStyleAt(frame.value, footerCellIndex(80, 24, FOOTER_HEIGHT_ONE_EXPAND, 1, row));
      const nearRightEdge = cellStyleAt(frame.value, footerCellIndex(80, 24, FOOTER_HEIGHT_ONE_EXPAND, 70, row));
      expect(atTextStart.background).toBeDefined();
      expect(atTextStart.background).toBe(nearRightEdge.background);
    });

    it("renders an assistant message with no special background, unlike the user's highlighted bubble", () => {
      const shell = new SemanticShell();
      shell.expandFooter();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, {
        kind: "idle",
        draft: "",
        items: [{ role: "assistant", text: "hi there" }],
      });
      if (!frame.ok) throw new Error(frame.error.message);
      const row = historyRowFor(FOOTER_HEIGHT_ONE_EXPAND, 1, 0);
      const style = cellStyleAt(frame.value, footerCellIndex(80, 24, FOOTER_HEIGHT_ONE_EXPAND, 1, row));
      expect(style.background).toBeUndefined();
    });

    it("color-codes a tool item's background by status -- pending, success, and error are visually distinct, matching Pi TUI's own toolPendingBg/toolSuccessBg/toolErrorBg", () => {
      const row = historyRowFor(FOOTER_HEIGHT_ONE_EXPAND, 1, 0);
      function toolBackground(status: "pending" | "success" | "error"): number | undefined {
        const shell = new SemanticShell();
        shell.expandFooter();
        const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, {
          kind: "idle",
          draft: "",
          items: [{ role: "tool", text: "bash", status }],
        });
        if (!frame.ok) throw new Error(frame.error.message);
        return cellStyleAt(frame.value, footerCellIndex(80, 24, FOOTER_HEIGHT_ONE_EXPAND, 1, row)).background;
      }
      const pending = toolBackground("pending");
      const success = toolBackground("success");
      const error = toolBackground("error");
      expect(pending).toBeDefined();
      expect(success).toBeDefined();
      expect(error).toBeDefined();
      expect(new Set([pending, success, error]).size).toBe(3);
    });

    it("bolds a tool call's own name, like Pi TUI's theme.bold(toolName) title", () => {
      const shell = new SemanticShell();
      shell.expandFooter();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, {
        kind: "idle",
        draft: "",
        items: [{ role: "tool", text: "bash", status: "success" }],
      });
      if (!frame.ok) throw new Error(frame.error.message);
      const row = historyRowFor(FOOTER_HEIGHT_ONE_EXPAND, 1, 0);
      expect(cellStyleAt(frame.value, footerCellIndex(80, 24, FOOTER_HEIGHT_ONE_EXPAND, 1, row)).bold).toBe(true);
    });

    it("does not bold user or assistant message text -- only a tool's own name is bolded", () => {
      const row = historyRowFor(FOOTER_HEIGHT_ONE_EXPAND, 1, 0);
      const shell = new SemanticShell();
      shell.expandFooter();
      const userFrame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, { kind: "idle", draft: "", items: [{ role: "user", text: "hello" }] });
      if (!userFrame.ok) throw new Error(userFrame.error.message);
      expect(cellStyleAt(userFrame.value, footerCellIndex(80, 24, FOOTER_HEIGHT_ONE_EXPAND, 1, row)).bold).toBeFalsy();

      const assistantShell = new SemanticShell();
      assistantShell.expandFooter();
      const assistantFrame = assistantShell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, { kind: "idle", draft: "", items: [{ role: "assistant", text: "hi" }] });
      if (!assistantFrame.ok) throw new Error(assistantFrame.error.message);
      expect(cellStyleAt(assistantFrame.value, footerCellIndex(80, 24, FOOTER_HEIGHT_ONE_EXPAND, 1, row)).bold).toBeFalsy();
    });
  });

  describe("the working spinner lives in its own row above the composer, like Pi TUI's separate statusContainer -- never inside the input line", () => {
    // Pi TUI's dock layout (interactive-mode.ts) mounts, top to bottom:
    // pendingMessagesContainer, statusContainer (the spinner),
    // widgetContainerAbove, editorContainer (the actual input box),
    // widgetContainerBelow, footerContainer. The spinner is a sibling
    // component *above* the editor, never text spliced into the same line
    // as the editor's own content -- reproduced here as a dedicated row.
    const FOOTER_HEIGHT_ONE_EXPAND = 6;

    it("does not splice the busy spinner into the composer's own line", () => {
      const shell = new SemanticShell();
      shell.expandFooter();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, {
        kind: "busy",
        draft: "hello",
        items: [],
      });
      if (!frame.ok) throw new Error(frame.error.message);
      const composerText = renderRowText(frame.value, 80, footerCellIndex(80, 24, FOOTER_HEIGHT_ONE_EXPAND, 0, composerRowFor(FOOTER_HEIGHT_ONE_EXPAND)));
      expect(composerText).toContain("hello");
      expect(composerText).not.toContain("\u23f3");
    });

    it("shows the spinner on its own dedicated row directly above the composer while busy", () => {
      const shell = new SemanticShell();
      shell.expandFooter();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, {
        kind: "busy",
        draft: "",
        items: [],
      });
      if (!frame.ok) throw new Error(frame.error.message);
      const statusText = renderRowText(frame.value, 80, footerCellIndex(80, 24, FOOTER_HEIGHT_ONE_EXPAND, 0, statusRowFor(FOOTER_HEIGHT_ONE_EXPAND)));
      expect(statusText).toContain("\u23f3");
    });

    it("leaves the status row blank when idle -- reserved space, not always-visible chrome, like Pi TUI's IdleStatus rendering blank lines", () => {
      const shell = new SemanticShell();
      shell.expandFooter();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, {
        kind: "idle",
        draft: "",
        items: [{ role: "assistant", text: "hi there" }],
      });
      if (!frame.ok) throw new Error(frame.error.message);
      // Read just the row's content columns (1..width-2), excluding the
      // footer's own left/right border characters at columns 0 and width-1.
      const statusText = renderRowText(frame.value, 78, footerCellIndex(80, 24, FOOTER_HEIGHT_ONE_EXPAND, 1, statusRowFor(FOOTER_HEIGHT_ONE_EXPAND)));
      expect(statusText.trim()).toBe("");
    });
  });

  describe("fullscreen -- pushes the focused Surface to fill the entire viewport, tmux resize-pane -Z / zellij ToggleFocusFullscreen style", () => {
    function fullText(frame: GridFrame): string {
      return frame.cells.map((cell) => cell.grapheme).join("");
    }

    it("fills the whole viewport with the focused body Surface's own content, hiding the pillars and header entirely", () => {
      const shell = new SemanticShell();
      shell.focusNext(); // header -> left-pillar
      shell.focusNext(); // left-pillar -> body
      expect(shell.focusedRegion()).toBe("body");
      shell.enterFullscreen();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24);
      if (!frame.ok) throw new Error(frame.error.message);
      const text = fullText(frame.value);
      expect(text).toContain("No workspace open");
      expect(text).not.toContain("Workspaces");
      expect(text).not.toContain("Integrations");
      expect(text).not.toContain("Windows");
    });

    it("draws its own simple full-viewport box, with corners at the real edges of the terminal", () => {
      const shell = new SemanticShell();
      shell.focusNext();
      shell.focusNext();
      shell.enterFullscreen();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24);
      if (!frame.ok) throw new Error(frame.error.message);
      const width = 80;
      expect(frame.value.cells[0]!.grapheme).toBe("\u250c"); // top-left
      expect(frame.value.cells[width - 1]!.grapheme).toBe("\u2510"); // top-right
      expect(frame.value.cells[23 * width]!.grapheme).toBe("\u2514"); // bottom-left
      expect(frame.value.cells[23 * width + width - 1]!.grapheme).toBe("\u2518"); // bottom-right
    });

    it("fills the whole viewport with the focused footer Surface's own real conversation history when the footer (not the body) is fullscreened", () => {
      const shell = new SemanticShell();
      shell.focusNext();
      shell.focusNext();
      shell.focusNext();
      shell.focusNext(); // -> footer
      expect(shell.focusedRegion()).toBe("footer");
      shell.enterFullscreen();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, { kind: "idle", draft: "", items: [{ role: "assistant", text: "a fullscreened reply" }] });
      if (!frame.ok) throw new Error(frame.error.message);
      const text = fullText(frame.value);
      expect(text).toContain("a fullscreened reply");
      expect(text).not.toContain("Workspaces");
    });

    it("is a no-op for header/pillar focus -- those are chrome, not a Surface a user would want to fill the screen with", () => {
      const shell = new SemanticShell();
      expect(shell.focusedRegion()).toBe("header");
      shell.enterFullscreen();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24);
      if (!frame.ok) throw new Error(frame.error.message);
      expect(fullText(frame.value)).toContain("Workspaces");
    });

    it("restores the normal tiled layout on exitFullscreen()", () => {
      const shell = new SemanticShell();
      shell.focusNext();
      shell.focusNext();
      shell.enterFullscreen();
      shell.exitFullscreen();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24);
      if (!frame.ok) throw new Error(frame.error.message);
      expect(fullText(frame.value)).toContain("Workspaces");
    });

    it("locks focus while fullscreen -- nothing else is visible to move focus to, mirroring tmux disabling pane navigation while zoomed", () => {
      const shell = new SemanticShell();
      shell.focusNext();
      shell.focusNext();
      expect(shell.focusedRegion()).toBe("body");
      shell.enterFullscreen();
      shell.focusNext();
      expect(shell.focusedRegion()).toBe("body");
      shell.focusPrevious();
      expect(shell.focusedRegion()).toBe("body");
    });
  });

  describe("Footer scrollback -- wraps long/multi-line messages across real rows and windows them, instead of truncating to one row per item", () => {
    const FOOTER_HEIGHT_TWO_ROWS = 9; // MIN_FOOTER_HEIGHT (3) + two FOOTER_RESIZE_STEP (3 each) -- 5 history rows available (contentRows 7, minus status+composer's own 2)

    it("wraps a long message across multiple real rows instead of tail-truncating it behind an ellipsis", async () => {
      const shell = new SemanticShell();
      shell.expandFooter();
      const longText = "one two three four five six seven eight nine ten eleven twelve";
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, { kind: "idle", draft: "", items: [{ role: "assistant", text: longText }] });
      if (!frame.ok) throw new Error(frame.error.message);
      const update = diffFrames(undefined, frame.value);
      if (!update.ok) throw new Error(update.error.message);
      const encoded = encodeGridUpdate(update.value);
      if (!encoded.ok) throw new Error(encoded.error.message);
      const terminal = await renderToTerminal([encoded.value], { cols: 80, rows: 24 });
      try {
        const text = terminal.plainLines().join(" ");
        for (const word of longText.split(" ")) expect(text).toContain(word);
        expect(text).not.toContain("\u2026"); // no ellipsis -- nothing was truncated
      } finally { terminal.dispose(); }
    });

    it("never joins two logical messages onto the same visual row -- each gets its own row(s)", () => {
      const shell = new SemanticShell();
      shell.expandFooter();
      shell.expandFooter();
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, {
        kind: "idle",
        draft: "",
        items: [
          { role: "assistant", text: "first reply" },
          { role: "assistant", text: "second reply" },
        ],
      });
      if (!frame.ok) throw new Error(frame.error.message);
      const firstRow = renderRowText(frame.value, 78, footerCellIndex(80, 24, FOOTER_HEIGHT_TWO_ROWS, 1, historyRowFor(FOOTER_HEIGHT_TWO_ROWS, 2, 0)));
      const secondRow = renderRowText(frame.value, 78, footerCellIndex(80, 24, FOOTER_HEIGHT_TWO_ROWS, 1, historyRowFor(FOOTER_HEIGHT_TWO_ROWS, 2, 1)));
      expect(firstRow.trim()).toBe("first reply");
      expect(secondRow.trim()).toBe("second reply");
    });



    it("defaults to showing only the newest rows (follow-bottom) when there are more rows than the viewport can hold", () => {
      const shell = new SemanticShell();
      shell.expandFooter(); // 2 history rows available
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, {
        kind: "idle",
        draft: "",
        items: [
          { role: "assistant", text: "oldest" },
          { role: "assistant", text: "second" },
          { role: "assistant", text: "third" },
          { role: "assistant", text: "newest" },
        ],
      });
      if (!frame.ok) throw new Error(frame.error.message);
      const text = frame.value.cells.map((cell) => cell.grapheme).join("");
      expect(text).toContain("third");
      expect(text).toContain("newest");
      expect(text).not.toContain("second");
      expect(text).not.toContain("oldest");
    });

    it("scrollFooterUp steps backwards through history one row at a time, and scrollFooterDown steps back to the live bottom -- absolute position, not disturbed between steps", () => {
      const shell = new SemanticShell();
      shell.expandFooter(); // 2 history rows available
      const items = [
        { role: "assistant" as const, text: "oldest" },
        { role: "assistant" as const, text: "second" },
        { role: "assistant" as const, text: "third" },
        { role: "assistant" as const, text: "newest" },
      ];
      function visibleRow(): string {
        const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, { kind: "idle", draft: "", items });
        if (!frame.ok) throw new Error(frame.error.message);
        return frame.value.cells.map((cell) => cell.grapheme).join("");
      }
      expect(visibleRow()).toContain("newest");

      shell.scrollFooterUp(1);
      const oneUp = visibleRow();
      expect(oneUp).toContain("second");
      expect(oneUp).toContain("third");
      expect(oneUp).not.toContain("newest");

      shell.scrollFooterUp(1);
      const twoUp = visibleRow();
      expect(twoUp).toContain("oldest");
      expect(twoUp).toContain("second");
      expect(twoUp).not.toContain("third");

      shell.scrollFooterDown(1);
      const oneDown = visibleRow();
      expect(oneDown).toContain("second");
      expect(oneDown).toContain("third");
      expect(oneDown).not.toContain("oldest");

      shell.scrollFooterDown(1);
      expect(visibleRow()).toContain("newest");
    });

    it("clamps scrollFooterUp when there is nothing older to reveal, instead of showing blank rows", () => {
      const shell = new SemanticShell();
      shell.expandFooter();
      const items = [{ role: "assistant" as const, text: "only message" }];
      shell.scrollFooterUp(50);
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, { kind: "idle", draft: "", items });
      if (!frame.ok) throw new Error(frame.error.message);
      expect(frame.value.cells.map((cell) => cell.grapheme).join("")).toContain("only message");
    });

    it("staying scrolled up doesn't get yanked back to the bottom when a new message arrives -- the same historical rows remain visible", () => {
      const shell = new SemanticShell();
      shell.expandFooter(); // 2 history rows available
      const items = [
        { role: "assistant" as const, text: "oldest" },
        { role: "assistant" as const, text: "second" },
        { role: "assistant" as const, text: "third" },
      ];
      shell.scrollFooterUp(1);
      const scrolledUp = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, { kind: "idle", draft: "", items });
      if (!scrolledUp.ok) throw new Error(scrolledUp.error.message);
      expect(scrolledUp.value.cells.map((cell) => cell.grapheme).join("")).toContain("oldest");

      const withNewMessage = [...items, { role: "assistant" as const, text: "brand new" }];
      const afterArrival = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24, { kind: "idle", draft: "", items: withNewMessage });
      if (!afterArrival.ok) throw new Error(afterArrival.error.message);
      const text = afterArrival.value.cells.map((cell) => cell.grapheme).join("");
      expect(text).toContain("oldest");
      expect(text).not.toContain("brand new");
    });
  });

  describe("external focus", () => {
    function componentRendering(lines: string[]) {
      return { render: () => lines, invalidate: () => {} };
    }

    it("focusedRegion() reports \"external\" once a Component is mounted, overriding whatever the underlying Tab-cycle position was", () => {
      const shell = new SemanticShell();
      shell.focusNext(); // left-pillar
      expect(shell.focusedRegion()).toBe("left-pillar");
      shell.enterExternal(componentRendering(["hi"]));
      expect(shell.focusedRegion()).toBe("external");
      expect(shell.hasExternalComponent()).toBe(true);
    });

    it("focusNext()/focusPrevious() never cycle away from external focus while a Component is mounted", () => {
      const shell = new SemanticShell();
      shell.enterExternal(componentRendering(["hi"]));
      shell.focusNext();
      expect(shell.focusedRegion()).toBe("external");
      shell.focusPrevious();
      expect(shell.focusedRegion()).toBe("external");
    });

    it("exitExternal() restores exactly the focus that was held before enterExternal() -- focusIndex was never touched", () => {
      const shell = new SemanticShell();
      shell.focusNext();
      shell.focusNext(); // body
      expect(shell.focusedRegion()).toBe("body");
      shell.enterExternal(componentRendering(["hi"]));
      shell.exitExternal();
      expect(shell.focusedRegion()).toBe("body");
      expect(shell.hasExternalComponent()).toBe(false);
    });

    it("project() renders the mounted Component as a real 100%/100% overlay -- no borders, no other region, the whole viewport", () => {
      const shell = new SemanticShell();
      shell.enterExternal(componentRendering(["first row", "second row"]));
      const frame = shell.project(createWorldStore(worldId("empty")).worldViewModel(), 80, 24);
      if (!frame.ok) throw new Error(frame.error.message);
      const text = frame.value.cells.map((cell) => cell.grapheme).join("");
      expect(text).toContain("first row");
      expect(text).toContain("second row");
      // No border glyphs at all -- project() short-circuits before paintFrameBorders ever runs.
      expect(text).not.toContain("\u2500");
      expect(text).not.toContain("\u2502");
    });

    it("externalComponentHandle() exposes the exact mounted Component instance for input routing", () => {
      const shell = new SemanticShell();
      const component = componentRendering(["hi"]);
      expect(shell.externalComponentHandle()).toBeNull();
      shell.enterExternal(component);
      expect(shell.externalComponentHandle()).toBe(component);
    });
  });
});

async function renderText(width: number, height: number, world: ReturnType<typeof createWorldStore>): Promise<string> {
  const shell = new SemanticShell();
  const frame = shell.project(world.worldViewModel(), width, height);
  if (!frame.ok) throw new Error(frame.error.message);
  const update = diffFrames(undefined, frame.value);
  if (!update.ok) throw new Error(update.error.message);
  const encoded = encodeGridUpdate(update.value);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const terminal = await renderToTerminal([encoded.value], { cols: width, rows: height });
  try {
    return terminal.plainLines().join("\n");
  } finally {
    terminal.dispose();
  }
}

describe("semantic Zodiac shell body region renders live docked Surfaces", () => {
  it("paints each docked Surface's own title as a separate box, not the single Workspace-title placeholder", async () => {
    const world = createWorldStore(worldId("w"));
    const workspace = world.createWorkspace(workspaceId("ws"), "My Workspace");
    world.dockSurface(workspace.id, integrationId("terminal"), "Terminal");
    world.dockSurface(workspace.id, integrationId("editor"), "Editor");
    const text = await renderText(80, 24, world);
    // A real bordered, titled box for each Surface -- not the plain centered-label placeholder.
    expect(text).toMatch(/\u250c\u2500+ Terminal \u2500+\u2510/);
    expect(text).toMatch(/\u250c\u2500+ Editor \u2500+\u2510/);
  });

  it("falls back to the Workspace title placeholder when the active Window has no docked Surfaces yet", async () => {
    const world = createWorldStore(worldId("w"));
    world.createWorkspace(workspaceId("ws"), "My Workspace");
    const text = await renderText(80, 24, world);
    expect(text).toContain("My Workspace");
  });

  it("undocking a Surface removes its box and leaves the remaining Surface's box painted", async () => {
    const world = createWorldStore(worldId("w"));
    const workspace = world.createWorkspace(workspaceId("ws"), "My Workspace");
    const terminal = world.dockSurface(workspace.id, integrationId("terminal"), "Terminal");
    world.dockSurface(workspace.id, integrationId("editor"), "Editor");
    world.undockSurface(workspace.id, terminal.id);
    const text = await renderText(80, 24, world);
    expect(text).not.toContain("Terminal");
    expect(text).toContain("Editor");
  });
});
