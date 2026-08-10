#!/usr/bin/env node
import { dirname } from "node:path";
import { createWorldStore } from "@alignment/core";
import { worldId } from "@alignment/surface-protocol";
import { Key, matchesKey, ProcessTerminal } from "@earendil-works/pi-tui";
import { applyBootstrapToWorld } from "./bootstrap/apply-bootstrap.js";
import { classifyPath, type ClassifiedPath } from "./bootstrap/classify-path.js";
import { bootstrapWorkspace } from "./bootstrap/workspace-bootstrap.js";
import { createLectorHost, type LectorHost } from "./lector/lector-host.js";
import { startFooterChat } from "./pi/start-footer-chat.js";
import { SemanticShellApplication } from "./shell/application.js";

/** The classified CLI argument names a real directory, a file (its containing directory is used), or nothing (falls back to the process's own cwd) -- matching how a real `pi` CLI session resolves its own working directory. */
function resolveAgentCwd(classified: ClassifiedPath): string {
  if (classified.kind === "directory") return classified.path;
  if (classified.kind === "file") return dirname(classified.path);
  return process.cwd();
}

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

  const chat = await startFooterChat({ cwd: resolveAgentCwd(classified) });

  const terminal = new ProcessTerminal();
  const application = new SemanticShellApplication(world, terminal, chat?.footerChat);
  let stopping = false;

  // Any live-conversation event (a streaming delta, a tool call, an error)
  // needs a re-render even though no key was pressed -- handleInput/resize
  // are the only other paths that ever call render().
  const unsubscribeFooterChat = chat?.footerChat.subscribe(() => application.refresh());

  async function stop(exitCode = 0): Promise<void> {
    if (stopping) return;
    stopping = true;
    terminal.showCursor();
    await terminal.drainInput(100, 20);
    terminal.stop();
    unsubscribeFooterChat?.();
    chat?.footerChat.dispose();
    chat?.session.dispose();
    await host?.dispose();
    process.exitCode = exitCode;
  }

  terminal.start(
    (data) => {
      if (matchesKey(data, Key.ctrl("c"))) void stop();
      else if (matchesKey(data, Key.escape) && application.focusedRegion() !== "footer") void stop();
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
