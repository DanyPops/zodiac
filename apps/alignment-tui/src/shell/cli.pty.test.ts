import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceRoot = resolve(packageRoot, "../..");
const cli = resolve(packageRoot, "dist/cli.js");

function waitFor(read: () => string, expected: string, timeoutMs = 5_000): Promise<void> {
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
    const child = pty.spawn("/bin/bash", ["-lc", command], { cols: 80, rows: 24, cwd: workspaceRoot, env: { ...process.env, TERM: "xterm-256color" } });
    let output = "";
    child.onData(data => { output += data; });
    try {
      await waitFor(() => stripTerminalSequences(output), "No workspace open");
      const afterBoot = output.length;
      child.write("\t");
      await waitFor(() => output.slice(afterBoot), "\x1b[");
      const beforeResize = output.length;
      child.resize(100, 30);
      await waitFor(() => output.slice(beforeResize), "\x1b[2J\x1b[H");
      child.write("\x03");
      await waitFor(() => output, "__RAW_RESTORED__");
      // Not "Agent unavailable" specifically: since this app now tries a real
      // Pi Agent Integration at boot (see cli.ts's startFooterChat), whether
      // the Footer shows a live composer or "unavailable" depends on this
      // machine's own ~/.pi/agent credentials -- not something this PTY-boundary
      // test should assume either way. The Footer's own heading renders
      // regardless of that outcome.
      expect(stripTerminalSequences(output)).toContain("Chat");
      expect(output).toContain("\x1b[?25h");
    } finally {
      try { child.kill(); } catch { /* already exited */ }
    }
  }, 15_000);
});
