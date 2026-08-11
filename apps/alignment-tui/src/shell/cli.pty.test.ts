import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spawnLiveTerminal } from "../test/live-pty-terminal.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceRoot = resolve(packageRoot, "../..");
const cli = resolve(packageRoot, "dist/cli.js");

function waitFor(read: () => string, expected: string, timeoutMs = 12_000): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const started = Date.now();
    const poll = () => {
      if (read().includes(expected)) return resolveWait();
      if (Date.now() - started > timeoutMs) return reject(new Error(`PTY did not emit ${JSON.stringify(expected)}; tail=${JSON.stringify(read().slice(-500))}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

describe("packaged TUI process boundary", () => {
  it("boots in a real PTY, accepts input, receives resize, and restores terminal mode", async () => {
    const command = `before=$(stty -g); '${process.execPath}' '${cli}'; after=$(stty -g); [ "$before" = "$after" ] && echo __RAW_RESTORED__; exit`;
    const terminal = spawnLiveTerminal("/bin/bash", ["-lc", command], { cols: 80, rows: 24, cwd: workspaceRoot });
    try {
      // Real, reconstructed-screen content checks -- this file's own prior use of
      // stripTerminalSequences specifically for these two (a flat ANSI-stripping regex) could not
      // correctly represent cursor-addressed rendering like GridTerminal's own output;
      // waitForText()/snapshot() are the real VT-reconstruction fix (see live-pty-terminal.ts's own
      // doc comment, which already named this exact file as the reason it exists).
      await terminal.waitForText("No workspace open");

      // Tab/resize/cursor-visibility/raw-mode-restoration below are genuinely wire-protocol-level
      // assertions (did the right raw control sequences get emitted, did the shell wrapper's own
      // stty capture match), not statements about visible Alignment UI content -- this file's own
      // prior version already checked these against raw `output` directly, never through
      // stripTerminalSequences, because a reconstructed screen has no way to represent "was a
      // clear-and-redraw sequence emitted" or "was the cursor-show sequence emitted" -- only "what
      // does the screen look like now". rawOutput() is the harness's own documented escape hatch
      // for exactly this, replacing the hand-rolled accumulator this file used to maintain itself.
      //
      // __RAW_RESTORED__ specifically: also confirmed, while migrating this file, that
      // @xterm/headless's reconstructed buffer does not reliably reflect this exact literal (a
      // shell `echo` immediately following several terminal-mode-toggling sequences) even though
      // every write() call completes normally and the identical byte sequence parses correctly in
      // isolation on a fresh terminal -- a real, narrow limitation of the reconstruction engine
      // under this specific accumulated-state sequence, not a stuck write or a resize race (both
      // ruled out directly). rawOutput() is the correct fix regardless of that quirk's exact cause,
      // since this assertion was never about visible UI content in the first place.
      const afterBoot = terminal.rawOutput().length;
      terminal.write("\t");
      await waitFor(() => terminal.rawOutput().slice(afterBoot), "\x1b[");

      const beforeResize = terminal.rawOutput().length;
      await terminal.resize(100, 30);
      await waitFor(() => terminal.rawOutput().slice(beforeResize), "\x1b[2J\x1b[H");

      terminal.write("\x03");
      await waitFor(() => terminal.rawOutput(), "__RAW_RESTORED__");

      // Not "Agent unavailable" specifically: since this app now tries a real
      // Pi Agent Integration at boot (see cli.ts's startFooterChat), whether
      // the Footer shows a live composer or "unavailable" depends on this
      // machine's own ~/.pi/agent credentials -- not something this PTY-boundary
      // test should assume either way. The Footer's own heading renders
      // regardless of that outcome.
      expect(terminal.snapshot()).toContain("Chat");
      expect(terminal.rawOutput()).toContain("\x1b[?25h");
    } finally {
      await terminal.dispose();
    }
  }, 20_000); // headroom above waitForText's own 12s default -- see live-pty-terminal.ts's own doc comment
});
