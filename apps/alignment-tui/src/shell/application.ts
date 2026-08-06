import { Key, matchesKey, type Terminal } from "@earendil-works/pi-tui";
import type { WorldViewModel } from "@alignment/surface-protocol";
import type { GridUpdate, Outcome } from "../frame/index.js";
import { GridTerminal } from "../terminal/grid-terminal.js";
import { SemanticShell, type ShellFocus } from "./semantic-shell.js";

export interface WorldProjection { worldViewModel(): WorldViewModel }

export class SemanticShellApplication {
  private readonly shell = new SemanticShell();
  private readonly output: GridTerminal;
  private width = 0;
  private height = 0;

  constructor(private readonly world: WorldProjection, terminal: Pick<Terminal, "write">) { this.output = new GridTerminal(terminal); }

  boot(width: number, height: number): Outcome<GridUpdate> { this.width = width; this.height = height; return this.render(); }
  resize(width: number, height: number): Outcome<GridUpdate> { this.width = width; this.height = height; return this.render(); }
  focusedRegion(): ShellFocus { return this.shell.focusedRegion(); }

  handleInput(data: string): Outcome<GridUpdate> {
    if (matchesKey(data, Key.tab)) this.shell.focusNext();
    else if (matchesKey(data, Key.shift("tab"))) this.shell.focusPrevious();
    return this.render();
  }

  private render(): Outcome<GridUpdate> {
    const frame = this.shell.project(this.world.worldViewModel(), this.width, this.height);
    if (!frame.ok) return frame;
    return this.output.render(frame.value);
  }
}
