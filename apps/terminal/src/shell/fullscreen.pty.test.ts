import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type LiveTerminal, spawnLiveTerminal } from "../test/live-pty-terminal.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = resolve(packageRoot, "dist/cli.js");

let root: string | undefined;
let terminal: LiveTerminal | undefined;

async function stableSnapshot(liveTerminal: LiveTerminal, timeoutMs = 5_000): Promise<string> {
  const startedAt = Date.now();
  let previous = liveTerminal.snapshot();
  let unchangedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    const current = liveTerminal.snapshot();
    if (current !== previous) {
      previous = current;
      unchangedAt = Date.now();
    } else if (Date.now() - unchangedAt >= 100) {
      return current;
    }
  }
  throw new Error("Timed out waiting for the PTY screen to stabilize");
}

afterEach(async () => {
  await terminal?.dispose();
  terminal = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("Ctrl+Right/Ctrl+Left fullscreen, against a real running process", () => {
  it("fullscreens the focused body Surface, ignores Tab while fullscreen, and restores the exact original tiled layout on exit", async () => {
    // Deliberately doesn't contain the substring "fullscreen" -- it becomes
    // the workspace title shown on screen, and a name containing that word
    // would falsely satisfy waitForText("(fullscreen)") below before the
    // real transition ever happened.
    root = mkdtempSync(join(tmpdir(), "zodiac-tui-fs-pty-"));
    const rootTitle = basename(root);
    terminal = spawnLiveTerminal(process.execPath, [cli, root], { cols: 80, rows: 24 });

    // A real directory argument bootstraps a real Workspace (its own title
    // in the body), not the empty-state watermark -- see cli-bootstrap.pty.test.ts.
    await terminal.waitForText(rootTitle);
    const original = await stableSnapshot(terminal);
    expect(original).toContain("Workspaces");
    expect(original).toContain("Integrations");

    terminal.write("\t"); // header -> left-pillar
    terminal.write("\t"); // left-pillar -> body
    terminal.write("\x1b[1;5C"); // Ctrl+Right -- enter fullscreen
    await terminal.waitForText("(fullscreen)"); // the fullscreen box's own label text
    const fullscreen = await stableSnapshot(terminal);
    expect(fullscreen).toContain(rootTitle);
    expect(fullscreen).not.toContain("Workspaces");
    expect(fullscreen).not.toContain("Integrations");
    expect(fullscreen).not.toContain("Windows");

    const beforeTab = fullscreen;
    terminal.write("\t"); // Tab must be a no-op -- nothing else is visible to focus
    expect(await stableSnapshot(terminal)).toBe(beforeTab);

    terminal.write("\x1b[1;5D"); // Ctrl+Left -- exit fullscreen
    await terminal.waitForText("Workspaces");
    expect(await stableSnapshot(terminal)).toBe(original);
  }, 20_000); // headroom above waitForText's own 12s default -- see live-pty-terminal.ts's doc comment
});
