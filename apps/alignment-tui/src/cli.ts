#!/usr/bin/env node
import { createWorldStore } from "@alignment/core";
import { worldId } from "@alignment/surface-protocol";
import { Key, matchesKey, ProcessTerminal } from "@earendil-works/pi-tui";
import { applyBootstrapToWorld } from "./bootstrap/apply-bootstrap.js";
import { classifyPath } from "./bootstrap/classify-path.js";
import { bootstrapWorkspace } from "./bootstrap/workspace-bootstrap.js";
import { createLectorHost, type LectorHost } from "./lector/lector-host.js";
import { SemanticShellApplication } from "./shell/application.js";

function fail(message: string): void {
  process.stderr.write(`Alignment: ${message}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const classified = classifyPath(process.argv[2]);
  if (classified.kind === "missing") return fail(`no such path: ${classified.path}`);
  if (classified.kind === "denied") return fail(`permission denied: ${classified.path}`);
  if (classified.kind === "unsupported") return fail(`not a file or directory: ${classified.path}`);

  const world = createWorldStore(worldId("alignment"));
  let host: LectorHost | undefined;
  if (classified.kind !== "none") {
    host = createLectorHost();
    await host.activate();
    const bootstrapped = await bootstrapWorkspace(classified, host);
    if (!bootstrapped.ok) {
      await host.dispose();
      return fail(bootstrapped.message);
    }
    applyBootstrapToWorld(world, bootstrapped.value);
  }

  const terminal = new ProcessTerminal();
  const application = new SemanticShellApplication(world, terminal);
  let stopping = false;

  async function stop(exitCode = 0): Promise<void> {
    if (stopping) return;
    stopping = true;
    terminal.showCursor();
    await terminal.drainInput(100, 20);
    terminal.stop();
    await host?.dispose();
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
}

void main();
