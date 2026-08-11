import type { Component, Terminal } from "@earendil-works/pi-tui";
import type { WorldViewModel } from "@alignment/surface-protocol";
import type { GridUpdate, Outcome } from "../frame/index.js";
import type { LectorHost } from "../lector/lector-host.js";
import { promptAndOpenLectorEditorNatively } from "../lector/native-editor.js";
import { openLectorExplorerNatively } from "../lector/native-explorer.js";
import type { FooterChatController } from "../pi/footer-chat-controller.js";
import { GridTerminal } from "../terminal/grid-terminal.js";
import { resolveShellCommand, type ShellCommand } from "./keymap.js";
import { openTerminalPaneNatively } from "./native-terminal.js";
import { SemanticShell, type ShellFocus } from "./semantic-shell.js";

export interface WorldProjection { worldViewModel(): WorldViewModel }

/** How many history rows one Page Up/Page Down step scrolls -- tmux copy-mode/opentui ScrollBox's own arrow-key-scrolls-by-line, Page-scrolls-by-page convention; a fixed row count rather than the exact current viewport height, matching SemanticShell's own FOOTER_RESIZE_STEP precedent for footer height. */
const FOOTER_SCROLL_STEP = 5;

export class SemanticShellApplication {
  private readonly shell = new SemanticShell();
  private readonly output: GridTerminal;
  private width = 0;
  private height = 0;

  /** Absent means no live Pi integration was constructed yet (no model configured, construction failed, still awaiting startFooterChat's own async setup, ...) -- the Footer renders its existing "unavailable" state and Enter/typing in the footer are no-ops. Not readonly: startFooterChat's own bindExtensions() call (which needs a real AlignmentExtensionUIContext, which needs a real SemanticShellApplication to route custom()'s mounted Components through) necessarily resolves *before* this application even exists in cli.ts's own construction order -- see attachFooterChat's own doc comment. */
  private footerChat?: FooterChatController;

  constructor(
    private readonly world: WorldProjection,
    terminal: Pick<Terminal, "write">,
    footerChat?: FooterChatController,
    /** Absent exactly when cli.ts started with no path argument at all (see its own `classified.kind === "none"` branch) -- "open-lector-editor" is then a silent no-op rather than throwing, matching how footer-submit is already a no-op with no footerChat. */
    private readonly lectorHost?: LectorHost,
    /** The resolved workspace root "open-lector-explorer" browses from -- absent under the exact same condition as lectorHost (no path argument at boot), and for the same reason: there is nothing to browse. */
    private readonly rootPath?: string,
  ) {
    this.output = new GridTerminal(terminal);
    this.footerChat = footerChat;
  }

  /**
   * Attaches a FooterChatController constructed *after* this application
   * already exists -- the real cli.ts sequencing: AlignmentExtensionUIContext
   * needs a live SemanticShellApplication before startFooterChat() calls
   * session.bindExtensions({ uiContext }), but startFooterChat() is also what
   * produces the FooterChatController itself. Breaking that cycle means
   * constructing the application with no footerChat, then attaching the real
   * one once startFooterChat() resolves -- never called more than once in
   * practice, but not guarded against it either (the constructor-injection
   * path used by every existing test remains the primary, simpler case).
   */
  attachFooterChat(footerChat: FooterChatController): void { this.footerChat = footerChat; }

  boot(width: number, height: number): Outcome<GridUpdate> { this.width = width; this.height = height; return this.render(); }
  resize(width: number, height: number): Outcome<GridUpdate> { this.width = width; this.height = height; return this.render(); }
  focusedRegion(): ShellFocus { return this.shell.focusedRegion(); }
  /** Current terminal row count -- what AlignmentExtensionUIContext's fakeTui.terminal.rows reads live on every custom() call, matching a real TUI.terminal.rows read fresh each time rather than cached at mount. */
  terminalRows(): number { return this.height; }
  /** Gives an extension-mounted Component (ExtensionUIContext.custom()) full ownership of the viewport and every keystroke -- see SemanticShell.enterExternal's own doc comment. Callers must call refresh() afterward to actually paint it; this only changes state. */
  showExternalComponent(component: Component): void { this.shell.enterExternal(component); }
  /** Hands focus and the viewport back to Alignment's own chrome -- see SemanticShell.exitExternal's own doc comment. Callers must call refresh() afterward. */
  hideExternalComponent(): void { this.shell.exitExternal(); }

