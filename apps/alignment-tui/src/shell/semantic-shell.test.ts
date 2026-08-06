import { createWorldStore } from "@alignment/core";
import { worldId } from "@alignment/surface-protocol";
import { renderToTerminal } from "@danypops/pi-tui-harness";
import { describe, expect, it } from "vitest";
import { diffFrames } from "../frame/index.js";
import { encodeGridUpdate } from "../terminal/grid-terminal.js";
import { SemanticShell } from "./semantic-shell.js";

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

describe("semantic empty Alignment shell", () => {
  it.each([[60, 12], [80, 24], [120, 40]])("renders all five semantic regions at %ix%i", async (width, height) => {
    const result = await render(width, height);
    try {
      const text = result.terminal.plainLines().join("\n");
      expect(text).toContain("Windows: none");
      expect(text).toContain("Workspaces");
      expect(text).toContain("No workspace open");
      expect(text).toContain("Integrations");
      expect(text).toContain("Agent unavailable");
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
});
