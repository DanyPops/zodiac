import { createWorldStore } from "@alignment/core";
import { worldId } from "@alignment/surface-protocol";
import { renderToTerminal } from "@danypops/pi-tui-harness";
import { describe, expect, it } from "vitest";
import { SemanticShellApplication } from "./application.js";

describe("SemanticShellApplication lifecycle", () => {
  it("boots, traverses focus through Pi key parsing, and resizes through grid patches", async () => {
    const writes: string[] = [];
    const app = new SemanticShellApplication(createWorldStore(worldId("empty")), { write: data => writes.push(data) });
    expect(app.boot(80, 24)).toMatchObject({ ok: true, value: { full: true } });
    expect(app.focusedRegion()).toBe("header");
    expect(app.handleInput("\t")).toMatchObject({ ok: true, value: { full: false } });
    expect(app.focusedRegion()).toBe("left-pillar");
    expect(app.handleInput("\x1b[Z")).toMatchObject({ ok: true, value: { full: false } });
    expect(app.focusedRegion()).toBe("header");
    expect(app.resize(60, 16)).toMatchObject({ ok: true, value: { full: true } });
    expect(writes.at(-1)).toContain("\x1b[2J\x1b[H");

    const terminal = await renderToTerminal([writes.join("")], { cols: 80, rows: 24 });
    try {
      const text = terminal.plainLines().join("\n");
      expect(text).toContain("Windows: none");
      expect(text).toContain("No workspace open");
      expect(text).toContain("Agent unavailable");
      expect(text).not.toContain("undefined");
    } finally { terminal.dispose(); }
  });

  it("fails boot safely for an invalid viewport without writing", () => {
    const writes: string[] = [];
    const app = new SemanticShellApplication(createWorldStore(worldId("empty")), { write: data => writes.push(data) });
    expect(app.boot(10, 5)).toMatchObject({ ok: false, error: { code: "invalid-dimensions" } });
    expect(writes).toEqual([]);
  });
});