  /** Re-renders at the current size without changing focus or layout -- what a footerChat subscriber calls when a streaming event changes what the Footer should show, independent of any real keyboard input. */
  refresh(): Outcome<GridUpdate> { return this.render(); }

  /**
   * Raw terminal bytes go through resolveShellCommand -- the facade -- to
   * become a semantic ShellCommand before anything here acts on them.
   * dispatch() is the "actual events API" side of that boundary: every
   * branch just calls the one real method the command names, with no
   * terminal-protocol knowledge of its own.
   */
  handleInput(data: string): Outcome<GridUpdate> {
    // An extension-mounted Component (ExtensionUIContext.custom()) owns
    // every keystroke while it's up -- exactly like a real pi TUI session
    // showing a ctx.ui.custom() overlay, where pi's own chrome receives no
    // input at all. Bypasses resolveShellCommand/dispatch entirely: there is
    // no semantic ShellCommand translation for raw bytes meant for someone
    // else's Component, only a pass-through.
    const external = this.shell.externalComponentHandle();
    if (external) {
      external.handleInput?.(data);
      return this.render();
    }
    const command = resolveShellCommand(data, { focusedRegion: this.shell.focusedRegion(), hasFooterChat: this.footerChat !== undefined });
    if (command) this.dispatch(command);
    return this.render();
  }

  private dispatch(command: ShellCommand): void {
    switch (command.type) {
      case "focus-next": this.shell.focusNext(); return;
      case "focus-previous": this.shell.focusPrevious(); return;
      case "enter-fullscreen": this.shell.enterFullscreen(); return;
      case "exit-fullscreen": this.shell.exitFullscreen(); return;
      case "expand-footer": this.shell.expandFooter(); return;
      case "collapse-footer": this.shell.collapseFooter(); return;
      case "scroll-footer-up": this.shell.scrollFooterUp(FOOTER_SCROLL_STEP); return;
      case "scroll-footer-down": this.shell.scrollFooterDown(FOOTER_SCROLL_STEP); return;
      case "footer-submit": this.footerChat?.submit(); return;
      case "footer-backspace": this.footerChat?.backspace(); return;
      case "footer-type": this.footerChat?.typeChar(command.char); return;
      case "open-lector-editor": this.openLectorEditor(); return;
      case "open-lector-explorer": this.openLectorExplorer(); return;
      case "open-terminal": this.openTerminal(); return;
    }
  }

  /** Fire-and-forget, matching every other dispatch branch's own void-returning contract -- a real failure (e.g. an unreachable Lector daemon) surfaces as a thrown error inside the prompted editor's own status line (ModalEditorComponent's own performActionSafely convention), not here. */
  private openLectorEditor(): void {
    if (!this.lectorHost) return;
    void promptAndOpenLectorEditorNatively(this, this.lectorHost).catch(() => {
      // Opening failed before any Component ever mounted (e.g. the initial workspace/file open
      // itself rejected) -- nothing is showing external focus in that case, so just refresh back
      // to Alignment's own chrome instead of leaving a dead promise with no user-visible outcome.
      this.hideExternalComponent();
      this.refresh();
    });
  }

  /** Same fire-and-forget/failure-recovery contract as openLectorEditor -- no Input prompt needed, unlike the editor, since the explorer always starts at the already-resolved workspace root. */
  private openLectorExplorer(): void {
    if (!this.lectorHost || !this.rootPath) return;
    void openLectorExplorerNatively(this, this.lectorHost, this.rootPath).catch(() => {
      this.hideExternalComponent();
      this.refresh();
    });
  }

  /**
   * No Lector involvement at all (unlike its two siblings above) -- a real shell has no daemon,
   * no workspace resource, nothing that can fail before a Component even mounts, so this has no
   * failure-recovery branch to speak of: openTerminalPaneNatively itself never throws, it only
   * spawns a real child process and mounts a Component synchronously. Absent rootPath means the
   * same "no path argument at boot" condition as the explorer -- there is nowhere to open a shell.
   */
  private openTerminal(): void {
    if (!this.rootPath) return;
    openTerminalPaneNatively(this, this.rootPath);
  }

  private render(): Outcome<GridUpdate> {
    const frame = this.shell.project(this.world.worldViewModel(), this.width, this.height, this.footerChat?.snapshot());
    if (!frame.ok) return frame;
    return this.output.render(frame.value);
  }
}
