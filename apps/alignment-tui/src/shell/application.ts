import type { Terminal } from "@earendil-works/pi-tui";
import type { WorldViewModel } from "@alignment/surface-protocol";
import type { GridUpdate, Outcome } from "../frame/index.js";
import type { FooterChatController } from "../pi/footer-chat-controller.js";
import { GridTerminal } from "../terminal/grid-terminal.js";
import { resolveShellCommand, type ShellCommand } from "./keymap.js";
import { SemanticShell, type ShellFocus } from "./semantic-shell.js";

export interface WorldProjection { worldViewModel(): WorldViewModel }

export class SemanticShellApplication {
  private readonly shell = new SemanticShell();
  private readonly output: GridTerminal;
  private width = 0;
  private height = 0;

  constructor(
    private readonly world: WorldProjection,
    terminal: Pick<Terminal, "write">,
    /** Absent means no live Pi integration was constructed (no model configured, construction failed, ...) -- the Footer renders its existing "unavailable" state and Enter/typing in the footer are no-ops. */
    private readonly footerChat?: FooterChatController,
  ) {
    this.output = new GridTerminal(terminal);
  }

  boot(width: number, height: number): Outcome<GridUpdate> { this.width = width; this.height = height; return this.render(); }
  resize(width: number, height: number): Outcome<GridUpdate> { this.width = width; this.height = height; return this.render(); }
  focusedRegion(): ShellFocus { return this.shell.focusedRegion(); }

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
      case "footer-submit": this.footerChat?.submit(); return;
      case "footer-backspace": this.footerChat?.backspace(); return;
      case "footer-type": this.footerChat?.typeChar(command.char); return;
    }
  }

  private render(): Outcome<GridUpdate> {
    const frame = this.shell.project(this.world.worldViewModel(), this.width, this.height, this.footerChat?.snapshot());
    if (!frame.ok) return frame;
    return this.output.render(frame.value);
  }
}
