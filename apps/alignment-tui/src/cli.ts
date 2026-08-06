#!/usr/bin/env node
import { Key, matchesKey, ProcessTerminal } from "@earendil-works/pi-tui";
import type { EmptyWorldViewModel } from "@alignment/surface-protocol";
import { SemanticShellApplication } from "./shell/application.js";

const emptyWorld: EmptyWorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };
const terminal = new ProcessTerminal();
const application = new SemanticShellApplication({ worldViewModel: () => emptyWorld }, terminal);
let stopping = false;

async function stop(exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  terminal.showCursor();
  await terminal.drainInput(100, 20);
  terminal.stop();
  process.exitCode = exitCode;
}

terminal.start(
  (data) => {
    if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.escape)) void stop();
    else application.handleInput(data);
  },
  () => application.resize(terminal.columns, terminal.rows),
);
terminal.setTitle("Alignment");
const boot = application.boot(terminal.columns, terminal.rows);
if (!boot.ok) {
  terminal.write(`\r\nAlignment failed to start: ${boot.error.message}\r\n`);
  void stop(1);
}
process.once("SIGTERM", () => void stop());
process.once("SIGHUP", () => void stop());
